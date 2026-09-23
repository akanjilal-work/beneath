"""Geographic (EPSG:4326) tile math, grid sampling, PNG tile rendering and PMTiles writing.

Tiling scheme (matches Cesium's GeographicTilingScheme):
  level z has 2^(z+1) columns x 2^z rows of 256 x 256 tiles.
  Tile (z, x, y) covers lon [-180 + x*d, -180 + (x+1)*d], lat [90 - (y+1)*d, 90 - y*d]
  with d = 180 / 2^z degrees; x = 0 at lon -180, y = 0 at the north pole.
  Pixel (col, row) centre: lon = -180 + (x*256 + col + 0.5) * p,
                           lat =  90 - (y*256 + row + 0.5) * p,  with p = 180 / (256 * 2^z) degrees.
PMTiles addressing: geographic level z is stored as PMTiles zoom z + PMTILES_ZOOM_OFFSET (= 1)
  with the same x and y, i.e. tileid = zxy_to_tileid(z + 1, x, y). Only the upper half
  (y < 2^z) of each square PMTiles zoom level is populated.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from .encode import encode_rgb

TILE_SIZE = 256
PMTILES_ZOOM_OFFSET = 1
WGS84_E2 = 6.69437999014e-3  # first eccentricity squared


# --------------------------------------------------------------------------- tile math

def tile_cols(z: int) -> int:
    return 1 << (z + 1)


def tile_rows(z: int) -> int:
    return 1 << z


def level_tile_count(z: int) -> int:
    return tile_cols(z) * tile_rows(z)


def pixel_deg(z: int, size: int = TILE_SIZE) -> float:
    """Pixel size in degrees (same in lon and lat) at geographic level z."""
    return 180.0 / (size * (1 << z))


def pmtiles_tileid(z: int, x: int, y: int) -> int:
    """PMTiles tile id for geographic tile (z, x, y): stored at PMTiles zoom z + 1, same x, y."""
    if not (0 <= x < tile_cols(z) and 0 <= y < tile_rows(z)):
        raise ValueError(f"tile {z}/{x}/{y} outside the geographic scheme")
    return zxy_to_tileid(z + PMTILES_ZOOM_OFFSET, x, y)


def pixel_centres(z: int, x: int, y: int, size: int = TILE_SIZE) -> tuple[np.ndarray, np.ndarray]:
    """Longitudes (size,) and latitudes (size,) of the pixel centres of tile z/x/y.

    Latitudes run north -> south (row order), longitudes west -> east (column order).
    """
    p = pixel_deg(z, size)
    lon = -180.0 + (x * size + np.arange(size) + 0.5) * p
    lat = 90.0 - (y * size + np.arange(size) + 0.5) * p
    return lon, lat


def lonlat_to_tile_pixel(lon: float, lat: float, z: int, size: int = TILE_SIZE) -> tuple[int, int, int, int]:
    """(lon, lat) -> (x, y, col, row) of the containing tile and pixel."""
    p = pixel_deg(z, size)
    w, h = size * tile_cols(z), size * tile_rows(z)
    if not -180.0 <= lon <= 180.0:
        lon = ((lon + 180.0) % 360.0) - 180.0
    px = min(max(int(math.floor((lon + 180.0) / p)), 0), w - 1)
    py = min(max(int(math.floor((90.0 - lat) / p)), 0), h - 1)
    return px // size, py // size, px % size, py % size


def geodetic_to_geocentric(lat_deg: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan((1.0 - WGS84_E2) * np.tan(np.radians(lat_deg))))


# --------------------------------------------------------------------------- source grids

@dataclass
class GridSpec:
    """A regular lon/lat grid of point samples (row 0 = north).

    Sample (i, j) sits at lat = lat0 + i * dlat, lon = lon0 + j * dlon.
    `wrap` means the columns cover 360 degrees exactly once (no duplicated seam
    column), so interpolation wraps across the antimeridian / grid edge.
    `geocentric` means row latitudes are geocentric; geodetic query latitudes are
    converted before lookup.
    """
    nrows: int
    ncols: int
    lat0: float
    dlat: float
    lon0: float
    dlon: float
    wrap: bool = True
    geocentric: bool = False


class Grid:
    def __init__(self, data: np.ndarray, spec: GridSpec):
        assert data.shape == (spec.nrows, spec.ncols)
        self.data = data
        self.spec = spec

    # persistence (so worker processes can memory-map the grid)
    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path.with_suffix(".npy"), np.ascontiguousarray(self.data, dtype=np.float32))
        path.with_suffix(".json").write_text(json.dumps(asdict(self.spec)))

    @classmethod
    def load(cls, path: Path, mmap: bool = True) -> "Grid":
        spec = GridSpec(**json.loads(path.with_suffix(".json").read_text()))
        data = np.load(path.with_suffix(".npy"), mmap_mode="r" if mmap else None)
        return cls(data, spec)

    @classmethod
    def exists(cls, path: Path) -> bool:
        return path.with_suffix(".npy").exists() and path.with_suffix(".json").exists()

    # index helpers
    def _rows(self, lat: np.ndarray):
        """Row indices/fraction; `outside` marks latitudes beyond the first/last grid row."""
        s = self.spec
        if s.geocentric:
            lat = geodetic_to_geocentric(lat)
        r = (lat - s.lat0) / s.dlat
        outside = (r < -1e-9) | (r > s.nrows - 1 + 1e-9)
        i0 = np.clip(np.floor(r).astype(np.int64), 0, s.nrows - 2)
        fr = np.clip(r - i0, 0.0, 1.0)
        return i0, i0 + 1, fr, outside

    def _cols(self, lon: np.ndarray):
        s = self.spec
        c = (lon - s.lon0) / s.dlon
        if s.wrap:
            fl = np.floor(c)
            fc = c - fl
            j0 = np.mod(fl.astype(np.int64), s.ncols)
            j1 = np.mod(j0 + 1, s.ncols)
        else:
            j0 = np.clip(np.floor(c).astype(np.int64), 0, s.ncols - 2)
            fc = np.clip(c - j0, 0.0, 1.0)
            j1 = j0 + 1
        return j0, j1, fc

    @staticmethod
    def _blend(vals, weights, min_weight):
        num = np.zeros_like(weights[0])
        den = np.zeros_like(weights[0])
        for v, w in zip(vals, weights):
            m = np.isfinite(v)
            num += np.where(m, v, 0.0) * w
            den += m * w
        out = np.full_like(num, np.nan)
        ok = den >= min_weight
        out[ok] = num[ok] / den[ok]
        return out

    def sample_mesh(self, lon: np.ndarray, lat: np.ndarray, min_weight: float = 0.5) -> np.ndarray:
        """Bilinear sample on the outer product lat (rows) x lon (cols).

        NaN (nodata) neighbours are excluded and the weights renormalised; the
        result is nodata when less than `min_weight` of the bilinear weight is
        valid. Latitudes beyond the grid's first/last row are nodata (never
        extrapolated).
        """
        i0, i1, fr, outside = self._rows(np.asarray(lat, dtype=np.float64))
        j0, j1, fc = self._cols(np.asarray(lon, dtype=np.float64))
        d = self.data
        v00 = d[np.ix_(i0, j0)].astype(np.float64)
        v01 = d[np.ix_(i0, j1)].astype(np.float64)
        v10 = d[np.ix_(i1, j0)].astype(np.float64)
        v11 = d[np.ix_(i1, j1)].astype(np.float64)
        fr_ = fr[:, None]
        fc_ = fc[None, :]
        w = [(1 - fr_) * (1 - fc_), (1 - fr_) * fc_, fr_ * (1 - fc_), fr_ * fc_]
        out = self._blend([v00, v01, v10, v11], w, min_weight)
        out[outside, :] = np.nan
        return out

    def sample_points(self, lon, lat, min_weight: float = 0.5) -> np.ndarray:
        """Bilinear sample at individual points (same rules as sample_mesh)."""
        lon = np.atleast_1d(np.asarray(lon, dtype=np.float64))
        lat = np.atleast_1d(np.asarray(lat, dtype=np.float64))
        i0, i1, fr, outside = self._rows(lat)
        j0, j1, fc = self._cols(lon)
        d = self.data
        vals = [d[i0, j0], d[i0, j1], d[i1, j0], d[i1, j1]]
        vals = [np.asarray(v, dtype=np.float64) for v in vals]
        w = [(1 - fr) * (1 - fc), (1 - fr) * fc, fr * (1 - fc), fr * fc]
        out = self._blend(vals, w, min_weight)
        out[outside] = np.nan
        return out


# --------------------------------------------------------------------------- tile rendering

def png_bytes(rgb: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, format="PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def sample_tile(grid: Grid, z: int, x: int, y: int) -> np.ndarray:
    """Bilinear sample of the grid at the pixel centres of tile z/x/y (float, NaN = nodata)."""
    lon, lat = pixel_centres(z, x, y)
    return grid.sample_mesh(lon, lat)


def downsample2(a: np.ndarray) -> np.ndarray:
    """NaN-aware 2x2 mean: mean of the valid children, NaN only if all four are NaN."""
    h, w = a.shape
    b = np.asarray(a, dtype=np.float64).reshape(h // 2, 2, w // 2, 2)
    valid = np.isfinite(b)
    s = np.where(valid, b, 0.0).sum(axis=(1, 3))
    c = valid.sum(axis=(1, 3))
    out = np.full(s.shape, np.nan)
    np.divide(s, c, out=out, where=c > 0)
    return out


def pyramid_reference(grid: Grid, z: int, x: int, y: int, col: int, row: int, maxzoom: int) -> float:
    """Expected value of pixel (col,row) of tile z/x/y under the pyramid scheme:
    bilinear samples at the maxzoom pixel centres below it, reduced by repeated 2x2 means."""
    k = 1 << (maxzoom - z)
    p = pixel_deg(maxzoom)
    px0 = (x * TILE_SIZE + col) * k
    py0 = (y * TILE_SIZE + row) * k
    lon = -180.0 + (px0 + np.arange(k) + 0.5) * p
    lat = 90.0 - (py0 + np.arange(k) + 0.5) * p
    v = grid.sample_mesh(lon, lat).astype(np.float32)
    while v.shape[0] > 1:
        v = downsample2(v).astype(np.float32)
    return float(v[0, 0])


_WORKER_GRID: Grid | None = None
_WORKER_ENC: tuple[float, float] | None = None
_WORKER_PYR: Path | None = None


def _init_sampler(grid_path: str) -> None:
    global _WORKER_GRID
    _WORKER_GRID = Grid.load(Path(grid_path), mmap=True)


def _sample_column(args: tuple[int, int, str]) -> None:
    z, x, mosaic_path = args
    mm = np.load(mosaic_path, mmap_mode="r+")
    for y in range(tile_rows(z)):
        mm[y * TILE_SIZE:(y + 1) * TILE_SIZE, x * TILE_SIZE:(x + 1) * TILE_SIZE] = \
            sample_tile(_WORKER_GRID, z, x, y).astype(np.float32)
    mm.flush()
    del mm


def _init_encoder(pyr_dir: str, scale: float, offset: float) -> None:
    global _WORKER_PYR, _WORKER_ENC
    _WORKER_PYR = Path(pyr_dir)
    _WORKER_ENC = (scale, offset)


def _encode_column(args: tuple[int, int]) -> list[tuple[int, int, bytes]]:
    z, x = args
    scale, offset = _WORKER_ENC
    mm = np.load(_WORKER_PYR / f"z{z}.npy", mmap_mode="r")
    out = []
    for y in range(tile_rows(z)):
        vals = np.asarray(mm[y * TILE_SIZE:(y + 1) * TILE_SIZE, x * TILE_SIZE:(x + 1) * TILE_SIZE])
        out.append((pmtiles_tileid(z, x, y), z, png_bytes(encode_rgb(vals, scale, offset))))
    del mm
    return out


def build_pyramid(grid_path: Path, pyr_dir: Path, minzoom: int, maxzoom: int, workers: int) -> None:
    """Float32 world mosaics z{minzoom..maxzoom}.npy (rows x cols = 256*2^z x 256*2^(z+1)).

    maxzoom: bilinear samples of the source grid at the pixel centres.
    Lower zooms: NaN-aware 2x2 mean of the level above (area averaging, no aliasing).
    """
    pyr_dir.mkdir(parents=True, exist_ok=True)
    top = pyr_dir / f"z{maxzoom}.npy"
    shape = (TILE_SIZE * tile_rows(maxzoom), TILE_SIZE * tile_cols(maxzoom))
    mm = np.lib.format.open_memmap(top, mode="w+", dtype=np.float32, shape=shape)
    del mm
    with ProcessPoolExecutor(max_workers=workers, initializer=_init_sampler, initargs=(str(grid_path),)) as ex:
        list(ex.map(_sample_column, [(maxzoom, x, str(top)) for x in range(tile_cols(maxzoom))], chunksize=1))
    for z in range(maxzoom - 1, minzoom - 1, -1):
        src = np.load(pyr_dir / f"z{z + 1}.npy", mmap_mode="r")
        n, m = src.shape[0] // 2, src.shape[1] // 2
        dst = np.lib.format.open_memmap(pyr_dir / f"z{z}.npy", mode="w+", dtype=np.float32, shape=(n, m))
        step = 1024
        for r in range(0, n, step):
            dst[r:r + step] = downsample2(src[2 * r:2 * (r + step)]).astype(np.float32)
        dst.flush()
        del dst, src


class DeterministicWriter(Writer):
    """pmtiles Writer that de-duplicates tiles by SHA-256 (not Python's salted hash)."""

    def write_tile(self, tileid, data):
        from pmtiles.tile import Entry
        if self.tile_entries and tileid < self.tile_entries[-1].tile_id:
            self.clustered = False
        key = hashlib.sha256(data).digest()
        if key in self.hash_to_offset:
            last = self.tile_entries[-1]
            found = self.hash_to_offset[key]
            if tileid == last.tile_id + last.run_length and last.offset == found:
                last.run_length += 1
            else:
                self.tile_entries.append(Entry(tileid, found, len(data), 1))
        else:
            self.tile_f.write(data)
            self.tile_entries.append(Entry(tileid, self.offset, len(data), 1))
            self.hash_to_offset[key] = self.offset
            self.offset += len(data)
        self.addressed_tiles += 1


def build_raster_pmtiles(grid_path: Path, out_path: Path, *, scale: float, offset: float,
                         minzoom: int, maxzoom: int, metadata: dict,
                         workers: int | None = None) -> dict:
    """Render all geographic tiles z=minzoom..maxzoom from a saved Grid into a PMTiles v3
    archive (geographic level z stored at PMTiles zoom z + 1, see module docstring).

    maxzoom tiles are bilinear point samples; lower zooms are NaN-aware 2x2 means of
    the (unquantised) level above. Returns per-level tile counts and PNG byte totals
    (keyed by geographic level).
    """
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    pyr_dir = grid_path.parent / f"{grid_path.name}_pyramid"
    build_pyramid(grid_path, pyr_dir, minzoom, maxzoom, workers)
    jobs = [(z, x) for z in range(minzoom, maxzoom + 1) for x in range(tile_cols(z))]
    # biggest levels first for better load balance
    jobs.sort(key=lambda j: -j[0])
    tiles: list[tuple[int, int, bytes]] = []
    with ProcessPoolExecutor(max_workers=workers, initializer=_init_encoder,
                             initargs=(str(pyr_dir), scale, offset)) as ex:
        for res in ex.map(_encode_column, jobs, chunksize=1):
            tiles.extend(res)
    tiles.sort(key=lambda t: t[0])
    for z in range(minzoom, maxzoom + 1):  # ~0.7 GB of scratch mosaics
        (pyr_dir / f"z{z}.npy").unlink(missing_ok=True)
    try:
        pyr_dir.rmdir()
    except OSError:
        pass

    stats: dict[int, dict] = {}
    for _, z, data in tiles:
        s = stats.setdefault(z, {"tiles": 0, "bytes": 0})
        s["tiles"] += 1
        s["bytes"] += len(data)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        w = DeterministicWriter(f)
        for tid, _, data in tiles:
            w.write_tile(tid, data)
        header = {
            "tile_type": TileType.PNG,
            "tile_compression": Compression.NONE,
            "min_lon_e7": int(-180 * 1e7),
            "min_lat_e7": int(-90 * 1e7),
            "max_lon_e7": int(180 * 1e7),
            "max_lat_e7": int(90 * 1e7),
            "center_zoom": PMTILES_ZOOM_OFFSET,
            "center_lon_e7": 0,
            "center_lat_e7": 0,
        }
        w.finalize(header, metadata)
    tmp.replace(out_path)
    return {"perZoom": {str(z): stats[z] for z in sorted(stats)},
            "fileBytes": out_path.stat().st_size}

import math

import numpy as np
from pmtiles.tile import tileid_to_zxy, zxy_to_tileid

from beneath_pipeline.tiles import (PMTILES_ZOOM_OFFSET, Grid, GridSpec, level_tile_count, lonlat_to_tile_pixel,
                                    pixel_centres, pixel_deg, pmtiles_tileid, tile_cols, tile_rows)


def test_level_shape():
    assert [(tile_cols(z), tile_rows(z)) for z in range(6)] == [(2, 1), (4, 2), (8, 4), (16, 8), (32, 16), (64, 32)]
    assert sum(level_tile_count(z) for z in range(6)) == 2730
    assert math.isclose(pixel_deg(5) * 60, 180 * 60 / (256 * 32))   # ~1.318 arcmin


def test_level0_pixel_centres():
    # level 0: two tiles, west (x=0) and east (x=1) hemispheres, pole to pole
    lon, lat = pixel_centres(0, 0, 0)
    p = 180 / 256
    assert math.isclose(lon[0], -180 + p / 2) and math.isclose(lon[-1], 0 - p / 2)
    assert math.isclose(lat[0], 90 - p / 2) and math.isclose(lat[-1], -90 + p / 2)   # y = 0 is north
    lon1, _ = pixel_centres(0, 1, 0)
    assert math.isclose(lon1[0], p / 2) and math.isclose(lon1[-1], 180 - p / 2)


def test_tile_bounds_formula():
    # tile (z, x, y) covers lon [-180 + x*d, ...], lat [90 - y*d, ...] with d = 180 / 2^z
    for z, x, y in [(2, 3, 1), (5, 40, 17), (5, 63, 31)]:
        d = 180 / 2 ** z
        lon, lat = pixel_centres(z, x, y)
        assert math.isclose(lon[0] - pixel_deg(z) / 2, -180 + x * d, abs_tol=1e-9)
        assert math.isclose(lon[-1] + pixel_deg(z) / 2, -180 + (x + 1) * d, abs_tol=1e-9)
        assert math.isclose(lat[0] + pixel_deg(z) / 2, 90 - y * d, abs_tol=1e-9)
        assert math.isclose(lat[-1] - pixel_deg(z) / 2, 90 - (y + 1) * d, abs_tol=1e-9)


def test_known_tile_and_round_trip():
    # Guelph (-80.25, 43.55) at level 5: d = 5.625 deg -> x = floor(99.75/5.625) = 17, y = floor(46.45/5.625) = 8
    x, y, col, row = lonlat_to_tile_pixel(-80.25, 43.55, 5)
    assert (x, y) == (17, 8)
    lon, lat = pixel_centres(5, x, y)
    assert abs(lon[col] - -80.25) <= pixel_deg(5) / 2 + 1e-12
    assert abs(lat[row] - 43.55) <= pixel_deg(5) / 2 + 1e-12
    # poles and antimeridian clamp into the grid
    assert lonlat_to_tile_pixel(180.0, -90.0, 5) == (63, 31, 255, 255)
    assert lonlat_to_tile_pixel(-180.0, 90.0, 5) == (0, 0, 0, 0)
    # every pixel centre maps back to its own tile/pixel
    for z, tx, ty in [(0, 0, 0), (0, 1, 0), (3, 5, 2), (5, 63, 31)]:
        lon, lat = pixel_centres(z, tx, ty)
        for c in (0, 100, 255):
            for r in (0, 128, 255):
                assert lonlat_to_tile_pixel(lon[c], lat[r], z) == (tx, ty, c, r)


def test_pmtiles_addressing():
    # geographic (z, x, y) -> PMTiles (z + 1, x, y); ids unique across all levels
    assert PMTILES_ZOOM_OFFSET == 1
    ids = set()
    for z in range(6):
        for x in range(tile_cols(z)):
            for y in range(tile_rows(z)):
                tid = pmtiles_tileid(z, x, y)
                assert tileid_to_zxy(tid) == (z + 1, x, y)
                ids.add(tid)
    assert len(ids) == 2730
    import pytest
    with pytest.raises(ValueError):
        pmtiles_tileid(0, 0, 1)    # level 0 has one row


def test_hilbert_tileid_round_trip():
    for z in range(0, 7):
        for x, y in [(0, 0), ((1 << z) - 1, 0), (0, (1 << z) - 1), ((1 << z) // 2, (1 << z) // 3)]:
            assert tileid_to_zxy(zxy_to_tileid(z, x, y)) == (z, x, y)


def _toy_grid():
    # 1-degree global grid with value = lon (0..359) on the columns
    lons = np.arange(360.0)
    data = np.tile(lons, (181, 1)).astype(np.float32)
    spec = GridSpec(nrows=181, ncols=360, lat0=90.0, dlat=-1.0, lon0=0.0, dlon=1.0, wrap=True)
    return Grid(data, spec)


def test_bilinear_and_antimeridian_wrap():
    g = _toy_grid()
    assert math.isclose(g.sample_points(10.25, 0.0)[0], 10.25)
    # between the 359 column and the 0 column: linear blend of 359 and 0
    assert math.isclose(g.sample_points(359.5, 0)[0], 179.5)
    assert math.isclose(g.sample_points(-0.5, 0)[0], 179.5)   # same place, -180..180 convention


def test_nodata_renormalisation():
    g = _toy_grid()
    g.data[:, 11] = np.nan
    assert math.isclose(g.sample_points(10.25, 0.0)[0], 10.0)   # 75% valid weight -> nearest valid value
    assert np.isnan(g.sample_points(10.75, 0.0)[0])              # only 25% valid weight -> nodata


def test_no_extrapolation_beyond_grid_rows():
    spec = GridSpec(nrows=179, ncols=360, lat0=89.0, dlat=-1.0, lon0=0.0, dlon=1.0, wrap=True)
    g = Grid(np.ones((179, 360), dtype=np.float32), spec)
    assert g.sample_points(0, 89.0)[0] == 1.0 and g.sample_points(0, -89.0)[0] == 1.0
    assert np.isnan(g.sample_points(0, 89.5)[0]) and np.isnan(g.sample_points(0, -89.5)[0])
    mesh = g.sample_mesh(np.array([0.0, 1.0]), np.array([89.9, 45.0]))
    assert np.isnan(mesh[0]).all() and (mesh[1] == 1.0).all()


def test_downsample2_nan_aware_mean():
    from beneath_pipeline.tiles import downsample2
    a = np.array([[1, 3, np.nan, np.nan],
                  [5, 7, np.nan, 8],
                  [0, 0, 1, 1],
                  [0, 0, 1, 1]], dtype=np.float32)
    d = downsample2(a)
    assert d.shape == (2, 2)
    assert d[0, 0] == 4.0            # mean of 4 valid children
    assert d[0, 1] == 8.0            # mean of the only valid child
    assert d[1, 0] == 0.0 and d[1, 1] == 1.0
    assert np.isnan(downsample2(np.full((2, 2), np.nan)))[0, 0]   # all nodata -> nodata

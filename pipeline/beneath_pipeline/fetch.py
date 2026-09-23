"""Download source files into sources/raw and record checksums in sources/manifest.json.

A file that already exists locally is not downloaded again; its checksum is
recomputed and compared with the manifest entry (a mismatch is reported loudly,
since it means the build is no longer reproducible from the recorded inputs).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sys
from pathlib import Path

import requests

from .paths import RAW_DIR, SOURCE_MANIFEST

USER_AGENT = "beneath-pipeline/1 (+https://github.com/; data pipeline for an educational globe)"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest() -> dict:
    if SOURCE_MANIFEST.exists():
        return json.loads(SOURCE_MANIFEST.read_text())
    return {"version": 1, "files": {}}


def save_manifest(m: dict) -> None:
    m["files"] = dict(sorted(m["files"].items()))
    SOURCE_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    SOURCE_MANIFEST.write_text(json.dumps(m, indent=2) + "\n")


def fetch(url: str, filename: str | None = None, *, expected_sha256: str | None = None,
          licence: str | None = None, note: str | None = None) -> Path:
    """Ensure `url` is present in sources/raw; return the local path."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    filename = filename or url.rstrip("/").split("/")[-1].split("?")[0]
    dest = RAW_DIR / filename
    manifest = load_manifest()
    entry = manifest["files"].get(filename)

    if not dest.exists():
        print(f"[fetch] downloading {url}", file=sys.stderr)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with requests.get(url, stream=True, timeout=120, headers={"User-Agent": USER_AGENT}) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        tmp.rename(dest)
        downloaded = dt.date.today().isoformat()
    else:
        downloaded = entry["downloaded"] if entry else dt.date.today().isoformat()

    digest = sha256_file(dest)
    if expected_sha256 and digest != expected_sha256:
        raise RuntimeError(f"{filename}: sha256 {digest} != expected {expected_sha256}")
    if entry and entry.get("sha256") and entry["sha256"] != digest:
        print(f"[fetch] WARNING {filename}: sha256 changed since manifest was recorded "
              f"({entry['sha256']} -> {digest})", file=sys.stderr)
        downloaded = dt.date.today().isoformat()

    new_entry = {
        "url": url,
        "sha256": digest,
        "bytes": dest.stat().st_size,
        "downloaded": downloaded,
    }
    if licence:
        new_entry["licence"] = licence
    if note:
        new_entry["note"] = note
    if entry != new_entry:
        manifest["files"][filename] = new_entry
        save_manifest(manifest)
    return dest


if __name__ == "__main__":  # python -m beneath_pipeline.fetch URL [FILENAME]
    print(fetch(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))

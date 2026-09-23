"""Filesystem locations used by the pipeline."""
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = PIPELINE_DIR / "configs"
SOURCES_DIR = PIPELINE_DIR / "sources"
RAW_DIR = SOURCES_DIR / "raw"
OUT_DIR = PIPELINE_DIR / "out"
SOURCE_MANIFEST = SOURCES_DIR / "manifest.json"

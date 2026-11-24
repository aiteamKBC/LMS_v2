"""Local source-file capability used by presentation reads."""
from pathlib import Path


def source_exists(path):
    return path is not None and Path(path).is_file()

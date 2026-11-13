"""Where Lumen keeps its files, per operating system."""

from __future__ import annotations

import glob
import json
import os
import sys

APP = "Lumen"


def data_dir() -> str:
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    elif sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    path = os.environ.get("LUMEN_DATA_DIR") or os.path.join(base, APP)
    os.makedirs(path, exist_ok=True)
    return path


def default_collection() -> str:
    return os.path.join(data_dir(), "collection", "collection.anki2")


def inbox_dir() -> str:
    """Where other apps leave cards for Lumen (see docs/inbox.md)."""
    path = os.path.join(data_dir(), "inbox")
    os.makedirs(path, exist_ok=True)
    return path


def settings_file() -> str:
    return os.path.join(data_dir(), "settings.json")


def load_settings() -> dict:
    try:
        with open(settings_file(), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> None:
    tmp = settings_file() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, settings_file())


def anki_base() -> str:
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/Anki2")
    if sys.platform.startswith("win"):
        return os.path.join(os.environ.get("APPDATA", ""), "Anki2")
    return os.path.expanduser("~/.local/share/Anki2")


def find_anki_collections() -> list[dict]:
    """Collections created by the regular Anki app, one per profile."""
    out = []
    for path in sorted(glob.glob(os.path.join(anki_base(), "*", "collection.anki2"))):
        out.append({"profile": os.path.basename(os.path.dirname(path)), "path": path})
    return out

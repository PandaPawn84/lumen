"""Lumen's inbox: a folder where other apps on this computer leave cards.

An app writes a small JSON file into the inbox folder. Lumen picks it up at
launch and every few seconds while it runs, makes (or updates, or deletes)
the note, removes the file, and writes a receipt the app can read back.
Lumen stays the only program that touches the collection.

The file format is described in docs/inbox.md.
"""

from __future__ import annotations

import glob
import json
import os
import re
import threading
import time
import traceback

from . import __version__, paths
from .engine import EngineError

FORMAT = 1
MAX_BYTES = 512 * 1024
SCAN_SECONDS = 3
SOURCE_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}")
MARKER = "lumen.json"


class BadMessage(Exception):
    """The file isn't a valid inbox message."""


def _text(value, limit: int, what: str, required: bool = True) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str) or (required and not value.strip()):
        raise BadMessage(f"{what} is missing.")
    if len(value) > limit:
        raise BadMessage(f"{what} is too long.")
    return value


def validate(raw) -> dict:
    """Check a message and return a tidy copy. Raises BadMessage."""
    if not isinstance(raw, dict) or raw.get("lumen_inbox") != FORMAT:
        raise BadMessage(f'Not a Lumen inbox message (expected "lumen_inbox": {FORMAT}).')
    source = _text(raw.get("source"), 32, "source")
    if not SOURCE_RE.fullmatch(source):
        raise BadMessage("source must be lowercase letters, digits, - or _.")
    msg = {
        "source": source,
        "id": _text(raw.get("id"), 128, "id"),
        "op": raw.get("op", "upsert"),
        "rev": _text(raw.get("rev"), 64, "rev", required=False),
    }
    if msg["op"] not in ("upsert", "delete"):
        raise BadMessage('op must be "upsert" or "delete".')
    hint = raw.get("note_id")
    msg["note_id"] = int(hint) if isinstance(hint, int) and hint > 0 else None
    if msg["op"] == "delete":
        return msg

    nt = raw.get("notetype")
    if not isinstance(nt, dict):
        raise BadMessage("notetype is missing.")
    names = nt.get("fields")
    if not isinstance(names, list) or not 1 <= len(names) <= 20:
        raise BadMessage("notetype.fields must list 1 to 20 field names.")
    names = [_text(n, 60, "A field name").strip() for n in names]
    if len(set(names)) != len(names):
        raise BadMessage("Field names must be different from each other.")
    kind = nt.get("kind", "basic")
    if kind not in ("basic", "cloze"):
        raise BadMessage('notetype.kind must be "basic" or "cloze".')
    msg["notetype"] = {
        "name": _text(nt.get("name"), 100, "notetype.name").strip(),
        "kind": kind,
        "fields": names,
        "front": _text(nt.get("front"), 20000, "notetype.front"),
        "back": _text(nt.get("back"), 20000, "notetype.back"),
        "css": _text(nt.get("css"), 20000, "notetype.css", required=False),
    }
    fields = raw.get("fields")
    if not isinstance(fields, dict) or not fields:
        raise BadMessage("fields is missing.")
    msg["fields"] = {str(k): _text(v, 100000, f"Field {k}", required=False) for k, v in fields.items()}
    msg["deck"] = _text(raw.get("deck"), 200, "deck", required=False).strip() or "Inbox"
    tags = raw.get("tags") or []
    if not isinstance(tags, list) or len(tags) > 50:
        raise BadMessage("tags must be a short list.")
    msg["tags"] = [_text(t, 100, "A tag") for t in tags]
    return msg


def _read_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path: str, data) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


class Inbox:
    def __init__(self, app) -> None:
        self.app = app
        self.dir = paths.inbox_dir()
        self.receipts_dir = os.path.join(self.dir, "receipts")
        self.rejected_dir = os.path.join(self.dir, "rejected")
        self.state_path = os.path.join(paths.data_dir(), "inbox-state.json")
        self.lock = threading.Lock()
        self.attempts: dict[str, int] = {}
        self.news: list[dict] = []  # what arrived, for the interface to announce
        self.seq = 0
        self._marker_at = 0.0

    # ---- settings ----
    def enabled(self) -> bool:
        return bool(self.app.settings.get("inbox", True))

    def set_enabled(self, on: bool) -> None:
        self.app.settings["inbox"] = bool(on)
        paths.save_settings(self.app.settings)
        self._write_marker(force=True)

    def info(self) -> dict:
        state = _read_json(self.state_path, {})
        path = self.app.engine.path if self.app.engine else ""
        sources = {s: sum(1 for n in ids.values() if n) for s, ids in state.get(path, {}).items()}
        return {"enabled": self.enabled(), "folder": self.dir, "sources": sources}

    def news_since(self, seq: int) -> dict:
        with self.lock:
            items = [n for n in self.news if n["seq"] > seq]
        added: dict[str, int] = {}
        for n in items:
            if n["status"] == "added":  # only new cards are announced
                added[n["source"]] = added.get(n["source"], 0) + 1
        return {"seq": self.seq, "added": added, "changed": bool(items)}

    # ---- running ----
    def start(self) -> None:
        os.makedirs(self.receipts_dir, exist_ok=True)
        self._write_marker(force=True)
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while True:
            try:
                self.scan()
                self._write_marker()
            except Exception:  # the watcher must never die
                traceback.print_exc()
            time.sleep(SCAN_SECONDS)

    def _write_marker(self, force: bool = False) -> None:
        """Tells other apps this Lumen has an inbox, and that it's alive."""
        now = time.time()
        if not force and now - self._marker_at < 10:
            return
        self._marker_at = now
        try:
            _write_json(
                os.path.join(self.dir, MARKER),
                {"lumen_inbox": FORMAT, "lumen": __version__, "enabled": self.enabled(), "checked": int(now)},
            )
        except OSError:
            pass

    def scan(self) -> int:
        """Handle every waiting message. Returns how many were handled."""
        engine = self.app.engine
        if not self.enabled() or engine is None:
            return 0
        files = sorted(
            f for f in glob.glob(os.path.join(self.dir, "*.json")) if os.path.basename(f) != MARKER
        )
        if not files:
            return 0
        done = 0
        with self.lock:
            state = _read_json(self.state_path, {})
            known = state.setdefault(engine.path, {})
            receipts: dict[str, dict] = {}
            for path in files:
                if self._handle(path, engine, known, receipts):
                    done += 1
            _write_json(self.state_path, state)
            for source, items in receipts.items():
                rpath = os.path.join(self.receipts_dir, source + ".json")
                data = _read_json(rpath, {})
                data.setdefault("items", {}).update(items)
                data.update({"lumen_inbox": FORMAT, "lumen": __version__, "updated": int(time.time())})
                _write_json(rpath, data)
        return done

    def _handle(self, path: str, engine, known: dict, receipts: dict) -> bool:
        name = os.path.basename(path)
        try:
            if os.path.getsize(path) > MAX_BYTES:
                raise BadMessage("The file is too large.")
            with open(path, encoding="utf-8") as f:
                msg = validate(json.load(f))
        except (BadMessage, ValueError, UnicodeDecodeError) as e:
            self._reject(path, str(e))
            return True
        except OSError:
            return False  # still being written; next time

        ids = known.setdefault(msg["source"], {})
        note_id = ids.get(msg["id"])
        receipt = {"rev": msg["rev"], "at": int(time.time())}
        try:
            if note_id == 0 and msg["op"] == "upsert":
                status = "gone"  # deleted inside Lumen: don't bring it back
            else:
                status, note_id = engine.inbox_apply(msg, note_id)
        except EngineError as e:
            status, receipt["error"] = "error", str(e)
        except Exception as e:
            # e.g. the collection was being switched: try again, but not forever
            self.attempts[name] = self.attempts.get(name, 0) + 1
            if self.attempts[name] < 3:
                return False
            traceback.print_exc()
            status, receipt["error"] = "error", f"Lumen couldn't add this: {e}"
        self.attempts.pop(name, None)

        if status in ("added", "updated"):
            ids[msg["id"]] = note_id
            receipt["note_id"] = note_id
        elif status == "gone":
            ids[msg["id"]] = 0
        elif status == "deleted":
            ids.pop(msg["id"], None)
        receipt["status"] = status
        receipts.setdefault(msg["source"], {})[msg["id"]] = receipt
        if status in ("added", "updated", "deleted"):
            self.seq += 1
            self.news.append({"seq": self.seq, "source": msg["source"], "status": status})
            del self.news[:-200]
        try:
            os.remove(path)
        except OSError:
            pass
        return True

    def _reject(self, path: str, reason: str) -> None:
        os.makedirs(self.rejected_dir, exist_ok=True)
        dest = os.path.join(self.rejected_dir, os.path.basename(path))
        try:
            os.replace(path, dest)
            with open(dest + ".why.txt", "w", encoding="utf-8") as f:
                f.write(reason + "\n")
        except OSError:
            pass

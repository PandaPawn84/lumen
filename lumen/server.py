"""A tiny local HTTP server: serves the interface and a JSON API.

It listens on 127.0.0.1 only, and every /api request must carry a random
per-launch token, so other websites in your browser can't talk to it.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from . import paths
from .engine import Engine, EngineError

WEB_DIR = os.path.join(os.path.dirname(__file__), "web")
MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB


class App:
    """Holds the open collection and can switch to another one."""

    def __init__(self, collection_path: str | None = None) -> None:
        self.token = secrets.token_urlsafe(24)
        self.settings = paths.load_settings()
        self.engine: Engine | None = None
        self.open_error = ""
        path = collection_path or self.settings.get("collection") or paths.default_collection()
        self.open(path, remember=collection_path is None)

    def open(self, path: str, remember: bool = True) -> None:
        if self.engine:
            self.engine.close()
            self.engine = None
        try:
            self.engine = Engine(path)
            self.open_error = ""
            if remember:
                self.settings["collection"] = path
                paths.save_settings(self.settings)
        except EngineError as e:
            self.open_error = str(e)

    def need(self) -> Engine:
        if not self.engine:
            raise EngineError(self.open_error or "No collection is open.")
        return self.engine


def _routes(app: App) -> list[tuple[str, str, Callable[..., Any]]]:
    e = app.need

    def boot(_q, _b):
        info = {
            "ok": app.engine is not None,
            "error": app.open_error,
            "anki_collections": paths.find_anki_collections(),
            "default_path": paths.default_collection(),
            "theme": app.settings.get("theme", "system"),
        }
        if app.engine:
            info["path"] = app.engine.path
            info["empty"] = app.engine.col.card_count() == 0
            info["onboarded"] = bool(app.settings.get("onboarded"))
        return info

    def switch(_q, b):
        app.open(b["path"])
        if app.open_error:
            raise EngineError(app.open_error)
        app.settings["onboarded"] = True
        paths.save_settings(app.settings)
        return boot(None, None)

    def copy_in(_q, b):
        """Copy an existing Anki collection (and its media) into Lumen's folder."""
        src = b["path"]
        if not os.path.isfile(src):
            raise EngineError("That collection file wasn't found.")
        dest_dir = os.path.join(paths.data_dir(), "collection")
        if app.engine and os.path.dirname(app.engine.path) == dest_dir:
            app.engine.close()
            app.engine = None
        backup = dest_dir + ".before-import"
        if os.path.isdir(dest_dir):
            shutil.rmtree(backup, ignore_errors=True)
            os.replace(dest_dir, backup)
        os.makedirs(dest_dir)
        try:
            dest = os.path.join(dest_dir, "collection.anki2")
            # SQLite's backup API gives a consistent copy, even with a -wal file.
            with sqlite3.connect(f"file:{src}?mode=ro", uri=True) as s, sqlite3.connect(dest) as d:
                s.backup(d)
            media = os.path.join(os.path.dirname(src), "collection.media")
            if os.path.isdir(media):
                shutil.copytree(media, os.path.join(dest_dir, "collection.media"))
        except sqlite3.Error as e:
            raise EngineError(
                f"Couldn't copy the collection. Quit Anki first, then try again. ({e})"
            ) from e
        return switch(None, {"path": dest})

    def prefs(_q, b):
        for key in ("theme", "onboarded"):
            if key in b:
                app.settings[key] = b[key]
        paths.save_settings(app.settings)
        return {"ok": True}

    def num(v):
        return int(v) if v not in (None, "", "null") else None

    return [
        ("GET", r"/api/boot", boot),
        ("POST", r"/api/collection/open", switch),
        ("POST", r"/api/collection/copy", copy_in),
        ("POST", r"/api/prefs", prefs),
        ("GET", r"/api/home", lambda q, b: e().home()),
        # studying
        ("POST", r"/api/study/start", lambda q, b: e().study_start(num(b.get("deck_id")))),
        ("GET", r"/api/study/current", lambda q, b: e().study_current()),
        ("POST", r"/api/study/reveal", lambda q, b: e().study_reveal(int(b["card_id"]), b.get("typed", ""))),
        ("POST", r"/api/study/answer", lambda q, b: e().study_answer(int(b["card_id"]), int(b["rating"]))),
        ("POST", r"/api/study/action", lambda q, b: e().study_action(int(b["card_id"]), b["action"])),
        ("POST", r"/api/undo", lambda q, b: e().undo()),
        ("GET", r"/api/undo", lambda q, b: {"label": e().undo_label()}),
        # adding & editing
        ("GET", r"/api/notetypes", lambda q, b: e().notetypes()),
        ("GET", r"/api/decks/choices", lambda q, b: e().deck_choices()),
        ("GET", r"/api/add/defaults", lambda q, b: e().defaults_for_add()),
        ("POST", r"/api/notes", lambda q, b: e().add_note(int(b["notetype_id"]), int(b["deck_id"]), b["fields"], b.get("tags", []))),
        ("POST", r"/api/notes/duplicate", lambda q, b: {"duplicate": e().check_duplicate(int(b["notetype_id"]), b["fields"])}),
        ("GET", r"/api/notes/(\d+)", lambda q, b, nid: e().note_detail(int(nid))),
        ("POST", r"/api/notes/(\d+)", lambda q, b, nid: e().update_note(int(nid), b["fields"], b.get("tags", []), num(b.get("deck_id")))),
        # library
        ("GET", r"/api/library", lambda q, b: e().library(q.get("q", ""), q.get("filter", "all"), num(q.get("deck")), int(q.get("limit", 200)))),
        ("POST", r"/api/cards/action", lambda q, b: e().cards_action(b["card_ids"], b["action"], b.get("value"))),
        ("GET", r"/api/cards/(\d+)/preview", lambda q, b, cid: e().preview_card(int(cid))),
        # decks
        ("POST", r"/api/decks", lambda q, b: e().create_deck(b["name"])),
        ("GET", r"/api/decks/(\d+)", lambda q, b, did: e().deck_detail(int(did))),
        ("POST", r"/api/decks/(\d+)/rename", lambda q, b, did: e().rename_deck(int(did), b["name"])),
        ("POST", r"/api/decks/(\d+)/delete", lambda q, b, did: e().delete_deck(int(did))),
        ("POST", r"/api/decks/(\d+)/settings", lambda q, b, did: e().save_settings(int(did), b["settings"], bool(b.get("separate")))),
        ("POST", r"/api/sample", lambda q, b: e().add_sample_deck()),
        # stats & settings
        ("GET", r"/api/stats", lambda q, b: e().stats(num(q.get("deck")), int(q.get("days", 30)))),
        ("GET", r"/api/settings", lambda q, b: e().app_settings()),
        ("POST", r"/api/settings", lambda q, b: e().save_app_settings(b)),
        ("GET", r"/api/sync", lambda q, b: e().sync_status()),
    ]


def make_handler(app: App):
    routes = [(m, re.compile(p + "$"), fn) for m, p, fn in _routes(app)]

    class Handler(BaseHTTPRequestHandler):
        server_version = "Lumen"

        def log_message(self, fmt, *args):  # keep the console quiet
            pass

        # ---- helpers ----
        def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, data: Any) -> None:
            self._send(code, json.dumps(data).encode(), "application/json")

        def _file(self, path: str, ctype: str | None = None) -> None:
            if not os.path.isfile(path):
                return self._send(404, b"not found", "text/plain")
            with open(path, "rb") as f:
                data = f.read()
            ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
            self._send(200, data, ctype)

        # ---- routing ----
        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def _dispatch(self, method: str) -> None:
            url = urllib.parse.urlsplit(self.path)
            path = urllib.parse.unquote(url.path)

            if method == "GET" and path in ("/", "/index.html"):
                with open(os.path.join(WEB_DIR, "index.html"), encoding="utf-8") as f:
                    page = f.read().replace("__LUMEN_TOKEN__", app.token)
                return self._send(200, page.encode(), "text/html; charset=utf-8")

            if method == "GET" and path.startswith("/static/"):
                return self._static(path[len("/static/") :])

            if method == "GET" and path.startswith("/media/"):
                return self._media(path[len("/media/") :])

            if not path.startswith("/api/"):
                return self._send(404, b"not found", "text/plain")

            if not secrets.compare_digest(self.headers.get("X-Lumen-Token", ""), app.token):
                return self._json(403, {"error": "forbidden"})

            if method == "POST" and path == "/api/import":
                return self._import()

            query = dict(urllib.parse.parse_qsl(url.query))
            body: dict = {}
            if method == "POST":
                n = int(self.headers.get("Content-Length") or 0)
                if n:
                    try:
                        body = json.loads(self.rfile.read(n))
                    except json.JSONDecodeError:
                        return self._json(400, {"error": "Bad request."})

            for m, rx, fn in routes:
                if m != method:
                    continue
                match = rx.match(path)
                if match:
                    try:
                        return self._json(200, fn(query, body, *match.groups()))
                    except EngineError as e:
                        return self._json(400, {"error": str(e)})
                    except KeyError as e:
                        return self._json(400, {"error": f"Missing value: {e}"})
                    except Exception as e:
                        traceback.print_exc()
                        return self._json(500, {"error": f"Something went wrong: {e}"})
            return self._json(404, {"error": "Unknown request."})

        def _static(self, rel: str) -> None:
            full = os.path.realpath(os.path.join(WEB_DIR, rel))
            if not full.startswith(os.path.realpath(WEB_DIR) + os.sep):
                return self._send(404, b"not found", "text/plain")
            ctype = "text/javascript" if full.endswith((".js", ".mjs")) else None
            self._file(full, ctype)

        def _media(self, name: str) -> None:
            # Card media (images, audio). Only plain files inside the media folder.
            if not app.engine or "/" in name or "\\" in name or name.startswith("."):
                return self._send(404, b"not found", "text/plain")
            base = os.path.realpath(app.engine.media_dir())
            full = os.path.realpath(os.path.join(base, name))
            if os.path.dirname(full) != base:
                return self._send(404, b"not found", "text/plain")
            self._file(full)

        def _import(self) -> None:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_UPLOAD:
                return self._json(400, {"error": "That file is empty or too large."})
            name = urllib.parse.unquote(self.headers.get("X-Filename", "deck.apkg"))
            data = self.rfile.read(n)
            try:
                self._json(200, app.need().import_package(data, name))
            except EngineError as e:
                self._json(400, {"error": str(e)})

    return Handler


def start(app: App, port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"

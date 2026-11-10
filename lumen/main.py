"""Start Lumen.

    python -m lumen              open in a native window (macOS: WebKit)
    python -m lumen --browser    open in your web browser instead
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import webbrowser

from . import __version__, paths
from .server import App, start


def main() -> None:
    parser = argparse.ArgumentParser(prog="lumen", description="Lumen flashcards")
    parser.add_argument("--browser", action="store_true", help="open in your web browser")
    parser.add_argument("--collection", help="path to a collection.anki2 file to open")
    parser.add_argument("--port", type=int, default=0, help="port for the local server")
    parser.add_argument("--no-open", action="store_true", help="start the server only")
    parser.add_argument("--version", action="version", version=f"Lumen {__version__}")
    # Finder can pass extra arguments (e.g. -psn_...) to apps; ignore them.
    args, _unknown = parser.parse_known_args()

    app = App(args.collection)
    server, url = start(app, args.port)

    if args.browser or args.no_open:
        print(f"Lumen is running at {url}  (press Ctrl+C to quit)")
        if not args.no_open:
            webbrowser.open(url)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
    else:
        try:
            import webview
        except ImportError:
            print("pywebview isn't installed; opening in your browser instead.", file=sys.stderr)
            webbrowser.open(url)
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                pass
        else:
            webview.create_window(
                "Lumen",
                url,
                width=1180,
                height=780,
                min_size=(860, 560),
                background_color="#f6f5f2",
                text_select=True,
            )
            # keep small interface preferences (like expanded decks) between launches
            webview.start(private_mode=False, storage_path=os.path.join(paths.data_dir(), "webview"))

    server.shutdown()
    if app.engine:
        app.engine.close()


if __name__ == "__main__":
    main()

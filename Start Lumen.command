#!/bin/bash
# Double-click to start Lumen on macOS.
# First launch sets up a private Python environment (about a minute); later launches are quick.
set -e
cd "$(dirname "$0")"

find_python() {
  for p in python3.13 python3.12 python3.11 python3.10 python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      echo "$p"; return 0
    fi
  done
  return 1
}

if [ ! -x .venv/bin/python ]; then
  PY=$(find_python) || {
    osascript -e 'display dialog "Lumen needs Python 3.10 or newer.\n\nInstall it from python.org (Downloads → macOS), then double-click Start Lumen again." buttons {"Open python.org", "OK"} default button 1 with title "Lumen"' -e 'if button returned of result is "Open python.org" then open location "https://www.python.org/downloads/macos/"' >/dev/null 2>&1 || true
    echo "Lumen needs Python 3.10 or newer: https://www.python.org/downloads/macos/"
    exit 1
  }
  echo "Setting up Lumen (first launch only)…"
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet -r requirements.txt
fi

exec .venv/bin/python -m lumen "$@"

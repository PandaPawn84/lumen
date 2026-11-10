#!/bin/bash
# Start Lumen on Linux (or macOS from a terminal). Add --browser to use your web browser.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  PY=${PYTHON:-python3}
  "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Lumen needs Python 3.10 or newer."; exit 1; }
  echo "Setting up Lumen (first launch only)…"
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet -r requirements.txt
fi
exec .venv/bin/python -m lumen "$@"

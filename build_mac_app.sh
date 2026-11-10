#!/bin/bash
# Build a stand-alone Lumen.app (run this on a Mac).
# Result: dist/Lumen.app — drag it to Applications. Not code-signed: the first
# time, right-click the app → Open (or allow it in System Settings → Privacy & Security).
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || ./"Start Lumen.command" --version
.venv/bin/python -m pip install --quiet "pyinstaller>=6.10"

# App icon from assets/icon.png
rm -rf build/Lumen.iconset && mkdir -p build/Lumen.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s assets/icon.png --out build/Lumen.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) assets/icon.png --out build/Lumen.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns build/Lumen.iconset -o build/Lumen.icns

.venv/bin/pyinstaller --noconfirm --windowed --name Lumen \
  --icon build/Lumen.icns \
  --osx-bundle-identifier app.lumen.flashcards \
  --add-data "lumen/web:lumen/web" \
  --collect-all anki \
  --collect-submodules webview \
  lumen_app.py

/usr/libexec/PlistBuddy -c "Add :NSHighResolutionCapable bool true" dist/Lumen.app/Contents/Info.plist 2>/dev/null || true
echo
echo "Done: dist/Lumen.app"

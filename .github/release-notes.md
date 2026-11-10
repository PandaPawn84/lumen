## Download

| Your Mac | Download |
|---|---|
| Apple Silicon (M1, M2, M3, M4 or newer) | **Lumen-macOS-apple-silicon.zip** |
| Intel | **Lumen-macOS-intel.zip** |

Not sure which you have? Apple menu → **About This Mac** → look for "Chip" (Apple) or "Processor" (Intel).

## Install

1. Download the zip and double-click it to unzip.
2. Drag **Lumen** into your **Applications** folder.
3. Double-click Lumen. macOS will say it can't verify the app, because it isn't signed by Apple.
4. Open **System Settings → Privacy & Security**, scroll down, click **Open Anyway** and confirm. You only need to do this once.

If macOS says the app **"is damaged"**, that's the same block, not real damage. Run this once in Terminal:

```
xattr -dr com.apple.quarantine /Applications/Lumen.app
```

## Before you start

- **Bringing over your Anki cards?** Quit Anki first. Lumen copies your collection, so your Anki stays unchanged.
- This is an early version. Keep a backup of anything important.

## Source code

Lumen is free software under the GNU AGPL v3. The full source is in this repository, and the source archives are attached below. Lumen is built on Anki's open-source engine and isn't affiliated with Anki or Ankitects.

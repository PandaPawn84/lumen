# The inbox: sending cards to Lumen from another app

Lumen has an inbox folder. Any app on the same computer can leave a small JSON file there, and Lumen turns it into a card. Lumen stays the only program that opens the collection, so there is nothing to lock, sync or corrupt.

Lumen reads the inbox when it starts and every few seconds while it runs. Files left while Lumen is closed wait until it next opens.

People can turn the inbox off under **Settings → Cards from other apps**. Files then wait untouched.

## Where it is

| | Inbox folder |
|---|---|
| macOS | `~/Library/Application Support/Lumen/inbox/` |
| Windows | `%APPDATA%\Lumen\inbox\` |
| Linux | `~/.local/share/Lumen/inbox/` (or `$XDG_DATA_HOME/Lumen/inbox/`) |

If `Lumen/` doesn't exist, Lumen has never been opened on this computer.

Lumen keeps a marker file there, `lumen.json`, so you can tell whether this copy of Lumen has an inbox and whether it's running:

```json
{ "lumen_inbox": 1, "lumen": "0.2.0", "enabled": true, "checked": 1794600000 }
```

`checked` is refreshed about every 10 seconds while Lumen is open. No marker means Lumen is older than 0.2; you can still leave files, and they are picked up once Lumen is updated.

## Sending a card

Write one file per note, named anything ending in `.json`. Files are handled in name order, so start names with a timestamp. Write to a temporary name first (for example ending in `.tmp`) and rename it into place, so Lumen never reads half a file.

```json
{
  "lumen_inbox": 1,
  "source": "myapp",
  "id": "note-42",
  "rev": "3",
  "op": "upsert",
  "deck": "Chemistry::Organic",
  "notetype": {
    "name": "MyApp Card",
    "kind": "basic",
    "fields": ["Front", "Back"],
    "front": "{{Front}}",
    "back": "{{FrontSide}}<hr id=\"answer\">{{Back}}",
    "css": ""
  },
  "fields": { "Front": "Ozone cleaves a <b>double bond</b> into…", "Back": "two carbonyls" },
  "tags": ["myapp"]
}
```

| Key | Meaning |
|---|---|
| `lumen_inbox` | Always `1`. |
| `source` | Your app's name: lowercase letters, digits, `-` or `_`, at most 32 characters. |
| `id` | Your own stable id for this note. Send the same `id` again to update the note. |
| `rev` | Optional. Any short string; Lumen echoes it in the receipt so you know which version it handled. |
| `op` | `"upsert"` (add, or update if Lumen has seen this `id`) or `"delete"`. |
| `deck` | Deck name, `::` for sub-decks. Created if missing. Default `Inbox`. Used only when the note is first added. |
| `notetype` | The note type to use, by `name`. If no type with that name exists, Lumen creates it from `kind` (`"basic"` or `"cloze"`), `fields`, `front`, `back` and `css`. If one exists it is used unchanged, so people can restyle your cards. |
| `fields` | Field name → HTML. Names the note type doesn't have are ignored. |
| `tags` | Used only when the note is first added. |
| `note_id` | Optional. If Lumen has no record of this `id` but a note with this Anki note id exists, Lumen adopts it. For apps that made notes some other way before using the inbox. |

For a cloze type, use `{{cloze:Text}}` in the templates and `{{c1::…}}` in the field.

To delete: `{ "lumen_inbox": 1, "source": "myapp", "id": "note-42", "op": "delete" }`.

Limits: 512 KB per file, 20 fields, 50 tags. No media yet.

## Receipts

After handling your files Lumen writes `inbox/receipts/<source>.json`:

```json
{
  "lumen_inbox": 1,
  "lumen": "0.2.0",
  "updated": 1794600012,
  "items": {
    "note-42": { "status": "added", "rev": "3", "note_id": 1794600011223, "at": 1794600012 }
  }
}
```

| `status` | Meaning |
|---|---|
| `added` | A new note was made. |
| `updated` | The existing note's fields were replaced. Its deck, tags and review history are untouched. |
| `deleted` | The note was removed (or was already gone). |
| `gone` | You sent an update, but the person deleted that note in Lumen. Lumen won't bring it back. |
| `error` | Lumen couldn't make the note; `error` says why. |

Files Lumen can't read at all (not JSON, wrong shape, too large) are moved to `inbox/rejected/` with a `.why.txt` beside them.

## Notes

- Lumen remembers which of your ids became which note per collection. If the person switches to a different collection, your next `upsert` adds a new note there.
- An update replaces only the fields you send.
- Card templates run inside Lumen's sealed card frame, like every other card.

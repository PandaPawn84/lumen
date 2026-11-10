"""Lumen's bridge to Anki's engine.

Everything that touches the collection lives here. The rest of the app only
sees plain dicts and lists, so the interface never depends on Anki internals.
All calls are serialised with one lock because the collection is not
thread-safe.
"""

from __future__ import annotations

import html as html_lib
import os
import re
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Any

# anki.collection must be imported first (anki's modules import each other).
from anki.collection import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest
from anki.cards import Card
from anki.consts import (
    QUEUE_TYPE_DAY_LEARN_RELEARN,
    QUEUE_TYPE_LRN,
    QUEUE_TYPE_MANUALLY_BURIED,
    QUEUE_TYPE_NEW,
    QUEUE_TYPE_PREVIEW,
    QUEUE_TYPE_REV,
    QUEUE_TYPE_SIBLING_BURIED,
    QUEUE_TYPE_SUSPENDED,
)
from anki.notes import Note
from anki.scheduler.v3 import CardAnswer
from anki.sound import SoundOrVideoTag

# Friendly names for Anki's built-in note types. Anything else keeps its name.
STOCK_TYPES = {
    "Basic": ("Question & answer", "One card: question on the front, answer on the back."),
    "Basic (and reversed card)": (
        "Both directions",
        "Two cards: you're asked front → back and back → front.",
    ),
    "Basic (optional reversed card)": (
        "Question & answer, optional reverse",
        "Fill in “Add Reverse” to also get the reverse card.",
    ),
    "Basic (type in the answer)": ("Type the answer", "You type your answer and it's checked."),
    "Cloze": ("Fill in the blank", "Hide words with {{c1::word}}; each hidden part becomes a card."),
}
STOCK_FIELDS = {"Front": "Question", "Back": "Answer", "Text": "Text", "Back Extra": "Extra info"}

RATINGS = {1: CardAnswer.AGAIN, 2: CardAnswer.HARD, 3: CardAnswer.GOOD, 4: CardAnswer.EASY}

PLAY_TAG = re.compile(r"\[anki:play:(q|a):(\d+)\]")
TYPE_TAG = re.compile(r"\[\[type:(.+?)\]\]")
TAGS_RE = re.compile(r"<[^>]+>")


LUMEN_CARD_CSS = """.card {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Noto Sans", sans-serif;
    font-size: 24px;
    line-height: 1.5;
    text-align: center;
    color: #23221f;
    background-color: white;
}
.nightMode.card, .nightMode .card { color: #ecebe8; }
.cloze { font-weight: 650; color: #3e49b8; }
.nightMode .cloze { color: #a4abf5; }
"""


class EngineError(Exception):
    """An error with a message that is safe to show to the user."""

    def __init__(self, message: str) -> None:
        super().__init__(clean(message))


BIDI = dict.fromkeys(map(ord, "\u2068\u2069\u2066\u2067"), None)
CLOZE_RE = re.compile(r"\{\{c\d+::(.*?)(?:::[^}]*)?\}\}", re.S)


def clean(text: str) -> str:
    """Remove the invisible direction marks Anki adds around numbers."""
    return (text or "").translate(BIDI)


def plain(text: str, limit: int = 160) -> str:
    text = CLOZE_RE.sub(r"\1", text or "")
    text = re.sub(r"<(br|div|p)[^>]*>", " ", text or "", flags=re.I)
    text = html_lib.unescape(TAGS_RE.sub("", text))
    text = re.sub(r"\[sound:[^\]]+\]", "🔈", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def card_state(queue: int, ctype: int) -> str:
    if queue == QUEUE_TYPE_SUSPENDED:
        return "suspended"
    if queue in (QUEUE_TYPE_SIBLING_BURIED, QUEUE_TYPE_MANUALLY_BURIED):
        return "buried"
    if queue == QUEUE_TYPE_NEW:
        return "new"
    if queue in (QUEUE_TYPE_LRN, QUEUE_TYPE_DAY_LEARN_RELEARN, QUEUE_TYPE_PREVIEW):
        return "learning"
    return "review"


@dataclass
class StudySession:
    deck_ids: list[int]
    index: int = 0
    card: Card | None = None
    queued: Any = None
    studied: int = 0
    started: float = field(default_factory=time.time)
    total_at_start: int = 0
    typed: str = ""


class Engine:
    def __init__(self, path: str) -> None:
        self.path = path
        self.lock = threading.RLock()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fresh = not os.path.exists(path)
        try:
            self.col = Collection(path)
        except Exception as e:  # most often: Anki has the file open
            raise EngineError(
                "Couldn't open the collection. If Anki is running with this "
                f"collection open, quit Anki and try again. ({e})"
            ) from e
        self.session: StudySession | None = None
        if fresh:
            self._modernise_stock_styles()

    def _modernise_stock_styles(self) -> None:
        """New collections only: swap Anki's 20px Arial card style for a cleaner one."""
        for nt in self.col.models.all():
            css = nt.get("css", "")
            # only the five plain stock types (Image Occlusion has its own layout rules)
            if nt["name"] in STOCK_TYPES and "font-family: arial" in css:
                nt["css"] = LUMEN_CARD_CSS
                self.col.models.update_dict(nt)

    def close(self) -> None:
        with self.lock:
            self.col.close()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def media_dir(self) -> str:
        return self.col.media.dir()

    def _deck_name(self, did: int) -> str:
        return self.col.decks.name(did)

    def _tree_node(self, node) -> dict:
        return {
            "id": node.deck_id,
            "name": node.name,
            "full_name": self._deck_name(node.deck_id),
            "level": node.level,
            "collapsed": node.collapsed,
            "filtered": node.filtered,
            "new": node.new_count,
            "learn": node.learn_count,
            "review": node.review_count,
            "due": node.new_count + node.learn_count + node.review_count,
            "total": node.total_including_children,
            "children": [self._tree_node(c) for c in node.children],
        }

    def _deck_tree(self) -> list[dict]:
        root = self.col.sched.deck_due_tree()
        decks = [self._tree_node(c) for c in root.children]
        # Hide the empty built-in "Default" deck, like Anki does.
        return [d for d in decks if not (d["id"] == 1 and d["total"] == 0 and not d["children"])]

    def _day_start_ms(self, days_ago: int = 0) -> int:
        return (self.col.sched.day_cutoff - 86400 * (days_ago + 1)) * 1000

    # ------------------------------------------------------------------
    # Home
    # ------------------------------------------------------------------

    def home(self) -> dict:
        with self.lock:
            decks = self._deck_tree()
            due = sum(d["review"] for d in decks)
            new = sum(d["new"] for d in decks)
            learn = sum(d["learn"] for d in decks)
            today_ms = self._day_start_ms(0)
            reviewed, secs = self.col.db.first(
                "select count(), coalesce(sum(time), 0) / 1000.0 from revlog where id > ? and ease > 0 and type < 4",
                today_ms,
            )
            avg = self.col.db.scalar(
                "select avg(time) / 1000.0 from (select time from revlog where ease > 0 and type < 4 order by id desc limit 300)"
            )
            avg = min(max(avg or 8.0, 3.0), 40.0)
            total = due + new + learn
            return {
                "decks": decks,
                "due": due,
                "new": new,
                "learn": learn,
                "total": total,
                "minutes": round(total * avg / 60) if total else 0,
                "studied_today": reviewed or 0,
                "seconds_today": round(secs or 0),
                "streak": self._streak(),
                "forecast": self._forecast(7),
                "card_count": self.col.card_count(),
                "note_count": self.col.note_count(),
            }

    def _streak(self) -> int:
        cutoff = self.col.sched.day_cutoff
        rows = self.col.db.list(
            "select distinct (? - id / 1000) / 86400 from revlog where id > ? and ease > 0 and type < 4",
            cutoff,
            (cutoff - 86400 * 400) * 1000,
        )
        days = set(rows)
        streak, day = 0, 0
        if 0 not in days:  # nothing yet today: streak continues from yesterday
            day = 1
        while day in days:
            streak += 1
            day += 1
        return streak

    def _forecast(self, days: int) -> list[int]:
        today = self.col.sched.today
        out = [0] * days
        rows = self.col.db.all(
            f"select due, count() from cards where queue in ({QUEUE_TYPE_REV}, {QUEUE_TYPE_DAY_LEARN_RELEARN}) "
            "and due < ? group by due",
            today + days,
        )
        for due, n in rows:
            out[max(0, due - today)] += n
        return out

    # ------------------------------------------------------------------
    # Studying
    # ------------------------------------------------------------------

    def study_start(self, deck_id: int | None) -> dict:
        with self.lock:
            if deck_id:
                deck_ids = [int(deck_id)]
            else:
                deck_ids = [d["id"] for d in self._deck_tree() if d["due"] > 0]
            if not deck_ids:
                return {"done": True, "studied": 0, "seconds": 0, "nothing_due": True}
            self.session = StudySession(deck_ids=deck_ids)
            self.session.total_at_start = self._remaining_all()
            return self._next()

    def _remaining_all(self) -> int:
        s = self.session
        total = 0
        for did in s.deck_ids[s.index :]:
            node = self.col.sched.deck_due_tree(did)
            if node:
                total += node.new_count + node.learn_count + node.review_count
        return total

    def _next(self) -> dict:
        s = self.session
        if not s:
            return {"done": True, "studied": 0, "seconds": 0}
        while s.index < len(s.deck_ids):
            self.col.decks.select(s.deck_ids[s.index])
            queued = self.col.sched.get_queued_cards()
            if queued.cards:
                qc = queued.cards[0]
                card = Card(self.col)
                card._load_from_backend_card(qc.card)
                card.start_timer()
                s.card, s.queued = card, qc
                return self._card_payload(card, qc, queued)
            s.index += 1
        s.card = None
        return {
            "done": True,
            "studied": s.studied,
            "seconds": round(time.time() - s.started),
            "tomorrow": self._forecast(2)[1],
        }

    def _render(self, card: Card, side: str, typed: str | None = None) -> tuple[str, list[dict]]:
        out = card.render_output(reload=True)
        text = out.question_text if side == "q" else out.answer_text
        tags = out.question_av_tags if side == "q" else out.answer_av_tags
        audio = []
        for t in tags:
            audio.append({"file": t.filename} if isinstance(t, SoundOrVideoTag) else {"tts": True})

        def play(m: re.Match) -> str:
            i = int(m.group(2))
            if i < len(audio) and "file" in audio[i]:
                return f'<button class="lumen-play" data-file="{html_lib.escape(audio[i]["file"])}">▶</button>'
            return ""

        text = PLAY_TAG.sub(play, text)
        text = self._type_answer(card, text, side, typed)
        return text, [a for a in audio if "file" in a]

    def _type_answer(self, card: Card, text: str, side: str, typed: str | None) -> str:
        m = TYPE_TAG.search(text)
        if not m:
            return text
        if side == "q":
            return TYPE_TAG.sub('<div class="lumen-type-slot"></div>', text, count=1)
        name = m.group(1).split(":")[-1]
        note = card.note()
        expected = ""
        if name in note:
            expected = note[name]
            if "cloze:" in m.group(1):
                expected = self.col.extract_cloze_for_typing(expected, card.ord + 1)
        expected = html_lib.unescape(TAGS_RE.sub("", expected))
        compared = self.col.compare_answer(expected, typed or "")
        return TYPE_TAG.sub(f'<div class="lumen-type-result">{compared}</div>', text, count=1)

    def _card_payload(self, card: Card, qc, queued) -> dict:
        s = self.session
        q_html, q_audio = self._render(card, "q")
        labels = self.col.sched.describe_next_states(qc.states)
        note = card.note()
        remaining = queued.new_count + queued.learning_count + queued.review_count
        later = 0
        for did in s.deck_ids[s.index + 1 :]:
            node = self.col.sched.deck_due_tree(did)
            if node:
                later += node.new_count + node.learn_count + node.review_count
        return {
            "done": False,
            "card_id": card.id,
            "note_id": card.nid,
            "deck": self._deck_name(card.did),
            "question": q_html,
            "question_audio": q_audio,
            "css": card.render_output().css,
            "ord": card.ord,
            "has_type": bool(TYPE_TAG.search(card.render_output().question_text)),
            "intervals": [clean(l) for l in labels],
            "kind": ["new", "learning", "review"][min(qc.queue, 2)],
            "counts": {
                "new": queued.new_count,
                "learn": queued.learning_count,
                "review": queued.review_count,
            },
            "remaining": remaining + later,
            "studied": s.studied,
            "flag": card.user_flag(),
            "marked": note.has_tag("marked"),
        }

    def study_reveal(self, card_id: int, typed: str = "") -> dict:
        with self.lock:
            s = self.session
            if not s or not s.card or s.card.id != card_id:
                raise EngineError("That card is no longer being studied.")
            a_html, a_audio = self._render(s.card, "a", typed)
            return {"answer": a_html, "answer_audio": a_audio}

    def study_answer(self, card_id: int, rating: int) -> dict:
        with self.lock:
            s = self.session
            if not s or not s.card or s.card.id != card_id:
                raise EngineError("That card is no longer being studied.")
            answer = self.col.sched.build_answer(
                card=s.card, states=s.queued.states, rating=RATINGS[int(rating)]
            )
            self.col.sched.answer_card(answer)
            s.studied += 1
            return self._next()

    def study_current(self) -> dict:
        with self.lock:
            return self._next()

    def study_action(self, card_id: int, action: str) -> dict:
        """Suspend / bury / flag the current card, then move on."""
        with self.lock:
            s = self.session
            if not s or not s.card or s.card.id != card_id:
                raise EngineError("That card is no longer being studied.")
            if action == "suspend":
                self.col.sched.suspend_cards([card_id])
            elif action == "bury":
                self.col.sched.bury_cards([card_id])
            elif action == "bury_note":
                self.col.sched.bury_notes([s.card.nid])
            return self._next()

    # ------------------------------------------------------------------
    # Undo
    # ------------------------------------------------------------------

    def undo_label(self) -> str:
        with self.lock:
            return self.col.undo_status().undo or ""

    def undo(self) -> dict:
        with self.lock:
            label = self.col.undo_status().undo
            if not label:
                return {"undone": ""}
            self.col.undo()
            out: dict = {"undone": label}
            if self.session:
                if self.session.studied:
                    self.session.studied -= 1
                # the undone card goes back to the front of its deck's queue
                self.session.index = 0
                out["next"] = self._next()
            return out

    # ------------------------------------------------------------------
    # Note types and adding
    # ------------------------------------------------------------------

    def notetypes(self) -> list[dict]:
        with self.lock:
            out = []
            for nt in self.col.models.all():
                if nt.get("originalStockKind") == 6 or nt["name"].startswith("Image Occlusion"):
                    continue  # needs a dedicated editor; not supported yet
                friendly, desc = STOCK_TYPES.get(nt["name"], (nt["name"], ""))
                out.append(
                    {
                        "id": nt["id"],
                        "name": nt["name"],
                        "label": friendly,
                        "description": desc,
                        "is_cloze": nt["type"] == 1,
                        "fields": [
                            {"name": f["name"], "label": STOCK_FIELDS.get(f["name"], f["name"])}
                            for f in nt["flds"]
                        ],
                        "uses": self.col.models.use_count(nt),
                    }
                )
            order = list(STOCK_TYPES)
            out.sort(key=lambda n: (order.index(n["name"]) if n["name"] in order else 99, -n["uses"]))
            return out

    def deck_choices(self) -> list[dict]:
        with self.lock:
            out = []
            for d in self.col.decks.all_names_and_ids(include_filtered=False, skip_empty_default=True):
                out.append({"id": d.id, "name": d.name})
            if not out:
                out.append({"id": 1, "name": self.col.decks.name(1)})
            return sorted(out, key=lambda d: d["name"].lower())

    def defaults_for_add(self) -> dict:
        with self.lock:
            return {
                "notetype_id": self.col.get_config("curModel") or None,
                "deck_id": self.col.get_config("curDeck") or 1,
            }

    def _fill_note(self, note: Note, fields: list[str], tags: list[str]) -> None:
        for i, value in enumerate(fields[: len(note.fields)]):
            note.fields[i] = value
        note.tags = [t.strip().replace(" ", "_") for t in tags if t.strip()]

    def add_note(self, notetype_id: int, deck_id: int, fields: list[str], tags: list[str]) -> dict:
        with self.lock:
            nt = self.col.models.get(notetype_id)
            if not nt:
                raise EngineError("That card type no longer exists.")
            note = self.col.new_note(nt)
            self._fill_note(note, fields, tags)
            state = note.fields_check()
            if state == 1:
                raise EngineError("The first field is empty.")
            if state == 3:
                raise EngineError("A fill-in-the-blank card needs at least one {{c1::…}}.")
            self.col.add_note(note, int(deck_id))
            if not note.cards():
                raise EngineError("No cards were made. Check the fields are filled in.")
            self.col.set_config("curModel", notetype_id)
            self.col.set_config("curDeck", int(deck_id))
            return {"note_id": note.id, "cards": len(note.cards()), "duplicate": state == 2}

    def check_duplicate(self, notetype_id: int, fields: list[str]) -> bool:
        with self.lock:
            nt = self.col.models.get(notetype_id)
            if not nt or not fields or not fields[0].strip():
                return False
            note = self.col.new_note(nt)
            self._fill_note(note, fields, [])
            return note.fields_check() == 2

    # ------------------------------------------------------------------
    # Library
    # ------------------------------------------------------------------

    FILTERS = {
        "all": "",
        "due": "is:due",
        "new": "is:new",
        "learning": "is:learn",
        "review": "is:review -is:learn",
        "suspended": "is:suspended",
        "flagged": "-flag:0",
        "added_today": "added:1",
        "difficult": "prop:lapses>3",
    }

    def library(self, text: str, filt: str, deck_id: int | None, limit: int) -> dict:
        with self.lock:
            parts = []
            if text.strip():
                parts.append(text.strip())
            if self.FILTERS.get(filt):
                parts.append(self.FILTERS[filt])
            if deck_id:
                name = self._deck_name(int(deck_id)).replace('"', '\\"')
                parts.append(f'"deck:{name}"')
            query = " ".join(f"({p})" for p in parts)
            try:
                cids = list(self.col.find_cards(query, order="c.id desc"))
            except Exception as e:
                raise EngineError(f"Couldn't understand that search. ({e})") from e
            total = len(cids)
            cids = cids[:limit]
            rows = []
            if cids:
                ids = ",".join(str(int(c)) for c in cids)
                data = self.col.db.all(
                    "select c.id, c.nid, c.did, c.queue, c.type, c.due, c.ivl, c.flags & 7, c.lapses, c.reps,"
                    " n.flds, n.tags, n.mid, c.ord, (select count() from cards c2 where c2.nid = c.nid)"
                    " from cards c join notes n on c.nid = n.id"
                    f" where c.id in ({ids})"
                )
                by_id = {r[0]: r for r in data}
                today = self.col.sched.today
                deck_names: dict[int, str] = {}
                for cid in cids:
                    r = by_id.get(cid)
                    if not r:
                        continue
                    cid, nid, did, queue, ctype, due, ivl, flag, lapses, reps, flds, tags, mid, ord_, ncards = r
                    if did not in deck_names:
                        deck_names[did] = self._deck_name(did)
                    fs = flds.split("\x1f")
                    state = card_state(queue, ctype)
                    due_in = None
                    if queue in (QUEUE_TYPE_REV, QUEUE_TYPE_DAY_LEARN_RELEARN):
                        due_in = due - today
                    rows.append(
                        {
                            "card_id": cid,
                            "note_id": nid,
                            "front": plain(fs[0] if fs else ""),
                            "back": plain(fs[1] if len(fs) > 1 else ""),
                            "deck": deck_names[did],
                            "deck_id": did,
                            "state": state,
                            "due_in": due_in,
                            "interval": ivl,
                            "flag": flag,
                            "lapses": lapses,
                            "reviews": reps,
                            "tags": tags.split(),
                            "card_no": ord_ + 1 if ncards > 1 else None,
                        }
                    )
            return {"total": total, "rows": rows, "query": query}

    def note_detail(self, note_id: int) -> dict:
        with self.lock:
            note = self.col.get_note(note_id)
            nt = note.note_type()
            friendly = STOCK_TYPES.get(nt["name"], (nt["name"], ""))[0]
            cards = []
            for c in note.cards():
                info = self._card_info(c)
                cards.append(info)
            return {
                "note_id": note.id,
                "notetype_id": nt["id"],
                "notetype": friendly,
                "fields": [
                    {
                        "name": f["name"],
                        "label": STOCK_FIELDS.get(f["name"], f["name"]),
                        "value": note.fields[i],
                    }
                    for i, f in enumerate(nt["flds"])
                ],
                "tags": note.tags,
                "cards": cards,
                "deck_id": cards[0]["deck_id"] if cards else None,
            }

    def _card_info(self, c: Card) -> dict:
        state = card_state(c.queue, c.type)
        today = self.col.sched.today
        due_in = c.due - today if c.queue in (QUEUE_TYPE_REV, QUEUE_TYPE_DAY_LEARN_RELEARN) else None
        tmpl = c.template()["name"]
        return {
            "card_id": c.id,
            "template": tmpl,
            "deck_id": c.did,
            "deck": self._deck_name(c.did),
            "state": state,
            "due_in": due_in,
            "interval": c.ivl,
            "reviews": c.reps,
            "lapses": c.lapses,
            "flag": c.user_flag(),
            "added": c.nid // 1000,
        }

    def update_note(self, note_id: int, fields: list[str], tags: list[str], deck_id: int | None) -> dict:
        with self.lock:
            note = self.col.get_note(note_id)
            self._fill_note(note, fields, tags)
            if note.fields_check() == 1:
                raise EngineError("The first field can't be empty.")
            self.col.update_note(note)
            if deck_id:
                cids = [c.id for c in note.cards() if c.did != int(deck_id)]
                if cids:
                    self.col.set_deck(cids, int(deck_id))
            if self.session and self.session.card and self.session.card.nid == note_id:
                self.session.card.load()
            return {"ok": True}

    def cards_action(self, card_ids: list[int], action: str, value: Any = None) -> dict:
        with self.lock:
            ids = [int(c) for c in card_ids]
            if action == "suspend":
                self.col.sched.suspend_cards(ids)
            elif action == "unsuspend":
                self.col.sched.unsuspend_cards(ids)
            elif action == "flag":
                self.col.set_user_flag_for_cards(int(value or 0), ids)
            elif action == "move":
                self.col.set_deck(ids, int(value))
            elif action == "forget":
                self.col.sched.schedule_cards_as_new(ids, restore_position=True, reset_counts=False)
            elif action == "delete":
                nids = list({self.col.get_card(c).nid for c in ids})
                n = self.col.remove_notes(nids).count
                return {"ok": True, "deleted_notes": n}
            else:
                raise EngineError(f"Unknown action {action}")
            return {"ok": True}

    def preview_card(self, card_id: int) -> dict:
        with self.lock:
            c = self.col.get_card(card_id)
            out = c.render_output(reload=True, browser=False)
            q = PLAY_TAG.sub("", out.question_text)
            a = PLAY_TAG.sub("", out.answer_text)
            q = TYPE_TAG.sub("", q)
            a = TYPE_TAG.sub("", a)
            return {"question": q, "answer": a, "css": out.css, "ord": c.ord}

    # ------------------------------------------------------------------
    # Decks
    # ------------------------------------------------------------------

    def create_deck(self, name: str) -> dict:
        with self.lock:
            name = name.strip()
            if not name:
                raise EngineError("Give the deck a name.")
            if self.col.decks.by_name(name):
                raise EngineError("A deck with that name already exists.")
            did = self.col.decks.add_normal_deck_with_name(name).id
            return {"id": did}

    def rename_deck(self, deck_id: int, name: str) -> dict:
        with self.lock:
            name = name.strip()
            if not name:
                raise EngineError("Give the deck a name.")
            try:
                self.col.decks.rename(int(deck_id), name)
            except Exception as e:
                raise EngineError(f"Couldn't rename the deck. ({e})") from e
            return {"ok": True}

    def delete_deck(self, deck_id: int) -> dict:
        with self.lock:
            n = len(self.col.decks.cids(int(deck_id), children=True))
            self.col.decks.remove([int(deck_id)])
            return {"ok": True, "cards": n}

    def deck_detail(self, deck_id: int) -> dict:
        with self.lock:
            node = self.col.sched.deck_due_tree(int(deck_id))
            if not node:
                raise EngineError("That deck no longer exists.")
            deck = self.col.decks.get(int(deck_id))
            info = self._tree_node(node)
            info["description"] = deck.get("desc", "")
            info["filtered"] = bool(deck.get("dyn"))
            counts = self.col.db.first(
                "select count(), sum(queue = 0), sum(queue = 2 and ivl >= 21), sum(queue = -1)"
                f" from cards where did in ({','.join(str(i) for i in self._deck_and_children(int(deck_id)))})"
            )
            info["breakdown"] = {
                "cards": counts[0] or 0,
                "unseen": counts[1] or 0,
                "mature": counts[2] or 0,
                "suspended": counts[3] or 0,
            }
            info["settings"] = None if deck.get("dyn") else self._settings(int(deck_id))
            return info

    def _deck_and_children(self, did: int) -> list[int]:
        return [did] + [c[1] for c in self.col.decks.children(did)]

    def _settings(self, deck_id: int) -> dict:
        conf = self.col.decks.config_dict_for_deck_id(deck_id)
        users = [
            d.name
            for d in self.col.decks.all_names_and_ids(include_filtered=False, skip_empty_default=True)
            if self.col.decks.config_dict_for_deck_id(d.id)["id"] == conf["id"]
        ]
        fmt = lambda steps: " ".join(_fmt_step(s) for s in steps)
        return {
            "preset_id": conf["id"],
            "preset_name": conf["name"],
            "shared_with": [u for u in users if u != self._deck_name(deck_id)],
            "new_per_day": conf["new"]["perDay"],
            "reviews_per_day": conf["rev"]["perDay"],
            "learning_steps": fmt(conf["new"]["delays"]),
            "relearning_steps": fmt(conf["lapse"]["delays"]),
            "graduating_interval": conf["new"]["ints"][0],
            "easy_interval": conf["new"]["ints"][1],
            "maximum_interval": conf["rev"]["maxIvl"],
            "leech_threshold": conf["lapse"]["leechFails"],
            "leech_action": "suspend" if conf["lapse"]["leechAction"] == 0 else "tag",
            "bury_siblings": bool(conf["new"].get("bury") or conf["rev"].get("bury")),
            "desired_retention": round(conf.get("desiredRetention", 0.9), 2),
            "fsrs": bool(self.col.get_config("fsrs", False)),
        }

    def save_settings(self, deck_id: int, s: dict, separate: bool) -> dict:
        with self.lock:
            conf = self.col.decks.config_dict_for_deck_id(int(deck_id))
            if separate:
                name = self._deck_name(int(deck_id))
                conf = self.col.decks.get_config(
                    self.col.decks.add_config_returning_id(name, clone_from=conf)
                )
                deck = self.col.decks.get(int(deck_id))
                deck["conf"] = conf["id"]
                self.col.decks.save(deck)
            try:
                conf["new"]["perDay"] = max(0, int(s["new_per_day"]))
                conf["rev"]["perDay"] = max(0, int(s["reviews_per_day"]))
                conf["new"]["delays"] = _parse_steps(s["learning_steps"]) or [1.0, 10.0]
                conf["lapse"]["delays"] = _parse_steps(s["relearning_steps"])
                conf["new"]["ints"][0] = max(1, int(s["graduating_interval"]))
                conf["new"]["ints"][1] = max(1, int(s["easy_interval"]))
                conf["rev"]["maxIvl"] = max(1, int(s["maximum_interval"]))
                conf["lapse"]["leechFails"] = max(1, int(s["leech_threshold"]))
                conf["lapse"]["leechAction"] = 0 if s["leech_action"] == "suspend" else 1
                conf["new"]["bury"] = conf["rev"]["bury"] = bool(s["bury_siblings"])
                conf["desiredRetention"] = min(0.99, max(0.7, float(s["desired_retention"])))
            except (KeyError, ValueError) as e:
                raise EngineError(f"One of the settings isn't valid ({e}).") from e
            self.col.decks.update_config(conf)
            if "fsrs" in s:
                self.col.set_config("fsrs", bool(s["fsrs"]))
            return self._settings(int(deck_id))

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def stats(self, deck_id: int | None, days: int = 30) -> dict:
        with self.lock:
            dids = self._deck_and_children(int(deck_id)) if deck_id else None
            where_c = f"and cid in (select id from cards where did in ({','.join(map(str, dids))}))" if dids else ""
            where_cards = f"where did in ({','.join(map(str, dids))})" if dids else ""
            cutoff = self.col.sched.day_cutoff
            start = (cutoff - 86400 * days) * 1000
            rows = self.col.db.all(
                f"select (? - id / 1000) / 86400, count(), sum(time) / 1000.0, sum(ease = 1) "
                f"from revlog where id > ? and type < 4 and ease > 0 {where_c} group by 1",
                cutoff,
                start,
            )
            per_day = [{"reviews": 0, "seconds": 0, "again": 0} for _ in range(days)]
            for ago, n, secs, again in rows:
                if 0 <= ago < days:
                    per_day[days - 1 - ago] = {"reviews": n, "seconds": round(secs or 0), "again": again or 0}
            passed, total_rev = self.col.db.first(
                f"select sum(ease > 1), count() from revlog where id > ? and type = 1 {where_c}", start
            )
            today = self.col.sched.today
            fc = [0] * days
            for due, n in self.col.db.all(
                f"select due, count() from cards {where_cards + (' and' if where_cards else 'where')} "
                f"queue in ({QUEUE_TYPE_REV}, {QUEUE_TYPE_DAY_LEARN_RELEARN}) and due < ? group by due",
                today + days,
            ):
                fc[max(0, due - today)] += n
            states = self.col.db.first(
                "select sum(queue = 0), sum(queue in (1, 3, 4)), sum(queue = 2 and ivl < 21),"
                f" sum(queue = 2 and ivl >= 21), sum(queue < 0), count() from cards {where_cards}"
            )
            labels = ["new", "learning", "young", "mature", "paused"]
            return {
                "days": days,
                "per_day": per_day,
                "forecast": fc,
                "retention": round(100 * passed / total_rev) if total_rev else None,
                "reviews_total": sum(d["reviews"] for d in per_day),
                "minutes_total": round(sum(d["seconds"] for d in per_day) / 60),
                "days_studied": sum(1 for d in per_day if d["reviews"]),
                "states": {labels[i]: states[i] or 0 for i in range(5)},
                "cards": states[5] or 0,
                "streak": self._streak(),
            }

    # ------------------------------------------------------------------
    # Import, settings, misc
    # ------------------------------------------------------------------

    def import_package(self, data: bytes, filename: str) -> dict:
        if not filename.lower().endswith(".apkg"):
            raise EngineError("Choose an Anki deck package (.apkg file).")
        tmp = tempfile.mkdtemp(prefix="lumen-import-")
        path = os.path.join(tmp, "deck.apkg")
        try:
            with open(path, "wb") as f:
                f.write(data)
            with self.lock:
                req = ImportAnkiPackageRequest(
                    package_path=path,
                    options=ImportAnkiPackageOptions(
                        merge_notetypes=True, with_scheduling=True, with_deck_configs=True
                    ),
                )
                log = self.col.import_anki_package(req).log
            return {
                "new": len(log.new),
                "updated": len(log.updated),
                "duplicates": len(log.duplicate),
                "total": log.found_notes,
            }
        except EngineError:
            raise
        except Exception as e:
            raise EngineError(f"Couldn't import that file. ({e})") from e
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def app_settings(self) -> dict:
        with self.lock:
            return {
                "rollover": self.col.get_config("rollover", 4),
                "fsrs": bool(self.col.get_config("fsrs", False)),
                "path": self.path,
            }

    def save_app_settings(self, s: dict) -> dict:
        with self.lock:
            if "rollover" in s:
                self.col.set_config("rollover", min(23, max(0, int(s["rollover"]))))
            if "fsrs" in s:
                self.col.set_config("fsrs", bool(s["fsrs"]))
        return self.app_settings()

    def add_sample_deck(self) -> dict:
        """A small starter deck so the app isn't empty on first run."""
        pairs = [
            ("What is the capital of Japan?", "Tokyo"),
            ("What is the capital of Canada?", "Ottawa"),
            ("What is the capital of Australia?", "Canberra"),
            ("What is the capital of Brazil?", "Brasília"),
            ("What is the capital of Kenya?", "Nairobi"),
            ("What is the capital of Norway?", "Oslo"),
            ("What is the capital of Egypt?", "Cairo"),
            ("What is the capital of Argentina?", "Buenos Aires"),
            ("What is the capital of South Korea?", "Seoul"),
            ("What is the capital of Portugal?", "Lisbon"),
            ("What is the capital of New Zealand?", "Wellington"),
            ("What is the capital of Turkey?", "Ankara"),
        ]
        with self.lock:
            did = self.col.decks.id("World Capitals")
            nt = self.col.models.by_name("Basic") or self.col.models.current()
            for front, back in pairs:
                note = self.col.new_note(nt)
                note.fields[0], note.fields[1] = front, back
                note.tags = ["sample"]
                self.col.add_note(note, did)
            return {"id": did}

    # ------------------------------------------------------------------
    # Sync (planned)
    # ------------------------------------------------------------------
    # Anki's engine already supports AnkiWeb sync:
    #   auth = self.col.sync_login(username, password, endpoint=None)
    #   out = self.col.sync_collection(auth, sync_media=True)
    # with full-sync handling when out.required is FULL_UPLOAD/FULL_DOWNLOAD.
    # The interface for it is not built yet.

    def sync_status(self) -> dict:
        return {"available": False}


def _fmt_step(minutes: float) -> str:
    if minutes >= 1440 and minutes % 1440 == 0:
        return f"{int(minutes // 1440)}d"
    if minutes >= 60 and minutes % 60 == 0:
        return f"{int(minutes // 60)}h"
    if minutes < 1:
        return f"{int(round(minutes * 60))}s"
    return f"{minutes:g}m"


def _parse_steps(text: str) -> list[float]:
    out = []
    for part in str(text).replace(",", " ").split():
        m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([smhd]?)", part.strip().lower())
        if not m:
            raise EngineError(f"“{part}” isn't a valid step. Use values like 1m, 10m, 1h or 1d.")
        n, unit = float(m.group(1)), m.group(2) or "m"
        out.append(n / 60 if unit == "s" else n * {"m": 1, "h": 60, "d": 1440}[unit])
    return out

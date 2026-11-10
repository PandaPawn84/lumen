// Focused study mode: one card, one clear next action.
import {
  html, useState, useEffect, useRef, api, bump, go, toast, toastError, useKeys, Icon, Kbd, Menu, Spinner,
  MOD, minutes, plural, FLAGS, useApi,
} from "./lib.js";
import { CardFrame } from "./cardframe.js";
import { NoteForm } from "./editor.js";

const BUTTONS = [
  { r: 1, cls: "again", label: "Again", hint: "Forgot" },
  { r: 2, cls: "hard", label: "Hard", hint: "Struggled" },
  { r: 3, cls: "good", label: "Good", hint: "Remembered" },
  { r: 4, cls: "easy", label: "Easy", hint: "Too easy" },
];

export function Study({ deckId }) {
  const [card, setCard] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const startTotal = useRef(0);
  const lock = useRef(false);
  const once = async (fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toastError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const typeRef = useRef();

  const show = (next) => {
    setAnswer(null);
    setTyped("");
    setCard(next);
    if (!next.done && startTotal.current < next.remaining + next.studied) startTotal.current = next.remaining + next.studied;
  };

  useEffect(() => {
    api("/api/study/start", { deck_id: deckId || null })
      .then((c) => {
        startTotal.current = c.done ? 0 : c.remaining;
        show(c);
      })
      .catch(setError);
  }, [deckId]);

  useEffect(() => {
    if (card?.has_type && !answer) setTimeout(() => typeRef.current?.focus(), 60);
  }, [card?.card_id, answer]);

  const exit = () => {
    bump();
    go(deckId ? `deck/${deckId}` : "home");
  };

  const reveal = () => {
    if (!card || card.done || answer) return;
    return once(async () => setAnswer(await api("/api/study/reveal", { card_id: card.card_id, typed })));
  };

  const rate = (rating) => {
    if (!answer) return;
    return once(async () => show(await api("/api/study/answer", { card_id: card.card_id, rating })));
  };

  const undo = () =>
    once(async () => {
      const r = await api("/api/undo", {});
      if (!r.undone) toast("Nothing to undo");
      else {
        toast(`Undid “${r.undone}”`);
        if (r.next) show(r.next);
      }
    });

  const act = async (action, msg) => {
    try {
      const next = await api("/api/study/action", { card_id: card.card_id, action });
      show(next);
      toast(msg, {
        action: {
          label: "Undo",
          run: undo,
        },
      });
    } catch (e) {
      toastError(e);
    }
  };

  const flag = async (n) => {
    try {
      await api("/api/cards/action", { card_ids: [card.card_id], action: "flag", value: n === card.flag ? 0 : n });
      setCard({ ...card, flag: n === card.flag ? 0 : n });
    } catch (e) {
      toastError(e);
    }
  };

  const refresh = async () => {
    setEditing(false);
    const next = await api("/api/study/current");
    show(next);
    toast("Card updated");
  };

  useKeys(
    editing
      ? { escape: () => setEditing(false) }
      : {
          space: () => (answer ? rate(3) : reveal()),
          enter: () => (answer ? rate(3) : reveal()),
          1: () => rate(1),
          2: () => rate(2),
          3: () => rate(3),
          4: () => rate(4),
          e: () => card && !card.done && setEditing(true),
          "mod+z": undo,
          z: undo,
          escape: exit,
        },
    [card, answer, busy, editing, typed]
  );

  if (error)
    return html`<div class="study"><div class="done"><h1>Couldn't start</h1><p class="subtle" style="margin:10px 0 20px">${error.message}</p>
      <button class="btn" onClick=${exit}>Back</button></div></div>`;
  if (!card) return html`<div class="study"><${Spinner} /></div>`;
  if (card.done) return html`<${Done} card=${card} onExit=${exit} onUndo=${undo} />`;

  const total = Math.max(startTotal.current, card.remaining + card.studied);
  const pct = total ? Math.round((100 * card.studied) / total) : 0;
  const flagColor = FLAGS.find((f) => f.n === card.flag)?.color;

  return html`<div class="study">
    <div class="study-top">
      <div class="left">
        <button class="btn ghost sm" onClick=${exit} title="End session (Esc)"><${Icon} name="arrow-left" size="sm" /> Done</button>
      </div>
      <div class="center">
        <div class="deckname">${card.deck.replaceAll("::", " › ")}</div>
        <div class="progress" title="${card.studied} studied, ${card.remaining} left"><div style=${{ width: pct + "%" }}></div></div>
      </div>
      <div class="right">
        <span class="counts" style="margin-right:8px" title="New · Learning · Review left in this deck">
          <span class=${card.counts.new ? "c-new" : "zero"}>${card.counts.new}</span>
          <span class=${card.counts.learn ? "c-learn" : "zero"}>${card.counts.learn}</span>
          <span class=${card.counts.review ? "c-review" : "zero"}>${card.counts.review}</span>
        </span>
        <button class="btn ghost sm icon-only" title="Undo (Z)" aria-label="Undo" onClick=${undo}><${Icon} name="undo-2" size="sm" /></button>
        <button class="btn ghost sm icon-only" title="Edit card (E)" aria-label="Edit card" onClick=${() => setEditing(true)}><${Icon} name="pencil" size="sm" /></button>
        <${Menu}
          trigger=${(toggle) => html`<button class="btn ghost sm icon-only" aria-label="More actions" onClick=${toggle}><${Icon} name="ellipsis" size="sm" /></button>`}
        >
          <div class="flags" onClick=${(e) => e.stopPropagation()}>
            ${FLAGS.map(
              (f) => html`<button title="${f.name} flag" class=${card.flag === f.n ? "on" : ""} style=${{ background: f.color }} onClick=${() => flag(f.n)}></button>`
            )}
          </div>
          <hr />
          <button onClick=${() => act("bury", "Card hidden until tomorrow")}><${Icon} name="eye-off" size="sm" /> Hide until tomorrow</button>
          <button onClick=${() => act("suspend", "Card paused — find it in the Library to resume")}><${Icon} name="pause" size="sm" /> Pause this card</button>
        <//>
      </div>
    </div>

    <div class="study-body">
      <div class="card-sheet">
        <span class="kind pill ${card.kind}">${card.kind === "new" ? "New" : card.kind === "learning" ? "Learning" : "Review"}</span>
        ${flagColor && html`<span class="flagdot" style=${{ background: flagColor }}></span>`}
        <div style="margin-top:18px">
          <${CardFrame}
            key=${card.card_id + (answer ? "a" : "q")}
            body=${answer ? answer.answer : card.question}
            css=${card.css}
            ord=${card.ord}
            audio=${answer ? answer.answer_audio : card.question_audio}
          />
        </div>
        ${card.has_type &&
        !answer &&
        html`<div class="type-box">
          <input
            ref=${typeRef}
            autofocus
            class="input"
            placeholder="Type your answer, then press Enter"
            value=${typed}
            onInput=${(e) => setTyped(e.target.value)}
            onKeyDown=${(e) => e.key === "Enter" && (e.preventDefault(), reveal())}
          />
        </div>`}
      </div>
    </div>

    <div class="study-dock">
      ${!answer
        ? html`<button class="btn primary reveal-btn" onClick=${reveal} disabled=${busy}>Show answer <${Kbd}>Space<//></button>`
        : html`<div class="answers" role="group" aria-label="How well did you remember?">
            ${BUTTONS.map(
              (b) => html`<button class="answer ${b.cls} ${b.r === 3 ? "sugg" : ""}" onClick=${() => rate(b.r)} disabled=${busy} title="${b.hint} — press ${b.r}">
                <${Kbd}>${b.r}<//>
                <b>${b.label}</b>
                <span class="ivl">${card.intervals[b.r - 1]}</span>
              </button>`
            )}
          </div>`}
    </div>

    ${editing && html`<${EditDrawer} noteId=${card.note_id} onClose=${() => setEditing(false)} onSaved=${refresh} />`}
  </div>`;
}

function EditDrawer({ noteId, onClose, onSaved }) {
  const { data } = useApi(`/api/notes/${noteId}`);
  const decks = useApi("/api/decks/choices").data;
  return html`<div class="drawer" role="dialog" aria-label="Edit card">
    <div class="drawer-head">
      <h2>Edit card</h2>
      <button class="btn ghost icon-only sm" aria-label="Close" onClick=${onClose}><${Icon} name="x" /></button>
    </div>
    <div class="drawer-body">
      ${data && decks ? html`<${NoteForm} detail=${data} decks=${decks} onSaved=${onSaved} />` : html`<${Spinner} />`}
    </div>
  </div>`;
}

function Done({ card, onExit, onUndo }) {
  useKeys({ escape: onExit, enter: onExit, "mod+z": onUndo }, []);
  if (card.nothing_due)
    return html`<div class="study"><div class="done">
      <div class="big-check"><${Icon} name="check" /></div>
      <h1>Nothing to study right now</h1>
      <p class="subtle" style="margin-top:8px">You're all caught up. New reviews will appear as they come due.</p>
      <div style="margin-top:24px"><button class="btn primary lg" onClick=${onExit}>Back</button></div>
    </div></div>`;
  return html`<div class="study"><div class="done">
    <div class="big-check"><${Icon} name="check" /></div>
    <h1>Session complete</h1>
    <p class="subtle" style="margin-top:8px">Nice work. Lumen will bring cards back right before you'd forget them.</p>
    <div class="tiles">
      <div class="tile"><div class="t-label">Studied</div><div class="t-value">${card.studied}<small>cards</small></div></div>
      <div class="tile"><div class="t-label">Time</div><div class="t-value">${minutes(card.seconds)}</div></div>
      <div class="tile"><div class="t-label">Tomorrow</div><div class="t-value">${card.tomorrow ?? 0}<small>due</small></div></div>
    </div>
    <div class="row" style="justify-content:center">
      <button class="btn ghost" onClick=${onUndo}><${Icon} name="undo-2" size="sm" /> Undo last</button>
      <button class="btn primary lg" onClick=${onExit}>Back to home</button>
    </div>
  </div></div>`;
}

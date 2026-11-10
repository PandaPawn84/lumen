// Library: find, review and fix any card.
import {
  html, useState, useEffect, useRef, useApi, api, bump, go, Icon, Menu, Spinner, ErrorBox, toastError, toastUndo,
  ask, plural, dueLabel, STATE_LABEL, FLAGS, MOD, useKeys,
} from "./lib.js";
import { NoteForm } from "./editor.js";
import { CardFrame } from "./cardframe.js";

const FILTERS = [
  ["all", "All cards"],
  ["due", "Due today"],
  ["new", "New"],
  ["learning", "Learning"],
  ["review", "Learned"],
  ["added_today", "Added today"],
  ["flagged", "Flagged"],
  ["difficult", "Difficult"],
  ["suspended", "Paused"],
];

export function Library({ params }) {
  const [q, setQ] = useState(params.q || "");
  const [query, setQuery] = useState(params.q || "");
  const filter = params.filter || "all";
  const deck = params.deck || "";
  const [limit, setLimit] = useState(200);
  const [sel, setSel] = useState(null); // focused row
  const [checked, setChecked] = useState(new Set());
  const searchRef = useRef();
  const decks = useApi("/api/decks/choices").data;

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setChecked(new Set());
    setLimit(200);
  }, [query, filter, deck]);

  const path = `/api/library?q=${encodeURIComponent(query)}&filter=${filter}&deck=${deck}&limit=${limit}`;
  const { data, error } = useApi(path);
  const rows = data?.rows || [];

  const setParam = (k, v) => {
    const p = new URLSearchParams({ ...params, [k]: v });
    if (!v || v === "all") p.delete(k);
    go("library" + (p.toString() ? "?" + p : ""));
  };

  useKeys(
    {
      "mod+f": () => searchRef.current?.focus(),
      "/": () => searchRef.current?.focus(),
      escape: () => (document.activeElement === searchRef.current ? searchRef.current.blur() : setSel(null)),
      arrowdown: () => move(1),
      arrowup: () => move(-1),
    },
    [rows, sel]
  );
  const move = (d) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.card_id === sel?.card_id);
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + d))];
    setSel(next);
    document.getElementById("row-" + next.card_id)?.scrollIntoView({ block: "nearest" });
  };

  const targets = checked.size ? [...checked] : sel ? [sel.card_id] : [];
  const run = async (action, value, label) => {
    try {
      const r = await api("/api/cards/action", { card_ids: targets, action, value });
      bump();
      toastUndo(label || (r.deleted_notes ? `Deleted ${plural(r.deleted_notes, "note")}` : "Done"));
      if (action === "delete") {
        setSel(null);
        setChecked(new Set());
      }
    } catch (e) {
      toastError(e);
    }
  };
  const del = async () => {
    const ok = await ask({
      title: targets.length > 1 ? `Delete ${targets.length} cards?` : "Delete this card?",
      message: "This deletes the whole note, including any other cards made from it. You can undo right after.",
      confirm: "Delete",
      danger: true,
    });
    ok && run("delete");
  };
  const moveTo = async (deckId) => {
    const name = decks.find((d) => d.id === deckId)?.name;
    run("move", deckId, `Moved ${plural(targets.length, "card")} to ${name}`);
  };

  const allChecked = rows.length && rows.every((r) => checked.has(r.card_id));
  const toggle = (id) => setChecked((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const anySuspended = rows.some((r) => targets.includes(r.card_id) && r.state === "suspended");

  return html`<div class="lib ${sel ? "with-detail" : ""}">
    <div class="lib-main">
      <div class="lib-head">
        <div class="row">
          <div><h1>Library</h1></div>
          <span class="muted num">${data ? plural(data.total, "card") : ""}</span>
        </div>
        <div class="row">
          <div class="search grow">
            <${Icon} name="search" size="sm" />
            <input
              ref=${searchRef}
              class="input"
              placeholder=${`Search cards — try “capital”, tag:spanish or front:hola   (${MOD}F)`}
              value=${q}
              onInput=${(e) => setQ(e.target.value)}
            />
          </div>
          <select class="input" style="width:220px;height:36px" value=${deck} onChange=${(e) => setParam("deck", e.target.value)} aria-label="Deck">
            <option value="">All decks</option>
            ${decks?.map((d) => html`<option value=${d.id}>${d.name.replaceAll("::", " › ")}</option>`)}
          </select>
        </div>
        <div class="chips">
          ${FILTERS.map(([k, label]) => html`<button class="chip ${filter === k ? "on" : ""}" onClick=${() => setParam("filter", k)}>${label}</button>`)}
        </div>
      </div>

      ${checked.size > 0 &&
      html`<div class="bulk" style="margin-top:10px">
        <b>${plural(checked.size, "card")} selected</b>
        <span class="grow"></span>
        <${Actions} anySuspended=${anySuspended} decks=${decks} run=${run} del=${del} moveTo=${moveTo} />
        <button class="btn sm ghost" onClick=${() => setChecked(new Set())}>Clear</button>
      </div>`}

      <div class="lib-table">
        ${error
          ? html`<${ErrorBox} error=${error} />`
          : !data
          ? html`<${Spinner} />`
          : !rows.length
          ? html`<div class="empty"><div class="e-icon"><${Icon} name="search" /></div><h3>No cards found</h3><p>Try a different search or filter.</p></div>`
          : html`<table class="cards">
              <colgroup><col style="width:44px" /><col /><col /><col style="width:20%" /><col style="width:104px" /><col style="width:110px" /></colgroup>
              <thead><tr>
                <th class="cb"><input type="checkbox" aria-label="Select all" checked=${allChecked} onChange=${() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.card_id)))} /></th>
                <th>Front</th><th>Back</th><th>Deck</th><th>Status</th><th>Next review</th>
              </tr></thead>
              <tbody>
                ${rows.map(
                  (r) => html`<tr id=${"row-" + r.card_id} key=${r.card_id} class=${sel?.card_id === r.card_id ? "sel" : ""} onClick=${() => setSel(r)}>
                    <td class="cb" onClick=${(e) => e.stopPropagation()}><input type="checkbox" aria-label="Select" checked=${checked.has(r.card_id)} onChange=${() => toggle(r.card_id)} /></td>
                    <td class="front">${r.flag ? html`<span class="flag-dot" style=${{ background: FLAGS[r.flag - 1].color }}></span>` : ""}${r.card_no ? html`<span class="badge" style="margin-right:6px" title="Card ${r.card_no} from this note">${r.card_no}</span>` : ""}${r.front || html`<span class="muted">(empty)</span>`}</td>
                    <td class="back">${r.back}</td>
                    <td class="deckc">${r.deck.split("::").pop()}</td>
                    <td><span class="pill ${r.state}">${STATE_LABEL[r.state]}</span></td>
                    <td class="muted num">${dueLabel(r.state, r.due_in)}</td>
                  </tr>`
                )}
              </tbody>
            </table>
            ${data.total > rows.length &&
            html`<div class="more-row"><button class="btn" onClick=${() => setLimit((l) => l + 300)}>Show more (${(data.total - rows.length).toLocaleString()} left)</button></div>`}`}
      </div>
    </div>
    ${sel && html`<${Detail} row=${sel} decks=${decks} onClose=${() => setSel(null)} actions=${html`<${Actions} anySuspended=${sel.state === "suspended"} decks=${decks} run=${run} del=${del} moveTo=${moveTo} />`} />`}
  </div>`;
}

function Actions({ anySuspended, decks, run, del, moveTo }) {
  return html`<div class="row" style="gap:6px">
    ${anySuspended
      ? html`<button class="btn sm" onClick=${() => run("unsuspend", null, "Resumed")}><${Icon} name="play" size="sm" /> Resume</button>`
      : html`<button class="btn sm" onClick=${() => run("suspend", null, "Paused")}><${Icon} name="pause" size="sm" /> Pause</button>`}
    <${Menu} trigger=${(t) => html`<button class="btn sm" onClick=${t}><${Icon} name="folder-output" size="sm" /> Move</button>`}>
      ${decks?.map((d) => html`<button onClick=${() => moveTo(d.id)}>${d.name.replaceAll("::", " › ")}</button>`)}
    <//>
    <${Menu} trigger=${(t) => html`<button class="btn sm icon-only" aria-label="More" onClick=${t}><${Icon} name="ellipsis" size="sm" /></button>`}>
      <div class="flags">
        ${FLAGS.map((f) => html`<button title="${f.name} flag" style=${{ background: f.color }} onClick=${() => run("flag", f.n, `Flagged ${f.name.toLowerCase()}`)}></button>`)}
      </div>
      <button onClick=${() => run("flag", 0, "Flag removed")}><${Icon} name="flag" size="sm" /> Remove flag</button>
      <button onClick=${() => run("forget", null, "Reset to new")}><${Icon} name="rotate-ccw" size="sm" /> Reset to new</button>
      <hr />
      <button class="danger" onClick=${del}><${Icon} name="trash-2" size="sm" /> Delete</button>
    <//>
  </div>`;
}

function Detail({ row, decks, onClose, actions }) {
  const { data, error } = useApi(`/api/notes/${row.note_id}`, [row.note_id]);
  const [tab, setTab] = useState("edit");
  const card = data?.cards.find((c) => c.card_id === row.card_id) || data?.cards[0];
  return html`<aside class="lib-detail">
    <div class="drawer-head">
      <div class="seg">
        <button class=${tab === "edit" ? "on" : ""} onClick=${() => setTab("edit")}>Edit</button>
        <button class=${tab === "preview" ? "on" : ""} onClick=${() => setTab("preview")}>Preview</button>
        <button class=${tab === "info" ? "on" : ""} onClick=${() => setTab("info")}>Details</button>
      </div>
      <button class="btn ghost icon-only sm" aria-label="Close" onClick=${onClose}><${Icon} name="x" /></button>
    </div>
    <div class="drawer-body">
      ${error
        ? html`<${ErrorBox} error=${error} />`
        : !data || !decks
        ? html`<${Spinner} />`
        : tab === "edit"
        ? html`<div class="hint" style="margin-bottom:12px">${data.notetype}${data.cards.length > 1 ? ` · ${plural(data.cards.length, "card")} from this note` : ""}</div>
            <${NoteForm} detail=${data} decks=${decks} onSaved=${() => (bump(), toastUndo("Changes saved"))} />`
        : tab === "preview"
        ? html`<${Preview} cardId=${row.card_id} />`
        : html`<${Info} card=${card} all=${data.cards} />`}
    </div>
    <div class="drawer-foot" style="justify-content:space-between">${actions}</div>
  </aside>`;
}

function Preview({ cardId }) {
  const { data } = useApi(`/api/cards/${cardId}/preview`, [cardId]);
  const [side, setSide] = useState("q");
  if (!data) return html`<${Spinner} />`;
  return html`<div>
    <div class="seg" style="margin-bottom:12px">
      <button class=${side === "q" ? "on" : ""} onClick=${() => setSide("q")}>Question</button>
      <button class=${side === "a" ? "on" : ""} onClick=${() => setSide("a")}>Answer</button>
    </div>
    <div class="panel" style="padding:16px">
      <${CardFrame} key=${cardId + side} body=${side === "q" ? data.question : data.answer} css=${data.css} ord=${data.ord} minHeight=${80} />
    </div>
  </div>`;
}

function Info({ card, all }) {
  if (!card) return null;
  const added = new Date(card.added * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return html`<div>
    <h3 style="margin-bottom:8px">This card</h3>
    <dl class="info-grid">
      <dt>Status</dt><dd><span class="pill ${card.state}">${STATE_LABEL[card.state]}</span></dd>
      <dt>Next review</dt><dd>${dueLabel(card.state, card.due_in)}</dd>
      <dt>Current gap</dt><dd>${card.interval ? plural(card.interval, "day") : "—"}</dd>
      <dt>Reviews</dt><dd>${card.reviews}</dd>
      <dt>Times forgotten</dt><dd>${card.lapses}</dd>
      <dt>Deck</dt><dd>${card.deck.replaceAll("::", " › ")}</dd>
      <dt>Card</dt><dd>${card.template}</dd>
      <dt>Added</dt><dd>${added}</dd>
    </dl>
    ${all.length > 1 &&
    html`<h3 style="margin:20px 0 8px">Other cards from this note</h3>
      ${all.filter((c) => c.card_id !== card.card_id).map((c) => html`<div class="row" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)">
        <span>${c.template}</span><span class="pill ${c.state}">${STATE_LABEL[c.state]}</span></div>`)}`}
  </div>`;
}

// A single deck: today's work, what's inside, and plain-language settings.
import {
  html, useState, useEffect, useApi, api, bump, go, Icon, Kbd, Menu, Spinner, ErrorBox, Switch, ask, toast, toastError,
  toastUndo, plural, useKeys,
} from "./lib.js";
import { createDeck } from "./home.js";

const PACES = [
  { key: "light", label: "Light", sub: "5 min a day", new: 10, rev: 100 },
  { key: "steady", label: "Steady", sub: "10–15 min", new: 20, rev: 200 },
  { key: "intense", label: "Intensive", sub: "30+ min", new: 40, rev: 400 },
  { key: "exam", label: "Exam prep", sub: "As much as needed", new: 80, rev: 9999 },
];

export function DeckPage({ id, onAdd }) {
  const { data, error } = useApi(`/api/decks/${id}`, [id]);
  useKeys({ enter: () => data?.due && go("study/" + id) }, [data]);
  if (error) return html`<div class="page"><${ErrorBox} error=${error} /></div>`;
  if (!data) return html`<${Spinner} />`;

  const parts = data.full_name.split("::");
  const parent = parts.slice(0, -1);

  const rename = async () => {
    const name = await ask({ title: "Rename deck", input: data.full_name, confirm: "Rename", message: "Use “::” to move it under another deck." });
    if (!name || name === data.full_name) return;
    try {
      await api(`/api/decks/${id}/rename`, { name });
      bump();
      toastUndo("Deck renamed");
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    const ok = await ask({
      title: `Delete “${data.name}”?`,
      message: `This deletes the deck${data.children.length ? ", its sub-decks" : ""} and ${plural(data.breakdown.cards, "card")} in it. You can undo right after.`,
      confirm: "Delete deck",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/decks/${id}/delete`, {});
      go("home");
      bump();
      toastUndo(`Deleted “${data.name}”`, () => go("deck/" + id));
    } catch (e) {
      toastError(e);
    }
  };

  return html`<div class="page">
    <div class="page-head">
      <div style="min-width:0">
        <div class="crumb">${parent.length ? parent.map((p) => html`<span>${p}</span>`) : html`<span>Deck</span>`}</div>
        <h1>${data.name}</h1>
        ${data.description && html`<p class="selectable" dangerouslySetInnerHTML=${{ __html: data.description }}></p>`}
      </div>
      <div class="head-actions">
        <button class="btn" onClick=${() => onAdd(id)}><${Icon} name="plus" size="sm" /> Add card</button>
        <button class="btn primary" disabled=${!data.due} onClick=${() => go("study/" + id)}><${Icon} name="play" size="sm" /> Study${data.due ? html` <${Kbd}>↵<//>` : ""}</button>
        <${Menu} trigger=${(t) => html`<button class="btn icon-only" aria-label="Deck actions" onClick=${t}><${Icon} name="ellipsis" /></button>`}>
          <button onClick=${rename}><${Icon} name="square-pen" size="sm" /> Rename or move</button>
          <button onClick=${async () => { const nid = await createDeck(data.full_name); nid && go("deck/" + nid); }}><${Icon} name="folder-plus" size="sm" /> New sub-deck</button>
          <button onClick=${() => go(`library?deck=${id}`)}><${Icon} name="library-big" size="sm" /> Browse cards</button>
          <button onClick=${() => go(`stats?deck=${id}`)}><${Icon} name="chart-column" size="sm" /> Deck stats</button>
          <hr />
          <button class="danger" onClick=${remove}><${Icon} name="trash-2" size="sm" /> Delete deck</button>
        <//>
      </div>
    </div>

    <div class="tiles" style="margin-top:0">
      <div class="tile">
        <div class="t-label">Due today</div>
        <div class="t-value">${data.due}</div>
        <div class="t-sub counts" style="font-size:12px">
          <span class=${data.review ? "c-review" : "zero"}>${data.review} review</span>
          <span class=${data.new ? "c-new" : "zero"}>${data.new} new</span>
          <span class=${data.learn ? "c-learn" : "zero"}>${data.learn} learning</span>
        </div>
      </div>
      <div class="tile"><div class="t-label">Cards</div><div class="t-value">${data.breakdown.cards.toLocaleString()}</div><div class="t-sub">${data.breakdown.unseen} not seen yet</div></div>
      <div class="tile"><div class="t-label">Well known</div><div class="t-value">${data.breakdown.mature.toLocaleString()}</div><div class="t-sub">Remembered for 3+ weeks</div></div>
      <div class="tile"><div class="t-label">Paused</div><div class="t-value">${data.breakdown.suspended}</div><div class="t-sub">${data.breakdown.suspended ? html`<a href="#/library?deck=${id}&filter=suspended">Review paused cards</a>` : "None"}</div></div>
    </div>

    ${data.children.length > 0 &&
    html`<div class="section">
      <div class="section-head"><h2>Sub-decks</h2></div>
      <div class="panel" style="padding:4px 0">
        ${flatten(data.children).map(
          (c) => html`<div class="set-row" style="padding:10px 18px;padding-left:${18 + c.depth * 20}px;cursor:default" onClick=${() => go("deck/" + c.id)}>
            <div class="s-text"><b>${c.name}</b><span>${plural(c.total, "card")}</span></div>
            <div class="s-ctrl counts">
              ${c.due
                ? html`${c.review ? html`<span class="c-review">${c.review} due</span>` : ""}${c.new ? html`<span class="c-new">${c.new} new</span>` : ""}${c.learn ? html`<span class="c-learn">${c.learn} learning</span>` : ""}`
                : html`<span class="muted" style="font-weight:500">${c.total ? "Done for today" : "Empty"}</span>`}
              <${Icon} name="chevron-right" size="sm" cls="muted" />
            </div>
          </div>`
        )}
      </div>
    </div>`}

    ${data.settings && html`<${DeckSettings} id=${id} initial=${data.settings} key=${id} />`}
  </div>`;
}

function flatten(list, depth = 0, out = []) {
  for (const d of list) {
    out.push({ ...d, depth });
    flatten(d.children, depth + 1, out);
  }
  return out;
}

function DeckSettings({ id, initial }) {
  const [s, setS] = useState(initial);
  const [separate, setSeparate] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => setS(initial), [initial]);
  const set = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(initial) || separate;
  const pace = PACES.find((p) => p.new === +s.new_per_day && p.rev === +s.reviews_per_day);
  const shared = initial.shared_with;

  const save = async () => {
    setSaving(true);
    try {
      const next = await api(`/api/decks/${id}/settings`, { settings: s, separate });
      setS(next);
      setSeparate(false);
      bump();
      toast("Settings saved");
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return html`<div class="section">
    <div class="section-head">
      <h2>Daily pace</h2>
      ${dirty &&
      html`<div class="row" style="gap:6px">
        <button class="btn sm ghost" onClick=${() => (setS(initial), setSeparate(false))}>Discard</button>
        <button class="btn sm primary" disabled=${saving} onClick=${save}>${saving ? "Saving…" : "Save changes"}</button>
      </div>`}
    </div>
    <div class="panel panel-pad">
      <div class="preset-grid">
        ${PACES.map(
          (p) => html`<button class="type-opt ${pace?.key === p.key ? "on" : ""}" onClick=${() => setS((x) => ({ ...x, new_per_day: p.new, reviews_per_day: p.rev }))}>
            <b>${p.label}</b><span>${p.sub} · ${p.new} new/day</span>
          </button>`
        )}
      </div>
      <p class="hint" style="margin:8px 0 4px">
        You'll see up to <b>${s.new_per_day}</b> new cards and <b>${+s.reviews_per_day >= 9999 ? "all" : s.reviews_per_day}</b> reviews a day.
        New cards add up: each one comes back several times over the next weeks.
      </p>
      <div class="settings-list" style="margin-top:6px">
        <${NumRow} label="New cards per day" help="How many cards you haven't seen before to introduce each day." value=${s.new_per_day} onChange=${set("new_per_day")} />
        <${NumRow} label="Reviews per day" help="A safety cap. Lower it only if reviews pile up; skipped reviews wait for later." value=${s.reviews_per_day} onChange=${set("reviews_per_day")} />
      </div>

      <details class="adv">
        <summary><${Icon} name="chevron-right" size="sm" /> Advanced scheduling</summary>
        <div class="settings-list">
          <${TextRow} label="Learning steps" help="Delays while a new card is being learned, e.g. “1m 10m” shows it again after 1 minute, then 10." value=${s.learning_steps} onChange=${set("learning_steps")} />
          <${TextRow} label="Relearning steps" help="Delays after you forget a card you knew." value=${s.relearning_steps} onChange=${set("relearning_steps")} />
          <${NumRow} label="First interval (days)" help="When a newly learned card comes back after pressing Good." value=${s.graduating_interval} onChange=${set("graduating_interval")} />
          <${NumRow} label="Easy interval (days)" help="When it comes back after pressing Easy on a new card." value=${s.easy_interval} onChange=${set("easy_interval")} />
          <${NumRow} label="Longest gap (days)" help="Cards never wait longer than this. 36500 = no limit." value=${s.maximum_interval} onChange=${set("maximum_interval")} />
          <${NumRow} label="Difficult card threshold" help="After forgetting a card this many times, it's marked as difficult." value=${s.leech_threshold} onChange=${set("leech_threshold")} />
          <div class="set-row">
            <div class="s-text"><b>When a card is difficult</b><span>Pause it so you can rewrite it, or just tag it “leech”.</span></div>
            <div class="s-ctrl">
              <select class="input wide" value=${s.leech_action} onChange=${(e) => set("leech_action")(e.target.value)}>
                <option value="suspend">Pause the card</option>
                <option value="tag">Only tag it</option>
              </select>
            </div>
          </div>
          <div class="set-row">
            <div class="s-text"><b>Space out related cards</b><span>Don't show both directions of the same note on the same day.</span></div>
            <div class="s-ctrl"><${Switch} checked=${s.bury_siblings} onChange=${set("bury_siblings")} label="Space out related cards" /></div>
          </div>
          <div class="set-row">
            <div class="s-text"><b>Smarter scheduling (FSRS)</b><span>A modern algorithm that adapts to your memory. Applies to all decks.</span></div>
            <div class="s-ctrl"><${Switch} checked=${s.fsrs} onChange=${set("fsrs")} label="FSRS" /></div>
          </div>
          ${s.fsrs &&
          html`<div class="set-row">
            <div class="s-text"><b>Target recall: ${Math.round(s.desired_retention * 100)}%</b><span>Higher means more reviews but fewer forgotten cards. 90% suits most people.</span></div>
            <div class="s-ctrl"><input type="range" min="0.75" max="0.97" step="0.01" value=${s.desired_retention} onInput=${(e) => set("desired_retention")(+e.target.value)} /></div>
          </div>`}
        </div>
      </details>

      ${shared.length > 0 &&
      html`<div class="notice" style="margin-top:14px">
        <${Icon} name="info" size="sm" />
        <div class="grow">
          These settings are shared with ${shared.length === 1 ? `“${shared[0]}”` : `${shared.length} other decks (${shared.slice(0, 3).join(", ")}${shared.length > 3 ? "…" : ""})`}.
          <label class="row" style="gap:8px;margin-top:8px;color:var(--ink)">
            <${Switch} checked=${separate} onChange=${setSeparate} label="Only change this deck" /> Only change this deck
          </label>
        </div>
      </div>`}
    </div>
  </div>`;
}

function NumRow({ label, help, value, onChange }) {
  return html`<div class="set-row">
    <div class="s-text"><b>${label}</b><span>${help}</span></div>
    <div class="s-ctrl"><input class="input num" type="number" min="0" value=${value} onInput=${(e) => onChange(e.target.value === "" ? "" : +e.target.value)} /></div>
  </div>`;
}
function TextRow({ label, help, value, onChange }) {
  return html`<div class="set-row">
    <div class="s-text"><b>${label}</b><span>${help}</span></div>
    <div class="s-ctrl"><input class="input wide" value=${value} onInput=${(e) => onChange(e.target.value)} /></div>
  </div>`;
}

// Home: what to do today, at a glance.
import { html, useApi, go, Icon, Kbd, Spinner, ErrorBox, greeting, plural, minutes, useKeys, ask, api, bump, toastError } from "./lib.js";
import { BarChart } from "./charts.js";

export async function createDeck(parent) {
  const name = await ask({
    title: parent ? `New sub-deck in ${parent}` : "New deck",
    message: parent ? "" : "Tip: use “::” for sub-decks, e.g. Spanish::Verbs.",
    input: "",
    placeholder: "Deck name",
    confirm: "Create deck",
  });
  if (!name) return null;
  try {
    const { id } = await api("/api/decks", { name: parent ? `${parent}::${name}` : name });
    bump();
    return id;
  } catch (e) {
    toastError(e);
    return null;
  }
}

export function Home({ onAdd, onImport }) {
  addRef = onAdd;
  const { data, error, loading } = useApi("/api/home");
  useKeys({ enter: () => data?.total && go("study"), space: () => data?.total && go("study") }, [data]);
  if (error) return html`<div class="page"><${ErrorBox} error=${error} /></div>`;
  if (!data) return html`<${Spinner} />`;

  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const empty = data.card_count === 0;

  return html`<div class="page">
    <div class="page-head">
      <div>
        <div class="crumb">${date}</div>
        <h1>${greeting()}</h1>
      </div>
    </div>

    ${empty
      ? html`<div class="panel"><div class="empty">
          <div class="e-icon"><${Icon} name="sparkles" size="lg" /></div>
          <h3>Let's make your first cards</h3>
          <p>Add something you want to remember, or bring in a deck you already have.</p>
          <div class="row" style="justify-content:center;margin-top:16px">
            <button class="btn primary" onClick=${onAdd}><${Icon} name="plus" size="sm" /> New card</button>
            <button class="btn" onClick=${onImport}><${Icon} name="upload" size="sm" /> Import a deck</button>
          </div>
        </div></div>`
      : html`<${Hero} data=${data} />`}

    ${!empty &&
    html`<div class="tiles">
      <div class="tile">
        <div class="t-label"><${Icon} name="flame" size="sm" /> Streak</div>
        <div class="t-value">${data.streak}<small>${data.streak === 1 ? "day" : "days"}</small></div>
        <div class="t-sub">${data.streak ? "Keep it going today" : "Study today to start one"}</div>
      </div>
      <div class="tile">
        <div class="t-label"><${Icon} name="check" size="sm" /> Studied today</div>
        <div class="t-value">${data.studied_today}<small>cards</small></div>
        <div class="t-sub">${data.seconds_today ? minutes(data.seconds_today) + " so far" : "Nothing yet"}</div>
      </div>
      <div class="tile" style="grid-column: span 2">
        <div class="t-label"><${Icon} name="calendar" size="sm" /> Coming up this week</div>
        <${BarChart}
          values=${data.forecast}
          height=${56}
          labels=${data.forecast.map((_, i) => dayName(i))}
          tip=${(v, i) => `${dayName(i, true)}: ${plural(v, "review")}`}
          axis=${false}
          compact
        />
      </div>
    </div>`}

    <div class="section">
      <div class="section-head">
        <h2>Your decks</h2>
        <div class="row" style="gap:6px">
          <button class="btn sm" onClick=${onImport}><${Icon} name="upload" size="sm" /> Import</button>
          <button class="btn sm" onClick=${async () => { const id = await createDeck(); id && go("deck/" + id); }}><${Icon} name="folder-plus" size="sm" /> New deck</button>
        </div>
      </div>
      ${data.decks.length
        ? html`<div class="deck-grid">${data.decks.map((d) => html`<${DeckCard} d=${d} key=${d.id} />`)}</div>`
        : html`<div class="panel"><div class="empty"><h3>No decks yet</h3><p>Decks keep related cards together, like “Spanish” or “Biology”.</p></div></div>`}
    </div>
  </div>`;
}

function dayName(i, long = false) {
  if (i === 0) return "Today";
  if (i === 1) return long ? "Tomorrow" : "Tmrw";
  const d = new Date();
  d.setDate(d.getDate() + i);
  return d.toLocaleDateString(undefined, { weekday: long ? "long" : "short" });
}

function Hero({ data }) {
  if (!data.total)
    return html`<div class="hero">
      <div>
        <h2>You're all caught up 🎉</h2>
        <div class="meta">${data.forecast[1] ? `${plural(data.forecast[1], "review")} due tomorrow.` : "Nothing else is due soon."} Add new cards any time.</div>
      </div>
    </div>`;
  const parts = [];
  if (data.due) parts.push(html`<span class="c-review">${data.due} to review</span>`);
  if (data.new) parts.push(html`<span class="c-new">${data.new} new</span>`);
  if (data.learn) parts.push(html`<span class="c-learn">${data.learn} learning</span>`);
  return html`<div class="hero">
    <div>
      <h2>${plural(data.total, "card")} to study today</h2>
      <div class="meta">About ${data.minutes || 1} ${data.minutes === 1 ? "minute" : "minutes"} across ${plural(data.decks.filter((d) => d.due).length, "deck")}</div>
      <div class="counts">${parts}</div>
    </div>
    <button class="btn primary lg" onClick=${() => go("study")}>
      <${Icon} name="play" size="sm" /> Study now <${Kbd}>↵<//>
    </button>
  </div>`;
}

let addRef = null;

function DeckCard({ d }) {
  const doneToday = d.due === 0;
  const empty = d.total === 0;
  const subs = countDescendants(d);
  return html`<div class="deck-card" onClick=${() => go("deck/" + d.id)} role="button" tabindex="0" onKeyDown=${(e) => e.key === "Enter" && go("deck/" + d.id)}>
    <div class="dc-top">
      <div style="min-width:0">
        <h3>${d.name}</h3>
        <div class="dc-sub">${plural(d.total, "card")}${subs ? ` · ${plural(subs, "sub-deck")}` : ""}</div>
      </div>
      ${d.filtered && html`<span class="badge">Filtered</span>`}
    </div>
    <div class="dc-foot">
      ${empty
        ? html`<span class="muted" style="font-size:12.5px">No cards yet</span>`
        : doneToday
        ? html`<span class="muted" style="font-size:12.5px;display:flex;gap:5px;align-items:center"><${Icon} name="check" size="sm" /> Done for today</span>`
        : html`<span class="counts">
            ${d.review ? html`<span class="c-review">${d.review} due</span>` : ""}
            ${d.new ? html`<span class="c-new">${d.new} new</span>` : ""}
            ${d.learn ? html`<span class="c-learn">${d.learn} learning</span>` : ""}
          </span>`}
      ${empty
        ? html`<button class="btn sm" onClick=${(e) => { e.stopPropagation(); addRef?.(d.id); }}><${Icon} name="plus" size="sm" /> Add cards</button>`
        : html`<button
        class="btn sm ${doneToday ? "ghost" : "primary"}"
        disabled=${doneToday}
        onClick=${(e) => {
          e.stopPropagation();
          go("study/" + d.id);
        }}
      >
        Study
      </button>`}
    </div>
  </div>`;
}

function countDescendants(d) {
  return d.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}

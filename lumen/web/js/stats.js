// Progress: how much you've studied and what's coming.
import { html, useApi, go, Icon, Spinner, ErrorBox, plural } from "./lib.js";
import { BarChart, StackBar } from "./charts.js";

export function Stats({ params }) {
  const days = +(params.days || 30);
  const deck = params.deck || "";
  const { data, error } = useApi(`/api/stats?days=${days}&deck=${deck}`);
  const decks = useApi("/api/decks/choices").data;

  const set = (k, v) => {
    const p = new URLSearchParams({ ...params, [k]: v });
    if (!v) p.delete(k);
    go("stats?" + p);
  };

  if (error) return html`<div class="page"><${ErrorBox} error=${error} /></div>`;

  const dateLabel = (i, n) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const fwdLabel = (i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return i === 0 ? "Today" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return html`<div class="page">
    <div class="page-head">
      <div><h1>Progress</h1><p>How your studying is going${deck && decks ? ` in ${decks.find((d) => d.id === +deck)?.name.replaceAll("::", " › ") || "this deck"}` : ""}.</p></div>
      <div class="head-actions">
        <select class="input" style="width:200px" value=${deck} onChange=${(e) => set("deck", e.target.value)} aria-label="Deck">
          <option value="">All decks</option>
          ${decks?.map((d) => html`<option value=${d.id}>${d.name.replaceAll("::", " › ")}</option>`)}
        </select>
        <div class="seg">
          ${[7, 30, 90].map((n) => html`<button class=${days === n ? "on" : ""} onClick=${() => set("days", n)}>${n === 7 ? "Week" : n === 30 ? "Month" : "3 months"}</button>`)}
        </div>
      </div>
    </div>

    ${!data
      ? html`<div style="height:300px"><${Spinner} /></div>`
      : html`
        <div class="tiles" style="margin-top:0">
          <div class="tile"><div class="t-label">Reviews</div><div class="t-value">${data.reviews_total.toLocaleString()}</div><div class="t-sub">last ${plural(days, "day")}</div></div>
          <div class="tile"><div class="t-label">Time studied</div><div class="t-value">${data.minutes_total}<small>min</small></div><div class="t-sub">${data.days_studied ? `≈ ${Math.round(data.minutes_total / data.days_studied)} min per study day` : "—"}</div></div>
          <div class="tile"><div class="t-label">Days studied</div><div class="t-value">${data.days_studied}<small>of ${days}</small></div><div class="t-sub">${data.streak ? `${plural(data.streak, "day")} streak` : "No current streak"}</div></div>
          <div class="tile"><div class="t-label">Recall rate</div><div class="t-value">${data.retention ?? "—"}${data.retention !== null ? html`<small>%</small>` : ""}</div><div class="t-sub">${data.retention !== null ? "of reviews remembered" : "Not enough reviews yet"}</div></div>
        </div>

        <div class="section panel panel-pad">
          <div class="section-head"><h2>Reviews per day</h2></div>
          <${BarChart}
            values=${data.per_day.map((d) => d.reviews)}
            labels=${data.per_day.map((_, i) => dateLabel(i, days))}
            every=${days > 30 ? 14 : days > 7 ? 5 : 1}
            tip=${(v, i) => html`<b>${dateLabel(i, days)}</b>${plural(v, "review")}${data.per_day[i].again ? ` · ${data.per_day[i].again} forgotten` : ""}${data.per_day[i].seconds ? ` · ${Math.round(data.per_day[i].seconds / 60)} min` : ""}`}
          />
          <${TableView} head=${["Date", "Reviews", "Forgotten", "Minutes"]} rows=${data.per_day.map((d, i) => [dateLabel(i, days), d.reviews, d.again, Math.round(d.seconds / 60)])} />
        </div>

        <div class="section panel panel-pad">
          <div class="section-head"><h2>Coming up</h2><span class="muted">Reviews due over the next ${days} days</span></div>
          <${BarChart}
            values=${data.forecast}
            labels=${data.forecast.map((_, i) => fwdLabel(i))}
            every=${days > 30 ? 14 : days > 7 ? 5 : 1}
            tip=${(v, i) => html`<b>${fwdLabel(i)}</b>${plural(v, "review")}`}
          />
          <${TableView} head=${["Day", "Reviews due"]} rows=${data.forecast.map((v, i) => [fwdLabel(i), v])} />
        </div>

        <div class="section panel panel-pad">
          <div class="section-head"><h2>Your cards</h2><span class="muted">${plural(data.cards, "card")}</span></div>
          <${StackBar}
            parts=${[
              { label: "New", value: data.states.new, color: "var(--c-new)" },
              { label: "Learning", value: data.states.learning, color: "var(--c-learning)" },
              { label: "Getting there (< 3 weeks)", value: data.states.young, color: "var(--c-young)" },
              { label: "Well known (3+ weeks)", value: data.states.mature, color: "var(--c-mature)" },
              { label: "Paused or hidden", value: data.states.paused, color: "var(--c-paused)" },
            ]}
          />
        </div>`}
  </div>`;
}

function TableView({ head, rows }) {
  return html`<details class="tableview">
    <summary>Show as table</summary>
    <table>
      <thead><tr>${head.map((h) => html`<th>${h}</th>`)}</tr></thead>
      <tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody>
    </table>
  </details>`;
}

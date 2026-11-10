// App shell: sidebar, routing, global shortcuts, import.
import {
  html, render, useState, useEffect, useRef, useApi, api, bump, go, useRoute, useKeys, Icon, Toasts, Dialogs, Spinner,
  toast, toastError, MOD, plural,
} from "./lib.js";
import { Home, createDeck } from "./home.js";
import { Study } from "./study.js";
import { AddSheet } from "./add.js";
import { Library } from "./library.js";
import { DeckPage } from "./deck.js";
import { Stats } from "./stats.js";
import { Settings, applyTheme } from "./settings.js";
import { Welcome } from "./onboarding.js";

function App() {
  const [boot, setBoot] = useState(null);
  const [adding, setAdding] = useState(null); // null | {deckId}
  const route = useRoute();
  const fileRef = useRef();
  const afterImport = useRef(null);

  const loadBoot = () =>
    api("/api/boot")
      .then((b) => {
        applyTheme(b.theme);
        setBoot(b);
      })
      .catch((e) => setBoot({ ok: false, error: e.message }));
  useEffect(() => {
    loadBoot();
  }, []);

  const openAdd = (deckId) => setAdding({ deckId });
  const startImport = (then) => {
    afterImport.current = then || null;
    fileRef.current.value = "";
    fileRef.current.click();
  };
  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast(`Importing ${file.name}…`, { duration: 2000 });
    try {
      const r = await api("/api/import", undefined, {
        raw: await file.arrayBuffer(),
        headers: { "X-Filename": encodeURIComponent(file.name) },
      });
      bump();
      const parts = [plural(r.new, "new note")];
      if (r.updated) parts.push(`${r.updated} updated`);
      if (r.duplicates) parts.push(`${r.duplicates} already there`);
      toast(`Imported ${file.name}: ${parts.join(", ")}`, { duration: 5000 });
      afterImport.current?.();
      afterImport.current = null;
    } catch (err) {
      toastError(err);
    }
  };

  const studying = route.name === "study";
  useKeys(
    studying || adding
      ? {}
      : {
          "mod+n": () => openAdd(route.name === "deck" ? route.id : null),
          "mod+1": () => go("home"),
          "mod+2": () => go("library"),
          "mod+3": () => go("stats"),
          "mod+,": () => go("settings"),
          "mod+f": () => (route.name !== "library" ? go("library") : false),
        },
    [studying, adding, route.name, route.id]
  );

  const fileInput = html`<input ref=${fileRef} type="file" accept=".apkg" style="display:none" onChange=${onFile} />`;

  if (!boot) return html`<${Spinner} />`;
  if (!boot.ok)
    return html`<div class="welcome"><div class="welcome-inner">
      <h1>Lumen couldn't open your cards</h1>
      <p class="lead">${boot.error}</p>
      <div class="row" style="margin-top:22px"><button class="btn primary" onClick=${loadBoot}>Try again</button></div>
    </div></div>`;

  if (boot.empty && !boot.onboarded)
    return html`<${Welcome} boot=${boot} onDone=${loadBoot} onImport=${startImport} />${fileInput}<${Toasts} /><${Dialogs} />`;

  let page;
  switch (route.name) {
    case "study":
      page = html`<${Study} deckId=${route.id} key=${route.id || "all"} />`;
      break;
    case "library":
      page = html`<${Library} params=${route.params} />`;
      break;
    case "deck":
      page = html`<${DeckPage} id=${route.id} onAdd=${openAdd} key=${route.id} />`;
      break;
    case "stats":
      page = html`<${Stats} params=${route.params} />`;
      break;
    case "settings":
      page = html`<${Settings} boot=${boot} onBoot=${(b) => setBoot(b)} />`;
      break;
    default:
      page = html`<${Home} onAdd=${(id) => openAdd(id)} onImport=${() => startImport()} />`;
  }

  return html`
    <div class="shell">
      <${Sidebar} route=${route} onAdd=${() => openAdd(route.name === "deck" ? route.id : null)} onImport=${() => startImport()} />
      <main class="main">${page}</main>
    </div>
    ${adding && html`<${AddSheet} deckId=${adding.deckId} onClose=${() => setAdding(null)} />`}
    ${fileInput}
    <${Toasts} />
    <${Dialogs} />
  `;
}

function Sidebar({ route, onAdd, onImport }) {
  const { data } = useApi("/api/home");
  const [open, setOpen] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("lumen.open") || "{}");
    } catch {
      return {};
    }
  });
  const toggle = (id) => {
    const next = { ...open, [id]: !open[id] };
    setOpen(next);
    try {
      localStorage.setItem("lumen.open", JSON.stringify(next));
    } catch {}
  };
  const nav = (name, icon, label, key, badge) => html`<button
    class="nav-item ${route.name === name ? "active" : ""}"
    onClick=${() => go(name)}
  >
    <${Icon} name=${icon} /> ${label}
    ${badge ? html`<span class="badge accent">${badge}</span>` : html`<span class="kbd-hint">${key}</span>`}
  </button>`;

  const tree = (nodes) =>
    nodes.map(
      (d) => html`<div key=${d.id}>
        <div class="tree-row" style=${{ paddingLeft: d.level > 1 ? (d.level - 1) * 14 + "px" : 0 }}>
          ${d.children.length
            ? html`<button class="twisty ${open[d.id] ? "open" : ""}" aria-label=${open[d.id] ? "Collapse" : "Expand"} onClick=${() => toggle(d.id)}><${Icon} name="chevron-right" /></button>`
            : html`<span style="width:18px;flex:none"></span>`}
          <button class="nav-item ${route.name === "deck" && +route.id === d.id ? "active" : ""}" onClick=${() => go("deck/" + d.id)} title=${d.full_name}>
            <span class="name">${d.name}</span>
            ${d.due ? html`<span class="badge">${d.due}</span>` : ""}
          </button>
        </div>
        ${open[d.id] && d.children.length > 0 && tree(d.children)}
      </div>`
    );

  return html`<nav class="sidebar" aria-label="Main">
    <div class="brand"><span class="brand-mark"><${Icon} name="sparkles" /></span> Lumen</div>
    <button class="btn primary new-card-btn" onClick=${onAdd}><${Icon} name="plus" size="sm" /> New card <span class="kbd">${MOD}N</span></button>
    <div class="nav">
      ${nav("home", "house", "Today", MOD + "1", data?.total)}
      ${nav("library", "library-big", "Library", MOD + "2")}
      ${nav("stats", "chart-column", "Progress", MOD + "3")}
    </div>
    <div class="side-section">
      <span>Decks</span>
      <button class="btn ghost sm icon-only" title="New deck" aria-label="New deck" onClick=${async () => { const id = await createDeck(); id && go("deck/" + id); }}><${Icon} name="plus" size="sm" /></button>
    </div>
    <div class="deck-tree">${data ? tree(data.decks) : ""}</div>
    <div class="side-foot">
      <button class="nav-item" onClick=${onImport}><${Icon} name="upload" /> Import deck</button>
      <button class="nav-item ${route.name === "settings" ? "active" : ""}" onClick=${() => go("settings")}><${Icon} name="settings" /> Settings</button>
      <div class="sync-note"><${Icon} name="cloud" size="sm" /> Sync with AnkiWeb: coming soon</div>
    </div>
  </nav>`;
}

render(html`<${App} />`, document.getElementById("app"));

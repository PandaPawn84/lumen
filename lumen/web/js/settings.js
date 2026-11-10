// App settings.
import { html, useState, useApi, api, bump, toast, toastError, Icon, Switch, Spinner, ask, MOD } from "./lib.js";

export function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function Settings({ boot, onBoot }) {
  const { data } = useApi("/api/settings");
  const [theme, setTheme] = useState(boot.theme || "system");

  const changeTheme = async (t) => {
    setTheme(t);
    applyTheme(t);
    await api("/api/prefs", { theme: t }).catch(toastError);
  };
  const save = async (patch) => {
    try {
      await api("/api/settings", patch);
      bump();
      toast("Saved");
    } catch (e) {
      toastError(e);
    }
  };
  const openCollection = async (c, copy) => {
    const ok = await ask({
      title: copy ? "Copy your Anki collection?" : "Open your Anki collection directly?",
      message: copy
        ? "Quit Anki first. Lumen copies your cards and media into its own folder. Your Anki stays exactly as it is, and changes in one won't appear in the other. This replaces the cards currently in Lumen (a backup is kept)."
        : "Quit Anki first, and don't run both at once. Lumen and Anki will share the same cards and progress. Make a backup in Anki before trying this.",
      confirm: copy ? "Copy and open" : "Open directly",
    });
    if (!ok) return;
    try {
      const b = await api(copy ? "/api/collection/copy" : "/api/collection/open", { path: c.path });
      onBoot(b);
      bump();
      toast("Collection opened");
    } catch (e) {
      toastError(e);
    }
  };

  if (!data) return html`<${Spinner} />`;

  return html`<div class="page" style="max-width:760px">
    <div class="page-head"><div><h1>Settings</h1></div></div>

    <div class="panel panel-pad">
      <h2 style="margin-bottom:6px">Appearance</h2>
      <div class="settings-list">
        <div class="set-row">
          <div class="s-text"><b>Theme</b><span>Follow your Mac's setting, or choose one.</span></div>
          <div class="s-ctrl seg">
            ${[["system", "Automatic"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => html`<button class=${theme === k ? "on" : ""} onClick=${() => changeTheme(k)}>${l}</button>`)}
          </div>
        </div>
      </div>
    </div>

    <div class="panel panel-pad section">
      <h2 style="margin-bottom:6px">Studying</h2>
      <div class="settings-list">
        <div class="set-row">
          <div class="s-text"><b>New day starts at</b><span>Cards due “today” roll over at this hour, so late-night study counts for the right day.</span></div>
          <div class="s-ctrl">
            <select class="input" value=${data.rollover} onChange=${(e) => save({ rollover: +e.target.value })}>
              ${Array.from({ length: 24 }, (_, h) => html`<option value=${h}>${new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" })}</option>`)}
            </select>
          </div>
        </div>
        <div class="set-row">
          <div class="s-text"><b>Smarter scheduling (FSRS)</b><span>A modern algorithm that learns how you remember and schedules fewer, better-timed reviews.</span></div>
          <div class="s-ctrl"><${Switch} checked=${data.fsrs} onChange=${(v) => save({ fsrs: v })} label="FSRS" /></div>
        </div>
      </div>
    </div>

    <div class="panel panel-pad section">
      <h2 style="margin-bottom:6px">Your cards</h2>
      <div class="settings-list">
        <div class="set-row">
          <div class="s-text"><b>Collection file</b><span class="selectable" style="word-break:break-all">${data.path}</span></div>
        </div>
        ${boot.anki_collections.map(
          (c) => html`<div class="set-row">
            <div class="s-text"><b>Anki profile “${c.profile}”</b><span>Found on this computer.</span></div>
            <div class="s-ctrl">
              <button class="btn sm" onClick=${() => openCollection(c, true)}>Copy into Lumen</button>
              <button class="btn sm ghost" onClick=${() => openCollection(c, false)}>Open directly</button>
            </div>
          </div>`
        )}
        ${data.path !== boot.default_path &&
        html`<div class="set-row">
          <div class="s-text"><b>Lumen's own collection</b><span>Switch back to the cards stored in Lumen's folder.</span></div>
          <div class="s-ctrl"><button class="btn sm" onClick=${async () => { try { onBoot(await api("/api/collection/open", { path: boot.default_path })); bump(); } catch (e) { toastError(e); } }}>Switch</button></div>
        </div>`}
      </div>
    </div>

    <div class="panel panel-pad section">
      <div class="row" style="justify-content:space-between">
        <h2>AnkiWeb sync</h2><span class="badge">Coming soon</span>
      </div>
      <p class="hint" style="margin-top:6px">Sync your cards with AnkiWeb, AnkiMobile and AnkiDroid. Lumen's engine already supports it; the sign-in and conflict screens are next on the list.</p>
    </div>

    <div class="panel panel-pad section">
      <h2 style="margin-bottom:10px">Keyboard shortcuts</h2>
      <dl class="info-grid" style="grid-template-columns:150px 1fr;font-size:13px">
        <dt>${MOD}N</dt><dd>New card</dd>
        <dt>${MOD}1 / 2 / 3</dt><dd>Home / Library / Progress</dd>
        <dt>${MOD}F</dt><dd>Search the library</dd>
        <dt>Space or Enter</dt><dd>Show answer, then “Good”</dd>
        <dt>1 2 3 4</dt><dd>Again · Hard · Good · Easy</dd>
        <dt>E</dt><dd>Edit the current card</dd>
        <dt>Z or ${MOD}Z</dt><dd>Undo</dd>
        <dt>Esc</dt><dd>Leave study mode</dd>
      </dl>
    </div>

    <p class="hint section" style="text-align:center">Lumen 0.1 · built on Anki's open-source engine (AGPL-3.0)</p>
  </div>`;
}

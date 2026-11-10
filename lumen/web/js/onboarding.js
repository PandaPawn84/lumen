// First run: explain the idea in one screen and offer three ways to start.
import { html, useState, api, bump, toastError, Icon, ask } from "./lib.js";

export function Welcome({ boot, onDone, onImport }) {
  const [busy, setBusy] = useState(false);
  const finish = async (fn) => {
    setBusy(true);
    try {
      const b = await fn();
      await api("/api/prefs", { onboarded: true });
      bump();
      onDone(b);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  const anki = boot.anki_collections[0];

  return html`<div class="welcome">
    <div class="welcome-inner">
      <div class="brand-mark"><${Icon} name="sparkles" /></div>
      <h1>Welcome to Lumen</h1>
      <p class="lead">Remember anything with a few minutes a day. Lumen uses spaced repetition: it shows each card again just before you'd forget it.</p>

      <div class="how">
        <div class="tile"><div class="step-n">1</div><b>Add what you want to learn</b><p>A question on the front, the answer on the back. Or hide words in a sentence.</p></div>
        <div class="tile"><div class="step-n">2</div><b>Study a little each day</b><p>Try to recall, reveal the answer, then say how well you knew it.</p></div>
        <div class="tile"><div class="step-n">3</div><b>Lumen handles the timing</b><p>Easy cards come back rarely, tricky ones sooner. You just show up.</p></div>
      </div>

      <h2 style="margin-bottom:12px">How would you like to start?</h2>
      <div class="choices">
        ${anki &&
        html`<button class="choice primary" disabled=${busy} onClick=${async () => {
          const ok = await ask({
            title: "Bring over your Anki cards?",
            message: `Quit Anki first. Lumen copies your “${anki.profile}” collection and media into its own folder, so your Anki stays exactly as it is.`,
            confirm: "Copy my cards",
          });
          ok && finish(() => api("/api/collection/copy", { path: anki.path }));
        }}>
          <span class="c-icon"><${Icon} name="folder-input" /></span>
          <span><b>Bring over my Anki cards</b><span>Found Anki profile “${anki.profile}” on this computer. Your progress comes too.</span></span>
          <${Icon} name="chevron-right" />
        </button>`}
        <button class="choice ${anki ? "" : "primary"}" disabled=${busy} onClick=${() => finish(() => api("/api/sample", {}))}>
          <span class="c-icon"><${Icon} name="graduation-cap" /></span>
          <span><b>Try a sample deck</b><span>12 world capitals, to see how studying feels. Delete it any time.</span></span>
          <${Icon} name="chevron-right" />
        </button>
        <button class="choice" disabled=${busy} onClick=${() => onImport(() => finish(async () => ({})))}>
          <span class="c-icon"><${Icon} name="upload" /></span>
          <span><b>Import a deck file</b><span>An Anki deck (.apkg) you downloaded or were sent.</span></span>
          <${Icon} name="chevron-right" />
        </button>
        <button class="choice" disabled=${busy} onClick=${() => finish(async () => ({}))}>
          <span class="c-icon"><${Icon} name="plus" /></span>
          <span><b>Start from scratch</b><span>Begin with an empty collection and add your own cards.</span></span>
          <${Icon} name="chevron-right" />
        </button>
      </div>
    </div>
  </div>`;
}

// Shared building blocks: rendering, API calls, routing, toasts, shortcuts.
import { h, render, Fragment } from "../vendor/preact.mjs";
import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from "../vendor/hooks.mjs";
import htm from "../vendor/htm.mjs";
import { ICONS } from "./icons.js";

export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect };

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = IS_MAC ? "⌘" : "Ctrl+";

// ------------------------------------------------------------------ API
export class ApiError extends Error {}

export async function api(path, body, opts = {}) {
  const init = {
    method: body === undefined && !opts.raw ? "GET" : "POST",
    headers: { "X-Lumen-Token": window.LUMEN_TOKEN, ...(opts.headers || {}) },
  };
  if (opts.raw) init.body = opts.raw;
  else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Lost connection to Lumen's engine. Try restarting the app.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`);
  return data;
}

// Global "something changed" counter: views that show collection data
// re-fetch when it changes.
const listeners = new Set();
let version = 0;
export function bump() {
  version++;
  listeners.forEach((fn) => fn(version));
}
export function useVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => listeners.delete(setV);
  }, []);
  return v;
}

/** Load data from the API; re-runs when deps or the global version change. */
export function useApi(path, deps = []) {
  const v = useVersion();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, [path, v, ...deps]);
  return state;
}

// ------------------------------------------------------------------ routing
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "home";
  const [path, qs] = raw.split("?");
  const parts = path.split("/");
  return { name: parts[0], id: parts[1], params: Object.fromEntries(new URLSearchParams(qs || "")) };
}
export function go(path) {
  location.hash = "#/" + path;
}
export function useRoute() {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    const on = () => setR(parseHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r;
}

// ------------------------------------------------------------------ toasts
let toastSet = null;
let toastId = 0;
export function toast(message, opts = {}) {
  if (!toastSet) return;
  const id = ++toastId;
  const t = { id, message, ...opts };
  toastSet((list) => [...list.slice(-2), t]);
  setTimeout(() => toastSet((list) => list.filter((x) => x.id !== id)), opts.duration || (opts.action ? 6000 : 3200));
}
export function toastError(e) {
  toast(e?.message || String(e), { kind: "error", duration: 5000 });
}
/** Toast with an Undo button that calls the engine's undo. */
export function toastUndo(message, after) {
  toast(message, {
    action: {
      label: "Undo",
      run: async () => {
        try {
          const r = await api("/api/undo", {});
          bump();
          after?.(r);
          if (r.undone) toast(`Undid “${r.undone}”`);
        } catch (e) {
          toastError(e);
        }
      },
    },
  });
}
export function Toasts() {
  const [list, setList] = useState([]);
  toastSet = setList;
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.map(
      (t) => html`<div class="toast ${t.kind || ""}" key=${t.id}>
        <span>${t.message}</span>
        ${t.action &&
        html`<button
          onClick=${() => {
            setList((l) => l.filter((x) => x.id !== t.id));
            t.action.run();
          }}
        >
          ${t.action.label}
        </button>`}
      </div>`
    )}
  </div>`;
}

// ------------------------------------------------------------------ shortcuts
/** Bind keys while the component is mounted. keys: {"mod+n": fn, "space": fn} */
// While a sheet or dialog is open, the page underneath ignores shortcuts.
let modalDepth = 0;

export function useKeys(map, _deps, opts = {}) {
  // Always read the latest handlers, so a key pressed right after a re-render
  // never runs a stale version.
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (modalDepth > 0 && !opts.modal) return;
      const typing = isTyping(e.target);
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      let k = e.key.toLowerCase();
      if (k === " ") k = "space";
      const combo = (mod ? "mod+" : "") + (e.shiftKey && k.length > 1 ? "shift+" : "") + k;
      const fn = ref.current[combo];
      if (!fn) return;
      if (typing && !mod && combo !== "escape") return;
      if (e.repeat && !mod) return;
      if (fn(e) !== false) e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}
export function isTyping(el) {
  return el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

// ------------------------------------------------------------------ components
export function Icon({ name, size = "", cls = "" }) {
  const body = ICONS[name] || "";
  return html`<svg
    class="icon ${size} ${cls}"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: body }}
  ></svg>`;
}

export function Kbd({ children }) {
  return html`<span class="kbd">${children}</span>`;
}

export function Modal({ title, onClose, children, foot, size = "" }) {
  useEffect(() => {
    modalDepth++;
    return () => {
      modalDepth--;
    };
  }, []);
  useEffect(() => {
    const esc = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose?.();
    };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, [onClose]);
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-head">
        <h2>${title}</h2>
        <button class="btn ghost icon-only sm" aria-label="Close" onClick=${onClose}><${Icon} name="x" /></button>
      </div>
      <div class="modal-body">${children}</div>
      ${foot && html`<div class="modal-foot">${foot}</div>`}
    </div>
  </div>`;
}

let dialogSet = null;
/** Promise-based confirm / prompt dialogs. */
export function ask({ title, message, confirm = "OK", danger = false, input = null, placeholder = "" }) {
  return new Promise((resolve) => dialogSet?.({ title, message, confirm, danger, input, placeholder, resolve }));
}
export function Dialogs() {
  const [d, setD] = useState(null);
  dialogSet = setD;
  const [val, setVal] = useState("");
  const ref = useRef();
  useEffect(() => {
    if (d) {
      setVal(d.input ?? "");
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [d]);
  if (!d) return null;
  const close = (v) => {
    setD(null);
    d.resolve(v);
  };
  const ok = () => close(d.input !== null ? val.trim() || null : true);
  return html`<${Modal}
    title=${d.title}
    size="sm"
    onClose=${() => close(null)}
    foot=${html`<button class="btn" onClick=${() => close(null)}>Cancel</button>
      <button ref=${d.input === null ? ref : null} class="btn ${d.danger ? "danger solid" : "primary"}" onClick=${ok}>
        ${d.confirm}
      </button>`}
  >
    ${d.message && html`<p class="subtle" style="margin-bottom:${d.input !== null ? 12 : 0}px">${d.message}</p>`}
    ${d.input !== null &&
    html`<input
      ref=${ref}
      autofocus
      class="input"
      value=${val}
      placeholder=${d.placeholder}
      onInput=${(e) => setVal(e.target.value)}
      onKeyDown=${(e) => e.key === "Enter" && ok()}
    />`}
  <//>`;
}

export function Menu({ trigger, children, up = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const off = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    addEventListener("mousedown", off);
    addEventListener("keydown", esc, true);
    return () => {
      removeEventListener("mousedown", off);
      removeEventListener("keydown", esc, true);
    };
  }, [open]);
  return html`<div class="menu-wrap" ref=${ref}>
    ${trigger(() => setOpen((o) => !o), open)}
    ${open && html`<div class="menu ${up ? "up" : ""}" onClick=${() => setOpen(false)}>${children}</div>`}
  </div>`;
}

export function Switch({ checked, onChange, label }) {
  return html`<label class="switch" aria-label=${label}>
    <input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} />
    <span></span>
  </label>`;
}

export function Spinner() {
  return html`<div class="center-fill"><div class="spinner"></div></div>`;
}

export function ErrorBox({ error, retry }) {
  return html`<div class="empty">
    <div class="e-icon"><${Icon} name="info" /></div>
    <h3>Something went wrong</h3>
    <p>${error?.message || String(error)}</p>
    ${retry && html`<button class="btn" onClick=${retry}>Try again</button>`}
  </div>`;
}

// ------------------------------------------------------------------ formatting
export const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function dueLabel(state, dueIn) {
  if (state === "new") return "New";
  if (state === "suspended") return "Paused";
  if (state === "buried") return "Tomorrow";
  if (dueIn === null || dueIn === undefined) return "Today";
  if (dueIn <= 0) return dueIn < 0 ? `Overdue ${-dueIn}d` : "Today";
  if (dueIn === 1) return "Tomorrow";
  if (dueIn < 31) return `In ${dueIn} days`;
  if (dueIn < 365) return `In ${Math.round(dueIn / 30)} mo`;
  return `In ${(dueIn / 365).toFixed(1)} yr`;
}

export function minutes(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? "Good evening" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
}

export const STATE_LABEL = { new: "New", learning: "Learning", review: "Review", suspended: "Paused", buried: "Buried" };
export const FLAGS = [
  { n: 1, name: "Red", color: "#e5484d" },
  { n: 2, name: "Orange", color: "#f08c28" },
  { n: 3, name: "Green", color: "#30a46c" },
  { n: 4, name: "Blue", color: "#3e7bfa" },
  { n: 5, name: "Pink", color: "#e66eb5" },
  { n: 6, name: "Turquoise", color: "#12a594" },
  { n: 7, name: "Purple", color: "#8e4ec6" },
];

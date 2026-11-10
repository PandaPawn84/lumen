// Renders a card's HTML in a sandboxed iframe. The sandbox allows the card's
// own scripts but gives it no access to the app (no same-origin).
import { html, useEffect, useRef, useState } from "./lib.js";

const BASE_CSS = `
html, body { margin: 0; padding: 0; background: transparent; }
body { padding: 4px 2px; overflow: hidden; }
body.nightMode { color: #ecebe8; }
.card { background-color: transparent !important; }
img { max-width: 100%; height: auto; }
hr#answer { border: none; border-top: 1px solid rgba(128,128,128,.3); margin: 22px auto; width: 70%; }
.cloze { font-weight: bold; color: #3e49b8; }
.nightMode .cloze { color: #a4abf5; }
.lumen-play { width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(128,128,128,.35);
  background: rgba(128,128,128,.08); color: inherit; font-size: 13px; cursor: pointer; vertical-align: middle; margin: 2px 4px; }
.lumen-play:hover { background: rgba(128,128,128,.18); }
.lumen-type-result { font-family: ui-monospace, Menlo, monospace; font-size: 17px; margin: 10px 0; }
.typeGood { background: #b7efc5; color: #000; } .typeBad { background: #ffc2bd; color: #000; } .typeMissed { background: #ddd; color: #000; }
.nightMode .latex { filter: invert(100%); }
.nightMode img.drawing { filter: invert(1) hue-rotate(180deg); }
`;

const FRAME_SCRIPT = (autoplay) => `
<script>
(function(){
  var base = document.querySelector("base").href;
  var current;
  function play(file){ try { if (current) current.pause(); current = new Audio(base + encodeURIComponent(file)); current.play().catch(function(){}); } catch(e){} }
  document.addEventListener("click", function(e){
    var b = e.target.closest(".lumen-play"); if (b) { e.preventDefault(); play(b.dataset.file); }
  });
  var queue = ${JSON.stringify(autoplay)};
  if (queue.length) { var i = 0; (function next(){ if (i >= queue.length) return; current = new Audio(base + encodeURIComponent(queue[i++])); current.onended = next; current.play().catch(function(){}); })(); }
  function size(){ parent.postMessage({ lumenHeight: Math.ceil(document.documentElement.scrollHeight) }, "*"); }
  new ResizeObserver(size).observe(document.body);
  window.addEventListener("load", size);
  document.querySelectorAll("img").forEach(function(img){ img.addEventListener("load", size); });
  // let the app keep its keyboard shortcuts while the card has focus
  document.addEventListener("keydown", function(e){
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    parent.postMessage({ lumenKey: { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey } }, "*");
  });
  size();
})();
<\/script>`;

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

export function CardFrame({ body, css, ord = 0, audio = [], minHeight = 120 }) {
  const ref = useRef();
  const [height, setHeight] = useState(minHeight);
  useEffect(() => {
    const on = (e) => {
      if (e.source !== ref.current?.contentWindow) return;
      if (e.data?.lumenHeight) setHeight(Math.max(minHeight, e.data.lumenHeight));
      if (e.data?.lumenKey) {
        const k = e.data.lumenKey;
        dispatchEvent(new KeyboardEvent("keydown", { key: k.key, metaKey: k.meta, ctrlKey: k.ctrl, shiftKey: k.shift }));
      }
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, [minHeight]);

  const dark = isDark();
  const doc = `<!doctype html><html class="${dark ? "night-mode" : ""}" style="color-scheme:${dark ? "dark" : "light"}"><head><meta charset="utf-8">
<meta name="color-scheme" content="${dark ? "dark" : "light"}">
<base href="${location.origin}/media/">
<style>${BASE_CSS}</style><style>${css || ""}</style></head>
<body class="card card${ord + 1} ${dark ? "nightMode night_mode" : ""}">${body}${FRAME_SCRIPT(audio.map((a) => a.file))}</body></html>`;

  return html`<iframe
    ref=${ref}
    class="card-frame"
    sandbox="allow-scripts"
    title="Card"
    srcdoc=${doc}
    style=${{ height: height + "px" }}
  ></iframe>`;
}

// Note editing: rich text fields, tags, deck & type pickers.
import { html, useState, useEffect, useLayoutEffect, useRef, Icon, MOD, api } from "./lib.js";

/** A contenteditable field. Pasted content becomes plain text to keep cards clean. */
export function RichField({ label, value, onChange, placeholder, autofocus, cloze, onSubmit, warn }) {
  const ref = useRef();
  // The box owns its text while you type in it. Outside values (loading a
  // note, clearing after "Add") are applied only when it isn't focused, or on
  // first mount, so a slightly older value can never overwrite fresh typing.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el && el.dataset.ready) return;
    if (el.innerHTML !== (value || "")) el.innerHTML = value || "";
    el.dataset.ready = "1";
  }, [value]);
  useEffect(() => {
    if (autofocus) setTimeout(() => focusEnd(ref.current), 30);
  }, [autofocus]);

  const emit = () => onChange(cleanHtml(ref.current.innerHTML));
  const cmd = (c) => {
    ref.current.focus();
    document.execCommand(c);
    emit();
  };
  const addCloze = () => {
    const el = ref.current;
    el.focus();
    const n = nextCloze(el.innerHTML);
    const sel = getSelection();
    const text = sel && sel.rangeCount && el.contains(sel.anchorNode) ? sel.toString() : "";
    document.execCommand("insertText", false, `{{c${n}::${text || "…"}}}`);
    emit();
  };

  return html`<div class="field">
    <div class="field-head">
      <label>${label}</label>
      <div class="fmt">
        <button type="button" title="Bold (${MOD}B)" onMouseDown=${(e) => (e.preventDefault(), cmd("bold"))}>B</button>
        <button type="button" title="Italic (${MOD}I)" onMouseDown=${(e) => (e.preventDefault(), cmd("italic"))}><i>I</i></button>
        <button type="button" title="Underline (${MOD}U)" onMouseDown=${(e) => (e.preventDefault(), cmd("underline"))}><u>U</u></button>
        ${cloze &&
        html`<button type="button" title="Hide the selected text (${MOD}Shift+C)" style="width:auto;padding:0 6px" onMouseDown=${(e) => (e.preventDefault(), addCloze())}>[…]</button>`}
      </div>
    </div>
    <div
      ref=${ref}
      class="rich"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      aria-label=${label}
      data-placeholder=${placeholder || ""}
      onInput=${emit}
      onPaste=${(e) => {
        e.preventDefault();
        const t = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, t);
      }}
      onKeyDown=${(e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === "Enter") {
          e.preventDefault();
          onSubmit?.();
        } else if (cloze && mod && e.shiftKey && e.key.toLowerCase() === "c") {
          e.preventDefault();
          addCloze();
        }
      }}
    ></div>
    ${warn}
  </div>`;
}

function focusEnd(el) {
  if (!el) return;
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function cleanHtml(s) {
  // WebKit leaves a lone <br> in emptied fields
  return s === "<br>" ? "" : s;
}

function nextCloze(text) {
  const nums = [...text.matchAll(/\{\{c(\d+)::/g)].map((m) => +m[1]);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function TagInput({ tags, onChange }) {
  const [text, setText] = useState("");
  const commit = () => {
    const parts = text.split(/[\s,]+/).filter(Boolean);
    if (parts.length) onChange([...new Set([...tags, ...parts])]);
    setText("");
  };
  return html`<div class="field">
    <label>Tags <span class="muted" style="font-weight:400">— optional, for grouping and searching</span></label>
    <div class="tags-input">
      ${tags.map(
        (t) => html`<span class="tag" key=${t}
          >${t}<button aria-label="Remove ${t}" onClick=${() => onChange(tags.filter((x) => x !== t))}><${Icon} name="x" /></button
        ></span>`
      )}
      <input
        value=${text}
        placeholder=${tags.length ? "" : "e.g. vocabulary chapter-3"}
        onInput=${(e) => setText(e.target.value)}
        onBlur=${commit}
        onKeyDown=${(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === ",") {
            if (text.trim()) {
              e.preventDefault();
              commit();
            }
          } else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
        }}
      />
    </div>
  </div>`;
}

export function DeckSelect({ decks, value, onChange, label = "Deck" }) {
  return html`<div class="field">
    <label>${label}</label>
    <select class="input" value=${value} onChange=${(e) => onChange(+e.target.value)}>
      ${decks.map((d) => html`<option value=${d.id}>${d.name.replaceAll("::", " › ")}</option>`)}
    </select>
  </div>`;
}

/** Field list for an existing note, used by Library and the study editor. */
export function NoteForm({ detail, decks, onSave, onSaved, compact }) {
  const [fields, setFields] = useState(detail.fields.map((f) => f.value));
  const [tags, setTags] = useState(detail.tags);
  const [deck, setDeck] = useState(detail.deck_id);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setFields(detail.fields.map((f) => f.value));
    setTags(detail.tags);
    setDeck(detail.deck_id);
  }, [detail.note_id]);
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(detail.fields.map((f) => f.value)) ||
    JSON.stringify(tags) !== JSON.stringify(detail.tags) ||
    deck !== detail.deck_id;
  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/notes/${detail.note_id}`, { fields, tags, deck_id: deck });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };
  onSave && (onSave.current = { save, dirty });
  const isCloze = detail.fields.some((f) => /\{\{c\d+::/.test(f.value));
  return html`<div class="editor">
    ${detail.fields.map(
      (f, i) => html`<${RichField}
        key=${detail.note_id + ":" + i}
        label=${f.label}
        value=${fields[i]}
        cloze=${isCloze && i === 0}
        onSubmit=${() => dirty && save()}
        onChange=${(v) => setFields((fs) => fs.map((x, j) => (j === i ? v : x)))}
      />`
    )}
    <${TagInput} tags=${tags} onChange=${setTags} />
    ${decks && !compact && html`<${DeckSelect} decks=${decks} value=${deck} onChange=${setDeck} />`}
    ${!onSave &&
    html`<div class="row" style="justify-content:flex-end">
      <button class="btn primary" disabled=${!dirty || saving} onClick=${save}>
        ${saving ? "Saving…" : "Save changes"}
      </button>
    </div>`}
  </div>`;
}

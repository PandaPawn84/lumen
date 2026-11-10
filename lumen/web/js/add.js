// "New card" sheet. Opens from anywhere with ⌘N and stays open for the next card.
import { html, useState, useEffect, useRef, api, bump, toast, toastError, toastUndo, Modal, Icon, Kbd, MOD, Spinner, ask, useKeys } from "./lib.js";
import { RichField, TagInput, DeckSelect } from "./editor.js";

const PLACEHOLDERS = {
  Question: "What do you want to be asked?",
  Answer: "The answer you want to remember",
  Text: "Write a sentence and hide parts of it with […] or " + MOD + "Shift+C",
  "Extra info": "Optional notes shown with the answer",
};

export function AddSheet({ onClose, deckId }) {
  const [types, setTypes] = useState(null);
  const [decks, setDecks] = useState(null);
  const [typeId, setTypeId] = useState(null);
  const [deck, setDeck] = useState(null);
  const [fields, setFields] = useState([]);
  const [tags, setTags] = useState([]);
  const [dup, setDup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [round, setRound] = useState(0);
  const [added, setAdded] = useState(0);

  useEffect(() => {
    Promise.all([api("/api/notetypes"), api("/api/decks/choices"), api("/api/add/defaults")])
      .then(([t, d, def]) => {
        setTypes(t);
        setDecks(d);
        const tid = t.find((x) => x.id === def.notetype_id)?.id ?? t[0]?.id;
        setTypeId(tid);
        setFields((t.find((x) => x.id === tid)?.fields || []).map(() => ""));
        const did = deckId && d.find((x) => x.id === +deckId) ? +deckId : d.find((x) => x.id === def.deck_id)?.id ?? d[0]?.id;
        setDeck(did);
      })
      .catch(toastError);
  }, []);

  const type = types?.find((t) => t.id === typeId);
  const pickType = (id) => {
    const t = types.find((x) => x.id === id);
    // keep what's typed where the field names line up
    setFields((old) => t.fields.map((_, i) => old[i] || ""));
    setTypeId(id);
  };

  // gentle duplicate check on the first field
  useEffect(() => {
    if (!type || !fields[0]) return setDup(false);
    const t = setTimeout(() => {
      api("/api/notes/duplicate", { notetype_id: typeId, fields }).then((r) => setDup(r.duplicate)).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [fields[0], typeId]);

  const newDeck = async () => {
    const name = await ask({ title: "New deck", message: "Use “::” to make a sub-deck, e.g. Spanish::Verbs.", input: "", placeholder: "Deck name", confirm: "Create" });
    if (!name) return;
    try {
      const { id } = await api("/api/decks", { name });
      setDecks(await api("/api/decks/choices"));
      setDeck(id);
      bump();
    } catch (e) {
      toastError(e);
    }
  };

  const submit = async () => {
    if (!type || saving) return;
    setSaving(true);
    try {
      const r = await api("/api/notes", { notetype_id: typeId, deck_id: deck, fields, tags });
      const deckName = decks.find((d) => d.id === deck)?.name.replaceAll("::", " › ");
      toastUndo(r.cards > 1 ? `Added ${r.cards} cards to ${deckName}` : `Card added to ${deckName}`);
      setFields(type.fields.map(() => ""));
      setRound((n) => n + 1);
      setAdded((n) => n + 1);
      setDup(false);
      bump();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  useKeys({ "mod+enter": submit }, [submit], { modal: true });

  const filled = fields[0] && fields[0].replace(/<[^>]+>/g, "").trim();

  return html`<${Modal}
    title="New card"
    onClose=${onClose}
    foot=${html`<span class="left hint">${added ? `${added} added this time` : html`Tip: press <${Kbd}>${MOD}↵<//> to add`}</span>
      <button class="btn" onClick=${onClose}>Close</button>
      <button class="btn primary" disabled=${!filled || saving} onClick=${submit}>Add card <${Kbd}>${MOD}↵<//></button>`}
  >
    ${!types || !decks
      ? html`<div style="height:200px"><${Spinner} /></div>`
      : html`<div class="editor">
          <div class="field">
            <label>Card type</label>
            <div class="type-picker">
              ${types.slice(0, 6).map(
                (t) => html`<button class="type-opt ${t.id === typeId ? "on" : ""}" onClick=${() => pickType(t.id)}>
                  <b>${t.label}</b><span>${t.description || plural(t.uses)}</span>
                </button>`
              )}
            </div>
            ${types.length > 6 &&
            html`<select class="input" style="margin-top:6px" value=${typeId} onChange=${(e) => pickType(+e.target.value)}>
              ${types.map((t) => html`<option value=${t.id}>${t.label}</option>`)}
            </select>`}
          </div>
          <div class="row" style="align-items:flex-end">
            <div class="grow"><${DeckSelect} decks=${decks} value=${deck} onChange=${setDeck} /></div>
            <button class="btn" onClick=${newDeck}><${Icon} name="folder-plus" size="sm" /> New deck</button>
          </div>
          ${type &&
          type.fields.map(
            (f, i) => html`<${RichField}
              key=${typeId + ":" + i + ":" + round}
              label=${f.label}
              value=${fields[i] || ""}
              placeholder=${PLACEHOLDERS[f.label] || ""}
              autofocus=${i === 0}
              cloze=${type.is_cloze && i === 0}
              onSubmit=${submit}
              onChange=${(v) => setFields((fs) => fs.map((x, j) => (j === i ? v : x)))}
              warn=${i === 0 && dup && html`<div class="dup-warn"><${Icon} name="info" size="sm" /> You already have a card that starts like this. You can still add it.</div>`}
            />`
          )}
          <${TagInput} tags=${tags} onChange=${setTags} />
        </div>`}
  <//>`;
}

function plural(n) {
  return n ? `Used by ${n} note${n === 1 ? "" : "s"}` : "Custom type";
}

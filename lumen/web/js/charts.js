// Small, dependency-free SVG charts with hover tooltips.
import { html, useState, useRef, useLayoutEffect } from "./lib.js";

/** Single-series bar chart. One hue, rounded tops anchored to the baseline. */
export function BarChart({ values, labels, tip, height = 160, axis = true, compact = false, every = 1 }) {
  const ref = useRef();
  const [w, setW] = useState(600);
  const [hover, setHover] = useState(null);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const padL = axis ? 30 : 0;
  const padB = compact ? 16 : 22;
  const padT = 8;
  const max = Math.max(1, ...values);
  const nice = niceMax(max);
  const n = values.length;
  const slot = (w - padL) / n;
  const bw = Math.max(3, Math.min(compact ? 22 : 18, slot - 2));
  const ch = height - padB - padT;
  const y = (v) => padT + ch - (v / nice) * ch;
  const ticks = axis ? [0, nice / 2, nice] : [];

  return html`<div class="chart" ref=${ref} onMouseLeave=${() => setHover(null)}>
    <svg height=${height} role="img" aria-label=${values.map((v, i) => `${labels[i]}: ${v}`).join(", ")}>
      <g class="grid">${ticks.map((t) => html`<line x1=${padL} x2=${w} y1=${y(t)} y2=${y(t)} />`)}</g>
      <g class="axis">
        ${ticks.map((t) => html`<text x=${padL - 8} y=${y(t) + 3.5} text-anchor="end">${Math.round(t)}</text>`)}
        ${labels.map((l, i) =>
          i % every === 0 || i === n - 1
            ? html`<text x=${padL + slot * i + slot / 2} y=${height - 4} text-anchor="middle">${l}</text>`
            : null
        )}
      </g>
      ${values.map((v, i) => {
        const x = padL + slot * i + (slot - bw) / 2;
        const top = y(v);
        const hgt = Math.max(v ? 2 : 0, padT + ch - top);
        return html`<g>
          ${v > 0 && html`<path class="bar ${hover === i ? "hl" : ""}" d=${roundTop(x, padT + ch - hgt, bw, hgt, Math.min(4, bw / 2))} />`}
          <rect class="hit" x=${padL + slot * i} y=${padT} width=${slot} height=${ch} onMouseEnter=${() => setHover(i)} />
        </g>`;
      })}
      <line x1=${padL} x2=${w} y1=${padT + ch} y2=${padT + ch} stroke="var(--line-strong)" />
    </svg>
    ${hover !== null &&
    html`<div class="tip" style=${{ left: padL + slot * hover + slot / 2 + "px", top: y(values[hover]) + "px" }}>${tip(values[hover], hover)}</div>`}
  </div>`;
}

function roundTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Horizontal stacked bar with legend + direct values (identity is never colour alone). */
export function StackBar({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return html`<div>
    <div class="stack" role="img" aria-label=${parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
      ${parts.filter((p) => p.value).map((p) => html`<div title="${p.label}: ${p.value}" style=${{ width: (100 * p.value) / total + "%", background: p.color }}></div>`)}
    </div>
    <div class="legend">
      ${parts.map((p) => html`<div><i style=${{ background: p.color }}></i>${p.label} <b>${p.value.toLocaleString()}</b> <span class="muted">${Math.round((100 * p.value) / total)}%</span></div>`)}
    </div>
  </div>`;
}

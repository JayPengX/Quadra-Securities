// Small SVG charts, drawn as strings: sparklines, a price or value chart with
// a hover crosshair, and a 100% bar for allocations. Colours come from CSS
// variables so light and dark themes (and red-up or green-up) just work.
import { escapeHtml } from './format.mjs';

const f = n => (Math.round(n * 10) / 10).toString();

function extent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.01 || 1;
    hi += Math.abs(hi) * 0.01 || 1;
  }
  return [lo, hi];
}

// A tiny line of today's prices, coloured by direction against `base`.
export function sparkline(points, base, { width = 96, height = 30 } = {}) {
  if (!points || points.length < 2) return `<svg class="spark" viewBox="0 0 ${width} ${height}" aria-hidden="true"></svg>`;
  const values = points.map(p => p[1]);
  const [lo, hi] = extent(base != null ? [...values, base] : values);
  const x0 = points[0][0];
  const span = points.at(-1)[0] - x0 || 1;
  const X = t => ((t - x0) / span) * (width - 2) + 1;
  const Y = v => height - 2 - ((v - lo) / (hi - lo)) * (height - 4);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${f(X(p[0]))} ${f(Y(p[1]))}`).join('');
  const dir = values.at(-1) > (base ?? values[0]) ? 'up' : values.at(-1) < (base ?? values[0]) ? 'down' : 'flat';
  const baseLine = base != null ? `<line x1="0" x2="${width}" y1="${f(Y(base))}" y2="${f(Y(base))}" class="spark-base"/>` : '';
  return `<svg class="spark ${dir}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${baseLine}<path d="${d}"/></svg>`;
}

// A full chart. series: [{ points: [[t, v]], cls, label }] (the first is
// the main one, filled below). `base`: a dashed reference (previous close).
// Returns the SVG and what the hover layer needs.
export function lineChart(series, { width = 640, height = 240, base = null, yFormat = v => v, xFormat = t => t, dir = 'flat' } = {}) {
  const pad = { l: 8, r: 64, t: 12, b: 24 };
  const all = series.flatMap(s => s.points.map(p => p[1]));
  if (!all.length) return { svg: '', frame: null };
  const [lo0, hi0] = extent(base != null ? [...all, base] : all);
  const room = (hi0 - lo0) * 0.08;
  const lo = lo0 - room;
  const hi = hi0 + room;
  const ts = series.flatMap(s => s.points.map(p => p[0]));
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const X = t => pad.l + ((t - t0) / (t1 - t0 || 1)) * W;
  const Y = v => pad.t + H - ((v - lo) / (hi - lo)) * H;
  const ticks = [];
  for (let i = 0; i <= 3; i++) ticks.push(lo0 + ((hi0 - lo0) * i) / 3);
  const grid = ticks
    .map(v => `<line class="grid" x1="${pad.l}" x2="${pad.l + W}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="axis-label" x="${pad.l + W + 6}" y="${f(Y(v) + 4)}">${escapeHtml(yFormat(v))}</text>`)
    .join('');
  const xticks = [0, 0.5, 1]
    .map(k => {
      const t = t0 + (t1 - t0) * k;
      const anchor = k === 0 ? 'start' : k === 1 ? 'end' : 'middle';
      return `<text class="axis-label" text-anchor="${anchor}" x="${f(X(t))}" y="${height - 6}">${escapeHtml(xFormat(t))}</text>`;
    })
    .join('');
  const paths = series
    .map((s, i) => {
      const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${f(X(p[0]))} ${f(Y(p[1]))}`).join('');
      const area =
        i === 0 && s.points.length > 1
          ? `<path class="area ${dir}" d="${d}L${f(X(s.points.at(-1)[0]))} ${pad.t + H}L${f(X(s.points[0][0]))} ${pad.t + H}Z"/>`
          : '';
      return `${area}<path class="line ${s.cls || dir}" d="${d}"/>`;
    })
    .join('');
  const baseLine = base != null ? `<line class="base-line" x1="${pad.l}" x2="${pad.l + W}" y1="${f(Y(base))}" y2="${f(Y(base))}"/>` : '';
  const last = series[0].points.at(-1);
  const dot = last ? `<circle class="end-dot ${dir}" cx="${f(X(last[0]))}" cy="${f(Y(last[1]))}" r="4"/>` : '';
  const svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">${grid}${baseLine}${paths}${dot}${xticks}<g class="hover" visibility="hidden"><line class="cross" y1="${pad.t}" y2="${pad.t + H}"/>${series.map((s, i) => `<circle class="hover-dot ${i ? s.cls : dir}" r="4.5"/>`).join('')}</g><rect class="hit" x="${pad.l}" y="0" width="${W}" height="${height}" fill="transparent"/></svg>`;
  return { svg, frame: { t0, t1, pad, W, H, lo, hi, width, height } };
}

// Crosshair + tooltip on a chart made by lineChart, in `box` (the element
// holding the svg). `label(i, t, values)` returns the tooltip's HTML.
export function attachHover(box, series, frame, label) {
  const svg = box.querySelector('svg');
  if (!svg || !frame) return;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  box.append(tip);
  const hover = svg.querySelector('.hover');
  const cross = hover.querySelector('.cross');
  const dots = hover.querySelectorAll('.hover-dot');
  const main = series[0].points;
  const X = t => frame.pad.l + ((t - frame.t0) / (frame.t1 - frame.t0 || 1)) * frame.W;
  const Y = v => frame.pad.t + frame.H - ((v - frame.lo) / (frame.hi - frame.lo)) * frame.H;
  const nearest = (points, t) => {
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    return Math.abs(points[lo][0] - t) <= Math.abs(points[hi][0] - t) ? lo : hi;
  };
  const move = event => {
    const rect = svg.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * frame.width;
    const t = frame.t0 + ((sx - frame.pad.l) / frame.W) * (frame.t1 - frame.t0);
    const i = nearest(main, t);
    const [pt, pv] = main[i];
    const x = X(pt);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    const values = series.map((s, k) => {
      if (!s.points.length) return null;
      const j = k === 0 ? i : nearest(s.points, pt);
      const v = s.points[j][1];
      dots[k]?.setAttribute('cx', X(s.points[j][0]));
      dots[k]?.setAttribute('cy', Y(v));
      return v;
    });
    void pv;
    hover.setAttribute('visibility', 'visible');
    tip.innerHTML = label(i, pt, values);
    tip.hidden = false;
    const px = (x / frame.width) * rect.width;
    const boxRect = box.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const left = Math.min(Math.max(px + (rect.left - boxRect.left) - tipW / 2, 0), boxRect.width - tipW);
    tip.style.left = `${left}px`;
  };
  const leave = () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

// A 100% bar split into parts, 2px gaps between, with a legend underneath.
// parts: [{ label, value, color }] (values positive).
export function stackBar(parts, { format = v => v } = {}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (!total) return '';
  const segs = parts
    .filter(p => p.value > 0)
    .map(p => `<span class="stack-seg" style="flex-grow:${p.value / total};background:${p.color}" title="${escapeHtml(p.label)} ${escapeHtml(format(p.value))}"></span>`)
    .join('');
  const legend = parts
    .filter(p => p.value > 0)
    .map(p => `<li><i style="background:${p.color}"></i><span class="legend-label">${escapeHtml(p.label)}</span><strong class="num">${Math.round((p.value / total) * 1000) / 10}%</strong><span class="legend-value num">${escapeHtml(format(p.value))}</span></li>`)
    .join('');
  return `<div class="stack-bar">${segs}</div><ul class="stack-legend">${legend}</ul>`;
}

// Categorical colours (validated order), light and dark via CSS variables.
export const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

// Candlesticks (one per bar, evenly spaced so nights and weekends leave no
// gaps), optional average lines over them, and volume underneath.
// bars: [{ t, o, h, l, c, v }]; lines: [{ points: [[t, v]], cls }] on the
// same bar times. Rising candles use the "up" colour, falling "down".
export function candleChart(bars, { width = 640, height = 260, lines = [], yFormat = v => v, xFormat = t => t, volume = true } = {}) {
  if (!bars?.length) return { svg: '', frame: null };
  const pad = { l: 8, r: 64, t: 12, b: 24 };
  const W = width - pad.l - pad.r;
  const hasVolume = volume && bars.some(b => b.v > 0);
  const volH = hasVolume ? Math.round((height - pad.t - pad.b) * 0.18) : 0;
  const H = height - pad.t - pad.b - volH - (hasVolume ? 6 : 0);
  const index = new Map(bars.map((b, i) => [b.t, i]));
  const values = [...bars.flatMap(b => [b.h, b.l]), ...lines.flatMap(s => s.points.map(p => p[1]))];
  const [lo0, hi0] = extent(values);
  const room = (hi0 - lo0) * 0.06;
  const lo = lo0 - room;
  const hi = hi0 + room;
  const step = W / bars.length;
  const X = i => pad.l + step * (i + 0.5);
  const Y = v => pad.t + H - ((v - lo) / (hi - lo)) * H;
  const body = Math.max(1, Math.min(14, step * 0.66));
  const ticks = [];
  for (let i = 0; i <= 3; i++) ticks.push(lo0 + ((hi0 - lo0) * i) / 3);
  const grid = ticks
    .map(v => `<line class="grid" x1="${pad.l}" x2="${pad.l + W}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="axis-label" x="${pad.l + W + 6}" y="${f(Y(v) + 4)}">${escapeHtml(yFormat(v))}</text>`)
    .join('');
  const candles = bars
    .map((b, i) => {
      const dir = b.c > b.o ? 'up' : b.c < b.o ? 'down' : 'flat';
      const top = Y(Math.max(b.o, b.c));
      const h = Math.max(1, Y(Math.min(b.o, b.c)) - top);
      return `<g class="candle ${dir}"><line x1="${f(X(i))}" x2="${f(X(i))}" y1="${f(Y(b.h))}" y2="${f(Y(b.l))}"/><rect x="${f(X(i) - body / 2)}" y="${f(top)}" width="${f(body)}" height="${f(h)}"/></g>`;
    })
    .join('');
  const overlay = lines
    .map(s => {
      const pts = s.points.filter(p => index.has(p[0]));
      if (pts.length < 2) return '';
      return `<path class="line ${s.cls}" d="${pts.map((p, j) => `${j ? 'L' : 'M'}${f(X(index.get(p[0])))} ${f(Y(p[1]))}`).join('')}"/>`;
    })
    .join('');
  let vol = '';
  if (hasVolume) {
    const vmax = Math.max(...bars.map(b => b.v || 0)) || 1;
    const base = height - pad.b;
    vol = bars
      .map((b, i) => {
        const h = ((b.v || 0) / vmax) * volH;
        return h > 0 ? `<rect class="vol ${b.c >= b.o ? 'up' : 'down'}" x="${f(X(i) - body / 2)}" y="${f(base - h)}" width="${f(body)}" height="${f(h)}"/>` : '';
      })
      .join('');
  }
  const xticks = [0, 0.5, 1]
    .map(k => {
      const i = Math.round((bars.length - 1) * k);
      const anchor = k === 0 ? 'start' : k === 1 ? 'end' : 'middle';
      return `<text class="axis-label" text-anchor="${anchor}" x="${f(k === 0 ? pad.l : k === 1 ? pad.l + W : X(i))}" y="${height - 6}">${escapeHtml(xFormat(bars[i].t))}</text>`;
    })
    .join('');
  const svg = `<svg class="chart-svg candles" viewBox="0 0 ${width} ${height}" role="img">${grid}${vol}${candles}${overlay}${xticks}<g class="hover" visibility="hidden"><line class="cross" y1="${pad.t}" y2="${height - pad.b}"/></g><rect class="hit" x="${pad.l}" y="0" width="${W}" height="${height}" fill="transparent"/></svg>`;
  return { svg, frame: { pad, W, H, step, width, height, count: bars.length } };
}

// Crosshair and tooltip for candleChart: `label(bar, i)` returns its HTML.
export function attachCandleHover(box, bars, frame, label) {
  const svg = box.querySelector('svg');
  if (!svg || !frame) return;
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  box.append(tip);
  const hover = svg.querySelector('.hover');
  const cross = hover.querySelector('.cross');
  const move = event => {
    const rect = svg.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * frame.width;
    const i = Math.max(0, Math.min(frame.count - 1, Math.floor((sx - frame.pad.l) / frame.step)));
    const x = frame.pad.l + frame.step * (i + 0.5);
    cross.setAttribute('x1', x);
    cross.setAttribute('x2', x);
    hover.setAttribute('visibility', 'visible');
    tip.innerHTML = label(bars[i], i);
    tip.hidden = false;
    const boxRect = box.getBoundingClientRect();
    const px = (x / frame.width) * rect.width + (rect.left - boxRect.left);
    const tipW = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(px - tipW / 2, 0), boxRect.width - tipW)}px`;
  };
  const leave = () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

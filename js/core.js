// Jádro: stav aplikace, dokumenty, vrstvy, historie, vykreslování.
// Pravidlo: plátno vrstvy se nikdy nemění na místě – před úpravou pixelů se
// nahradí kopií (editCtx). Díky tomu mohou snímky historie plátna sdílet.

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export const S = {
  docs: [],
  doc: null,
  tool: 'move',
  fg: '#000000',
  bg: '#ffffff',
  clipboard: null,   // {canvas, x, y}
  preview: null,     // {layerId, draw(ctx, layer)} – dočasná náhrada vykreslení vrstvy
  overlay: null,     // fn(ctx) – kreslení přes plátno v obrazovkových px
  opts: {
    move: { autoSelect: true },
    brush: { size: 30, hardness: 80, opacity: 100 },
    eraser: { size: 40, hardness: 80, opacity: 100 },
    gradient: { type: 'linear', preset: 'fg-bg', opacity: 100, reverse: false },
    bucket: { tolerance: 32, opacity: 100, contiguous: true },
    crop: { ratio: 'free' },
    text: { font: 'Arial', size: 48, bold: false, italic: false, align: 'left' },
    shape: { kind: 'rect', radius: 0, width: 4 },
  },
};

// ---------- události ----------
const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
export function emit(ev, ...a) { (listeners[ev] || []).forEach(fn => fn(...a)); }
export function emitAll() { ['doc', 'layers', 'history', 'view'].forEach(e => emit(e)); render(); }

// ---------- pomocné ----------
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export function cloneCanvas(c) {
  const n = makeCanvas(c.width, c.height);
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let toastTimer = 0;
export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- dokument a vrstvy ----------
let uid = 1;
export function newLayer(name, w, h, x = 0, y = 0) {
  return { id: uid++, name, canvas: makeCanvas(w, h), x, y, opacity: 1, blend: 'source-over', visible: true, text: null };
}

export function createDoc(name, w, h, bg = 'white') {
  const d = {
    id: uid++, name, w, h, layers: [], activeId: null, selection: null,
    history: [], hIndex: -1, zoom: 1, panX: 0, panY: 0, dirty: false, counter: 1, lastPt: null,
  };
  if (bg !== 'none') {
    const l = newLayer(bg === 'transparent' ? 'Vrstva 1' : 'Pozadí', w, h);
    if (bg === 'transparent') d.counter = 2;
    else {
      const c = l.canvas.getContext('2d');
      c.fillStyle = bg === 'white' ? '#ffffff' : bg;
      c.fillRect(0, 0, w, h);
    }
    d.layers.push(l);
    d.activeId = l.id;
  }
  return d;
}

export function addDoc(d, label = 'Nový') {
  S.docs.push(d);
  S.doc = d;
  d.history = [{ name: label, snap: snapshot(d) }];
  d.hIndex = 0;
  S.preview = null;
  fitView();
  emit('switch');
  emitAll();
}

export function setDoc(d) {
  S.doc = d;
  S.preview = null;
  emit('switch');
  emitAll();
}

export function closeDoc(d) {
  const i = S.docs.indexOf(d);
  if (i < 0) return;
  S.docs.splice(i, 1);
  if (S.doc === d) setDoc(S.docs[Math.min(i, S.docs.length - 1)] || null);
  else emitAll();
}

export function activeLayer() {
  const d = S.doc;
  return d ? d.layers.find(l => l.id === d.activeId) || null : null;
}

export function insertLayer(l) {
  const d = S.doc;
  const i = d.layers.findIndex(x => x.id === d.activeId);
  d.layers.splice(i < 0 ? d.layers.length : i + 1, 0, l);
  d.activeId = l.id;
}

// Vrátí kontext nové kopie plátna vrstvy (volitelně rozšířené tak, aby krylo celý dokument).
export function editCtx(layer, cover = true) {
  const d = S.doc;
  let x0 = layer.x, y0 = layer.y, x1 = layer.x + layer.canvas.width, y1 = layer.y + layer.canvas.height;
  if (cover) { x0 = Math.min(x0, 0); y0 = Math.min(y0, 0); x1 = Math.max(x1, d.w); y1 = Math.max(y1, d.h); }
  const c = makeCanvas(x1 - x0, y1 - y0);
  const ctx = c.getContext('2d');
  ctx.drawImage(layer.canvas, layer.x - x0, layer.y - y0);
  layer.canvas = c; layer.x = x0; layer.y = y0;
  return ctx;
}

// Kreslení do vrstvy v souřadnicích dokumentu, s ořezem na výběr.
export function withLayerCtx(layer, fn) {
  const ctx = editCtx(layer);
  ctx.save();
  ctx.translate(-layer.x, -layer.y);
  const sel = S.doc.selection;
  if (sel) ctx.clip(sel.path, 'evenodd');
  fn(ctx);
  ctx.restore();
  layer.text = null;
}

// ---------- historie ----------
function snapshot(d) {
  return {
    w: d.w, h: d.h, activeId: d.activeId, selection: d.selection,
    layers: d.layers.map(l => ({ ...l, text: l.text ? { ...l.text } : null })),
  };
}

export function commit(name) {
  const d = S.doc;
  if (!d) return;
  d.history.length = d.hIndex + 1;
  d.history.push({ name, snap: snapshot(d) });
  if (d.history.length > 40) d.history.shift();
  d.hIndex = d.history.length - 1;
  d.dirty = true;
  emitAll();
}

export function restore(i) {
  const d = S.doc;
  if (!d || i < 0 || i >= d.history.length) return;
  const s = d.history[i].snap;
  d.w = s.w; d.h = s.h; d.activeId = s.activeId; d.selection = s.selection;
  d.layers = s.layers.map(l => ({ ...l, text: l.text ? { ...l.text } : null }));
  d.hIndex = i;
  d.dirty = true;
  S.preview = null;
  emit('switch');
  emitAll();
}
export function undo() { if (S.doc && S.doc.hIndex > 0) restore(S.doc.hIndex - 1); }
export function redo() { if (S.doc && S.doc.hIndex < S.doc.history.length - 1) restore(S.doc.hIndex + 1); }

// ---------- vykreslování ----------
let view, vctx, comp, cctx, raf = 0, antOffset = 0, checker = null;

export function initView(canvas) {
  view = canvas;
  vctx = view.getContext('2d');
  comp = makeCanvas(1, 1);
  cctx = comp.getContext('2d');
  new ResizeObserver(() => render()).observe(view.parentElement);
  setInterval(() => {
    if (S.doc && S.doc.selection) { antOffset = (antOffset + 1) % 8; render(); }
  }, 140);
}

export function viewSize() {
  const p = view.parentElement;
  return { w: p.clientWidth, h: p.clientHeight };
}

export function render() {
  if (raf || !view) return;
  raf = requestAnimationFrame(() => { raf = 0; draw(); });
}

export function drawLayers(ctx, d, usePreview) {
  for (const l of d.layers) {
    if (!l.visible) continue;
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = l.blend;
    if (usePreview && S.preview && S.preview.layerId === l.id) S.preview.draw(ctx, l);
    else ctx.drawImage(l.canvas, l.x, l.y);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function flatten(d, bg) {
  const c = makeCanvas(d.w, d.h);
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, d.w, d.h); }
  drawLayers(ctx, d, false);
  return c;
}

function checkerPattern() {
  if (checker) return checker;
  const c = makeCanvas(16, 16), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#cccccc'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  checker = vctx.createPattern(c, 'repeat');
  return checker;
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = viewSize();
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  if (view.width !== W || view.height !== H) {
    view.width = W; view.height = H;
    view.style.width = w + 'px'; view.style.height = h + 'px';
  }
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.clearRect(0, 0, W, H);
  const d = S.doc;
  if (!d) return;

  if (comp.width !== W || comp.height !== H) { comp.width = W; comp.height = H; }
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.clearRect(0, 0, W, H);
  cctx.save();
  cctx.setTransform(dpr * d.zoom, 0, 0, dpr * d.zoom, dpr * d.panX, dpr * d.panY);
  cctx.beginPath(); cctx.rect(0, 0, d.w, d.h); cctx.clip();
  cctx.imageSmoothingEnabled = d.zoom < 3;
  drawLayers(cctx, d, true);
  cctx.restore();

  const x = Math.round(d.panX * dpr), y = Math.round(d.panY * dpr);
  const dw = Math.round(d.w * d.zoom * dpr), dh = Math.round(d.h * d.zoom * dpr);
  vctx.save();
  vctx.shadowColor = 'rgba(0,0,0,.5)'; vctx.shadowBlur = 12 * dpr;
  vctx.fillStyle = '#fff'; vctx.fillRect(x, y, dw, dh);
  vctx.restore();
  vctx.save();
  vctx.translate(x, y);
  vctx.fillStyle = checkerPattern();
  vctx.fillRect(0, 0, dw, dh);
  vctx.restore();
  vctx.drawImage(comp, 0, 0);

  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (d.selection) {
    vctx.save();
    vctx.transform(d.zoom, 0, 0, d.zoom, d.panX, d.panY);
    vctx.lineWidth = 1 / d.zoom;
    vctx.strokeStyle = '#fff';
    vctx.setLineDash([]);
    vctx.stroke(d.selection.path);
    vctx.strokeStyle = '#000';
    vctx.setLineDash([4 / d.zoom, 4 / d.zoom]);
    vctx.lineDashOffset = -antOffset / d.zoom;
    vctx.stroke(d.selection.path);
    vctx.restore();
  }
  if (S.overlay) { vctx.save(); S.overlay(vctx); vctx.restore(); }
}

// ---------- pohled ----------
export function zoomAt(z, sx, sy) {
  const d = S.doc;
  if (!d) return;
  if (sx == null) { const v = viewSize(); sx = v.w / 2; sy = v.h / 2; }
  const dx = (sx - d.panX) / d.zoom, dy = (sy - d.panY) / d.zoom;
  d.zoom = clamp(z, 0.02, 32);
  d.panX = sx - dx * d.zoom;
  d.panY = sy - dy * d.zoom;
  emit('view');
  render();
}

export function fitView(max = 1) {
  const d = S.doc;
  if (!d || !view) return;
  const v = viewSize();
  d.zoom = clamp(Math.min((v.w - 60) / d.w, (v.h - 60) / d.h, max), 0.02, 32);
  d.panX = Math.round((v.w - d.w * d.zoom) / 2);
  d.panY = Math.round((v.h - d.h * d.zoom) / 2);
  emit('view');
  render();
}

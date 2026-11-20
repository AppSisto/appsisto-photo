// Nástroje a obsluha ukazatele nad plátnem.
import {
  S, emit, on, render, makeCanvas, activeLayer, insertLayer, newLayer, commit, withLayerCtx,
  drawLayers, zoomAt, rgba, toast, clamp,
} from './core.js';
import * as ops from './ops.js';

let view, stage, active = null, space = false, hover = null, prevTool = 'move';

const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
const d2s = p => ({ x: p.x * S.doc.zoom + S.doc.panX, y: p.y * S.doc.zoom + S.doc.panY });

function pt(e) {
  const r = view.getBoundingClientRect(), d = S.doc;
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { x: (sx - d.panX) / d.zoom, y: (sy - d.panY) / d.zoom, sx, sy };
}

function drawHandle(ctx, s) {
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
  ctx.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7);
}

// ---------- ručka, lupa, přesun, kapátko ----------
const hand = {
  cursor: 'grab',
  down(p, e) { this.s = { x: e.clientX, y: e.clientY, px: S.doc.panX, py: S.doc.panY }; },
  move(p, e) {
    if (!this.s) return;
    S.doc.panX = this.s.px + e.clientX - this.s.x;
    S.doc.panY = this.s.py + e.clientY - this.s.y;
    render();
  },
  up() { this.s = null; },
};

const zoom = {
  cursor: 'zoom-in',
  down(p, e) { zoomAt(S.doc.zoom * (e.altKey ? 0.5 : 2), p.sx, p.sy); },
};

function hitLayer(p) {
  const d = S.doc, x = Math.floor(p.x), y = Math.floor(p.y);
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const l = d.layers[i];
    if (!l.visible) continue;
    const lx = x - l.x, ly = y - l.y;
    if (lx < 0 || ly < 0 || lx >= l.canvas.width || ly >= l.canvas.height) continue;
    if (l.canvas.getContext('2d').getImageData(lx, ly, 1, 1).data[3] > 8) return l;
  }
  return null;
}

const move = {
  cursor: 'default',
  down(p) {
    const d = S.doc;
    if (S.opts.move.autoSelect) {
      const hit = hitLayer(p);
      if (hit && hit.id !== d.activeId) { d.activeId = hit.id; emit('layers'); }
    }
    const l = activeLayer();
    this.s = l ? { p, l, ox: l.x, oy: l.y, moved: false } : null;
  },
  move(p, e) {
    const s = this.s;
    if (!s) return;
    let dx = p.x - s.p.x, dy = p.y - s.p.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    s.l.x = s.ox + Math.round(dx);
    s.l.y = s.oy + Math.round(dy);
    s.moved = s.l.x !== s.ox || s.l.y !== s.oy;
    render();
  },
  up() { if (this.s && this.s.moved) commit('Přesun'); this.s = null; },
};

function pickColor(p, toBg) {
  const c = makeCanvas(1, 1), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(-Math.floor(p.x), -Math.floor(p.y));
  drawLayers(ctx, S.doc, false);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (!a) return;
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  if (toBg) S.bg = hex; else S.fg = hex;
  emit('color');
}

const eyedropper = {
  cursor: 'crosshair',
  down(p, e) { this.on = true; pickColor(p, e.altKey && S.tool === 'eyedropper'); },
  move(p, e) { if (this.on) pickColor(p, e.altKey && S.tool === 'eyedropper'); },
  up() { this.on = false; },
};

// ---------- výběry ----------
const clampP = p => ({ x: clamp(p.x, 0, S.doc.w), y: clamp(p.y, 0, S.doc.h) });

function marquee(kind) {
  return {
    cursor: 'crosshair',
    down(p) { this.a = clampP(p); this.prev = S.doc.selection; this.drag = false; },
    move(p, e) {
      if (!this.a) return;
      const a = this.a, b = clampP(p);
      let w = b.x - a.x, h = b.y - a.y;
      if (e.shiftKey) { const m = Math.min(Math.abs(w), Math.abs(h)); w = Math.sign(w) * m; h = Math.sign(h) * m; }
      const x = Math.round(Math.min(a.x, a.x + w)), y = Math.round(Math.min(a.y, a.y + h));
      const W = Math.round(Math.abs(w)), H = Math.round(Math.abs(h));
      if (W < 1 || H < 1) return;
      this.drag = true;
      const path = new Path2D();
      if (kind === 'rect') path.rect(x, y, W, H);
      else path.ellipse(x + W / 2, y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      S.doc.selection = { path, bounds: { x, y, w: W, h: H } };
      render();
    },
    up() {
      if (!this.a) return;
      this.a = null;
      if (this.drag) commit(kind === 'rect' ? 'Obdélníkový výběr' : 'Eliptický výběr');
      else if (this.prev) { S.doc.selection = null; commit('Zrušit výběr'); }
    },
  };
}

const lasso = {
  cursor: 'crosshair',
  down(p) { this.pts = [clampP(p)]; this.prev = S.doc.selection; },
  move(p) {
    if (!this.pts) return;
    this.pts.push(clampP(p));
    if (this.pts.length < 3) return;
    const path = new Path2D();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    this.pts.forEach((q, i) => {
      if (i) path.lineTo(q.x, q.y); else path.moveTo(q.x, q.y);
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    });
    path.closePath();
    S.doc.selection = { path, bounds: { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) } };
    render();
  },
  up() {
    if (!this.pts) return;
    const n = this.pts.length;
    this.pts = null;
    if (n >= 3) commit('Laso');
    else if (this.prev) { S.doc.selection = null; commit('Zrušit výběr'); }
  },
};

// ---------- oříznutí ----------
export const crop = {
  cursor: 'crosshair',
  r: null,
  activate() {
    const d = S.doc;
    this.r = d ? { x: 0, y: 0, w: d.w, h: d.h } : null;
    this.s = null;
    if (this.r && this.ratio()) this.applyRatio();
    emit('crop');
    render();
  },
  ratio() {
    const o = S.opts.crop.ratio;
    if (o === 'free') return 0;
    if (o === 'orig') return S.doc.w / S.doc.h;
    const [a, b] = o.split(':').map(Number);
    return a / b;
  },
  applyRatio() {
    const k = this.ratio(), r = this.r;
    if (!k || !r) return;
    let w = r.w, h = w / k;
    if (h > r.h) { h = r.h; w = h * k; }
    this.r = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
    emit('crop');
    render();
  },
  handleAt(p) {
    const r = this.r, tol = 9 / S.doc.zoom;
    for (const [hx, hy] of HANDLES) {
      const x = r.x + r.w * (hx + 1) / 2, y = r.y + r.h * (hy + 1) / 2;
      if (Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol) return [hx, hy];
    }
    return null;
  },
  down(p) {
    if (!this.r) this.activate();
    const r = this.r, h = this.handleAt(p);
    if (h) this.s = { mode: 'handle', h, r0: { ...r } };
    else if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) this.s = { mode: 'move', p, r0: { ...r } };
    else this.s = { mode: 'handle', h: [1, 1], r0: { x: p.x, y: p.y, w: 0, h: 0 } };
  },
  move(p) {
    const s = this.s;
    if (!s) return;
    const r0 = s.r0, k = this.ratio();
    if (s.mode === 'move') this.r = { ...r0, x: r0.x + p.x - s.p.x, y: r0.y + p.y - s.p.y };
    else {
      const [hx, hy] = s.h;
      let { x, y, w, h } = r0;
      if (hx && hy) {
        const ax = hx > 0 ? r0.x : r0.x + r0.w, ay = hy > 0 ? r0.y : r0.y + r0.h;
        w = Math.abs(p.x - ax); h = Math.abs(p.y - ay);
        if (k) h = w / k;
        x = p.x < ax ? ax - w : ax; y = p.y < ay ? ay - h : ay;
      } else if (hx) {
        const ax = hx > 0 ? r0.x : r0.x + r0.w;
        w = Math.abs(p.x - ax); x = p.x < ax ? ax - w : ax;
        if (k) { h = w / k; y = r0.y + r0.h / 2 - h / 2; }
      } else {
        const ay = hy > 0 ? r0.y : r0.y + r0.h;
        h = Math.abs(p.y - ay); y = p.y < ay ? ay - h : ay;
        if (k) { w = h * k; x = r0.x + r0.w / 2 - w / 2; }
      }
      this.r = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    }
    emit('crop');
    render();
  },
  up() { this.s = null; },
  dbl() { this.commit(); },
  commit() {
    const r = this.r;
    if (!r) return;
    ops.crop(Math.round(r.x), Math.round(r.y), Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)));
    this.activate();
  },
  cancel() { this.activate(); },
  draw(ctx) {
    const r = this.r;
    if (!r) return;
    const a = d2s(r), w = r.w * S.doc.zoom, h = r.h * S.doc.zoom;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.rect(0, 0, view.clientWidth, view.clientHeight);
    ctx.rect(a.x, a.y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(a.x + w * i / 3, a.y); ctx.lineTo(a.x + w * i / 3, a.y + h);
      ctx.moveTo(a.x, a.y + h * i / 3); ctx.lineTo(a.x + w, a.y + h * i / 3);
    }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
    for (const [hx, hy] of HANDLES) drawHandle(ctx, { x: a.x + w * (hx + 1) / 2, y: a.y + h * (hy + 1) / 2 });
  },
};

// ---------- štětec a guma ----------
function makeStamp(size, hardness, color) {
  const s = Math.max(1, size), c = makeCanvas(s + 2, s + 2), g = c.getContext('2d');
  const cx = (s + 2) / 2, r = s / 2;
  if (hardness >= 100) g.fillStyle = color;
  else {
    const gr = g.createRadialGradient(cx, cx, 0, cx, cx, r);
    gr.addColorStop(0, color);
    gr.addColorStop(hardness / 100, color);
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
  }
  g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
  return c;
}

function paintTool(erase) {
  return {
    cursor: 'crosshair',
    down(p, e) {
      const l = activeLayer(), d = S.doc;
      this.s = null;
      if (!l) return;
      if (!l.visible) return toast('Aktivní vrstva je skrytá');
      const o = erase ? S.opts.eraser : S.opts.brush;
      const x0 = Math.min(l.x, 0), y0 = Math.min(l.y, 0);
      const x1 = Math.max(l.x + l.canvas.width, d.w), y1 = Math.max(l.y + l.canvas.height, d.h);
      const s = this.s = {
        l, o, bx: x0, by: y0,
        stroke: makeCanvas(d.w, d.h), scratch: makeCanvas(x1 - x0, y1 - y0),
        stamp: makeStamp(o.size, o.hardness, erase ? '#000000' : S.fg),
        spacing: Math.max(1, o.size * 0.1), carry: 0, last: p,
      };
      s.sctx = s.stroke.getContext('2d');
      s.cctx = s.scratch.getContext('2d');
      s.carry = s.spacing;
      if (e.shiftKey && d.lastPt) { s.last = d.lastPt; s.carry = 0; this.seg(p); } else this.dab(p);
      S.preview = { layerId: l.id, draw: ctx => { this.compose(); ctx.drawImage(s.scratch, s.bx, s.by); } };
      render();
    },
    dab(p) {
      const s = this.s;
      s.sctx.drawImage(s.stamp, p.x - s.stamp.width / 2, p.y - s.stamp.height / 2);
    },
    seg(p) {
      const s = this.s, a = s.last, dist = Math.hypot(p.x - a.x, p.y - a.y);
      if (!dist) return;
      let t = s.carry;
      while (t <= dist) {
        this.dab({ x: a.x + (p.x - a.x) * t / dist, y: a.y + (p.y - a.y) * t / dist });
        t += s.spacing;
      }
      s.carry = t - dist;
      s.last = p;
    },
    compose() {
      const s = this.s, c = s.cctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'copy';
      c.drawImage(s.l.canvas, s.l.x - s.bx, s.l.y - s.by);
      c.save();
      c.translate(-s.bx, -s.by);
      if (S.doc.selection) c.clip(S.doc.selection.path, 'evenodd');
      c.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      c.globalAlpha = s.o.opacity / 100;
      c.drawImage(s.stroke, 0, 0);
      c.restore();
    },
    move(p, e) {
      if (!this.s) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (evs.length > 1) evs.forEach(ev => this.seg(pt(ev))); else this.seg(p);
      render();
    },
    up() {
      const s = this.s;
      if (!s) return;
      this.compose();
      s.l.canvas = s.scratch; s.l.x = s.bx; s.l.y = s.by; s.l.text = null;
      S.preview = null;
      S.doc.lastPt = s.last;
      this.s = null;
      commit(erase ? 'Guma' : 'Štětec');
    },
    draw(ctx) {
      if (!hover) return;
      const o = erase ? S.opts.eraser : S.opts.brush, r = Math.max(1.5, o.size / 2 * S.doc.zoom);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.beginPath(); ctx.arc(hover.sx, hover.sy, r + 1, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.arc(hover.sx, hover.sy, r, 0, Math.PI * 2); ctx.stroke();
    },
  };
}

// ---------- přechod ----------
function snapAngle(a, b) {
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

const gradient = {
  cursor: 'crosshair',
  down(p) {
    const l = activeLayer();
    this.a = null;
    if (!l) return;
    if (!l.visible) return toast('Aktivní vrstva je skrytá');
    this.a = p; this.b = p;
  },
  move(p, e) { if (!this.a) return; this.b = e.shiftKey ? snapAngle(this.a, p) : p; render(); },
  up() {
    const a = this.a, b = this.b;
    this.a = null;
    render();
    if (!a) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 2) return;
    const o = S.opts.gradient, d = S.doc, l = activeLayer();
    let stops = o.preset === 'fg-bg' ? [S.fg, S.bg]
      : o.preset === 'fg-transparent' ? [S.fg, rgba(S.fg, 0)]
        : ['#000000', 'rgba(0,0,0,0)'];
    if (o.reverse) stops = stops.reverse();
    withLayerCtx(l, ctx => {
      const g = o.type === 'linear' ? ctx.createLinearGradient(a.x, a.y, b.x, b.y) : ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, dist);
      g.addColorStop(0, stops[0]); g.addColorStop(1, stops[1]);
      if (o.preset === 'erase') ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = o.opacity / 100;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, d.w, d.h);
    });
    commit(o.preset === 'erase' ? 'Zprůhlednění přechodem' : 'Přechod');
  },
  draw(ctx) {
    if (!this.a) return;
    const a = d2s(this.a), b = d2s(this.b);
    ctx.setLineDash([]);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    drawHandle(ctx, a); drawHandle(ctx, b);
  },
};

// ---------- plechovka barvy ----------
const bucket = {
  cursor: 'crosshair',
  down(p) {
    const l = activeLayer(), d = S.doc;
    if (!l) return;
    if (!l.visible) return toast('Aktivní vrstva je skrytá');
    const x = Math.floor(p.x), y = Math.floor(p.y), w = d.w, h = d.h;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = S.opts.bucket;
    const src = makeCanvas(w, h), sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(l.canvas, l.x, l.y);
    const px = sctx.getImageData(0, 0, w, h).data;
    const i0 = (y * w + x) * 4, tr = px[i0], tg = px[i0 + 1], tb = px[i0 + 2], ta = px[i0 + 3], tol = o.tolerance;
    const match = i => {
      const k = i * 4;
      return Math.abs(px[k] - tr) <= tol && Math.abs(px[k + 1] - tg) <= tol && Math.abs(px[k + 2] - tb) <= tol && Math.abs(px[k + 3] - ta) <= tol;
    };
    const mask = new Uint8Array(w * h);
    if (o.contiguous) {
      const stack = [y * w + x];
      while (stack.length) {
        const i = stack.pop();
        if (mask[i]) continue;
        if (!match(i)) { mask[i] = 2; continue; }
        mask[i] = 1;
        const cx = i % w;
        if (cx > 0) stack.push(i - 1);
        if (cx < w - 1) stack.push(i + 1);
        if (i >= w) stack.push(i - w);
        if (i < w * (h - 1)) stack.push(i + w);
      }
    } else for (let i = 0; i < w * h; i++) if (match(i)) mask[i] = 1;
    const out = new ImageData(w, h), od = out.data;
    const n = parseInt(S.fg.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    for (let i = 0; i < w * h; i++) {
      if (mask[i] === 1) { const k = i * 4; od[k] = r; od[k + 1] = g; od[k + 2] = b; od[k + 3] = 255; }
    }
    const mc = makeCanvas(w, h);
    mc.getContext('2d').putImageData(out, 0, 0);
    withLayerCtx(l, ctx => { ctx.globalAlpha = o.opacity / 100; ctx.drawImage(mc, 0, 0); });
    commit('Plechovka barvy');
  },
};

// ---------- text ----------
const textPad = size => Math.ceil(size * 0.3);
const fontCss = t => `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`;
let measureCtx = null;

function measureText(t) {
  measureCtx ||= makeCanvas(1, 1).getContext('2d');
  measureCtx.font = fontCss(t);
  const lines = t.str.split('\n');
  return { lines, lh: Math.round(t.size * 1.2), tw: Math.max(1, ...lines.map(s => measureCtx.measureText(s).width)) };
}

// Vykreslí textovou vrstvu; (x, y) je levý horní roh textu v dokumentu.
export function renderText(l, x, y) {
  const t = l.text, pad = textPad(t.size), { lines, lh, tw } = measureText(t);
  const c = makeCanvas(Math.ceil(tw) + pad * 2, lh * lines.length + pad * 2), ctx = c.getContext('2d');
  ctx.font = fontCss(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align;
  const ax = t.align === 'left' ? pad : t.align === 'center' ? pad + tw / 2 : pad + tw;
  lines.forEach((s, i) => ctx.fillText(s, ax, pad + i * lh + lh / 2));
  l.canvas = c; l.x = x - pad; l.y = y - pad;
}

export const text = {
  cursor: 'text',
  ta: null,
  down(p) {
    if (this.ta) { this.commit(); return; }
    const d = S.doc;
    let hit = null;
    for (let i = d.layers.length - 1; i >= 0 && !hit; i--) {
      const x = d.layers[i];
      if (x.text && x.visible && p.x >= x.x && p.x <= x.x + x.canvas.width && p.y >= x.y && p.y <= x.y + x.canvas.height) hit = x;
    }
    if (hit) {
      const t = hit.text, pad = textPad(t.size);
      d.activeId = hit.id;
      Object.assign(S.opts.text, { font: t.font, size: t.size, bold: t.bold, italic: t.italic, align: t.align });
      S.fg = t.color;
      emit('color'); emit('layers'); emit('tool');
      this.open(hit.x + pad, hit.y + pad, hit);
    } else this.open(Math.round(p.x), Math.round(p.y), null);
  },
  open(x, y, layer) {
    const ta = this.ta = document.createElement('textarea');
    ta.className = 'text-edit';
    ta.spellcheck = false;
    ta.value = layer ? layer.text.str : '';
    ta.addEventListener('input', () => this.position());
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') this.cancel();
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.commit();
    });
    stage.append(ta);
    this.pos = { x, y };
    this.layer = layer;
    if (layer) S.preview = { layerId: layer.id, draw() {} };
    this.position();
    ta.focus();
    setTimeout(() => ta.focus(), 0);
    render();
  },
  position() {
    const ta = this.ta;
    if (!ta || !S.doc) return;
    const o = S.opts.text, z = S.doc.zoom, s = d2s(this.pos);
    const m = measureText({ ...o, str: ta.value || ' ' });
    Object.assign(ta.style, {
      left: s.x + 'px', top: s.y + 'px',
      font: fontCss({ ...o, size: o.size * z }), lineHeight: m.lh * z + 'px',
      color: S.fg, textAlign: o.align,
      width: Math.ceil((m.tw + o.size) * z) + 'px', height: Math.ceil(m.lh * m.lines.length * z) + 'px',
    });
  },
  commit() {
    const ta = this.ta;
    if (!ta) return;
    const str = ta.value;
    this.close();
    if (!str.trim()) { render(); return; }
    let l = this.layer;
    if (!l) { l = newLayer('', 1, 1); insertLayer(l); }
    l.text = { str, color: S.fg, ...S.opts.text };
    l.name = str.split('\n')[0].slice(0, 24);
    renderText(l, this.pos.x, this.pos.y);
    commit('Text');
  },
  cancel() { this.close(); render(); },
  close() {
    if (this.ta) this.ta.remove();
    this.ta = null;
    S.preview = null;
  },
  draw() { this.position(); },
  // Změna písma v pruhu voleb: přepíše rozpracovaný text nebo aktivní textovou vrstvu.
  optsChanged() {
    if (this.ta) return this.position();
    const l = activeLayer();
    if (!l || !l.text) return;
    const pad = textPad(l.text.size), x = l.x + pad, y = l.y + pad;
    Object.assign(l.text, S.opts.text);
    renderText(l, x, y);
    commit('Formát textu');
  },
};

// ---------- tvary ----------
const shape = {
  cursor: 'crosshair',
  down(p) { this.a = p; this.b = p; },
  move(p, e) {
    if (!this.a) return;
    const a = this.a, kind = S.opts.shape.kind;
    if (e.shiftKey && kind === 'line') p = snapAngle(a, p);
    else if (e.shiftKey) {
      const m = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
      p = { x: a.x + Math.sign(p.x - a.x) * m, y: a.y + Math.sign(p.y - a.y) * m };
    }
    this.b = p;
    render();
  },
  path(ctx, a, b, o, scale) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.beginPath();
    if (o.kind === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    else if (o.kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (o.radius > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(o.radius * scale, w / 2, h / 2));
    else ctx.rect(x, y, w, h);
  },
  up() {
    const a = this.a, b = this.b, o = S.opts.shape, d = S.doc;
    this.a = null;
    render();
    if (!a || Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
    const pad = o.kind === 'line' ? Math.ceil(o.width) : 1;
    const x0 = Math.floor(Math.min(a.x, b.x)) - pad, y0 = Math.floor(Math.min(a.y, b.y)) - pad;
    const x1 = Math.ceil(Math.max(a.x, b.x)) + pad, y1 = Math.ceil(Math.max(a.y, b.y)) + pad;
    const names = { rect: 'Obdélník', ellipse: 'Elipsa', line: 'Čára' };
    const l = newLayer(`${names[o.kind]} ${d.counter++}`, x1 - x0, y1 - y0, x0, y0);
    const ctx = l.canvas.getContext('2d');
    ctx.translate(-x0, -y0);
    this.path(ctx, a, b, o, 1);
    if (o.kind === 'line') { ctx.strokeStyle = S.fg; ctx.lineWidth = o.width; ctx.lineCap = 'round'; ctx.stroke(); }
    else { ctx.fillStyle = S.fg; ctx.fill(); }
    insertLayer(l);
    commit(names[o.kind]);
  },
  draw(ctx) {
    if (!this.a) return;
    const o = S.opts.shape;
    this.path(ctx, d2s(this.a), d2s(this.b), o, S.doc.zoom);
    ctx.setLineDash([]);
    if (o.kind === 'line') { ctx.strokeStyle = S.fg; ctx.lineWidth = Math.max(1, o.width * S.doc.zoom); ctx.lineCap = 'round'; ctx.stroke(); }
    else { ctx.fillStyle = rgba(S.fg, 0.6); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
  },
};

// ---------- volná transformace ----------
export let T = null;

function tPoint(hx, hy, t = T) {
  const x = hx * t.w * t.sx / 2, y = hy * t.h * t.sy / 2, c = Math.cos(t.rot), s = Math.sin(t.rot);
  return { x: t.cx + x * c - y * s, y: t.cy + x * s + y * c };
}
function unrot(p, o, rot) {
  const dx = p.x - o.x, dy = p.y - o.y, c = Math.cos(-rot), s = Math.sin(-rot);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function startTransform() {
  const l = activeLayer();
  if (!l || T) return;
  if (!l.visible) return toast('Aktivní vrstva je skrytá');
  const b = ops.contentBounds(l.canvas);
  if (!b) return toast('Vrstva je prázdná');
  if (b.w !== l.canvas.width || b.h !== l.canvas.height) {
    const c = makeCanvas(b.w, b.h);
    c.getContext('2d').drawImage(l.canvas, -b.x, -b.y);
    l.canvas = c; l.x += b.x; l.y += b.y;
  }
  if (S.tool !== 'transform') prevTool = S.tool;
  setTool('transform');
  T = { l, w: l.canvas.width, h: l.canvas.height, cx: l.x + l.canvas.width / 2, cy: l.y + l.canvas.height / 2, sx: 1, sy: 1, rot: 0 };
  S.preview = {
    layerId: l.id,
    draw(ctx) {
      ctx.save();
      ctx.translate(T.cx, T.cy); ctx.rotate(T.rot); ctx.scale(T.sx, T.sy);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(l.canvas, -T.w / 2, -T.h / 2);
      ctx.restore();
    },
  };
  emit('xform');
  render();
}

export function commitTransform(keepTool) {
  if (!T) return;
  const t = T, l = t.l;
  T = null;
  S.preview = null;
  if (t.sx === 1 && t.sy === 1 && t.rot === 0) {
    l.x = Math.round(t.cx - t.w / 2); l.y = Math.round(t.cy - t.h / 2);
  } else {
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([hx, hy]) => tPoint(hx, hy, t));
    const x0 = Math.floor(Math.min(...pts.map(p => p.x))), y0 = Math.floor(Math.min(...pts.map(p => p.y)));
    const x1 = Math.ceil(Math.max(...pts.map(p => p.x))), y1 = Math.ceil(Math.max(...pts.map(p => p.y)));
    const c = makeCanvas(x1 - x0, y1 - y0), ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(t.cx - x0, t.cy - y0); ctx.rotate(t.rot); ctx.scale(t.sx, t.sy);
    ctx.drawImage(l.canvas, -t.w / 2, -t.h / 2);
    l.canvas = c; l.x = x0; l.y = y0; l.text = null;
  }
  commit('Volná transformace');
  if (!keepTool) setTool(prevTool);
}

export function cancelTransform(keepTool) {
  if (!T) return;
  T = null;
  S.preview = null;
  render();
  if (!keepTool) setTool(prevTool);
}

const transform = {
  cursor: 'default',
  down(p) {
    if (!T) return;
    const tol = 9 / S.doc.zoom;
    this.s = null;
    for (const [hx, hy] of HANDLES) {
      const q = tPoint(hx, hy);
      if (Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol) {
        this.s = { mode: 'scale', hx, hy, A: tPoint(-hx, -hy), t0: { ...T } };
        return;
      }
    }
    const v = unrot(p, { x: T.cx, y: T.cy }, T.rot);
    if (Math.abs(v.x) <= T.w * T.sx / 2 && Math.abs(v.y) <= T.h * T.sy / 2) this.s = { mode: 'move', p, t0: { ...T } };
    else this.s = { mode: 'rot', a0: Math.atan2(p.y - T.cy, p.x - T.cx), t0: { ...T } };
  },
  move(p, e) {
    const s = this.s;
    if (!s || !T) return;
    const t0 = s.t0;
    if (s.mode === 'move') { T.cx = t0.cx + p.x - s.p.x; T.cy = t0.cy + p.y - s.p.y; }
    else if (s.mode === 'rot') {
      let r = t0.rot + Math.atan2(p.y - T.cy, p.x - T.cx) - s.a0;
      if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      T.rot = r;
    } else {
      const v = unrot(p, s.A, t0.rot), W0 = t0.w * t0.sx, H0 = t0.h * t0.sy;
      let nw = s.hx ? Math.max(1, v.x * s.hx) : W0, nh = s.hy ? Math.max(1, v.y * s.hy) : H0;
      if (s.hx && s.hy && !e.shiftKey) { const f = Math.max(nw / W0, nh / H0); nw = W0 * f; nh = H0 * f; }
      T.sx = nw / t0.w; T.sy = nh / t0.h;
      const ox = s.hx * nw / 2, oy = s.hy * nh / 2, c = Math.cos(t0.rot), sn = Math.sin(t0.rot);
      T.cx = s.A.x + ox * c - oy * sn; T.cy = s.A.y + ox * sn + oy * c;
    }
    emit('xform');
    render();
  },
  up() { this.s = null; },
  dbl() { commitTransform(); },
  draw(ctx) {
    if (!T) return;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([hx, hy]) => d2s(tPoint(hx, hy)));
    ctx.setLineDash([]);
    ctx.lineWidth = 1; ctx.strokeStyle = '#41B654';
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath(); ctx.stroke();
    for (const [hx, hy] of HANDLES) drawHandle(ctx, d2s(tPoint(hx, hy)));
  },
};

// ---------- přepínání nástrojů ----------
export const tools = {
  move, marquee: marquee('rect'), ellipse: marquee('ellipse'), lasso, crop, eyedropper,
  brush: paintTool(false), eraser: paintTool(true), gradient, bucket, text, shape, hand, zoom, transform,
};

function updateCursor() {
  if (view) view.style.cursor = space ? 'grab' : (tools[S.tool].cursor || 'default');
}

export function setTool(name) {
  if (S.tool === name) return;
  const old = S.tool;
  if (old === 'transform' && T) commitTransform(true);
  if (old === 'text' && text.ta) text.commit();
  if (old === 'crop') crop.r = null;
  S.tool = name;
  if (name === 'crop') crop.activate();
  emit('tool');
  updateCursor();
  render();
}

export function setSpace(v) { space = v; updateCursor(); }

// Klávesy Enter / Escape pro rozpracované operace. Vrací true, když klávesu zpracovaly.
export function toolKey(key) {
  if (key === 'Enter') {
    if (S.tool === 'crop') { crop.commit(); return true; }
    if (T) { commitTransform(); return true; }
  }
  if (key === 'Escape') {
    if (T) { cancelTransform(); return true; }
    if (S.tool === 'crop') { crop.cancel(); return true; }
    if (text.ta) { text.cancel(); return true; }
  }
  return false;
}

export function nudge(dx, dy) {
  if (T) { T.cx += dx; T.cy += dy; emit('xform'); render(); return; }
  const l = activeLayer();
  if (!l) return;
  l.x += dx; l.y += dy;
  commit('Posun');
}

export function initTools(canvas) {
  view = canvas;
  stage = canvas.parentElement;
  S.overlay = ctx => { const t = tools[S.tool]; if (S.doc && t.draw) t.draw(ctx); };

  view.addEventListener('pointerdown', e => {
    if (!S.doc || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault();
    view.setPointerCapture(e.pointerId);
    if (document.activeElement && document.activeElement !== document.body && document.activeElement !== text.ta) document.activeElement.blur();
    active = e.button === 1 || space ? hand
      : e.altKey && (S.tool === 'brush' || S.tool === 'bucket' || S.tool === 'gradient' || S.tool === 'shape') ? eyedropper
        : tools[S.tool];
    active.down && active.down(pt(e), e);
  });
  view.addEventListener('pointermove', e => {
    if (!S.doc) return;
    hover = pt(e);
    if (active) active.move && active.move(hover, e);
    else if (S.tool === 'brush' || S.tool === 'eraser') render();
  });
  const end = e => {
    if (!active) return;
    const a = active;
    active = null;
    a.up && S.doc && a.up(pt(e), e);
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('pointerleave', () => { hover = null; render(); });
  view.addEventListener('dblclick', () => { const t = tools[S.tool]; if (S.doc && t.dbl) t.dbl(); });
  view.addEventListener('wheel', e => {
    if (!S.doc) return;
    e.preventDefault();
    const r = view.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const dy = clamp(e.deltaY, -30, 30);
      zoomAt(S.doc.zoom * Math.exp(-dy * 0.012), e.clientX - r.left, e.clientY - r.top);
    } else {
      S.doc.panX -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      S.doc.panY -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      render();
    }
  }, { passive: false });
  view.addEventListener('contextmenu', e => e.preventDefault());

  // Přepnutí dokumentu nebo krok v historii ruší rozpracované operace.
  on('switch', () => {
    if (T) { T = null; S.preview = null; S.tool = prevTool; emit('tool'); }
    if (text.ta) text.close();
    if (S.tool === 'crop') crop.activate();
    updateCursor();
  });
}

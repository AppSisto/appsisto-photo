// Operace nad dokumentem: vrstvy, výběr, geometrie obrazu, filtry, schránka, soubory.
import {
  S, makeCanvas, cloneCanvas, newLayer, createDoc, addDoc, activeLayer, insertLayer,
  editCtx, withLayerCtx, commit, flatten, toast, emitAll, render,
} from './core.js';

// ---------- vrstvy ----------
export function addLayer() {
  const d = S.doc;
  const l = newLayer(`Vrstva ${d.counter++}`, d.w, d.h);
  insertLayer(l);
  commit('Nová vrstva');
  return l;
}

export function deleteLayer() {
  const d = S.doc, i = d.layers.findIndex(l => l.id === d.activeId);
  if (i < 0) return;
  if (d.layers.length <= 1) return toast('Dokument musí mít aspoň jednu vrstvu');
  d.layers.splice(i, 1);
  d.activeId = d.layers[Math.max(0, i - 1)].id;
  commit('Odstranit vrstvu');
}

export function duplicateLayer() {
  const l = activeLayer();
  if (!l) return;
  const n = { ...newLayer(l.name + ' kopie', 1, 1), canvas: l.canvas, x: l.x, y: l.y, opacity: l.opacity, blend: l.blend, text: l.text ? { ...l.text } : null };
  insertLayer(n);
  commit('Duplikovat vrstvu');
}

export function mergeDown() {
  const d = S.doc, i = d.layers.findIndex(l => l.id === d.activeId);
  if (i < 1) return toast('Pod vrstvou není žádná další vrstva');
  const up = d.layers[i], lo = d.layers[i - 1];
  const x0 = Math.min(up.x, lo.x), y0 = Math.min(up.y, lo.y);
  const x1 = Math.max(up.x + up.canvas.width, lo.x + lo.canvas.width);
  const y1 = Math.max(up.y + up.canvas.height, lo.y + lo.canvas.height);
  const c = makeCanvas(x1 - x0, y1 - y0), ctx = c.getContext('2d');
  ctx.drawImage(lo.canvas, lo.x - x0, lo.y - y0);
  if (up.visible) {
    ctx.globalAlpha = up.opacity; ctx.globalCompositeOperation = up.blend;
    ctx.drawImage(up.canvas, up.x - x0, up.y - y0);
  }
  lo.canvas = c; lo.x = x0; lo.y = y0; lo.text = null;
  d.layers.splice(i, 1);
  d.activeId = lo.id;
  commit('Sloučit dolů');
}

export function flattenImage() {
  const d = S.doc;
  const l = newLayer('Pozadí', 1, 1);
  l.canvas = flatten(d);
  d.layers = [l];
  d.activeId = l.id;
  commit('Do jedné vrstvy');
}

export function reorderLayer(fromId, toId) {
  const d = S.doc;
  const from = d.layers.findIndex(l => l.id === fromId), to = d.layers.findIndex(l => l.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [l] = d.layers.splice(from, 1);
  d.layers.splice(to, 0, l);
  commit('Pořadí vrstev');
}

export function shiftLayer(dir) {
  const d = S.doc, i = d.layers.findIndex(l => l.id === d.activeId), j = i + dir;
  if (i < 0 || j < 0 || j >= d.layers.length) return;
  [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
  commit('Pořadí vrstev');
}

// ---------- výplň ----------
export function fill(color) {
  const l = activeLayer(), d = S.doc;
  if (!l) return;
  withLayerCtx(l, ctx => { ctx.fillStyle = color; ctx.fillRect(0, 0, d.w, d.h); });
  commit('Výplň');
}

export function clearSelection() {
  const l = activeLayer(), d = S.doc;
  if (!l) return;
  if (!d.selection) return deleteLayer();
  withLayerCtx(l, ctx => { ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(0, 0, d.w, d.h); });
  commit('Vymazat');
}

// ---------- výběr ----------
export function selectAll() {
  const d = S.doc, p = new Path2D();
  p.rect(0, 0, d.w, d.h);
  d.selection = { path: p, bounds: { x: 0, y: 0, w: d.w, h: d.h } };
  commit('Vybrat vše');
}
export function deselect() {
  if (!S.doc.selection) return;
  S.doc.selection = null;
  commit('Zrušit výběr');
}
export function invertSelection() {
  const d = S.doc;
  if (!d.selection) return selectAll();
  const p = new Path2D();
  p.rect(0, 0, d.w, d.h);
  p.addPath(d.selection.path);
  d.selection = { path: p, bounds: { x: 0, y: 0, w: d.w, h: d.h } };
  commit('Doplněk výběru');
}

// ---------- geometrie obrazu ----------
export function crop(x, y, w, h) {
  const d = S.doc;
  d.layers.forEach(l => { l.x -= x; l.y -= y; });
  d.panX += x * d.zoom; d.panY += y * d.zoom;
  d.w = w; d.h = h; d.selection = null;
  commit('Oříznout');
}

export function cropToSelection() {
  const d = S.doc;
  if (!d.selection) return toast('Nejdřív vytvořte výběr');
  const b = d.selection.bounds;
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  const w = Math.min(d.w, b.x + b.w) - x, h = Math.min(d.h, b.y + b.h) - y;
  if (w < 1 || h < 1) return;
  crop(x, y, w, h);
}

function mapLayers(fn) {
  S.doc.layers.forEach(l => {
    const r = fn(l, l.canvas.width, l.canvas.height);
    const c = makeCanvas(r.w, r.h), ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    r.draw(ctx);
    l.canvas = c; l.x = r.x; l.y = r.y; l.text = null;
  });
  S.doc.selection = null;
}

export function resizeImage(nw, nh) {
  const d = S.doc, sx = nw / d.w, sy = nh / d.h;
  mapLayers((l, cw, ch) => {
    const w = Math.max(1, Math.round(cw * sx)), h = Math.max(1, Math.round(ch * sy));
    return { w, h, x: Math.round(l.x * sx), y: Math.round(l.y * sy), draw: ctx => ctx.drawImage(l.canvas, 0, 0, w, h) };
  });
  d.w = nw; d.h = nh;
  commit('Velikost obrazu');
}

export function resizeCanvas(nw, nh, ax, ay) {
  const d = S.doc;
  const dx = Math.round((nw - d.w) * ax), dy = Math.round((nh - d.h) * ay);
  d.layers.forEach(l => { l.x += dx; l.y += dy; });
  d.w = nw; d.h = nh; d.selection = null;
  commit('Velikost plátna');
}

export function rotateDoc(deg) {
  const d = S.doc, W = d.w, H = d.h;
  mapLayers((l, cw, ch) => {
    if (deg === 90) return { w: ch, h: cw, x: H - (l.y + ch), y: l.x, draw: c => { c.translate(ch, 0); c.rotate(Math.PI / 2); c.drawImage(l.canvas, 0, 0); } };
    if (deg === -90) return { w: ch, h: cw, x: l.y, y: W - (l.x + cw), draw: c => { c.translate(0, cw); c.rotate(-Math.PI / 2); c.drawImage(l.canvas, 0, 0); } };
    return { w: cw, h: ch, x: W - (l.x + cw), y: H - (l.y + ch), draw: c => { c.translate(cw, ch); c.rotate(Math.PI); c.drawImage(l.canvas, 0, 0); } };
  });
  if (deg !== 180) { d.w = H; d.h = W; }
  commit(deg === 180 ? 'Otočit o 180°' : deg === 90 ? 'Otočit o 90° doprava' : 'Otočit o 90° doleva');
}

export function flipDoc(dir) {
  const d = S.doc;
  mapLayers((l, cw, ch) => dir === 'h'
    ? { w: cw, h: ch, x: d.w - (l.x + cw), y: l.y, draw: c => { c.translate(cw, 0); c.scale(-1, 1); c.drawImage(l.canvas, 0, 0); } }
    : { w: cw, h: ch, x: l.x, y: d.h - (l.y + ch), draw: c => { c.translate(0, ch); c.scale(1, -1); c.drawImage(l.canvas, 0, 0); } });
  commit(dir === 'h' ? 'Převrátit plátno vodorovně' : 'Převrátit plátno svisle');
}

export function flipLayer(dir) {
  const l = activeLayer();
  if (!l) return;
  const cw = l.canvas.width, ch = l.canvas.height;
  const c = makeCanvas(cw, ch), ctx = c.getContext('2d');
  if (dir === 'h') { ctx.translate(cw, 0); ctx.scale(-1, 1); } else { ctx.translate(0, ch); ctx.scale(1, -1); }
  ctx.drawImage(l.canvas, 0, 0);
  l.canvas = c; l.text = null;
  commit(dir === 'h' ? 'Převrátit vodorovně' : 'Převrátit svisle');
}

// Ohraničení neprůhledných pixelů plátna; null, když je prázdné.
export function contentBounds(canvas) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------- filtry a přizpůsobení ----------
export function readPixels(l) {
  return l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height);
}

// Z upravených pixelů udělá plátno vrstvy (mimo výběr zůstane původní obraz).
export function filtered(l, img) {
  const t = makeCanvas(img.width, img.height);
  t.getContext('2d').putImageData(img, 0, 0);
  const sel = S.doc.selection;
  if (!sel) return t;
  const c = cloneCanvas(l.canvas), ctx = c.getContext('2d');
  ctx.translate(-l.x, -l.y);
  ctx.clip(sel.path, 'evenodd');
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(t, l.x, l.y);
  return c;
}

export function applyFilter(fn, label, params) {
  const l = activeLayer();
  if (!l) return;
  const img = readPixels(l);
  fn(img, params);
  l.canvas = filtered(l, img);
  l.text = null;
  commit(label);
}

export function fxInvert(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
}

export function fxDesaturate(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}

export function fxBrightnessContrast(img, { b, c }) {
  const C = c * 2.55, f = (259 * (C + 255)) / (255 * (259 - C));
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = f * (i - 128) + 128 + b * 2.55;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function fxHueSat(img, { h, s, l }) {
  const d = img.data, hs = h / 360, sm = s / 100, lm = l / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
    let H = 0, Sa = 0, L = (mx + mn) / 2;
    if (dd) {
      Sa = L > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      H = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
      H /= 6;
    }
    H = (H + hs + 1) % 1;
    Sa = Math.min(1, Math.max(0, Sa * (1 + sm)));
    L = lm > 0 ? L + (1 - L) * lm : L * (1 + lm);
    if (!Sa) r = g = b = L;
    else {
      const q = L < 0.5 ? L * (1 + Sa) : L + Sa - L * Sa, p = 2 * L - q;
      r = hue2rgb(p, q, H + 1 / 3); g = hue2rgb(p, q, H); b = hue2rgb(p, q, H - 1 / 3);
    }
    d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
  }
}

function blurPass(src, dst, w, h, r, horizontal) {
  const n = horizontal ? w : h, m = horizontal ? h : w;
  const step = horizontal ? 1 : w, lstep = horizontal ? w : 1, win = 2 * r + 1;
  for (let j = 0; j < m; j++) {
    const base = j * lstep;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + Math.min(n - 1, Math.max(0, k)) * step];
    for (let i = 0; i < n; i++) {
      dst[base + i * step] = sum / win;
      sum += src[base + Math.min(n - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step];
    }
  }
}

function blurChannel(a, b, w, h, r) {
  for (let k = 0; k < 3; k++) { blurPass(a, b, w, h, r, true); blurPass(b, a, w, h, r, false); }
}

// Gaussovské rozostření (3× box blur) s přednásobenou alfou, okraje se neprůhlední.
export function fxBlur(img, { r }) {
  const d = img.data, w = img.width, h = img.height, n = w * h;
  const rr = Math.max(1, Math.round(r / 2));
  const alpha0 = new Uint8Array(n);
  const A = new Float32Array(n), B = new Float32Array(n), ch = new Float32Array(n);
  for (let i = 0; i < n; i++) { alpha0[i] = d[i * 4 + 3]; A[i] = alpha0[i]; }
  blurChannel(A, B, w, h, rr);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = d[i * 4 + c] * alpha0[i];
    blurChannel(ch, B, w, h, rr);
    for (let i = 0; i < n; i++) d[i * 4 + c] = A[i] > 0.001 ? ch[i] / A[i] : 0;
  }
  for (let i = 0; i < n; i++) d[i * 4 + 3] = A[i];
}

export function fxSharpen(img, { a }) {
  const d = img.data, w = img.width, h = img.height, k = a / 100;
  const s = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        d[i + c] = s[i + c] * (1 + 4 * k) - k * (s[i + c - 4] + s[i + c + 4] + s[i + c - w * 4] + s[i + c + w * 4]);
      }
    }
  }
}

// ---------- schránka ----------
export function copy(cut) {
  const d = S.doc, l = activeLayer();
  if (!l) return;
  let b = { x: 0, y: 0, w: d.w, h: d.h };
  if (d.selection) {
    const s = d.selection.bounds, x = Math.max(0, s.x), y = Math.max(0, s.y);
    b = { x, y, w: Math.min(d.w, s.x + s.w) - x, h: Math.min(d.h, s.y + s.h) - y };
  }
  if (b.w < 1 || b.h < 1) return;
  const c = makeCanvas(b.w, b.h), ctx = c.getContext('2d');
  ctx.translate(-b.x, -b.y);
  if (d.selection) ctx.clip(d.selection.path, 'evenodd');
  ctx.drawImage(l.canvas, l.x, l.y);
  S.clipboard = { canvas: c, x: b.x, y: b.y };
  try {
    c.toBlob(blob => {
      if (blob && navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
      }
    });
  } catch { /* systémová schránka není dostupná */ }
  if (cut) {
    withLayerCtx(l, x => { x.globalCompositeOperation = 'destination-out'; x.fillRect(0, 0, d.w, d.h); });
    commit('Vyjmout');
  } else toast('Zkopírováno');
}

export function pasteInternal() {
  if (!S.clipboard || !S.doc) return false;
  const d = S.doc, cb = S.clipboard;
  const l = newLayer(`Vrstva ${d.counter++}`, 1, 1);
  l.canvas = cb.canvas;
  const inside = cb.x < d.w && cb.y < d.h;
  l.x = inside ? cb.x : Math.round((d.w - cb.canvas.width) / 2);
  l.y = inside ? cb.y : Math.round((d.h - cb.canvas.height) / 2);
  insertLayer(l);
  commit('Vložit');
  return true;
}

// Vloží obrázek (ze systémové schránky nebo souboru). Stejně velký obrázek jako
// interní schránka = naše vlastní kopie, vloží se přesně na původní místo.
export async function pasteBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const cb = S.clipboard;
  if (S.doc && cb && cb.canvas.width === bmp.width && cb.canvas.height === bmp.height) return pasteInternal();
  if (!S.doc) return openBitmap(bmp, 'Bez názvu');
  placeBitmap(bmp, null, 'Vložit');
}

export async function pasteFromMenu() {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find(t => t.startsWith('image/'));
      if (type) return pasteBlob(await it.getType(type));
    }
  } catch { /* bez oprávnění – zkusíme interní schránku */ }
  if (!pasteInternal()) toast('Schránka neobsahuje obrázek');
}

// ---------- soubory ----------
const baseName = n => n.replace(/\.[^.]+$/, '');

function openBitmap(bmp, name) {
  const d = createDoc(name, bmp.width, bmp.height, 'none');
  const l = newLayer('Pozadí', bmp.width, bmp.height);
  l.canvas.getContext('2d').drawImage(bmp, 0, 0);
  d.layers.push(l);
  d.activeId = l.id;
  addDoc(d, 'Otevřít');
}

export function placeBitmap(bmp, name, label = 'Vložit obrázek') {
  const d = S.doc;
  const s = Math.min(1, d.w / bmp.width, d.h / bmp.height);
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const l = newLayer(name || `Vrstva ${d.counter++}`, w, h, Math.round((d.w - w) / 2), Math.round((d.h - h) / 2));
  const ctx = l.canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  insertLayer(l);
  commit(label);
}

export async function openFiles(files, place = false) {
  for (const f of files) {
    try {
      if (/\.asphoto$/i.test(f.name)) { await loadProject(f); continue; }
      const bmp = await createImageBitmap(f);
      if (place && S.doc) placeBitmap(bmp, baseName(f.name));
      else openBitmap(bmp, baseName(f.name));
    } catch (e) {
      console.error(e);
      toast(`Soubor „${f.name}“ se nepodařilo otevřít`);
    }
  }
}

async function saveBlob(blob, name, description, mime, ext) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description, accept: { [mime]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

const FORMATS = {
  png: { mime: 'image/png', ext: '.png', label: 'Obrázek PNG' },
  jpeg: { mime: 'image/jpeg', ext: '.jpg', label: 'Obrázek JPEG' },
  webp: { mime: 'image/webp', ext: '.webp', label: 'Obrázek WebP' },
};

export async function exportImage(fmt, quality) {
  const d = S.doc, f = FORMATS[fmt];
  const c = flatten(d, fmt === 'jpeg' ? '#ffffff' : null);
  const blob = await new Promise(r => c.toBlob(r, f.mime, quality));
  if (!blob) return toast('Export se nezdařil');
  if (await saveBlob(blob, d.name + f.ext, f.label, f.mime, f.ext)) toast('Exportováno');
}

export async function saveProject() {
  const d = S.doc;
  const data = {
    app: 'appsisto-photo', v: 1, name: d.name, w: d.w, h: d.h, counter: d.counter,
    layers: d.layers.map(l => ({
      name: l.name, x: l.x, y: l.y, opacity: l.opacity, blend: l.blend, visible: l.visible, text: l.text,
      active: l.id === d.activeId, data: l.canvas.toDataURL('image/png'),
    })),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  if (await saveBlob(blob, d.name + '.asphoto', 'Projekt AppSisto Photo', 'application/json', '.asphoto')) {
    d.dirty = false;
    emitAll();
    toast('Projekt uložen');
  }
}

async function loadProject(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'appsisto-photo') throw new Error('Neznámý formát projektu');
  const d = createDoc(data.name || baseName(file.name), data.w, data.h, 'none');
  d.counter = data.counter || data.layers.length + 1;
  for (const ld of data.layers) {
    const img = new Image();
    img.src = ld.data;
    await img.decode();
    const l = newLayer(ld.name, img.naturalWidth, img.naturalHeight, ld.x, ld.y);
    l.canvas.getContext('2d').drawImage(img, 0, 0);
    l.opacity = ld.opacity; l.blend = ld.blend; l.visible = ld.visible; l.text = ld.text || null;
    d.layers.push(l);
    if (ld.active) d.activeId = l.id;
  }
  if (!d.activeId && d.layers.length) d.activeId = d.layers[d.layers.length - 1].id;
  addDoc(d, 'Otevřít');
  d.dirty = false;
}

export { editCtx, render };

// Rozhraní: menu, panel nástrojů, pruh voleb, panely, dialogy, klávesové zkratky.
import {
  S, on, emit, render, isMac, createDoc, addDoc, setDoc, closeDoc, activeLayer, commit,
  undo, redo, restore, zoomAt, fitView, clamp, toast,
} from './core.js';
import * as ops from './ops.js';
import { setTool, startTransform, commitTransform, cancelTransform, toolKey, nudge, setSpace, crop, text, T } from './tools.js';

const $ = id => document.getElementById(id);

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  e.append(...kids.filter(k => k != null));
  return e;
}

const svg = body => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  marquee: '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.4"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 2.4"/>',
  lasso: '<path d="M12 4c-5 0-9 2.4-9 5.6S6.6 15 11 15c5 0 10-2 10-5.6S17 4 12 4z"/><path d="M7.5 14.5c-1.5 1.6-.8 4 1.2 4 1.8 0 2.2-2 .8-3.2M8.5 18.5c.3 1.4-.3 2.6-1.5 3.5"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16"/>',
  eyedropper: '<path d="M15 5l4 4M17 3.5a2 2 0 013.5 3.5L17 10l-3-3zM13.5 8.5L5 17v2h2l8.5-8.5"/>',
  brush: '<path d="M20.5 3.5L10 14M21 3l-.5.5M9 13l2 2M9 13c-3 0-5 2-5 4.500 0 1.2-1 2-2 2.500 1.500 1 6 1.500 8-.5 1.300-1.300 1.200-3.200 1-4.500"/>',
  eraser: '<path d="M8.500 20l-5-5L14 4.500l6.500 6.500-9 9zM8.500 20H20M9 9.500l6.500 6.500"/>',
  gradient: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M6 5v14M9 5v14M12.500 5v14M17 5v14" stroke-width="1"/><path d="M3 5h4v14H3z" fill="currentColor" stroke="none"/>',
  bucket: '<path d="M4.500 12.500l8-8 7 7-7.500 7.500a1.500 1.500 0 01-2 0l-5.500-5.500a.7.7 0 010-1zM12.500 4.500L10 2M4.500 12.500h14"/><path d="M20.500 16c1 1.500 1.500 2.300 1.500 3.200a1.500 1.500 0 01-3 0c0-.9.500-1.700 1.500-3.200z"/>',
  text: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
  shape: '<rect x="3" y="3" width="12" height="12" rx="1"/><circle cx="15.500" cy="15.500" r="5.500"/>',
  hand: '<path d="M8 13V5.500a1.500 1.500 0 013 0V11M11 10V4a1.500 1.500 0 013 0v6M14 10.500v-5a1.500 1.500 0 013 0V12M17 11V8.500a1.500 1.500 0 013 0V15a7 7 0 01-7 7h-1.500a6 6 0 01-5-2.700L3.300 14a1.500 1.500 0 012.500-1.700L8 15"/>',
  zoom: '<circle cx="10.500" cy="10.500" r="6.500"/><path d="M15.500 15.500L21 21"/>',
  eye: '<path d="M2 12s3.600-6.500 10-6.500S22 12 22 12s-3.600 6.500-10 6.500S2 12 2 12z"/><circle cx="12" cy="12" r="2.800"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.500"/><path d="M16 8V5.500A1.500 1.500 0 0014.500 4h-9A1.500 1.500 0 004 5.500v9A1.500 1.500 0 005.500 16H8"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  merge: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  swap: '<path d="M7 4L4 7l3 3M4 7h9a4 4 0 014 4v2M17 20l3-3-3-3"/>',
};
const icon = name => svg(ICONS[name]);

const TOOLS = [
  ['move', 'Přesun', 'V'], ['marquee', 'Obdélníkový výběr', 'M'], ['ellipse', 'Eliptický výběr', 'M'],
  ['lasso', 'Laso', 'L'], ['crop', 'Oříznutí', 'C'], ['eyedropper', 'Kapátko', 'I'],
  ['brush', 'Štětec', 'B'], ['eraser', 'Guma', 'E'], ['gradient', 'Přechod', 'G'], ['bucket', 'Plechovka barvy', 'G'],
  ['text', 'Text', 'T'], ['shape', 'Tvar', 'U'], ['hand', 'Ručka', 'H'], ['zoom', 'Lupa', 'Z'],
];

const BLENDS = [
  ['source-over', 'Normální'], ['multiply', 'Násobit'], ['screen', 'Závoj'], ['overlay', 'Překrýt'],
  ['darken', 'Ztmavit'], ['lighten', 'Zesvětlit'], ['color-dodge', 'Zesvětlit barvy'], ['color-burn', 'Ztmavit barvy'],
  ['hard-light', 'Tvrdé světlo'], ['soft-light', 'Měkké světlo'], ['difference', 'Rozdíl'], ['exclusion', 'Vyloučit'],
  ['hue', 'Odstín'], ['saturation', 'Sytost'], ['color', 'Barva'], ['luminosity', 'Světlost'],
];

const SWATCHES = ['#000000', '#ffffff', '#41B654', '#7f7f7f', '#c3c3c3', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#b97a57', '#ffaec9', '#99d9ea', '#1d1d1b'];

// ---------- dialogy ----------
export function dialog({ title, fields = [], ok = 'OK', onInput, body, side, cancel = true }) {
  return new Promise(res => {
    const dlg = el('dialog', { class: 'dlg' + (side ? ' side' : '') });
    const form = el('form', { method: 'dialog' }, el('h3', {}, title));
    if (body) form.append(el('div', { class: 'dlg-body', html: body }));
    const inputs = {};
    const get = () => {
      const v = {};
      for (const f of fields) {
        const i = inputs[f.id];
        v[f.id] = f.type === 'checkbox' ? i.checked : (f.type === 'number' || f.type === 'range') ? (parseFloat(i.value) || 0) : i.value;
      }
      return v;
    };
    const set = (id, val) => {
      const i = inputs[id];
      if (i.type === 'checkbox') i.checked = val; else i.value = val;
      if (i._out) i._out.value = val;
    };
    for (const f of fields) {
      let input;
      if (f.type === 'select') {
        input = el('select', {}, ...f.options.map(([v, t]) => el('option', { value: v }, t)));
        input.value = f.value;
      } else if (f.type === 'checkbox') {
        input = el('input', { type: 'checkbox' });
        input.checked = !!f.value;
      } else {
        input = el('input', { type: f.type || 'text', min: f.min, max: f.max, step: f.step || (f.type === 'text' ? null : 1) });
        input.value = f.value;
      }
      inputs[f.id] = input;
      const row = el('label', { class: 'row' }, el('span', {}, f.label), input);
      if (f.type === 'range') {
        const out = el('input', { type: 'number', class: 'out', min: f.min, max: f.max });
        out.value = f.value;
        input._out = out;
        out.addEventListener('input', () => { input.value = out.value; onInput && onInput(get(), f.id, set); });
        row.append(out);
      }
      input.addEventListener('input', () => {
        if (input._out) input._out.value = input.value;
        onInput && onInput(get(), f.id, set);
      });
      form.append(row);
    }
    const btns = el('div', { class: 'btns' });
    if (cancel) btns.append(el('button', { type: 'button', onclick: () => dlg.close('cancel') }, 'Zrušit'));
    btns.append(el('button', { type: 'submit', value: 'ok', class: 'primary' }, ok));
    form.append(btns);
    dlg.append(form);
    dlg.addEventListener('close', () => { const v = dlg.returnValue === 'ok' ? get() : null; dlg.remove(); res(v); });
    document.body.append(dlg);
    dlg.showModal();
    const first = form.querySelector('input,select');
    if (first && first.select && first.type !== 'range') first.select();
  });
}

// Dialog s živým náhledem úpravy pixelů aktivní vrstvy.
async function adjust(title, fields, fn, label) {
  const l = activeLayer();
  if (!l) return;
  if (!l.visible) return toast('Aktivní vrstva je skrytá');
  const src = ops.readPixels(l);
  const apply = v => {
    const img = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    fn(img, v);
    return ops.filtered(l, img);
  };
  let latest = null, pending = false;
  const preview = v => {
    latest = v;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const c = apply(latest);
      S.preview = { layerId: l.id, draw: ctx => ctx.drawImage(c, l.x, l.y) };
      render();
    });
  };
  const v = await dialog({ title, fields, side: true, onInput: preview });
  S.preview = null;
  if (v) { l.canvas = apply(v); l.text = null; commit(label); } else render();
}

// ---------- příkazy ----------
let fileMode = 'open';
const PRESETS = { '1920x1080': 'Full HD 1920 × 1080', '1080x1080': 'Čtverec 1080 × 1080', '1080x1920': 'Story 1080 × 1920', '1200x630': 'Sdílení odkazu 1200 × 630', '2480x3508': 'A4 300 dpi 2480 × 3508' };

const cmd = {
  async newDoc() {
    const v = await dialog({
      title: 'Nový dokument',
      fields: [
        { id: 'name', label: 'Název', type: 'text', value: 'Bez názvu' },
        { id: 'preset', label: 'Předvolba', type: 'select', value: '', options: [['', 'Vlastní'], ...Object.entries(PRESETS)] },
        { id: 'w', label: 'Šířka (px)', type: 'number', value: 1920, min: 1, max: 12000 },
        { id: 'h', label: 'Výška (px)', type: 'number', value: 1080, min: 1, max: 12000 },
        { id: 'bg', label: 'Pozadí', type: 'select', value: 'white', options: [['white', 'Bílé'], ['transparent', 'Průhledné'], ['bgcolor', 'Barva pozadí']] },
      ],
      ok: 'Vytvořit',
      onInput(v, id, set) {
        if (id === 'preset' && v.preset) { const [w, h] = v.preset.split('x'); set('w', w); set('h', h); }
      },
    });
    if (!v) return;
    const w = clamp(Math.round(v.w), 1, 12000), h = clamp(Math.round(v.h), 1, 12000);
    addDoc(createDoc(v.name || 'Bez názvu', w, h, v.bg === 'bgcolor' ? S.bg : v.bg));
  },
  open() { fileMode = 'open'; $('fileInput').click(); },
  place() { fileMode = 'place'; $('fileInput').click(); },
  // Uložení se vždy nejdřív zeptá na formát; poslední volba se pamatuje.
  async save() {
    let last = 'png';
    try { last = localStorage.getItem('saveFormat') || 'png'; } catch { /* úložiště není dostupné */ }
    const v = await dialog({
      title: 'Uložit jako',
      fields: [
        {
          id: 'fmt', label: 'Formát', type: 'select', value: last,
          options: [['png', 'PNG (zachová průhlednost)'], ['jpeg', 'JPG'], ['pdf', 'PDF'], ['webp', 'WebP'], ['project', 'Projekt s vrstvami (.asphoto)']],
        },
        { id: 'q', label: 'Kvalita (JPG, PDF, WebP)', type: 'range', value: 90, min: 10, max: 100 },
      ],
      ok: 'Uložit',
    });
    if (!v) return;
    try { localStorage.setItem('saveFormat', v.fmt); } catch { /* úložiště není dostupné */ }
    if (v.fmt === 'project') ops.saveProject(); else ops.exportImage(v.fmt, v.q / 100);
  },
  close() {
    const d = S.doc;
    if (d && (!d.dirty || confirm(`Zavřít „${d.name}“ bez uložení?`))) closeDoc(d);
  },
  async imageSize() {
    const d = S.doc, ratio = d.w / d.h;
    const v = await dialog({
      title: 'Velikost obrazu',
      fields: [
        { id: 'w', label: 'Šířka (px)', type: 'number', value: d.w, min: 1, max: 12000 },
        { id: 'h', label: 'Výška (px)', type: 'number', value: d.h, min: 1, max: 12000 },
        { id: 'lock', label: 'Zachovat proporce', type: 'checkbox', value: true },
      ],
      onInput(v, id, set) {
        if (!v.lock) return;
        if (id === 'w') set('h', Math.max(1, Math.round(v.w / ratio)));
        if (id === 'h') set('w', Math.max(1, Math.round(v.h * ratio)));
      },
    });
    if (!v) return;
    const w = clamp(Math.round(v.w), 1, 12000), h = clamp(Math.round(v.h), 1, 12000);
    if (w !== d.w || h !== d.h) { ops.resizeImage(w, h); fitView(); }
  },
  async canvasSize() {
    const d = S.doc;
    const v = await dialog({
      title: 'Velikost plátna',
      fields: [
        { id: 'w', label: 'Šířka (px)', type: 'number', value: d.w, min: 1, max: 12000 },
        { id: 'h', label: 'Výška (px)', type: 'number', value: d.h, min: 1, max: 12000 },
        {
          id: 'anchor', label: 'Ukotvení', type: 'select', value: '0.5,0.5',
          options: [['0,0', 'Vlevo nahoře'], ['0.5,0', 'Nahoře'], ['1,0', 'Vpravo nahoře'], ['0,0.5', 'Vlevo'], ['0.5,0.5', 'Střed'], ['1,0.5', 'Vpravo'], ['0,1', 'Vlevo dole'], ['0.5,1', 'Dole'], ['1,1', 'Vpravo dole']],
        },
      ],
    });
    if (!v) return;
    const [ax, ay] = v.anchor.split(',').map(Number);
    ops.resizeCanvas(clamp(Math.round(v.w), 1, 12000), clamp(Math.round(v.h), 1, 12000), ax, ay);
    fitView();
  },
  brightness: () => adjust('Jas a kontrast', [
    { id: 'b', label: 'Jas', type: 'range', value: 0, min: -100, max: 100 },
    { id: 'c', label: 'Kontrast', type: 'range', value: 0, min: -100, max: 100 },
  ], ops.fxBrightnessContrast, 'Jas a kontrast'),
  hueSat: () => adjust('Odstín a sytost', [
    { id: 'h', label: 'Odstín', type: 'range', value: 0, min: -180, max: 180 },
    { id: 's', label: 'Sytost', type: 'range', value: 0, min: -100, max: 100 },
    { id: 'l', label: 'Světlost', type: 'range', value: 0, min: -100, max: 100 },
  ], ops.fxHueSat, 'Odstín a sytost'),
  blur: () => adjust('Gaussovské rozostření', [{ id: 'r', label: 'Poloměr (px)', type: 'range', value: 4, min: 1, max: 100 }], ops.fxBlur, 'Gaussovské rozostření'),
  sharpen: () => adjust('Zostřit', [{ id: 'a', label: 'Míra (%)', type: 'range', value: 50, min: 1, max: 200 }], ops.fxSharpen, 'Zostřit'),
  desaturate: () => ops.applyFilter(ops.fxDesaturate, 'Odbarvit'),
  invert: () => ops.applyFilter(ops.fxInvert, 'Invertovat'),
  rename() {
    const l = activeLayer();
    if (!l) return;
    const n = prompt('Název vrstvy', l.name);
    if (n && n !== l.name) { l.name = n; commit('Přejmenovat vrstvu'); }
  },
  help() {
    const m = isMac ? '⌘' : 'Ctrl';
    const rows = [
      ['V M L C I B E G T U H Z', 'nástroje (M a G přepínají dvojici)'], ['Mezerník + tažení', 'posun plátna'],
      [`${m} + kolečko / gesto`, 'zvětšení'], [`${m}+0 / ${m}+1`, 'přizpůsobit / 100 %'], [`${m}+Z / ${m}+Shift+Z`, 'zpět / znovu'],
      [`${m}+T (v okně prohlížeče Alt+T)`, 'volná transformace'], ['Enter / Esc', 'potvrdit / zrušit ořez a transformaci'],
      [`${m}+A / ${m}+D`, 'vybrat vše / zrušit výběr'], ['Delete', 'vymazat výběr'], ['Alt+Backspace', 'vyplnit barvou popředí'],
      ['X / D', 'prohodit / výchozí barvy'], ['[ / ]', 'velikost štětce'], ['Alt + klik štětcem', 'nabrat barvu'],
      [`${m}+J / ${m}+E`, 'duplikovat vrstvu / sloučit dolů'], [`${m}+S`, 'uložit (zeptá se na formát: PNG, JPG, PDF…)'],
    ];
    dialog({ title: 'Klávesové zkratky', cancel: false, ok: 'Zavřít', body: '<table class="keys">' + rows.map(([k, t]) => `<tr><td>${k}</td><td>${t}</td></tr>`).join('') + '</table>' });
  },
};

const MENUS = [
  ['Soubor', [
    ['Nový…', 'Alt+N', cmd.newDoc, true], ['Otevřít…', 'Ctrl+O', cmd.open, true], ['Vložit obrázek jako vrstvu…', '', cmd.place], '-',
    ['Uložit jako…', 'Ctrl+S', cmd.save], '-',
    ['Zavřít', 'Alt+W', cmd.close],
  ]],
  ['Úpravy', [
    ['Zpět', 'Ctrl+Z', undo], ['Znovu', 'Ctrl+Shift+Z', redo], '-',
    ['Vyjmout', 'Ctrl+X', () => ops.copy(true)], ['Kopírovat', 'Ctrl+C', () => ops.copy(false)], ['Vložit', 'Ctrl+V', ops.pasteFromMenu, true], ['Vymazat', 'Delete', ops.clearSelection], '-',
    ['Vyplnit barvou popředí', 'Alt+Backspace', () => ops.fill(S.fg)], ['Vyplnit barvou pozadí', 'Ctrl+Backspace', () => ops.fill(S.bg)], '-',
    ['Volná transformace', 'Ctrl+T', startTransform], ['Převrátit vodorovně', '', () => ops.flipLayer('h')], ['Převrátit svisle', '', () => ops.flipLayer('v')],
  ]],
  ['Obraz', [
    ['Jas a kontrast…', '', cmd.brightness], ['Odstín a sytost…', 'Ctrl+U', cmd.hueSat], ['Odbarvit', 'Ctrl+Shift+U', cmd.desaturate], ['Invertovat', 'Ctrl+I', cmd.invert], '-',
    ['Velikost obrazu…', 'Ctrl+Alt+I', cmd.imageSize], ['Velikost plátna…', 'Ctrl+Alt+C', cmd.canvasSize], ['Oříznout podle výběru', '', ops.cropToSelection], '-',
    ['Otočit o 90° doprava', '', () => { ops.rotateDoc(90); fitView(); }], ['Otočit o 90° doleva', '', () => { ops.rotateDoc(-90); fitView(); }], ['Otočit o 180°', '', () => ops.rotateDoc(180)],
    ['Převrátit plátno vodorovně', '', () => ops.flipDoc('h')], ['Převrátit plátno svisle', '', () => ops.flipDoc('v')],
  ]],
  ['Vrstva', [
    ['Nová vrstva', 'Ctrl+Shift+N', ops.addLayer], ['Duplikovat vrstvu', 'Ctrl+J', ops.duplicateLayer], ['Přejmenovat vrstvu…', '', cmd.rename], ['Odstranit vrstvu', '', ops.deleteLayer], '-',
    ['Posunout výš', 'Ctrl+]', () => ops.shiftLayer(1)], ['Posunout níž', 'Ctrl+[', () => ops.shiftLayer(-1)], '-',
    ['Sloučit dolů', 'Ctrl+E', ops.mergeDown], ['Do jedné vrstvy', 'Ctrl+Shift+E', ops.flattenImage],
  ]],
  ['Výběr', [
    ['Vše', 'Ctrl+A', ops.selectAll], ['Zrušit výběr', 'Ctrl+D', ops.deselect], ['Doplněk', 'Ctrl+Shift+I', ops.invertSelection],
  ]],
  ['Filtr', [
    ['Gaussovské rozostření…', '', cmd.blur], ['Zostřit…', '', cmd.sharpen],
  ]],
  ['Zobrazení', [
    ['Zvětšit', 'Ctrl++', () => zoomAt(S.doc.zoom * 1.5)], ['Zmenšit', 'Ctrl+-', () => zoomAt(S.doc.zoom / 1.5)],
    ['Přizpůsobit oknu', 'Ctrl+0', () => fitView(32)], ['Skutečná velikost (100 %)', 'Ctrl+1', () => zoomAt(1)],
  ]],
  ['Nápověda', [['Klávesové zkratky…', '', cmd.help, true]]],
];

const keyLabel = s => !isMac ? s : s.replace('Ctrl+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥').replace('Backspace', '⌫').replace('Delete', '⌦');

function buildMenus() {
  const bar = $('menubar');
  let open = null;
  const closeAll = () => { if (open) open.classList.remove('open'); open = null; };
  bar.append(el('div', { class: 'brand', html: '<svg viewBox="0 0 24 24" width="18" height="18"><rect width="24" height="24" rx="5" fill="#41B654"/><path d="M6 15l6 3 6-3M6 11.500l6 3 6-3M12 5.500l6 3-6 3-6-3z" fill="none" stroke="#fff" stroke-width="1.500" stroke-linejoin="round"/></svg>' }));
  for (const [title, items] of MENUS) {
    const list = el('div', { class: 'menu-list' });
    const m = el('div', { class: 'menu' }, el('button', { class: 'menu-title' }, title), list);
    for (const it of items) {
      if (it === '-') { list.append(el('hr')); continue; }
      const [label, key, fn, noDoc] = it;
      const b = el('button', { class: 'menu-item', onclick: () => { closeAll(); fn(); } }, el('span', {}, label), el('kbd', {}, keyLabel(key)));
      b._noDoc = noDoc;
      list.append(b);
    }
    const title$ = m.firstChild;
    const show = () => {
      closeAll();
      list.querySelectorAll('.menu-item').forEach(b => { b.disabled = !S.doc && !b._noDoc; });
      m.classList.add('open'); open = m;
    };
    title$.addEventListener('click', e => { e.stopPropagation(); if (open === m) closeAll(); else show(); });
    title$.addEventListener('pointerenter', () => { if (open && open !== m) show(); });
    bar.append(m);
  }
  document.addEventListener('pointerdown', e => { if (open && !open.contains(e.target)) closeAll(); });
}

// ---------- panel nástrojů a barvy ----------
function buildToolbar() {
  const bar = $('toolbar');
  for (const [id, label, key] of TOOLS) {
    bar.append(el('button', { class: 'tool', 'data-tool': id, title: `${label} (${key})`, html: icon(id), onclick: () => setTool(id) }));
  }
  const fgIn = el('input', { type: 'color', id: 'fgInput', oninput: e => { S.fg = e.target.value; emit('color'); } });
  const bgIn = el('input', { type: 'color', id: 'bgInput', oninput: e => { S.bg = e.target.value; emit('color'); } });
  bar.append(el('div', { class: 'colors' },
    el('label', { class: 'sw bg', title: 'Barva pozadí' }, bgIn),
    el('label', { class: 'sw fg', title: 'Barva popředí' }, fgIn),
    el('button', { class: 'mini swap', title: 'Prohodit barvy (X)', html: icon('swap'), onclick: swapColors }),
    el('button', { class: 'mini reset', title: 'Výchozí barvy (D)', onclick: resetColors }),
  ));
  const sync = () => bar.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === S.tool));
  on('tool', sync);
  sync();
}

function swapColors() { [S.fg, S.bg] = [S.bg, S.fg]; emit('color'); }
function resetColors() { S.fg = '#000000'; S.bg = '#ffffff'; emit('color'); }

function buildColorPanel() {
  const grid = $('swatches');
  for (const c of SWATCHES) {
    grid.append(el('button', {
      class: 'swatch', style: `background:${c}`, title: `${c} (Alt+klik = pozadí)`,
      onclick: e => { if (e.altKey) S.bg = c.toLowerCase(); else S.fg = c.toLowerCase(); emit('color'); },
    }));
  }
  const hex = $('hexInput');
  hex.addEventListener('change', () => {
    let v = hex.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map(c => c + c).join('');
    if (/^#[0-9a-f]{6}$/i.test(v)) { S.fg = v.toLowerCase(); emit('color'); } else hex.value = S.fg;
  });
  on('color', () => {
    $('fgInput').value = S.fg; $('bgInput').value = S.bg;
    $('fgInput').parentElement.style.background = S.fg;
    $('bgInput').parentElement.style.background = S.bg;
    hex.value = S.fg;
    if (text.ta) text.position();
  });
  emit('color');
}

// ---------- pruh voleb ----------
function num(label, obj, key, min, max, unit = '', onchange) {
  const i = el('input', { type: 'number', min, max });
  i.value = obj[key];
  i.addEventListener('input', () => {
    if (i.value === '') return;
    obj[key] = clamp(parseFloat(i.value) || min, min, max);
    onchange && onchange();
    render();
  });
  i.addEventListener('change', () => { i.value = obj[key]; });
  i.dataset.key = key;
  return el('label', { class: 'opt' }, label, i, unit);
}
function sel(label, obj, key, options, onchange) {
  const s = el('select', {}, ...options.map(([v, t]) => el('option', { value: v }, t)));
  s.value = obj[key];
  s.addEventListener('change', () => { obj[key] = s.value; onchange && onchange(); render(); s.blur(); });
  return el('label', { class: 'opt' }, label, s);
}
function chk(label, obj, key, onchange) {
  const c = el('input', { type: 'checkbox' });
  c.checked = obj[key];
  c.addEventListener('change', () => { obj[key] = c.checked; onchange && onchange(); render(); });
  return el('label', { class: 'opt' }, c, label);
}
const btn = (label, fn, cls = '') => el('button', { class: 'obtn ' + cls, onclick: fn }, label);
const hint = t => el('span', { class: 'hint' }, t);

const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'system-ui'];

function buildOptions() {
  const bar = $('optionsbar'), o = S.opts;
  const label = S.tool === 'transform' ? 'Volná transformace' : TOOLS.find(t => t[0] === S.tool)[1];
  bar.replaceChildren(el('span', { class: 'opt-tool' }, label));
  const add = (...x) => bar.append(...x);
  const selBtns = () => add(btn('Vybrat vše', ops.selectAll), btn('Zrušit výběr', ops.deselect), btn('Doplněk', ops.invertSelection), btn('Oříznout podle výběru', ops.cropToSelection));
  const need = fn => () => { if (S.doc) fn(); };
  switch (S.tool) {
    case 'move':
      add(chk('Automaticky vybrat vrstvu', o.move, 'autoSelect'), btn('Volná transformace', need(startTransform)), hint('Šipky posouvají o 1 px, se Shiftem o 10 px'));
      break;
    case 'marquee': case 'ellipse': case 'lasso':
      selBtns(); add(hint(S.tool === 'lasso' ? 'Tažením obkreslete oblast' : 'Shift = čtverec / kruh'));
      break;
    case 'crop': {
      const size = el('span', { class: 'hint', id: 'cropSize' });
      add(sel('Poměr stran', o.crop, 'ratio', [['free', 'Volný'], ['orig', 'Původní'], ['1:1', '1 : 1'], ['4:3', '4 : 3'], ['3:2', '3 : 2'], ['16:9', '16 : 9'], ['9:16', '9 : 16'], ['4:5', '4 : 5'], ['3:4', '3 : 4']], () => crop.applyRatio()),
        size, btn('✓ Oříznout', () => crop.commit(), 'primary'), btn('✕ Zrušit', () => crop.cancel()), hint('Enter potvrdí, Esc zruší'));
      break;
    }
    case 'eyedropper': add(hint('Klik nabere barvu popředí, Alt+klik barvu pozadí')); break;
    case 'brush': case 'eraser': {
      const b = o[S.tool];
      add(num('Velikost', b, 'size', 1, 1000, 'px'), num('Tvrdost', b, 'hardness', 0, 100, '%'), num('Krytí', b, 'opacity', 1, 100, '%'), hint('Shift+klik = rovná čára'));
      break;
    }
    case 'gradient':
      add(sel('Přechod', o.gradient, 'preset', [['fg-bg', 'Popředí → pozadí'], ['fg-transparent', 'Popředí → průhledná'], ['erase', 'Zprůhlednit vrstvu']]),
        sel('Typ', o.gradient, 'type', [['linear', 'Lineární'], ['radial', 'Kruhový']]),
        num('Krytí', o.gradient, 'opacity', 1, 100, '%'), chk('Obrátit', o.gradient, 'reverse'), hint('Táhněte od začátku ke konci přechodu'));
      break;
    case 'bucket':
      add(num('Tolerance', o.bucket, 'tolerance', 0, 255), num('Krytí', o.bucket, 'opacity', 1, 100, '%'), chk('Souvislé', o.bucket, 'contiguous'));
      break;
    case 'text': {
      const ch = () => text.optsChanged();
      add(sel('Písmo', o.text, 'font', FONTS.map(f => [f, f]), ch), num('Velikost', o.text, 'size', 4, 1000, 'px', ch),
        chk('Tučné', o.text, 'bold', ch), chk('Kurzíva', o.text, 'italic', ch),
        sel('Zarovnání', o.text, 'align', [['left', 'Vlevo'], ['center', 'Na střed'], ['right', 'Vpravo']], ch),
        hint(`Klik = nový text, ${isMac ? '⌘' : 'Ctrl'}+Enter potvrdí, Esc zruší`));
      break;
    }
    case 'shape':
      add(sel('Tvar', o.shape, 'kind', [['rect', 'Obdélník'], ['ellipse', 'Elipsa'], ['line', 'Čára']]), num('Zaoblení', o.shape, 'radius', 0, 2000, 'px'), num('Tloušťka čáry', o.shape, 'width', 1, 500, 'px'), hint('Tvar se vytvoří na nové vrstvě v barvě popředí'));
      break;
    case 'zoom':
      add(btn('100 %', need(() => zoomAt(1))), btn('Přizpůsobit oknu', need(() => fitView(32))), hint('Klik zvětší, Alt+klik zmenší'));
      break;
    case 'hand': add(hint('Kdykoli stačí podržet mezerník')); break;
    case 'transform': {
      const mk = (lab, id, unit) => {
        const i = el('input', { type: 'number', id, step: 'any' });
        i.addEventListener('input', () => {
          if (!T || i.value === '') return;
          const v = parseFloat(i.value);
          if (id === 'tW') T.sx = Math.max(0.001, v / 100);
          if (id === 'tH') T.sy = Math.max(0.001, v / 100);
          if (id === 'tR') T.rot = v * Math.PI / 180;
          render();
        });
        return el('label', { class: 'opt' }, lab, i, unit);
      };
      add(mk('Š', 'tW', '%'), mk('V', 'tH', '%'), mk('Úhel', 'tR', '°'),
        btn('✓ Potvrdit', () => commitTransform(), 'primary'), btn('✕ Zrušit', () => cancelTransform()),
        hint('Rohy mění velikost (Shift = volně), tažení mimo rámeček otáčí'));
      syncXform();
      break;
    }
  }
}

function syncXform() {
  if (!T) return;
  const set = (id, v) => { const i = $(id); if (i && document.activeElement !== i) i.value = Math.round(v * 10) / 10; };
  set('tW', T.sx * 100); set('tH', T.sy * 100); set('tR', T.rot * 180 / Math.PI);
}

// ---------- panel vrstev ----------
function thumb(l, d) {
  const c = el('canvas', { class: 'thumb', width: 40, height: 30 }), ctx = c.getContext('2d');
  const s = Math.min(40 / d.w, 30 / d.h), ox = (40 - d.w * s) / 2, oy = (30 - d.h * s) / 2;
  ctx.beginPath(); ctx.rect(ox, oy, d.w * s, d.h * s); ctx.clip();
  ctx.drawImage(l.canvas, ox + l.x * s, oy + l.y * s, l.canvas.width * s, l.canvas.height * s);
  return c;
}

function buildLayersPanel() {
  const list = $('layerList'), blend = $('layerBlend'), op = $('layerOpacity'), opNum = $('layerOpacityNum');
  blend.append(...BLENDS.map(([v, t]) => el('option', { value: v }, t)));
  blend.addEventListener('change', () => { const l = activeLayer(); if (l) { l.blend = blend.value; commit('Režim prolnutí'); } blend.blur(); });
  const setOp = v => { const l = activeLayer(); if (l) { l.opacity = clamp(v, 0, 100) / 100; render(); } };
  op.addEventListener('input', () => { opNum.value = op.value; setOp(+op.value); });
  op.addEventListener('change', () => { if (activeLayer()) commit('Krytí vrstvy'); });
  opNum.addEventListener('change', () => { setOp(+opNum.value || 0); if (activeLayer()) commit('Krytí vrstvy'); });

  $('layerBtns').append(
    el('button', { title: 'Nová vrstva', html: icon('plus'), onclick: () => S.doc && ops.addLayer() }),
    el('button', { title: 'Duplikovat vrstvu', html: icon('copy'), onclick: () => S.doc && ops.duplicateLayer() }),
    el('button', { title: 'Sloučit dolů', html: icon('merge'), onclick: () => S.doc && ops.mergeDown() }),
    el('button', { title: 'Odstranit vrstvu', html: icon('trash'), onclick: () => S.doc && ops.deleteLayer() }),
  );

  let dragId = null;
  on('layers', () => {
    const d = S.doc;
    list.replaceChildren();
    const l = activeLayer();
    blend.disabled = op.disabled = opNum.disabled = !l;
    if (l) { blend.value = l.blend; op.value = opNum.value = Math.round(l.opacity * 100); }
    if (!d) return;
    [...d.layers].reverse().forEach(x => {
      const eye = el('button', {
        class: 'eye' + (x.visible ? ' on' : ''), title: 'Viditelnost vrstvy', html: icon('eye'),
        onclick: e => { e.stopPropagation(); x.visible = !x.visible; commit(x.visible ? 'Zobrazit vrstvu' : 'Skrýt vrstvu'); },
      });
      const row = el('div', { class: 'layer' + (x.id === d.activeId ? ' active' : ''), draggable: 'true' },
        eye, thumb(x, d), el('span', { class: 'lname' }, x.name), x.text ? el('span', { class: 'badge' }, 'T') : null);
      row.addEventListener('click', () => { if (d.activeId !== x.id) { d.activeId = x.id; emit('layers'); } });
      row.addEventListener('dblclick', () => { d.activeId = x.id; cmd.rename(); });
      row.addEventListener('dragstart', e => { dragId = x.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(x.id)); });
      row.addEventListener('dragover', e => { if (dragId != null) { e.preventDefault(); row.classList.add('over'); } });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); row.classList.remove('over'); const id = dragId; dragId = null; if (id != null) ops.reorderLayer(id, x.id); });
      row.addEventListener('dragend', () => { dragId = null; });
      list.append(row);
    });
  });
}

function buildHistoryPanel() {
  const list = $('historyList');
  on('history', () => {
    const d = S.doc;
    list.replaceChildren();
    if (!d) return;
    d.history.forEach((h, i) => {
      list.append(el('button', { class: 'hist' + (i === d.hIndex ? ' active' : '') + (i > d.hIndex ? ' future' : ''), onclick: () => restore(i) }, h.name));
    });
    const a = list.querySelector('.active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  });
}

// ---------- záložky, stavový řádek ----------
function buildWorkspace() {
  const tabs = $('tabs'), status = $('statusbar'), welcome = $('welcome');
  on('doc', () => {
    tabs.replaceChildren(...S.docs.map(d => el('div', { class: 'tab' + (d === S.doc ? ' active' : ''), onclick: () => { if (d !== S.doc) setDoc(d); } },
      el('span', {}, d.name + (d.dirty ? ' *' : '')),
      el('button', { class: 'x', title: 'Zavřít', onclick: e => { e.stopPropagation(); if (!d.dirty || confirm(`Zavřít „${d.name}“ bez uložení?`)) closeDoc(d); } }, '×'))));
    welcome.hidden = S.docs.length > 0;
  });
  const upd = () => {
    const d = S.doc;
    status.textContent = d ? `${Math.round(d.zoom * 1000) / 10} %   ·   ${d.w} × ${d.h} px   ·   ${d.layers.length} ${d.layers.length === 1 ? 'vrstva' : d.layers.length < 5 ? 'vrstvy' : 'vrstev'}` : '';
  };
  on('view', upd); on('doc', upd); on('layers', upd);
  on('crop', () => { const s = $('cropSize'); if (s && crop.r) s.textContent = `${Math.round(crop.r.w)} × ${Math.round(crop.r.h)} px`; });
  $('welcomeNew').addEventListener('click', cmd.newDoc);
  $('welcomeOpen').addEventListener('click', cmd.open);
  $('fileInput').addEventListener('change', e => {
    const files = [...e.target.files];
    e.target.value = '';
    ops.openFiles(files, fileMode === 'place');
  });
}

// ---------- klávesové zkratky ----------
const TOOL_KEYS = { v: ['move'], m: ['marquee', 'ellipse'], l: ['lasso'], c: ['crop'], i: ['eyedropper'], b: ['brush'], e: ['eraser'], g: ['gradient', 'bucket'], t: ['text'], u: ['shape'], h: ['hand'], z: ['zoom'] };

function onKey(e) {
  if (document.querySelector('dialog[open]')) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape' || e.key === 'Enter') e.target.blur();
    if (!(tag === 'INPUT' && (e.target.type === 'range' || e.target.type === 'checkbox' || e.target.type === 'color'))) return;
  }
  const mod = isMac ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase(), code = e.code;
  const hit = fn => { e.preventDefault(); fn(); };
  const needDoc = fn => hit(() => { if (S.doc) fn(); });

  if (e.key === ' ' && !mod) { e.preventDefault(); setSpace(true); return; }
  if (mod) {
    if (k === 'o') return hit(cmd.open);
    if (k === 'z') return needDoc(e.shiftKey ? redo : undo);
    if (k === 'y') return needDoc(redo);
    if (k === 's') return needDoc(cmd.save);
    if (k === 'c' && !e.altKey) return needDoc(() => ops.copy(false));
    if (k === 'x') return needDoc(() => ops.copy(true));
    if (k === 'v') return; // vložení obslouží událost paste
    if (k === 'a') return needDoc(ops.selectAll);
    if (k === 'd') return needDoc(ops.deselect);
    if (k === 'j') return needDoc(ops.duplicateLayer);
    if (k === 'e') return needDoc(e.shiftKey ? ops.flattenImage : ops.mergeDown);
    if (k === 't') return needDoc(startTransform);
    if (k === 'u') return needDoc(e.shiftKey ? cmd.desaturate : cmd.hueSat);
    if (code === 'KeyI') return needDoc(e.altKey ? cmd.imageSize : e.shiftKey ? ops.invertSelection : cmd.invert);
    if (code === 'KeyC' && e.altKey) return needDoc(cmd.canvasSize);
    if (code === 'KeyN' && e.shiftKey) return needDoc(ops.addLayer);
    if (k === '0') return needDoc(() => fitView(32));
    if (k === '1') return needDoc(() => zoomAt(1));
    if (k === '+' || k === '=') return needDoc(() => zoomAt(S.doc.zoom * 1.5));
    if (k === '-') return needDoc(() => zoomAt(S.doc.zoom / 1.5));
    if (k === ']') return needDoc(() => ops.shiftLayer(1));
    if (k === '[') return needDoc(() => ops.shiftLayer(-1));
    if (e.key === 'Backspace') return needDoc(() => ops.fill(S.bg));
    return;
  }
  if (e.altKey) {
    if (code === 'KeyN') return hit(cmd.newDoc);
    if (code === 'KeyW') return needDoc(cmd.close);
    if (code === 'KeyT') return needDoc(startTransform);
    if (e.key === 'Backspace') return needDoc(() => ops.fill(S.fg));
    return;
  }
  if (!S.doc) return;
  if (e.key === 'Enter' || e.key === 'Escape') { if (toolKey(e.key)) e.preventDefault(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') return hit(() => { if (S.doc.selection) ops.clearSelection(); });
  if (e.key.startsWith('Arrow')) {
    if (S.tool !== 'move' && S.tool !== 'transform') return;
    const s = e.shiftKey ? 10 : 1;
    return hit(() => nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0));
  }
  if (k === 'x') return hit(swapColors);
  if (k === 'd') return hit(resetColors);
  if (k === '[' || k === ']') {
    const b = S.opts[S.tool === 'eraser' ? 'eraser' : 'brush'];
    b.size = clamp(Math.round(b.size * (k === ']' ? 1.25 : 0.8)) + (k === ']' ? 1 : -1), 1, 1000);
    if (S.tool === 'brush' || S.tool === 'eraser') buildOptions();
    return render();
  }
  const group = TOOL_KEYS[k];
  if (group) {
    const i = group.indexOf(S.tool);
    hit(() => setTool(group[(i + 1) % group.length]));
  }
}

export function initUI() {
  buildMenus();
  buildToolbar();
  buildColorPanel();
  buildLayersPanel();
  buildHistoryPanel();
  buildWorkspace();
  buildOptions();
  on('tool', buildOptions);
  on('xform', syncXform);

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', e => { if (e.key === ' ') setSpace(false); });
  window.addEventListener('blur', () => setSpace(false));

  document.addEventListener('paste', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    e.preventDefault();
    if (item) ops.pasteBlob(item.getAsFile());
    else if (!ops.pasteInternal()) toast('Schránka neobsahuje obrázek');
  });

  window.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    ops.openFiles([...e.dataTransfer.files], !!S.doc);
  });

  window.addEventListener('beforeunload', e => { if (S.docs.some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });
  emit('doc'); emit('layers'); emit('history'); emit('view');
}

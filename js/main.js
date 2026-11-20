import { S, initView } from './core.js';
import { initTools } from './tools.js';
import { initUI } from './ui.js';
import * as ops from './ops.js';

const view = document.getElementById('view');
initView(view);
initTools(view);
initUI();

// Soubory otevřené přes „Otevřít v aplikaci“ u nainstalované PWA.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    const files = await Promise.all((params.files || []).map(h => h.getFile()));
    if (files.length) ops.openFiles(files, false);
  });
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.__app = { S, ops }; // pro ladění z konzole

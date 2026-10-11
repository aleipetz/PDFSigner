import * as pdfjsLib from './vendor/pdf.min.js';
import { PDFDocument, StandardFonts, rgb, degrees } from './vendor/pdf-lib.esm.min.js';
import { loadImageFromFile, preparePhoto, processPhoto, trimCanvas, DrawPad } from './signature.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', import.meta.url).href;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- Persistência ----------
const STORE = 'pdfsigner.';
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(STORE + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(STORE + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(STORE + key); } catch { /* ignora */ } },
};

const DEFAULT_SETTINGS = { place: '', dateFormat: 'short', textColor: '#111111' };
let settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };

// slot -> { dataUrl, width, height }
const sigs = { signature: store.get('sig.signature', null), initials: store.get('sig.initials', null) };

// ---------- Utilidades ----------
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function formatDate(d = new Date(), fmt = settings.dateFormat) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  if (fmt === 'long') return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function busy(on, text = 'Processando…') {
  $('#busy-text').textContent = text;
  $('#busy').hidden = !on;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
}

// ---------- Tela inicial ----------
function renderSlots() {
  for (const slot of ['signature', 'initials']) {
    const thumb = document.querySelector(`.sig-slot[data-slot="${slot}"] .sig-thumb`);
    const s = sigs[slot];
    thumb.innerHTML = s
      ? `<img alt="" src="${s.dataUrl}">`
      : `<span class="muted">${slot === 'signature' ? 'Nenhuma assinatura' : 'Nenhuma rubrica (opcional)'}</span>`;
    document.querySelector(`[data-edit-slot="${slot}"]`).textContent =
      (s ? 'Trocar ' : 'Configurar ') + (slot === 'signature' ? 'assinatura' : 'rubrica');
  }
}

// ---------- Diálogo de assinatura ----------
const sigDialog = $('#sig-dialog');
closeOnBackdrop(sigDialog);
const drawPad = new DrawPad($('#sig-draw-canvas'));
const sigState = { slot: 'signature', tab: 'photo', img: null, prep: null, rotation: 0, result: null };

function openSigDialog(slot) {
  sigState.slot = slot;
  sigState.img = null; sigState.prep = null; sigState.result = null; sigState.rotation = 0;
  $('#sig-dialog-title').textContent = slot === 'signature' ? 'Sua assinatura' : 'Sua rubrica';
  $('#sig-photo-controls').hidden = true;
  $('#sig-photo-empty').hidden = false;
  const pc = $('#sig-photo-canvas');
  pc.width = pc.height = 0;
  $('#sig-sensitivity').value = 50;
  $('#sig-delete').hidden = !sigs[slot];
  switchTab('photo');
  sigDialog.showModal();
  drawPad.clear();
}

function switchTab(tab) {
  sigState.tab = tab;
  $$('#sig-dialog .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('#sig-dialog .tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  if (tab === 'draw') requestAnimationFrame(() => drawPad.resize());
}

$$('#sig-dialog .tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
window.addEventListener('resize', () => { if (sigDialog.open && sigState.tab === 'draw') drawPad.resize(); });

function selectedColor(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function refreshPhoto() {
  if (!sigState.prep) return;
  const out = processPhoto(sigState.prep, Number($('#sig-sensitivity').value), selectedColor('sig-color'));
  sigState.result = out;
  const pc = $('#sig-photo-canvas');
  if (!out) {
    pc.width = pc.height = 0;
    $('#sig-photo-empty').hidden = false;
    $('#sig-photo-empty').textContent = 'Nenhum traço encontrado. Aumente a sensibilidade ou tire outra foto.';
    return;
  }
  $('#sig-photo-empty').hidden = true;
  pc.width = out.width; pc.height = out.height;
  pc.getContext('2d').drawImage(out, 0, 0);
}

let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshPhoto, 60);
}

$('#sig-photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  busy(true, 'Removendo o fundo…');
  try {
    sigState.img = await loadImageFromFile(file);
    sigState.rotation = 0;
    sigState.prep = preparePhoto(sigState.img, sigState.rotation);
    $('#sig-photo-controls').hidden = false;
    refreshPhoto();
  } catch (err) {
    toast(err.message);
  } finally {
    busy(false);
  }
});

$('#sig-sensitivity').addEventListener('input', scheduleRefresh);
$$('input[name="sig-color"]').forEach((r) => r.addEventListener('change', refreshPhoto));
$('#sig-rotate').addEventListener('click', () => {
  if (!sigState.img) return;
  sigState.rotation = (sigState.rotation + 90) % 360;
  sigState.prep = preparePhoto(sigState.img, sigState.rotation);
  refreshPhoto();
});

$$('input[name="draw-color"]').forEach((r) => r.addEventListener('change', () => { drawPad.color = r.value; }));
$('#sig-draw-clear').addEventListener('click', () => drawPad.clear());

$('#sig-delete').addEventListener('click', () => {
  if (!confirm('Remover esta assinatura salva?')) return;
  sigs[sigState.slot] = null;
  store.remove('sig.' + sigState.slot);
  renderSlots();
  sigDialog.close();
});

$('#sig-save').addEventListener('click', () => {
  let canvas = null;
  if (sigState.tab === 'photo') {
    canvas = sigState.result;
    if (!canvas) return toast('Tire uma foto da assinatura primeiro.');
  } else {
    if (drawPad.isEmpty()) return toast('Desenhe sua assinatura primeiro.');
    canvas = trimCanvas(drawPad.canvas);
    if (!canvas) return toast('Desenhe sua assinatura primeiro.');
  }
  const value = { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  sigs[sigState.slot] = value;
  if (!store.set('sig.' + sigState.slot, value)) {
    toast('Não foi possível salvar no aparelho (modo anônimo?). A assinatura vale só nesta sessão.', 4000);
  }
  renderSlots();
  sigDialog.close();
  if (pendingTool) { const t = pendingTool; pendingTool = null; setTool(t); }
});

$$('[data-edit-slot]').forEach((b) => b.addEventListener('click', () => openSigDialog(b.dataset.editSlot)));

// ---------- Configurações ----------
const settingsDialog = $('#settings-dialog');
closeOnBackdrop(settingsDialog);
$('#btn-settings').addEventListener('click', () => {
  $('#set-place').value = settings.place;
  $('#set-date-format').value = settings.dateFormat;
  $('#set-text-color').value = settings.textColor;
  settingsDialog.showModal();
});
$('#settings-save').addEventListener('click', () => {
  settings = {
    place: $('#set-place').value.trim(),
    dateFormat: $('#set-date-format').value,
    textColor: $('#set-text-color').value,
  };
  store.set('settings', settings);
  settingsDialog.close();
  toast('Configurações salvas.');
});

// ---------- Documento ----------
const doc = {
  name: '',
  bytes: null, // Uint8Array original (cópia intocada)
  pdf: null, // documento pdf.js
  pages: [], // { el, canvas, width, height, rotate, rendered, viewport }
  items: [],
};
let nextId = 1;
let selected = null;
let currentTool = null;
let pendingTool = null;

async function openPdf(file) {
  busy(true, 'Abrindo PDF…');
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    doc.bytes = buf.slice();
    if (doc.pdf) await doc.pdf.destroy();
    doc.pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
    doc.name = (file.name || 'documento.pdf').replace(/\.pdf$/i, '');
    doc.items = [];
    selected = null;
    await buildPages();
    $('#home').hidden = true;
    $('#editor').hidden = false;
    $('#toolbar').hidden = false;
    $('#btn-save').hidden = false;
    $('#btn-back').hidden = false;
    $('#btn-settings').hidden = true;
    $('#doc-title').textContent = doc.name;
    updateToolbar();
    window.scrollTo(0, 0);
    if (!sigs.signature) toast('Dica: configure sua assinatura na tela inicial (botão ✕).', 4000);
  } catch (err) {
    console.error(err);
    const msg = err && err.name === 'PasswordException'
      ? 'Este PDF é protegido por senha e não pode ser aberto.'
      : 'Não foi possível abrir este PDF.';
    toast(msg, 4000);
  } finally {
    busy(false);
  }
}

async function buildPages() {
  const container = $('#pages');
  container.innerHTML = '';
  doc.pages = [];
  for (let n = 1; n <= doc.pdf.numPages; n++) {
    const page = await doc.pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const el = document.createElement('div');
    el.className = 'page';
    el.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    el.dataset.index = n - 1;
    const label = document.createElement('div');
    label.className = 'page-num';
    label.textContent = `Página ${n} de ${doc.pdf.numPages}`;
    el.appendChild(label);
    container.appendChild(el);
    doc.pages.push({ el, page, viewport, canvas: null, rendered: false, rotate: page.rotate });
    el.addEventListener('pointerdown', onPagePointerDown);
  }
  updateScales();
  observePages();
}

function updateScales() {
  for (const p of doc.pages) {
    const w = p.el.clientWidth;
    if (w) p.el.style.setProperty('--scale', w / p.viewport.width);
  }
}
window.addEventListener('resize', () => { updateScales(); });

let observer;
function observePages() {
  if (observer) observer.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) renderPage(doc.pages[Number(e.target.dataset.index)]);
    }
  }, { rootMargin: '600px 0px' });
  doc.pages.forEach((p) => observer.observe(p.el));
}

async function renderPage(p) {
  if (p.rendered) return;
  p.rendered = true;
  const cssWidth = p.el.clientWidth || 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // Limita a resolução para não estourar a memória em celulares.
  const maxPixels = 4.5e6;
  let scale = (cssWidth * dpr) / p.viewport.width;
  const area = p.viewport.width * p.viewport.height * scale * scale;
  if (area > maxPixels) scale *= Math.sqrt(maxPixels / area);
  const vp = p.page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf';
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  p.el.prepend(canvas);
  p.canvas = canvas;
  try {
    await p.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  } catch (err) {
    console.error('Falha ao renderizar página', err);
  }
}

function closeDocument() {
  if (doc.items.length && !confirm('Fechar o documento? As marcações não salvas serão perdidas.')) return;
  if (observer) observer.disconnect();
  $('#pages').innerHTML = '';
  if (doc.pdf) doc.pdf.destroy();
  doc.pdf = null; doc.bytes = null; doc.pages = []; doc.items = [];
  selected = null;
  setTool(null);
  $('#home').hidden = false;
  $('#editor').hidden = true;
  $('#toolbar').hidden = true;
  $('#item-bar').hidden = true;
  $('#btn-save').hidden = true;
  $('#btn-back').hidden = true;
  $('#btn-settings').hidden = false;
  $('#doc-title').textContent = 'PDF Signer';
}
$('#btn-back').addEventListener('click', closeDocument);

$('#pdf-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) openPdf(file);
});

// ---------- Ferramentas ----------
const TOOL_HINT = {
  signature: 'Toque na página onde vai a assinatura',
  initials: 'Toque na página onde vai a rubrica',
  date: 'Toque onde vai a data',
  place: 'Toque onde vai o local',
  placedate: 'Toque onde vai o local e a data',
  text: 'Toque onde vai o texto',
};

function updateToolbar() {
  $$('#toolbar [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === currentTool));
}

function setTool(tool) {
  currentTool = tool;
  updateToolbar();
  const hint = $('#hint');
  hint.hidden = !tool;
  if (tool) hint.textContent = TOOL_HINT[tool] + ' (toque no botão de novo para cancelar)';
  $('#pages').classList.toggle('placing', !!tool);
  if (tool) select(null);
}

$$('#toolbar [data-tool]').forEach((b) => b.addEventListener('click', () => {
  const tool = b.dataset.tool;
  if (currentTool === tool) return setTool(null);
  if ((tool === 'signature' || tool === 'initials') && !sigs[tool]) {
    pendingTool = tool;
    return openSigDialog(tool);
  }
  if ((tool === 'place' || tool === 'placedate') && !settings.place) {
    const place = prompt('Qual o local? (ex.: São Paulo/SP)\nEle ficará salvo para as próximas vezes.', '');
    if (!place || !place.trim()) return;
    settings.place = place.trim();
    store.set('settings', settings);
  }
  setTool(tool);
}));

function textForTool(tool) {
  if (tool === 'date') return formatDate();
  if (tool === 'place') return settings.place;
  if (tool === 'placedate') return `${settings.place}, ${formatDate()}`;
  return '';
}

function onPagePointerDown(e) {
  if (!currentTool) {
    if (e.target === e.currentTarget || e.target.classList.contains('pdf')) select(null);
    return;
  }
  if (e.target.closest('.item')) return;
  const p = doc.pages[Number(e.currentTarget.dataset.index)];
  const rect = p.el.getBoundingClientRect();
  const fx = (e.clientX - rect.left) / rect.width;
  const fy = (e.clientY - rect.top) / rect.height;
  const tool = currentTool;
  setTool(null);

  if (tool === 'signature' || tool === 'initials') {
    const s = sigs[tool];
    // Largura padrão em pontos: assinatura ~ 150pt (5,3 cm), rubrica ~ 60pt.
    const wPt = Math.min(tool === 'signature' ? 150 : 60, p.viewport.width * 0.6);
    const w = wPt / p.viewport.width;
    const h = (wPt * (s.height / s.width)) / p.viewport.height;
    addItem({ type: 'image', slot: tool, page: p, x: fx - w / 2, y: fy - h / 2, w, h, src: s });
  } else {
    let text = textForTool(tool);
    if (tool === 'text') {
      text = prompt('Digite o texto:', '');
      if (!text) return;
    }
    const fs = 11;
    addItem({ type: 'text', page: p, x: fx, y: fy - (fs / p.viewport.height) / 2, fs, text, color: settings.textColor });
  }
}

// ---------- Itens ----------
function addItem(data) {
  const item = { id: nextId++, ...data };
  const el = document.createElement('div');
  el.className = 'item ' + item.type;
  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = item.src.dataUrl;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.appendChild(document.createElement('span'));
  }
  const handle = document.createElement('div');
  handle.className = 'handle';
  el.appendChild(handle);
  item.el = el;
  item.page.el.appendChild(el);
  doc.items.push(item);
  layoutItem(item);
  attachDrag(item, el, handle);
  select(item);
  return item;
}

function layoutItem(item) {
  const el = item.el;
  el.style.left = item.x * 100 + '%';
  el.style.top = item.y * 100 + '%';
  if (item.type === 'image') {
    el.style.width = item.w * 100 + '%';
    el.style.height = item.h * 100 + '%';
  } else {
    el.firstChild.textContent = item.text;
    el.style.setProperty('--fs', item.fs);
    el.style.setProperty('--color', item.color);
  }
}

function select(item) {
  if (selected && selected.el) selected.el.classList.remove('selected');
  selected = item;
  if (item) item.el.classList.add('selected');
  const bar = $('#item-bar');
  bar.hidden = !item;
  if (item) bar.querySelector('[data-act="edit"]').hidden = item.type !== 'text';
}

function attachDrag(item, el, handle) {
  let mode = null, start = null;

  const onDown = (e, m) => {
    if (currentTool) return;
    e.preventDefault();
    e.stopPropagation();
    select(item);
    mode = m;
    const rect = item.page.el.getBoundingClientRect();
    start = {
      px: e.clientX, py: e.clientY, x: item.x, y: item.y, w: item.w, h: item.h, fs: item.fs,
      pw: rect.width, ph: rect.height, elw: el.offsetWidth,
    };
    el.setPointerCapture(e.pointerId);
  };

  el.addEventListener('pointerdown', (e) => onDown(e, e.target === handle ? 'resize' : 'move'));
  el.addEventListener('pointermove', (e) => {
    if (!mode) return;
    e.preventDefault();
    const dx = (e.clientX - start.px) / start.pw;
    const dy = (e.clientY - start.py) / start.ph;
    if (mode === 'move') {
      item.x = start.x + dx;
      item.y = start.y + dy;
    } else if (item.type === 'image') {
      const w = Math.max(0.03, start.w + dx);
      item.w = w;
      item.h = start.h * (w / start.w);
    } else {
      const k = Math.max(0.2, (start.elw + (e.clientX - start.px)) / start.elw);
      item.fs = Math.max(4, Math.min(72, start.fs * k));
    }
    layoutItem(item);
  });
  const end = () => { mode = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { if (item.type === 'text') editText(item); });
}

function editText(item) {
  const text = prompt('Editar texto:', item.text);
  if (text == null) return;
  if (!text.trim()) return removeItem(item);
  item.text = text;
  layoutItem(item);
}

function removeItem(item) {
  item.el.remove();
  doc.items = doc.items.filter((i) => i !== item);
  if (selected === item) select(null);
}

$('#item-bar').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const item = selected;
  if (!act || !item) return;
  if (act === 'delete') return removeItem(item);
  if (act === 'edit') return editText(item);
  if (act === 'duplicate') {
    const { id, el, ...rest } = item;
    const copy = addItem({ ...rest, y: item.y + (item.type === 'image' ? item.h : (item.fs * 1.4) / item.page.viewport.height) });
    return copy;
  }
  const k = act === 'bigger' ? 1.1 : 1 / 1.1;
  if (item.type === 'image') {
    const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
    item.w *= k; item.h *= k;
    item.x = cx - item.w / 2; item.y = cy - item.h / 2;
  } else {
    item.fs = Math.max(4, Math.min(72, item.fs * k));
  }
  layoutItem(item);
});

// ---------- Geração do PDF ----------
// Posição da linha de base do texto, como fração do tamanho da fonte, medida a
// partir do topo da caixa (line-height: 1) – coincide com Helvetica/Arial na tela.
const BASELINE = 0.86;

async function buildSignedPdf() {
  const pdfDoc = await PDFDocument.load(doc.bytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const embedded = new Map();

  for (const item of doc.items) {
    const pi = doc.pages.indexOf(item.page);
    const page = pages[pi];
    const vp = item.page.viewport; // escala 1, já com a rotação da página
    const rot = ((item.page.rotate % 360) + 360) % 360;
    const toPdf = (fx, fy) => vp.convertToPdfPoint(fx * vp.width, fy * vp.height);

    if (item.type === 'image') {
      let img = embedded.get(item.src.dataUrl);
      if (!img) { img = await pdfDoc.embedPng(item.src.dataUrl); embedded.set(item.src.dataUrl, img); }
      const [x, y] = toPdf(item.x, item.y + item.h); // canto inferior esquerdo visual
      page.drawImage(img, { x, y, width: item.w * vp.width, height: item.h * vp.height, rotate: degrees(rot) });
    } else {
      const lines = item.text.split('\n');
      lines.forEach((line, i) => {
        if (!line) return;
        const baseY = item.y + ((i + BASELINE) * item.fs) / vp.height;
        const [x, y] = toPdf(item.x, baseY);
        page.drawText(sanitize(line, font), { x, y, size: item.fs, font, color: hexToRgb(item.color), rotate: degrees(rot) });
      });
    }
  }
  return pdfDoc.save();
}

// A fonte padrão (WinAnsi) cobre acentos do português; troca o resto por equivalentes.
function sanitize(text, font) {
  const map = { '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...' };
  let out = '';
  for (const ch of text) {
    const c = map[ch] ?? ch;
    try { font.encodeText(c); out += c; } catch { out += '?'; }
  }
  return out;
}

let lastUrl = null;
$('#btn-save').addEventListener('click', async () => {
  if (!doc.items.length && !confirm('Nenhuma assinatura ou texto foi adicionado. Salvar mesmo assim?')) return;
  select(null);
  busy(true, 'Gerando PDF…');
  try {
    const bytes = await buildSignedPdf();
    const fileName = `${doc.name}_assinado.pdf`;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(blob);
    showResult(blob, fileName);
  } catch (err) {
    console.error(err);
    toast('Erro ao gerar o PDF: ' + (err.message || err), 5000);
  } finally {
    busy(false);
  }
});

const resultDialog = $('#result-dialog');
closeOnBackdrop(resultDialog);
function showResult(blob, fileName) {
  $('#result-name').textContent = fileName;
  const dl = $('#result-download');
  dl.href = lastUrl;
  dl.download = fileName;
  $('#result-open').href = lastUrl;
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const shareBtn = $('#result-share');
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  shareBtn.hidden = !canShare;
  shareBtn.onclick = async () => {
    try { await navigator.share({ files: [file], title: fileName }); } catch (err) {
      if (err.name !== 'AbortError') toast('Não foi possível compartilhar.');
    }
  };
  resultDialog.showModal();
}

// ---------- PDF recebido via "Compartilhar" (Android, app instalado) ----------
async function checkSharedFile() {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('pdfsigner-share');
    const res = await cache.match('shared-file');
    if (!res) return;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('X-File-Name') || 'documento.pdf');
    await cache.delete('shared-file');
    openPdf(new File([blob], name, { type: 'application/pdf' }));
  } catch (err) {
    console.error(err);
  }
}

// ---------- Início ----------
renderSlots();
checkSharedFile();
// PDF aberto pelo sistema ("Abrir com…"), quando o app está instalado.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) openPdf(await params.files[0].getFile());
  });
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW', err));
}

// Exposto para testes automatizados.
window.__pdfsigner = { doc, sigs, buildSignedPdf, addItem, openPdf };

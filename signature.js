// Captura de assinatura: foto do papel (remoção de fundo) ou desenho com o dedo.

const MAX_SOURCE = 1800; // maior dimensão usada no processamento da foto
const MAX_OUTPUT = 1200; // maior dimensão do PNG final

export const INK_COLORS = { blue: [20, 48, 110], black: [17, 17, 17] };

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
    img.src = url;
  });
}

// Desenha a imagem (já respeitando a orientação EXIF do navegador) reduzida e girada.
function drawSource(img, rotation) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const k = Math.min(1, MAX_SOURCE / Math.max(iw, ih));
  const w = Math.round(iw * k), h = Math.round(ih * k);
  const swap = rotation % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

// Estima a cor do papel em cada ponto (iluminação irregular, sombras) usando um
// "fechamento" grosseiro: reduz a imagem pegando o pixel mais claro de cada bloco
// e depois amplia suavemente.
function estimateBackground(src) {
  const w = src.width, h = src.height;
  const block = Math.max(8, Math.round(Math.max(w, h) / 48));
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block);
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const small = document.createElement('canvas');
  small.width = bw; small.height = bh;
  const sctx = small.getContext('2d');
  const out = sctx.createImageData(bw, bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let best = -1, br = 255, bg = 255, bb = 255;
      const y1 = Math.min(h, (by + 1) * block), x1 = Math.min(w, (bx + 1) * block);
      for (let y = by * block; y < y1; y += 2) {
        for (let x = bx * block; x < x1; x += 2) {
          const i = (y * w + x) * 4;
          const l = data[i] + data[i + 1] + data[i + 2];
          if (l > best) { best = l; br = data[i]; bg = data[i + 1]; bb = data[i + 2]; }
        }
      }
      const o = (by * bw + bx) * 4;
      out.data[o] = br; out.data[o + 1] = bg; out.data[o + 2] = bb; out.data[o + 3] = 255;
    }
  }
  sctx.putImageData(out, 0, 0);
  // Amplia com interpolação para não criar degraus entre os blocos.
  const big = document.createElement('canvas');
  big.width = w; big.height = h;
  const gctx = big.getContext('2d', { willReadFrequently: true });
  gctx.imageSmoothingEnabled = true;
  gctx.imageSmoothingQuality = 'high';
  gctx.drawImage(small, 0, 0, w, h);
  return { data, bg: gctx.getImageData(0, 0, w, h).data, w, h };
}

// Prepara a foto uma única vez; process() pode ser chamado várias vezes (slider/cor).
export function preparePhoto(img, rotation = 0) {
  const src = drawSource(img, rotation);
  const { data, bg, w, h } = estimateBackground(src);
  // "Escuridão" relativa ao papel: 0 = papel, 1 = tinta muito escura.
  const dark = new Float32Array(w * h);
  for (let p = 0, i = 0; p < dark.length; p++, i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const lb = Math.max(1, 0.299 * bg[i] + 0.587 * bg[i + 1] + 0.114 * bg[i + 2]);
    dark[p] = Math.max(0, 1 - l / lb);
  }
  return { data, bg, dark, w, h };
}

export function processPhoto(prep, sensitivity = 50, colorMode = 'original') {
  const { data, bg, dark, w, h } = prep;
  // Sensibilidade alta = limiar baixo (pega traços mais claros).
  const s = sensitivity / 100;
  const t0 = 0.30 - 0.24 * s;
  const t1 = t0 + 0.18;
  const alpha = new Float32Array(w * h);
  for (let p = 0; p < alpha.length; p++) {
    const a = (dark[p] - t0) / (t1 - t0);
    alpha[p] = a <= 0.06 ? 0 : a >= 1 ? 1 : a;
  }

  // Remove pontinhos isolados e calcula a área útil (linhas/colunas com tinta suficiente).
  const rowCount = new Uint32Array(h), colCount = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > 0.5) { rowCount[y]++; colCount[x]++; }
    }
  }
  const minRow = Math.max(2, Math.round(w * 0.002)), minCol = Math.max(2, Math.round(h * 0.002));
  let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
  while (x0 < w && colCount[x0] < minCol) x0++;
  while (x1 > x0 && colCount[x1] < minCol) x1--;
  while (y0 < h && rowCount[y0] < minRow) y0++;
  while (y1 > y0 && rowCount[y1] < minRow) y1--;
  if (x0 >= x1 || y0 >= y1) return null;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);

  // Cor da tinta: média dos pixels bem escuros, normalizada pelo papel.
  let ink;
  if (colorMode === 'original') {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * w + x;
        if (alpha[p] >= 0.95) {
          const i = p * 4;
          r += (data[i] / Math.max(1, bg[i])) * 255;
          g += (data[i + 1] / Math.max(1, bg[i + 1])) * 255;
          b += (data[i + 2] / Math.max(1, bg[i + 2])) * 255;
          n++;
        }
      }
    }
    ink = n ? [r / n, g / n, b / n] : INK_COLORS.black;
    // Escurece um pouco: fotos costumam clarear a tinta.
    ink = ink.map((v) => Math.max(0, Math.min(255, v * 0.75)));
  } else {
    ink = INK_COLORS[colorMode] || INK_COLORS.black;
  }

  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const octx = out.getContext('2d');
  const od = octx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = alpha[(y + y0) * w + (x + x0)];
      const o = (y * cw + x) * 4;
      od.data[o] = ink[0]; od.data[o + 1] = ink[1]; od.data[o + 2] = ink[2];
      od.data[o + 3] = Math.round(a * 255);
    }
  }
  octx.putImageData(od, 0, 0);
  return limitSize(out);
}

function limitSize(canvas) {
  const k = Math.min(1, MAX_OUTPUT / Math.max(canvas.width, canvas.height));
  if (k === 1) return canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

// Recorta um canvas transparente para a área com tinta.
export function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d').drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return limitSize(c);
}

// Área de desenho com traço suave e espessura variando com a velocidade.
export class DrawPad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = '#14306e';
    this.strokes = 0;
    this.points = [];
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => this.up());
    canvas.addEventListener('pointercancel', () => this.up());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;
    this.clear();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokes = 0;
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr, t: e.timeStamp, p: e.pressure };
  }

  baseWidth() { return Math.max(2.2, this.canvas.width / 260); }

  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.drawing = true;
    const p = this.pos(e);
    this.points = [p];
    this.lastWidth = this.baseWidth();
    this.ctx.fillStyle = this.color;
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, this.lastWidth / 2, 0, Math.PI * 2);
    this.ctx.fill();
    this.strokes++;
  }

  move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) this.addPoint(this.pos(ev));
  }

  addPoint(p) {
    const pts = this.points;
    const last = pts[pts.length - 1];
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist < 1) return;
    pts.push(p);
    const dt = Math.max(1, p.t - last.t);
    const speed = dist / dt / this.dpr; // px CSS por ms
    const base = this.baseWidth();
    const pressure = p.p && p.p !== 0.5 ? 0.6 + p.p : 1;
    const target = Math.max(base * 0.45, Math.min(base * 1.5, base * (1.35 - speed * 0.35))) * pressure;
    const width = this.lastWidth * 0.7 + target * 0.3;
    const ctx = this.ctx;
    ctx.strokeStyle = this.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    if (pts.length >= 3) {
      const a = pts[pts.length - 3], b = pts[pts.length - 2];
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + p.x) / 2, (b.y + p.y) / 2);
    } else {
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    this.lastWidth = width;
  }

  up() {
    if (!this.drawing) return;
    this.drawing = false;
    const pts = this.points;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  isEmpty() { return this.strokes === 0; }
}

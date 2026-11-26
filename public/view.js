import { SIZE, palette, initialRow } from './board.js';

import { island } from './island.js';

const surface = document.querySelector('#surface');
const ctx = surface.getContext('2d');
const bitmap = document.createElement('canvas');
bitmap.width = bitmap.height = SIZE;
const paint = bitmap.getContext('2d');
const pixels = new Uint8Array(SIZE * SIZE);
const rgb = palette.map(([, hex]) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
const center = { x: SIZE / 2, y: SIZE / 2 };
let width = 1, height = 1, scale = 1, frame = 0, fitted = false;
let selected = null, hover = null, grid = true, pencil = true, ink = 3;
let moving = false, lastPoint, startPoint;
const contacts = new Map();
export const viewEvents = new EventTarget();
const changed = () => viewEvents.dispatchEvent(new Event('selection'));
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const fitScale = () => Math.min(width, height) * .94 / SIZE;
const left = () => width / 2 - center.x * scale;
const top = () => height / 2 - center.y * scale;

// Reuse a single scanline while decoding the nine-million-pixel board.
const scanline = paint.createImageData(SIZE, 1);
function paintRow(y, row) {
  pixels.set(row, y * SIZE);
  for (let x = 0; x < SIZE; x++) {
    const color = rgb[row[x]];
    scanline.data[x * 4] = color[0];
    scanline.data[x * 4 + 1] = color[1];
    scanline.data[x * 4 + 2] = color[2];
    scanline.data[x * 4 + 3] = 255;
  }
  paint.putImageData(scanline, 0, y);
}

export function loadSnapshot(buffer, first) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 2 || (bytes.length - 1) % (SIZE + 2)) throw new Error('Invalid snapshot');
  if (first) {
    pixels.fill(0);
    paint.fillStyle = palette[0][1];
    paint.fillRect(0, 0, SIZE, SIZE);
    for (let y = island.y; y < island.y + island.rows.length; y++) paintRow(y, initialRow(y));
  }
  for (let i = 1; i < bytes.length; i += SIZE + 2) {
    const y = (bytes[i] << 8) + bytes[i + 1];
    paintRow(y, bytes.subarray(i + 2, i + 2 + SIZE));
  }
  invalidate();
}
export function setPixel({ x, y, color }) {
  pixels[y * SIZE + x] = color;
  paint.fillStyle = palette[color][1];
  paint.fillRect(x, y, 1, 1);
  invalidate();
}
export function chosen() { return selected; }
export function sameColor() { return selected && pixels[selected.y * SIZE + selected.x] === ink; }
export function setInk(color) { ink = color; invalidate(); }
function invalidate() {
  if (!frame) frame = requestAnimationFrame(draw);
}
function backing(canvas, w, h) {
  const dpr = devicePixelRatio || 1;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}
function ruler(id, horizontal) {
  const canvas = document.querySelector(id);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const c = backing(canvas, w, h);
  c.clearRect(0, 0, w, h);
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(n => n * scale >= 55) || 1000;
  const origin = horizontal ? left() : top();
  const length = horizontal ? w : h;
  c.fillStyle = '#5f665e';
  c.font = '10px Tahoma, sans-serif';
  for (let i = 0; i <= SIZE; i += step / 5) {
    const p = Math.round(origin + i * scale);
    if (p < 0 || p > length) continue;
    const major = Math.abs(i / step - Math.round(i / step)) < .00001;
    const tick = major ? 6 : 3;
    if (horizontal) {
      c.fillRect(p, h - tick, 1, tick);
      if (major) c.fillText(Math.round(i), p + 3, 11);
    } else {
      c.fillRect(w - tick, p, tick, 1);
      if (major) {
        c.save(); c.translate(w - 8, p - 3); c.rotate(-Math.PI / 2);
        c.fillText(Math.round(i), 0, 0); c.restore();
      }
    }
  }
  c.fillStyle = '#c2c5ba';
  if (horizontal) c.fillRect(0, h - 1, w, 1);
  else c.fillRect(w - 1, 0, 1, h);
}
function draw() {
  frame = 0;
  backing(surface, width, height);
  const ox = left(), oy = top(), side = SIZE * scale;
  ctx.fillStyle = '#9da6a5';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, ox, oy, side, side);
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, side, side); ctx.clip();
  if (grid && scale >= 2) {
    const step = scale < 3 ? scale * 10 : scale < 8 ? scale * 5 : scale;
    ctx.fillStyle = scale < 8 ? 'rgba(71,99,128,.075)' : 'rgba(71,99,128,.12)';
    for (let x = ox % step; x < width; x += step) ctx.fillRect(Math.round(x), 0, 1, height);
    for (let y = oy % step; y < height; y += step) ctx.fillRect(0, Math.round(y), width, 1);
  }
  for (const cell of [pencil ? hover : null, selected]) {
    if (!cell) continue;
    const x = ox + cell.x * scale, y = oy + cell.y * scale;
    const s = Math.max(scale, 5);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(x - 1, y - 1, s + 2, s + 2);
    ctx.strokeStyle = '#18212b'; ctx.lineWidth = 1; ctx.strokeRect(x - 1, y - 1, s + 2, s + 2);
    if (cell === selected) {
      ctx.globalAlpha = .68; ctx.fillStyle = palette[ink][1];
      ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  ruler('#top-ruler', true); ruler('#left-ruler', false);
  document.querySelector('#zoom-value').textContent = Math.round(scale * 100) + '%';
  const cell = selected || hover;
  document.querySelector('#coords').textContent = cell ? cell.x + ', ' + cell.y : '—, —';
}
function boundCenter() {
  center.x = clamp(center.x, 0, SIZE);
  center.y = clamp(center.y, 0, SIZE);
}
function zoomAt(next, p = { x: width / 2, y: height / 2 }) {
  const value = clamp(next, fitScale(), 64);
  center.x += (p.x - width / 2) * (1 / scale - 1 / value);
  center.y += (p.y - height / 2) * (1 / scale - 1 / value);
  scale = value; fitted = false; boundCenter(); invalidate();
}
function fit() {
  center.x = center.y = SIZE / 2; scale = fitScale(); fitted = true; invalidate();
}
function mode(isPencil) {
  pencil = isPencil;
  surface.classList.toggle('pan', !pencil);
  document.querySelector('#pencil').setAttribute('aria-pressed', pencil);
  document.querySelector('#hand').setAttribute('aria-pressed', !pencil);
  invalidate();
}
document.querySelector('#pencil').onclick = () => mode(true);
document.querySelector('#hand').onclick = () => mode(false);
document.querySelector('#grid').onclick = e => {
  grid = !grid; e.currentTarget.setAttribute('aria-pressed', grid); invalidate();
};
document.querySelector('#plus').onclick = () => zoomAt(scale * 2);
document.querySelector('#minus').onclick = () => zoomAt(scale / 2);
document.querySelector('#fit').onclick = fit;
function point(event) {
  const rect = surface.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function cellAt(p) {
  const x = Math.floor((p.x - left()) / scale), y = Math.floor((p.y - top()) / scale);
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE ? { x, y } : null;
}
function gesture() {
  const [a, b] = contacts.values();
  if (!b) return { ...a, distance: 0 };
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
}
surface.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault(); surface.focus({ preventScroll: true });
  surface.setPointerCapture(event.pointerId);
  contacts.set(event.pointerId, point(event));
  startPoint = lastPoint = gesture();
  moving = contacts.size > 1 || !pencil || event.button === 1;
});
surface.addEventListener('pointermove', event => {
  const p = point(event);
  if (!contacts.has(event.pointerId)) { hover = cellAt(p); invalidate(); return; }
  contacts.set(event.pointerId, p);
  const next = gesture();
  if (Math.hypot(next.x - startPoint.x, next.y - startPoint.y) > 4) moving = true;
  if (moving) {
    surface.classList.add('drag'); hover = null;
    center.x -= (next.x - lastPoint.x) / scale; center.y -= (next.y - lastPoint.y) / scale;
    if (next.distance && lastPoint.distance) zoomAt(scale * next.distance / lastPoint.distance, next);
    boundCenter(); invalidate(); lastPoint = next;
  }
});
function release(event, commit) {
  if (!contacts.has(event.pointerId)) return;
  if (commit && !moving && pencil) {
    selected = cellAt(point(event));
    if (selected && scale < 3) {
      center.x = selected.x + .5; center.y = selected.y + .5; zoomAt(8);
    }
    changed();
  }
  contacts.delete(event.pointerId);
  if (contacts.size) { startPoint = lastPoint = gesture(); moving = true; }
  else { moving = false; surface.classList.remove('drag'); }
  hover = null; invalidate();
}
surface.addEventListener('pointerup', e => release(e, true));
surface.addEventListener('lostpointercapture', e => release(e, false));
surface.addEventListener('pointercancel', e => release(e, false));
surface.addEventListener('pointerleave', () => { hover = null; invalidate(); });
surface.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
  zoomAt(scale * Math.exp(-clamp(delta, -300, 300) * .004), point(e));
}, { passive: false });
surface.addEventListener('keydown', e => {
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.querySelector('#place').click(); return; }
  if (e.key === 'Escape') { selected = null; changed(); invalidate(); return; }
  if (!dirs[e.key]) return;
  e.preventDefault();
  const [dx, dy] = dirs[e.key];
  const base = selected || { x: Math.floor(center.x), y: Math.floor(center.y) };
  selected = { x: clamp(base.x + dx, 0, SIZE - 1), y: clamp(base.y + dy, 0, SIZE - 1) };
  if (scale < 3) zoomAt(8);
  if (Math.abs(selected.x + .5 - center.x) * scale > width / 2 - scale) center.x = selected.x + .5;
  if (Math.abs(selected.y + .5 - center.y) * scale > height / 2 - scale) center.y = selected.y + .5;
  changed(); invalidate();
});
let firstSize = true;
new ResizeObserver(() => {
  width = surface.clientWidth; height = surface.clientHeight;
  if (firstSize) { scale = clamp(Math.floor(Math.min(width / 155, height / 102)), 2, 8); firstSize = false; }
  else if (fitted) fit();
  invalidate();
}).observe(surface);

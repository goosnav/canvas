import { browserId, palette, PIXELS_PER_TURN, COOLDOWN } from './board.js';
import { canvasPNG, chosen, sameColor, loadSnapshot, setPixel, setInk, viewEvents } from './view.js';

const $ = selector => document.querySelector(selector);
const placementHint = matchMedia('(pointer: coarse)').matches ? 'Double-tap a pixel' : 'Double-click a pixel';
const place = $('#place'), hint = $('#hint'), connection = $('#connection');
const save = $('#save');
const saveLabel = save.lastElementChild;
let ink = 3, live = false, deadline = 0, pending = false, retry = 500;
let saving = false;
let rules = { pixels: PIXELS_PER_TURN, seconds: COOLDOWN / 1000 };
let available = rules.pixels;
let socket, responseTimer, retryTimer, tick;
const swatches = palette.map(([name, hex], index) => {
  const button = document.createElement('button');
  button.className = 'swatch';
  button.style.setProperty('--swatch', hex);
  button.title = name;
  button.setAttribute('aria-label', name);
  button.onclick = () => choose(index);
  $('#palette').append(button);
  return button;
});
function choose(index) {
  ink = index; setInk(index);
  const [name, hex] = palette[index];
  $('#sample').style.background = hex;
  $('#sample').parentElement.title = name;
  swatches.forEach((button, i) => button.setAttribute('aria-pressed', i === index));
  update();
}
function update() {
  const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
  if (!seconds) available = rules.pixels;
  const waiting = available === 0;
  place.disabled = !live || pending || waiting || !chosen() || sameColor();
  place.textContent = pending ? 'Placing…' : waiting ? 'Wait ' + seconds + 's' : 'Place pixel';
  hint.textContent = !live ? '' : !chosen() ? placementHint : sameColor() ? 'Choose another color' : palette[ink][0];
  clearTimeout(tick);
  $('.turn').textContent = live ? available + '/' + rules.pixels + ' pixels' : rules.pixels + ' pixels / ' + rules.seconds + 's';
  if (seconds) tick = setTimeout(update, 250);
}
function setLive(value, message) {
  live = value;
  save.disabled = !live || saving;
  connection.classList.toggle('live', value);
  connection.lastElementChild.textContent = message;
  update();
}
function connect() {
  clearTimeout(retryTimer);
  try {
    if (!browserId(document.cookie) && crypto.randomUUID) {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = 'canvas_browser=' + crypto.randomUUID() + '; Path=/; Max-Age=31536000; SameSite=Lax' + secure;
    }
  } catch {
    // Browsers that block cookies use the IP-based allowance.
  }
  const url = new URL('/api/live', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer'; socket = ws;
  let snapshotReceived = false;
  ws.onmessage = ({ data }) => {
    if (ws !== socket) return;
    try {
      if (data instanceof ArrayBuffer) {
        loadSnapshot(data, !snapshotReceived); snapshotReceived = true; return;
      }
      const event = JSON.parse(data);
      if (event.rules) {
        rules = event.rules;
        window.dispatchEvent(new CustomEvent("canvas-rules", { detail: rules }));
        $('#rule-help').textContent = `You can place ${rules.pixels} per turn. The first placement starts a ${rules.seconds}-second timer. All placements refill together.`;
      }
      switch (event.type) {
        case 'ready':
          if (!snapshotReceived) throw new Error('Missing canvas');
          retry = 500; available = event.remaining; deadline = performance.now() + event.wait;
          setLive(true, 'Live'); break;
        case 'pixel': setPixel(event); break;
        case 'quota':
        case 'limit':
          available = event.remaining; deadline = performance.now() + event.wait;
          if (event.type === 'limit') { pending = false; clearTimeout(responseTimer); }
          break;
        case 'placed':
        case 'same': pending = false; clearTimeout(responseTimer); break;
      }
      update();
    } catch { ws.close(4000, 'Resync'); }
  };
  ws.onclose = () => {
    if (ws !== socket) return;
    pending = false; clearTimeout(responseTimer); setLive(false, 'Reconnecting…');
    retryTimer = setTimeout(connect, retry + Math.random() * 250);
    retry = Math.min(12000, retry * 2);
  };
  ws.onerror = () => ws.close();
}
function placePixel() {
  if (place.disabled || socket.readyState !== WebSocket.OPEN) return;
  pending = true; update();
  socket.send(JSON.stringify({ ...chosen(), color: ink }));
  responseTimer = setTimeout(() => socket.close(4000, 'Refresh placement'), 8000);
}
place.onclick = placePixel;
save.onclick = async () => {
  saving = true;
  save.disabled = true;
  saveLabel.textContent = 'Saving…';
  try {
    const png = await canvasPNG();
    const url = URL.createObjectURL(png);
    const download = document.createElement('a');
    download.href = url;
    download.download = 'goosnav-canvas.png';
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    saveLabel.textContent = 'Save PNG';
  } catch {
    saveLabel.textContent = 'Retry PNG';
  } finally {
    saving = false;
    save.disabled = !live;
  }
};
viewEvents.addEventListener('place', placePixel);
viewEvents.addEventListener('selection', update);
$('#help').onclick = () => $('#guide').showModal();
window.addEventListener('online', () => { if (socket.readyState === WebSocket.CLOSED) connect(); });
window.addEventListener('pageshow', e => { if (e.persisted && socket.readyState === WebSocket.CLOSED) connect(); });
choose(3);
connect();

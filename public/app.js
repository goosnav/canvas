import { palette } from './board.js';
import { chosen, sameColor, loadSnapshot, setPixel, setInk, viewEvents } from './view.js';

const $ = selector => document.querySelector(selector);
const place = $('#place'), hint = $('#hint'), connection = $('#connection');
let ink = 3, live = false, deadline = 0, pending = false, retry = 500;
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
  const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
  place.disabled = !live || pending || remaining > 0 || !chosen() || sameColor();
  place.textContent = pending ? 'Placing…' : remaining ? 'Wait ' + remaining + 's' : 'Place pixel';
  hint.textContent = !live ? '' : !chosen() ? 'Select a pixel' : sameColor() ? 'Choose another color' : palette[ink][0];
  clearTimeout(tick);
  if (remaining) tick = setTimeout(update, 250);
}
function setLive(value, message) {
  live = value;
  connection.classList.toggle('live', value);
  connection.lastElementChild.textContent = message;
  update();
}
function connect() {
  clearTimeout(retryTimer);
  const url = new URL('/api/live', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer'; socket = ws;
  let snapshotReceived = false;
  ws.onmessage = ({ data }) => {
    if (ws !== socket) return;
    try {
      if (data instanceof ArrayBuffer) {
        loadSnapshot(data); snapshotReceived = true; return;
      }
      const event = JSON.parse(data);
      switch (event.type) {
        case 'ready':
          if (!snapshotReceived) throw new Error('Missing canvas');
          retry = 500; deadline = performance.now() + event.wait;
          setLive(true, 'Live'); break;
        case 'pixel': setPixel(event); break;
        case 'wait': deadline = performance.now() + event.wait;
          // The server delivers this to every tab sharing a turn.
          pending = false; clearTimeout(responseTimer); break;
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
place.onclick = () => {
  if (place.disabled || socket.readyState !== WebSocket.OPEN) return;
  pending = true; update();
  socket.send(JSON.stringify({ ...chosen(), color: ink }));
  responseTimer = setTimeout(() => socket.close(4000, 'Refresh placement'), 8000);
};
viewEvents.addEventListener('selection', update);
$('#help').onclick = () => $('#guide').showModal();
window.addEventListener('online', () => { if (socket.readyState === WebSocket.CLOSED) connect(); });
window.addEventListener('pageshow', e => { if (e.persisted && socket.readyState === WebSocket.CLOSED) connect(); });
choose(3);
connect();

import { PREVIEW, palette } from './board.js';

const { x: left, y: top, width, height } = PREVIEW;
const canvas = document.querySelector('canvas');
const connection = document.querySelector('#connection');
canvas.width = width;
canvas.height = height;
const paint = canvas.getContext('2d');
const colors = palette.map(([, hex]) => hex);
const url = new URL('/api/preview', location.href);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
let delay = 1000;

function draw(x, y, color) {
  paint.fillStyle = colors[color];
  paint.fillRect(x, y, 1, 1);
}

function connect() {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  socket.onmessage = ({ data }) => {
    if (typeof data !== 'string') {
      const pixels = new Uint8Array(data);
      if (pixels.length !== width * height) return socket.close();
      pixels.forEach((color, index) => draw(index % width, Math.floor(index / width), color));
      canvas.hidden = false;
      connection.hidden = true;
      delay = 1000;
    } else {
      const { x, y, color } = JSON.parse(data);
      draw(x - left, y - top, color);
    }
  };
  socket.onclose = () => {
    connection.textContent = 'Reconnecting…';
    canvas.hidden = true;
    connection.hidden = false;
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000);
  };
}

connect();

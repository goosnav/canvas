import { DurableObject } from 'cloudflare:workers';
import { SIZE, COOLDOWN, initialRow, palette } from '../public/board.js';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname !== '/api/live') return new Response('Unknown route', { status: 404 });
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('Wrong origin', { status: 403 });
    return env.BOARD.getByName('public-canvas-v1').fetch(request);
  }
};

function send(socket, message) {
  try {
    socket.send(message);
  } catch {
    // Other viewers should still receive their updates after a peer disconnects.
    socket.close(1011, 'Reconnect');
  }
}

export class CanvasBoard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS stripes (y INTEGER PRIMARY KEY, pixels BLOB NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS turns (visitor TEXT PRIMARY KEY, until INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS expired ON turns(until)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, salt BLOB NOT NULL)');
    this.sql.exec('INSERT OR IGNORE INTO settings VALUES (1, randomblob(32))');
    this.key = crypto.subtle.importKey('raw', this.sql.exec('SELECT salt FROM settings').one().salt,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }

  waitTime(visitor) {
    const turn = this.sql.exec('SELECT until FROM turns WHERE visitor = ?', visitor).toArray()[0];
    return Math.max(0, (turn?.until ?? 0) - Date.now());
  }

  async fetch(request) {
    const address = request.headers.get('CF-Connecting-IP') || 'local';
    const hash = await crypto.subtle.sign('HMAC', await this.key, new TextEncoder().encode(address));
    const visitor = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [visitor]);
    server.serializeAttachment(visitor);

    // Snapshot and subscription use one synchronous turn, so no edit can fall between them.
    const rows = this.sql.exec('SELECT y, pixels FROM stripes').toArray();
    const snapshot = new Uint8Array(1 + rows.length * (SIZE + 2));
    snapshot[0] = 1;
    rows.forEach(({ y, pixels }, i) => {
      const offset = 1 + i * (SIZE + 2);
      snapshot[offset] = y >> 8;
      snapshot[offset + 1] = y & 255;
      snapshot.set(new Uint8Array(pixels), offset + 2);
    });
    server.send(snapshot);
    server.send(JSON.stringify({ type: 'ready', wait: this.waitTime(visitor) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, data) {
    if (typeof data !== 'string' || data.length > 128) return socket.close(1008, 'Invalid placement');
    let move;
    try { move = JSON.parse(data); } catch { return socket.close(1008, 'Invalid JSON'); }
    const { x, y, color } = move ?? {};
    if (![x, y, color].every(Number.isInteger) || x < 0 || y < 0 || x >= SIZE || y >= SIZE ||
        color < 0 || color >= palette.length) return socket.close(1008, 'Invalid pixel');

    const visitor = socket.deserializeAttachment();
    const wait = this.waitTime(visitor);
    if (wait) return send(socket, JSON.stringify({ type: 'wait', wait }));
    const saved = this.sql.exec('SELECT pixels FROM stripes WHERE y = ?', y).toArray()[0];
    const row = saved ? new Uint8Array(saved.pixels) : initialRow(y);
    if (row[x] === color) return send(socket, JSON.stringify({ type: 'same' }));

    row[x] = color;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT OR REPLACE INTO stripes VALUES (?, ?)', y, row.buffer);
      this.sql.exec('DELETE FROM turns WHERE until <= ?', now);
      this.sql.exec('INSERT OR REPLACE INTO turns VALUES (?, ?)', visitor, now + COOLDOWN);
    });

    const pixel = JSON.stringify({ type: 'pixel', x, y, color });
    for (const peer of this.ctx.getWebSockets()) send(peer, pixel);
    const cooldown = JSON.stringify({ type: 'wait', wait: COOLDOWN });
    for (const peer of this.ctx.getWebSockets(visitor)) send(peer, cooldown);
  }

  webSocketClose(socket) { socket.close(1000, 'Disconnected'); }
}

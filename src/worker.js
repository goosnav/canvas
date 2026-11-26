import { DurableObject } from 'cloudflare:workers';
import { browserId, SIZE, COOLDOWN, PIXELS_PER_TURN, initialRow, palette, PREVIEW } from '../public/board.js';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname !== '/api/live' && url.pathname !== '/api/preview') return new Response('Unknown route', { status: 404 });
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('Wrong origin', { status: 403 });
    return env.BOARD.getByName('public-canvas-v2').fetch(request);
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
    this.browserLimit = env.PIXEL_RATE_LIMIT === 'browser';
    this.rateTag = this.browserLimit ? 'rate:browser' : 'rate:ip';
    const previousRateTag = this.browserLimit ? 'rate:ip' : 'rate:browser';
    for (const socket of ctx.getWebSockets(previousRateTag)) {
      socket.close(1012, 'Placement limit changed');
    }
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS stripes (y INTEGER PRIMARY KEY, pixels BLOB NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS turns (visitor TEXT PRIMARY KEY, until INTEGER NOT NULL, remaining INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS expired ON turns(until)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, salt BLOB NOT NULL)');
    this.sql.exec('INSERT OR IGNORE INTO settings VALUES (1, randomblob(32))');
    this.key = crypto.subtle.importKey('raw', this.sql.exec('SELECT salt FROM settings').one().salt,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }

  allowance(visitor, now) {
    const turn = this.sql.exec('SELECT until, remaining FROM turns WHERE visitor = ?', visitor).toArray()[0];
    if (turn && turn.until > now) return { remaining: turn.remaining, wait: turn.until - now };
    return { remaining: PIXELS_PER_TURN, wait: 0 };
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/api/preview') return this.preview();
    const address = request.headers.get('CF-Connecting-IP') || 'local';
    const id = this.browserLimit && browserId(request.headers.get('Cookie') ?? '');
    const identity = id ? 'browser:' + id : address;
    const hash = await crypto.subtle.sign('HMAC', await this.key, new TextEncoder().encode(identity));
    const visitor = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [visitor, this.rateTag]);
    server.serializeAttachment(visitor);

    // Snapshot and subscription use one synchronous turn, so no edit can fall between them.
    const rowWidth = SIZE + 2;
    const batch = new Uint8Array(1 + 64 * rowWidth);
    batch[0] = 2;
    let offset = 1;
    for (const { y, pixels } of this.sql.exec('SELECT y, pixels FROM stripes')) {
      batch[offset] = y >> 8;
      batch[offset + 1] = y & 255;
      batch.set(new Uint8Array(pixels), offset + 2);
      offset += rowWidth;
      if (offset === batch.length) {
        server.send(batch.slice());
        offset = 1;
      }
    }
    server.send(batch.slice(0, offset));
    server.send(JSON.stringify({ type: 'ready', ...this.allowance(visitor, Date.now()) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  preview() {
    const { x, y, width, height } = PREVIEW;
    const saved = new Map([...this.sql.exec('SELECT y,pixels FROM stripes WHERE y >= ? AND y < ?', y, y + height)]
      .map(row => [row.y, new Uint8Array(row.pixels)]));
    const pixels = new Uint8Array(width * height);
    for (let offset = 0; offset < height; offset++) {
      const row = saved.get(y + offset) ?? initialRow(y + offset);
      pixels.set(row.subarray(x, x + width), offset * width);
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ['preview']);
    server.send(pixels);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, data) {
    const visitor = socket.deserializeAttachment();
    if (!visitor) return socket.close(1008, 'Read-only preview');
    if (typeof data !== 'string' || data.length > 128) return socket.close(1008, 'Invalid placement');
    let move;
    try { move = JSON.parse(data); } catch { return socket.close(1008, 'Invalid JSON'); }
    const { x, y, color } = move ?? {};
    if (![x, y, color].every(Number.isInteger) || x < 0 || y < 0 || x >= SIZE || y >= SIZE ||
        color < 0 || color >= palette.length) return socket.close(1008, 'Invalid pixel');

    const now = Date.now();
    const quota = this.allowance(visitor, now);
    if (!quota.remaining) return send(socket, JSON.stringify({ type: 'limit', ...quota }));
    const saved = this.sql.exec('SELECT pixels FROM stripes WHERE y = ?', y).toArray()[0];
    const row = saved ? new Uint8Array(saved.pixels) : initialRow(y);
    if (row[x] === color) return send(socket, JSON.stringify({ type: 'same' }));

    row[x] = color;
    const remaining = quota.remaining - 1;
    const wait = quota.wait || COOLDOWN;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT OR REPLACE INTO stripes VALUES (?, ?)', y, row.buffer);
      this.sql.exec('DELETE FROM turns WHERE until <= ?', now);
      this.sql.exec('INSERT OR REPLACE INTO turns VALUES (?, ?, ?)', visitor, now + wait, remaining);
    });

    const pixel = JSON.stringify({ type: 'pixel', x, y, color });
    const inPreview = x >= PREVIEW.x && x < PREVIEW.x + PREVIEW.width &&
      y >= PREVIEW.y && y < PREVIEW.y + PREVIEW.height;
    for (const peer of this.ctx.getWebSockets()) {
      if (inPreview || !this.ctx.getTags(peer).includes('preview')) send(peer, pixel);
    }
    for (const peer of this.ctx.getWebSockets(visitor)) {
      send(peer, JSON.stringify({ type: 'quota', remaining, wait }));
    }
    send(socket, JSON.stringify({ type: 'placed' }));
  }

  webSocketClose(socket) { socket.close(1000, 'Disconnected'); }
}

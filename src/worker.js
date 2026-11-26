import { DurableObject } from 'cloudflare:workers';
import { browserId, SIZE, COOLDOWN, PIXELS_PER_TURN, initialRow, palette, PREVIEW } from '../public/board.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return new Response('Wrong origin', { status: 403 });
    if (url.pathname === '/api/admin/settings') {
      if (!env.CANVAS_ADMIN_KEY) return reply({ error: 'Set CANVAS_ADMIN_KEY on the Worker to enable login.' }, 503);
      const authorization = request.headers.get('Authorization') || '';
      const encode = value => new TextEncoder().encode(value);
      const [expected, supplied] = await Promise.all([env.CANVAS_ADMIN_KEY, authorization.slice(7)]
        .map(value => crypto.subtle.digest('SHA-256', encode(value))));
      if (!authorization.startsWith('Bearer ') || !crypto.subtle.timingSafeEqual(expected, supplied)) {
        return reply({ error: 'Incorrect API key.' }, 401);
      }
      if (!['GET', 'PUT'].includes(request.method)) return reply({ error: 'Unsupported method.' }, 405);
    } else {
      if (url.pathname !== '/api/live' && url.pathname !== '/api/preview') return new Response('Unknown route', { status: 404 });
      if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket required', { status: 426 });
      }
    }
    return env.BOARD.getByName('public-canvas-v2').fetch(request);
  }
};

function reply(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

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
    // Reconnect legacy editors once so they acquire both identity tags.
    for (const tag of ['rate:browser', 'rate:ip']) {
      for (const socket of ctx.getWebSockets(tag)) socket.close(1012, 'Refresh placement settings');
    }
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS stripes (y INTEGER PRIMARY KEY, pixels BLOB NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS turns (visitor TEXT PRIMARY KEY, until INTEGER NOT NULL, remaining INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS expired ON turns(until)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, salt BLOB NOT NULL)');
    this.sql.exec('INSERT OR IGNORE INTO settings VALUES (1, randomblob(32))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS placement_rules (id INTEGER PRIMARY KEY, pixels INTEGER, seconds INTEGER, mode TEXT)');
    this.rules = this.sql.exec('SELECT pixels, seconds, mode FROM placement_rules WHERE id = 1').toArray()[0] ??
      { pixels: PIXELS_PER_TURN, seconds: COOLDOWN / 1000, mode: env.PIXEL_RATE_LIMIT === 'browser' ? 'browser' : 'ip' };
    this.key = crypto.subtle.importKey('raw', this.sql.exec('SELECT salt FROM settings').one().salt,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }

  allowance(visitor, now) {
    const turn = this.sql.exec('SELECT until, remaining FROM turns WHERE visitor = ?', visitor).toArray()[0];
    if (turn && turn.until > now) return { remaining: turn.remaining, wait: turn.until - now };
    return { remaining: this.rules.pixels, wait: 0 };
  }

  async adminSettings(request) {
    if (request.method === 'GET') return reply(this.rules);
    let data;
    try { data = await request.json(); } catch { return reply({ error: 'Invalid settings.' }, 400); }
    const { pixels, seconds, mode } = data ?? {};
    if (!Number.isInteger(pixels) || pixels < 1 || pixels > 1000 ||
        !Number.isInteger(seconds) || seconds < 1 || seconds > 3600 || !['browser', 'ip'].includes(mode)) {
      return reply({ error: 'Use 1–1000 pixels, 1–3600 seconds, and a valid sharing mode.' }, 400);
    }
    if (this.rules.pixels !== pixels || this.rules.seconds !== seconds || this.rules.mode !== mode) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('INSERT OR REPLACE INTO placement_rules VALUES (1, ?, ?, ?)', pixels, seconds, mode);
        this.sql.exec('DELETE FROM turns');
      });
      this.rules = { pixels, seconds, mode };
      const message = JSON.stringify({ type: 'quota', rules: this.rules, remaining: pixels, wait: 0 });
      for (const socket of this.ctx.getWebSockets('editor')) send(socket, message);
    }
    return reply(this.rules);
  }

  async hashIdentity(value) {
    const hash = await crypto.subtle.sign('HMAC', await this.key, new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/admin/settings') return this.adminSettings(request);
    if (path === '/api/preview') return this.preview();
    const address = request.headers.get('CF-Connecting-IP') || 'local';
    const id = browserId(request.headers.get('Cookie') ?? '');
    const ip = await this.hashIdentity(address);
    const browser = id ? await this.hashIdentity('browser:' + id) : ip;
    const identities = { browser, ip };
    const visitor = identities[this.rules.mode];
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ['editor', 'ip:' + ip, 'browser:' + browser]);
    server.serializeAttachment(identities);

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
    server.send(JSON.stringify({ type: 'ready', rules: this.rules, ...this.allowance(visitor, Date.now()) }));
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
    const identities = socket.deserializeAttachment();
    if (typeof identities === 'string') return socket.close(1012, 'Refresh placement settings');
    const visitor = identities?.[this.rules.mode];
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
    const wait = quota.wait || this.rules.seconds * 1000;
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
    for (const peer of this.ctx.getWebSockets(this.rules.mode + ':' + visitor)) {
      send(peer, JSON.stringify({ type: 'quota', remaining, wait }));
    }
    send(socket, JSON.stringify({ type: 'placed' }));
  }

  webSocketClose(socket) { socket.close(1000, 'Disconnected'); }
}

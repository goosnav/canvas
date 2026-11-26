import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PREVIEW, SIZE, initialRow } from '../public/board.js';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startWorker(port, storage) {
  const proc = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev',
    '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', storage],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let log = '';
  proc.stdout.on('data', chunk => { log += chunk; });
  proc.stderr.on('data', chunk => { log += chunk; });
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, 'exit');
      proc.kill('SIGTERM');
      await exited;
    }
  };
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) break;
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/api/live');
      if (res.status === 426) return stop;
    } catch { /* Worker is still starting. */ }
    await delay(100);
  }
  await stop();
  throw new Error('Local Worker failed to start. ' + log);
}

function client(port, path = "live") {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/api/' + path);
  ws.binaryType = 'arraybuffer';
  const messages = [];
  const readers = [];
  ws.onmessage = ({ data }) => {
    const msg = typeof data === 'string' ? JSON.parse(data) : new Uint8Array(data);
    if (readers.length) readers.shift()(msg);
    else messages.push(msg);
  };
  return {
    read: () => messages.length ? Promise.resolve(messages.shift()) : new Promise(r => readers.push(r)),
    place: (x, y, color) => ws.send(JSON.stringify({ x, y, color })),
    close: () => ws.close(),
    closed: () => once(ws, 'close')
  };
}

test('one public board persists updates and shares seven placements per 27-second window', { timeout: 65_000 }, async t => {
  const storage = await mkdtemp(join(tmpdir(), 'canvas-test-'));
  const port = await freePort();
  let stop;
  const clients = [];
  const open = () => { const peer = client(port); clients.push(peer); return peer; };
  t.after(async () => {
    for (const peer of clients) peer.close();
    if (stop) await stop();
    await rm(storage, { recursive: true, force: true });
  });

  assert.equal(SIZE, 3000);
  stop = await startWorker(port, storage);
  const a = open(), b = open();
  for (const peer of [a, b]) {
    assert.deepEqual(await peer.read(), new Uint8Array([2]));
    assert.deepEqual(await peer.read(), { type: 'ready', remaining: 7, wait: 0 });
  }
  a.place(0, 0, 0);
  assert.deepEqual(await a.read(), { type: 'same' });
  const invalid = open();
  await invalid.read(); await invalid.read();
  const closed = invalid.closed();
  invalid.place(SIZE, 0, 1);
  assert.equal((await closed)[0].code, 1008);

  let previousWait = 27_000;
  for (let i = 0; i < 6; i++) {
    const author = i % 2 ? b : a;
    author.place(i, 2999, 6);
    for (const peer of [a, b]) {
      assert.deepEqual(await peer.read(), { type: 'pixel', x: i, y: 2999, color: 6 });
      const quota = await peer.read();
      assert.equal(quota.type, 'quota');
      assert.equal(quota.remaining, 6 - i);
      if (!i) assert.equal(quota.wait, 27_000);
      assert.ok(quota.wait > 0 && quota.wait <= previousWait);
      previousWait = quota.wait;
    }
    assert.deepEqual(await author.read(), { type: 'placed' });
    if (!i) await delay(100);
  }
  assert.ok(previousWait < 27_000);
  a.place(2999, 2999, 6);
  b.place(2999, 2999, 7);
  const update = await a.read();
  assert.equal(update.type, 'pixel');
  assert.deepEqual(await b.read(), update);
  for (const peer of [a, b]) {
    const quota = await peer.read();
    assert.equal(quota.remaining, 0);
    assert.ok(quota.wait <= previousWait);
  }
  const author = update.color === 6 ? a : b;
  assert.deepEqual(await author.read(), { type: 'placed' });
  const refused = await (author === a ? b : a).read();
  assert.equal(refused.type, 'limit');
  assert.equal(refused.remaining, 0);
  a.close(); b.close();

  await stop();
  stop = await startWorker(port, storage);
  const fresh = open();
  const snapshot = await fresh.read();
  assert.equal(snapshot.length, 1 + 2 + SIZE);
  assert.equal((snapshot[1] << 8) + snapshot[2], 2999);
  assert.equal(snapshot[3 + 2999], update.color);
  const ready = await fresh.read();
  assert.equal(ready.type, 'ready');
  assert.equal(ready.remaining, 0);
  assert.ok(ready.wait > 0 && ready.wait <= previousWait);
  fresh.place(0, 0, 3);
  const blocked = await fresh.read();
  assert.equal(blocked.type, 'limit');
  await delay(blocked.wait + 50);
  fresh.place(0, 0, 3);
  assert.deepEqual(await fresh.read(), { type: 'pixel', x: 0, y: 0, color: 3 });
  assert.deepEqual(await fresh.read(), { type: 'quota', remaining: 6, wait: 27_000 });
});

test('the sidebar receives a cropped snapshot and in-crop updates on a read-only socket', { timeout: 10000 }, async t => {
  const storage = await mkdtemp(join(tmpdir(), 'canvas-preview-test-'));
  const port = await freePort();
  const stop = await startWorker(port, storage);
  const peers = [];
  const open = path => {
    const peer = client(port, path);
    peers.push(peer);
    return peer;
  };
  t.after(async () => {
    for (const peer of peers) peer.close();
    await stop();
    await rm(storage, { recursive: true, force: true });
  });

  const editor = open('live'), viewer = open('preview');
  await editor.read(); await editor.read();
  const { x, y, width, height } = PREVIEW;
  const snapshot = await viewer.read();
  assert.equal(snapshot.length, width * height);
  const initialColor = initialRow(y)[x];
  assert.equal(snapshot[0], initialColor);

  editor.place(0, 0, 5);
  assert.equal((await editor.read()).type, 'pixel');
  const color = (initialColor + 1) % 32;
  editor.place(x, y, color);
  assert.deepEqual(await viewer.read(), { type: 'pixel', x, y, color });
  assert.equal((await open('preview').read())[0], color);

  const closed = viewer.closed();
  viewer.place(x, y, initialColor);
  assert.equal((await closed)[0].code, 1008);
  assert.equal((await open('preview').read())[0], color);
});

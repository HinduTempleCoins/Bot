// Tests for the WebSocket -> stratum bridge.
// Run: node --test pool/bridge/bridge.test.mjs
//
// We stand up a FAKE stratum TCP server that speaks newline-delimited JSON-RPC the way
// Miningcore's Monero stratum does (login -> job; submit -> {status:"OK"}; pushes a fresh
// job) and assert the bridge proxies login / job / submit / teardown faithfully, and
// enforces its caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { WebSocket } from 'ws';
import { createBridge, makeBucket } from './bridge.mjs';

// ---- a fake Miningcore-style Monero stratum server ----
function fakeStratum() {
  const seen = []; // every JSON-RPC the server received
  const conns = new Set();
  const server = net.createServer((sock) => {
    conns.add(sock);
    sock.on('close', () => conns.delete(sock));
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { sock.destroy(); return; }
        seen.push(msg);
        if (msg.method === 'login') {
          const job = { blob: '0c0c'.padEnd(152, '0'), job_id: 'j1', target: 'b88d0600', seed_hash: 'a'.repeat(64), height: 100, algo: 'rx/0' };
          sock.write(JSON.stringify({ id: msg.id, jsonrpc: '2.0', error: null, result: { id: 'sess1', job, status: 'OK' } }) + '\n');
          // push a second job unsolicited (job-passthrough test)
          setTimeout(() => { try { sock.write(JSON.stringify({ jsonrpc: '2.0', method: 'job', params: { ...job, job_id: 'j2' } }) + '\n'); } catch {} }, 30);
        } else if (msg.method === 'submit') {
          sock.write(JSON.stringify({ id: msg.id, jsonrpc: '2.0', error: null, result: { status: 'OK' } }) + '\n');
        }
      }
    });
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port, seen, conns })));
}

async function startBridge(stratumPort, extra = {}) {
  const b = createBridge({ wsHost: '127.0.0.1', wsPort: 0, stratumHost: '127.0.0.1', stratumPort, log: () => {}, ...extra });
  await b.ready;
  return b;
}
function wsUrl(bridge) { return `ws://127.0.0.1:${bridge.wss.address().port}`; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function collectMessages(ws) {
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  return msgs;
}

test('login / job / submit pass through faithfully', async () => {
  const strat = await fakeStratum();
  const bridge = await startBridge(strat.port);
  const ws = new WebSocket(wsUrl(bridge));
  const got = collectMessages(ws);
  await new Promise((r) => ws.on('open', r));

  ws.send(JSON.stringify({ id: 1, method: 'login', params: { login: 'addr', pass: 'x', algo: ['rx/0'] } }));
  await wait(120);

  // login result with a job arrives
  const loginRes = got.find((m) => m.id === 1);
  assert.ok(loginRes, 'got login result');
  assert.equal(loginRes.result.job.job_id, 'j1');
  assert.equal(loginRes.result.job.seed_hash.length, 64);
  // unsolicited job push (j2) passes through
  const jobPush = got.find((m) => m.method === 'job' && m.params.job_id === 'j2');
  assert.ok(jobPush, 'unsolicited job pushed through');

  // submit a share -> server says OK, bridge relays it
  ws.send(JSON.stringify({ id: 2, method: 'submit', params: { id: 'sess1', job_id: 'j1', nonce: '00000001', result: 'ff'.repeat(32) } }));
  await wait(80);
  const submitRes = got.find((m) => m.id === 2);
  assert.ok(submitRes, 'got submit result');
  assert.equal(submitRes.result.status, 'OK');

  // server actually received the login + submit verbatim
  assert.ok(strat.seen.find((m) => m.method === 'login'));
  const sub = strat.seen.find((m) => m.method === 'submit');
  assert.equal(sub.params.nonce, '00000001');

  ws.close(); await bridge.close(); strat.server.close();
});

test('closing the WS tears down the paired TCP socket', async () => {
  const strat = await fakeStratum();
  const bridge = await startBridge(strat.port);
  const ws = new WebSocket(wsUrl(bridge));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ id: 1, method: 'login', params: { login: 'a' } }));
  await wait(60);
  assert.equal(strat.conns.size, 1, 'one upstream conn open');
  ws.close();
  await wait(120);
  assert.equal(strat.conns.size, 0, 'upstream conn torn down on ws close');
  assert.equal(bridge.counts().total, 0, 'per-ip count released');
  await bridge.close(); strat.server.close();
});

test('non-JSON message tears the connection down (never feeds junk upstream)', async () => {
  const strat = await fakeStratum();
  const bridge = await startBridge(strat.port);
  const ws = new WebSocket(wsUrl(bridge));
  await new Promise((r) => ws.on('open', r));
  ws.send('this is not json');
  await wait(100);
  // upstream must NOT have received the junk
  assert.equal(strat.seen.length, 0, 'no junk reached upstream');
  assert.equal(strat.conns.size, 0, 'connection torn down');
  await bridge.close(); strat.server.close();
});

test('per-IP connection cap rejects beyond the limit', async () => {
  const strat = await fakeStratum();
  const bridge = await startBridge(strat.port, { maxConnPerIp: 2 });
  const url = wsUrl(bridge);
  const a = new WebSocket(url); await new Promise((r) => a.on('open', r));
  const b = new WebSocket(url); await new Promise((r) => b.on('open', r));
  const c = new WebSocket(url);
  const rejected = await new Promise((res) => { c.on('open', () => res(false)); c.on('error', () => res(true)); });
  assert.equal(rejected, true, 'third connection from same IP rejected');
  a.close(); b.close();
  await wait(60);
  await bridge.close(); strat.server.close();
});

test('message-rate cap drops a flooding connection', async () => {
  const strat = await fakeStratum();
  // tiny bucket so the test is fast/deterministic
  const bridge = await startBridge(strat.port, { msgRatePerSec: 1, msgBurst: 3 });
  const ws = new WebSocket(wsUrl(bridge));
  await new Promise((r) => ws.on('open', r));
  const closed = new Promise((r) => ws.on('close', () => r(true)));
  // valid JSON, but far over the burst
  for (let i = 0; i < 30; i++) ws.send(JSON.stringify({ id: i, method: 'noop' }));
  const wasClosed = await Promise.race([closed, wait(800).then(() => false)]);
  assert.equal(wasClosed, true, 'flooding connection was closed');
  await bridge.close(); strat.server.close();
});

// ---- token bucket unit test (deterministic clock) ----
test('makeBucket — burst then refill', () => {
  let t = 0; const now = () => t;
  const bucket = makeBucket({ ratePerSec: 10, burst: 3, now });
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), true);
  assert.equal(bucket.take(), false, 'burst exhausted');
  t = 1000; // 1s -> +10 tokens, capped at burst
  assert.equal(bucket.take(), true, 'refilled after time');
});

// uptime.test.mjs — /health reflects platform + chain freshness, the systemd watchdog pings only while
// healthy, and the unit templates carry the 24/7 contract. Offline.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { __setFetch } from './live.mjs';
import { handler, health, startWatchdog, __setNotify, markReady, markInbound } from './uptime.mjs';
import { baseState, fakeFetch } from './test-fakes.mjs';

let st;
beforeEach(() => {
  st = baseState();
  st.melek.mainnet.dgp.time = new Date(Date.now() - 4000).toISOString().slice(0, 19);
  __setFetch(fakeFetch(st));
  markReady(false);
});

function fakeRes() {
  const r = { code: 0, body: '', writeHead(c) { r.code = c; }, end(b) { r.body = String(b || ''); } };
  return r;
}

test('/health: 503 until the platform is ready, 200 when ready and the chain is fresh', async () => {
  let res = fakeRes();
  await handler({ method: 'GET', url: '/health' }, res);
  assert.equal(res.code, 503);
  markReady(true); markInbound();
  res = fakeRes();
  await handler({ method: 'GET', url: '/health' }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.chain.ok, true);
  assert.equal(j.lastInboundAgoS, 0);
  assert.equal(j.nodes.length >= 1, true);
  res = fakeRes();
  await handler({ method: 'GET', url: '/ready' }, res);
  assert.deepEqual([res.code, res.body], [200, 'ok']);
  res = fakeRes();
  await handler({ method: 'GET', url: '/nope' }, res);
  assert.equal(res.code, 404);
});

test('/health: a stalled chain (old head) or every node down → degraded, never a throw', async () => {
  markReady(true);
  st.melek.mainnet.dgp.time = '2026-01-01T00:00:00';
  assert.equal((await health()).chain.ok, false);
  st.down.add('melek.salon'); st.down.add('wallet.melek.salon');
  const h = await health();
  assert.equal(h.ok, false);
});

test('watchdog: no-op outside systemd; READY once; WATCHDOG only while healthy', async () => {
  assert.equal(startWatchdog({ env: {} }), null);
  const sent = [];
  __setNotify(async (args) => { sent.push(args[1]); return true; });
  let tick = null;
  let healthy = true;
  const stop = startWatchdog({ env: { WATCHDOG_USEC: '180000000' }, isHealthy: () => healthy, setIntervalFn: (fn, ms) => { tick = fn; assert.equal(ms, 90000); return 1; }, clearIntervalFn: () => {} });
  assert.deepEqual(sent, ['READY=1']);
  tick(); tick();
  healthy = false; tick();
  healthy = () => { throw new Error('x'); };
  assert.deepEqual(sent, ['READY=1', 'WATCHDOG=1', 'WATCHDOG=1']);
  stop();
});

test('unit templates: Restart=always + watchdog + notify access; telegram keeps idle-without-token', () => {
  const d = readFileSync(new URL('../deploy/helperbot/hathor-helper-discord.service', import.meta.url), 'utf8');
  const t = readFileSync(new URL('../deploy/helperbot/hathor-helper-telegram.service', import.meta.url), 'utf8');
  for (const u of [d, t]) {
    assert.match(u, /^Restart=always$/m);
    assert.match(u, /^WatchdogSec=\d+$/m);
    assert.match(u, /^NotifyAccess=all$/m);
    assert.match(u, /^StartLimitIntervalSec=0$/m);
  }
  assert.match(t, /^RestartPreventExitStatus=0$/m);
  const env = readFileSync(new URL('../deploy/helperbot/helperbot.env.example', import.meta.url), 'utf8');
  assert.match(env, /^HELPERBOT_TIP_LIVE=0$/m);
  assert.match(env, /^HELPERBOT_FAUCET_LIVE=0$/m);
  assert.match(env, /^HATHOR_FLEETQ=0$/m);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRpc, checkPools, assessBots, collect, formatReport, BOTS, rpc } from './kulaswap-health.mjs';

const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
const mk = (map) => async (_url, init) => {
  const { method, params } = JSON.parse(init.body);
  if (typeof map[method] === 'function') return ok(map[method](params));
  if (method in map) return ok(map[method]);
  return { ok: true, json: async () => ({ error: { message: `unmocked ${method}` } }) };
};
const HEALTHY = { eth_blockNumber: '0x30257', eth_chainId: '0xade19', eth_syncing: false };

test('rpc surfaces a transport failure instead of throwing', async () => {
  const r = await rpc('eth_blockNumber', [], { fetch: async () => { throw new Error('ECONNREFUSED'); } });
  assert.match(r.error, /ECONNREFUSED/);
});

test('checkRpc is happy with a synced node on the right chain', async () => {
  const r = await checkRpc({ fetch: mk(HEALTHY) });
  assert.equal(r.ok, true);
  assert.equal(r.block, 0x30257);
  assert.equal(r.syncing, false);
});

test('checkRpc catches the exact outage of 2026-10-20: the node is unreachable', async () => {
  const r = await checkRpc({ fetch: mk({ eth_blockNumber: () => { throw new Error('node unreachable'); } }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unreachable/);
});

test('checkRpc rejects the wrong chain', async () => {
  const r = await checkRpc({ fetch: mk({ ...HEALTHY, eth_chainId: '0x1' }) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /wrong chain/);
});

test('checkRpc calls a head that has not moved a stall — one reading cannot', async () => {
  const same = await checkRpc({ fetch: mk(HEALTHY), prevBlock: 0x30257 });
  assert.equal(same.ok, false);
  assert.match(same.reason, /not advanced/);
  const moved = await checkRpc({ fetch: mk(HEALTHY), prevBlock: 0x30256 });
  assert.equal(moved.ok, true);
});

test('checkPools counts only pairs that actually hold liquidity', async () => {
  const reserves = '0x' + (123456789n).toString(16).padStart(64, '0') + (987654321n).toString(16).padStart(64, '0') + '0'.repeat(64);
  const dust = '0x' + (1n).toString(16).padStart(64, '0') + (2n).toString(16).padStart(64, '0') + '0'.repeat(64);
  let call = 0;
  const r = await checkPools({ fetch: mk({ eth_call: (p) => {
    const d = p[0].data;
    if (d === '0x574f2ba3') return '0x' + (2).toString(16).padStart(64, '0');
    if (d.startsWith('0x1e3dd18b')) return '0x' + '0'.repeat(24) + 'aa'.repeat(20);
    call += 1;
    return call === 1 ? reserves : dust;
  } }) });
  assert.equal(r.pairs, 2);
  assert.equal(r.withLiquidity, 1);
  assert.equal(r.ok, true);
});

test('a bot that ran and declined to trade is HEALTHY — the guard working is not a fault', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const units = BOTS.map((b) => ({ unit: b.unit, activeState: 'inactive', subState: 'dead', lastRunMs: now - 60000, declined: true }));
  const got = assessBots(units, { now });
  assert.ok(got.every((b) => b.ok), JSON.stringify(got));
});

test('a failed unit is reported with the reason, not just "failed"', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const units = [{ unit: 'kulabot-b', activeState: 'failed', subState: 'failed', lastRunMs: now - 60000, lastLine: '[kulaswap] node unreachable' }];
  const got = assessBots(units, { now, bots: [BOTS[1]] });
  assert.equal(got[0].ok, false);
  assert.match(got[0].reason, /node unreachable/);
});

test('a bot that silently stopped running is caught by its own schedule', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  // 21 hours stale — exactly the 2026-10-20 outage — against bot d's 30-minute schedule
  const units = [{ unit: 'kulabot-d', activeState: 'inactive', subState: 'dead', lastRunMs: now - 21 * 3600 * 1000 }];
  const got = assessBots(units, { now, bots: [BOTS[3]] });
  assert.equal(got[0].ok, false);
  assert.match(got[0].reason, /last ran 1260 min ago/);
});

test('a missing unit is a problem, not a silent pass', () => {
  const got = assessBots([], { now: Date.now(), bots: [BOTS[0]] });
  assert.equal(got[0].ok, false);
  assert.match(got[0].reason, /not found/);
});

test('collect reports healthy end to end and never throws', async () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const reserves = '0x' + (10n ** 20n).toString(16).padStart(64, '0') + (10n ** 20n).toString(16).padStart(64, '0') + '0'.repeat(64);
  const s = await collect({
    now,
    fetch: mk({ ...HEALTHY, eth_call: (p) => {
      const d = p[0].data;
      if (d === '0x574f2ba3') return '0x' + (1).toString(16).padStart(64, '0');
      if (d.startsWith('0x1e3dd18b')) return '0x' + '0'.repeat(24) + 'bb'.repeat(20);
      return reserves;
    } }),
    readUnits: async () => BOTS.map((b) => ({ unit: b.unit, activeState: 'inactive', subState: 'dead', lastRunMs: now - 60000 })),
  });
  assert.equal(s.ok, true, JSON.stringify(s.problems));
  assert.equal(s.problems.length, 0);
  assert.match(formatReport(s), /healthy/);
});

test('collect does not double-report pools when the RPC itself is down', async () => {
  const s = await collect({
    fetch: mk({ eth_blockNumber: () => { throw new Error('node unreachable'); } }),
    readUnits: async () => BOTS.map((b) => ({ unit: b.unit, activeState: 'inactive', subState: 'dead', lastRunMs: Date.now() })),
  });
  assert.equal(s.ok, false);
  assert.equal(s.pools, null);
  assert.equal(s.problems.length, 1);
  assert.match(s.problems[0], /unreachable/);
});

test('collect survives a readUnits that throws', async () => {
  const s = await collect({ fetch: mk(HEALTHY), readUnits: async () => { throw new Error('systemctl missing'); } });
  assert.ok(Array.isArray(s.bots));
  assert.ok(s.problems.length > 0);
});

// ecosystem-map.test.mjs — offline, injected sources. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTATE, ecosystemMap, headline, renderMap, activityFor, escapeHtml, __setSources,
} from './ecosystem-map.mjs';

// fake readers
const fakeRegistry = async () => ({
  total: 200, hidden: 170,
  byStatus: { LIVE: 30, BUILT: 150, SCAFFOLD: 20 },
  byCategory: { Games: { total: 7, live: 2, hidden: 5 }, Trading: { total: 9, live: 1, hidden: 8 } },
});
const fakeActivity = async (account) => [
  { time: '2026-06-03T00:00:00', type: 'transfer', summary: `${account} → someone 1.000 HIVE` },
];

test('ESTATE structure is sane — every token has chain+status', () => {
  assert.ok(Array.isArray(ESTATE.tokens) && ESTATE.tokens.length >= 5);
  for (const t of ESTATE.tokens) {
    assert.ok(t.symbol, 'token has symbol');
    assert.ok(t.chain, `token ${t.symbol} has chain`);
    assert.ok(t.status, `token ${t.symbol} has status`);
  }
});

test('ESTATE — every bot has role+status', () => {
  assert.ok(Array.isArray(ESTATE.bots) && ESTATE.bots.length >= 5);
  for (const b of ESTATE.bots) {
    assert.ok(b.name, 'bot has name');
    assert.ok(b.role, `bot ${b.name} has role`);
    assert.ok(['live', 'built', 'planned'].includes(b.status), `bot ${b.name} status valid`);
    assert.ok(Array.isArray(b.surfaces), `bot ${b.name} has surfaces array`);
  }
});

test('ESTATE — chains have software+tokens, sites present', () => {
  assert.ok(ESTATE.chains.some((c) => c.key === 'melek'));
  assert.ok(ESTATE.chains.some((c) => c.key === 'hive'));
  for (const c of ESTATE.chains) {
    assert.ok(c.status, `chain ${c.label} has status`);
    assert.ok(Array.isArray(c.software), `chain ${c.label} has software`);
  }
  assert.ok(ESTATE.sites.some((s) => /soapbox\.community/.test(s.url || '')));
});

test('ESTATE carries NO key material', () => {
  const blob = JSON.stringify(ESTATE).toLowerCase();
  for (const bad of ['wif', 'private', 'posting key', '5j', '5k', 'active key', 'owner key', 'secret']) {
    assert.ok(!blob.includes(bad), `ESTATE must not mention "${bad}"`);
  }
  // no base58 WIF-looking 51-char strings
  assert.ok(!/[5kl][1-9a-hj-np-z]{50}/i.test(JSON.stringify(ESTATE)), 'no WIF-shaped string');
});

test('ecosystemMap assembles with injected registry + activity', async () => {
  __setSources({ registryReader: fakeRegistry, activityReader: fakeActivity });
  const map = await ecosystemMap();
  __setSources();
  assert.equal(map.repo.total, 200);
  assert.equal(map.repo.live, 30);
  assert.equal(map.repo.hidden, 170);
  assert.ok(map.estate.chains.length >= 4);
  // onchain has an entry per configured account, with ops from the fake reader
  assert.ok(map.onchain.length >= 1);
  const hathor = map.onchain.find((o) => o.account === 'hathor');
  assert.ok(hathor && hathor.ops.length === 1);
  assert.ok(typeof map.asOf === 'string');
});

test('ecosystemMap — sections soft-fail INDEPENDENTLY', async () => {
  // registry throws, activity throws — map must still assemble (repo null, ops [])
  __setSources({
    registryReader: async () => { throw new Error('boom'); },
    activityReader: async () => { throw new Error('boom'); },
  });
  const map = await ecosystemMap();
  __setSources();
  assert.equal(map.repo, null, 'repo soft-fails to null');
  assert.ok(Array.isArray(map.onchain));
  for (const o of map.onchain) assert.deepEqual(o.ops, [], 'activity soft-fails to []');
  // estate still fully present
  assert.ok(map.estate.tokens.length >= 5);
});

test('headline is plain-English', async () => {
  __setSources({ registryReader: fakeRegistry, activityReader: fakeActivity });
  const map = await ecosystemMap();
  __setSources();
  const h = headline(map);
  assert.match(h, /200 modules/);
  assert.match(h, /30 live/);
  assert.match(h, /tokens live on HIVE/);
  assert.match(h, /bots/);
  assert.match(h, /MELEK chain/);
  // no jargon / no html
  assert.ok(!/[<>]/.test(h));
});

test('headline handles empty map without throwing', () => {
  assert.doesNotThrow(() => headline(undefined));
  assert.doesNotThrow(() => headline({}));
});

test('renderMap escapes a malicious bot name + renders all 5 sections', async () => {
  const evil = {
    ...ESTATE,
    bots: [{ name: '<img src=x onerror=alert(1)>', role: '"><script>', status: 'live', surfaces: ['x'] }],
  };
  __setSources({ registryReader: fakeRegistry, activityReader: fakeActivity });
  const map = await ecosystemMap({ estate: evil });
  __setSources();
  const html = renderMap(map);
  // XSS escaped
  assert.ok(!html.includes('<img src=x onerror'), 'raw img must not appear');
  assert.ok(!html.includes('<script>'), 'raw script must not appear');
  assert.ok(html.includes('&lt;img src=x onerror'), 'escaped form present');
  // all 5 sections
  assert.match(html, /Our Chains/);
  assert.match(html, /Our Bots/);
  assert.match(html, /Our Tokens/);
  assert.match(html, /Our Sites/);
  assert.match(html, /The Repo/);
  // read-only assurance + features link
  assert.match(html, /read-only/);
  assert.match(html, /\/features/);
});

test('renderMap works with null repo (repo section degrades calmly)', () => {
  const map = { estate: ESTATE, repo: null, onchain: [], asOf: 'now' };
  const html = renderMap(map);
  assert.match(html, /The Repo/);
  assert.match(html, /unavailable/);
});

test('activityFor soft-fails offline (no reader → [])', async () => {
  __setSources({}); // no activityReader injected; chain-explorer needs network
  const ops = await activityFor('hathor', 'melek', { activityReader: null });
  assert.deepEqual(ops, []);
});

test('activityFor soft-fails on a throwing reader', async () => {
  const ops = await activityFor('hathor', 'melek', { activityReader: async () => { throw new Error('net'); } });
  assert.deepEqual(ops, []);
});

test('activityFor returns rows from an injected reader', async () => {
  const ops = await activityFor('kalivankush', 'hive', { activityReader: fakeActivity });
  assert.equal(ops.length, 1);
  assert.match(ops[0].summary, /kalivankush/);
});

test('activityFor with empty account returns []', async () => {
  assert.deepEqual(await activityFor('', 'hive', { activityReader: fakeActivity }), []);
});

test('escapeHtml covers all five entities', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});

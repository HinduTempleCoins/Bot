// Tests for the APIS-Hash panel + guidepost on the mining pool.
//
// Covers: the index.html section structure + honesty (read-only, PERMANENT warning, links),
// the pure engine-read helpers (offline, injectable fetch, soft-fail-never-throw), the base
// fallback (mainnet -> testnet), and the render states (numbers / guidepost / down / empty).
//
// Run: node --test pool/www/apishash-panel.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  esc, engineBases, cleanAccount, balanceOf, computeShare, formatAmount, formatSharePct,
  fetchApisHash, seesawHtml, guidepostHtml, statsHtml, panelBodyHtml,
  FARM_LOCK_URL, DEV_DOCS_URL, MAINNET_ENGINE, TESTNET_ENGINE, HASH_SYMBOL, APIS_SYMBOL,
} from './apishash-panel.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const css = readFileSync(join(here, 'style.css'), 'utf8');

// A fake fetch driven by a URL->payload map. Any URL not in the map (or set to null) 404s.
function fakeFetch(map) {
  return async (url) => {
    const body = map[url];
    if (body == null) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => body };
  };
}
// A fetch that always throws (engine unreachable) — proves soft-fail.
const throwingFetch = async () => { throw new Error('network down'); };

test('index.html: APIS-Hash section is wired, read-only, and framed as the see-saw', () => {
  assert.ok(html.includes('id="apishash"'), 'has the panel section');
  assert.ok(html.includes('id="ah-account"'), 'has the MELEK account input');
  assert.ok(html.includes('id="ah-load"'), 'has the look-up button');
  assert.ok(html.includes('id="ah-body"'), 'has the body container the module paints');
  assert.match(html, /two lanes/i);              // see-saw framing
  assert.match(html, /APIS-Hash/);
  assert.match(html, /read-only lookup|read-only/i);
  assert.match(html, /no keys, no signing/i);    // custody honesty
  assert.ok(html.includes('apishash-panel.mjs'), 'loads the module');
  assert.match(html, /window\.__ENGINE_API/);    // env-configurable base
  assert.match(html, /class="alpha">Alpha/);     // Alpha badge convention
});

test('style.css: the Alpha badge class exists', () => {
  assert.match(css, /\.alpha\{/);
});

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc('<b>"x"&</b>'), '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
  assert.equal(esc(null), '');
});

test('cleanAccount: strips @, trims, lowercases', () => {
  assert.equal(cleanAccount('  @Alice '), 'alice');
  assert.equal(cleanAccount(''), '');
  assert.equal(cleanAccount(undefined), '');
});

test('engineBases: mainnet first, testnet fallback; window override takes slot 0', () => {
  const def = engineBases({});
  assert.equal(def[0], MAINNET_ENGINE);
  assert.ok(def.includes(TESTNET_ENGINE));
  const over = engineBases({ __ENGINE_API: 'https://engine.example.test/' });
  assert.equal(over[0], 'https://engine.example.test'); // trailing slash trimmed
  assert.ok(over.includes(TESTNET_ENGINE), 'still keeps a testnet fallback');
});

test('balanceOf: reads array rows, bare objects, numbers; soft to 0', () => {
  assert.equal(balanceOf([{ balance: '12.5' }]), 12.5);
  assert.equal(balanceOf({ balance: 3 }), 3);
  assert.equal(balanceOf(7), 7);
  assert.equal(balanceOf(null), 0);
  assert.equal(balanceOf([]), 0);
});

test('computeShare: fraction, capped at 1, null when unknown', () => {
  assert.equal(computeShare(25, 100), 0.25);
  assert.equal(computeShare(0, 100), null);
  assert.equal(computeShare(10, 0), null);
  assert.equal(computeShare(200, 100), 1);
});

test('formatSharePct: tiny shares get a <0.001% floor, null -> dash', () => {
  assert.equal(formatSharePct(null), '—');
  assert.equal(formatSharePct(0.0000001), '<0.001%');
  assert.equal(formatSharePct(0.25), '25%');
});

test('fetchApisHash: no account -> soft {ok:false}, never throws', async () => {
  const r = await fetchApisHash('', { fetch: throwingFetch });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-account');
});

test('fetchApisHash: engine unreachable -> soft {ok:false}, never throws', async () => {
  const r = await fetchApisHash('alice', { fetch: throwingFetch, bases: [MAINNET_ENGINE] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'engine-unreachable');
});

test('fetchApisHash: reads balances + workerbee and computes share', async () => {
  const base = MAINNET_ENGINE;
  const map = {
    [`${base}/contracts/balances?account=alice&symbol=${HASH_SYMBOL}`]: [{ balance: '50' }],
    [`${base}/contracts/balances?account=alice&symbol=${APIS_SYMBOL}`]: [{ balance: '4.2' }],
    [`${base}/contracts/workerbee`]: { totalApisHash: '200', emissionPerDay: '1000' },
  };
  const r = await fetchApisHash('@Alice', { fetch: fakeFetch(map), bases: [base] });
  assert.equal(r.ok, true);
  assert.equal(r.account, 'alice');
  assert.equal(r.base, base);
  assert.equal(r.apisHash, 50);
  assert.equal(r.apis, 4.2);
  assert.equal(r.totalApisHash, 200);
  assert.equal(r.emissionPerDay, 1000);
  assert.equal(r.share, 0.25);
});

test('fetchApisHash: falls back to the testnet base when mainnet is dark', async () => {
  const map = {
    [`${TESTNET_ENGINE}/contracts/balances?account=bob&symbol=${HASH_SYMBOL}`]: [{ balance: '0' }],
    [`${TESTNET_ENGINE}/contracts/workerbee`]: { totalApisHash: '10' },
  };
  // mainnet URLs are absent -> 404 -> base skipped; testnet answers.
  const r = await fetchApisHash('bob', { fetch: fakeFetch(map), bases: [MAINNET_ENGINE, TESTNET_ENGINE] });
  assert.equal(r.ok, true);
  assert.equal(r.base, TESTNET_ENGINE);
  assert.equal(r.apisHash, 0);
});

test('guidepostHtml: PERMANENT / non-redeemable warning + both links', () => {
  const g = guidepostHtml();
  assert.match(g, /PERMANENT/);
  assert.match(g, /non-redeemable/i);
  assert.match(g, /no unstake/i);
  assert.match(g, /soulbound/i);
  assert.ok(g.includes(FARM_LOCK_URL), 'links to the Yield Farm forever-lock step');
  assert.ok(g.includes(DEV_DOCS_URL), 'links to the dev docs');
  assert.match(g, /read-only/i);
});

test('seesawHtml: two-lane framing', () => {
  assert.match(seesawHtml(), /two lanes/i);
  assert.match(seesawHtml(), /raw hashing/i);
  assert.match(seesawHtml(), /APIS-Hash/);
});

test('panelBodyHtml: empty state shows guidepost, no fake numbers', () => {
  const body = panelBodyHtml(null);
  assert.match(body, /Enter your MELEK account/i);
  assert.ok(body.includes('—'), 'numbers are em-dashes, not fabricated');
  assert.match(body, /PERMANENT/);
});

test('panelBodyHtml: engine-down is honest (no numbers) + still guides', () => {
  const body = panelBodyHtml({ ok: false, reason: 'engine-unreachable', account: 'x' });
  assert.match(body, /answer just now/i);
  assert.ok(body.includes('—'));
  assert.match(body, /PERMANENT/);
});

test('panelBodyHtml: holder sees numbers and NO guidepost', () => {
  const body = panelBodyHtml({ ok: true, account: 'alice', apisHash: 50, apis: 4.2, share: 0.25, emissionPerDay: 1000 });
  assert.match(body, /50/);
  assert.match(body, /25%/);
  assert.ok(!body.includes('PERMANENT'), 'no guidepost when already a holder');
});

test('panelBodyHtml: zero-balance holder sees numbers AND the guidepost', () => {
  const body = panelBodyHtml({ ok: true, account: 'bob', apisHash: 0, apis: 0, share: null, emissionPerDay: 1000 });
  assert.match(body, /no APIS-Hash yet/i);
  assert.match(body, /PERMANENT/);
});

test('statsHtml: null data renders all em-dashes (honest empty)', () => {
  const s = statsHtml(null);
  assert.match(s, /Your APIS-Hash/);
  assert.match(s, /Your APIS earned/);
  assert.match(s, /Your share of hash/);
  const dashes = (s.match(/—/g) || []).length;
  assert.ok(dashes >= 4, 'four unknown figures shown as dashes');
});

test('module imports headless without a DOM (boot is guarded)', async () => {
  const mod = await import('./apishash-panel.mjs');
  assert.equal(typeof mod.mountApisHashPanel, 'function');
  assert.equal(mod.mountApisHashPanel(), null); // no document -> no-op
});

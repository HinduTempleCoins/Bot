// market-factcheck.test.mjs — offline. Run: node --test integrations/soapbox/market-factcheck.test.mjs
// Exercises the PHASE-2 additions: linkAlive(), checkCoinLinks() + the FLAGS-ONLY store. All network
// is stubbed (this module's __setFetch and condenser's, for the delisting lookup); the flags store
// uses an in-memory fs via __setFs, so nothing real is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkAlive, checkCoinLinks, listFlags,
  __setFetch, __setClock, __setFs,
} from './market-factcheck.mjs';
import { __setFetch as condenserSetFetch } from './condenser.mjs';
import { invalidate } from './cache.mjs';

// in-memory fs stub covering load/save's surface.
function memFs(initial = {}) {
  const files = { ...initial };
  return {
    _files: files,
    readFileSync(p) { if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileSync(p, data) { files[p] = data; },
    mkdirSync() {},
  };
}

// a Response-like object.
function resp({ status = 200, url = '', redirected = false } = {}) {
  return { status, ok: status >= 200 && status < 400, url, redirected, json: async () => ({}) };
}

test('linkAlive reports a live homepage as alive, not redirected', async () => {
  invalidate('linkalive:https://live.example/');
  __setFetch(async (u) => resp({ status: 200, url: String(u) }));
  const r = await linkAlive('https://live.example/');
  assert.equal(r.alive, true);
  assert.equal(r.status, 200);
  assert.equal(r.redirected, false);
  __setFetch(null);
});

test('linkAlive flags an off-host redirect (parked / moved tell)', async () => {
  invalidate('linkalive:https://oldproj.io/');
  __setFetch(async () => resp({ status: 200, url: 'https://buy-this-domain.com/', redirected: true }));
  const r = await linkAlive('https://oldproj.io/');
  assert.equal(r.alive, true);
  assert.equal(r.redirected, true);
  assert.equal(r.finalUrl, 'https://buy-this-domain.com/');
  __setFetch(null);
});

test('linkAlive does NOT call a www/trailing-slash change a redirect', async () => {
  invalidate('linkalive:https://x.io');
  __setFetch(async () => resp({ status: 200, url: 'https://www.x.io/', redirected: false }));
  const r = await linkAlive('https://x.io');
  assert.equal(r.redirected, false, 'same host, just www/slash');
  __setFetch(null);
});

test('linkAlive marks a dead link not-alive and soft-fails a thrown fetch', async () => {
  invalidate('linkalive:https://dead.example/');
  __setFetch(async () => resp({ status: 404, url: 'https://dead.example/' }));
  const dead = await linkAlive('https://dead.example/');
  assert.equal(dead.alive, false);
  assert.equal(dead.status, 404);

  invalidate('linkalive:https://boom.example/');
  __setFetch(async () => { throw new Error('ECONNRESET'); });
  const boom = await linkAlive('https://boom.example/');
  assert.equal(boom.alive, false);
  assert.match(boom.error, /ECONNRESET|Error/);
  __setFetch(null);
});

test('linkAlive is soft on non-http input', async () => {
  const r = await linkAlive('not a url');
  assert.equal(r.alive, false);
  assert.equal(r.error, 'not-an-http-url');
});

test('checkCoinLinks flags a dead official link, FLAGS-ONLY shape', async () => {
  __setClock(() => '2026-06-03T00:00:00.000Z');
  invalidate('linkalive:https://gone.example/');
  invalidate('linkalive:https://reddit.com/r/x');
  __setFetch(async (u) => String(u).includes('gone') ? resp({ status: 0, url: String(u) }) : resp({ status: 200, url: String(u) }));
  // no coin.id → skip the delisting network path entirely.
  const coin = { symbol: 'X', links: { website: 'https://gone.example/', social: ['https://reddit.com/r/x'] }, official: {} };
  const out = await checkCoinLinks(coin);
  const dead = out.flags.find((f) => f.flag === 'official-link-dead');
  assert.ok(dead, 'dead link flagged');
  assert.equal(dead.coin, 'X');
  assert.equal(dead.advisory, true);
  assert.equal(dead.checkedAt, '2026-06-03T00:00:00.000Z');
  assert.match(dead.evidence, /gone\.example/);
  assert.equal(out.ok, false);
  __setFetch(null); __setClock(null);
});

test('checkCoinLinks flags a redirected official link', async () => {
  __setClock(() => '2026-06-03T00:00:00.000Z');
  invalidate('linkalive:https://moved.example/');
  __setFetch(async () => resp({ status: 200, url: 'https://casino-spam.net/', redirected: true }));
  const out = await checkCoinLinks({ symbol: 'M', links: { website: 'https://moved.example/' }, official: {} });
  assert.ok(out.flags.some((f) => f.flag === 'official-link-redirected'));
  __setFetch(null); __setClock(null);
});

test('checkCoinLinks flags a coin with no official links', async () => {
  const out = await checkCoinLinks({ symbol: 'EMPTY', links: {}, official: {} });
  assert.ok(out.flags.some((f) => f.flag === 'no-official-links'));
  assert.equal(out.links.length, 0);
});

test('checkCoinLinks reports delisted-no-venues from the market adapter', async () => {
  __setClock(() => '2026-06-03T00:00:00.000Z');
  invalidate('wheretotrade:ghostcoin:24');
  invalidate('tickers:ghostcoin');
  invalidate('linkalive:https://ghost.example/');
  // this module's fetch handles the link liveness; condenser's fetch handles the tickers lookup.
  __setFetch(async () => resp({ status: 200, url: 'https://ghost.example/' }));
  condenserSetFetch(async () => ({ ok: true, status: 200, json: async () => ({ tickers: [] }) }));
  const out = await checkCoinLinks({ id: 'ghostcoin', symbol: 'GHOST', links: { website: 'https://ghost.example/' }, official: {} });
  assert.ok(out.flags.some((f) => f.flag === 'delisted-no-venues'), 'no venues → delisting flag');
  __setFetch(null); condenserSetFetch(null); __setClock(null);
});

test('checkCoinLinks persist:true writes advisory flags and de-dupes; listFlags reads them back', async () => {
  const fs = memFs();
  __setFs(fs);
  __setClock(() => '2026-06-03T00:00:00.000Z');
  invalidate('linkalive:https://dead2.example/');
  __setFetch(async () => resp({ status: 404, url: 'https://dead2.example/' }));
  const coin = { id: 'deadcoin', symbol: 'D', links: { website: 'https://dead2.example/' }, official: {} };

  // first run persists; delisting path: stub condenser to return no tickers (adds delisted flag too).
  invalidate('wheretotrade:deadcoin:24'); invalidate('tickers:deadcoin');
  condenserSetFetch(async () => ({ ok: true, status: 200, json: async () => ({ tickers: [] }) }));
  await checkCoinLinks(coin, { persist: true });
  const after1 = listFlags({ coin: 'deadcoin' });
  assert.ok(after1.length >= 1);
  assert.ok(after1.every((f) => f.advisory === true), 'flags-only contract: advisory:true');

  // second identical run must not duplicate rows.
  invalidate('linkalive:https://dead2.example/');
  invalidate('wheretotrade:deadcoin:24'); invalidate('tickers:deadcoin');
  __setFetch(async () => resp({ status: 404, url: 'https://dead2.example/' }));
  condenserSetFetch(async () => ({ ok: true, status: 200, json: async () => ({ tickers: [] }) }));
  await checkCoinLinks(coin, { persist: true });
  const after2 = listFlags({ coin: 'deadcoin' });
  assert.equal(after2.length, after1.length, 'no duplicate flags on re-run');

  __setFetch(null); condenserSetFetch(null); __setClock(null); __setFs(null);
});

test('checkCoinLinks never throws on a fully garbage coin', async () => {
  const out = await checkCoinLinks(null);
  assert.ok(Array.isArray(out.flags));
  assert.equal(out.ok, false);
});

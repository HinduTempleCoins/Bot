// server.test.mjs — offline tests for the Gambling Education Center. node --test, no network.
// Asserts the LOAD-BEARING discipline: help band + a valid help link on every page, the
// education-only "never take a wager" disclaimer on every page, the house-wins truth up front, the
// ABSENCE of promotion/"beat the casino" language, escaping/safeHref, unknown→404, and never-throws.
// Also proves the server does ZERO request-time network by making global fetch throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handler, esc, safeHref, houseEdgeTable, LOTTERIES, HELP_ORGS, SITEMAP_PATHS,
} from './server.mjs';

function mockRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

const HTML_PAGES = ['/', '/calculators', '/spreadsheets', '/lottery', '/help'];

// ── the four HTML pages render 200 with the Alpha badge ─────────────────────────────────────────────
for (const p of HTML_PAGES) {
  test(`GET ${p} renders 200 HTML with Alpha badge`, async () => {
    const res = await get(p);
    assert.equal(res.statusCode, 200, `${p} should be 200`);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /class=alpha>Alpha/, `${p} missing Alpha badge`);
  });
}

// ── LOAD-BEARING: help band + a valid help link on EVERY page (incl. 404) ───────────────────────────
for (const p of [...HTML_PAGES, '/does-not-exist']) {
  test(`help band + valid help link present on ${p}`, async () => {
    const res = await get(p);
    assert.match(res.body, /Gambling a problem\?/, `${p} missing the persistent help band`);
    // a real, resolvable helpline number appears
    assert.match(res.body, /1-800-522-4700|1-800-GAMBLER/, `${p} missing the helpline number`);
    // a valid http(s) help link (the NCPG chat/help URL) is present and safeHref-clean
    assert.ok(res.body.includes('ncpgambling.org'), `${p} missing a valid NCPG help link`);
  });
}

// ── LOAD-BEARING: education-only "never take a wager" disclaimer on EVERY page ───────────────────────
for (const p of [...HTML_PAGES, '/does-not-exist']) {
  test(`education-only / never-take-a-wager disclaimer present on ${p}`, async () => {
    const res = await get(p);
    assert.match(res.body, /never take a wager, hold a stake, or run a book/,
      `${p} missing the education-only disclaimer`);
    assert.match(res.body, /Education only/, `${p} missing the "Education only" label`);
  });
}

// ── LOAD-BEARING: the house-wins truth is stated up front on the home page ───────────────────────────
test('home page leads with the house-wins truth and −EV reality', async () => {
  const res = await get('/');
  assert.match(res.body, /Over time, the house wins/, 'home must state the house wins up front');
  assert.match(res.body, /−EV|negative expected value/, 'home must name negative EV');
});

// ── DISCIPLINE: NO promotion / "beat the casino" / guaranteed-win language anywhere ─────────────────
const BANNED = [
  /beat the casino/i,
  /beat the house/i,
  /guaranteed win/i,
  /guaranteed profit/i,      // (the arbitrage helper lives in gambling.mjs, not surfaced here)
  /winning system/i,
  /system that works/i,
  /how to win/i,
  /can't lose/i,
  /cannot lose/i,
  /sure thing/i,
  /get rich/i,
];
for (const p of HTML_PAGES) {
  test(`no promotion / how-to-win language on ${p}`, async () => {
    const res = await get(p);
    for (const rx of BANNED) {
      assert.doesNotMatch(res.body, rx, `${p} contains banned promotion phrase ${rx}`);
    }
  });
}

// ── DISCIPLINE: no real-money bet-taking / deposit / cash-out affordance ─────────────────────────────
for (const p of HTML_PAGES) {
  test(`no deposit / cash-out / place-bet affordance on ${p}`, async () => {
    const res = await get(p);
    // no wagering CTA framed as an action THIS site offers (disclaimers like "no cash-out" are fine)
    assert.doesNotMatch(res.body, /deposit now|make a deposit|place your bet|place a bet|bet now|wager now|cash out now|withdraw funds/i,
      `${p} appears to offer a wagering/deposit action`);
  });
}

// ── house-edge teaching uses gambling.mjs values (roulette 5.26% / 2.70%) ────────────────────────────
test('home renders gambling.mjs house-edge values (roulette 5.26% & 2.70%)', async () => {
  const res = await get('/');
  assert.ok(res.body.includes('5.26'), 'double-zero roulette edge from gambling.mjs should appear');
  assert.ok(res.body.includes('2.70'), 'single-zero roulette edge from gambling.mjs should appear');
});

test('houseEdgeTable includes modeled + supplemental games, sorted best-first', async () => {
  const t = houseEdgeTable();
  assert.ok(t.length >= 10, 'combined table should have many rows');
  // sorted ascending by edge
  for (let i = 1; i < t.length; i++) assert.ok(t[i].edgePct >= t[i - 1].edgePct, 'edges must be ascending');
  assert.ok(t.some((r) => /roulette/i.test(r.label)), 'roulette row present (from gambling.mjs)');
  assert.ok(t.some((r) => /keno/i.test(r.label)), 'keno row present (supplemental)');
});

// ── lottery: real cited odds present ────────────────────────────────────────────────────────────────
test('lottery page shows real Powerball & Mega Millions jackpot odds', async () => {
  const res = await get('/lottery');
  assert.ok(res.body.includes('292,201,338'), 'Powerball jackpot odds should render');
  assert.ok(res.body.includes('290,472,336'), 'Mega Millions jackpot odds should render');
  assert.match(res.body, /provably-fair|non-cashable/, 'lottery page should offer the play-token alternative');
});

test('LOTTERIES constant carries Powerball & Mega Millions with plausible odds', () => {
  const pb = LOTTERIES.find((l) => /powerball/i.test(l.name));
  const mm = LOTTERIES.find((l) => /mega millions/i.test(l.name));
  assert.equal(pb.jackpotOdds, 292201338);
  assert.equal(mm.jackpotOdds, 290472336);
});

// ── help page lists the real orgs ────────────────────────────────────────────────────────────────────
test('help page lists NCPG, Gamblers Anonymous, Gam-Anon, GamCare, GAMSTOP', async () => {
  const res = await get('/help');
  for (const needle of ['National Problem Gambling Helpline', 'Gamblers Anonymous', 'Gam-Anon', 'GamCare', 'GAMSTOP', '988']) {
    assert.ok(res.body.includes(needle), `help page missing ${needle}`);
  }
});

test('HELP_ORGS all carry a safeHref-clean http(s) url', () => {
  assert.ok(HELP_ORGS.length >= 5);
  for (const o of HELP_ORGS) {
    assert.equal(safeHref(o.url), o.url, `${o.name} url must survive safeHref unchanged`);
  }
});

// ── calculators: client-side, present, and offers the six calculators ───────────────────────────────
test('calculators page includes the six calculators', async () => {
  const res = await get('/calculators');
  for (const id of ['c-ev', 'c-house', 'c-conv', 'c-parlay', 'c-kelly', 'c-lotto']) {
    assert.ok(res.body.includes(id), `calculators page missing ${id}`);
  }
  assert.match(res.body, /<script>/, 'calculators must run client-side JS');
});

// ── spreadsheets: three CSV download buttons, generated client-side ─────────────────────────────────
test('spreadsheets page offers three CSV downloads (client-side)', async () => {
  const res = await get('/spreadsheets');
  for (const k of ['edges', 'odds', 'worksheet']) {
    assert.ok(res.body.includes(`data-csv="${k}"`), `missing CSV button ${k}`);
  }
  assert.match(res.body, /text\/csv/, 'CSV blob type should be present in the client script');
});

// ── escaping + safeHref unit tests ──────────────────────────────────────────────────────────────────
test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
  assert.equal(esc(null), '');
});
test('safeHref passes http(s), rejects javascript:/data:/junk', () => {
  assert.equal(safeHref('https://www.ncpgambling.org/'), 'https://www.ncpgambling.org/');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('not a url'), '');
  assert.equal(safeHref(null), '');
});

// ── infra routes ─────────────────────────────────────────────────────────────────────────────────────
test('GET /health returns ok JSON', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});
test('robots / sitemap / sitemap-index / llms render', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /Sitemap:/);
  const sm = await get('/sitemap.xml');
  assert.match(sm.headers['content-type'], /xml/);
  for (const p of SITEMAP_PATHS) assert.ok(sm.body.includes(p === '/' ? '<loc>' : p), `sitemap should list ${p}`);
  const smi = await get('/sitemap-index.xml');
  assert.match(smi.headers['content-type'], /xml/);
  const llms = await get('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.match(llms.body, /Education only|never takes a wager/i);
});

// ── unknown → 404, never a 500 ───────────────────────────────────────────────────────────────────────
test('unknown path 404s (and still carries the help band)', async () => {
  const res = await get('/nope/whatever');
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /Not found/);
  assert.match(res.body, /Gambling a problem\?/);
});

// ── never throws on garbage input ───────────────────────────────────────────────────────────────────
test('handler never throws on malformed input', async () => {
  for (const bad of ['', '///', '/%', '/ ', '/calculators?x=<script>']) {
    const res = mockRes();
    await assert.doesNotReject(() => handler({ url: bad, method: 'GET' }, res));
    assert.ok(res.statusCode >= 200, `should have responded for ${JSON.stringify(bad)}`);
  }
});

// ── proves ZERO request-time network: make global fetch throw, everything still renders ─────────────
test('server does no request-time network (global fetch is never called)', async () => {
  const savedFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls += 1; throw new Error('network is banned in this test'); };
  try {
    for (const p of [...HTML_PAGES, '/health', '/robots.txt', '/sitemap.xml', '/llms.txt']) {
      const res = await get(p);
      assert.ok(res.statusCode === 200, `${p} should still render with network banned`);
    }
    assert.equal(fetchCalls, 0, 'handler must not call fetch at request time');
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// site/soapbox/server.test.mjs — OFFLINE route-rendering tests for the SoapBox aggregator.
//
// ── Why this tests the render UNITS, not the server's request handler ──────────────────────────────
// site/soapbox/server.mjs is NOT safely importable: at module top-level it calls
//     createServer(async (req,res) => {...}).listen(PORT, HOST, ...)
// with NO CLI guard (`if (import.meta...)`) and exports NO handle(req,res). Importing it would bind a
// real listening socket — exactly what this task forbids. (The existing routes.test.js boots the real
// server in a child process for a couple of network-free routes; this file instead exercises the pure
// render layer the routes are composed from, fully in-process, with injected fetch — no listener, no
// network.) So we test the building blocks each route renders:
//   • coin-socials.mjs — the coin page's "Community & socials" card (the new socials surface)
//   • chyron.mjs       — the /api/chyron JSON endpoint payload (injected fetch)
//   • news.mjs         — the /news page + /api/news feed (injected fetch)
//   • render.mjs       — layout()/card(): the HTML envelope EVERY route emits (SEO surface, 404 card)
//   • verticals.mjs    — findVertical()/renderVertical(): the /<vertical> dispatch the router calls
//
//   node --test site/soapbox/server.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { socialsFor, renderSocials, hasSocials, classify, twitterHandle } from '../../integrations/soapbox/coin-socials.mjs';
import { layout, card, esc } from './render.mjs';
import { findVertical, renderVertical, verticalPaths } from './verticals.mjs';
import * as chyron from '../../integrations/soapbox/chyron.mjs';
import * as news from '../../integrations/soapbox/news.mjs';
import * as comms from '../../integrations/comms-parser.mjs';

// ── offline fetch helper ──────────────────────────────────────────────────────────────────────────
// A fetch stub that maps URL-substrings → JSON bodies. Any unmatched URL throws, so a real network
// call would fail the test loudly instead of silently going out to the internet.
function stubFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, body] of routes) {
      if (u.includes(needle)) {
        return { ok: true, status: 200, async json() { return body; } };
      }
    }
    throw new Error(`OFFLINE: unexpected fetch to ${u}`);
  };
}

// A fetch stub that always 404s (exercises the soft-fail → [] paths).
const fail404 = async () => ({ ok: false, status: 404, async json() { return {}; } });

// ── coin-socials: the coin page's socials card (PURE, no network) ───────────────────────────────────

test('classify maps social URLs to platforms; twitterHandle extracts the handle', () => {
  assert.equal(classify('https://twitter.com/Bitcoin').key, 'twitter');
  assert.equal(classify('https://discord.gg/abc').key, 'discord');
  assert.equal(classify('https://t.me/Litecoin').key, 'telegram');
  assert.equal(classify('not-a-url'), null);
  assert.equal(twitterHandle('https://twitter.com/ethereum'), 'ethereum');
  assert.equal(twitterHandle('https://twitter.com/i/intent'), null); // non-profile path → no handle
});

test('socialsFor resolves curated + adapter links into a typed, ordered set', () => {
  // bitcoin has a CURATED override → reddit/twitter/github/bitcointalk guaranteed even with no adapter data
  const s = socialsFor({ id: 'bitcoin', symbol: 'BTC' });
  assert.equal(s.twitterHandle, 'Bitcoin');
  assert.ok(s.reddit && s.github && s.bitcointalk);
  assert.ok(s.all.length >= 3);
  // adapter-supplied links (no curated entry) still classify
  const s2 = socialsFor({ id: 'someTok', symbol: 'XYZ', links: { website: 'https://xyz.org', social: ['https://t.me/xyzchat'] }, official: { repos: ['https://github.com/xyz/xyz'] } });
  assert.equal(s2.telegram, 'https://t.me/xyzchat');
  assert.equal(s2.github, 'https://github.com/xyz/xyz');
  assert.equal(s2.website, 'https://xyz.org');
});

test('renderSocials emits the Twitter timeline embed + escaped pill buttons', () => {
  const html = renderSocials({ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' });
  assert.match(html, /twitter-timeline/);                 // the live embed widget
  assert.match(html, /platform\.twitter\.com\/widgets\.js/);
  assert.match(html, /reddit\.com\/r\/Bitcoin/);          // a non-twitter pill button
  assert.match(html, /target="_blank"/);
});

test('renderSocials neutralizes hostile link/name content (no raw injection)', () => {
  const html = renderSocials({
    id: 'evil', symbol: 'EVL', name: '<script>alert(1)</script>',
    links: { website: 'https://ok.example/"><img src=x onerror=alert(1)>' },
  });
  // the breakout characters (" < >) must be escaped so the payload can't escape the href attribute
  // or open a new tag. The inert "onerror=alert(1)" text may survive INSIDE the escaped value — that's
  // harmless, because the quote and angle brackets around it are entities, so no element/handler forms.
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);   // name never becomes a live <script>
  assert.doesNotMatch(html, /"><img src=x/);                   // the href quote+tag breakout is gone
  assert.doesNotMatch(html, /<img src=x onerror/);             // no live <img onerror> element
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/); // it's fully entity-escaped
});

test('hasSocials is false for a bare coin, true once any presence exists', () => {
  assert.equal(hasSocials({ id: 'nada', symbol: 'NADA' }), false);
  assert.equal(hasSocials({ id: 'nada', symbol: 'NADA', links: { website: 'https://nada.io' } }), true);
});

// ── render.mjs: the layout envelope every route shares + the 404 card ────────────────────────────────

test('layout() emits the SEO surface the server attaches to each page', () => {
  const html = layout({
    title: 'Bitcoin (BTC)', description: 'live price', canonical: 'https://data.soapbox.community/coins/bitcoin',
    jsonld: { '@type': 'FinancialProduct' }, body: '<h1>Bitcoin</h1>',
  });
  assert.match(html, /<title>Bitcoin \(BTC\)/);
  assert.match(html, /<link rel=canonical href="https:\/\/data\.soapbox\.community\/coins\/bitcoin">/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /<h1>Bitcoin<\/h1>/);
});

test('the server\'s 404 body (card layout) renders with a markets link', () => {
  // mirrors server.mjs: send(layout({ title: '404', body: card('404', '...← markets...') }), 404)
  const html = layout({ title: '404', body: card('404', '<p class=muted><a href="/">← markets</a></p>') });
  assert.match(html, /404/);
  assert.match(html, /← markets/);
  assert.match(html, /href="\/"/);
});

test('esc neutralizes HTML (the escaping the page factory relies on)', () => {
  assert.equal(esc('<b>"&'), '&lt;b&gt;&quot;&amp;');
});

// ── verticals.mjs: the /<vertical> dispatch the router calls ─────────────────────────────────────────

test('findVertical resolves a known path and rejects unknown ones', () => {
  assert.ok(findVertical('/energy'));
  assert.ok(findVertical('/weather'));
  assert.equal(findVertical('/definitely-not-a-vertical'), undefined);
  assert.ok(verticalPaths.includes('/legal'));
});

test('renderVertical degrades gracefully (never throws, offline)', async () => {
  // a search vertical with no query renders its form without fetching
  const legal = await renderVertical('/legal', '');
  assert.equal(typeof legal, 'string');
  assert.ok(legal.length > 0);
  // unknown path → the friendly unavailable card, not a crash
  const missing = await renderVertical('/nope', '');
  assert.match(missing, /unavailable|not available|temporarily/i);
});

// ── chyron.mjs: the /api/chyron payload (injected fetch — pure offline) ──────────────────────────────

test('chyron pure scorers: severity tiers, quake + move scores', () => {
  assert.equal(chyron.severityTier(90), 'critical');
  assert.equal(chyron.severityTier(60), 'high');
  assert.equal(chyron.severityTier(40), 'med');
  assert.equal(chyron.severityTier(10), 'low');
  assert.equal(chyron.quakeScore(3.0), 0);          // below the 4.5 threshold
  assert.ok(chyron.quakeScore(7.0) >= 60);
  assert.ok(chyron.moveScore(-8) >= 70);
});

test('chyron.curate dedups by text, sorts by score desc, and caps', () => {
  const out = chyron.curate([
    { text: 'Big quake near coast', score: 90 },
    { text: 'big   QUAKE near coast!', score: 50 }, // dup of the above after normalization
    { text: 'Market up 2%', score: 20 },
    { text: 'War headline', score: 70 },
  ], 2);
  assert.equal(out.length, 2);                 // capped
  assert.equal(out[0].score, 90);             // highest first
  assert.equal(out[0].tier, 'critical');      // tier annotated
  assert.equal(out[1].text, 'War headline');  // dup collapsed, next-highest kept
});

test('worldClocks returns the financial-capital set used by /api/chyron', () => {
  const clocks = chyron.worldClocks();
  assert.ok(Array.isArray(clocks) && clocks.length >= 8);
  assert.ok(clocks.every((c) => c.city && c.tz));
});

test('chyron.earthquakes parses an injected USGS feed (offline)', async () => {
  chyron.__setFetch(stubFetch([
    ['earthquake.usgs.gov', { features: [
      { properties: { mag: 6.4, place: '10km S of Testville', url: 'https://usgs/eq1' } },
      { properties: { mag: 3.1, place: 'too small', url: 'https://usgs/eq2' } },
    ] } ],
  ]));
  try {
    const out = await chyron.earthquakes();
    assert.equal(out.length, 1);                       // the M3.1 is filtered (score 0)
    assert.match(out[0].text, /M6\.4 earthquake — 10km S of Testville/);
    assert.ok(out[0].score >= 50);
  } finally {
    chyron.__setFetch(null);
  }
});

test('chyron.earthquakes soft-fails to [] on a 404 (no throw)', async () => {
  chyron.__setFetch(fail404);
  try {
    assert.deepEqual(await chyron.earthquakes(), []);
  } finally {
    chyron.__setFetch(null);
  }
});

// ── news.mjs: the /news page sections + /api/news feed (injected fetch) ──────────────────────────────

test('news pure helpers: LIVE_STREAMS resolve to channel /live, dedupCap collapses dups', () => {
  assert.ok(news.LIVE_STREAMS.length >= 5);
  assert.ok(news.LIVE_STREAMS.every((s) => /youtube\.com\/@.+\/live$/.test(s.url)));
  const capped = news.dedupCap([
    { title: 'SEC approves ETF' }, { title: 'sec   approves ETF!' }, { title: 'Other story' },
  ], 5);
  assert.equal(capped.length, 2); // the two near-identical titles collapse to one
});

test('news.govItems parses an injected Federal Register response (offline)', async () => {
  news.__setFetch(stubFetch([
    ['federalregister.gov', { results: [
      { title: 'Digital Asset Rulemaking', html_url: 'https://fr/doc1', type: 'Rule', publication_date: '2026-06-01' },
    ] } ],
  ]));
  try {
    const items = await news.govItems({ limit: 5 });
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://fr/doc1');
    assert.match(items[0].source, /Federal Register/);
  } finally {
    news.__setFetch(null);
  }
});

test('news.newsFeed assembles the sectioned tab offline (gov + disasters from injected feeds)', async () => {
  // newsFeed() pulls: comms-parser headlines, Federal Register (govItems), USGS quakes + NWS alerts
  // (chyron, which uses ITS OWN _fetch). Inject ALL THREE module fetches so nothing touches the network.
  // comms-parser's fetch is stubbed to throw → every feed fails soft → crypto/world resolve to [].
  comms.__setFetch(async () => { throw new Error('OFFLINE: comms-parser network blocked in test'); });
  news.__setFetch(stubFetch([
    ['federalregister.gov', { results: [{ title: 'Crypto Rule', html_url: 'https://fr/x', type: 'Rule', publication_date: '2026-06-02' }] }],
  ]));
  chyron.__setFetch(stubFetch([
    ['earthquake.usgs.gov', { features: [{ properties: { mag: 5.5, place: 'Offshore', url: 'https://usgs/q' } }] }],
    ['api.weather.gov', { features: [{ properties: { event: 'Tornado Warning', areaDesc: 'County A; County B', severity: 'Extreme' } }] }],
  ]));
  try {
    const feed = await news.newsFeed();
    // structure the /news page + /api/news both consume
    for (const k of ['crypto', 'world', 'gov', 'disasters', 'live']) assert.ok(k in feed, `feed.${k} present`);
    assert.ok(Array.isArray(feed.gov) && feed.gov.length === 1);
    assert.match(feed.gov[0].title, /Crypto Rule/);
    assert.ok(feed.disasters.some((d) => /M5\.5 earthquake/.test(d.title)));
    assert.ok(feed.disasters.some((d) => /Tornado Warning/.test(d.title)));
    assert.equal(feed.live, news.LIVE_STREAMS);
  } finally {
    news.__setFetch(null);
    chyron.__setFetch(null);
    comms.__setFetch(null);
  }
});

test('newsPage-style section rendering escapes feed content (no injection via headlines)', () => {
  // mirrors server.mjs newsPage()'s sec(): items rendered into <li><a href=esc>esc(title)</a>
  const items = [{ title: '<img src=x onerror=alert(1)>', url: 'https://ok/"><script>', source: 'X' }];
  const li = items.map((i) => `<li>${i.url ? `<a href="${esc(i.url)}" target=_blank rel=noopener>${esc(i.title)}</a>` : esc(i.title)}${i.source ? ` <span class=muted>— ${esc(i.source)}</span>` : ''}</li>`).join('');
  assert.doesNotMatch(li, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(li, /"><script>/);
  assert.match(li, /&lt;img|&quot;|&gt;/);
});

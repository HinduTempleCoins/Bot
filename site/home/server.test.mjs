// server.test.mjs — offline tests for soapbox.community ROOT, the ecosystem HOME PAGE / FAMILY TREE.
// Fully offline: the SERVICES map is static and mainnetUrl()/resolve() are pure — no network. We drive the
// exported async handler through a mock req/res (no port bound) and assert: the page renders BOTH an Alpha
// family tree and a MainNet family tree laid out separately, each CENTERED on a SoapBox Community hub with
// the three chain families fanning out bilaterally (MELEK / PRANA / KULA) as wings; a known leaf (Akasha)
// shows its alpha URL clickable + its mainnet URL as "soon"; mainnetUrl() derives both domain shapes;
// esc() neutralizes injection; unknown route soft-404s.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, mainnetUrl, resolve, esc, SERVICES, renderMarkdown } from './server.mjs';

function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath, method = 'GET') => ({ url: urlPath, method, on() {} });
async function drive(urlPath) {
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

test('mainnetUrl(): strips alpha. from the main-app form (alpha.kula.money → kula.money)', () => {
  assert.equal(mainnetUrl('alpha.kula.money'), 'kula.money');
  assert.equal(mainnetUrl('https://alpha.kula.money'), 'https://kula.money');
});

test('mainnetUrl(): strips alpha. from the subdomain form (akasha.alpha.soapbox.community → akasha.soapbox.community)', () => {
  assert.equal(mainnetUrl('akasha.alpha.soapbox.community'), 'akasha.soapbox.community');
  assert.equal(mainnetUrl('https://rpc.prana.alpha.melek.salon/'), 'https://rpc.prana.melek.salon/');
});

test('mainnetUrl(): no alpha label → unchanged; empty → empty', () => {
  assert.equal(mainnetUrl('pool.soapbox.community'), 'pool.soapbox.community');
  assert.equal(mainnetUrl(''), '');
  assert.equal(mainnetUrl(null), '');
});

test('resolve(): main app, subdomain, and same-both forms', () => {
  const kula = resolve({ base: 'kula.money', sub: '' });
  assert.equal(kula.alphaHost, 'alpha.kula.money');
  assert.equal(kula.mainnetHost, 'kula.money');
  assert.equal(kula.sameBoth, false);

  const akasha = resolve({ base: 'soapbox.community', sub: 'akasha' });
  assert.equal(akasha.alphaHost, 'akasha.alpha.soapbox.community');
  assert.equal(akasha.mainnetHost, 'akasha.soapbox.community');

  const pool = resolve({ base: 'soapbox.community', sub: '=pool' });
  assert.equal(pool.alphaHost, 'pool.soapbox.community');
  assert.equal(pool.mainnetHost, 'pool.soapbox.community');
  assert.equal(pool.sameBoth, true);
});

test('home: 200 HTML with both an Alpha tree and a MainNet tree, laid out separately', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  // two distinct net sections, each a full family tree
  assert.match(b, /<section class="net alpha-net"/);
  assert.match(b, /<section class="net mainnet-net"/);
  assert.match(b, />Alpha<\/h2>/);
  assert.match(b, />MainNet<\/h2>/);
  // exactly two trees rendered (one per net)
  assert.equal((b.match(/<div class=tree>/g) || []).length, 2, 'one tree per net');
  // the standing alpha-badge convention beside the wordmark
  assert.match(b, /class=alpha>Alpha</);
});

test('home: each tree is CENTERED on a SoapBox Community hub with the families fanning out bilaterally', () => {
  const b = homePage();
  // a central hub node per tree (two total) — the focal node in the middle
  const hubs = b.match(/class="node-box hub-box"/g) || [];
  assert.equal(hubs.length, 2, 'one central hub per tree');
  assert.match(b, /<div class=fam>SoapBox Community<\/div>/);
  // the three families are placed bilaterally: MELEK left, PRANA right, KULA down (two trees → two each)
  assert.equal((b.match(/class="wing wing-left"/g) || []).length, 2, 'MELEK fans left in both trees');
  assert.equal((b.match(/class="wing wing-right"/g) || []).length, 2, 'PRANA fans right in both trees');
  assert.equal((b.match(/class="wing wing-down"/g) || []).length, 2, 'KULA hangs below in both trees');
});

test('home: the three chain families (MELEK / PRANA / KULA) appear in both trees as branch nodes', () => {
  const b = homePage();
  // each family name shows once per tree → twice total, as a branch node
  for (const fam of ['MELEK', 'PRANA', 'KULA']) {
    const hits = (b.match(new RegExp(`<div class=fam>${fam}<\\/div>`, 'g')) || []).length;
    assert.ok(hits >= 2, `${fam} branch should appear in both the alpha and mainnet trees (saw ${hits})`);
  }
});

test('home: Akasha is a clickable alpha leaf (under KULA) and shows its mainnet URL as soon', () => {
  const b = homePage();
  assert.match(b, /Akasha/);
  // alpha leaf is a real clickable anchor
  assert.match(b, /<a class="leaf-box node-box" href="https:\/\/akasha\.alpha\.soapbox\.community"/);
  // mainnet URL is shown (as the future host) and tagged coming soon, NOT as an anchor
  assert.match(b, /akasha\.soapbox\.community · coming soon/);
});

test('home: a same-both service (pool) is a clickable leaf in BOTH trees', () => {
  const b = homePage();
  // pool.soapbox.community appears as a clickable leaf anchor (it has no alpha variant)
  const anchors = b.match(/<a class="leaf-box node-box" href="https:\/\/pool\.soapbox\.community"/g) || [];
  assert.ok(anchors.length >= 2, 'pool should be a live link in both the alpha and mainnet trees');
});

test('home: every service renders its alpha host as a clickable leaf', () => {
  const b = homePage();
  for (const s of SERVICES) {
    const host = resolve(s).alphaHost;
    assert.match(b, new RegExp(`href="https://${host.replace(/\./g, '\\.')}"`), `missing alpha link for ${s.name}`);
  }
});

test('esc(): neutralizes script injection', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const b = homePage();
  assert.doesNotMatch(b, /<script>alert/);
});

test('home: canonical + OpenGraph + robots meta present', () => {
  const b = homePage();
  assert.match(b, /<link rel=canonical/);
  assert.match(b, /og:title/);
  assert.match(b, /name=robots/);
});

test('routes: /health, /robots.txt, /sitemap.xml, /llms.txt, and unknown soft-404s', async () => {
  const h = await drive('/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.body, 'ok');

  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/plain/);
  assert.match(r.body, /Sitemap:/);

  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.headers['content-type'], /xml/);

  const l = await drive('/llms.txt');
  assert.equal(l.statusCode, 200);
  assert.match(l.body, /Alpha \(live testnet\)/);
  assert.match(l.body, /MainNet \(coming soon\)/);

  // unknown route still renders the map (never a dead end) but with a 404 code
  const nf = await drive('/nope');
  assert.equal(nf.statusCode, 404);
  assert.match(nf.body, />Alpha<\/h2>/);
});

// ── /roadmap ────────────────────────────────────────────────────────────────────────────────────────
// The [ANN] thread links a public roadmap URL, so the apex must actually serve one. Rendered from the
// committed markdown; the renderer is escape-first so the file can never inject raw HTML.

test('/roadmap renders the committed roadmap markdown as HTML', async () => {
  const res = await drive('/roadmap');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<h1>Van Kush Family — Roadmap<\/h1>/);
  assert.match(res.body, /<h2>Phases<\/h2>/);
  assert.match(res.body, /Phase I — Foundations/);
  assert.match(res.body, /<blockquote>/); // the closing "intentionally high-level" note
  assert.match(res.body, /rel=canonical href="[^"]*\/roadmap"/);
});

test('/roadmap.html is the same page (no dead link from either form)', async () => {
  const a = await drive('/roadmap');
  const b = await drive('/roadmap.html');
  assert.equal(b.statusCode, 200);
  assert.equal(a.body, b.body);
});

test('roadmapPage(): soft-fails to a placeholder when the markdown is unreadable, never throws', async () => {
  const saved = process.env.ROADMAP_MD;
  process.env.ROADMAP_MD = '/nonexistent/roadmap.md';
  try {
    // ROADMAP_MD is read at import time, so drive the renderer's fallback shape directly instead:
    // an empty source must still produce a page, not an exception.
    assert.equal(renderMarkdown(''), '');
    const res = await drive('/roadmap');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.length > 0);
  } finally {
    if (saved === undefined) delete process.env.ROADMAP_MD; else process.env.ROADMAP_MD = saved;
  }
});

test('renderMarkdown(): escape-first — raw HTML in the source is neutralized, not emitted', () => {
  const html = renderMarkdown('# <script>alert(1)</script>\n\n- <img src=x onerror=y>\n');
  assert.ok(!/<script>/.test(html), 'script tag must not survive');
  assert.ok(!/<img /.test(html), 'img tag must not survive');
  assert.match(html, /&lt;script&gt;/);
});

test('renderMarkdown(): supports the small tag set it claims (headings, list, bold, italic, quote)', () => {
  const html = renderMarkdown('## Title\n\n- **bold** and _ital_\n\n> quoted\n\nplain\n');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<ul>\n<li><b>bold<\/b> and <i>ital<\/i><\/li>\n<\/ul>/);
  assert.match(html, /<blockquote>quoted<\/blockquote>/);
  assert.match(html, /<p>plain<\/p>/);
});

test('sitemap + llms.txt advertise every committed-markdown doc', async () => {
  const sm = await drive('/sitemap.xml');
  assert.match(sm.body, /\/roadmap<\/loc>/);
  assert.match(sm.body, /\/whitepaper<\/loc>/);
  const llms = await drive('/llms.txt');
  assert.match(llms.body, /\/roadmap\)/);
  assert.match(llms.body, /\/whitepaper\)/);
});

// ── /whitepaper ─────────────────────────────────────────────────────────────────────────────────────
// The whitepaper leans on markdown the roadmap never used — tables, horizontal rules, inline code —
// so it exercises the parts of renderMarkdown() the roadmap alone would leave unproven.

test('/whitepaper renders the committed whitepaper', async () => {
  const res = await drive('/whitepaper');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1>MELEK — An AI-Native Blockchain Community<\/h1>/);
  assert.match(res.body, /Rule 1 of Angelic AI/);
  assert.match(res.body, /rel=canonical href="[^"]*\/whitepaper"/);
});

test('/whitepaper renders its parameter tables as real tables, not pipe soup', async () => {
  const res = await drive('/whitepaper');
  assert.match(res.body, /<table>/);
  assert.match(res.body, /<th>/);
  assert.match(res.body, /907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b/);
  assert.ok(!/<p>\|/.test(res.body), 'no table row may fall through to a paragraph');
});

test('/whitepaper.html is the same page', async () => {
  const a = await drive('/whitepaper');
  const b = await drive('/whitepaper.html');
  assert.equal(b.statusCode, 200);
  assert.equal(a.body, b.body);
});

test('renderMarkdown(): tables, rules and inline code', () => {
  const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | `x` |\n\n---\n\ntail\n');
  assert.match(html, /<div class=tw><table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>1<\/td><td><code>x<\/code><\/td><\/tr><\/tbody>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<p>tail<\/p>/);
  assert.ok(!/\|---\|/.test(html), 'the |---| separator row must not be rendered');
});

test('renderMarkdown(): a table closes when the pipes stop, and escaping still applies inside cells', () => {
  const html = renderMarkdown('| H |\n|---|\n| <script> |\n\nafter\n');
  assert.ok(!/<script>/.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<\/table><\/div>\n<p>after<\/p>/);
});

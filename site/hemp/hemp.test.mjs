// hemp.test.mjs — offline tests for the Hemp.SoapBox portal. Fully offline: the cannabis module's
// price aggregation takes INJECTABLE sources and its web scour is injectable, so no real network call
// is ever made; the price-index views accept canned sources directly. We drive the exported handler
// through a mock req/res (no port bound) and assert: every route serves 200, HTML is escaped, the THC
// classifier renders hemp/marijuana correctly, the orgs registry is facts-not-verdicts with right-of-
// reply, the price indexes derive a median from injected listings and otherwise soft-fail honestly,
// the disclaimer/footer is on every page, and health/robots/sitemap respond.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, homePage, lawView, orgsView, flowerView, seedsView, esc,
} from './server.mjs';
import { splitByThc, cannabisPriceIndexes } from '../../integrations/soapbox/cannabis.mjs';

// ── mock req/res ──────────────────────────────────────────────────────────────────────────────────
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

// ── 1. routes serve ────────────────────────────────────────────────────────────────────────────
test('home route serves 200 HTML with all sections', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /SoapBox Hemp/);
  for (const sec of ['/law', '/orgs', '/flower', '/seeds']) {
    assert.ok(res.body.includes(`href="${sec}"`), `home links ${sec}`);
  }
});

test('every content route serves 200 (soft-fail, no 500)', async () => {
  for (const p of ['/law', '/orgs', '/flower', '/seeds']) {
    const res = await drive(p);
    assert.equal(res.statusCode, 200, `${p} serves 200`);
    assert.ok(res.body.length > 200, `${p} renders a body`);
  }
});

test('health, robots.txt, and sitemap.xml respond', async () => {
  const h = await drive('/health'); assert.equal(h.statusCode, 200); assert.equal(h.body, 'ok');
  const r = await drive('/robots.txt'); assert.equal(r.statusCode, 200); assert.match(r.body, /Sitemap:/);
  const s = await drive('/sitemap.xml'); assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/); assert.ok(s.body.includes('/law') && s.body.includes('/seeds'));
});

test('unknown route 302-redirects home', async () => {
  const res = await drive('/nonsense');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── 2. footer / disclaimer discipline on every page ──────────────────────────────────────────────
test('every page carries the facts-not-verdicts footer + not-legal-advice + right-of-reply', async () => {
  for (const p of ['/', '/law', '/orgs', '/flower', '/seeds']) {
    const res = await drive(p);
    assert.match(res.body, /Facts, not verdicts/, `${p} footer`);
    assert.match(res.body, /not\s+legal advice/i, `${p} disclaimer`);
    assert.match(res.body, /right of reply/i, `${p} right-of-reply`);
  }
});

// ── 3. escaping ──────────────────────────────────────────────────────────────────────────────────
test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc('<script>"&"</script>'), '&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
});

test('a malicious THC / state input is escaped (no raw tag)', () => {
  const html = lawView('<img src=x onerror=alert(1)>', '<b>CA</b>');
  assert.ok(!html.includes('<img src=x'), 'no raw injected tag');
  assert.match(html, /&lt;img src=x/);
  assert.ok(!html.includes('<b>CA</b>'));
});

test('a malicious strain query is escaped on the seeds page', async () => {
  const html = await seedsView('<svg onload=alert(1)>');
  assert.ok(!html.includes('<svg onload'), 'no raw injected tag');
  assert.match(html, /&lt;svg onload/);
});

// ── 4. THC classifier rendering ──────────────────────────────────────────────────────────────────
test('lawView classifies hemp vs marijuana with citations', () => {
  const hemp = lawView('0.25', 'Colorado');
  assert.match(hemp, /HEMP/);
  assert.match(hemp, /1639o/);
  assert.match(hemp, /Colorado/);
  const mj = lawView('18', '');
  assert.match(mj, /MARIJUANA/);
  assert.match(mj, /Schedule I/);
  assert.match(mj, /802/);
});

test('lawView renders the federal line + state-varies note + nuance notes', () => {
  const html = lawView('', 'Texas');
  assert.match(html, /Legal status — Texas/);
  assert.match(html, /varies/i);
  assert.match(html, /Nuances that trip people up/);
  assert.match(html, /Total-THC/);
  assert.match(html, /delta-8/i);
});

test('lawView rejects a non-numeric THC value gracefully', () => {
  const html = lawView('notanumber', '');
  assert.match(html, /isn't a valid delta-9 THC/);
});

// ── 5. orgs registry: facts-not-verdicts + right-of-reply ────────────────────────────────────────
test('orgsView lists reform orgs and churches with right-of-reply, no legitimacy verdict', () => {
  const html = orgsView();
  for (const must of ['NORML', 'Marijuana Policy Project', 'Drug Policy Alliance', 'Oklevueha', 'THC Ministry']) {
    assert.match(html, new RegExp(must.replace(/[()]/g, '.')), `lists ${must}`);
  }
  assert.match(html, /Right of reply:/);
  assert.match(html, /no judgment/i);
  // no "scam"/"verified"/"legitimate" verdict language about the entities
  assert.ok(!/\bwe verify\b|\bis legitimate\b|\bis a scam\b/i.test(html));
});

// ── 6. price indexes: hemp/marijuana split derived from injected sources ──────────────────────────
test('splitByThc partitions listings on the 0.3% delta-9 line (hemp vs marijuana)', () => {
  const split = splitByThc([
    { price: 5, delta9Pct: 0.2 },   // hemp
    { price: 6, delta9Pct: 0.3 },   // hemp (at the line)
    { price: 12, delta9Pct: 12 },   // marijuana
    { price: 14, delta9Pct: 0.31 }, // marijuana (just over)
    { price: 9 },                   // unknown (no THC tag)
  ]);
  assert.equal(split.hemp.length, 2, 'two hemp listings (0.2% and 0.3%)');
  assert.equal(split.marijuana.length, 2, 'two marijuana listings (12% and 0.31%)');
  assert.equal(split.unknown.length, 1, 'one unclassified listing');
  assert.deepEqual(split.hemp.map((r) => r.delta9Pct).sort((a, b) => a - b), [0.2, 0.3]);
  assert.deepEqual(split.marijuana.map((r) => r.delta9Pct).sort((a, b) => a - b), [0.31, 12]);
});

test('cannabisPriceIndexes derives a SEPARATE median per side, never lumped', () => {
  const idx = cannabisPriceIndexes([
    { price: 4, delta9Pct: 0.2 }, { price: 6, delta9Pct: 0.25 }, { price: 8, delta9Pct: 0.1 }, // hemp → median 6
    { price: 10, delta9Pct: 18 }, { price: 20, delta9Pct: 22 }, { price: 30, delta9Pct: 25 },  // mj → median 20
  ]);
  assert.equal(idx.hemp.value.median, 6);
  assert.equal(idx.marijuana.value.median, 20);
  assert.match(idx.basis, /1639o/);
});

test('flowerView renders TWO distinct index cards (hemp + marijuana) from THC-tagged sources', async () => {
  // 0.2% delta-9 = hemp; 12% delta-9 = marijuana.
  const html = await flowerView({
    vendor: () => [
      { price: 4, delta9Pct: 0.2 }, { price: 6, delta9Pct: 0.2 }, { price: 8, delta9Pct: 0.2 }, // hemp median 6
      { price: 10, delta9Pct: 12 }, { price: 12, delta9Pct: 12 }, { price: 14, delta9Pct: 12 }, // mj median 12
    ],
  });
  // two separate, legally-labeled cards
  assert.match(html, /Hemp\s*—\s*≤0\.3% delta-9 THC, 7 U\.S\.C\. § 1639o/);
  assert.match(html, /Marijuana\s*—\s*&gt;0\.3% delta-9, Schedule I/);
  // distinct medians prove the prices are NOT lumped
  assert.match(html, /\$6/);   // hemp median
  assert.match(html, /\$12/);  // marijuana median
  assert.match(html, /vendor/);
  assert.match(html, /derived median index/i);
  // exactly two <h3> index cards (Hemp + Marijuana)
  const h3s = (html.match(/<h3>(Hemp|Marijuana)<\/h3>/g) || []);
  assert.equal(h3s.length, 2, 'one hemp card + one marijuana card');
});

test('flowerView with no sources falls back to sample listings, still split by law', async () => {
  const html = await flowerView();
  // sample listings cover both sides → both cards render, with the legal basis explained
  assert.match(html, /Hemp\s*—\s*≤0\.3% delta-9/);
  assert.match(html, /Marijuana\s*—\s*&gt;0\.3% delta-9/);
  assert.match(html, /sample listings/i);
  assert.match(html, /1639o/);
});

test('seedsView derives a split seed index + renders SeedFinder-style strain link-outs', async () => {
  const html = await seedsView('Northern Lights', {
    bank: () => [
      { price: 30, delta9Pct: 0.2 }, { price: 40, delta9Pct: 0.2 }, { price: 50, delta9Pct: 0.2 }, // hemp median 40
      { price: 60, delta9Pct: 22 }, { price: 80, delta9Pct: 22 }, { price: 100, delta9Pct: 22 },   // mj median 80
    ],
  });
  assert.match(html, /Hemp\s*—\s*≤0\.3% delta-9/);
  assert.match(html, /Marijuana\s*—\s*&gt;0\.3% delta-9/);
  assert.match(html, /\$40/);  // hemp median
  assert.match(html, /\$80/);  // marijuana median
  assert.match(html, /Strain lookup/);
  assert.match(html, /SeedFinder/);
  assert.match(html, /seedfinder\.eu.*Northern/i);
  // genetics source directory present
  assert.match(html, /Strain genetics/);
  assert.match(html, /Leafly/);
});

test('seedsView with no strain still shows the split index + the source directory', async () => {
  const html = await seedsView('');
  assert.ok(!/Strain lookup/.test(html), 'no strain-lookup card without a query');
  assert.match(html, /Strain genetics/);
  // still renders the law-split price section (sample fallback)
  assert.match(html, /Hemp\s*—\s*≤0\.3% delta-9/);
});

// ── 7. home classifier box ───────────────────────────────────────────────────────────────────────
test('home page exposes a THC-classifier box pointing at /law', () => {
  const html = homePage();
  assert.match(html, /action="\/law"/);
  assert.match(html, /name="thc"/);
  assert.match(html, /0\.3% delta-9 THC/);
});

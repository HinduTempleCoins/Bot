// vankushfamily.test.mjs — offline tests for the VanKushFamily.com public ROADMAP server.
// Pure render + route assertions; no network, no port bound (drives the exported handler via a mock res).
//
//   node --test site/vankushfamily/vankushfamily.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { homePage, roadmapPage, crestSvg, handler, esc, PHASES } from './server.mjs';

// minimal mock response that captures status, headers and body for handler() tests.
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += chunk; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a&b>"'), '&lt;a&amp;b&gt;&quot;');
  assert.equal(esc(null), '');
});

test('home page renders the title and lead', () => {
  const html = roadmapPage();
  assert.match(html, /Van Kush Family — Roadmap/);
  assert.match(html, /AI-native blockchain community/);
  assert.match(html, /<!doctype html>/);
});

test('all five forward phases plus the soon-after block are present', () => {
  const html = roadmapPage();
  // Phase 0 shipped, Day 0, after-Day-0, PRANA, SOAP, Beyond
  assert.match(html, /Phase 0 — Already shipped/);
  assert.match(html, /Day 0 — MELEK mainnet — LIVE/); // MELEK launched 2026-07-12 — shipped, not "launch (next)"
  assert.match(html, /MELEK maturing/);
  assert.match(html, /PRANA — useful-work chain/);
  assert.match(html, /SOAP — the Beauty Economy/);
  assert.match(html, /Beyond/);
  // phase anchors used by the topbar
  for (const id of ['shipped', 'day0', 'prana', 'soap', 'beyond']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing phase anchor ${id}`);
  }
});

test('PHASES data has exactly the six expected phases in order', () => {
  assert.equal(PHASES.length, 6);
  assert.deepEqual(PHASES.map((p) => p.id), ['shipped', 'day0', 'after-day0', 'prana', 'soap', 'beyond']);
  assert.equal(PHASES[0].kind, 'shipped'); // Phase 0 node styled as shipped
  assert.equal(PHASES[1].kind, 'shipped'); // Day 0 (MELEK) is now LIVE — shipped
  assert.equal(PHASES[2].kind, 'now'); // "MELEK maturing" is the current now-node
});

test('shipped milestones carry a shipped badge; later milestones carry planned/progress', () => {
  const html = roadmapPage();
  assert.match(html, /class="badge shipped">shipped</);
  assert.match(html, /class="badge planned">planned</);
  assert.match(html, /class="badge progress">in progress</);
  // legend present
  assert.match(html, /live now/);
});

test('Phase 0 only contains shipped milestones (honesty: live, not merely built)', () => {
  const phase0 = PHASES.find((p) => p.id === 'shipped');
  for (const m of phase0.milestones) {
    assert.equal(m.status, 'shipped', `Phase 0 milestone "${m.title}" should be shipped`);
  }
});

test('gated/not-yet-built chain work is NOT marked shipped/done', () => {
  // MELEK (Day 0) is live now. SOAP is the still-gated chain — its milestones must never be shipped/done.
  const soap = PHASES.find((p) => p.id === 'soap');
  for (const m of soap.milestones) {
    assert.ok(['planned', 'progress'].includes(m.status), `SOAP milestone "${m.title}" must not be shipped/done`);
  }
});

test('known shipped milestones appear', () => {
  const html = roadmapPage();
  assert.match(html, /data\.soapbox\.community is LIVE/);
  assert.match(html, /Condenser proven over MELEK/);
  assert.match(html, /Cheetah librarian \+ Hathor shell/);
});

test('known forward milestones appear', () => {
  const html = roadmapPage();
  assert.match(html, /MELEK chain live · Hathor produces blocks/);
  assert.match(html, /Conversational Hathor/);
  assert.match(html, /PRANA public network live/);
  assert.match(html, /SOAP chain launch/);
});

test('PUBLIC ONLY: no private/proprietary terms leak into the rendered page', () => {
  const html = roadmapPage().toLowerCase();
  const forbidden = ['resident-ai', 'resident ai', 'signer', 'private key', 'wif', 'kms',
    'kalivankush', 'angelicalist', 'grant program', 'tenant-grant', 'server a', 'server b',
    '.local', 'briefd', 'vault', 'trade bot', 'trade-bot', 'tradebot'];
  for (const term of forbidden) {
    assert.ok(!html.includes(term), `private term leaked into public roadmap: "${term}"`);
  }
});

test('GET / returns the inviting heraldic landing (not the roadmap)', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Van Kush Family/);
  assert.match(res.body, /pick a door/);       // landing section
  assert.match(res.body, /Join MELEK/);         // primary CTA
  assert.doesNotMatch(res.body, /— Roadmap<\/title>/); // it's the landing, not the roadmap page
});

test('GET /roadmap returns the roadmap HTML', async () => {
  const res = await get('/roadmap');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Van Kush Family — Roadmap/);
});

test('landing shows the crest + clickable destinations into the live ecosystem', () => {
  const html = homePage();
  assert.match(html, /Van Kush family crest/);            // inline SVG crest
  assert.match(html, /alpha\.congress\.ink/);              // Congress
  assert.match(html, /witness\.melek\.salon/);            // Witness School
  assert.match(html, /kula\.money/);                      // KulaSwap
  assert.match(html, /\/roadmap/);                         // roadmap link
});

test('crestSvg renders a brand-colored heraldic mark', () => {
  const svg = crestSvg(100);
  assert.match(svg, /<svg/);
  assert.match(svg, /VAN KUSH/);
  assert.match(svg, /#d9a441|#c9992a/); // gold
  assert.match(svg, /#b1223a/);         // crimson
});

test('GET /health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('GET /robots.txt indexes the site and advertises the sitemap', async () => {
  const res = await get('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Allow: \//);
  assert.match(res.body, /Sitemap: https:\/\/vankushfamily\.com\/sitemap\.xml/);
});

test('GET /sitemap.xml lists the home URL', async () => {
  const res = await get('/sitemap.xml');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.match(res.body, /https:\/\/vankushfamily\.com\//);
});

test('GET /llms.txt summarizes the roadmap', async () => {
  const res = await get('/llms.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Van Kush Family Roadmap/);
});

test('unknown path redirects to home', async () => {
  const res = await get('/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('footer cross-links the live SoapBox sites', async () => {
  const html = roadmapPage();
  assert.match(html, /https:\/\/data\.soapbox\.community/);
  assert.match(html, /https:\/\/law\.soapbox\.community/);
  assert.match(html, /https:\/\/politics\.soapbox\.community/);
  assert.match(html, /https:\/\/hemp\.soapbox\.community/);
});

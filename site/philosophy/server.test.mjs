// server.test.mjs — offline tests for the Philosophy.SoapBox civic-education surface. Fully offline:
// the surface has no network (its corpus is local JSON), so tests drive the exported handler through a
// mock req/res (no port bound) and use the __setData seam to exercise empty/partial corpora and the
// soft-fail paths. We assert: every route serves 200, HTML is escaped, unknown ids soft-fail to an
// empty-state (never throw / never 500), the neutrality discipline (tenets AND criticisms) is present,
// facts survive to the page, /maxims complements (does not duplicate) Law's maxims, and the
// health/robots/sitemap/llms endpoints respond.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  handler, esc, __setData, loadData,
  spectrumView, ideologyView, selfDeterminationView, movementsView, movementView, maximsView,
} from './server.mjs';

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

// The real corpus, loaded once for the data-integrity tests.
const DATA = JSON.parse(readFileSync(fileURLToPath(new URL('../../knowledge/civic/political-philosophy.json', import.meta.url)), 'utf8'));

// ── 1. routes serve ────────────────────────────────────────────────────────────────────────────
test('home route serves 200 HTML with all section links', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Political Philosophy/);
  for (const sec of ['/spectrum', '/self-determination', '/movements', '/maxims']) {
    assert.ok(res.body.includes(`href="${sec}"`), `home links ${sec}`);
  }
});

test('every top-level route serves 200', async () => {
  for (const p of ['/', '/spectrum', '/self-determination', '/movements', '/maxims']) {
    const res = await drive(p);
    assert.equal(res.statusCode, 200, `${p} → 200`);
    assert.match(res.body, /<!doctype html>/i, `${p} is a full page`);
  }
});

test('health, robots, sitemap, llms respond', async () => {
  const h = await drive('/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.body, 'ok');
  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /User-agent/i);
  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/);
  assert.match(s.body, /\/spectrum/);
  // sitemap includes per-ideology + per-movement detail urls
  assert.match(s.body, /ideology\?id=liberalism/);
  assert.match(s.body, /movement\?id=black-panther-party/);
  const l = await drive('/llms.txt');
  assert.equal(l.statusCode, 200);
  assert.match(l.body, /SoapBox Philosophy/);
  assert.match(l.body, /history of ideas/i);
});

// ── 2. ideology detail — neutrality discipline (tenets AND criticisms) ────────────────────────────
test('each ideology detail page shows tenets, thinkers, arc, AND criticisms', async () => {
  for (const it of DATA.ideologies) {
    const res = await drive(`/ideology?id=${encodeURIComponent(it.id)}`);
    assert.equal(res.statusCode, 200, `${it.id} → 200`);
    assert.ok(res.body.includes(esc(it.name)), `${it.id} shows its name`);
    assert.match(res.body, /Core tenets/, `${it.id} shows tenets (adherents' view)`);
    assert.match(res.body, /Key thinkers/, `${it.id} shows thinkers`);
    assert.match(res.body, /Historical arc/, `${it.id} shows the arc`);
    assert.match(res.body, /Major criticisms/, `${it.id} shows criticisms (neutrality)`);
  }
});

test('ideologyView returns found=true for a real id and found=false otherwise', () => {
  const ok = ideologyView(DATA, 'anarchism');
  assert.equal(ok.found, true);
  assert.match(ok.html, /Proudhon/);
  const no = ideologyView(DATA, 'no-such-ideology');
  assert.equal(no.found, false);
  assert.match(no.html, /No entry on record/);
});

// ── 3. verified facts survive to the page ─────────────────────────────────────────────────────────
test('key web-verified facts render (BPP, SHARP, self-determination, neocon)', async () => {
  const bpp = await drive('/movement?id=black-panther-party');
  assert.match(bpp.body, /1966/);
  assert.match(bpp.body, /Ten-Point Program/);
  assert.match(bpp.body, /Free Breakfast/);
  assert.match(bpp.body, /COINTELPRO/);
  assert.match(bpp.body, /Huey P\. Newton|Bobby Seale/);

  const skin = await drive('/movement?id=skinhead-subculture');
  assert.match(skin.body, /SHARP|Skinheads Against Racial Prejudice/);
  assert.match(skin.body, /1987|1986/);
  assert.match(skin.body, /Trojan/);

  const sd = await drive('/self-determination');
  assert.match(sd.body, /UN Charter/);
  assert.match(sd.body, /ICCPR|ICESCR/);
  assert.match(sd.body, /1514|1960/);

  const neo = await drive('/ideology?id=neoconservatism');
  assert.match(neo.body, /Irving Kristol/);
});

// ── 4. maxims complement (not duplicate) Law's legal maxims ────────────────────────────────────────
test('/maxims shows political/philosophical maxims and links Law without duplicating its terms', async () => {
  const res = await drive('/maxims');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Rousseau|Proudhon|Marx/);
  assert.ok(res.body.includes('/maxims'), 'links back to Law maxims');
  // guard against duplicating the legal-side terms that already live in knowledge/maxims/maxims.json
  const lawMaxims = JSON.parse(readFileSync(fileURLToPath(new URL('../../knowledge/maxims/maxims.json', import.meta.url)), 'utf8'));
  const lawTerms = new Set((lawMaxims.items || []).map((m) => m.term));
  for (const m of DATA.maxims) {
    assert.ok(!lawTerms.has(m.term), `maxim "${m.term}" duplicates a Law maxim`);
  }
});

// ── 5. soft-fail: empty and malformed corpora never throw / never 500 ─────────────────────────────
test('empty corpus renders empty-state pages, never a 500', async () => {
  __setData({ ideologies: [], movements: [], maxims: [], selfDetermination: null, spectrumNote: '' });
  try {
    for (const p of ['/', '/spectrum', '/self-determination', '/movements', '/maxims',
      '/ideology?id=liberalism', '/movement?id=black-panther-party']) {
      const res = await drive(p);
      assert.equal(res.statusCode, 200, `${p} soft-fails to 200`);
      assert.doesNotMatch(res.body, /error:/, `${p} is not an error page`);
    }
    // pure views tolerate an empty object too
    assert.match(spectrumView({}), /No ideologies/);
    assert.match(movementsView({}), /No movements/);
    assert.match(maximsView({}), /No maxims/);
    assert.match(selfDeterminationView({}), /No entry/);
    assert.equal(movementView({}, 'x').found, false);
  } finally {
    __setData(null);
  }
});

test('unknown path 302-redirects home', async () => {
  const res = await drive('/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── 6. escaping — no unescaped angle brackets injected via data ────────────────────────────────────
test('data is escaped on render (esc seam)', () => {
  __setData({ ideologies: [{ id: 'x', name: '<script>bad()</script>', summary: 'a & b "c"', tenets: ['<b>t</b>'], thinkers: [], criticisms: ['<i>crit</i>'] }] });
  try {
    const r = ideologyView(loadData(), 'x');
    assert.ok(!r.html.includes('<script>bad()'), 'script tag is escaped');
    assert.match(r.html, /&lt;script&gt;/);
    assert.match(r.html, /&amp;/);
  } finally {
    __setData(null);
  }
});

// ── 7. data integrity ─────────────────────────────────────────────────────────────────────────────
test('corpus has the operator-requested ideologies and movements', () => {
  const ids = new Set(DATA.ideologies.map((i) => i.id));
  for (const need of ['liberalism', 'neoliberalism', 'new-left', 'progressivism', 'conservatism',
    'neoconservatism', 'alt-right', 'libertarianism', 'socialism', 'anarchism']) {
    assert.ok(ids.has(need), `spectrum includes ${need}`);
  }
  const mids = new Set(DATA.movements.map((m) => m.id));
  for (const need of ['black-panther-party', 'punk-subculture', 'skinhead-subculture', 'self-determination-movements']) {
    assert.ok(mids.has(need), `movements include ${need}`);
  }
  // every ideology carries the four neutrality-critical fields
  for (const it of DATA.ideologies) {
    assert.ok(Array.isArray(it.tenets) && it.tenets.length, `${it.id} has tenets`);
    assert.ok(Array.isArray(it.thinkers) && it.thinkers.length, `${it.id} has thinkers`);
    assert.ok(it.arc, `${it.id} has an arc`);
    assert.ok(Array.isArray(it.criticisms) && it.criticisms.length, `${it.id} has criticisms`);
  }
});

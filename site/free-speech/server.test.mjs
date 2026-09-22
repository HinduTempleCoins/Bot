// server.test.mjs — offline tests for the Free Speech & Sedition surface (operator brief 2026-09-22).
// Fully offline: no network is ever touched (this surface reads a local public-domain JSON corpus). We
// drive the exported handler through a mock req/res (no port bound), assert every route serves 200 with
// escaped HTML, verify the load-bearing citations render (Brandenburg's two-prong test especially), and
// confirm the data seam soft-fails to empty-state cards when the corpus is missing — never throwing/500.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, homePage, firstAmendmentView, seditionView, surveillanceView, rightsView,
  freeSpeechLlmsTxt, loadData, __setData, esc,
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

// ── 1. routes serve 200 HTML ──────────────────────────────────────────────────────────────────────
test('home serves 200 and links every section', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Free Speech &amp; Sedition/);
  for (const sec of ['/first-amendment', '/sedition', '/surveillance', '/rights']) {
    assert.ok(res.body.includes(`href="${sec}"`), `home links ${sec}`);
  }
});

test('every content route serves 200 HTML', async () => {
  for (const p of ['/first-amendment', '/sedition', '/surveillance', '/rights']) {
    const res = await drive(p);
    assert.equal(res.statusCode, 200, `${p} → 200`);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.includes('<!doctype html>'), `${p} is a full page`);
  }
});

test('unknown path 302s to home', async () => {
  const res = await drive('/nope');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── 2. infra routes ────────────────────────────────────────────────────────────────────────────────
test('health/robots/sitemap/sitemap-index/llms respond', async () => {
  const h = await drive('/health');
  assert.equal(h.statusCode, 200); assert.equal(h.body, 'ok');
  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200); assert.match(r.body, /User-agent/i);
  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200); assert.match(s.body, /<urlset/);
  assert.ok(s.body.includes('/first-amendment'), 'sitemap lists a section');
  const si = await drive('/sitemap-index.xml');
  assert.equal(si.statusCode, 200); assert.match(si.body, /<sitemapindex/);
  const l = await drive('/llms.txt');
  assert.equal(l.statusCode, 200); assert.match(l.body, /Free Speech & Sedition/);
});

// ── 3. the load-bearing citations render (verified case law) ────────────────────────────────────────
test('Brandenburg test renders with BOTH prongs (the crux)', async () => {
  const res = await drive('/first-amendment');
  assert.match(res.body, /Brandenburg v\. Ohio/);
  assert.match(res.body, /395 U\.S\. 444/);
  assert.match(res.body, /imminent lawless action/i);
  assert.match(res.body, /likely to incite or produce/i);
});

test('first-amendment page shows the incitement evolution + unprotected categories', async () => {
  const res = await drive('/first-amendment');
  for (const c of ['Schenck', 'Dennis', 'Yates', 'Counterman', 'Chaplinsky', 'Miller', 'Sullivan']) {
    assert.ok(res.body.includes(c), `first-amendment names ${c}`);
  }
  assert.match(res.body, /Texas v\. Johnson/);
  assert.match(res.body, /Snyder v\. Phelps/);
});

test('first-amendment page shows true threats (Watts + Counterman) with cites', async () => {
  const res = await drive('/first-amendment');
  assert.match(res.body, /Watts v\. United States/);
  assert.match(res.body, /394 U\.S\. 705/);
  assert.match(res.body, /Counterman v\. Colorado/);
  assert.match(res.body, /600 U\.S\. 66/);
  assert.match(res.body, /recklessness/i);
});

test('first-amendment page shows advocacy/association (Hess + Claiborne) with cites', async () => {
  const res = await drive('/first-amendment');
  assert.match(res.body, /Hess v\. Indiana/);
  assert.match(res.body, /414 U\.S\. 105/);
  assert.match(res.body, /Claiborne Hardware/);
  assert.match(res.body, /458 U\.S\. 886/);
});

test('first-amendment page shows the Texas speech provision (art. I § 8)', async () => {
  const res = await drive('/first-amendment');
  assert.match(res.body, /Texas Constitution, art\. I, § 8/);
  assert.match(res.body, /liberty to speak, write or publish/);
});

test('sedition page shows 18 U.S.C. § 2384, the Smith Act, and the Jan-6 use', async () => {
  const res = await drive('/sedition');
  assert.ok(res.body.includes('2384'), 'names the seditious-conspiracy statute');
  assert.match(res.body, /Smith Act/);
  assert.match(res.body, /Alien and Sedition Acts/);
  assert.match(res.body, /Oath Keepers/);
  assert.match(res.body, /Proud Boys/);
  // the protected-vs-force line is the teaching point
  assert.match(res.body, /Protected advocacy|Protected dissent/);
  assert.match(res.body, /Criminal conspiracy/);
});

test('sedition page frames the right of revolution as political theory, not a legal defense', async () => {
  const res = await drive('/sedition');
  assert.match(res.body, /right of revolution/i);
  assert.match(res.body, /not a legal defense/i);
  // the founding/state texts are shown
  assert.match(res.body, /Declaration of Independence/);
  assert.match(res.body, /Texas Constitution, art\. I, § 2/);
  // and it explicitly notes seditious conspiracy is still a live crime
  assert.ok(res.body.includes('2384'), 'ties the note back to the live § 2384 crime');
  assert.match(res.body, /live crime/i);
});

test('surveillance page shows COINTELPRO, FISA, Snowden, panopticon + the chilling effect', async () => {
  const res = await drive('/surveillance');
  for (const t of ['COINTELPRO', 'FISA', 'Snowden', 'panopticon', 'chilling']) {
    assert.ok(res.body.toLowerCase().includes(t.toLowerCase()), `surveillance names ${t}`);
  }
});

test('rights page teaches the protected/independent-crime line', async () => {
  const res = await drive('/rights');
  assert.match(res.body, /protest/i);
  assert.match(res.body, /Brandenburg|imminent/i);
});

// ── 4. escaping + no advice claims ──────────────────────────────────────────────────────────────────
test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc('<b>"&"</b>'), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
});

test('every page carries the not-legal-advice discipline footer', async () => {
  for (const p of ['/', '/first-amendment', '/sedition', '/surveillance', '/rights']) {
    const res = await drive(p);
    assert.match(res.body, /not legal advice/i, `${p} carries the disclaimer`);
  }
});

// ── 5. two-voice / neutrality signalled ─────────────────────────────────────────────────────────────
test('home states the two-voice discipline explicitly', async () => {
  const res = await drive('/');
  assert.match(res.body, /two-voice|competing positions|does not tell you which side/i);
});

// ── 6. soft-fail: missing/short corpus → empty-state, never a throw or 500 ───────────────────────────
test('data seam soft-fails to empty-state when corpus is empty', async () => {
  __setData({}); // inject an empty corpus
  try {
    for (const p of ['/', '/first-amendment', '/sedition', '/surveillance', '/rights']) {
      const res = await drive(p);
      assert.equal(res.statusCode, 200, `${p} still 200 with empty corpus`);
      assert.ok(res.ended, `${p} responded`);
    }
    // the section pages should show an empty-state, not crash
    const fa = await drive('/first-amendment');
    assert.match(fa.body, /unavailable right now|First Amendment core doctrine/);
  } finally {
    __setData(null); // restore the real file-backed corpus
  }
});

test('data seam injection is honored by loadData()', () => {
  __setData({ meta: { summary: 'INJECTED-MARKER' } });
  try {
    assert.equal(loadData().meta.summary, 'INJECTED-MARKER');
  } finally {
    __setData(null);
  }
});

// ── 7. the real corpus is present and well-formed ───────────────────────────────────────────────────
test('the file-backed corpus loads with the expected top-level sections', () => {
  const d = loadData();
  for (const k of ['incitement', 'advocacy', 'trueThreats', 'categories', 'symbolic', 'stateSpeech', 'sedition', 'surveillance', 'knowYourRights']) {
    assert.ok(d[k] && typeof d[k] === 'object', `corpus has ${k}`);
  }
  // Brandenburg governing test is present with a quote
  assert.match(String(d.incitement.governingTest.quote), /imminent lawless action/);
  // the right-of-revolution material lives under sedition
  assert.ok(d.sedition.rightOfRevolution && typeof d.sedition.rightOfRevolution === 'object', 'sedition has rightOfRevolution');
});

// ── 8. pure views return strings even with no data ──────────────────────────────────────────────────
test('view functions never throw and return strings', () => {
  __setData({});
  try {
    for (const fn of [homePage, firstAmendmentView, seditionView, surveillanceView, rightsView, freeSpeechLlmsTxt]) {
      const out = fn();
      assert.equal(typeof out, 'string');
      assert.ok(out.length > 0);
    }
  } finally {
    __setData(null);
  }
});

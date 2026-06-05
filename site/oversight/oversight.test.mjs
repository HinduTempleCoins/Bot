// oversight.test.mjs — offline tests for Oversight.SoapBox, the "Who do I call?" consumer-protection
// directory portal. Fully offline: the directory module is a curated dataset, and the only live source
// (oversight.gov OIG reports) soft-fails to [] on any error — so without a network the /agency route
// still renders. We drive the exported handler through a mock req/res (no port bound) and assert: every
// route serves HTML, contact fields surface, the /file router routes correctly, the not-advice line and
// the disabled affiliate slot are present, and no admin/soapy surface ever leaks into the public site.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, agenciesView, agencyView, fileView, esc } from './server.mjs';
import { __setFetch as __setDirFetch } from '../../integrations/soapbox/oversight-directory.mjs';
import { invalidate } from '../../integrations/soapbox/cache.mjs';
import { before, after } from 'node:test';

// Keep the suite fully offline: the only live source (oversight.gov OIG reports via /agency) is fed a
// fetch that returns an empty result set, so the soft-fail path renders without any real network call.
before(() => { invalidate(); __setDirFetch(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })); });
after(() => { __setDirFetch(null); invalidate(); });

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

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
test('home: renders 200, category cards, search, state filter, footer', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  // the four category cards
  assert.match(b, /Federal Inspectors General/);
  assert.match(b, /Consumer Protection/);
  assert.match(b, /Ombudsman/);
  assert.match(b, /State Attorneys General/);
  // the where-to-file search + a state filter
  assert.match(b, /Where do I file\?/);
  assert.match(b, /<select class=q name="state"/);
  // facts-not-verdicts footer
  assert.match(b, /Facts, not verdicts/);
  assert.match(b, /not legal advice|never give legal advice/i);
});

// ── /agencies list ─────────────────────────────────────────────────────────────────────────────────
test('/agencies: lists offices with contact fields (phone/file-here/who-for)', async () => {
  const res = await drive('/agencies');
  assert.equal(res.statusCode, 200);
  const b = res.body;
  // contactBlock fields
  assert.match(b, /Who it's for:/);
  assert.match(b, /Phone:/);
  assert.match(b, /Email:/);
  assert.match(b, /Fax:/);
  assert.match(b, /File a complaint here/);
  // a couple of known offices
  assert.match(b, /Federal Trade Commission/);
  assert.match(b, /Consumer Financial Protection Bureau/);
});

test('/agencies?category=oig filters to Inspectors General', async () => {
  const res = await drive('/agencies?category=oig');
  assert.equal(res.statusCode, 200);
  const b = res.body;
  assert.match(b, /Office of Inspector General/);
  // a non-OIG office should not appear in an OIG-only list
  assert.doesNotMatch(b, /Federal Trade Commission \(FTC\)/);
  // filtered list is noindex
  assert.match(b, /noindex/);
});

test('/agencies?state=CA shows California AG plus federal offices', async () => {
  const res = await drive('/agencies?state=CA');
  assert.equal(res.statusCode, 200);
  const b = res.body;
  assert.match(b, /California Attorney General/);
  // federal offices serve every state, so the FTC stays in view
  assert.match(b, /Federal Trade Commission/);
  // another state's AG must NOT appear
  assert.doesNotMatch(b, /Texas Attorney General/);
});

test('agenciesView renders empty state for an impossible filter', () => {
  const b = agenciesView('oig', '', 'zzzznomatchzzzz');
  assert.match(b, /No offices matched/);
});

// ── /agency detail ──────────────────────────────────────────────────────────────────────────────────
test('/agency?id= renders full detail incl. all contact fields + findings section (soft-fail)', async () => {
  const res = await drive('/agency?id=ftc');
  assert.equal(res.statusCode, 200);
  const b = res.body;
  assert.match(b, /Federal Trade Commission/);
  assert.match(b, /Who it's for:/);
  assert.match(b, /File a complaint here/);
  // the oversight-findings section renders even when the live feed returns nothing
  assert.match(b, /oversight findings/i);
});

test('/agency with unknown id is a graceful not-found', async () => {
  const res = await drive('/agency?id=not-a-real-office');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /not found/i);
});

// ── /file router ──────────────────────────────────────────────────────────────────────────────────
test('/file routes a robocall complaint to the FTC', async () => {
  const res = await drive('/file?topic=robocall');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Federal Trade Commission/);
});

test('/file routes a denied insurance claim to the state insurance commissioners', async () => {
  const res = await drive('/file?topic=' + encodeURIComponent('insurance claim denied'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Insurance Commissioners|insurance department/i);
});

test('/file with a state biases toward that state AG', async () => {
  const res = await drive('/file?topic=' + encodeURIComponent('deceptive business') + '&state=NY');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /New York Attorney General/);
});

test('fileView with no input shows the prompt, no results block', () => {
  const b = fileView('', '');
  assert.match(b, /Where do I file a complaint\?/);
  assert.doesNotMatch(b, /Best matches for/);
});

// ── compliance: affiliate disabled + not-advice on every rendered surface ──────────────────────────
test('affiliate slot is disabled and the not-advice line is present', async () => {
  for (const path of ['/agencies', '/file?topic=scam', '/agency?id=cfpb']) {
    const res = await drive(path);
    assert.match(res.body, /data-affiliate-enabled="false"/, `${path} affiliate disabled`);
    assert.match(res.body, /facts, not legal advice|not a verdict/i, `${path} not-advice`);
  }
});

// ── infra routes ────────────────────────────────────────────────────────────────────────────────
test('health/robots/sitemap/llms respond', async () => {
  assert.equal((await drive('/health')).body, 'ok');
  assert.match((await drive('/robots.txt')).body, /User-agent|Sitemap/i);
  const sm = await drive('/sitemap.xml');
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset|<loc>/);
  assert.match((await drive('/llms.txt')).body, /SoapBox Oversight/);
});

test('unknown path redirects home', async () => {
  const res = await drive('/totally-unknown');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── SECURITY: no admin / soapy / internal surface ever leaks into this public site ─────────────────
test('no admin/soapy/internal surface appears on any public route', async () => {
  // Note: legitimate office names contain "administration" (e.g. Social Security Administration), so we
  // assert on the INTERNAL surfaces by their links/host, not on the bare substring "admin".
  const paths = ['/', '/agencies', '/agencies?category=consumer', '/file?topic=fraud', '/agency?id=ssa-oig'];
  for (const path of paths) {
    const b = (await drive(path)).body.toLowerCase();
    assert.ok(!/soapy/.test(b), `${path} must not mention soapy`);
    assert.ok(!/\/features\b/.test(b), `${path} must not expose the features catalog`);
    assert.ok(!/href="\/admin/.test(b), `${path} must not link to a local /admin path`);
    assert.ok(!/admin\.soapbox/.test(b), `${path} must not link to the admin host`);
  }
});

// ── view functions are pure-ish (esc applied) ───────────────────────────────────────────────────────
test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('homePage is a full HTML document', () => {
  const h = homePage();
  assert.match(h, /^<!doctype html>/i);
  assert.match(h, /<\/html>/);
});

test('agencyView is async and renders for a state AG office', async () => {
  const b = await agencyView('ag-tx');
  assert.match(b, /Texas Attorney General/);
  assert.match(b, /File a complaint here/);
});

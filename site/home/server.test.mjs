// server.test.mjs — offline tests for soapbox.community ROOT, the ecosystem HOME PAGE / FAMILY TREE.
// Fully offline: the SERVICES map is static and mainnetUrl()/resolve() are pure — no network. We drive the
// exported async handler through a mock req/res (no port bound) and assert: the page renders BOTH an Alpha
// family tree and a MainNet family tree laid out separately, each CENTERED on a SoapBox Community hub with
// the three chain families fanning out bilaterally (MELEK / PRANA / KULA) as wings; a known leaf (Akasha)
// shows its alpha URL clickable + its mainnet URL as "soon"; mainnetUrl() derives both domain shapes;
// esc() neutralizes injection; unknown route soft-404s.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, mainnetUrl, resolve, esc, SERVICES } from './server.mjs';

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

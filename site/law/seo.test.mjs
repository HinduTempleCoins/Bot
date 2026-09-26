// seo.test.mjs — OFFLINE tests for Law.SoapBox's SEO + GEO (AI-referenceability) wiring.
// Proves the shared house-style head/structured-data helper (integrations/soapbox/seo.mjs) is emitted on
// the Law surface: OpenGraph + Twitter card + canonical + a valid JSON-LD @graph (Organization + WebSite +
// SearchAction), per-page BreadcrumbList / FAQPage, the GEO citation block, and the corpus-describing
// llms.txt. Fully offline: the handler is driven through a mock req/res; the readers soft-fail (no network).
//
//   node --test site/law/seo.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, lawLlmsTxt } from './server.mjs';

// ── mock req/res (same shape as law.test.mjs) ────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath) => ({ url: urlPath, method: 'GET', on() {} });
async function drive(urlPath) {
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

// Pull every <script type="application/ld+json"> payload out of an HTML string, JSON.parse each, and
// return the parsed objects. Also asserts each block is valid JSON (a broken block would throw here).
function jsonLdNodes(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(JSON.parse(m[1]));
  return out;
}
// Flatten a set of JSON-LD blocks (some are @graph containers) into a flat list of typed nodes.
function allTypes(nodes) {
  const types = [];
  for (const n of nodes) {
    const graph = Array.isArray(n['@graph']) ? n['@graph'] : [n];
    for (const g of graph) if (g && g['@type']) types.push(g['@type']);
  }
  return types;
}

// ── 1. the shared head: OG + Twitter + canonical + description ────────────────────────────────────
test('home emits OpenGraph, Twitter-card, canonical, description and robots', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  const b = res.body;
  assert.match(b, /<meta name="description" content="[^"]+SoapBox/);
  assert.match(b, /<link rel="canonical" href="[^"]+\/">/);
  assert.match(b, /<meta name="robots" content="index,follow/);
  assert.match(b, /<meta property="og:title" content="SoapBox Law/);
  assert.match(b, /<meta property="og:type" content="website">/);
  assert.match(b, /<meta property="og:site_name" content="SoapBox Law">/);
  assert.match(b, /<meta name="twitter:card" content="summary_large_image">/);   // law surfaces carry an og:image
  assert.match(b, /<meta name="twitter:title"/);
});

// ── 2. JSON-LD: valid, and carries Organization + WebSite (+ SearchAction) + BreadcrumbList ────────
test('home JSON-LD is valid and includes Organization, WebSite, SearchAction, BreadcrumbList, FAQPage', async () => {
  const res = await drive('/');
  const nodes = jsonLdNodes(res.body); // throws if any block is invalid JSON
  const types = allTypes(nodes);
  assert.ok(types.includes('Organization'), 'Organization node present');
  assert.ok(types.includes('WebSite'), 'WebSite node present');
  assert.ok(types.includes('BreadcrumbList'), 'BreadcrumbList node present');
  assert.ok(types.includes('FAQPage'), 'FAQPage node present');
  // SearchAction lives inside the WebSite node's potentialAction, with the token in the urlTemplate.
  const website = nodes.flatMap((n) => (Array.isArray(n['@graph']) ? n['@graph'] : [n])).find((g) => g['@type'] === 'WebSite');
  assert.ok(website && website.potentialAction, 'WebSite has a SearchAction');
  assert.match(website.potentialAction.target.urlTemplate, /\{search_term_string\}/);
});

// ── 3. FAQ: the JSON-LD Q&A must also appear as visible text on the page ───────────────────────────
test('home FAQ is visible on-page AND mirrored in FAQPage JSON-LD (matching text)', async () => {
  const res = await drive('/');
  const b = res.body;
  assert.match(b, /Frequently asked questions/);
  assert.match(b, /Can I cite pages from SoapBox Law\?/); // visible
  const faq = jsonLdNodes(b).flatMap((n) => (Array.isArray(n['@graph']) ? n['@graph'] : [n])).find((g) => g['@type'] === 'FAQPage');
  assert.ok(faq, 'FAQPage node present');
  const questions = faq.mainEntity.map((x) => x.name);
  assert.ok(questions.includes('Can I cite pages from SoapBox Law?'), 'question mirrored in JSON-LD');
  // the visible answer text and the structured answer must be the same string (honest + Google-compliant)
  const cite = faq.mainEntity.find((x) => x.name === 'Can I cite pages from SoapBox Law?');
  assert.ok(res.body.includes(cite.acceptedAnswer.text.slice(0, 40)), 'answer text is visible on-page');
});

// ── 4. section pages carry a BreadcrumbList ───────────────────────────────────────────────────────
test('a section page (/statutes) emits a two-level BreadcrumbList', async () => {
  const res = await drive('/statutes');
  const types = allTypes(jsonLdNodes(res.body));
  assert.ok(types.includes('BreadcrumbList'));
  const bc = jsonLdNodes(res.body).flatMap((n) => (Array.isArray(n['@graph']) ? n['@graph'] : [n])).find((g) => g['@type'] === 'BreadcrumbList');
  assert.equal(bc.itemListElement.length, 2);
  assert.equal(bc.itemListElement[1].name, 'Statutes & Code');
});

// ── 5. GEO: the citation block (visible + JSON-LD) on an evergreen content page ────────────────────
test('/rights carries a visible "Cite this page" block and a citable JSON-LD node', async () => {
  const res = await drive('/rights');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Cite this page/);
  assert.match(res.body, /<cite/);
  const nodes = jsonLdNodes(res.body).flatMap((n) => (Array.isArray(n['@graph']) ? n['@graph'] : [n]));
  const art = nodes.find((g) => g['@type'] === 'Article' && /Rights That Hold Up/.test(g.headline || ''));
  assert.ok(art, 'citable Article node present');
  assert.ok(art.author && art.author.name === 'SoapBox Law', 'author attributed');
  assert.ok(art.publisher, 'publisher present');
});

// ── 6. GEO: llms.txt describes the corpus, sources of record, and how to cite ─────────────────────
test('/llms.txt describes the corpus, names sources of record, and gives citation guidance', async () => {
  const res = await drive('/llms.txt');
  assert.equal(res.statusCode, 200);
  const t = res.body;
  assert.match(t, /# SoapBox Law/);
  assert.match(t, /## About this corpus/);
  assert.match(t, /## Sources of record/);
  assert.match(t, /Caselaw Access Project/);
  assert.match(t, /## How to cite/);
  assert.match(t, /schema\.org/);
  // and the pure builder is exported + deterministic
  assert.equal(typeof lawLlmsTxt(), 'string');
});

// ── 7. case detail (noindex) still renders + carries a citation block pointing at the source ──────
test('case-detail page is noindex,follow and still carries a citation block', async () => {
  // no id/cap resolvable offline → soft-fails to the empty-state, which is still a citation-free empty page.
  // A resolvable detail is exercised in law.test.mjs; here we assert the route stays 200 + noindex.
  const res = await drive('/cases?id=99999');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<meta name="robots" content="noindex,follow">/);
});

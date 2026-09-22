// server.test.mjs — offline tests for the Legal Lexicon & Sources of Authority surface. Fully offline:
// the surface reads a local JSON corpus and renders static teaching pages, so no network is touched. We
// drive the exported handler through a mock req/res (no port bound) and assert: every route serves 200,
// the verified authorities appear with their correct citations, the glossary search + detail work, the
// directory links are present, esc() escapes, and health/robots/sitemap/llms respond. Charter §3: the
// citations are asserted VERBATIM so a regression that corrupts a citation fails the build.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, homePage, dictionariesPage, foundingEraPage, commonLawPage, persuasivePage, receptionPage,
  federalistPage, sovereignCitizenPage, glossaryView, directoryPage, lexiconLlmsTxt,
  esc, LEXICON, DICTIONARIES, COUNTRY_GLOSSARIES,
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

// ── 1. routes serve 200 ─────────────────────────────────────────────────────────────────────────
test('all content routes serve 200 HTML', async () => {
  for (const p of ['/', '/dictionaries', '/founding-era', '/common-law', '/persuasive', '/reception',
    '/federalist', '/sovereign-citizen', '/glossary', '/directory']) {
    const res = await drive(p);
    assert.equal(res.statusCode, 200, `${p} serves 200`);
    assert.match(res.body, /<!doctype html>/i, `${p} is HTML`);
    assert.match(res.body, /Legal Lexicon/, `${p} carries the brand`);
  }
});

test('home lists every section and the search box', async () => {
  const res = await drive('/');
  for (const sec of ['/dictionaries', '/founding-era', '/common-law', '/persuasive', '/reception',
    '/federalist', '/glossary', '/directory', '/sovereign-citizen']) {
    assert.ok(res.body.includes(`href="${sec}"`), `home links ${sec}`);
  }
  assert.match(res.body, /action="\/glossary"/);
});

// ── 2. VERIFIED citations appear verbatim (accuracy is the product — Charter §3) ───────────────────
test('common-law page states Erie and NFIB exactly right', async () => {
  const res = await drive('/common-law');
  assert.match(res.body, /Erie Railroad Co\. v\. Tompkins, 304 U\.S\. 64 \(1938\)/);
  assert.match(res.body, /no federal general common law/i);
  assert.match(res.body, /Brandeis/);
  assert.match(res.body, /Swift v\. Tyson/);
  // NFIB — taxing power, not commerce; correct citation + year
  assert.match(res.body, /National Federation of Independent Business v\. Sebelius, 567 U\.S\. 519 \(2012\)/);
  assert.match(res.body, /taxing power/i);
  // federal-common-law enclaves are taught (not just "no federal common law")
  assert.match(res.body, /enclave/i);
  assert.match(res.body, /admiralty/i);
});

test('common-law page: ad coelum maxim + Causby, and Scalia’s Jones/Jardines trespass revival', async () => {
  const res = await drive('/common-law');
  // the ad coelum maxim (Latin + gloss), attributed to Blackstone
  assert.match(res.body, /Cuius est solum, eius est usque ad coelum et ad inferos/);
  assert.match(res.body, /ad coelum/);
  assert.match(res.body, /Blackstone/);
  // Causby cabins the maxim — verbatim cite + the "no place in the modern world" language + Douglas
  assert.match(res.body, /United States v\. Causby, 328 U\.S\. 256/);
  assert.match(res.body, /has no place in the modern world/);
  assert.match(res.body, /Douglas/);
  // Scalia's common-law-property revival — verbatim cites + Scalia + trespass on an "effect" / curtilage
  assert.match(res.body, /United States v\. Jones, 565 U\.S\. 400 \(2012\)/);
  assert.match(res.body, /Florida v\. Jardines, 569 U\.S\. 1 \(2013\)/);
  assert.match(res.body, /Scalia/);
  assert.match(res.body, /curtilage/);
  assert.match(res.body, /trespass/i);
  // honest finding: we do NOT claim Scalia expressly invoked ad coelum
  assert.match(res.body, /do not expressly[\s]+invoke the <i>ad coelum<\/i> maxim/i);
});

test('persuasive page states M’Naghten exactly right', async () => {
  const res = await drive('/persuasive');
  assert.match(res.body, /M.Naghten.s Case, 8 Eng\. Rep\. 718,\s+10 Cl\. &amp; Fin\. 200 \(H\.L\. 1843\)/);
  assert.match(res.body, /House of Lords/);
  assert.match(res.body, /binding/i);
  assert.match(res.body, /persuasive/i);
});

test('reception page states De Longchamps exactly right', async () => {
  const res = await drive('/reception');
  assert.match(res.body, /Respublica v\. De Longchamps, 1 U\.S\. \(1 Dall\.\) 111 \(1784\)/);
  assert.match(res.body, /Pennsylvania/);
  assert.match(res.body, /law of nations/i);
  assert.match(res.body, /reception statute/i);
});

test('founding-era page cites Heller and founding-era dictionaries', async () => {
  const res = await drive('/founding-era');
  assert.match(res.body, /District of Columbia v\. Heller, 554 U\.S\. 570 \(2008\)/);
  assert.match(res.body, /Samuel Johnson.s Dictionary of the English Language \(1755\)/);
  assert.match(res.body, /Noah Webster/);
  assert.match(res.body, /\(1828\)/);
  assert.match(res.body, /original public meaning/i);
});

test('dictionaries page states the correct editions', async () => {
  const res = await drive('/dictionaries');
  assert.match(res.body, /Black.s Law Dictionary/);
  assert.match(res.body, /1891/);
  assert.match(res.body, /Henry Campbell Black/);
  assert.match(res.body, /Bryan A\. Garner/);
  assert.match(res.body, /Bouvier.s Law Dictionary/);
  assert.match(res.body, /1839/);
  assert.match(res.body, /John Bouvier/);
  assert.match(res.body, /1755/);
});

test('federalist page states 85 essays, Publius, 1787-1788, and how to cite', async () => {
  const res = await drive('/federalist');
  assert.match(res.body, /85 essays/);
  assert.match(res.body, /1787.1788/);
  assert.match(res.body, /Publius/);
  assert.match(res.body, /Hamilton/);
  assert.match(res.body, /Madison/);
  assert.match(res.body, /Jay/);
  assert.match(res.body, /Anti-Federalist/);
  assert.match(res.body, /persuasive/i);
});

// ── 3. glossary: browse, search, detail ───────────────────────────────────────────────────────────
test('glossary browse lists all terms with the term count', async () => {
  const res = await drive('/glossary');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, new RegExp(`${LEXICON.terms.length} terms`));
  // a few representative terms present
  assert.match(res.body, /Common law/);
  assert.match(res.body, /Due process/);
  assert.match(res.body, /Original public meaning/);
});

test('glossary search filters and is noindex', async () => {
  const res = await drive('/glossary?q=common');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /matching/);
  assert.match(res.body, /Common law/);
  assert.match(res.body, /content="noindex,follow"/);
});

test('glossary search with no matches soft-fails to an empty state', async () => {
  const res = await drive('/glossary?q=zzzznotarealterm');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No terms match/);
});

test('glossary detail (?term=) renders one term with sources', async () => {
  const res = await drive('/glossary?term=common-law');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Common law/);
  assert.match(res.body, /Technical:/);
  assert.match(res.body, /Sources:/);
  assert.match(res.body, /Erie/);
});

test('glossary detail for an unknown slug falls back to the full list (200)', async () => {
  const res = await drive('/glossary?term=not-a-real-slug');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, new RegExp(`${LEXICON.terms.length} terms`));
});

// ── 4. directory: dictionaries + per-country glossaries, links present ─────────────────────────────
test('directory renders core dictionaries and per-country glossaries', async () => {
  const res = await drive('/directory');
  assert.equal(res.statusCode, 200);
  // public-domain hosted copies
  assert.match(res.body, /archive\.org\/details\/bouvierlawdictionary01/);
  assert.match(res.body, /archive\.org\/details\/johnsons_dictionary_1755/);
  // per-country official sources
  assert.match(res.body, /laws-lois\.justice\.gc\.ca\/eng\/glossary/); // Canada
  assert.match(res.body, /justice\.gov\.uk/);                          // UK
  assert.match(res.body, /fedcourt\.gov\.au/);                         // Australia
  assert.match(res.body, /eur-lex\.europa\.eu/);                       // EU
  assert.match(res.body, /nyaaya\.org\/glossary/);                     // India
  // countries covered
  for (const c of ['United States', 'United Kingdom', 'Canada', 'Australia', 'India', 'European Union']) {
    assert.ok(res.body.includes(c), `directory covers ${c}`);
  }
});

// ── 5. health / robots / sitemap / llms ───────────────────────────────────────────────────────────
test('health returns JSON with the term count', async () => {
  const res = await drive('/health');
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.service, 'lexicon');
  assert.equal(j.terms, LEXICON.terms.length);
});

test('robots.txt and sitemap.xml serve', async () => {
  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /User-agent:/);
  assert.match(r.body, /Sitemap:/);
  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/);
  assert.match(s.body, /\/glossary/);
});

test('llms.txt names the verified authorities', async () => {
  const res = await drive('/llms.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Erie R\.R\. Co\. v\. Tompkins, 304 U\.S\. 64 \(1938\)/);
  assert.match(res.body, /NFIB v\. Sebelius, 567 U\.S\. 519 \(2012\)/);
  assert.match(res.body, /Heller, 554 U\.S\. 570 \(2008\)/);
});

// ── 6. escaping + soft-fail + 404 ─────────────────────────────────────────────────────────────────
test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(esc(null), '');
});

test('a query value is escaped into the search box (no injection)', async () => {
  const res = await drive('/glossary?q=' + encodeURIComponent('<script>x</script>'));
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('<script>x</script>'), 'raw script tag must not appear');
  assert.match(res.body, /&lt;script&gt;/);
});

test('unknown path 404s with a recoverable page', async () => {
  const res = await drive('/nope');
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /Not found/);
  assert.match(res.body, /content="noindex,follow"/);
});

// ── 7. corpus integrity ───────────────────────────────────────────────────────────────────────────
test('every lexicon term has a plain + technical definition and at least one source', () => {
  assert.ok(LEXICON.terms.length >= 40, 'starter set is 40+ terms');
  for (const t of LEXICON.terms) {
    assert.ok(t.term && t.slug, `term has name+slug: ${t.slug}`);
    assert.ok(t.plain && t.plain.length > 10, `plain def present: ${t.slug}`);
    assert.ok(t.technical && t.technical.length > 10, `technical def present: ${t.slug}`);
    assert.ok(Array.isArray(t.sources) && t.sources.length >= 1, `sourced: ${t.slug}`);
    assert.ok(t.sources.every((s) => s && s.name), `each source named: ${t.slug}`);
  }
});

test('pure view functions return HTML strings without a req/res', () => {
  for (const fn of [homePage, dictionariesPage, foundingEraPage, commonLawPage, persuasivePage,
    receptionPage, federalistPage, sovereignCitizenPage, directoryPage]) {
    const html = fn();
    assert.match(html, /<!doctype html>/i, `${fn.name} returns a document`);
  }
  assert.match(glossaryView('', ''), /American Legal Lexicon/);
  assert.match(lexiconLlmsTxt(), /MELEK Legal Lexicon/);
  assert.ok(DICTIONARIES.length >= 3 && COUNTRY_GLOSSARIES.length >= 5);
});

test('every page shows an "Act on this" CTA linking our own tools first', async () => {
  const html = (await drive('/')).body;
  assert.match(html, /Act on this/);
  assert.match(html, /href="https:\/\/law\.soapbox\.community\/lawyers"/);
  assert.match(html, /href="https:\/\/law\.soapbox\.community\/appeals"/);
});

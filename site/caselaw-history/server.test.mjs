// server.test.mjs — offline tests for the caselaw-history surface ("The Case Law of Us"). Fully
// offline: no port bound, no network. We inject a data fixture via __setData(), drive the exported
// handler through a mock req/res, and assert: routes serve 200, HTML is escaped, entries render with
// their verified citation/figure prose, era grouping works, distinct cases are NOT merged (Lukumi vs.
// O Centro), the real data file parses and carries the three parts, and health/robots/sitemap/llms
// respond. Also asserts the surface soft-fails to an empty state when the data is missing (never throws).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { handler, homePage, loadData, caselawLlmsTxt, esc, __setData } from './server.mjs';

// ── mock req/res ────────────────────────────────────────────────────────────────────────────────
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

// ── a small, self-contained data fixture (with an HTML-injection probe in a field) ────────────────
const FIXTURE = {
  title: 'The Case Law of Us',
  summary: 'The reporters are a history of this country.',
  verified_date: '2026-09-22',
  parts: [
    {
      id: 'figures', nav: 'Figures', title: 'Figures who live in the caselaw',
      intro: 'American history told through the people who became parties.',
      era_blurbs: { 'Civil Rights Movement': 'The movement in the reporters.' },
      entries: [
        {
          case: 'Hampton v. Hanrahan', citation: '600 F.2d 600', year: '1979',
          figure: 'Fred Hampton <script>', era: 'Civil Rights Movement',
          what_happened: 'Civil suit over the 1969 Chicago police raid that killed Fred Hampton.',
          why_it_matters: 'The COINTELPRO record entered the reporters.',
          source_url: 'https://example.org/hampton',
        },
        {
          case: 'The Spicer Hearing', citation: 'preliminary examination, Tombstone (1881) — not a reported opinion',
          year: '1881', figure: 'Wyatt Earp and Doc Holliday', era: 'The Frontier / Old West',
          what_happened: 'The O.K. Corral preliminary hearing before Justice Wells Spicer.',
          why_it_matters: 'A hearing, not a reported opinion.',
          source_url: 'https://example.org/spicer',
        },
      ],
    },
    {
      id: 'courts-as-historians', nav: 'Courts as historians', title: 'Courts doing history',
      intro: 'Opinions that excavate history.',
      entries: [
        {
          case: 'Church of the Lukumi Babalu Aye v. City of Hialeah', citation: '508 U.S. 520', year: '1993',
          figure: 'Santería practitioners', era: 'Free Exercise',
          what_happened: 'Ordinances targeting Santería animal sacrifice struck down.',
          why_it_matters: 'The Court examined the history of Santería animal sacrifice.',
          source_url: 'https://example.org/lukumi',
        },
        {
          case: 'Gonzales v. O Centro Espírita Beneficente União do Vegetal', citation: '546 U.S. 418', year: '2006',
          figure: 'UDV', era: 'Free Exercise',
          what_happened: 'RFRA protected sacramental ayahuasca (hoasca) tea.',
          why_it_matters: 'The ayahuasca/RFRA case — distinct from the animal-sacrifice case.',
          source_url: 'https://example.org/ocentro',
        },
      ],
    },
    {
      id: 'ancient', nav: 'Ancient roots', title: 'Ancient societies',
      intro: 'The deep root of written law.',
      entries: [
        {
          case: 'Code of Hammurabi', citation: 'c. 1754 BC', year: 'c. 1754 BC',
          figure: 'Hammurabi of Babylon', era: 'Mesopotamia',
          what_happened: '282 laws on a diorite stele.',
          why_it_matters: 'Written law with scaled punishments.',
          source_url: 'https://example.org/hammurabi',
        },
      ],
    },
  ],
};

// ── 1. home route serves 200 HTML with all three parts ────────────────────────────────────────────
test('home route serves 200 HTML with the three part anchors', async () => {
  __setData(FIXTURE);
  const res = await drive('/');
  __setData(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /The Case Law of Us/);
  for (const id of ['figures', 'courts-as-historians', 'ancient']) {
    assert.ok(res.body.includes(`id="${id}"`), `renders part #${id}`);
    assert.ok(res.body.includes(`href="#${id}"`), `TOC links #${id}`);
  }
});

// ── 2. entries render with citation, figure, prose ────────────────────────────────────────────────
test('entries render case name, citation badge, figure, and prose', async () => {
  __setData(FIXTURE);
  const html = homePage();
  __setData(null);
  assert.match(html, /Hampton v\. Hanrahan/);
  assert.match(html, /600 F\.2d 600/);
  assert.match(html, /1969 Chicago police raid/);
  assert.match(html, /Why it lives in the reporters/);
});

// ── 3. HTML is escaped (no injection from a data field) ───────────────────────────────────────────
test('data fields are HTML-escaped', async () => {
  __setData(FIXTURE);
  const html = homePage();
  __setData(null);
  assert.ok(!html.includes('Fred Hampton <script>'), 'raw script text must not appear');
  assert.ok(html.includes('Fred Hampton &lt;script&gt;'), 'the field is escaped');
});

// ── 4. era grouping renders the era headers + blurb ───────────────────────────────────────────────
test('entries are grouped by era with headers', async () => {
  __setData(FIXTURE);
  const html = homePage();
  __setData(null);
  assert.match(html, /Civil Rights Movement/);
  assert.match(html, /The Frontier \/ Old West/);
  assert.match(html, /The movement in the reporters\./); // the era blurb
});

// ── 5. distinct cases are NOT merged — Lukumi (animal sacrifice) vs O Centro (ayahuasca) ───────────
test('Lukumi and O Centro are presented as distinct cases (never merged)', async () => {
  __setData(FIXTURE);
  const html = homePage();
  __setData(null);
  assert.match(html, /Lukumi Babalu Aye v\. City of Hialeah/);
  assert.match(html, /508 U\.S\. 520/);
  assert.match(html, /animal sacrifice/);
  assert.match(html, /O Centro Espírita/);
  assert.match(html, /546 U\.S\. 418/);
  assert.match(html, /ayahuasca/);
});

// ── 6. reporter opinions get a SoapBox Law cross-link; a hearing/trial descriptor does NOT ─────────
test('a reporter citation gets a /cases cross-link; a hearing descriptor does not', async () => {
  __setData(FIXTURE);
  const html = homePage();
  __setData(null);
  assert.ok(html.includes('/cases?q=600%20F.2d%20600'), 'reporter cite → law cross-link');
  // the Spicer hearing descriptor is not a resolvable citation → no /cases link for it
  assert.ok(!html.includes('/cases?q=preliminary'), 'a hearing descriptor is not linked to /cases');
});

// ── 7. soft-fail: no data → empty state, still 200, never throws ──────────────────────────────────
test('missing data soft-fails to an empty state (never throws, still 200)', async () => {
  __setData({ parts: [] });
  const res = await drive('/');
  __setData(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /being assembled|No entries/i);
});

// ── 8. infra routes ───────────────────────────────────────────────────────────────────────────────
test('/health returns ok JSON', async () => {
  const res = await drive('/health');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"ok":true/);
});
test('/robots.txt serves text', async () => {
  const res = await drive('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
});
test('/sitemap.xml and /sitemap-index.xml serve XML', async () => {
  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/);
  const i = await drive('/sitemap-index.xml');
  assert.equal(i.statusCode, 200);
  assert.match(i.body, /<sitemapindex/);
});
test('/llms.txt describes the corpus', async () => {
  __setData(FIXTURE);
  const res = await drive('/llms.txt');
  __setData(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /About this corpus/);
  assert.match(res.body, /Facts, not verdicts/);
});

// ── 9. unknown path soft-fails to the home body with 404 ──────────────────────────────────────────
test('unknown path returns 404 but renders the page (never a stack)', async () => {
  __setData(FIXTURE);
  const res = await drive('/does-not-exist');
  __setData(null);
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /The Case Law of Us/);
});

// ── 10. the REAL data file parses, has three parts, and every entry has the required fields ────────
test('the shipped caselaw-as-history.json parses and is well-formed', () => {
  const p = fileURLToPath(new URL('../../knowledge/legal/caselaw-as-history.json', import.meta.url));
  const j = JSON.parse(readFileSync(p, 'utf8'));
  assert.ok(Array.isArray(j.parts) && j.parts.length === 3, 'has three parts');
  let total = 0;
  const seen = new Set();
  for (const part of j.parts) {
    assert.ok(part.id && part.title, 'part has id + title');
    assert.ok(Array.isArray(part.entries) && part.entries.length, `part ${part.id} has entries`);
    for (const e of part.entries) {
      total += 1;
      for (const f of ['case', 'citation', 'year', 'figure', 'era', 'what_happened', 'why_it_matters', 'source_url']) {
        assert.ok(e[f] != null && String(e[f]).length, `entry "${e.case}" has ${f}`);
      }
      assert.ok(/^https?:\/\//.test(e.source_url), `entry "${e.case}" has a real source_url`);
      const key = `${e.case}|${e.citation}`;
      assert.ok(!seen.has(key), `no duplicate entry: ${key}`);
      seen.add(key);
    }
  }
  assert.ok(total >= 30, `corpus has a large set (got ${total})`);
});

// ── 11. loadData() reads the file when no override is set ──────────────────────────────────────────
test('loadData reads the shipped corpus by default', () => {
  __setData(null);
  const j = loadData();
  assert.ok(Array.isArray(j.parts) && j.parts.length === 3);
});

// ── 12. the corpus keeps Lukumi and O Centro as separate, correctly-described entries ──────────────
test('shipped corpus does not merge Lukumi (animal sacrifice) and O Centro (ayahuasca)', () => {
  __setData(null);
  const j = loadData();
  const all = j.parts.flatMap((p) => p.entries);
  const lukumi = all.find((e) => /Lukumi/.test(e.case));
  const ocentro = all.find((e) => /O Centro/.test(e.case));
  assert.ok(lukumi && /508 U\.S\. 520/.test(lukumi.citation), 'Lukumi present at 508 U.S. 520');
  assert.ok(ocentro && /546 U\.S\. 418/.test(ocentro.citation), 'O Centro present at 546 U.S. 418');
  assert.match(`${lukumi.what_happened} ${lukumi.why_it_matters}`, /animal sacrifice|Santería|Santeria/);
  assert.match(`${ocentro.what_happened} ${ocentro.why_it_matters}`, /ayahuasca|hoasca/);
});

test('every page shows an "Act on this" CTA linking our own tools first', async () => {
  const html = (await drive('/')).body;
  assert.match(html, /Act on this/);
  assert.match(html, /href="https:\/\/law\.soapbox\.community\/lawyers"/);
  assert.match(html, /href="https:\/\/law\.soapbox\.community\/appeals"/);
});

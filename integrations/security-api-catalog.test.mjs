// security-api-catalog.test.mjs — offline, deterministic. Run: node --test integrations/security-api-catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECURITY_APIS, AI_REVIEW_APIS, ACCESS, CATEGORIES, AI_CATEGORIES,
  byCategory, keyless, find, forResourceCenter, summary, renderCatalog,
} from './security-api-catalog.mjs';

const REQUIRED = ['id', 'name', 'category', 'url', 'access'];

function assertEntryShape(e, validCategories) {
  for (const f of REQUIRED) {
    assert.ok(typeof e[f] === 'string' && e[f].length > 0, `entry ${e.id || '?'} missing/empty field: ${f}`);
  }
  assert.ok(ACCESS.includes(e.access), `entry ${e.id} has invalid access: ${e.access}`);
  assert.ok(/^https?:\/\//.test(e.url), `entry ${e.id} url should be http(s): ${e.url}`);
  if (validCategories) assert.ok(validCategories.includes(e.category), `entry ${e.id} unknown category: ${e.category}`);
  // keyEnv, when present, is a NAME only — uppercase-ish env style, never a value/secret.
  if ('keyEnv' in e && e.keyEnv != null) {
    assert.ok(typeof e.keyEnv === 'string' && /^[A-Z0-9_]+$/.test(e.keyEnv), `entry ${e.id} keyEnv must be an ENV NAME: ${e.keyEnv}`);
  }
}

test('SECURITY_APIS has 50+ entries, each well-formed with a valid access value', () => {
  assert.ok(SECURITY_APIS.length >= 50, `expected >=50 security APIs, got ${SECURITY_APIS.length}`);
  for (const e of SECURITY_APIS) assertEntryShape(e, CATEGORIES);
});

test('SECURITY_APIS ids are unique', () => {
  const ids = SECURITY_APIS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate security ids');
});

test('SECURITY_APIS covers the named threat-intel / vuln / TLS staples', () => {
  const ids = new Set(SECURITY_APIS.map((e) => e.id));
  for (const id of ['virustotal', 'abuseipdb', 'otx', 'urlhaus', 'phishtank', 'shodan', 'greynoise', 'hibp', 'nvd', 'osv', 'github-advisory', 'snyk', 'ssllabs', 'mozilla-observatory', 'securityheaders']) {
    assert.ok(ids.has(id), `missing expected security API: ${id}`);
  }
});

test('AI_REVIEW_APIS is present and well-formed', () => {
  assert.ok(Array.isArray(AI_REVIEW_APIS) && AI_REVIEW_APIS.length >= 5, 'expected AI review APIs');
  for (const e of AI_REVIEW_APIS) assertEntryShape(e, AI_CATEGORIES);
  const ids = AI_REVIEW_APIS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate AI-review ids');
});

test('byCategory groups entries by their category', () => {
  const g = byCategory(SECURITY_APIS);
  assert.ok(typeof g === 'object' && g !== null);
  // every grouped entry actually belongs to its bucket
  for (const [cat, arr] of Object.entries(g)) {
    assert.ok(Array.isArray(arr) && arr.length > 0);
    for (const e of arr) assert.equal(e.category, cat);
  }
  // total grouped == total entries
  const grouped = Object.values(g).reduce((n, arr) => n + arr.length, 0);
  assert.equal(grouped, SECURITY_APIS.length);
  // AI list groups too
  assert.ok(Object.keys(byCategory(AI_REVIEW_APIS)).length >= 1);
});

test('keyless filters to open (no-key) entries only', () => {
  const k = keyless(SECURITY_APIS);
  assert.ok(k.length > 0, 'expected some keyless security APIs');
  // keyless == callable with no key (access 'open'). An open entry MAY still carry an optional
  // rate-lifting key (e.g. NVD), so we only assert the access value here.
  for (const e of k) assert.equal(e.access, 'open');
  // it is a strict subset
  assert.ok(k.length < SECURITY_APIS.length);
});

test('find returns an entry across both catalogs, null on miss', () => {
  assert.equal(find('virustotal').name, 'VirusTotal API v3');
  assert.equal(find('groq').category, 'LLM Gateway (free tier)'); // from the AI list
  assert.equal(find('does-not-exist'), null);
  assert.equal(find(), null);
});

test('forResourceCenter yields the adapter ingest shape for every entry', () => {
  const rows = forResourceCenter();
  assert.equal(rows.length, SECURITY_APIS.length + AI_REVIEW_APIS.length);
  for (const r of rows) {
    for (const f of ['id', 'title', 'kind', 'category', 'url', 'access']) {
      assert.ok(typeof r[f] === 'string' && r[f].length > 0, `adapter row missing ${f}`);
    }
    assert.ok(['security-api', 'ai-review-api'].includes(r.kind));
    assert.equal(typeof r.keyless, 'boolean');
    assert.equal(r.keyless, r.access === 'open');
    assert.ok('keyEnv' in r && 'description' in r);
  }
  // kinds split correctly
  assert.equal(rows.filter((r) => r.kind === 'security-api').length, SECURITY_APIS.length);
  assert.equal(rows.filter((r) => r.kind === 'ai-review-api').length, AI_REVIEW_APIS.length);
});

test('summary counts totals, categories, and access correctly', () => {
  const s = summary();
  assert.equal(s.security.total, SECURITY_APIS.length);
  assert.equal(s.aiReview.total, AI_REVIEW_APIS.length);
  assert.equal(s.total, SECURITY_APIS.length + AI_REVIEW_APIS.length);
  // access counts sum to the total for each list
  const sumAccess = (o) => o.open + o.freemium + o.key;
  assert.equal(sumAccess(s.security.byAccess), SECURITY_APIS.length);
  assert.equal(sumAccess(s.aiReview.byAccess), AI_REVIEW_APIS.length);
  // category counts sum to the total
  const sumCat = (o) => Object.values(o).reduce((n, v) => n + v, 0);
  assert.equal(sumCat(s.security.byCategory), SECURITY_APIS.length);
});

test('renderCatalog escapes HTML and never injects markup', () => {
  const evil = [{ id: 'x', name: '<script>alert(1)</script>', category: 'Threat & "Intel"', url: 'https://e.com/?a=1&b=2', access: 'open', note: "it's <b>bad</b>" }];
  const html = renderCatalog(evil, 'html');
  assert.ok(!html.includes('<script>'), 'must escape <script>');
  assert.ok(html.includes('&lt;script&gt;'), 'expected escaped script tag');
  assert.ok(html.includes('&amp;'), 'expected escaped ampersand');
  assert.ok(html.includes('&quot;') || html.includes('&#39;'), 'expected escaped quotes');
  // a real render produces a table with one row per entry
  const full = renderCatalog(SECURITY_APIS, 'html');
  assert.ok(full.startsWith('<table'));
  assert.equal((full.match(/<tr>/g) || []).length, SECURITY_APIS.length + 1); // +1 header row

  // markdown form
  const md = renderCatalog(evil, 'md');
  assert.ok(md.includes('| Name |'));
  assert.ok(!md.includes('<script>'));
});

test('accessors soft-fail on bad input', () => {
  assert.deepEqual(byCategory(null), {});
  assert.deepEqual(keyless(null), []);
  assert.deepEqual(keyless(42), []);
  assert.equal(renderCatalog(null, 'html').includes('<table'), true);
});

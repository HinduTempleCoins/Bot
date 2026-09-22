// soapcalc.test.mjs — OFFLINE tests for the SoapBox Soap Calculator: the pure engine (soapcalc.mjs)
// AND the server handler (server.mjs, driven with a mock req/res; no port bound, no network).
//
// The flagship assertion is a KNOWN-RECIPE check: a pure coconut-oil recipe at 0% superfat must return
// lye = weight × SAP exactly (this is the definition of the SAP value), which proves the whole pipeline.
// Getting this number right is what keeps a bar from being caustic — so it is tested, not assumed.

import { test } from 'node:test';
import assert from 'node:assert';
import { calculate, OILS, KOH_FACTOR, SAFETY_NOTE } from './soapcalc.mjs';
import { handler, calculatorPage, recipeFromQuery, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

const approx = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// ── the engine ───────────────────────────────────────────────────────────────────────────────────────
test('KNOWN RECIPE: coconut oil at 0% superfat → lye = weight × SAP (NaOH)', () => {
  const r = calculate({ oils: [{ id: 'coconut', weight: 1000 }], lyeType: 'NaOH', superfat: 0, waterRatio: 2 });
  assert.ok(r.ok);
  const expected = 1000 * OILS.coconut.sap;            // 1000 × 0.183 = 183 g
  assert.ok(approx(r.lye, expected, 0.01), `lye ${r.lye} should equal ${expected}`);
  assert.equal(r.lye, 183);                             // exact, with the DB SAP of 0.183
  assert.equal(r.totalOil, 1000);
  assert.equal(r.water, r.lye * 2);                     // water:lye ratio of 2
});

test('superfat reduces lye by exactly the discount %', () => {
  const full = calculate({ oils: [{ id: 'coconut', weight: 1000 }], superfat: 0 });
  const sf5 = calculate({ oils: [{ id: 'coconut', weight: 1000 }], superfat: 5 });
  assert.ok(approx(sf5.lye, full.lye * 0.95, 0.01), '5% superfat = 95% of full lye');
});

test('KOH needs ~1.403× the NaOH lye for the same oil', () => {
  const naoh = calculate({ oils: [{ id: 'olive', weight: 500 }], lyeType: 'NaOH', superfat: 0 });
  const koh = calculate({ oils: [{ id: 'olive', weight: 500 }], lyeType: 'KOH', superfat: 0, kohPurity: 100 });
  assert.ok(approx(koh.lye / naoh.lye, KOH_FACTOR, 0.001), `ratio ${koh.lye / naoh.lye} ≈ ${KOH_FACTOR}`);
});

test('KOH purity raises the amount to actually weigh (90% purity → /0.9)', () => {
  const koh = calculate({ oils: [{ id: 'coconut', weight: 1000 }], lyeType: 'KOH', superfat: 0, kohPurity: 90 });
  assert.ok(approx(koh.lyeToWeigh, koh.lye / 0.9, 0.02), 'weigh-amount is purity-adjusted');
  assert.equal(koh.kohPurity, 90);
});

test('multi-oil recipe sums per-oil lye and the percentages are correct', () => {
  const r = calculate({ oils: [{ id: 'olive', weight: 500 }, { id: 'coconut', weight: 300 }, { id: 'palm', weight: 200 }], superfat: 0 });
  const sum = r.perOil.reduce((s, p) => s + p.lye, 0);
  assert.ok(approx(sum, r.lye, 0.05), 'sum of per-oil lye ≈ total lye at 0% superfat');
  assert.equal(r.totalOil, 1000);
  const coco = r.perOil.find((p) => p.id === 'coconut');
  assert.equal(coco.percent, 30);
});

test('percentage mode resolves to weights against the batch weight', () => {
  const r = calculate({ mode: 'percent', batchWeight: 1000, oils: [{ id: 'olive', percent: 60 }, { id: 'coconut', percent: 40 }], superfat: 0 });
  assert.equal(r.totalOil, 1000);
  const coco = r.perOil.find((p) => p.id === 'coconut');
  assert.equal(coco.weight, 400);
});

test('percentages that do not sum to 100 produce a warning', () => {
  const r = calculate({ mode: 'percent', batchWeight: 1000, oils: [{ id: 'olive', percent: 60 }, { id: 'coconut', percent: 30 }] });
  assert.ok(r.warnings.some((w) => /100%/.test(w)));
});

test('quality profile: 100% coconut is high cleansing/bubbly, low conditioning', () => {
  const r = calculate({ oils: [{ id: 'coconut', weight: 1000 }] });
  // coconut fa: lauric 48 + myristic 19 = 67 cleansing/bubbly; conditioning = oleic+linoleic = 10
  assert.equal(r.profile.cleansing, 67);
  assert.equal(r.profile.bubbly, 67);
  assert.equal(r.profile.conditioning, 10);
  assert.equal(r.profile.hardness, 79);                // lauric+myristic+palmitic+stearic = 48+19+9+3
});

test('quality profile: 100% olive (Castile) is high conditioning, low cleansing', () => {
  const r = calculate({ oils: [{ id: 'olive', weight: 1000 }] });
  assert.equal(r.profile.cleansing, 0);                // no lauric/myristic
  assert.ok(r.profile.conditioning >= 80, `conditioning ${r.profile.conditioning} should be high`);
});

test('castor drives bubbly & creamy via ricinoleic', () => {
  const r = calculate({ oils: [{ id: 'castor', weight: 1000 }] });
  assert.ok(r.profile.bubbly >= 90 && r.profile.creamy >= 90, 'ricinoleic feeds both bubbly and creamy');
});

test('0% superfat emits the caustic-margin warning', () => {
  const r = calculate({ oils: [{ id: 'coconut', weight: 100 }], superfat: 0 });
  assert.ok(r.warnings.some((w) => /superfat/i.test(w) && /margin/i.test(w)));
});

test('unknown oil is skipped with a warning, never throws', () => {
  const r = calculate({ oils: [{ id: 'unobtanium', weight: 100 }, { id: 'coconut', weight: 100 }] });
  assert.ok(r.warnings.some((w) => /unobtanium/i.test(w)));
  assert.equal(r.totalOil, 100);
});

test('custom oil (caller-supplied SAP + fa) works without a DB entry', () => {
  const r = calculate({ oils: [{ id: 'mystery', weight: 1000, sap: 0.14, fa: { oleic: 80 } }], superfat: 0 });
  assert.ok(approx(r.lye, 140, 0.01));
});

test('empty / garbage recipe soft-fails (ok:false), never throws', () => {
  const r = calculate({});
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.warnings) && r.warnings.length > 0);
  const r2 = calculate({ oils: 'not-an-array' });
  assert.equal(r2.ok, false);
});

test('SAFETY_NOTE names the add-lye-to-water rule and PPE', () => {
  assert.match(SAFETY_NOTE, /lye TO water/i);
  assert.match(SAFETY_NOTE, /goggles|gloves/i);
});

// ── the server ─────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, method: 'GET', headers: { host: 'soapcalc.test', ...headers } }, res);
  return res;
}

test('home 200 renders a real, usable form (oil select, weights, lye type, superfat)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=oilTpl/);                 // the oil-row template
  assert.match(res.body, /id=lyeType/);
  assert.match(res.body, /id=superfat/);
  assert.match(res.body, /id=waterRatio/);
  assert.match(res.body, /Soap Calculator/);
  assert.ok(res.body.includes(esc(OILS.coconut.name)), 'oil options rendered server-side');
});

test('the page carries the caustic-lye safety note prominently', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Lye safety/i);
  assert.match(body, /lye TO water/i);
});

test('the server renders WITHOUT any network fetch (throwing fetch injected → still renders)', async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('network must not be touched'); };
  try {
    const res = await get('/');
    assert.equal(res.code, 200);
    assert.equal(called, false, 'server handler must not fetch at request time');
  } finally { globalThis.fetch = orig; }
});

test('runs client-side — inline script only, no external script src / CDN', async () => {
  const body = (await get('/')).body;
  assert.ok(!/<script src=/i.test(body), 'no external script src (inline only)');
});

test('JSON API (GET): oils=coconut:1000 & superfat=0 → lye 183, with safety note', async () => {
  const res = await get('/api/calc?oils=coconut:1000&lyeType=NaOH&superfat=0&waterRatio=2');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.lye, 183);
  assert.equal(j.water, 366);
  assert.match(j.safety, /lye TO water/i);
});

test('JSON API (POST): body recipe computes and returns per-oil breakdown', async () => {
  const res = mockRes();
  const body = JSON.stringify({ oils: [{ id: 'olive', weight: 700 }, { id: 'coconut', weight: 300 }], superfat: 5 });
  const chunks = [Buffer.from(body)];
  const req = {
    url: '/api/calc', method: 'POST', headers: { host: 'soapcalc.test' },
    on(ev, cb) { if (ev === 'data') chunks.forEach((c) => cb(c)); if (ev === 'end') cb(); return this; },
    destroy() {},
  };
  await handler(req, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.perOil.length, 2);
  assert.equal(j.totalOil, 1000);
});

test('/api/oils returns the reference database', async () => {
  const res = await get('/api/oils');
  const j = JSON.parse(res.body);
  assert.ok(j.oils.coconut && j.oils.coconut.sap);
  assert.ok(Array.isArray(j.fattyAcids));
});

test('recipeFromQuery parses "id:amt" pairs and percent mode', () => {
  const r = recipeFromQuery(new URLSearchParams('oils=coconut:300,olive:500&superfat=6'));
  assert.equal(r.oils.length, 2);
  assert.equal(r.oils[0].weight, 300);
  assert.equal(r.superfat, 6);
  const p = recipeFromQuery(new URLSearchParams('mode=percent&oils=coconut:40&batch=1000'));
  assert.equal(p.mode, 'percent');
  assert.equal(p.oils[0].percent, 40);
});

test('/health returns {"ok":true}', async () => {
  const res = await get('/health');
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  assert.match((await get('/robots.txt')).body, /User-agent/);
  assert.match((await get('/sitemap.xml')).body, /<urlset|<url>/);
  assert.match((await get('/sitemap-index.xml')).body, /sitemapindex/);
  assert.match((await get('/llms.txt')).body, /Calculator/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile oils param cannot inject markup — API is inert JSON, HTML page escapes', async () => {
  // The JSON API is served as application/json, so echoed input is never parsed as HTML.
  const api = await get('/api/calc?oils=' + encodeURIComponent('<script>x</script>:1'));
  assert.equal(api.code, 200);
  assert.match(api.headers['content-type'], /application\/json/);
  // The HTML page never reflects a query param raw — nothing user-supplied reaches the markup.
  const pageRes = await get('/?oils=' + encodeURIComponent('<script>x</script>'));
  assert.ok(!pageRes.body.includes('<script>x</script>'), 'no raw hostile payload in the HTML page');
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /free MELEK account/i);
  const first = body.indexOf('Soap Calculator');
  const melek = body.indexOf('MELEK');
  assert.ok(first >= 0 && first < melek, 'the tool is introduced before MELEK');
});

test('unknown path → 404, never a 500', async () => {
  const res = await get('/nope/nope');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', method: 'GET', headers: { host: 'soapcalc.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('esc() and safeHref() are sound', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
});

test('calculatorPage() is a pure string with the quality-profile labels', () => {
  const html = calculatorPage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Hardness/);
  assert.match(html, /Conditioning/);
});

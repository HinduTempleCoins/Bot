// usda-nutrition.test.mjs — offline tests with an injected fetch returning canned FoodData Central JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, searchFood, normalizeFoods, nutrients, compare,
  renderPage, dataNote, esc,
} from './usda-nutrition.mjs';

// ---- canned FDC payloads -------------------------------------------------------------------------
const SEARCH_JSON = {
  foods: [
    { fdcId: 173410, description: 'Cheese, cheddar', brandOwner: 'Generic', dataType: 'SR Legacy' },
    { fdcId: 200001, description: 'Tofu, firm', dataType: 'Foundation' },
    null,
    { description: 'Mystery food, no id', dataType: 'Branded' },
  ],
};

const CHEDDAR_JSON = {
  fdcId: 173410,
  description: 'Cheese, cheddar',
  brandOwner: 'Generic',
  servingSize: 28,
  servingSizeUnit: 'g',
  foodNutrients: [
    { nutrient: { name: 'Energy', unitName: 'kcal' }, amount: 403 },
    { nutrient: { name: 'Protein', unitName: 'g' }, amount: 24.9 },
    { nutrient: { name: 'Total lipid (fat)', unitName: 'g' }, amount: 33.1 },
    { nutrient: { name: 'Carbohydrate, by difference', unitName: 'g' }, amount: 1.28 },
    { nutrient: { name: 'Calcium, Ca', unitName: 'mg' }, amount: 721 },
    { nutrient: { name: 'Sodium, Na' }, amount: null }, // dropped: no amount
    null,
  ],
};

const TOFU_JSON = {
  fdcId: 200001,
  description: 'Tofu, firm',
  foodNutrients: [
    { nutrient: { name: 'Energy', unitName: 'kcal' }, amount: 144 },
    { nutrient: { name: 'Protein', unitName: 'g' }, amount: 17.3 },
    { nutrient: { name: 'Total lipid (fat)', unitName: 'g' }, amount: 8.72 },
    { nutrient: { name: 'Carbohydrate, by difference', unitName: 'g' }, amount: 2.78 },
  ],
};

// a fetch stub that routes by URL substring and records the last URL it saw.
function stubFetch(map) {
  return async (url) => {
    stubFetch.lastUrl = String(url);
    for (const [needle, payload] of Object.entries(map)) {
      if (String(url).includes(needle)) {
        return { ok: true, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// ---- searchFood ----------------------------------------------------------------------------------
test('searchFood normalizes FDC rows', async () => {
  __setFetch(stubFetch({ '/foods/search': SEARCH_JSON }));
  const rows = await searchFood('cheese', { limit: 5 });
  __setFetch(null);
  assert.equal(rows.length, 3); // null dropped; id-less row kept (has description)
  assert.deepEqual(rows[0], {
    fdcId: 173410, description: 'Cheese, cheddar', brand: 'Generic',
    dataType: 'SR Legacy', source: 'USDA FoodData Central',
  });
  assert.equal(rows[1].fdcId, 200001);
  assert.equal(rows[1].brand, null);
});

test('searchFood soft-fails to [] on empty query and on network error', async () => {
  __setFetch(stubFetch({}));
  assert.deepEqual(await searchFood(''), []);
  __setFetch(() => { throw new Error('down'); });
  assert.deepEqual(await searchFood('cheese'), []);
  __setFetch(async () => { throw new Error('boom'); });
  assert.deepEqual(await searchFood('cheese'), []);
  __setFetch(null);
});

test('normalizeFoods handles non-array input', () => {
  assert.deepEqual(normalizeFoods(null), []);
  assert.deepEqual(normalizeFoods(undefined), []);
});

// ---- nutrients -----------------------------------------------------------------------------------
test('nutrients returns macros + calories from a canned food', async () => {
  __setFetch(stubFetch({ '/food/173410': CHEDDAR_JSON }));
  const panel = await nutrients(173410);
  __setFetch(null);
  assert.equal(panel.description, 'Cheese, cheddar');
  assert.equal(panel.serving, '28 g');
  const cal = panel.nutrients.find((n) => n.name === 'Energy');
  assert.deepEqual(cal, { name: 'Energy', amount: 403, unit: 'kcal' });
  const protein = panel.nutrients.find((n) => n.name === 'Protein');
  assert.equal(protein.amount, 24.9);
  // the null-amount row was dropped.
  assert.ok(!panel.nutrients.some((n) => n.name === 'Sodium, Na'));
});

test('nutrients soft-fails to null', async () => {
  assert.equal(await nutrients(''), null);
  __setFetch(stubFetch({})); // 404
  assert.equal(await nutrients(999), null);
  __setFetch(null);
});

// ---- compare -------------------------------------------------------------------------------------
test('compare lines up macros across multiple foods', async () => {
  __setFetch(stubFetch({ '/food/173410': CHEDDAR_JSON, '/food/200001': TOFU_JSON }));
  const c = await compare([173410, 200001]);
  __setFetch(null);
  assert.equal(c.foods.length, 2);
  assert.ok(c.macros.includes('Protein'));
  const cheddar = c.foods.find((f) => f.fdcId === 173410);
  const tofu = c.foods.find((f) => f.fdcId === 200001);
  assert.equal(cheddar.macros.Energy.amount, 403);
  assert.equal(cheddar.macros.Protein.amount, 24.9);
  assert.equal(tofu.macros.Energy.amount, 144);
  assert.equal(tofu.macros['Total Fat'].amount, 8.72);
});

test('compare soft-fails to empty foods on no ids', async () => {
  const c = await compare([]);
  assert.deepEqual(c.foods, []);
  assert.ok(Array.isArray(c.macros));
});

// ---- renderPage ----------------------------------------------------------------------------------
test('renderPage escapes a malicious food description', () => {
  const evil = {
    description: '<img src=x onerror=alert(1)>',
    brand: '"></section><script>steal()</script>',
    serving: '28 g',
    nutrients: [{ name: '<b>Energy</b>', amount: '1"><script>', unit: 'kcal' }],
  };
  const html = renderPage(evil);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;Energy&lt;/b&gt;'));
});

test('renderPage handles empty/null data without throwing', () => {
  const html = renderPage(null);
  assert.ok(html.includes('No nutrition data'));
  assert.ok(html.includes('Source: USDA FoodData Central'));
});

// ---- dataNote ------------------------------------------------------------------------------------
test('dataNote has source + as-of date', () => {
  const note = dataNote(new Date('2026-06-03T12:00:00Z'));
  assert.match(note, /Source: USDA FoodData Central/);
  assert.match(note, /as of 2026-06-03/);
});

// ---- key by env NAME, no secret literal ----------------------------------------------------------
test('api key is referenced by env NAME (DEMO_KEY fallback; env override used)', async () => {
  // default → documented public DEMO_KEY in the request URL.
  __setFetch(stubFetch({ '/foods/search': SEARCH_JSON }));
  await searchFood('cheese');
  assert.match(stubFetch.lastUrl, /api_key=DEMO_KEY/);

  // setting the env NAME overrides it — proves the key is read from the named env var, not a literal.
  process.env.USDA_FDC_API_KEY = 'TEST_ENV_VALUE';
  await searchFood('cheese');
  assert.match(stubFetch.lastUrl, /api_key=TEST_ENV_VALUE/);
  delete process.env.USDA_FDC_API_KEY;
  __setFetch(null);
});

test('source file contains no real api key literal beyond documented DEMO_KEY', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./usda-nutrition.mjs', import.meta.url), 'utf8');
  // the only key string allowed in source is the public DEMO_KEY; the real key is env-name only.
  assert.ok(src.includes('USDA_FDC_API_KEY'));
  // a real api.data.gov key is 40 alphanumerics; assert none is hard-coded.
  assert.ok(!/[A-Za-z0-9]{40}/.test(src.replace(/DEMO_KEY/g, '')));
});

test('esc escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

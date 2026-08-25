// pentecaust/herald/ifttt-triggers.test.mjs — offline tests for the Herald IFTTT-triggers module.
// node --test, fully offline: no network, mock req/res, injectable `now`. Soft-fail — never throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRecipe, matchRecipe, evaluate, makeStore, esc, handler,
} from './ifttt-triggers.mjs';

// ── mock req/res ──────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, h) { this.statusCode = code; this.headers = h; return this; },
    end(b) { this.body = b == null ? '' : String(b); return this; },
  };
}
function mockReq(method, url, jsonBody) {
  const req = { method, url };
  if (jsonBody !== undefined) req.body = jsonBody; // handler short-circuits on req.body
  return req;
}
const tagRecipe = () => ({ id: 'r-tag', name: 'Ping on melek', when: { type: 'tag', tag: 'melek' }, then: { type: 'notify', target: '@hathor' } });
const velRecipe = () => ({ id: 'r-vel', name: 'Trend hook', when: { type: 'velocity', tag: 'prana', threshold: 25 }, then: { type: 'webhook', target: 'https://x.invalid/h' } });
const campRecipe = () => ({ id: 'r-camp', name: 'Launch reward', when: { type: 'campaign', tag: 'launch' }, then: { type: 'reward', target: '10 MELEK' } });

// ── validateRecipe ──────────────────────────────────────────────────────────────────────────────────
test('validateRecipe accepts a well-formed tag recipe', () => {
  const v = validateRecipe(tagRecipe());
  assert.equal(v.ok, true);
  assert.equal(v.recipe.when.type, 'tag');
  assert.equal(v.recipe.when.tag, 'melek');
  assert.equal(v.recipe.then.type, 'notify');
});

test('validateRecipe requires a velocity threshold and rejects bad ones', () => {
  assert.equal(validateRecipe({ name: 'x', when: { type: 'velocity', tag: 'prana' }, then: { type: 'notify', target: 'a' } }).ok, false);
  assert.equal(validateRecipe({ name: 'x', when: { type: 'velocity', tag: 'prana', threshold: 0 }, then: { type: 'notify', target: 'a' } }).ok, false);
  assert.equal(validateRecipe(velRecipe()).ok, true);
});

test('validateRecipe rejects malformed recipes', () => {
  assert.equal(validateRecipe(null).ok, false);
  assert.equal(validateRecipe({}).ok, false);
  assert.equal(validateRecipe({ name: '', when: { type: 'tag', tag: 'a' }, then: { type: 'notify', target: 'b' } }).ok, false);
  assert.equal(validateRecipe({ name: 'n', when: { type: 'nope', tag: 'a' }, then: { type: 'notify', target: 'b' } }).ok, false);
  assert.equal(validateRecipe({ name: 'n', when: { type: 'tag', tag: 'bad tag!' }, then: { type: 'notify', target: 'b' } }).ok, false);
  assert.equal(validateRecipe({ name: 'n', when: { type: 'tag', tag: 'a' }, then: { type: 'explode', target: 'b' } }).ok, false);
  assert.equal(validateRecipe({ name: 'n', when: { type: 'tag', tag: 'a' }, then: { type: 'notify', target: '' } }).ok, false);
});

test('validateRecipe assigns an id when missing and normalizes #tag', () => {
  const v = validateRecipe({ name: 'n', when: { type: 'tag', tag: '#MELEK' }, then: { type: 'post', target: 'body' } });
  assert.equal(v.ok, true);
  assert.equal(v.recipe.when.tag, 'melek');
  assert.ok(v.recipe.id && typeof v.recipe.id === 'string');
});

// ── matchRecipe ─────────────────────────────────────────────────────────────────────────────────────
test('matchRecipe fires on a matching tag event and NOT on a non-match', () => {
  assert.equal(matchRecipe(tagRecipe(), { type: 'tag', tags: ['melek', 'prana'] }), true);
  assert.equal(matchRecipe(tagRecipe(), { type: 'tag', title: 'my #melek build' }), true);
  assert.equal(matchRecipe(tagRecipe(), { type: 'tag', tags: ['prana'] }), false);
  assert.equal(matchRecipe(tagRecipe(), { type: 'velocity', tag: 'melek', value: 99 }), false); // wrong event type
});

test('matchRecipe velocity fires only at/above threshold', () => {
  assert.equal(matchRecipe(velRecipe(), { type: 'velocity', tag: 'prana', value: 25 }), true);
  assert.equal(matchRecipe(velRecipe(), { type: 'velocity', tag: 'prana', value: 40 }), true);
  assert.equal(matchRecipe(velRecipe(), { type: 'velocity', tag: 'prana', value: 24 }), false);
  assert.equal(matchRecipe(velRecipe(), { type: 'velocity', tag: 'other', value: 99 }), false); // wrong tag
});

test('matchRecipe campaign fires on the named campaign', () => {
  assert.equal(matchRecipe(campRecipe(), { type: 'campaign', campaign: 'launch' }), true);
  assert.equal(matchRecipe(campRecipe(), { type: 'campaign', tag: 'launch' }), true);
  assert.equal(matchRecipe(campRecipe(), { type: 'campaign', campaign: 'other' }), false);
});

// ── evaluate ────────────────────────────────────────────────────────────────────────────────────────
test('evaluate returns the fired recipes planned actions', () => {
  const recipes = [tagRecipe(), velRecipe(), campRecipe()];
  const fired = evaluate(recipes, { type: 'tag', tags: ['melek'] });
  assert.equal(fired.length, 1);
  assert.equal(fired[0].recipeId, 'r-tag');
  assert.equal(fired[0].action, 'notify');
  assert.equal(fired[0].target, '@hathor');
  assert.equal(fired[0].planned, true);
});

test('evaluate fires two distinct recipes on the same tag', () => {
  const a = { id: 'a', name: 'A', when: { type: 'tag', tag: 'melek' }, then: { type: 'notify', target: '@x' } };
  const b = { id: 'b', name: 'B', when: { type: 'tag', tag: 'melek' }, then: { type: 'reward', target: '1 MELEK' } };
  const fired = evaluate([a, b], { type: 'tag', tags: ['melek'] });
  assert.equal(fired.length, 2);
});

// ── store ───────────────────────────────────────────────────────────────────────────────────────────
test('store add/list/remove', () => {
  const s = makeStore();
  assert.deepEqual(s.list(), []);
  assert.equal(s.add(tagRecipe()).ok, true);
  assert.equal(s.list().length, 1);
  assert.equal(s.has('r-tag'), true);
  assert.equal(s.remove('r-tag'), true);
  assert.equal(s.list().length, 0);
  assert.equal(s.remove('nope'), false);
  assert.equal(s.add({ bad: true }).ok, false); // rejects malformed
});

test('store dedupe prevents a double-fire in-window and allows it after', () => {
  const s = makeStore({ recipes: [tagRecipe()], dedupeMs: 1000 });
  const ev = { type: 'tag', tags: ['melek'], author: 'alice', id: 'p1' };
  assert.equal(s.fire(ev, 1000).length, 1);      // first fire
  assert.equal(s.fire(ev, 1500).length, 0);      // same event in-window → suppressed
  assert.equal(s.fire(ev, 2600).length, 1);      // window elapsed → fires again
});

// ── esc ─────────────────────────────────────────────────────────────────────────────────────────────
test('esc escapes a hostile recipe name', () => {
  const nasty = `<script>"'&`;
  const out = esc(nasty);
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;') && out.includes('&amp;') && out.includes('&quot;') && out.includes('&#39;'));
});

// ── handler ─────────────────────────────────────────────────────────────────────────────────────────
test('handler serves the HTML page and escapes an injected recipe name', async () => {
  const store = makeStore({ recipes: [{ id: 'evil', name: '<img src=x onerror=alert(1)>', when: { type: 'tag', tag: 'melek' }, then: { type: 'notify', target: '@h' } }] });
  const res = mockRes();
  await handler(mockReq('GET', '/ifttt'), res, { store });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes('IFTTT triggers'));
  assert.ok(!res.body.includes('<img src=x onerror'));   // hostile name is escaped
  assert.ok(res.body.includes('&lt;img'));
});

test('handler GET /api/ifttt/recipes returns JSON list', async () => {
  const store = makeStore({ recipes: [tagRecipe()] });
  const res = mockRes();
  await handler(mockReq('GET', '/api/ifttt/recipes'), res, { store });
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.recipes.length, 1);
  assert.equal(j.recipes[0].id, 'r-tag');
});

test('handler POST /api/ifttt/evaluate returns fired actions', async () => {
  const store = makeStore({ recipes: [tagRecipe(), velRecipe()] });
  const res = mockRes();
  await handler(mockReq('POST', '/api/ifttt/evaluate', { event: { type: 'tag', tags: ['melek'] } }), res, { store });
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.fired, 1);
  assert.equal(j.actions[0].action, 'notify');
});

test('handler GET /api/ifttt/evaluate with query fires (offline, no body)', async () => {
  const store = makeStore({ recipes: [tagRecipe()] });
  const res = mockRes();
  await handler(mockReq('GET', '/api/ifttt/evaluate?type=tag&tag=melek'), res, { store });
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.fired, 1);
});

test('handler POST evaluate with inline recipes uses pure evaluate (no store)', async () => {
  const res = mockRes();
  await handler(mockReq('POST', '/api/ifttt/evaluate', { event: { type: 'campaign', campaign: 'launch' }, recipes: [campRecipe()] }), res, {});
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.fired, 1);
  assert.equal(j.actions[0].action, 'reward');
});

// ── soft-fail / never throw on garbage ────────────────────────────────────────────────────────────────
test('never throws on garbage input', () => {
  assert.doesNotThrow(() => validateRecipe(undefined));
  assert.doesNotThrow(() => matchRecipe(null, null));
  assert.doesNotThrow(() => matchRecipe(tagRecipe(), 42));
  assert.doesNotThrow(() => evaluate(null, null));
  assert.doesNotThrow(() => evaluate('nope', { type: 'tag' }));
  assert.deepEqual(evaluate(null, null), []);
  assert.equal(matchRecipe({ junk: 1 }, { type: 'tag' }), false);
});

test('handler never throws on a bad body / unknown path', async () => {
  const res1 = mockRes();
  await handler(mockReq('POST', '/api/ifttt/evaluate', 'not-an-object-but-truthy' && null), res1, {});
  // null body → readJsonBody resolves {} which is an object; fired 0. Just assert it responds.
  assert.ok(res1.statusCode >= 200);
  const res2 = mockRes();
  await handler(mockReq('GET', '/nope/unknown'), res2, {});
  assert.equal(res2.statusCode, 404);
});

// pentecaust/herald/prompt-packs.test.mjs — offline, deterministic. No network.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  PACKS, CATEGORIES, listPacks, getPack, fillPrompt, search, handler,
} from './prompt-packs.mjs';

// tiny fake res that records what handler wrote
function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(s) { this.body = s == null ? '' : String(s); },
    json() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}

test('library is well-formed: every pack has a valid category and matching vars', () => {
  assert.ok(PACKS.length >= 4, 'at least 4 packs');
  const ids = new Set();
  for (const p of PACKS) {
    assert.ok(p.id && typeof p.id === 'string', 'has id');
    assert.ok(!ids.has(p.id), `unique id ${p.id}`); ids.add(p.id);
    assert.ok(CATEGORIES.includes(p.category), `${p.id} category valid`);
    assert.ok(p.title && p.goal, `${p.id} has title + goal`);
    assert.ok(Array.isArray(p.prompts) && p.prompts.length > 0, `${p.id} has prompts`);
    for (const q of p.prompts) {
      const found = new Set([...String(q.template).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]));
      // every declared var appears in the template
      for (const v of q.vars) assert.ok(found.has(v), `${p.id}: declared var ${v} present in template`);
      // every placeholder in the template is declared
      for (const v of found) assert.ok(q.vars.includes(v), `${p.id}: placeholder ${v} declared in vars`);
    }
  }
});

test('listPacks returns all, and clones (callers cannot mutate the library)', () => {
  const all = listPacks();
  assert.strictEqual(all.length, PACKS.length);
  all[0].title = 'MUTATED';
  all[0].prompts[0].vars.push('injected');
  assert.notStrictEqual(PACKS[0].title, 'MUTATED');
  assert.ok(!PACKS[0].prompts[0].vars.includes('injected'));
});

test('listPacks filters by category; unknown category returns all', () => {
  const links = listPacks({ category: 'links' });
  assert.ok(links.length >= 1);
  assert.ok(links.every((p) => p.category === 'links'));
  assert.strictEqual(listPacks({ category: 'nonsense' }).length, PACKS.length);
  assert.strictEqual(listPacks({ category: 'LINKS' }).length, links.length, 'case-insensitive');
});

test('getPack returns one pack or null', () => {
  const p = getPack('keyword-cluster-expander');
  assert.ok(p && p.id === 'keyword-cluster-expander');
  assert.strictEqual(getPack('does-not-exist'), null);
  assert.strictEqual(getPack(null), null);
  assert.strictEqual(getPack(undefined), null);
});

test('fillPrompt substitutes known vars and leaves unknown vars visible', () => {
  const r = fillPrompt('keyword-cluster-expander', 0, { seed: 'hemp farming', topic: 'MELEK', audience: 'growers' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.text.includes('hemp farming'));
  assert.ok(r.text.includes('growers'));
  assert.ok(!r.text.includes('{{seed}}'));
  assert.deepStrictEqual(r.missing, []);
});

test('fillPrompt leaves missing vars as {{placeholder}} and reports them', () => {
  const r = fillPrompt('keyword-cluster-expander', 0, { seed: 'hemp' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.text.includes('hemp'));
  assert.ok(r.text.includes('{{topic}}'), 'unfilled var stays visible');
  assert.ok(r.text.includes('{{audience}}'));
  assert.deepStrictEqual(r.missing.sort(), ['audience', 'topic']);
});

test('fillPrompt soft-fails on bad pack / index, never throws', () => {
  assert.strictEqual(fillPrompt('nope', 0, {}).ok, false);
  assert.strictEqual(fillPrompt('keyword-cluster-expander', 99, {}).ok, false);
  assert.strictEqual(fillPrompt('keyword-cluster-expander', -1, {}).ok, false);
  // empty-string value counts as missing, stays visible
  const r = fillPrompt('keyword-cluster-expander', 0, { seed: '', topic: 'x', audience: 'y' });
  assert.ok(r.text.includes('{{seed}}'));
  assert.ok(r.missing.includes('seed'));
  // bad vars object doesn't throw
  assert.strictEqual(fillPrompt('keyword-cluster-expander', 0, null).ok, true);
});

test('search matches title / goal / category and empty query returns all', () => {
  assert.ok(search('backlink').some((p) => p.id === 'backlink-outreach-opener'));
  assert.ok(search('keyword').length >= 1);
  assert.ok(search('links').every((p) => p.category === 'links') && search('links').length >= 1);
  assert.strictEqual(search('').length, PACKS.length);
  assert.strictEqual(search(null).length, PACKS.length);
  assert.strictEqual(search('zzzznomatch').length, 0);
});

test('handler GET /health', async () => {
  const res = fakeRes();
  await handler({ method: 'GET', url: '/health' }, res);
  assert.strictEqual(res.code, 200);
  assert.deepStrictEqual(res.json(), { ok: true });
});

test('handler GET /api/packs lists all + supports category and q filters', async () => {
  let res = fakeRes();
  await handler({ method: 'GET', url: '/api/packs' }, res);
  assert.strictEqual(res.code, 200);
  let body = res.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.count, PACKS.length);
  assert.deepStrictEqual(body.categories, CATEGORIES);

  res = fakeRes();
  await handler({ method: 'GET', url: '/api/packs?category=links' }, res);
  body = res.json();
  assert.ok(body.count >= 1 && body.packs.every((p) => p.category === 'links'));

  res = fakeRes();
  await handler({ method: 'GET', url: '/api/packs?q=backlink' }, res);
  body = res.json();
  assert.ok(body.packs.some((p) => p.id === 'backlink-outreach-opener'));
});

test('handler GET /api/pack/:id returns pack, and 404 for unknown', async () => {
  let res = fakeRes();
  await handler({ method: 'GET', url: '/api/pack/content-brief-generator' }, res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.json().pack.id, 'content-brief-generator');

  res = fakeRes();
  await handler({ method: 'GET', url: '/api/pack/nope' }, res);
  assert.strictEqual(res.code, 404);
  assert.strictEqual(res.json().ok, false);
});

test('handler 404 for unknown path, 405 for non-GET', async () => {
  let res = fakeRes();
  await handler({ method: 'GET', url: '/whatever' }, res);
  assert.strictEqual(res.code, 404);

  res = fakeRes();
  await handler({ method: 'POST', url: '/api/packs' }, res);
  assert.strictEqual(res.code, 405);
});

test('handler soft-fails on a malformed request (no throw)', async () => {
  const res = fakeRes();
  await handler({}, res); // no method, no url
  assert.ok(res.code >= 200);
  assert.ok(res.json() && res.json().ok === false);
});

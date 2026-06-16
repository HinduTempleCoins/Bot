/**
 * autovote/token-trails.test.mjs — Token Trails feature.
 *
 * A curation trail may be flagged `category:'token'` to mark it as a token/SCOT
 * curation-PROJECT trail. Such trails surface in their OWN "Token Trails" list,
 * separate from (and above) the general "Curation trails" list — not buried at
 * the bottom. These tests prove the store persists the flag and the dashboard
 * renders the two lists distinctly. Fully offline (no network).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Store } from './store.js';
import { dashboardPage } from './views.js';

const MELEK = 'melek-testnet';

function tmpStore() {
  const p = path.join(os.tmpdir(), `autovote-tt-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  return new Store(p);
}

test('addTrail defaults category to general ("")', () => {
  const store = tmpStore();
  const t = store.addTrail({ chain: MELEK, owner: 'me', target: 'leader', weight: 100 });
  assert.equal(t.category, '');
  assert.equal(Store.isTokenTrail(t), false);
});

test('addTrail with category:token is flagged + persisted', () => {
  const store = tmpStore();
  const t = store.addTrail({ chain: MELEK, owner: 'me', target: 'palnet', weight: 100, category: 'token' });
  assert.equal(t.category, 'token');
  assert.equal(Store.isTokenTrail(t), true);
  // survives a reload from disk
  const reloaded = new Store(store.dbPath);
  assert.equal(reloaded.data.trails[0].category, 'token');
});

test('unknown category values are coerced to general', () => {
  const store = tmpStore();
  const t = store.addTrail({ chain: MELEK, owner: 'me', target: 'x', weight: 100, category: 'haxxor' });
  assert.equal(t.category, '');
});

test('rulesFor returns the category on each trail', () => {
  const store = tmpStore();
  store.addTrail({ chain: MELEK, owner: 'me', target: 'general-leader', weight: 100 });
  store.addTrail({ chain: MELEK, owner: 'me', target: 'token-leader', weight: 100, category: 'token' });
  const r = store.rulesFor(MELEK, 'me');
  const tokenTrails = r.trails.filter((t) => Store.isTokenTrail(t));
  const generalTrails = r.trails.filter((t) => !Store.isTokenTrail(t));
  assert.equal(tokenTrails.length, 1);
  assert.equal(tokenTrails[0].target, 'token-leader');
  assert.equal(generalTrails.length, 1);
  assert.equal(generalTrails[0].target, 'general-leader');
});

test('migration stamps category="" on legacy trail rows (idempotent)', () => {
  const p = path.join(os.tmpdir(), `autovote-tt-legacy-${Date.now()}.json`);
  // legacy trail: no category field
  fs.writeFileSync(p, JSON.stringify({
    users: {}, fanbases: [], schedules: [], votes: [],
    trails: [{ id: 't1', chain: MELEK, owner: 'me', target: 'leader', weight: 100, paused: false }],
  }));
  const store = new Store(p);
  assert.equal(store.data.trails[0].category, '');
  // second load is a no-op (idempotent)
  const again = new Store(p);
  assert.equal(again.data.trails[0].category, '');
});

test('dashboard renders a labeled "Token Trails" section and a Kind selector', () => {
  const html = dashboardPage(MELEK, 'me');
  assert.match(html, /Token Trails/);
  assert.match(html, /id=tokentrails/);
  // the add-trail form lets a user pick Token Trail vs Curation trail
  assert.match(html, /id=t_category/);
  assert.match(html, /Token Trail<\/option>/);
  // the client splits d.trails by category into the two lists
  assert.match(html, /category==='token'/);
  assert.match(html, /tokentrails/);
});

test('Token Trails section is rendered ABOVE the general trails list', () => {
  const html = dashboardPage(MELEK, 'me');
  const tokenIdx = html.indexOf('id=tokentrails');
  const generalIdx = html.indexOf("id=trails");
  assert.ok(tokenIdx > -1 && generalIdx > -1);
  assert.ok(tokenIdx < generalIdx, 'Token Trails list must come before the general trails list');
});

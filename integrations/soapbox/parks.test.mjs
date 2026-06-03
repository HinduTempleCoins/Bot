// parks.test.mjs — offline tests for the NPS / Recreation.gov parks reader. Injected fetch with canned
// NPS/RIDB JSON; no network. Covers: parks normalizes + soft-fails to []; alerts returns current alerts;
// campgrounds normalizes (NPS + RIDB fallback); thingsToDo returns activities; parkProfile combines;
// renderPage escapes a malicious park name; dataNote names NPS; keys read by env NAME (no literal).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parks, alerts, campgrounds, thingsToDo, parkProfile, renderPage, dataNote, esc, __setFetch,
} from './parks.mjs';

const res = (json, ok = true) => ({ ok, json: async () => json });

const KEYS = ['NPS_API_KEY', 'RIDB_API_KEY'];
const clearKeys = () => { for (const k of KEYS) delete process.env[k]; };
const restore = () => { __setFetch(null); clearKeys(); };

// ── parks ────────────────────────────────────────────────────────────────────────────────────────────

test('parks() normalizes NPS data to the documented schema', async () => {
  process.env.NPS_API_KEY = 'unit-test-key';
  __setFetch(async (url) => {
    assert.match(String(url), /developer\.nps\.gov\/api\/v1\/parks/);
    assert.match(String(url), /stateCode=CA/);
    return res({ data: [{
      parkCode: 'yose', fullName: 'Yosemite National Park', states: 'CA',
      designation: 'National Park', description: 'Granite cliffs and waterfalls.',
      url: 'https://www.nps.gov/yose/',
    }] });
  });
  const rows = await parks({ state: 'ca', limit: 5 });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    parkCode: 'yose', name: 'Yosemite National Park', state: 'CA',
    designation: 'National Park', description: 'Granite cliffs and waterfalls.',
    url: 'https://www.nps.gov/yose/',
  });
  restore();
});

test('parks() soft-fails to [] when NPS_API_KEY is absent (no network)', async () => {
  clearKeys();
  let called = false;
  __setFetch(async () => { called = true; return res({ data: [] }); });
  const rows = await parks({ state: 'ca' });
  assert.deepEqual(rows, []);
  assert.equal(called, false, 'no key ⇒ no fetch');
  restore();
});

test('parks() soft-fails to [] when the call errors', async () => {
  process.env.NPS_API_KEY = 'k';
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await parks({ query: 'x' }), []);
  restore();
});

// ── alerts ───────────────────────────────────────────────────────────────────────────────────────────

test('alerts() returns current alerts, urgent-first', async () => {
  process.env.NPS_API_KEY = 'k';
  __setFetch(async (url) => {
    assert.match(String(url), /\/alerts\?/);
    return res({ data: [
      { title: 'Visitor center hours', category: 'Information', description: 'Open 9-5' },
      { title: 'Road closed', category: 'Closure', description: 'Tioga Rd closed for snow' },
      { title: 'Rockfall danger', category: 'Danger', description: 'Avoid the base' },
    ] });
  });
  const a = await alerts({ parkCode: 'yose' });
  assert.equal(a.length, 3);
  assert.equal(a[0].category, 'Danger', 'most urgent first');
  assert.equal(a[1].category, 'Closure');
  assert.equal(a[2].category, 'Information');
  restore();
});

test('alerts() soft-fails to [] without key or parkCode', async () => {
  clearKeys();
  assert.deepEqual(await alerts({ parkCode: 'yose' }), []);
  process.env.NPS_API_KEY = 'k';
  __setFetch(async () => res({ data: [] }));
  assert.deepEqual(await alerts({}), []);
  restore();
});

// ── campgrounds ──────────────────────────────────────────────────────────────────────────────────────

test('campgrounds() normalizes NPS campgrounds', async () => {
  process.env.NPS_API_KEY = 'k';
  __setFetch(async (url) => {
    assert.match(String(url), /\/campgrounds\?/);
    return res({ data: [
      { name: 'Upper Pines', parkCode: 'yose', numberOfSitesReservable: '238', url: 'https://www.nps.gov/yose/up' },
    ] });
  });
  const c = await campgrounds({ parkCode: 'yose' });
  assert.equal(c.length, 1);
  assert.equal(c[0].name, 'Upper Pines');
  assert.equal(c[0].sites, 238);
  assert.equal(c[0].reservable, 238);
  assert.equal(c[0].source, 'NPS');
  restore();
});

test('campgrounds() falls back to RIDB when NPS yields nothing', async () => {
  // Only RIDB key present → NPS path skipped, RIDB path used + normalized.
  process.env.RIDB_API_KEY = 'ridb-key';
  __setFetch(async (url, opts) => {
    assert.match(String(url), /ridb\.recreation\.gov\/api\/v1\/facilities/);
    assert.equal(opts?.headers?.apikey, 'ridb-key', 'RIDB key passed as apikey header by env value');
    return res({ RECDATA: [
      { FacilityName: 'Wawona Campground', FacilityID: '232447', Reservable: true },
    ] });
  });
  const c = await campgrounds({ parkCode: 'yose' });
  assert.equal(c.length, 1);
  assert.equal(c[0].name, 'Wawona Campground');
  assert.equal(c[0].source, 'RIDB');
  assert.equal(c[0].reservable, 1);
  assert.match(c[0].url, /recreation\.gov\/camping\/campgrounds\/232447/);
  restore();
});

test('campgrounds() soft-fails to [] with no keys and no parkCode', async () => {
  clearKeys();
  let called = false;
  __setFetch(async () => { called = true; return res({ data: [] }); });
  assert.deepEqual(await campgrounds({ parkCode: 'yose' }), []);
  assert.deepEqual(await campgrounds({}), []);
  assert.equal(called, false);
  restore();
});

// ── thingsToDo ───────────────────────────────────────────────────────────────────────────────────────

test('thingsToDo() returns activities', async () => {
  process.env.NPS_API_KEY = 'k';
  __setFetch(async (url) => {
    assert.match(String(url), /\/thingstodo\?/);
    return res({ data: [
      { title: 'Hike to Vernal Fall', activities: [{ name: 'Hiking' }, { name: 'Wildlife Watching' }], duration: 'Half day', url: 'https://www.nps.gov/yose/vf' },
    ] });
  });
  const t = await thingsToDo({ parkCode: 'yose' });
  assert.equal(t.length, 1);
  assert.equal(t[0].title, 'Hike to Vernal Fall');
  assert.deepEqual(t[0].activities, ['Hiking', 'Wildlife Watching']);
  assert.equal(t[0].duration, 'Half day');
  restore();
});

test('thingsToDo() soft-fails to [] without key', async () => {
  clearKeys();
  assert.deepEqual(await thingsToDo({ parkCode: 'yose' }), []);
  restore();
});

// ── parkProfile ──────────────────────────────────────────────────────────────────────────────────────

test('parkProfile() combines park + alerts + campgrounds + things to do', async () => {
  process.env.NPS_API_KEY = 'k';
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('/parks?')) return res({ data: [{ parkCode: 'yose', fullName: 'Yosemite National Park', states: 'CA', designation: 'National Park' }] });
    if (u.includes('/alerts?')) return res({ data: [{ title: 'Road closed', category: 'Closure', description: 'snow' }] });
    if (u.includes('/campgrounds?')) return res({ data: [{ name: 'Upper Pines', parkCode: 'yose', numberOfSitesReservable: 238 }] });
    if (u.includes('/thingstodo?')) return res({ data: [{ title: 'Vernal Fall', activities: [{ name: 'Hiking' }] }] });
    return res({ data: [] });
  });
  const prof = await parkProfile('yose');
  assert.equal(prof.park.parkCode, 'yose');
  assert.equal(prof.alerts.length, 1);
  assert.equal(prof.campgrounds.length, 1);
  assert.equal(prof.thingsToDo.length, 1);
  assert.match(prof.asOf, /^\d{4}-\d{2}-\d{2}T/);
  restore();
});

test('parkProfile() returns null without a parkCode', async () => {
  assert.equal(await parkProfile(), null);
});

// ── renderPage ───────────────────────────────────────────────────────────────────────────────────────

test('renderPage() escapes a malicious park name (no raw <script>)', async () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    park: { name: evil, designation: 'National Park', state: 'CA', description: 'x', url: 'https://www.nps.gov/yose/' },
    alerts: [{ title: evil, category: 'Closure', description: evil }],
    campgrounds: [{ name: evil, sites: 1, url: 'https://x', source: 'NPS' }],
    thingsToDo: [{ title: evil, activities: [evil], url: 'https://x' }],
    asOf: '2026-06-03T00:00:00Z',
  });
  assert.ok(!html.includes('<script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'name is HTML-escaped');
  assert.equal(esc(evil), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('renderPage() handles a missing park gracefully', async () => {
  const html = renderPage({ park: null });
  assert.match(html, /Park not found/);
  assert.match(html, /National Park Service/);
});

// ── dataNote + key-by-env-name ─────────────────────────────────────────────────────────────────────────

test('dataNote() names NPS and carries an as-of date', async () => {
  const n = dataNote('2026-06-03T12:00:00Z');
  assert.match(n, /National Park Service/);
  assert.match(n, /as of 2026-06-03/);
});

test('keys are read by env NAME, never literal in source', async () => {
  const src = await import('node:fs').then((fs) => fs.promises.readFile(new URL('./parks.mjs', import.meta.url), 'utf8'));
  assert.match(src, /process\.env\.NPS_API_KEY/, 'NPS key read by env name');
  assert.match(src, /process\.env\.RIDB_API_KEY/, 'RIDB key read by env name');

  // No fetch without a key (proves keys gate the call, not a hard-coded literal).
  clearKeys();
  let called = false;
  __setFetch(async () => { called = true; return res({ data: [] }); });
  await parks({ state: 'ca' });
  await thingsToDo({ parkCode: 'yose' });
  assert.equal(called, false, 'no key ⇒ no network');
  restore();
});

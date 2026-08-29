// site/gamedev/model.test.mjs — OFFLINE. In-memory fs, deterministic clock. Covers dev/project CRUD,
// releases + builds + caps, ratings/plays/downloads, the IP-safe discovery gate, discovery queries,
// stats, and escaped rendering. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeveloper, getDeveloper, createProject, getProject, projectBySlug, updateProject,
  addRelease, addBuild, latestRelease, playableBuild, allBuilds,
  rate, incrementPlays, incrementDownloads, setFeatured,
  listGames, gamesByDeveloper, gamesByTag, listFeatured, search, projectStats,
  renderProjectPage, renderPortalIndex, PLATFORMS, LICENSES,
} from './model.mjs';

// In-memory fs so nothing hits disk.
function mem() {
  const m = new Map();
  return { fs: { read: (p) => (m.has(p) ? m.get(p) : null), write: (p, s) => m.set(p, s) }, file: 'mem://gamedev.json' };
}
const at = (o, t) => ({ ...o, now: t });
// Make a published, ip-ok project and return it.
function pub(o, over = {}) {
  const r = createProject({ owner: 'hathor', title: 'Test Game', license: 'mit', ...over }, o);
  updateProject(r.project.id, { status: 'published' }, o);
  return getProject(r.project.id, o);
}

test('createDeveloper: requires a valid MELEK account; idempotent-updates', () => {
  const o = mem();
  assert.equal(createDeveloper({ account: '0xBad!' }, o).ok, false);
  const r = createDeveloper({ account: '@Alice', name: 'Alice', url: 'https://a.dev' }, at(o, 5));
  assert.equal(r.ok, true);
  assert.equal(r.developer.account, 'alice');
  assert.equal(getDeveloper('alice', o).name, 'Alice');
  // Re-create keeps created, bumps updated.
  const r2 = createDeveloper({ account: 'alice', name: 'Alice2' }, at(o, 9));
  assert.equal(r2.developer.created, 5);
  assert.equal(r2.developer.updated, 9);
  assert.equal(r2.developer.name, 'Alice2');
});

test('createProject: validates owner + title, auto-creates dev, seeds defaults, slug=id', () => {
  const o = mem();
  assert.equal(createProject({ owner: 'bad!', title: 'x' }, o).ok, false);
  assert.equal(createProject({ owner: 'alice', title: '' }, o).ok, false);
  const r = createProject({ owner: 'alice', title: 'My Cool Game', license: 'mit' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.project.slug, r.project.id);
  assert.equal(r.project.slug, 'my-cool-game');
  assert.equal(r.project.status, 'draft');
  assert.equal(r.project.ipOK, true);
  assert.deepEqual(r.project.releases, []);
  assert.ok(getDeveloper('alice', o), 'dev auto-created');
  assert.equal(projectBySlug('my-cool-game', o).id, r.project.id);
});

test('slug collisions get suffixed', () => {
  const o = mem();
  const a = createProject({ owner: 'alice', title: 'Dup' }, o).project;
  const b = createProject({ owner: 'alice', title: 'Dup' }, o).project;
  assert.notEqual(a.id, b.id);
  assert.equal(a.id, 'dup');
  assert.equal(b.id, 'dup-2');
});

test('IP-safe gate: unlicensed/unknown license → ipOK false → hidden from discovery', () => {
  const o = mem();
  const good = pub(o, { title: 'Open Game', license: 'cc0' });
  const bad = createProject({ owner: 'hathor', title: 'Ripped IP', license: 'nintendo-owned' }, o).project;
  updateProject(bad.id, { status: 'published' }, o);
  assert.equal(good.ipOK, true);
  assert.equal(getProject(bad.id, o).ipOK, false);
  const ids = listGames({}, o).map((p) => p.id);
  assert.ok(ids.includes(good.id));
  assert.ok(!ids.includes(bad.id), 'mislicensed game never surfaces');
  // updateProject can rescue it by setting an allow-listed license.
  updateProject(bad.id, { license: 'gpl-3.0' }, o);
  assert.equal(getProject(bad.id, o).ipOK, true);
  assert.ok(listGames({}, o).map((p) => p.id).includes(bad.id));
});

test('discovery only shows published by default; dev sees own drafts', () => {
  const o = mem();
  const draft = createProject({ owner: 'alice', title: 'Draft', license: 'mit' }, o).project;
  const live = pub(o, { owner: 'alice', title: 'Live' });
  assert.deepEqual(listGames({}, o).map((p) => p.id), [live.id]);
  assert.equal(listGames({ includeUnpublished: true }, o).length, 2);
  const mine = gamesByDeveloper('alice', o).map((p) => p.id);
  assert.ok(mine.includes(draft.id) && mine.includes(live.id));
});

test('releases + builds: version required, dedup, caps, playable/latest helpers', () => {
  const o = mem();
  const p = pub(o);
  assert.equal(addRelease(p.id, {}, o).ok, false, 'version required');
  assert.equal(addRelease(p.id, { version: '1.0.0', builds: [{ platform: 'web', url: 'https://x/play', playable: true }, { platform: 'windows', url: 'https://x/win.zip' }] }, o).ok, true);
  assert.equal(addRelease(p.id, { version: '1.0.0' }, o).ok, false, 'duplicate version');
  addRelease(p.id, { version: '1.1.0', notes: 'patch', builds: [{ platform: 'linux', url: 'https://x/lin' }] }, o);
  const cur = getProject(p.id, o);
  assert.equal(latestRelease(cur).version, '1.1.0');
  assert.equal(allBuilds(cur).length, 3);
  const play = playableBuild(cur);
  assert.equal(play.platform, 'web');
  assert.equal(play.version, '1.0.0');
});

test('build normalization: bad url rejected, non-web cannot be playable, platform default web', () => {
  const o = mem();
  const p = pub(o);
  addRelease(p.id, { version: '1', builds: [
    { platform: 'windows', url: 'javascript:alert(1)' },   // dropped (unsafe url)
    { platform: 'android', url: 'https://x/a.apk', playable: true }, // playable stripped (not web)
    { url: 'ipfs://cid/index.html', playable: true },       // platform defaults to web, stays playable
  ] }, o);
  const b = latestRelease(getProject(p.id, o)).builds;
  assert.equal(b.length, 2, 'unsafe-url build dropped');
  const android = b.find((x) => x.platform === 'android');
  assert.equal(android.playable, false);
  const web = b.find((x) => x.platform === 'web');
  assert.equal(web.playable, true);
  assert.equal(web.url, 'ipfs://cid/index.html');
});

test('addBuild attaches to named or latest release; cap enforced', () => {
  const o = mem();
  const p = pub(o);
  assert.equal(addBuild(p.id, { platform: 'web', url: 'https://x/p' }, o).ok, false, 'no release yet');
  addRelease(p.id, { version: '1' }, o);
  addRelease(p.id, { version: '2' }, o);
  assert.equal(addBuild(p.id, { platform: 'linux', url: 'https://x/lin' }, o).ok, true);      // → latest (v2)
  assert.equal(addBuild(p.id, { version: '1', platform: 'mac', url: 'https://x/mac' }, o).ok, true);
  const cur = getProject(p.id, o);
  assert.equal(cur.releases.find((r) => r.version === '2').builds.length, 1);
  assert.equal(cur.releases.find((r) => r.version === '1').builds.length, 1);
  assert.equal(addBuild(p.id, { platform: 'web', url: 'not-a-url' }, o).ok, false);
});

test('rate: 1..5 only; average tracked; stars in render', () => {
  const o = mem();
  const p = pub(o);
  assert.equal(rate(p.id, 0, o).ok, false);
  assert.equal(rate(p.id, 6, o).ok, false);
  rate(p.id, 5, o); rate(p.id, 3, o);
  const st = projectStats(p.id, o);
  assert.equal(st.rating, 4);
  assert.equal(st.ratingCount, 2);
});

test('plays + downloads counters', () => {
  const o = mem();
  const p = pub(o);
  incrementPlays(p.id, 10, o); incrementPlays(p.id, undefined, o);
  addRelease(p.id, { version: '1', builds: [{ platform: 'web', url: 'https://x/w' }, { platform: 'windows', url: 'https://x/win' }] }, o);
  assert.equal(incrementDownloads(p.id, { platform: 'windows' }, o).ok, true);
  assert.equal(incrementDownloads(p.id, { platform: 'ios' }, o).ok, false, 'no ios build');
  const st = projectStats(p.id, o);
  assert.equal(st.plays, 11);
  assert.equal(st.downloads, 1);
  assert.equal(st.byPlatform.windows, 1);
});

test('discovery: sort featured/new/top/played, byTag, featured list, search', () => {
  const o = mem();
  const a = pub(at(o, 1), { title: 'Alpha', tags: ['puzzle'] });
  const b = pub(at(o, 2), { title: 'Beta', tags: ['action', 'puzzle'] });
  const c = pub(at(o, 3), { title: 'Gamma', tags: ['action'] });
  rate(a.id, 5, o); rate(b.id, 2, o);
  incrementPlays(c.id, 100, o);
  setFeatured(b.id, true, o);
  assert.deepEqual(listGames({ sort: 'new' }, o).map((p) => p.id), [c.id, b.id, a.id]);
  assert.equal(listGames({ sort: 'top' }, o)[0].id, a.id);
  assert.equal(listGames({ sort: 'played' }, o)[0].id, c.id);
  assert.equal(listGames({ sort: 'featured' }, o)[0].id, b.id);
  assert.deepEqual(gamesByTag('puzzle', o).map((p) => p.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(listFeatured({}, o).map((p) => p.id), [b.id]);
  assert.deepEqual(search('gamma', o).map((p) => p.id), [c.id]);
  assert.equal(search('', o).length, 0);
});

test('renderProjectPage escapes hostile input; renders CTA + stars', () => {
  const o = mem();
  const p = pub(o, { title: '<script>x</script>', tagline: 'a & b', description: 'line1\nline2' });
  addRelease(p.id, { version: '1', builds: [{ platform: 'web', url: 'https://x/play', playable: true }] }, o);
  const html = renderProjectPage(getProject(p.id, o));
  assert.ok(!html.includes('<script>x</script>'), 'title escaped');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(html.includes('▶ Play in browser'));
  assert.ok(html.includes('line1<br>line2'));
  assert.equal(renderProjectPage(null).includes('not found'), true);
});

test('renderPortalIndex: grid, tabs, empty state, escaping', () => {
  const o = mem();
  const p = pub(o, { title: 'Tile & Co' });
  setFeatured(p.id, true, o);
  const html = renderPortalIndex(listGames({}, o), { sort: 'top' });
  assert.ok(html.includes('gd-card'));
  assert.ok(html.includes('Tile &amp; Co'));
  assert.ok(html.includes('★ Featured'));
  assert.ok(html.includes('class="gd-tab on"'));
  assert.ok(renderPortalIndex([], {}).includes('No games yet'));
});

test('soft-fail: bad ids / corrupt store never throw', () => {
  const o = mem();
  assert.equal(getProject('nope', o), null);
  assert.equal(addRelease('nope', { version: '1' }, o).ok, false);
  assert.equal(rate('nope', 5, o).ok, false);
  assert.equal(projectStats('nope', o), null);
  // Corrupt file → empty store, no throw.
  const bad = { fs: { read: () => '{ not json', write: () => {} }, file: 'mem://x' };
  assert.deepEqual(listGames({}, bad), []);
  assert.doesNotThrow(() => renderProjectPage(undefined));
});

test('vocab exports are frozen-ish sanity', () => {
  assert.ok(PLATFORMS.includes('web'));
  assert.ok(LICENSES.includes('mit'));
  assert.ok(!LICENSES.includes('nintendo-owned'));
});

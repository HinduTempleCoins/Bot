// webbuilder-persist.test.mjs — OFFLINE tests for the file-backed, MULTI-TENANT store (store.mjs) and
// its wiring into the server. Everything runs on an in-memory fs (injected) — no disk, no network. We
// prove: a saved/published site survives a fresh store instance (restart); sites are scoped per account
// (A can't read B); publish persists and reloads as servable; and the server routes persist through an
// injected store.

import { test } from 'node:test';
import assert from 'node:assert';
import { createSiteStore } from './store.mjs';
import { handler, __setStore, __reset, listSites, getSite, doSave, doPublish } from './server.mjs';

// ── an in-memory fs that satisfies the store's seam (readFileSync/writeFileSync/mkdirSync) ─────────────
function memFs() {
  const files = new Map();
  return {
    files,
    mkdirSync() { /* no-op: memory has no dirs */ },
    writeFileSync(p, data) { files.set(String(p), String(data)); },
    readFileSync(p) {
      const k = String(p);
      if (!files.has(k)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files.get(k);
    },
  };
}
const FILE = '/mem/webbuilder.json';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function post(path, body) {
  const res = mockRes();
  await handler({ method: 'POST', url: path, headers: { host: 'build.test' }, body }, res);
  return JSON.parse(res.body);
}
async function get(path) {
  const res = mockRes();
  await handler({ method: 'GET', url: path, headers: { host: 'build.test' }, body: undefined }, res);
  return res;
}

// ── store unit tests ──────────────────────────────────────────────────────────────────────────────────
test('store: a saved site survives a NEW store instance on the same file (restart)', () => {
  const fs = memFs();
  const s1 = createSiteStore({ fs, dataFile: FILE });
  s1.put('alice', 'mysite', { doc: { title: 'Alice Co' }, template: 'business' });
  // Fresh instance reading the SAME file = a process restart.
  const s2 = createSiteStore({ fs, dataFile: FILE });
  const back = s2.get('alice', 'mysite');
  assert.ok(back, 'site reloaded after restart');
  assert.equal(back.doc.title, 'Alice Co');
  assert.equal(back.account, 'alice');
  assert.equal(back.siteId, 'mysite');
});

test('store: multi-tenant isolation — account A cannot read account B by id alone', () => {
  const fs = memFs();
  const s = createSiteStore({ fs, dataFile: FILE });
  s.put('alice', 'shared-id', { doc: { title: 'Alice private' } });
  s.put('bob', 'other-id', { doc: { title: 'Bob private' } });
  assert.equal(s.get('alice', 'shared-id').doc.title, 'Alice private');
  assert.equal(s.get('bob', 'shared-id'), null, 'B cannot read A\'s site via the same id');
  assert.equal(s.get('alice', 'other-id'), null, 'A cannot read B\'s site via the same id');
  // list() is scoped to the owner only
  assert.deepEqual(listNames(s.list('alice')), ['Alice private']);
  assert.deepEqual(listNames(s.list('bob')), ['Bob private']);
});
const listNames = (arr) => arr.map((r) => r.doc.title);

test('store: a published site reloads as servable-by-slug; drafts are not', () => {
  const fs = memFs();
  const s1 = createSiteStore({ fs, dataFile: FILE });
  s1.put('carol', 'draftco', { doc: { title: 'Draft' } });                     // not published
  s1.put('carol', 'liveco', { doc: { title: 'Live' }, published: true, slug: 'liveco' });
  const s2 = createSiteStore({ fs, dataFile: FILE });
  assert.ok(s2.bySlug('liveco'), 'published site is found by slug after reload');
  assert.equal(s2.bySlug('liveco').doc.title, 'Live');
  assert.equal(s2.bySlug('draftco'), null, 'a draft is NOT servable by slug');
  assert.equal(s2.published().length, 1);
});

test('store: soft-fail — corrupt file and fs errors never throw', () => {
  const fs = memFs();
  fs.files.set(FILE, '{not json');                       // corrupt on disk
  const s = createSiteStore({ fs, dataFile: FILE });     // must not throw
  assert.deepEqual(s.published(), []);
  // a write that throws is swallowed (put returns the record; no crash)
  const boom = { readFileSync() { throw new Error('x'); }, writeFileSync() { throw new Error('x'); }, mkdirSync() {} };
  const s2 = createSiteStore({ fs: boom, dataFile: FILE });
  assert.doesNotThrow(() => s2.put('a', 'b', { doc: { title: 'ok' } }));
  assert.equal(s2.get('a', 'b').doc.title, 'ok');        // in-memory still works even if persist failed
});

// ── server wiring tests (routes persist through an injected store) ────────────────────────────────────
test('server: /api/save persists per account and reload reads it back', async () => {
  const fs = memFs();
  __setStore(createSiteStore({ fs, dataFile: FILE }));
  __reset(); // clears the freshly-injected store's memory (empty file anyway)
  const r = await post('/api/save', { account: 'dan', siteId: 'blog', template: 'personal', doc: { title: 'Dan Blog', category: 'personal', sections: [] } });
  assert.equal(r.ok, true);
  assert.equal(r.account, 'dan');
  assert.equal(r.siteId, 'blog');
  // it is listable + gettable through the exported seams, scoped to the owner
  assert.equal(getSite('dan', 'blog').doc.title, 'Dan Blog');
  assert.equal(getSite('erin', 'blog'), null, 'another account cannot read it');
  assert.equal(listSites('dan').length, 1);
  // reload: a brand-new store on the same file sees the saved draft
  const reloaded = createSiteStore({ fs, dataFile: FILE });
  assert.equal(reloaded.get('dan', 'blog').doc.title, 'Dan Blog');
});

test('server: /api/publish persists — a fresh store reload still serves the page', async () => {
  const fs = memFs();
  __setStore(createSiteStore({ fs, dataFile: FILE }));
  __reset();
  const pub = await post('/api/publish', { account: 'fay', ren: 'faysite', template: 'business', doc: { title: 'Fay Site', category: 'business', sections: [{ type: 'text', heading: 'Hi', body: 'hello' }] } });
  assert.equal(pub.ok, true);
  assert.equal(pub.slug, 'faysite');
  // served now
  assert.equal((await get('/p/faysite')).code, 200);
  // simulate a restart: re-inject a fresh store bound to the SAME file, then serve again
  __setStore(createSiteStore({ fs, dataFile: FILE }));
  const page = await get('/p/faysite');
  assert.equal(page.code, 200, 'published page survives a restart');
  assert.match(page.body, /Fay Site/);
  // and it is owned by fay
  assert.equal(getSite('fay', 'faysite').published, true);
});

test('server: attach-domain persistence survives a reload', async () => {
  const fs = memFs();
  __setStore(createSiteStore({ fs, dataFile: FILE }));
  __reset();
  await post('/api/publish', { account: 'gil', ren: 'gilco', template: 'business', doc: { title: 'Gil Co', category: 'business', sections: [] } });
  const att = await post('/api/attach-domain', { slug: 'gilco', domain: 'www.gilco.com' });
  assert.equal(att.ok, true);
  // reload and confirm the pending domain state persisted
  const reloaded = createSiteStore({ fs, dataFile: FILE });
  const rec = reloaded.get('gil', 'gilco');
  assert.equal(rec.domain, 'gilco.com'); // normDomain strips the leading www.
  assert.equal(rec.domainStatus, 'pending');
});

test('server: publish under no account defaults to the shared public tenant (back-compat)', async () => {
  const fs = memFs();
  __setStore(createSiteStore({ fs, dataFile: FILE }));
  __reset();
  const pub = await post('/api/publish', { ren: 'legacyco', template: 'business', doc: { title: 'Legacy', category: 'business', sections: [] } });
  assert.equal(pub.ok, true);
  assert.equal(getSite('public', 'legacyco').doc.title, 'Legacy'); // landed under DEFAULT_ACCOUNT
  assert.equal((await get('/p/legacyco')).code, 200);
});

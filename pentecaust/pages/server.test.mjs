// OFFLINE. In-memory fs, injected whoami. No disk, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './server.mjs';
import { createSiteStore } from '../../site/webbuilder/store.mjs';

function memStore() {
  let buf = null;
  const fs = {
    readFileSync: () => { if (buf === null) throw new Error('enoent'); return buf; },
    writeFileSync: (_p, s) => { buf = s; },
    mkdirSync: () => {},
  };
  return createSiteStore({ fs, dataFile: () => 'mem.json' });
}
const cap = () => { const o = { code: 0, body: '' }; return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o }; };
const call = async (who, method, url, body, store) => {
  const { res, o } = cap();
  await handler({ method, url, body }, res, { whoami: () => who, store });
  let parsed; try { parsed = JSON.parse(o.body); } catch { parsed = {}; }
  return { code: o.code, body: parsed };
};

test('a published page is readable by somebody who is NOT signed in — that is what a page is', async () => {
  const store = memStore();
  await call('alice', 'POST', '/pages', { title: 'Brujeria Circle', body: 'hello', published: true }, store);
  const pub = await call(null, 'GET', '/p/brujeria-circle', null, store);
  assert.equal(pub.code, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.page.title, 'Brujeria Circle');
});

test('an UNpublished page is not public', async () => {
  const store = memStore();
  await call('alice', 'POST', '/pages', { title: 'Draft', body: 'x', published: false }, store);
  assert.equal((await call(null, 'GET', '/p/draft', null, store)).code, 404);
});

test('⚠️ TENANCY — one account can never read or edit another account\'s page', async () => {
  // The store returns null across a tenant boundary, but only if it is handed the right owner. An
  // editor that takes an owner parameter is an editor that edits other people's pages.
  const store = memStore();
  const made = await call('alice', 'POST', '/pages', { title: 'Alice Page', body: 'secret' }, store);
  const id = made.body.page.siteId;

  assert.equal((await call('mallory', 'GET', `/pages/${id}`, null, store)).code, 404,
    "mallory must not read alice's page by id");
  assert.deepEqual((await call('mallory', 'GET', '/pages', null, store)).body.pages, []);

  // and writing to the same id creates MALLORY's own page, never touching alice's
  await call('mallory', 'POST', '/pages', { id, title: 'Hijacked', body: 'mine' }, store);
  const alices = await call('alice', 'GET', `/pages/${id}`, null, store);
  assert.equal(alices.body.page.title, 'Alice Page', "alice's page must be untouched");
  assert.equal(alices.body.page.body, 'secret');
});

test('⛔ a published slug is GLOBAL — a collision is refused, not silently repointed', async () => {
  // The store would happily overwrite the slug index and send somebody else's public URL here.
  const store = memStore();
  await call('alice', 'POST', '/pages', { title: 'The Circle', published: true }, store);
  const clash = await call('mallory', 'POST', '/pages', { title: 'The Circle', published: true }, store);
  assert.equal(clash.code, 409, 'the second claim on a live slug must fail');
  assert.equal((await call(null, 'GET', '/p/the-circle', null, store)).body.page.account, 'alice');
});

test('publish is a separate act, and it also checks the slug', async () => {
  const store = memStore();
  const made = await call('alice', 'POST', '/pages', { title: 'Later', body: 'x' }, store);
  const id = made.body.page.siteId;
  assert.equal((await call(null, 'GET', '/p/later', null, store)).code, 404);

  const pub = await call('alice', 'POST', `/pages/${id}/publish`, {}, store);
  assert.equal(pub.body.page.published, true);
  assert.equal((await call(null, 'GET', '/p/later', null, store)).code, 200);

  // unpublish
  await call('alice', 'POST', `/pages/${id}/publish`, { published: false }, store);
  assert.equal((await call(null, 'GET', '/p/later', null, store)).body.page, undefined);
});

test('a messenger handle gets a page too, and every write refuses an anonymous caller', async () => {
  const store = memStore();
  const r = await call('~gox1y2z3w4', 'POST', '/pages', { title: 'Handle Page', published: true }, store);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal((await call(null, 'POST', '/pages', { title: 'x' }, store)).code, 401);
  assert.equal((await call(null, 'GET', '/pages', null, store)).code, 401);
});

test('a page may front a Group; a Group never owns a Page', async () => {
  const store = memStore();
  const r = await call('alice', 'POST', '/pages', { title: 'Clan Front', group: 'night-hawks' }, store);
  assert.equal(r.body.page.group, 'night-hawks');
  const plain = await call('alice', 'POST', '/pages', { title: 'No Group' }, store);
  assert.equal(plain.body.page.group, null);
});

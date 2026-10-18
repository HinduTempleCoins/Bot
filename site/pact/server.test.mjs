// OFFLINE. No network, no disk beyond the model's injectable store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PENTECAUST_SESSION_SECRET = 'pact-test-secret';
process.env.SSO_ALLOWED_ORIGINS = 'https://pact.pentecaust.com';
process.env.BASE_URL = 'https://pact.pentecaust.com';
process.env.GROUPS_DATA = (await import('node:path')).join((await import('node:os')).tmpdir(), `pact-groups-${process.pid}.json`);
const { handler } = await import('./server.mjs');
const { makeSiblingSession, COOKIE } = await import('../../pentecaust/sso.mjs');

const cap = () => { const o = { code: 0, body: '', headers: {} }; return { res: { writeHead: (c, h) => { o.code = c; o.headers = h || {}; }, end: (b) => { o.body = b || ''; } }, o }; };
const req = (url, method = 'GET', body, cookie) => ({ url, method, body, headers: cookie ? { cookie } : {} });
const cookieFor = (a) => `${COOKIE}=${encodeURIComponent(makeSiblingSession(a))}`;
const J = (o) => { try { return JSON.parse(o.body); } catch { return {}; } };

test('the front page renders signed-out and offers sign-in', async () => {
  const { res, o } = cap();
  await handler(req('/'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /Sign in with MELEK/);
  assert.match(o.body, /A pact is a binding agreement/);
  assert.ok(!/Log out/.test(o.body));
});

test('signed-in state is rendered SERVER-side so it is right on first paint', async () => {
  const { res, o } = cap();
  await handler(req('/', 'GET', undefined, cookieFor('hathor')), res);
  assert.match(o.body, /@hathor/);
  assert.match(o.body, /Log out/);
  assert.ok(!/Sign in with MELEK/.test(o.body));
});

test('⭐ identity comes from the SSO ticket session, and drives the group API', async () => {
  const c = cookieFor('alice');
  let { res, o } = cap();
  await handler(req('/groups', 'POST', { name: 'First Pact' }, c), res);
  assert.equal(J(o).ok, true, o.body);
  const id = J(o).group.id;

  ({ res, o } = cap());
  await handler(req(`/groups/${id}/me`, 'GET', undefined, c), res);
  assert.equal(J(o).role, 'owner');

  // …and anonymous cannot write
  ({ res, o } = cap());
  await handler(req('/groups', 'POST', { name: 'Nope' }), res);
  assert.equal(o.code, 401);
});

test('/auth/login bounces to Pentecaust, not to a local form', async () => {
  const { res, o } = cap();
  await handler(req('/auth/login'), res);
  assert.equal(o.code, 302);
  assert.match(o.headers.location, /^https:\/\/pentecaust\.com\/auth\/sso\?return=/);
  assert.match(decodeURIComponent(o.headers.location), /pact\.pentecaust\.com\/auth\/callback/);
});

test('the directory is public — you can see the pacts before signing in', async () => {
  const { res, o } = cap();
  await handler(req('/groups'), res);
  assert.equal(o.code, 200);
  assert.ok(Array.isArray(J(o).groups));
  assert.ok(J(o).joinPolicies.includes('dues'), 'clubs are a join policy, not a separate product');
});

test('health, robots and sitemap answer; anything else is a 404', async () => {
  for (const [p, re] of [['/health', /ok/], ['/robots.txt', /User-agent/i], ['/sitemap.xml', /<urlset/]]) {
    const { res, o } = cap();
    await handler(req(p), res);
    assert.equal(o.code, 200, p);
    assert.match(o.body, re, p);
  }
  const { res, o } = cap();
  await handler(req('/nonsense'), res);
  assert.equal(o.code, 404);
});

test('the home page script parses (a broken quote once blanked the whole group list)', async () => {
  const { res, o } = cap();
  await handler(req('/', 'GET'), res);
  const js = o.body.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new Function(js));
});

test('a joined pact card carries an Open link to its club page', async () => {
  const { res, o } = cap();
  await handler(req('/', 'GET', undefined, cookieFor('hathor')), res);
  assert.ok(o.body.includes(`href="/g/'+encodeURIComponent(g.id)+'">Open</a>`));
});

test('the club page /g/<id> renders, escapes, and its script parses (signed in and out)', async () => {
  for (const c of [cookieFor('alice'), undefined]) {
    const { res, o } = cap();
    await handler(req('/g/first-pact', 'GET', undefined, c), res);
    assert.equal(o.code, 200);
    assert.match(o.body, /const ID="first-pact"/);
    const js = o.body.split('<script>')[1].split('</script>')[0];
    assert.doesNotThrow(() => new Function(js));
    for (const s of ['/applicants', '/decline', '/approve', '/kick', '/board', '/setup', '/titles', '/office', '/publish-role', 'Edit club setup', 'admitted ']) {
      assert.ok(o.body.includes(s), `club page wires ${s}`);
    }
  }
  const { res, o } = cap();
  await handler(req('/g/%3Cscript%3E', 'GET'), res);
  assert.equal(o.code, 404, 'a club id that is not a slug never reaches the page');
});

test('the club page script runs end to end for an owner against the real routes (stub DOM)', async () => {
  const alice = cookieFor('alice');
  const call = async (url, method = 'GET', body, c = alice) => { const { res, o } = cap(); await handler(req(url, method, body, c), res); return J(o); };
  const id = (await call('/groups', 'POST', { name: 'Door Test', joinPolicy: 'apply' })).group.id;
  await call(`/groups/${id}/join`, 'POST', {}, cookieFor('zedd'));
  await call(`/groups/${id}/board`, 'POST', { title: 'Hello', body: 'first draft' });

  const els = {};
  const el = (k) => (els[k] = els[k] || { innerHTML: '', textContent: '', value: '', hidden: false, dataset: {} });
  const document = { getElementById: el, querySelectorAll: () => [], querySelector: () => el('_q') };
  const fetch = async (url, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : undefined;
    const r = await call(url, (o.method || 'GET'), body);
    return { json: async () => r };
  };
  const { res, o } = cap();
  await handler(req(`/g/${id}`, 'GET', undefined, alice), res);
  const js = o.body.split('<script>')[1].split('</script>')[0];
  await new Function('document', 'fetch', 'location', js.replace(/load\(\);\s*$/, 'return load();'))(document, fetch, {});
  assert.equal(els.gname.textContent, 'Door Test');
  assert.match(els.body.innerHTML, /@alice/);
  assert.match(els.apps.innerHTML, /data-ap="zedd"/);
  assert.match(els.apps.innerHTML, /data-dc="zedd"/);
  assert.match(els.board.innerHTML, /first draft/);
  assert.match(els.board.innerHTML, /data-ok=/, 'the owner holds the publish rank and sees Approve');
  assert.match(els.ranks.innerHTML, /data-name="tyler"/);
  assert.match(els.tset.innerHTML, /lodge/);
  assert.match(els.ofname.innerHTML, /Treasurer/);
  assert.match(els.prole.innerHTML, /and up/);
});

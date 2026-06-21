// server.test.mjs — Pentecaust Messaging API. OFFLINE. Temp roster + chat files via env; never throws.
// DEV_TRUST is ON so most tests can assert identity via query/body; the auth tests below flip a verifier
// on to prove production behaviour (verified identity only; the IDOR is closed).
import { test } from 'node:test';
import assert from 'node:assert';
process.env.TEAMS_DATA = `/tmp/teams-srv-${process.pid}.json`;
process.env.TEAMS_CHAT_DATA = `/tmp/teams-srv-chat-${process.pid}.json`;
process.env.PENTECAUST_DEV_TRUST = '1';
const { handler, __setAuthVerifier, __setChainFetch } = await import('./server.mjs');

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
function req(path, method = 'GET', bodyObj) {
  const h = {};
  const r = { url: path, method, headers: {}, socket: { remoteAddress: '1.2.3.4' }, on: (e, fn) => { h[e] = fn; return r; }, destroy: () => {} };
  queueMicrotask(() => { if (bodyObj !== undefined && h.data) h.data(JSON.stringify(bodyObj)); if (h.end) h.end(); });
  return r;
}
const j = (o) => JSON.parse(o.body);

test('GET / serves the AIM-style dashboard (Messages/Email/Channels, Friends, Alpha)', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /Pentecaust<\/b> Messaging/);
  assert.match(o.body, /Alpha/);
  assert.match(o.body, /Messages/); assert.match(o.body, /Email/); assert.match(o.body, /Channels/); // the three tabs
  assert.match(o.body, /Friends/);                  // friends-first dashboard
  assert.match(o.body, /Direct messages/);          // DM is the default
  assert.match(o.body, /Team & Game Channels/);     // channels = the advanced, explained tab
  assert.match(o.body, /pentecaust\.com/);          // email address format shown
});

test('GET /following and /followers read the chain follow graph (for the friends list groups)', async () => {
  // inject a fake chain RPC: get_following → [bob,carol], get_followers → [dave]
  __setChainFetch(async (_url, opts) => {
    const m = JSON.parse(opts.body).method;
    const result = m.endsWith('get_following')
      ? [{ follower: 'alice', following: 'bob', what: ['blog'] }, { follower: 'alice', following: 'carol', what: ['blog'] }]
      : [{ follower: 'dave', following: 'alice', what: ['blog'] }];
    return { json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  let { res, o } = cap(); await handler(req('/following?account=alice'), res);
  assert.equal(o.code, 200); assert.deepEqual(j(o).following, ['bob', 'carol']);
  ({ res, o } = cap()); await handler(req('/followers?account=alice'), res);
  assert.deepEqual(j(o).followers, ['dave']);
  // soft-fail: a dead RPC → empty list, never throws
  __setChainFetch(async () => { throw new Error('rpc down'); });
  ({ res, o } = cap()); await handler(req('/following?account=alice'), res);
  assert.deepEqual(j(o).following, []);
  ({ res, o } = cap()); await handler(req('/following'), res);   // no account → 422
  assert.equal(o.code, 422);
  __setChainFetch(null);
});

test('create → directory → fetch one team', async () => {
  let { res, o } = cap(); await handler(req('/teams', 'POST', { name: 'Van Kush Family', owner: 'ryan', kind: 'alliance', tag: 'VKF' }), res);
  const c = j(o); assert.equal(c.ok, true); assert.equal(c.team.kind, 'alliance'); assert.equal(c.team.tag, 'VKF');
  const id = c.team.id;
  ({ res, o } = cap()); await handler(req('/teams'), res);
  assert.ok(j(o).teams.some((t) => t.id === id));
  ({ res, o } = cap()); await handler(req('/teams/' + id), res);
  assert.equal(j(o).team.name, 'Van Kush Family');
});

test('join → team chat post → member reads it; non-member is 403', async () => {
  const c = j((await (async () => { const { res, o } = cap(); await handler(req('/teams', 'POST', { name: 'Raiders', owner: 'ryan' }), res); return o; })()));
  const id = c.team.id;
  // steve joins (open team)
  let { res, o } = cap(); await handler(req('/teams/' + id + '/join', 'POST', { account: 'steve' }), res);
  assert.equal(j(o).status, 'joined');
  // steve posts from Minecraft
  ({ res, o } = cap()); await handler(req('/teams/' + id + '/chat', 'POST', { from: 'steve', text: 'mining', game: 'minecraft' }), res);
  assert.equal(j(o).ok, true);
  // ryan (member) reads — sees the cross-game tag
  ({ res, o } = cap()); await handler(req('/teams/' + id + '/chat?account=ryan'), res);
  const r = j(o); assert.equal(r.ok, true); assert.equal(r.messages.at(-1).text, 'mining'); assert.equal(r.messages.at(-1).game, 'minecraft');
  // mallory (not a member) is refused
  ({ res, o } = cap()); await handler(req('/teams/' + id + '/chat?account=mallory'), res);
  assert.equal(o.code, 403);
});

test('non-member cannot post to a team channel', async () => {
  const c = j((await (async () => { const { res, o } = cap(); await handler(req('/teams', 'POST', { name: 'Closed Crew', owner: 'ryan' }), res); return o; })()));
  const { res, o } = cap(); await handler(req('/teams/' + c.team.id + '/chat', 'POST', { from: 'mallory', text: 'sneak' }), res);
  assert.equal(j(o).ok, false);
});

test('DM round-trip + inbox', async () => {
  let { res, o } = cap(); await handler(req('/dm', 'POST', { from: 'steve', to: 'alex', text: 'portal?' }), res);
  assert.equal(j(o).ok, true);
  ({ res, o } = cap()); await handler(req('/dm?me=alex&with=steve'), res);
  assert.equal(j(o).messages[0].text, 'portal?');
  ({ res, o } = cap()); await handler(req('/inbox?account=alex'), res);
  assert.equal(j(o).threads[0].with, 'steve');
});

test('me/teams lists every team an account is in', async () => {
  await handler(req('/teams', 'POST', { name: 'Group One', owner: 'dora' }), cap().res);
  await handler(req('/teams', 'POST', { name: 'Group Two', owner: 'dora' }), cap().res);
  const { res, o } = cap(); await handler(req('/me/teams?account=dora'), res);
  assert.ok(j(o).teams.length >= 2);
});

// send a raw (possibly malformed) body string, not JSON.stringify'd
function rawReq(path, method, rawStr) {
  const h = {};
  const r = { url: path, method, headers: {}, socket: { remoteAddress: '9.9.9.9' }, on: (e, fn) => { h[e] = fn; return r; }, destroy: () => {} };
  queueMicrotask(() => { if (rawStr != null && h.data) h.data(rawStr); if (h.end) h.end(); });
  return r;
}

test('CORS preflight 204; malformed json 400; validation ok:false; unknown route 404', async () => {
  let { res, o } = cap(); await handler(req('/teams', 'OPTIONS'), res);
  assert.equal(o.code, 204);
  ({ res, o } = cap()); await handler(rawReq('/teams', 'POST', '{not json'), res);   // malformed → 400
  assert.equal(o.code, 400); assert.match(j(o).reason, /json/);
  ({ res, o } = cap()); await handler(req('/teams', 'POST', { name: 'x', owner: 'ryan' }), res); // has identity, bad name → validation
  assert.equal(o.code, 200); assert.equal(j(o).ok, false);
  ({ res, o } = cap()); await handler(req('/teams', 'POST', { name: 'No Identity' }), res);       // no owner → no identity → 401
  assert.equal(o.code, 401);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});

// ── security: identity comes from a VERIFIED source, never a named query/body field (IDOR closed) ──
test('a verified identity cannot be impersonated — naming someone else does not leak their DMs', async () => {
  // alex (verified) sends steve a DM
  __setAuthVerifier(() => 'alex');
  let { res, o } = cap(); await handler(req('/dm', 'POST', { to: 'steve', text: 'secret plans' }), res);
  assert.equal(j(o).ok, true);
  // now mallory is the verified caller and tries to read alex↔steve by claiming ?me=alex — must NOT work
  __setAuthVerifier(() => 'mallory');
  ({ res, o } = cap()); await handler(req('/dm?me=alex&with=steve'), res);
  assert.equal(o.code, 200);
  assert.deepEqual(j(o).messages, []);              // mallory sees her own (empty) thread, not alex's
  // and the DM is written AS the verified account, not the body's `from`
  ({ res, o } = cap()); await handler(req('/dm', 'POST', { from: 'alex', to: 'steve', text: 'forged' }), res);
  assert.equal(j(o).message.from, 'mallory');        // from is the verified caller, not the claimed 'alex'
  __setAuthVerifier(null);
});

test('no verified identity → private reads/writes are 401 (deny by default)', async () => {
  __setAuthVerifier(() => null);                     // a verifier is present but certifies no one
  for (const p of ['/inbox?account=alex', '/me/teams?account=alex', '/dm?me=alex&with=steve']) {
    const { res, o } = cap(); await handler(req(p), res);
    assert.equal(o.code, 401, `${p} must require auth`);
  }
  const { res, o } = cap(); await handler(req('/dm', 'POST', { to: 'steve', text: 'x' }), res);
  assert.equal(o.code, 401);
  // the public team directory stays open (no private data)
  const c2 = cap(); await handler(req('/teams'), c2.res); assert.equal(c2.o.code, 200);
  __setAuthVerifier(null);
});

// OFFLINE. Injected whoami + in-memory store; no network, no disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './server.mjs';

function memOpts() {
  let buf = null;
  return { fs: { read: () => buf, write: (_p, s) => { buf = s; } }, file: 'mem.json' };
}
const cap = () => { const o = { code: 0, body: '' }; return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o }; };
const J = (o) => { try { return JSON.parse(o.body); } catch { return {}; } };
const call = async (who, method, url, body, opts) => {
  const { res, o } = cap();
  await handler({ method, url, body }, res, { whoami: () => who, opts });
  return { code: o.code, body: J(o) };
};

test('the directory is public — you can see what exists before signing up', async () => {
  const opts = memOpts();
  await call('alice', 'POST', '/groups', { name: 'Diaspora Brujeria', kind: 'community' }, opts);
  const r = await call(null, 'GET', '/groups', null, opts);
  assert.equal(r.code, 200);
  assert.equal(r.body.groups.length, 1);
  assert.ok(r.body.joinPolicies.includes('token'));
});

test('⚠️ every private read is session-only', async () => {
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'G One' }, opts)).body.group.id;
  for (const url of ['/me/groups', `/groups/${id}/me`]) {
    assert.equal((await call(null, 'GET', url, null, opts)).code, 401, `${url} must refuse anonymous`);
  }
  const mine = await call('alice', 'GET', `/groups/${id}/me`, null, opts);
  assert.equal(mine.body.role, 'owner');
  assert.equal(mine.body.channel, `group:${id}`);
});

test('⭐ the ACTOR comes from the session, never the body — or the role system is decoration', async () => {
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'G One' }, opts)).body.group.id;
  await call('mallory', 'POST', `/groups/${id}/join`, {}, opts);

  // mallory is a plain member. Naming alice as the actor must not grant her power.
  const attempt = await call('mallory', 'POST', `/groups/${id}/role`,
    { actor: 'alice', account: 'mallory', role: 'admin' }, opts);
  assert.notEqual(attempt.body.ok, true, 'a body field must never select the actor');
  const after = await call('mallory', 'GET', `/groups/${id}/me`, null, opts);
  assert.equal(after.body.role, 'member', 'mallory must still be a member');

  // and creating a group always owns it to the session, not to a named owner
  const id2 = (await call('bob', 'POST', '/groups', { name: 'G Two', owner: 'alice' }, opts)).body.group.id;
  assert.equal((await call('bob', 'GET', `/groups/${id2}/me`, null, opts)).body.role, 'owner');
});

test('a messenger handle is a first-class member — that is the point of mounting here', async () => {
  // Somebody who signed in with Google and has no MELEK account at all still gets '~go…', and a group
  // they cannot join is a group they will never come back to.
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'G One', joinPolicy: 'open' }, opts)).body.group.id;
  const joined = await call('~gox1y2z3w4', 'POST', `/groups/${id}/join`, {}, opts);
  assert.equal(joined.body.ok, true, JSON.stringify(joined.body));

  // ⛔ …but a handle may NOT own one: a group's durable layer is an on-chain community account and a
  // handle has no chain identity to link, and an owner holds real power over other people.
  const owned = await call('~gox1y2z3w4', 'POST', '/groups', { name: 'Handle Owned' }, opts);
  assert.notEqual(owned.body.ok, true, 'owning a group must require a proven MELEK account');
  const mine = await call('~gox1y2z3w4', 'GET', '/me/groups', null, opts);
  assert.equal(mine.body.groups.length, 1);
});

test('an unknown group is a 404, not a 500 or an empty success', async () => {
  const opts = memOpts();
  assert.equal((await call(null, 'GET', '/groups/nope', null, opts)).code, 404);
  assert.equal((await call(null, 'GET', '/groups/nope/feed', null, opts)).code, 404);
  assert.equal((await call('alice', 'GET', '/groups/nope/me', null, opts)).code, 404);
  assert.equal((await call('alice', 'POST', '/groups/g1/nonsense', {}, opts)).code, 404);
});

test('posting returns the chain metadata and indexes the pointer, and a non-member cannot post', async () => {
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'G One' }, opts)).body.group.id;
  const outsider = await call('eve', 'POST', `/groups/${id}/post`, { permlink: 'p', title: 'T' }, opts);
  assert.notEqual(outsider.body.ok, true, 'a non-member must not be able to post');

  const posted = await call('alice', 'POST', `/groups/${id}/post`, { permlink: 'hello', title: 'Hello' }, opts);
  assert.equal(posted.body.ok, true, JSON.stringify(posted.body));
  const feed = await call(null, 'GET', `/groups/${id}/feed`, null, opts);
  assert.equal(feed.body.feed.length, 1);
  assert.equal(feed.body.feed[0].author, 'alice');
});

test('a malformed body is a 400, and every write refuses an anonymous caller', async () => {
  const opts = memOpts();
  const { res, o } = cap();
  await handler({ method: 'POST', url: '/groups', on: (e, fn) => { if (e === 'data') fn('{not json'); if (e === 'end') fn(); }, destroy: () => {} },
    res, { whoami: () => 'alice', opts });
  assert.equal(o.code, 400);
  assert.equal((await call(null, 'POST', '/groups', { name: 'X Group' }, opts)).code, 401);
});

test('⭐ a group linked to a Team shares the Team\'s chat — one conversation, not two', async () => {
  // Teams are the chat primitive; Groups are the content primitive. A clan that gets a public feed
  // must not acquire a second, empty chat room — nobody migrates and both rooms die.
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'Clan Feed' }, opts)).body.group.id;

  const before = await call('alice', 'GET', `/groups/${id}/me`, null, opts);
  assert.equal(before.body.channel, `group:${id}`, 'unlinked, a group owns its own channel');
  assert.equal(before.body.team, null);

  assert.equal((await call('alice', 'POST', `/groups/${id}/team`, { team: 'night-hawks' }, opts)).body.ok, true);
  const after = await call('alice', 'GET', `/groups/${id}/me`, null, opts);
  assert.equal(after.body.channel, 'team:night-hawks', 'linked, the chat IS the team chat');
  assert.equal(after.body.team, 'night-hawks');

  // unlinking returns it to its own channel
  await call('alice', 'POST', `/groups/${id}/team`, { team: '' }, opts);
  assert.equal((await call('alice', 'GET', `/groups/${id}/me`, null, opts)).body.channel, `group:${id}`);
});

test('⚠️ only owner/admin may relink a group to a different Team', async () => {
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'Clan Feed' }, opts)).body.group.id;
  await call('mallory', 'POST', `/groups/${id}/join`, {}, opts);
  const attempt = await call('mallory', 'POST', `/groups/${id}/team`, { team: 'mallorys-clan' }, opts);
  assert.notEqual(attempt.body.ok, true, 'a member repointing the chat would hijack the conversation');
});

test('⛔ a dues club cannot be joined by CLAIMING to have paid', async () => {
  // This is the whole security property. If a caller could assert payment, club membership would be
  // free to anybody who can shape a request — the same failure as a body-selected actor.
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'Paid Club', joinPolicy: 'dues' }, opts)).body.group.id;
  await call('alice', 'POST', `/groups/${id}/dues`,
    { dues: { amount: 500, currency: 'usd', period: 'monthly', rail: 'organizer-processor', payee: 'alice' } }, opts);

  for (const body of [{}, { paid: true }, { paid: 'true' }, { dues: { paid: true } }]) {
    const r = await call('mallory', 'POST', `/groups/${id}/join`, body, opts);
    assert.equal(r.body.status, 'dues-required', `claiming payment must never admit: ${JSON.stringify(body)}`);
  }
  assert.equal((await call('mallory', 'GET', `/groups/${id}/me`, null, opts)).body.member, false);

  // an invite is a comped membership and still works
  await call('alice', 'POST', `/groups/${id}/invite`, { account: 'guest' }, opts);
  assert.equal((await call('guest', 'POST', `/groups/${id}/join`, {}, opts)).body.ok, true);
});

test('dues terms are non-custodial and stored in minor units', async () => {
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'Club Two', joinPolicy: 'dues' }, opts)).body.group.id;
  const r = await call('alice', 'POST', `/groups/${id}/dues`,
    { dues: { amount: 1500, currency: 'usd', period: 'yearly', rail: 'wallet', payee: 'alice', benefitsValue: 300 } }, opts);
  const d = r.body.group.dues;
  assert.equal(d.amount, 1500, 'minor units — never a float');
  assert.equal(d.currency, 'USD');
  assert.equal(d.rail, 'wallet');
  assert.equal(d.deductible, false, 'deductibility is never asserted by the club itself');

  // an unknown rail falls back rather than being trusted
  const bad = await call('alice', 'POST', `/groups/${id}/dues`,
    { dues: { amount: 100, rail: 'send-it-to-the-platform' } }, opts);
  assert.equal(bad.body.group.dues.rail, 'organizer-processor');
});

test('⚠️ deductibility follows the Witness School determination, never a claim', async () => {
  // Membership dues to a 501(c)(3) are only partly deductible, and a club asserting otherwise is
  // making a tax representation on somebody else's return.
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'School Club', joinPolicy: 'dues' }, opts)).body.group.id;
  await call('alice', 'POST', `/groups/${id}/dues`, { dues: { amount: 2000, deductible: true } }, opts);
  assert.equal((await call(null, 'GET', `/groups/${id}`, null, opts)).body.group.dues.deductible, false,
    'a club may not declare its own dues deductible');

  await call('alice', 'POST', `/groups/${id}/charter`,
    { charter: { purpose: 'Study', cadence: 'monthly', feed: 'https://x.test/rss', series: 1, witnessSchool: true } }, opts);
  const g = (await call(null, 'GET', `/groups/${id}`, null, opts)).body.group;
  assert.equal(g.dues.deductible, true, 'the determination is what raises it');
  assert.equal(g.charter.series, 1);
  assert.equal(g.charter.feed, 'https://x.test/rss');
});

test('⚠️ only owner/admin may set dues or the charter', async () => {
  const opts = memOpts();
  const id = (await call('alice', 'POST', '/groups', { name: 'Club Three' }, opts)).body.group.id;
  await call('mallory', 'POST', `/groups/${id}/join`, {}, opts);
  assert.notEqual((await call('mallory', 'POST', `/groups/${id}/dues`, { dues: { amount: 1 } }, opts)).body.ok, true);
  assert.notEqual((await call('mallory', 'POST', `/groups/${id}/charter`, { charter: { purpose: 'x' } }, opts)).body.ok, true);
});

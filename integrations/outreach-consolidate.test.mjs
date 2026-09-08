// outreach-consolidate.test.mjs — OFFLINE. No fetch, no filesystem, no network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  consolidate, fromHolderRows, fromProfileSocials, fromHubPages, sharedValues, toRows, toCsv,
  isAddressable, routeUrl, handler, looksNameDerived,
  searchTargets, SEARCH_TIERS, NETWORK_SEARCH_PRIORITY, normHandle,
} from './outreach-consolidate.mjs';

const holder = (o) => ({ hive_account: 'alice', website: 'https://alice.example', ...o });

test('a holder CSV row becomes candidate routes', () => {
  const c = fromHolderRows([holder({ email: 'a@alice.example', email_found_on: 'https://alice.example/contact', x_handle: 'aliceh' })]);
  const nets = c.map((r) => r.net).sort();
  assert.deepEqual(nets, ['email', 'website', 'x']);
  assert.equal(c.find((r) => r.net === 'email').source, 'holder-csv');
});

test('a platform page never enters as a website route', () => {
  const c = fromHolderRows([holder({ website: 'https://peakd.com/@alice' })]);
  assert.equal(c.some((r) => r.net === 'website'), false);
});

test('profile metadata becomes candidate routes, junk handles dropped', () => {
  const c = fromProfileSocials([{ account: 'bob', socials: { facebook: ['profile.php'], tiktok: ['@bobby'], website: ['https://bob.example'] } }]);
  assert.equal(c.some((r) => r.net === 'facebook'), false);
  assert.equal(c.find((r) => r.net === 'tiktok').value, 'bobby');
  assert.equal(c.find((r) => r.net === 'website').value, 'https://bob.example');
});

test('a hub page carries the page it was read from and the handle that owns it', () => {
  const c = fromHubPages([{ account: 'cara', hub: 'https://linktr.ee/cara', emails: [{ email: 'c@gmail.com' }], socials: { tiktok: ['carat'], linktree: ['cara'] } }]);
  const e = c.find((r) => r.net === 'email');
  assert.equal(e.page, 'https://linktr.ee/cara');
  assert.equal(e.ctx.hubOwnedBy, 'cara');
  assert.equal(c.some((r) => r.net === 'linktree'), false);   // the hub linking to itself
});

// ── the gate ──────────────────────────────────────────────────────────────────────────────────────
test('the 111-that-were-23 shape cannot get through this module', () => {
  const hubPages = [];
  for (let i = 0; i < 111; i += 1) {
    hubPages.push({
      account: `h${i}`, hub: `https://linktr.ee/h${i}`,
      emails: [{ email: 'only@savagex.com' }, { email: 'online@www.aaa.com' }, { email: `real${i}@gmail.com` }],
      socials: {},
    });
  }
  const r = consolidate({ hubPages });
  assert.equal(r.stats.refused.boilerplate, 222);
  assert.equal(r.stats.withEmail, 111);
  assert.equal(r.stats.routes, 111);
  for (const p of r.people) assert.equal(p.routes[0].verdict, 'hub-published');
});

test('an address that is not his does not become a route, whatever file it arrived in', () => {
  const r = consolidate({ holderRows: [holder({ email: 'hello@read.cash', website: 'https://read.cash/@alice' })] });
  assert.equal(r.stats.withEmail, 0);
  assert.equal(r.stats.refused.attribution, 1);
  assert.match(r.reasons[0].why, /support desk/);
});

test('one inbox under several accounts belongs to none of them', () => {
  const rows = ['a', 'b', 'c'].map((n) => holder({ hive_account: n, email: 'shared@service.example', website: 'https://service.example', email_found_on: 'https://service.example/contact' }));
  const r = consolidate({ holderRows: rows });
  assert.equal(r.stats.withEmail, 0);
  // 3 emails + the 3 copies of the shared website — a service's site is no more his than its inbox.
  assert.equal(r.stats.refused.shared, 6);
  assert.equal(r.shared[0].accounts, 3);
});

test('the same handle claimed by two accounts is refused on both', () => {
  const r = consolidate({ profileHolders: [
    { account: 'a', socials: { tiktok: ['samehandle'] } },
    { account: 'b', socials: { tiktok: ['samehandle'] } },
  ] });
  assert.equal(r.stats.peopleWithAnyRoute, 0);
  assert.equal(r.stats.refused.shared, 2);
});

test('the same person from three sources is one row with three routes', () => {
  const r = consolidate({
    holderRows: [holder({ email: 'a@alice.example', email_found_on: 'https://alice.example/contact' })],
    profileHolders: [{ account: 'alice', socials: { tiktok: ['alicetok'] } }],
    hubPages: [{ account: 'alice', hub: 'https://linktr.ee/alice', emails: [], socials: { telegram: ['alicetg'] } }],
    meta: { alice: { display_name: 'Alice', reach_score: 900, location: 'Dallas' } },
  });
  assert.equal(r.people.length, 1);
  const p = r.people[0];
  assert.equal(p.name, 'Alice');
  assert.equal(p.reach, 900);
  assert.deepEqual(p.routes.map((x) => x.net).sort(), ['email', 'telegram', 'tiktok', 'website']);
  assert.equal(p.addressable, true);
  assert.equal(p.bestRoute.net, 'email');
});

test('the same route from two sources is not two routes', () => {
  const r = consolidate({
    holderRows: [holder({ hive_account: 'z', email: 'z@z.example', website: 'https://z.example' })],
    profileHolders: [{ account: 'z', socials: { website: ['https://z.example'] } }],
  });
  assert.equal(r.people[0].routes.filter((x) => x.net === 'website').length, 1);
});

test('a route that cannot receive a message is carried but does not make a person addressable', () => {
  const r = consolidate({ profileHolders: [{ account: 'y', socials: { youtube: ['UCabcdefghijklmnopqrstuv'] } }] });
  assert.equal(r.people[0].addressable, false);
  assert.equal(r.stats.addressable, 0);
  assert.equal(r.people[0].routes.length, 1);
  assert.equal(isAddressable('youtube'), false);
  assert.equal(isAddressable('email'), true);
});

test('the list is ordered by reach', () => {
  const r = consolidate({
    profileHolders: [{ account: 'small', socials: { tiktok: ['s1'] } }, { account: 'big', socials: { tiktok: ['b1'] } }],
    meta: { small: { reach_score: 1 }, big: { reach_score: 999 } },
  });
  assert.equal(r.people[0].account, 'big');
});

test('every refusal is recorded with its reason — the count is the evidence the gate ran', () => {
  const r = consolidate({ holderRows: [holder({ email: 'noreply@alice.example' })] });
  assert.equal(r.stats.refused.attribution, 1);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0].why, /role mailbox/);
});

test('routeUrl builds something a human can click', () => {
  assert.equal(routeUrl('tiktok', 'bob'), 'https://tiktok.com/@bob');
  assert.equal(routeUrl('email', 'a@b.co'), 'mailto:a@b.co');
  assert.equal(routeUrl('youtube', 'UCabc'), 'https://youtube.com/channel/UCabc');
  assert.equal(routeUrl('nope', 'x'), '');
});

test('sharedValues counts owners, not rows', () => {
  const s = sharedValues([{ account: 'a', value: 'v' }, { account: 'a', value: 'v' }]);
  assert.equal(s.size, 0);
  const s2 = sharedValues([{ account: 'a', value: 'v' }, { account: 'b', value: 'v' }]);
  assert.equal(s2.get('v'), 2);
});

test('rows and csv are one line per route and nothing is nested', () => {
  const r = consolidate({ profileHolders: [{ account: 'a', socials: { tiktok: ['t'], x: ['xx'] } }] });
  assert.equal(toRows(r).length, 2);
  const csv = toCsv(r);
  assert.equal(csv.split('\n').length, 3);
  assert.match(csv.split('\n')[0], /^account,name,location/);
});

test('csv escapes a quote instead of breaking the row', () => {
  const r = consolidate({ profileHolders: [{ account: 'a', socials: { tiktok: ['t'] } }], meta: { a: { display_name: 'He said "hi"' } } });
  assert.match(toCsv(r), /"He said ""hi"""/);
});

test('empty in, empty out, no throw', () => {
  const r = consolidate();
  assert.deepEqual(r.people, []);
  assert.equal(r.stats.candidates, 0);
  assert.equal(consolidate({ holderRows: [{}], profileHolders: [{}], hubPages: [{}] }).people.length, 0);
});

test('handler answers without touching anything', () => {
  let body = ''; const res = { statusCode: 0, setHeader() {}, end(b) { body = b; } };
  handler({}, res);
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.ok(j.gate.includes('attribution'));
});

// ── the fourth counting bug: a column built from the account name ─────────────────────────────────
test('a handle that is just the account name with the punctuation removed is a construction', () => {
  assert.equal(looksNameDerived('nathalie-s', 'nathalies'), true);
  assert.equal(looksNameDerived('alive.chat', 'https://www.youtube.com/@alivechat'), true);
  assert.equal(looksNameDerived('braaiboy', 'BraaiBoy'), true);
  assert.equal(looksNameDerived('onealfa', 'leofinance'), false);
  assert.equal(looksNameDerived('', 'x'), false);
});

test('an x_verdict of collision refuses the handle outright', () => {
  const r = consolidate({ holderRows: [{ hive_account: 'cahlen', x_handle: 'CAhlen', x_verdict: 'collision' }] });
  assert.equal(r.stats.peopleWithAnyRoute, 0);
  assert.equal(r.stats.refused.unverified, 1);
  assert.match(r.reasons[0].why, /collision/);
});

test('an x_verdict of confirmed is a real route', () => {
  const r = consolidate({ holderRows: [{ hive_account: 'braaiboy', x_handle: 'BraaiBoy', x_verdict: 'confirmed' }] });
  assert.equal(r.people[0].routes[0].verdict, 'self-declared');
  assert.equal(r.people[0].routes[0].addressable, true);
});

test('a constructed youtube URL is carried as a lead and can never be sent to', () => {
  const r = consolidate({ holderRows: [{ hive_account: 'romanie', youtube: 'https://www.youtube.com/@romanie' }] });
  const route = r.people[0].routes[0];
  assert.equal(route.verdict, 'unverified');
  assert.equal(route.addressable, false);
  assert.match(route.why, /nobody has checked/);
  assert.equal(r.people[0].addressable, false);
  assert.equal(r.stats.unverifiedRoutes, 1);
  assert.equal(r.stats.verifiedRoutes, 0);
});

test('a constructed telegram is demoted the same way — t.me/<account> is not a finding', () => {
  const r = consolidate({ holderRows: [{ hive_account: 'romanie', telegram: 'https://t.me/romanie' }] });
  assert.equal(r.people[0].routes[0].verdict, 'unverified');
  assert.equal(r.people[0].routes[0].addressable, false);
});

test('x_verdict possible is not confirmed', () => {
  const r = consolidate({ holderRows: [{ hive_account: 'someone', x_handle: 'notthesamename', x_verdict: 'possible' }] });
  assert.equal(r.people[0].routes[0].verdict, 'unverified');
});

test('a handle nobody derived and nobody graded is still a real self-declaration from the profile', () => {
  const r = consolidate({ profileHolders: [{ account: 'romanie', socials: { youtube: ['romanie'] } }] });
  assert.equal(r.people[0].routes[0].verdict, 'self-declared');
});

test('the same handle from a guess and from a self-declaration keeps the better of the two', () => {
  const r = consolidate({
    holderRows: [{ hive_account: 'romanie', telegram: 'https://t.me/romanie' }],
    profileHolders: [{ account: 'romanie', socials: { telegram: ['romanie'] } }],
  });
  const tg = r.people[0].routes.filter((x) => x.net === 'telegram');
  assert.equal(tg.length, 1);
  assert.equal(tg[0].verdict, 'self-declared');
  assert.equal(tg[0].addressable, true);
});


// ── who is worth searching for ────────────────────────────────────────────────────────────────────
const person = (account, routes, extra = {}) => ({ account, name: account, routes, reach: 0, ...extra });
const route = (net, value) => ({ net, value, url: `https://${net}.example/${value}`, addressable: true, verdict: 'declared', source: 'profile' });

test('the same handle on two networks outranks everything else — that is the operator\'s signal', () => {
  const r = searchTargets({ people: [
    person('someone', [route('instagram', 'kateskarma'), route('x', 'kateskarma')]),
    person('other', [route('instagram', 'somethingelse')]),
  ] });
  assert.equal(r[0].handle, 'kateskarma');
  assert.equal(r[0].tier, 'corroborated');
  assert.deepEqual(r[0].networks.sort(), ['instagram', 'x']);
  assert.ok(r[0].score > r[1].score);
});

test('a handle that is not the account name is distinctive; one equal to it is a name-echo', () => {
  const r = searchTargets({ people: [
    person('bobsmith', [route('instagram', 'bobsmith')]),
    person('bobsmith2', [route('instagram', 'thevinylhound')]),
  ] });
  const byAcct = Object.fromEntries(r.map((x) => [x.account, x]));
  assert.equal(byAcct.bobsmith.tier, 'name-echo', 'this is the manufactured-column shape');
  assert.equal(byAcct.bobsmith2.tier, 'distinctive');
  assert.ok(byAcct.bobsmith2.score > byAcct.bobsmith.score);
});

test('a name-echo still scores above zero — plenty of real people use their own name', () => {
  const [x] = searchTargets({ people: [person('bobsmith', [route('x', 'bobsmith')])] });
  assert.ok(x.score > 0);
  assert.equal(SEARCH_TIERS['name-echo'].weight > 0, true);
});

test('Instagram outranks the other networks, because the cohort follows someone who is there', () => {
  assert.ok(NETWORK_SEARCH_PRIORITY.instagram > NETWORK_SEARCH_PRIORITY.x);
  assert.ok(NETWORK_SEARCH_PRIORITY.instagram > NETWORK_SEARCH_PRIORITY.youtube);
  const r = searchTargets({ people: [
    person('a', [route('instagram', 'distinctive1')]),
    person('b', [route('youtube', 'distinctive2')]),
  ] });
  assert.equal(r[0].account, 'a');
  assert.equal(r[0].onInstagram, true);
});

test('an email or a website is not a handle to search', () => {
  const r = searchTargets({ people: [person('a', [
    { net: 'email', value: 'x@y.example', url: '', addressable: true },
    { net: 'website', value: 'https://y.example', url: '', addressable: false },
  ])] });
  assert.deepEqual(r, []);
});

test('handles normalise before they are compared, so @Kate.Karma and katekarma are one string', () => {
  assert.equal(normHandle('@Kate.Karma'), 'katekarma');
  assert.equal(normHandle('https://instagram.com/Kate_Karma'), 'katekarma');
  const r = searchTargets({ people: [person('x', [route('instagram', '@Kate.Karma'), route('tiktok', 'kate_karma')])] });
  assert.equal(r.length, 1, 'one handle seen twice, not two handles');
  assert.equal(r[0].tier, 'corroborated');
});

test('reach is carried but never scored — findability is not importance', () => {
  const r = searchTargets({ people: [
    person('big', [route('x', 'nameecho1')], { reach: 99999, account: 'big' }),
    person('small', [route('instagram', 'distinctive9'), route('tiktok', 'distinctive9')], { reach: 1 }),
  ] });
  assert.equal(r[0].tier, 'corroborated', 'the corroborated handle wins despite 1 vs 99,999 reach');
  assert.ok(r.every((x) => typeof x.reach === 'number'));
});

test('limit trims the list without reordering it', () => {
  const people = ['a', 'b', 'c'].map((a, i) => person(a, [route('instagram', `handle${i}`)]));
  const all = searchTargets({ people });
  const two = searchTargets({ people }, { limit: 2 });
  assert.deepEqual(two, all.slice(0, 2));
});

test('a person with no routes contributes nothing, and an empty result is empty', () => {
  assert.deepEqual(searchTargets({ people: [person('a', [])] }), []);
  assert.deepEqual(searchTargets({}), []);
});

// local-outreach.test.mjs — OFFLINE. No network; the module does not fetch.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  SCHOOL, COHORTS, widen, loadSeeds, rank, score, hubs, cohortStatus, cohortReport, isFamily,
  assertPublicOnly, makeVenue, verifyClaims, draft, draftFor, plan, handler,
} from './local-outreach.mjs';

// Named people live in .local/, never in the repo — so the tests supply their own, through the same
// injectable reader the module uses in production.
const FAKE = { seeds: [{ id: 'seed-a', name: 'A Connector', public: { facebook: 'A Connector' }, audience: { followers: 4600 } }] };
const readFake = () => JSON.stringify(FAKE);

test('the cohorts are the operator\'s: Boyd 2009-2012, after the school\'s first class of 2008', () => {
  assert.deepEqual(COHORTS, [2009, 2010, 2011, 2012]);
  assert.equal(SCHOOL.firstGraduatingClass, 2008);
  assert.ok(COHORTS.every((y) => y > SCHOOL.firstGraduatingClass), 'no cohort predates the first class');
});

test('widen() extends into the classes after ours without dropping the originals', () => {
  const w = widen();
  assert.deepEqual(w.next, [2013, 2014, 2015]);
  assert.ok(COHORTS.every((y) => w.all.includes(y)));
});

test('a seed carrying private-person data is REFUSED, not quietly stored', () => {
  const r = assertPublicOnly({ id: 'x', name: 'Someone', phone: '214-555-0100', address: '123 Elm St' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'private-data');
  assert.match(r.reason, /phone/);
  assert.match(r.reason, /address/);
});

test('named people are NOT in the repo — seeds load from a gitignored file', () => {
  const src = readFileSync(new URL('./local-outreach.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /instagram['"]?\s*:\s*\[/, 'no personal handles hard-coded in the module');
  assert.match(src, /LOCAL_SEEDS\.json/);
  const loaded = loadSeeds('whatever.json', readFake);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'A Connector');
});

test('loadSeeds soft-fails to an empty audience when the file is missing or bad', () => {
  assert.deepEqual(loadSeeds('/nope/missing.json'), []);
  assert.deepEqual(loadSeeds('x', () => 'not json'), []);
});

test('verifyClaims refuses a claim about who runs somebody else\'s project', () => {
  const r = verifyClaims('This is ours, not run by someone in China.');
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].code, 'who_runs_others');
});

test('verifyClaims refuses "accredited", allows "non-accredited"', () => {
  assert.equal(verifyClaims('We give accredited credentials').ok, false);
  assert.equal(verifyClaims('We give non-accredited credentials').ok, true);
});

test('verifyClaims refuses return promises and a claimed school endorsement', () => {
  assert.equal(verifyClaims('guaranteed 100x passive income').ok, false);
  assert.equal(verifyClaims('officially endorsed by McKinney ISD').ok, false);
});

test('the cohort draft passes its own claim check and makes only checkable claims', () => {
  const d = draft({ audience: 'cohort', year: 2011 });
  assert.equal(d.ok, true);
  assert.match(d.body, /Ryan Gallagher/);
  assert.match(d.body, /class of 2011/);
  assert.match(d.body, /Dallas–Fort Worth/);
  assert.match(d.body, /code is public/);
  assert.doesNotMatch(d.body, /China|guaranteed|endorsed/i);
  assert.equal(d.sends, false, 'drafting never sends');
});

test('the seed draft addresses the connector as themselves', () => {
  const d = draft({ audience: 'seed', seed: FAKE.seeds[0] });
  assert.equal(d.ok, true);
  assert.match(d.body, /^A Connector/);
});

test('draftFor REFUSES a venue that bans promotion', () => {
  const v = makeVenue({ name: 'Boyd Class of 2010', kind: 'alumni_group', promo: 'banned' });
  const r = draftFor(v, { year: 2010 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'promo-banned');
});

test('draftFor REFUSES a venue whose rules have not been read — unknown is not permission', () => {
  const v = makeVenue({ name: 'Some group', kind: 'community_group' });
  const r = draftFor(v, { year: 2010 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'rules-unknown');
});

test('draftFor marks ask-first venues so nobody posts before asking', () => {
  const v = makeVenue({ name: 'McKinney community', kind: 'community_group', promo: 'ask-first' });
  const r = draftFor(v, { year: 2012 });
  assert.equal(r.ok, true);
  assert.equal(r.askFirst, true);
});

test('plan() reports honestly that with nothing loaded this is not yet outreach', () => {
  const p = plan({ seeds: [] });
  assert.equal(p.venues.total, 0);
  assert.match(p.blocked.join(' '), /no venues loaded/);
  assert.match(p.blocked.join(' '), /no seeds loaded/);
});

test('plan() separates postable venues from banned and unread ones', () => {
  const venues = [
    makeVenue({ name: 'A', promo: 'allowed' }),
    makeVenue({ name: 'B', promo: 'banned' }),
    makeVenue({ name: 'C', promo: 'unknown' }),
    makeVenue({ name: 'D', promo: 'ask-first' }),
  ];
  const p = plan({ venues });
  assert.equal(p.venues.postable, 2);
  assert.equal(p.venues.banned, 1);
  assert.equal(p.venues.unread, 1);
});

test('plan() rejects a private-data seed instead of counting it', () => {
  const p = plan({ seeds: [{ id: 'bad', name: 'X', dob: '1990-01-01' }] });
  assert.equal(p.ok, false);
  assert.equal(p.rejectedSeeds.length, 1);
  assert.equal(p.seeds.length, 0);
});

test('handler returns the policy, including what it refuses to claim', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.ok(j.refusedClaims.who_runs_others);
  assert.ok(j.checkableClaims.built_here);
});

// ── ranking ───────────────────────────────────────────────────────────────────────────────────────
const S = (o) => ({ id: o.id || 'x', name: o.name || 'X', ...o });

test('a confirmed classmate outranks a bigger audience — cohort proof is the premise, not reach', () => {
  const classmate = S({ id: 'a', name: 'Classmate', tags: ['boyd-confirmed'], mutualsWithOperator: 20 });
  const famous = S({ id: 'b', name: 'Famous', audience: { followers: 100000 }, mutualsWithOperator: 5 });
  assert.equal(rank([classmate, famous]).then[0].name, 'Classmate');
});

test('reach is capped so one large account cannot outweigh every real connection', () => {
  assert.ok(score(S({ audience: { followers: 1000000 } })).score <= 15);
});

test('an unanswered message is a DEBT — it sorts above every opportunity', () => {
  const owed = S({ id: 'o', name: 'Owed', openThread: 'unread messages waiting' });
  const best = S({ id: 'b', name: 'Best', tags: ['boyd-confirmed', 'crypto'], mutualsWithOperator: 200 });
  const r = rank([owed, best]);
  assert.equal(r.firstDoThis.length, 1);
  assert.equal(r.firstDoThis[0].name, 'Owed');
  assert.match(r.firstDoThis[0].reason, /before pitching/);
  assert.ok(!r.then.some((x) => x.name === 'Owed'), 'a debt is not also listed as a lead');
});

test('no friend edge is NOT a penalty — everyone in this file already knows the operator', () => {
  // The graph ranks them; it does not decide whether the door is open. A missing Facebook edge is a
  // fact about Facebook.
  assert.equal(score(S({ mutualsWithOperator: 60, tags: ['not-yet-connected'] })).score,
               score(S({ mutualsWithOperator: 60 })).score);
});

test('a close personal tie outranks a big mutual count', () => {
  assert.ok(score(S({ mutualsWithOperator: 3, tags: ['known-personally'] })).score
          > score(S({ mutualsWithOperator: 60 })).score);
});

test('score explains itself — every point is attributed', () => {
  const s = score(S({ tags: ['boyd-confirmed', 'crypto'], mutualsWithOperator: 40, audience: { followers: 800 } }));
  assert.ok(s.why.some((w) => /confirmed classmate/.test(w)));
  assert.ok(s.why.some((w) => /already in crypto/.test(w)));
  assert.ok(s.why.some((w) => /mutuals/.test(w)));
});

test('rank() drops a seed carrying private data rather than scoring it', () => {
  const r = rank([S({ id: 'p', name: 'Private', dob: '1990-01-01', tags: ['boyd-confirmed'] })]);
  assert.equal(r.then.length, 0);
  assert.equal(r.firstDoThis.length, 0);
});

// ── hubs ──────────────────────────────────────────────────────────────────────────────────────────
test('hubs() counts appearances in the profile friend-strip across INDEPENDENT profiles', () => {
  const list = [
    S({ id: 'a', name: 'Alpha', signal: 'friends with Hub Person, Other One and 20 others' }),
    S({ id: 'b', name: 'Beta', signal: 'friends with Hub Person and 5 others' }),
    S({ id: 'c', name: 'Gamma', signal: 'friends with Other One and 3 others' }),
    S({ id: 'h', name: 'Hub Person' }),
    S({ id: 'o', name: 'Other One' }),
  ];
  const h = hubs(list);
  assert.equal(h[0].name, 'Hub Person');
  assert.equal(h[0].count, 2);
  assert.deepEqual(h[0].namedOn, ['Alpha', 'Beta']);
});

test('hubs() ignores `why` — our bookkeeping is not evidence', () => {
  // `why` records where WE imported an entry from. Counting it would make whoever we happened to
  // batch-import from look like a hub, which is exactly the artifact this guards against.
  const list = [
    S({ id: 'x', name: 'Imported One', why: 'named mutual of Source Person' }),
    S({ id: 'y', name: 'Imported Two', why: 'named mutual of Source Person' }),
    S({ id: 's', name: 'Source Person' }),
  ];
  assert.equal(hubs(list).length, 0, 'no friend-strips means no hubs, however many entries cite them');
});

test('hubs() does not count someone appearing in their own strip', () => {
  const list = [S({ id: 'a', name: 'Alpha', signal: 'friends with Alpha and 4 others' })];
  assert.equal(hubs(list).length, 0);
});

test('hubs() skips a seed carrying private data', () => {
  const list = [
    S({ id: 'p', name: 'Private', phone: '555', signal: 'friends with Hub Person' }),
    S({ id: 'h', name: 'Hub Person' }),
  ];
  assert.equal(hubs(list).length, 0);
});

// ── cohort window ─────────────────────────────────────────────────────────────────────────────────
test('a STATED class year inside the window is confirmed', () => {
  const c = cohortStatus(S({ classYear: 2009 }));
  assert.equal(c.state, 'confirmed-in-window');
  assert.equal(c.year, 2009);
});

test('a stated year outside the window is reported as outside, not silently dropped', () => {
  assert.equal(cohortStatus(S({ classYear: 2005 })).state, 'confirmed-outside');
});

test('an ESTIMATE never counts as confirmed, even inside the window', () => {
  const c = cohortStatus(S({ classYearEstimate: 2010 }));
  assert.equal(c.state, 'estimated-in-window');
  assert.equal(c.needs, 'the actual year');
  assert.match(c.why, /an estimate, not a fact/);
});

test('an estimate outside the window says ASK rather than exclude — people repeat and skip years', () => {
  const c = cohortStatus(S({ classYearEstimate: 2008 }));
  assert.equal(c.state, 'estimated-outside');
  assert.match(c.why, /an estimate is not a year/);
});

test('a stated year always beats an estimate', () => {
  assert.equal(cohortStatus(S({ classYear: 2011, classYearEstimate: 2008 })).state, 'confirmed-in-window');
});

test('no year at all asks for one', () => {
  const c = cohortStatus(S({}));
  assert.equal(c.state, 'unknown');
  assert.equal(c.needs, 'a class year');
});

test('cohortReport says plainly when nothing is actually confirmed', () => {
  const r = cohortReport([
    S({ id: 'a', name: 'A', tags: ['boyd-confirmed'], classYearEstimate: 2010 }),
    S({ id: 'b', name: 'B', tags: ['boyd-confirmed'] }),
  ]);
  assert.equal(r.counts['estimated-in-window'], 1);
  assert.equal(r.counts.unknown, 1);
  assert.match(r.honest, /Estimates are not years/);
});

test('cohortReport falls silent once something IS confirmed', () => {
  const r = cohortReport([S({ id: 'c', name: 'C', classYear: 2012 })]);
  assert.equal(r.honest, null);
  assert.deepEqual(r.window, [2009, 2012]);
});

// ── family ────────────────────────────────────────────────────────────────────────────────────────
test('family are REMOVED from the ranking, not sorted to the bottom of it', () => {
  const r = rank([
    S({ id: 'mom', name: 'Mother', tags: ['family', 'crypto'], relationship: 'the operator\'s mother' }),
    S({ id: 'x', name: 'Someone Else', tags: ['boyd-confirmed'] }),
  ]);
  assert.ok(!r.then.some((x) => x.name === 'Mother'));
  assert.equal(r.excludedAsFamily.length, 1);
  assert.equal(r.excludedAsFamily[0].relationship, 'the operator\'s mother');
});

test('an unanswered message from family is not a pipeline debt either', () => {
  // The exact failure this guards: two unread messages from the operator's mother were ranked as the
  // top action item, above every actual lead.
  const r = rank([S({ id: 'mom', name: 'Mother', tags: ['family'], openThread: 'two unread messages' })]);
  assert.equal(r.firstDoThis.length, 0);
  assert.equal(r.then.length, 0);
  assert.equal(r.excludedAsFamily.length, 1);
});

test('the highest-scoring possible family member still does not appear', () => {
  const r = rank([S({
    id: 'f', name: 'Relative', tags: ['family', 'boyd-confirmed', 'crypto', 'known-personally'],
    mutualsWithOperator: 500, audience: { followers: 100000 },
  })]);
  assert.equal(r.then.length, 0);
});

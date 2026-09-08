// local-outreach.test.mjs — OFFLINE. No network; the module does not fetch.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  SCHOOL, COHORTS, widen, loadSeeds, rank, score, hubs, cohortStatus, cohortReport, isFamily, isDisputed, isPersonal, SUBCOHORTS,
  assertPublicOnly, makeVenue, verifyClaims, draft, draftFor, plan, handler,
  loadVenues, assertVenueCheckable, personalReason, dedupe, possibleDuplicates, buyerFit, BUYER_KINDS, CALLED_IT, MAIN_FRAME, candidates,
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
    makeVenue({ name: 'A', url: 'https://example.org/a', promo: 'allowed' }),
    makeVenue({ name: 'B', url: 'https://example.org/b', promo: 'banned' }),
    makeVenue({ name: 'C', url: 'https://example.org/c', promo: 'unknown' }),
    makeVenue({ name: 'D', url: 'https://example.org/d', promo: 'ask-first' }),
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

test('an estimate well outside says ASK rather than exclude — people repeat and skip years', () => {
  // 2008 used to be the case here; it is now `estimated-edge`, since the operator says the real
  // spread is about one year. Two years out is where "outside" starts.
  const c = cohortStatus(S({ classYearEstimate: 2006 }));
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

// ── the cohort is tighter than its own edges ──────────────────────────────────────────────────────
test('one year outside the window is EDGE, not outside — same rooms, same people', () => {
  // Operator: "The Only Difference will be like 1 Year Age Difference in Everyone."
  for (const y of [2008, 2013]) {
    const c = cohortStatus(S({ classYearEstimate: y }));
    assert.equal(c.state, 'estimated-edge', String(y));
    assert.match(c.why, /inside the real spread rather than outside it/);
  }
});

test('two years out is still outside — the tolerance is one year, not a shrug', () => {
  assert.equal(cohortStatus(S({ classYearEstimate: 2015 })).state, 'estimated-outside');
  assert.equal(cohortStatus(S({ classYearEstimate: 2006 })).state, 'estimated-outside');
});

test('a STATED year outside the window is still confirmed-outside — tolerance is for estimates', () => {
  // An estimate carries an error bar; a stated year does not. Applying the same slack to a fact
  // would be inventing doubt where none exists.
  assert.equal(cohortStatus(S({ classYear: 2008 })).state, 'confirmed-outside');
});

test('the younger sub-cohort is modelled as a door, not as a wider window', () => {
  assert.equal(SUBCOHORTS.length, 1);
  const s = SUBCOHORTS[0];
  assert.match(s.enteredVia, /Chelsea Pitt/);
  assert.equal(s.needs, "the brother's name");
  assert.match(s.note, /entry point for a whole younger group/);
});

// ── disputed identity ─────────────────────────────────────────────────────────────────────────────
test('a disputed identity is EXCLUDED from ranking, and listed so it is recoverable', () => {
  const r = rank([
    S({ id: 'd', name: 'Maybe Duplicate', identityDisputed: true, disputeNote: 'might be a second account', mutualsWithOperator: 55 }),
    S({ id: 'ok', name: 'Real Person', mutualsWithOperator: 10 }),
  ]);
  assert.ok(!r.then.some((x) => x.name === 'Maybe Duplicate'));
  assert.equal(r.excludedAsDisputed.length, 1);
  assert.match(r.excludedAsDisputed[0].reason, /second account/);
});

test('the tag form works as well as the flag', () => {
  const r = rank([S({ id: 'd', name: 'Tagged', tags: ['identity-disputed'] })]);
  assert.equal(r.then.length, 0);
  assert.equal(r.excludedAsDisputed.length, 1);
});

test('hubs() does not count a disputed account either — that is where it would do real damage', () => {
  // A duplicate does not just add one wrong row; it inflates every aggregate it appears in.
  const list = [
    S({ id: 'a', name: 'Alpha', signal: 'friends with Suspect Account and 9 others' }),
    S({ id: 'b', name: 'Beta', signal: 'friends with Suspect Account and 4 others' }),
    S({ id: 's', name: 'Suspect Account', identityDisputed: true }),
  ];
  assert.equal(hubs(list).length, 0, 'a disputed name cannot become a hub');
});

test('isDisputed is false for an ordinary seed', () => {
  assert.equal(isDisputed(S({ id: 'x', name: 'X' })), false);
});

// ── personal history ──────────────────────────────────────────────────────────────────────────────
test('someone the operator dated leaves the ranking and comes back as "write this yourself"', () => {
  const r = rank([
    S({ id: 'ex', name: 'Former Partner', tags: ['dated'], relationship: 'The operator dated her.', mutualsWithOperator: 6 }),
    S({ id: 'c', name: 'Classmate', tags: ['boyd-confirmed'] }),
  ]);
  assert.ok(!r.then.some((x) => x.name === 'Former Partner'), 'not a campaign row');
  assert.equal(r.writeTheseYourself.length, 1);
  assert.match(r.writeTheseYourself[0].relationship, /dated/);
});

test('this is NOT the family rule — they are listed to be contacted, just not drafted', () => {
  const r = rank([S({ id: 'ex', name: 'Ex', tags: ['dated'] })]);
  assert.equal(r.excludedAsFamily.length, 0, 'not family');
  assert.equal(r.writeTheseYourself.length, 1, 'listed, not hidden');
});

test('a high-scoring profile still leaves the ranking once it is marked personal', () => {
  const r = rank([S({
    id: 'p', name: 'P', tags: ['dated', 'boyd-confirmed', 'crypto'],
    mutualsWithOperator: 300, audience: { followers: 90000 },
  })]);
  assert.equal(r.then.length, 0);
});


// ── venues ────────────────────────────────────────────────────────────────────────────────────────
const VENUES = {
  venues: [
    { name: 'McKinney Class of 2010', kind: 'alumni_group', url: 'https://example.org/g/1', promo: 'unknown' },
    { name: 'A Group That Allows It', kind: 'community_group', url: 'https://example.org/g/2', promo: 'allowed' },
    { name: 'No Ads Here', kind: 'community_group', url: 'https://example.org/g/3', promo: 'banned' },
    { name: 'Remembered From Somewhere', kind: 'community_group', promo: 'allowed' },
  ],
};
const readVenues = () => JSON.stringify(VENUES);

test('loadVenues normalises through makeVenue and soft-fails to empty', () => {
  const v = loadVenues('whatever.json', readVenues);
  assert.equal(v.length, 4);
  assert.equal(v[0].id, 'mckinney-class-of-2010', 'an id is derived when none is given');
  assert.deepEqual(loadVenues('/nope/missing.json'), []);
  assert.deepEqual(loadVenues('x', () => 'not json'), []);
});

test('a venue with no link cannot be checked, and a nameless one is not a venue', () => {
  assert.equal(assertVenueCheckable({ name: 'X', url: 'https://example.org' }).ok, true);
  assert.equal(assertVenueCheckable({ name: 'X' }).code, 'no-url');
  assert.equal(assertVenueCheckable({ url: 'https://example.org' }).code, 'no-name');
});

test('plan() counts venues honestly: unknown is not permission, and an unlinked venue is not postable', () => {
  const p = plan({ seeds: [], venues: VENUES.venues });
  assert.equal(p.venues.total, 4);
  assert.equal(p.venues.postable, 1, 'only the one that says allowed AND has a link');
  assert.equal(p.venues.banned, 1);
  assert.equal(p.venues.unread, 1);
  assert.equal(p.venues.uncheckable, 1, 'promo:allowed does not save a venue with no link');
  assert.deepEqual(p.readNext.map((v) => v.name), ['McKinney Class of 2010']);
  assert.ok(p.blocked.some((b) => /no link/.test(b)));
});

test('plan() with venues loaded but none readable says so instead of looking ready', () => {
  const p = plan({ seeds: [], venues: [{ name: 'Unread', url: 'https://example.org/u', promo: 'unknown' }] });
  assert.equal(p.venues.postable, 0);
  assert.ok(p.blocked.some((b) => /none readable as permission/.test(b)));
  assert.ok(!p.blocked.some((b) => /no venues loaded/.test(b)), 'that blocker is cleared once a file exists');
});


// ── a record is not a field ───────────────────────────────────────────────────────────────────────
test('a seed carrying a conviction is refused outright, like an address is', () => {
  const v = assertPublicOnly({ name: 'A Classmate', conviction: 'manslaughter' });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'private-data');
  assert.match(v.reason, /conviction/);
  for (const f of ['criminalRecord', 'charges', 'arrest', 'incarceration', 'sentence', 'diagnosis', 'medical', 'immigrationStatus']) {
    assert.equal(assertPublicOnly({ name: 'X', [f]: 'anything' }).ok, false, `${f} must be refused`);
  }
});

test('rank() drops a refused seed rather than scoring it — it never reaches the list', () => {
  const r = rank([
    { id: 'ok-one', name: 'Fine', mutualsWithOperator: 10 },
    { id: 'has-record', name: 'Refused', mutualsWithOperator: 40, criminalRecord: 'served time' },
  ]);
  const ids = [...r.then, ...r.firstDoThis, ...r.writeTheseYourself, ...r.excludedAsFamily].map((x) => x.id);
  assert.ok(!ids.includes('has-record'), 'a seed with a record field does not appear anywhere');
  assert.deepEqual(r.then.map((x) => x.id), ['ok-one']);
});

test('justice-involved leaves the ranking and says WHY, without the file holding what happened', () => {
  const seed = { id: 'mm', name: 'A Classmate', tags: ['justice-involved'], mutualsWithOperator: 10 };
  assert.equal(isPersonal(seed), true);
  const r = rank([seed]);
  assert.equal(r.then.length, 0);
  assert.deepEqual(r.writeTheseYourself.map((x) => x.id), ['mm']);
  assert.match(r.writeTheseYourself[0].why, /rebuilding/);
  assert.ok(!JSON.stringify(r).match(/prison|conviction|killed/i), 'the reason never carries the story');
});

test('the two personal reasons stay distinguishable', () => {
  assert.match(personalReason({ tags: ['dated'] }), /dated/);
  assert.match(personalReason({ tags: ['justice-involved'] }), /type yourself/);
  assert.match(personalReason({ tags: ['personal-history'] }), /yours to write/);
});


// ── one person, one row ───────────────────────────────────────────────────────────────────────────
const TWO_ACCOUNTS = [
  { id: 'trevor-main', name: 'T Vincent', mutualsWithOperator: 22, audience: { friends: 664 } },
  { id: 'trevor-second', name: 'T Daniel Vincent', mutualsWithOperator: 5, audience: { friends: 16 }, sameAs: 'trevor-main' },
];

test('a second account collapses into the one he actually uses', () => {
  const { people, aliases } = dedupe(TWO_ACCOUNTS);
  assert.equal(people.length, 1);
  assert.equal(people[0].id, 'trevor-main');
  assert.deepEqual(people[0].alsoAt.map((a) => a.id), ['trevor-second']);
  assert.deepEqual(aliases, [{ id: 'trevor-second', name: 'T Daniel Vincent', collapsedInto: 'trevor-main' }]);
});

test('mutuals are never summed across a person\'s accounts', () => {
  const [p] = dedupe(TWO_ACCOUNTS).people;
  assert.equal(p.mutualsWithOperator, 22, '22 and 5 do not make 27 — that number is about nobody');
});

test('the operator\'s primary beats the size heuristic', () => {
  const flagged = [TWO_ACCOUNTS[0], { ...TWO_ACCOUNTS[1], primary: true }];
  const [p] = dedupe(flagged).people;
  assert.equal(p.id, 'trevor-second');
  assert.match(p.primaryChosenBy, /operator/);
});

test('rank() scores the person once, and lists what it collapsed', () => {
  const r = rank(TWO_ACCOUNTS);
  assert.equal(r.then.length, 1);
  assert.deepEqual(r.collapsedDuplicates.map((a) => a.id), ['trevor-second']);
});

test('a sameAs loop does not hang, and a dangling sameAs is left alone', () => {
  const loop = [{ id: 'a', name: 'A', sameAs: 'b' }, { id: 'b', name: 'B', sameAs: 'a' }];
  assert.ok(dedupe(loop).people.length >= 1);
  assert.equal(dedupe([{ id: 'x', name: 'X', sameAs: 'nobody' }]).people.length, 1);
});

test('same name with no link is ASKED about, never merged', () => {
  const pair = [
    { id: 't1', name: 'Trevor Vincent', city: 'McKinney', mutualsWithOperator: 22 },
    { id: 't2', name: 'Trevor Daniel Vincent', city: 'Los Angeles', mutualsWithOperator: 5 },
  ];
  assert.equal(dedupe(pair).people.length, 2, 'a name match alone merges nothing');
  const [q] = possibleDuplicates(pair);
  assert.equal(q.accounts.length, 2);
  assert.match(q.conflict, /different cities/);
  assert.match(q.resolveWith, /do not guess/);
});

test('once it is answered, it stops being asked', () => {
  assert.deepEqual(possibleDuplicates(TWO_ACCOUNTS), []);
  assert.deepEqual(possibleDuplicates([
    { id: 'a', name: 'Same Name', identityDisputed: true }, { id: 'b', name: 'Same Name' },
  ]), []);
});

test('two genuinely different people with different names are not a duplicate question', () => {
  assert.deepEqual(possibleDuplicates([{ id: 'a', name: 'One Person' }, { id: 'b', name: 'Other Person' }]), []);
});


// ── what they do for a living ─────────────────────────────────────────────────────────────────────
test('a print shop is the strongest buyer fit — it resells what SoapBox does', () => {
  const b = buyerFit({ work: 'AlphaGraphics Wilmington', business: { kind: 'print / document / signage franchise' } });
  assert.equal(b.fit, 'print-doc');
  assert.ok(b.weight >= 30);
  assert.match(b.why, /fax|conversion|hosting/);
});

test('a storefront, a trade and a creator each land in their own bucket', () => {
  assert.equal(buyerFit({ work: 'Zin Zen Wine Bistro' }).fit, 'hospitality-retail');
  assert.equal(buyerFit({ describesSelf: 'Outdoorsy. English. Barber.' }).fit, 'hospitality-retail');
  assert.equal(buyerFit({ title: 'HVAC technician' }).fit, 'trades');
  assert.equal(buyerFit({ describesSelf: 'Digital creator' }).fit, 'creator-media');
  assert.equal(buyerFit({ describesSelf: 'licensed insurance agent' }).fit, 'realty-legal-medical');
});

test('an employer we cannot classify still beats no employer at all', () => {
  const some = buyerFit({ work: 'Widgets Incorporated' });
  assert.equal(some.fit, 'unclassified');
  assert.ok(some.weight > 0);
  assert.equal(buyerFit({}).fit, 'none');
  assert.equal(buyerFit({}).weight, 0);
});

test('buyerFit carries its evidence, so a wrong guess is visible and throwable', () => {
  const b = buyerFit({ work: 'Zin Zen Wine Bistro' });
  assert.match(b.evidence, /Zin Zen/);
});

test('work counts in the score, and the business segment is reported separately', () => {
  const plain = { id: 'p', name: 'No Job Listed', mutualsWithOperator: 40 };
  const shop = { id: 's', name: 'Print Shop Person', mutualsWithOperator: 40, work: 'AlphaGraphics' };
  assert.ok(score(shop).score > score(plain).score, 'the print shop outranks the identical stranger');
  const r = rank([plain, shop]);
  assert.deepEqual(r.businessesWeKnow.map((x) => x.id), ['s']);
  assert.match(r.businessesWeKnow[0].pitch, /SoapBox first/);
});

test('family and personal rows never appear in the business segment', () => {
  const r = rank([
    { id: 'f', name: 'A Cousin', work: 'AlphaGraphics', tags: ['family'] },
    { id: 'd', name: 'Someone He Dated', work: 'AlphaGraphics', tags: ['dated'] },
  ]);
  assert.deepEqual(r.businessesWeKnow, [], 'a rule that removes someone removes them everywhere');
});

test('a dormant account is docked — 444 friends and no posts is a nameplate, not a door', () => {
  const dormant = { id: 'z', name: 'Dormant', mutualsWithOperator: 40, audience: { friends: 444, posts: 0 } };
  const live = { id: 'a', name: 'Active', mutualsWithOperator: 40, audience: { friends: 444, posts: 1300 } };
  assert.ok(score(dormant).score < score(live).score);
  assert.match(score(dormant).why.join(' '), /dormant/);
});

test('the dock never drives a score below zero', () => {
  const s = score({ id: 'z', name: 'Nothing Known', audience: { posts: 0 } });
  assert.ok(s.score >= 0, `score was ${s.score}`);
});

test('an unknown post count is not treated as dormant', () => {
  const unknown = score({ mutualsWithOperator: 40, audience: { friends: 444 } });
  assert.ok(!unknown.why.join(' ').includes('dormant'));
});

test('every buyer kind has a weight, a reason and a working pattern', () => {
  for (const k of BUYER_KINDS) {
    assert.ok(k.weight > 0 && k.why && k.match instanceof RegExp, k.id);
  }
});


// ── the opener that is not a pitch ────────────────────────────────────────────────────────────────
test('the cohort draft opens with their own prediction, not with a claim of ours', () => {
  const d = draft({ audience: 'cohort', year: 2010 });
  assert.equal(d.ok, true);
  assert.equal(d.calledIt, true);
  assert.ok(d.body.includes(CALLED_IT.line));
  assert.match(d.subject, /infrastructure/);
});

test('it can be turned off, and then the old subject comes back', () => {
  const d = draft({ audience: 'cohort', year: 2010, calledIt: false });
  assert.equal(d.calledIt, false);
  assert.ok(!d.body.includes(CALLED_IT.line));
  assert.match(d.subject, /Boyd 2010/);
});

test('a creator gets the peer register — copy, not a note about copy', () => {
  const d = draft({ audience: 'seed', seed: { name: 'A Creator', describesSelf: 'Digital creator' } });
  assert.ok(d.body.includes(CALLED_IT.peerLine));
  assert.ok(!d.body.includes(CALLED_IT.peerNote), 'guidance for the writer never lands in the message');
  assert.equal(d.register, CALLED_IT.peerNote);
});

test('an ordinary classmate does not get the peer line', () => {
  const d = draft({ audience: 'seed', seed: { name: 'A Classmate' } });
  assert.ok(!d.body.includes(CALLED_IT.peerLine));
  assert.equal(d.register, '');
});

test('the opener still passes the claim check, and stays a claim about what THEY said', () => {
  const d = draft({ audience: 'cohort', year: 2011 });
  assert.equal(verifyClaims(d.body).ok, true);
  assert.ok(d.claims.includes('they_predicted_it'));
  assert.ok(!/guaranteed|moon|100x/i.test(d.body));
});

test('the frame is stated in its checkable form, not as an occult claim', () => {
  assert.match(CALLED_IT.frame, /believed something about someone/);
  assert.ok(!/magic|occult|supernatural|power/i.test(CALLED_IT.frame));
});


// ── the legal line, drawn where the operator drew it ─────────────────────────────────────────────
test('the operator may state his own First Amendment position — that guard was wrong and is gone', () => {
  assert.equal(verifyClaims('My position is that religious use is legal under the First Amendment').ok, true);
  assert.equal(verifyClaims('It is legal under the First Amendment').ok, true);
  assert.equal(verifyClaims('We have a case, and it is live and unfinished').ok, true);
  assert.equal(verifyClaims('We have put together the law better than anyone').ok, true);
});

test('a WON or LANDMARK case is still refused — the case is live, and that is the fact today', () => {
  for (const t of ['we won our case', 'this is a landmark ruling', 'the court ruled in our favor', 'we set a precedent']) {
    const v = verifyClaims(t);
    assert.equal(v.ok, false, t);
    assert.ok(v.problems.some((p) => p.code === 'legal_win'), t);
  }
});

test('telling a READER that they are protected is refused — his exposure is his, theirs is not ours to hand them', () => {
  for (const t of ['you can legally use it', "you're protected under the First Amendment", 'you won\'t be prosecuted']) {
    const v = verifyClaims(t);
    assert.equal(v.ok, false, t);
    assert.ok(v.problems.some((p) => p.code === 'legal_advice_to_reader'), t);
  }
});

test('the law line states the position, names the case as live, and points at the corpus', () => {
  assert.match(CALLED_IT.lawLine, /First Amendment/);
  assert.match(CALLED_IT.lawLine, /live/);
  assert.equal(verifyClaims(CALLED_IT.lawLine).ok, true);
  assert.match(CALLED_IT.lawNeedsLink, /URL|link/i);
});


test('the hometown angle is subordinate to the main frame, not a replacement for it', () => {
  assert.equal(CALLED_IT.subordinateTo, MAIN_FRAME.id);
  assert.match(MAIN_FRAME.lineage, /MELECH|Van Kush/);
  assert.ok(MAIN_FRAME.canon.every((c) => c.startsWith('knowledge/scripture/')));
});

test('the Matrix is the TOKEN matrix — structure over price — and it carries its live URL', () => {
  assert.match(MAIN_FRAME.headline, /structure, not by its price/);
  assert.match(MAIN_FRAME.url, /witness\.melek\.salon\/dev\/matrix/);
  assert.ok(!/movie|film|simulation/i.test(JSON.stringify(MAIN_FRAME)), 'not that Matrix');
});


// ── the second degree ─────────────────────────────────────────────────────────────────────────────
const CLUSTER = [
  { id: 'a', name: 'Seed A', clusterEdges: [{ name: 'Hub Person', mutuals: 90 }, { name: 'One Off' }] },
  { id: 'b', name: 'Seed B', clusterEdges: [{ name: 'Hub Person', mutuals: 40 }] },
  { id: 'c', name: 'Seed C', clusterEdges: [{ name: 'Hub Person' }, { name: 'Seed A' }] },
];

test('repetition ranks above one big number — a hub beats a single loud profile', () => {
  const c = candidates(CLUSTER);
  assert.equal(c[0].name, 'Hub Person');
  assert.equal(c[0].appearsOn, 3);
  assert.deepEqual(c[0].via, ['Seed A', 'Seed B', 'Seed C']);
  assert.equal(c[0].highestMutualsSeen, 90, 'the highest count seen anywhere, never a sum');
});

test('someone already in the file is not a candidate', () => {
  assert.ok(!candidates(CLUSTER).some((c) => c.name === 'Seed A'));
});

test('every candidate is marked not contactable, and says why', () => {
  for (const c of candidates(CLUSTER)) {
    assert.equal(c.contactable, false);
    assert.match(c.status, /confirm or strike/);
  }
});

test('a row a rule already removed is not mined for its friends', () => {
  const c = candidates([
    { id: 'f', name: 'A Cousin', tags: ['family'], clusterEdges: [{ name: 'Family Friend' }] },
    { id: 'd', name: 'Disputed', identityDisputed: true, clusterEdges: [{ name: 'Someone Else' }] },
  ]);
  assert.deepEqual(c, [], 'family and disputed rows contribute nobody');
});

test('an alias account\'s name does not come back as a candidate', () => {
  const c = candidates([
    { id: 'main', name: 'A Person', clusterEdges: [{ name: 'A Person Second Account' }] },
    { id: 'alt', name: 'A Person Second Account', sameAs: 'main' },
  ]);
  assert.deepEqual(c, [], 'dedupe already answered this');
});

test('a bare string edge works as well as an object', () => {
  const c = candidates([{ id: 'x', name: 'X', clusterEdges: ['Plain Name'] }]);
  assert.deepEqual(c.map((y) => y.name), ['Plain Name']);
});

test('no edges means no candidates, not a crash', () => {
  assert.deepEqual(candidates([{ id: 'x', name: 'X' }]), []);
  assert.deepEqual(candidates([]), []);
});

test('rank() surfaces the candidates alongside everything else', () => {
  const r = rank(CLUSTER);
  assert.ok(r.candidates.length);
  assert.equal(r.candidates[0].name, 'Hub Person');
});

// local-outreach.test.mjs — OFFLINE. No network; the module does not fetch.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  SCHOOL, COHORTS, SEEDS, widen, assertPublicOnly, makeVenue, verifyClaims, draft, draftFor, plan, handler,
} from './local-outreach.mjs';

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

test('the supplied seed is public handles only', () => {
  for (const s of SEEDS) assert.equal(assertPublicOnly(s).ok, true, s.id);
  const jc = SEEDS.find((s) => s.id === 'jordan-coats');
  assert.ok(jc);
  assert.ok(jc.public.instagram.includes('jc_thehealthexpert'));
  // the website was NOT verified from this host — the record says so rather than implying it's live
  assert.match(jc.websiteStatus, /unverified/);
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

test('the seed draft addresses the connector as himself', () => {
  const d = draft({ audience: 'seed', seed: SEEDS[0] });
  assert.equal(d.ok, true);
  assert.match(d.body, /^Jordan Coats/);
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

test('plan() reports honestly that with no venues loaded this is not yet outreach', () => {
  const p = plan({});
  assert.equal(p.venues.total, 0);
  assert.match(p.blocked[0], /no venues loaded/);
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

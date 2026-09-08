// local-outreach — DFW outreach: the hometown cohorts and the people who connect them.
//
// Operator, 2026-09-08: reach the McKinney Boyd graduating classes (his and his sister's, 2009-2012
// to start) and the people around a named local connector, and tell them "this is DFW-based
// technology, it's ours" — built here, by people from here.
//
// TWO THINGS THIS MODULE IS CAREFUL ABOUT, because both are how this kind of outreach goes wrong:
//
//   1. WHAT WE CLAIM. The local-ownership pitch is strong precisely because it is checkable: the
//      operator is from McKinney, the company is in Dallas–Fort Worth, the code is public, the
//      chains are public, and the person behind it puts his own name on it. So `verifyClaims()`
//      passes the checkable version and REFUSES the unverifiable one — including a claim about who
//      runs somebody ELSE'S project. We do not know who runs anyone else's project. "You can see
//      exactly who we are" is both true and the same argument; "they're run by someone in China"
//      is neither.
//
//   2. WHO WE COLLECT. Venues and public accounts, never private-person records. A seed is a public
//      profile with public handles. `assertPublicOnly()` refuses an entry carrying a home address,
//      a phone number, a birthday or a private email — those are how a marketing list becomes a
//      dossier, and the alumni angle is exactly the context where that slip is easy.
//
// Nothing here sends. It drafts, and the drafts go through the same Herald gate as everything else
// (pentecaust/herald/entitlements.mjs: sending is operator-granted).

import { readFileSync } from 'node:fs';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();

// ── the cohorts ───────────────────────────────────────────────────────────────────────────────────
// McKinney Boyd's FIRST graduating class was 2008 (Wikipedia, McKinney Boyd High School). 2009-2012
// are therefore its 2nd-5th classes: a small, early, still-tight alumni population, which is why the
// operator's instinct to start there is right — these cohorts are findable and they know each other.
export const SCHOOL = Object.freeze({
  name: 'McKinney Boyd High School',
  district: 'McKinney ISD',
  city: 'McKinney', state: 'TX', county: 'Collin', metro: 'Dallas–Fort Worth',
  firstGraduatingClass: 2008,
  source: 'https://en.wikipedia.org/wiki/McKinney_Boyd_High_School',
});

export const COHORTS = Object.freeze([2009, 2010, 2011, 2012]);

/** How far outside the stated window still counts as the same cohort. See cohortStatus(). */
export const EDGE = 1;

/**
 * A YOUNGER sub-cohort joined the group through one person. Operator, 2026-09-08: "Then there was
 * Chelsea Pitt's Little Brother, and his Friends were the Younger ones that came in."
 *
 * Worth modelling separately rather than widening the window, because it is a different shape: not a
 * blur at the edge but a distinct group that arrived through a single named door. That door is the
 * efficient way to reach all of them, and it is one person.
 */
export const SUBCOHORTS = Object.freeze([
  {
    id: 'younger-via-chelsea-pitts-brother',
    who: 'the younger ones',
    enteredVia: "Chelsea Pitt's little brother",
    note: 'Name not yet supplied — the operator knows it. He is the entry point for a whole younger '
        + 'group, which makes him worth more than his own follower count suggests.',
    needs: "the brother's name",
  },
]);

/** Later classes to widen into once the first four are worked. Operator: "maybe Classes after ours". */
export function widen(years = COHORTS, by = 3) {
  const last = Math.max(...years);
  const extra = [];
  for (let y = last + 1; y <= last + by; y += 1) extra.push(y);
  return { seed: [...years], next: extra, all: [...years, ...extra] };
}

// ── seeds: named connectors, PUBLIC surfaces only ─────────────────────────────────────────────────
// A "seed" is someone with a real local audience whose public accounts we can approach openly and
// whose public community is the actual target. The operator supplies these; we do not go looking for
// private people.

/** Fields that must never appear on a seed. If one does, the entry is a dossier, not an audience. */
const PRIVATE_FIELDS = ['address', 'homeAddress', 'phone', 'mobile', 'dob', 'birthday', 'ssn', 'privateEmail'];

export function assertPublicOnly(seed = {}) {
  const bad = PRIVATE_FIELDS.filter((f) => str(seed[f]));
  if (bad.length) {
    return {
      ok: false, code: 'private-data',
      reason: `refusing this seed: it carries ${bad.join(', ')}. Outreach targets public accounts and `
            + 'public venues. A birthday and a home address make it a file on a person instead.',
    };
  }
  return { ok: true };
}

// The people themselves live OUTSIDE this public repo. A named private individual, their handles and
// their follower counts are not repo content — that is the same line `assertPublicOnly()` draws, applied
// to us. Seeds load from `.local/LOCAL_SEEDS.json` (gitignored); with no file, the list is empty and
// `plan()` says so honestly rather than pretending there is an audience.
export const SEEDS_FILE = process.env.LOCAL_SEEDS_FILE
  || new URL('../.local/LOCAL_SEEDS.json', import.meta.url).pathname;

export function loadSeeds(file = SEEDS_FILE, read = readFileSync) {
  try {
    const j = JSON.parse(read(file, 'utf8'));
    const list = Array.isArray(j) ? j : (j.seeds || []);
    return list.filter((s) => s && str(s.name));
  } catch { return []; }   // no file, bad JSON, no permission — an empty audience, never a crash
}

// ── venues ────────────────────────────────────────────────────────────────────────────────────────
// A venue is a public place a post could go. `promo` is the venue's OWN rule, and it is load-bearing:
// most alumni and neighborhood groups ban promotion, and posting anyway is how you get the account
// banned and the brand remembered as a spammer. `draftFor()` refuses those.
export const VENUE_KINDS = Object.freeze({
  alumni_group: 'a class or school alumni group',
  community_group: 'a neighborhood or city group',
  local_press: 'a newsroom that runs local-business stories',
  tech_community: 'a DFW startup/tech organization',
  school_official: 'the district or school itself',
  seed_audience: 'a named connector’s own public audience',
});

export function makeVenue({ id, name, kind, url, access = 'public', promo = 'unknown', notes = '' } = {}) {
  return {
    id: low(id) || low(name).replace(/[^a-z0-9]+/g, '-'),
    name: str(name), kind: str(kind), url: str(url),
    access: low(access),          // public | join-required | invite-only
    promo: low(promo),            // allowed | ask-first | banned | unknown
    notes: str(notes),
  };
}

// ── ranking ───────────────────────────────────────────────────────────────────────────────────────
// Which seed to work first. Three things actually predict whether an approach lands, and they are not
// follower count:
//
//   COHORT PROOF  a confirmed classmate is not a cold contact. It is the whole premise of the pitch.
//   TOPIC FIT     someone who already holds crypto reads a block explorer; someone who does not needs
//                 a different door entirely (the tools, the library, the local story).
//   BRIDGE WIDTH  mutual-friend count beats follower count — mutuals are people who would actually
//                 recognise the operator's name, which is what makes this warm rather than an ad.
//
// And one thing OUTRANKS all of it: an unanswered message. Pitching on top of a message you ignored is
// the worst possible open, so `rank()` pushes those to the top as a debt, not an opportunity.

export function score(seed = {}) {
  const tags = (seed.tags || []).map(low);
  const parts = [];
  let n = 0;
  // Any `<school>-confirmed` tag counts, not only Boyd — the second school network (McKinney North)
  // arrived the moment one profile listed a different school, and the scoring should not need editing
  // every time a new one does.
  if (tags.some((t) => t.endsWith('-confirmed'))) { n += 40; parts.push('confirmed classmate +40'); }
  else if (tags.some((t) => t.endsWith('-adjacent'))) { n += 15; parts.push('mutual of a confirmed classmate +15'); }
  if (tags.includes('class-year-known')) { n += 10; parts.push('class year known +10'); }
  if (tags.includes('bridges-two-schools')) { n += 10; parts.push('bridges two school networks +10'); }
  if (tags.includes('crypto')) { n += 30; parts.push('already in crypto +30'); }
  if (tags.includes('plant-medicine')) { n += 10; parts.push('overlaps the library +10'); }
  if (tags.includes('direct-sales')) { n += 5; parts.push('used to being pitched +5'); }
  const mut = Number(seed.mutualsWithOperator || 0);
  if (mut) { const m = Math.min(25, Math.round(mut / 8)); n += m; parts.push(`${mut} mutuals +${m}`); }
  const a = seed.audience || {};
  const reach = Number(a.followers || a.friends || 0);
  if (reach) { const r = Math.min(15, Math.round(reach / 400)); n += r; parts.push(`reach ${reach} +${r}`); }
  // NOT a penalty. An earlier version docked `not-yet-connected` ten points, which was wrong: a
  // missing friend edge says something about Facebook, not about whether these two people know each
  // other. Operator, 2026-09-08: "I didn't Send You a Profile of a Person who wouldn't know who I
  // was." Everyone in this file is someone he knows; the graph numbers rank them, they do not decide
  // whether the door is open.
  if (tags.includes('not-yet-connected')) parts.push('no friend edge yet (add first, then talk) +0');
  // Mutual-friend count is a proxy for "would they recognise the name", and it UNDER-measures a real
  // relationship — someone he dated shows 3 mutuals. When he says he knows someone well, that
  // outranks the graph.
  if (tags.includes('known-personally')) { n += 35; parts.push('close personal tie +35'); }
  return { score: n, why: parts };
}

/**
 * Family are not outreach. This is not a scoring adjustment — it is a removal.
 *
 * Two people sat in the ranking for hours before the operator said who they were: one is his sister,
 * one is his mother. His mother's profile lists her as a "Crypto Investor/Advisor", which read as the
 * strongest topical match in the file right up until the moment it read as a mother following her
 * son's work. Two unanswered messages from her ranked as a pipeline debt.
 *
 * No score fixes that. A list that can rank your own mother as a lead is broken whatever number it
 * puts on her, so `family` leaves the ranking entirely rather than sorting to the bottom.
 */
export const isFamily = (seed = {}) => (seed.tags || []).map(low).includes('family');

export function rank(seeds = null) {
  const all = (Array.isArray(seeds) ? seeds : loadSeeds()).filter((s) => assertPublicOnly(s).ok);
  const list = all.filter((s) => !isFamily(s));
  const family = all.filter(isFamily).map((s) => ({ id: s.id, name: str(s.name), relationship: str(s.relationship) }));
  const scored = list.map((s) => ({
    id: s.id, name: s.name, ring: s.ring || 9, ...score(s),
    owed: str(s.openThread),           // an unanswered message is a debt, not a lead
    approach: str(s.approach),
  }));
  const owed = scored.filter((x) => x.owed);
  const rest = scored.filter((x) => !x.owed).sort((a, b) => b.score - a.score || a.ring - b.ring);
  return {
    ok: true,
    firstDoThis: owed.map((x) => ({ ...x, reason: 'you owe them a reply — answer it before pitching anything' })),
    then: rest,
    // Listed so it is visible that they were removed, never so they can be worked from here.
    excludedAsFamily: family,
  };
}

/**
 * Where does each person sit relative to the operator's cohort window?
 *
 * Operator, 2026-09-08: "2009-2012 for me and my Sister." That is the window, and `COHORTS` is it.
 *
 * The distinction this function exists to hold is between a STATED year and an ESTIMATED one. Where a
 * profile displayed a birth year we derived a likely graduation year and discarded the date of birth
 * — the cohort year is what the school network needs, a date of birth is an identifier we have no use
 * for. But an estimate is arithmetic on somebody's age, not a fact about their schooling: people
 * repeat years, skip them, move districts, get held back, graduate early. So an estimate NEVER
 * becomes a `classYear`, and `join()` in signup/school-network.mjs takes a real year or nothing.
 *
 * The one year we can check validates the method rather than the individual answers: a profile that
 * states its class year is reproduced by the estimate. One control is not a proof, and this reports
 * `estimated` regardless.
 */
export function cohortStatus(seed = {}, years = COHORTS) {
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const stated = Number(seed.classYear) || 0;
  const guess = Number(seed.classYearEstimate) || 0;

  if (stated) {
    return stated >= lo && stated <= hi
      ? { state: 'confirmed-in-window', year: stated, why: `class of ${stated}, stated on their profile` }
      : { state: 'confirmed-outside', year: stated, why: `class of ${stated} — stated, and outside ${lo}-${hi}` };
  }
  if (guess) {
    if (guess >= lo && guess <= hi) {
      return { state: 'estimated-in-window', year: guess, needs: 'the actual year',
        why: `probably ${guess}, from a birth year — an estimate, not a fact. Confirm before treating them as a classmate.` };
    }
    // One year outside is INSIDE the real spread. Operator, 2026-09-08: "The Only Difference will be
    // like 1 Year Age Difference in Everyone." A cohort that tight is not bounded by its own edges —
    // people a year either side were in the same rooms. Combined with the estimate's own error bar
    // (a birth year gives ±1 before anyone repeats or skips a grade), treating 2008 or 2013 as
    // "outside" would drop real classmates on arithmetic twice over.
    if (guess >= lo - EDGE && guess <= hi + EDGE) {
      return { state: 'estimated-edge', year: guess, needs: 'the actual year',
        why: `probably ${guess} — one year off ${lo}-${hi}, which is inside the real spread rather than outside it. `
           + 'Same rooms, same people. Include and confirm.' };
    }
    return { state: 'estimated-outside', year: guess, needs: 'the actual year',
      why: `probably ${guess}, more than a year outside ${lo}-${hi}. Worth asking rather than dropping — an estimate is not a year.` };
  }
  return { state: 'unknown', year: 0, needs: 'a class year', why: 'no year and nothing to estimate from — ask.' };
}

/** Cohort roll-up: how much of the window we can actually account for. */
export function cohortReport(seeds = null, years = COHORTS) {
  const list = (Array.isArray(seeds) ? seeds : loadSeeds()).filter((s) => assertPublicOnly(s).ok);
  const rows = list
    .filter((s) => (s.tags || []).some((t) => low(t).endsWith('-confirmed')) || s.classYear || s.classYearEstimate)
    .map((s) => ({ name: str(s.name), school: str(s.school), ...cohortStatus(s, years) }));
  const by = {};
  for (const r of rows) by[r.state] = (by[r.state] || 0) + 1;
  return {
    window: [Math.min(...years), Math.max(...years)],
    rows,
    counts: by,
    honest: (by['confirmed-in-window'] || 0) === 0
      ? 'Not one person is a CONFIRMED member of the window yet. Estimates are not years.'
      : null,
  };
}

/**
 * Who is the actual hub of this cluster?
 *
 * Facebook shows a "Friends with X, Y and N others" strip on a profile and picks the three it thinks
 * matter most. Someone who keeps appearing in that strip across INDEPENDENT profiles is a hub — and
 * that is a different, better signal than their own mutual-friend count, because it is four other
 * people's graphs agreeing rather than one number.
 *
 * Counts ONLY the `signal` field, which holds those literal strips. An earlier version also counted
 * `why`, which says where WE got an entry from — that double-counted every source and made whoever
 * we happened to import a batch from look like a hub. `why` is our bookkeeping, not evidence.
 */
export function hubs(seeds = null) {
  const list = (Array.isArray(seeds) ? seeds : loadSeeds()).filter((s) => assertPublicOnly(s).ok);
  const names = list.map((s) => str(s.name)).filter(Boolean);
  const seen = new Map();
  for (const s of list) {
    const strip = str(s.signal);
    if (!strip) continue;
    for (const n of names) {
      if (n === s.name) continue;
      if (!strip.includes(n)) continue;
      if (!seen.has(n)) seen.set(n, []);
      seen.get(n).push(str(s.name));
    }
  }
  return [...seen.entries()]
    .map(([name, namedOn]) => ({ name, count: namedOn.length, namedOn }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ── the pitch ─────────────────────────────────────────────────────────────────────────────────────
// Claims split into what we can back and what we cannot. This list is the whole point of the module.

const CHECKABLE = Object.freeze({
  built_here: 'Built in Dallas–Fort Worth. The founder grew up in McKinney and went to Boyd.',
  named_founder: 'A real person’s name is on it — you can look him up, and you already might know him.',
  public_code: 'The code is public. You can read it before you trust it.',
  public_chains: 'The chains are public — every block, every transaction, checkable by anyone.',
  local_business: 'Family in the local printing business (Executive Press) — this is a DFW company, not an app store listing from nowhere.',
  free_to_look: 'Nothing to buy to look at it.',
});

const REFUSED = Object.freeze({
  who_runs_others: 'Any claim about who runs a competing project, or where they are. We do not know '
                 + 'that, and the checkable version of the argument ("you can see exactly who we '
                 + 'are") is stronger anyway.',
  accredited: 'The credentials are NON-accredited. Never imply otherwise.',
  guaranteed_returns: 'No claim that a token will be worth anything.',
  school_endorsement: 'McKinney Boyd and McKinney ISD have not endorsed this. Being an alum is not an endorsement.',
  personal_relationship: 'Never imply we know someone we do not, or that a mutual friend sent us.',
});

/**
 * Check a draft before it is allowed out. Returns the specific refusal, not a generic "unsafe".
 */
export function verifyClaims(text = '') {
  const t = low(text);
  const problems = [];
  if (/\b(china|chinese|foreign|overseas|offshore)\b/.test(t) && /\b(run|owned|operated|behind)\b/.test(t)) {
    problems.push({ code: 'who_runs_others', why: REFUSED.who_runs_others });
  }
  if (/\baccredited\b/.test(t) && !/\bnon-?accredited\b/.test(t)) {
    problems.push({ code: 'accredited', why: REFUSED.accredited });
  }
  if (/\b(guaranteed|guarantee|moon|100x|get rich|passive income)\b/.test(t)) {
    problems.push({ code: 'guaranteed_returns', why: REFUSED.guaranteed_returns });
  }
  if (/\b(endorsed|sponsored|official partner)\b/.test(t) && /\b(mckinney|boyd|isd|school)\b/.test(t)) {
    problems.push({ code: 'school_endorsement', why: REFUSED.school_endorsement });
  }
  return problems.length
    ? { ok: false, problems, reason: problems.map((p) => p.why).join(' ') }
    : { ok: true, claims: Object.keys(CHECKABLE) };
}

/**
 * Draft the message. `year` is the class year when writing to a cohort; `seed` when writing to a
 * connector. Returns { ok, subject, body } or a refusal — and NEVER sends.
 */
export function draft({ audience = 'cohort', year = 0, seed = null, product = 'SoapBox' } = {}) {
  const who = audience === 'seed' && seed
    ? str(seed.name)
    : (year ? `Boyd ${year}` : 'Boyd alumni');

  const opener = audience === 'seed'
    ? `${who} — I'm reaching out directly because you actually build things here.`
    : `${who} — this is Ryan Gallagher, ${SCHOOL.name}${year ? `, class of ${year}` : ''}.`;

  const body = [
    opener,
    '',
    `We built ${product} here in Dallas–Fort Worth. Not a re-skin of somebody else's app — our own `
    + 'blockchains, our own tools: document and PDF tools, image hosting, internet fax, private '
    + 'messaging, a translation layer, and an outreach tool for small businesses.',
    '',
    'The reason I\'m telling people from home first is simple: you can check every part of it. The '
    + 'code is public. The chains are public — every block and every transaction. My name is on it, '
    + 'and my family runs a printing company here. If you want to know who is behind the thing you '
    + 'are using, that is an actual answer, not a support address.',
    '',
    'Nothing to buy to look at it. If it\'s useful to you, use it. If you know someone it would help, '
    + 'that\'s the real ask.',
  ].join('\n');

  const v = verifyClaims(body);
  if (!v.ok) return { ok: false, ...v };

  return {
    ok: true,
    audience,
    to: who,
    subject: audience === 'seed'
      ? 'Built here in DFW — worth a look?'
      : `Boyd${year ? ` ${year}` : ''} — we built something here in DFW`,
    body,
    claims: Object.keys(CHECKABLE),
    sends: false,
    note: 'draft only — sending runs through the Herald entitlement gate (operator-granted accounts).',
  };
}

/** Refuse to draft a promo post for a venue whose own rules ban promotion. */
export function draftFor(venue = {}, opts = {}) {
  if (venue.promo === 'banned') {
    return {
      ok: false, code: 'promo-banned',
      reason: `${venue.name || 'that venue'} bans promotion. Be a member there; do not post an ad. `
            + 'Getting the account banned costs more than the post was ever worth.',
    };
  }
  if (venue.promo === 'unknown') {
    return {
      ok: false, code: 'rules-unknown',
      reason: `${venue.name || 'that venue'}'s posting rules have not been read yet. Read them first — `
            + 'an unknown rule is not permission.',
    };
  }
  const d = draft(opts);
  if (!d.ok) return d;
  return { ...d, venue: venue.id || venue.name, askFirst: venue.promo === 'ask-first' };
}

/** A plan: which cohorts, which seeds, which venues — and what is still missing. */
export function plan({ years = COHORTS, seeds = null, venues = [] } = {}) {
  const list = Array.isArray(seeds) ? seeds : loadSeeds();
  const bad = list.map((s) => ({ s, v: assertPublicOnly(s) })).filter((x) => !x.v.ok);
  const postable = venues.filter((v) => v.promo === 'allowed' || v.promo === 'ask-first');
  return {
    ok: bad.length === 0,
    school: SCHOOL.name,
    years: [...years],
    widening: widen(years),
    seeds: list.filter((s) => assertPublicOnly(s).ok).map((s) => ({ id: s.id, name: s.name, reach: s.audience && s.audience.followers })),
    rejectedSeeds: bad.map((x) => ({ id: x.s.id, reason: x.v.reason })),
    venues: { total: venues.length, postable: postable.length, banned: venues.filter((v) => v.promo === 'banned').length, unread: venues.filter((v) => v.promo === 'unknown').length },
    blocked: [
      ...(venues.length ? [] : ['no venues loaded yet — the venue research is what turns this into outreach']),
      ...(list.length ? [] : ['no seeds loaded — put them in .local/LOCAL_SEEDS.json, never in the repo']),
    ],
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'local-outreach',
    school: SCHOOL, cohorts: COHORTS, seeds: loadSeeds().length,
    checkableClaims: CHECKABLE, refusedClaims: REFUSED,
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('local-outreach.mjs')) {
  const p = plan({});
  console.log(JSON.stringify(p, null, 1));
  console.log('\n--- sample cohort draft ---\n');
  const d = draft({ audience: 'cohort', year: 2010 });
  console.log(d.ok ? `${d.subject}\n\n${d.body}` : d.reason);
}

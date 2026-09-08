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
// Two kinds of field are refused here, for two different reasons.
//
// The first kind is CONTACT-AND-IDENTITY — address, phone, date of birth. Those turn a list of public
// profiles into a way to find someone off the internet.
//
// The second kind is HISTORY — a conviction, an arrest, a hospitalisation, an immigration status. That
// one is worse, and it is the one that nearly got written down today: the operator described what a
// man from his class went to prison for. It is his to know; it is not a field. A criminal record in a
// marketing file does nothing but sit there waiting to be sorted on, and there is no version of
// "reach out to people from home" that is improved by the software knowing who did time.
//
// Neither list is exhaustive and neither is the real protection — the real protection is that nothing
// here sends. These are the shapes we have actually been handed, refused by name.
const PRIVATE_FIELDS = [
  'address', 'homeAddress', 'phone', 'mobile', 'dob', 'birthday', 'ssn', 'privateEmail',
  'criminalRecord', 'conviction', 'charges', 'arrest', 'incarceration', 'sentence',
  'medical', 'diagnosis', 'immigrationStatus',
];

export function assertPublicOnly(seed = {}) {
  const bad = PRIVATE_FIELDS.filter((f) => str(seed[f]));
  if (bad.length) {
    return {
      ok: false, code: 'private-data',
      reason: `refusing this seed: it carries ${bad.join(', ')}. Outreach targets public accounts and `
            + 'public venues. A birthday, a home address or a conviction make it a file on a person '
            + 'instead — and a record is the one field that can only ever be used against them.',
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

// A venue nobody can open is a venue nobody read the rules of. `draftFor()` already refuses `unknown`
// promo, but a missing URL is the earlier failure: it means the venue was written down from memory,
// and the rule that gets an account banned is the one that was never actually looked at.
export function assertVenueCheckable(venue = {}) {
  if (!str(venue.name)) return { ok: false, code: 'no-name', reason: 'a venue with no name is not a venue.' };
  if (!str(venue.url)) {
    return {
      ok: false, code: 'no-url',
      reason: `${venue.name} has no link. Without one nobody can read its rules, and an unread rule is `
            + 'how the account gets banned. Find the link or drop the venue.',
    };
  }
  return { ok: true };
}

// Venues load the same way seeds do and for the same reason: a list of local groups, who runs them and
// what they allow is research about real communities, not repo content. `.local/LOCAL_VENUES.json` is
// gitignored; with no file the list is empty and `plan()` says so instead of pretending.
export const VENUES_FILE = process.env.LOCAL_VENUES_FILE
  || new URL('../.local/LOCAL_VENUES.json', import.meta.url).pathname;

export function loadVenues(file = VENUES_FILE, read = readFileSync) {
  try {
    const j = JSON.parse(read(file, 'utf8'));
    const list = Array.isArray(j) ? j : (j.venues || []);
    return list.filter((v) => v && str(v.name)).map((v) => makeVenue(v));
  } catch { return []; }   // no file, bad JSON, no permission — no venues, never a crash
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

/**
 * The kinds of business that BUY what SoapBox already sells.
 *
 * This axis was missing and it is the one that carries revenue. The file was built to tell classmates
 * about a chain; the first pass through it turned up a wine bistro, a barber and a print-and-signage
 * franchise. Those are not people to tell about a blockchain — they are businesses with a document,
 * image-hosting, fax and web problem, staffed by someone who will answer because he went to school
 * with them. That is the warmest B2B lead this company has, and it was scoring below a stranger with
 * matching tags.
 *
 * The mapping is deliberately shallow. A keyword on a job title is a hint about which door to knock
 * on, not a qualification — `buyerWhy` names the actual product so the operator can throw it out when
 * he knows better, which he usually will.
 */
export const BUYER_KINDS = Object.freeze([
  { id: 'print-doc', weight: 30, match: /\b(print|printing|graphics|signage|sign shop|copy|mail ?box|document|shipping|notary|ups store|fedex office|alphagraphics|minuteman)\b/i,
    why: 'print and document shops resell exactly what SoapBox does — conversion, fax, hosting' },
  { id: 'realty-legal-medical', weight: 28, match: /\b(realtor|real estate|broker|title|escrow|attorney|law|legal|paralegal|clinic|dental|chiropract|insurance|agency|agent)\b/i,
    why: 'the industries that still run on fax and PDF, and that pay for a records deadline' },
  { id: 'hospitality-retail', weight: 18, match: /\b(restaurant|bistro|cafe|coffee|bar\b|brewery|winery|wine|salon|barber|spa|tattoo|boutique|shop|store|gym|studio)\b/i,
    why: 'a storefront needs a site, images, menus and a booking page more than it needs a token' },
  { id: 'trades', weight: 16, match: /\b(hvac|plumb|electric|roof|landscap|construction|contractor|remodel|auto|mechanic|towing|detailing)\b/i,
    why: 'trades run on quotes, invoices and photos of the job — all document work' },
  { id: 'creator-media', weight: 14, match: /\b(creator|photograph|videograph|dj\b|musician|artist|podcast|marketing|design|social media)\b/i,
    why: 'creators need hosting and a link surface, and they already understand paying for tools' },
]);

/**
 * What does this person's work make them a buyer for? Reads the fields a profile actually shows —
 * employer, job title, self-description, a business name — and returns the best match with the reason.
 */
export function buyerFit(seed = {}) {
  const hay = [seed.work, seed.title, seed.employer, seed.describesSelf,
    seed.business && seed.business.name, seed.business && seed.business.kind]
    .map(str).filter(Boolean).join(' · ');
  if (!hay) return { fit: 'none', weight: 0, why: '', evidence: '' };
  for (const k of BUYER_KINDS) {
    if (k.match.test(hay)) return { fit: k.id, weight: k.weight, why: k.why, evidence: hay };
  }
  // Employed somewhere we cannot classify is still worth more than no employer at all — a person with
  // a job has a workplace with problems, we just do not know which ones yet.
  return { fit: 'unclassified', weight: 6, why: 'employed, but the business type is not known yet — ask', evidence: hay };
}

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
  // What they do for a living, which is the axis that carries money. See buyerFit().
  const b = buyerFit(seed);
  if (b.weight) { n += b.weight; parts.push(`${b.fit} +${b.weight} (${b.evidence})`); }
  // An account nobody posts from is reach that does not exist. 444 friends and zero posts is not a
  // door, it is a nameplate on a door — so it does not get counted as one.
  const posts = Number((seed.audience || {}).posts);
  if (Number.isFinite(posts) && posts <= 10) {
    const back = Math.min(n, 10);
    n -= back;
    parts.push(`dormant account (${posts} posts) -${back} — find a route off Facebook before writing`);
  }
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

/**
 * An account whose identity is in question does not score.
 *
 * A file of profiles takes each one at face value; it has no way to tell a person from a second
 * account someone made. When the operator raises that doubt, the entry stops counting until it is
 * resolved — because a possibly-duplicate account with 55 mutual friends does not just add a wrong
 * row, it inflates every aggregate it appears in. Excluded, listed, and recoverable — not deleted.
 */
export const isDisputed = (seed = {}) => Boolean(seed.identityDisputed)
  || (seed.tags || []).map(low).includes('identity-disputed');

/**
 * Someone the operator has personal history with is not a campaign row.
 *
 * Operator, 2026-09-08: "I Dated Jen, Marie and Kaitlyn and maybe more on the List."
 *
 * This is NOT the family rule — contact is fine, and he may well want to tell them. It is that a
 * drafted, sequenced, scored message is the wrong instrument: "we built something, take a look"
 * reads completely differently from someone you dated than from a classmate, and a pipeline cannot
 * hear that difference. So they leave the ranking and come back as a list he writes himself.
 *
 * The load-bearing part is "and maybe more". This module cannot detect personal history from a
 * profile, so an untagged row is not a safe row — it is an unmarked one. That is one more reason
 * nothing in this file is a bulk send.
 */
export const isPersonal = (seed = {}) => {
  const t = (seed.tags || []).map(low);
  return t.includes('dated') || t.includes('personal-history') || t.includes('justice-involved');
};

/**
 * Why a seed left the ranking — because the two reasons are not the same reason, and the operator
 * should not have to remember which is which when he reads the list back.
 *
 * `justice-involved` is the second one, added 2026-09-08 when the operator sent a classmate's profile
 * along with what he went to prison for. The man is home now and the operator has seen him since.
 * Contact is not the question — a scored, sequenced, drafted pitch is. Someone rebuilding a life after
 * a sentence is the last person who should receive a message that a pipeline decided to send, and the
 * only instrument that fits is the operator typing it himself. The tag records THAT, and nothing else:
 * what happened is not in the file, because `assertPublicOnly()` refuses to let it be.
 */
export function personalReason(seed = {}) {
  const t = (seed.tags || []).map(low);
  if (t.includes('justice-involved')) {
    return 'he is rebuilding — this is a message you type yourself or not at all, never a sequence';
  }
  if (t.includes('dated')) return 'you dated — a drafted pitch reads completely differently from you';
  return 'personal history — yours to write';
}

/**
 * One person, one row.
 *
 * Operator, 2026-09-08: two profiles for the same name arrived a minute apart. One has 664 friends,
 * 1.5K posts and 22 mutuals with him; the other has 16 friends, 6 posts, 5 mutuals, and states a city
 * two states away. Two accounts, almost certainly one man — a new account someone made and barely
 * used, next to the one he actually lives on.
 *
 * This is NOT `identityDisputed`. That rule is for an account we cannot vouch for, and it excludes.
 * A duplicate is the opposite problem: the person is real and known, and the failure is *counting him
 * twice*. Two rows means two messages to one man, mutuals summed into a number nobody has (22 + 5 = 27
 * is not a fact about anybody), and a hub score inflated by an account with sixteen friends.
 *
 * So `sameAs` collapses the alias into the primary and the alias keeps NO score of its own. The
 * primary is the account to actually reach him at, which is the bigger, older, actually-used one
 * unless the operator says otherwise — `primary: true` wins over the heuristic, because he is the one
 * who knows which account the man reads.
 */
export function dedupe(seeds = null) {
  const list = Array.isArray(seeds) ? seeds : loadSeeds();
  const byId = new Map(list.map((s) => [str(s.id), s]));
  const weight = (s) => Number((s.audience || {}).followers || (s.audience || {}).friends || 0)
    + Number(s.mutualsWithOperator || 0) * 10;

  // Group every seed under the id at the end of its sameAs chain (with a visited set, because a pair
  // of seeds pointing at each other is a typo, not a reason to hang).
  const rootOf = (s) => {
    const seen = new Set();
    let cur = s;
    while (str(cur.sameAs) && byId.has(str(cur.sameAs)) && !seen.has(str(cur.id))) {
      seen.add(str(cur.id));
      cur = byId.get(str(cur.sameAs));
    }
    return cur;
  };
  const groups = new Map();
  for (const s of list) {
    const k = str(rootOf(s).id) || str(s.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  const people = [];
  const aliases = [];
  for (const members of groups.values()) {
    if (members.length === 1) { people.push(members[0]); continue; }
    const stated = members.find((m) => m.primary === true);
    const chosen = stated || members.slice().sort((a, b) => weight(b) - weight(a))[0];
    const others = members.filter((m) => m !== chosen);
    people.push({
      ...chosen,
      alsoAt: others.map((m) => ({ id: str(m.id), name: str(m.name), note: str(m.duplicateNote) })),
      // Named so nobody later reads the primary's mutual count as "all the mutuals across his accounts".
      primaryChosenBy: stated ? 'operator said so' : 'the bigger, more-used account — confirm he reads it',
    });
    for (const m of others) {
      aliases.push({ id: str(m.id), name: str(m.name), collapsedInto: str(chosen.id) });
    }
  }
  return { people, aliases };
}

/**
 * Same name, no `sameAs` between them — flagged, never merged.
 *
 * Merging on a name match is how two different people become one row, and the DFW file is exactly
 * where that happens: hometown cohorts are full of shared surnames. So this only ASKS. The operator
 * resolves it by adding `sameAs` (one man, two accounts) or `identityDisputed` (not who it says).
 */
export function possibleDuplicates(seeds = null) {
  const list = (Array.isArray(seeds) ? seeds : loadSeeds()).filter((s) => str(s.name));
  const key = (s) => {
    const parts = low(s.name).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
  };
  const seen = new Map();
  for (const s of list) {
    const k = key(s);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(s);
  }
  const out = [];
  for (const [k, members] of seen) {
    if (members.length < 2) continue;
    if (members.some((m) => str(m.sameAs) || m.identityDisputed)) continue;   // already answered
    const cities = [...new Set(members.map((m) => str(m.city)).filter(Boolean))];
    out.push({
      name: k,
      accounts: members.map((m) => ({
        id: str(m.id), name: str(m.name), city: str(m.city),
        mutuals: Number(m.mutualsWithOperator || 0),
        reach: Number((m.audience || {}).followers || (m.audience || {}).friends || 0),
      })),
      conflict: cities.length > 1 ? `they state different cities (${cities.join(', ')}) — that is a reason to ask, not to merge` : '',
      resolveWith: 'sameAs (one person, two accounts) or identityDisputed (not who it says) — do not guess',
    });
  }
  return out;
}

/**
 * Who keeps showing up on other people's profiles.
 *
 * Operator, 2026-09-08: "see if You can Start Finding any Emails for their Friends and stuff, and
 * maybe You can Start Finding Things that way."
 *
 * Every profile carries a handful of named friends and, sometimes, their mutual counts. Those names
 * are the second degree, and the useful signal in them is not any single name — it is REPETITION.
 * Someone listed on one seed's profile is a friend. Someone listed on six of them is a hub, and a hub
 * is worth finding a route to before any of the six are worth writing to.
 *
 * WHAT THIS IS NOT. It is not a list of people to contact. Nobody here has been confirmed as anyone
 * the operator actually knows, nothing has been researched about them, and a name on a friend card is
 * not consent to be looked up. They come back as CANDIDATES for him to confirm or strike, and
 * `contactable` is false on every one. That flag is the whole point: an expansion path that quietly
 * turns into a mailing list is exactly how the first-degree file would have gone wrong too.
 */
export function candidates(seeds = null) {
  const list = (Array.isArray(seeds) ? seeds : loadSeeds()).filter((s) => assertPublicOnly(s).ok);
  const known = new Set();
  for (const s of list) {
    known.add(low(s.name));
    for (const a of (s.alsoAt || [])) known.add(low(a.name));
  }
  const seen = new Map();
  for (const s of list) {
    if (isFamily(s) || isDisputed(s)) continue;   // do not mine a row a rule already removed
    for (const e of (s.clusterEdges || [])) {
      const name = str(e && e.name ? e.name : e);
      if (!name || known.has(low(name))) continue;
      const k = low(name);
      if (!seen.has(k)) seen.set(k, { name, seenOn: [], mutualsSeen: 0 });
      const rec = seen.get(k);
      rec.seenOn.push(str(s.name));
      const m = Number((e && e.mutuals) || 0);
      if (m > rec.mutualsSeen) rec.mutualsSeen = m;
    }
  }
  return [...seen.values()]
    .map((c) => ({
      name: c.name,
      appearsOn: c.seenOn.length,
      via: c.seenOn,
      highestMutualsSeen: c.mutualsSeen,
      // Repetition first — a hub is worth more than one big number on a single profile.
      weight: c.seenOn.length * 10 + Math.min(20, Math.round(c.mutualsSeen / 8)),
      contactable: false,
      status: 'candidate — not confirmed as someone the operator knows, and not researched. His to '
            + 'confirm or strike before anyone looks either of us up.',
    }))
    .sort((a, b) => b.weight - a.weight || b.highestMutualsSeen - a.highestMutualsSeen);
}

export function rank(seeds = null) {
  // Collapse duplicate accounts BEFORE anything is scored — a second account must never contribute a
  // second row, a second message, or a second helping of mutuals.
  const all = dedupe((Array.isArray(seeds) ? seeds : loadSeeds()).filter((s) => assertPublicOnly(s).ok)).people;
  const list = all.filter((s) => !isFamily(s) && !isDisputed(s) && !isPersonal(s));
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
    // Not "do not contact" — "do not draft". He writes these himself.
    writeTheseYourself: all.filter(isPersonal).map((s) => ({
      id: s.id, name: str(s.name), relationship: str(s.relationship), why: personalReason(s),
    })),
    excludedAsDisputed: all.filter(isDisputed).map((s) => ({ id: s.id, name: str(s.name), reason: str(s.disputeNote) })),
    // The revenue segment, called out separately: people we know who work somewhere that buys what we
    // already sell. This is a different conversation from the chain, and it should not be buried in
    // one ranked list with it.
    businessesWeKnow: all
      .filter((s) => !isFamily(s) && !isDisputed(s) && !isPersonal(s))
      .map((s) => ({ s, b: buyerFit(s) }))
      .filter((x) => x.b.weight >= 14)
      .sort((a, b2) => b2.b.weight - a.b.weight || Number(b2.s.mutualsWithOperator || 0) - Number(a.s.mutualsWithOperator || 0))
      .map((x) => ({
        id: x.s.id, name: str(x.s.name), fit: x.b.fit, why: x.b.why,
        business: str((x.s.business && x.s.business.name) || x.s.work),
        mutuals: Number(x.s.mutualsWithOperator || 0),
        pitch: 'SoapBox first, chain second — sell them the thing their business already needs',
      })),
    // Rows that were folded into another account, and rows that look like they should be but nobody said.
    collapsedDuplicates: dedupe(Array.isArray(seeds) ? seeds : loadSeeds()).aliases,
    askAboutDuplicates: possibleDuplicates(Array.isArray(seeds) ? seeds : loadSeeds()),
    // The second degree — names off other people's friend cards, ranked by how many profiles they
    // appear on. Candidates for him to confirm, never a list to work from.
    candidates: candidates(Array.isArray(seeds) ? seeds : loadSeeds()).slice(0, 40),
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
  const list = (Array.isArray(seeds) ? seeds : loadSeeds())
    .filter((s) => assertPublicOnly(s).ok && !isDisputed(s));
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
  they_predicted_it: 'The people on this list said in high school that he would end up doing something '
                   + 'like this. That is a fact about what THEY said, it is theirs to confirm or deny, '
                   + 'and it is the only opener here that is not a pitch.',
  law_assembled: 'The religious-cannabis exemption law has been ASSEMBLED and published better than '
               + 'anyone else has assembled it. A claim about a body of work, checkable by reading it.',
  first_amendment_position: 'That religious cannabis use is protected under the First Amendment is the '
                          + 'operator\'s stated constitutional position, and it is his to state. It is '
                          + 'an argued reading of free exercise and RFRA, not a report of a settled '
                          + 'holding, and it says nothing about any particular reader\'s exposure.',
  live_case: 'There IS a case. It is live and unfinished — not a landmark, not a precedent, not won. '
           + '"We have a case" is true; "we won" is not, and neither is anything that implies the '
           + 'question is settled.',
});

const REFUSED = Object.freeze({
  who_runs_others: 'Any claim about who runs a competing project, or where they are. We do not know '
                 + 'that, and the checkable version of the argument ("you can see exactly who we '
                 + 'are") is stronger anyway.',
  accredited: 'The credentials are NON-accredited. Never imply otherwise.',
  guaranteed_returns: 'No claim that a token will be worth anything.',
  school_endorsement: 'McKinney Boyd and McKinney ISD have not endorsed this. Being an alum is not an endorsement.',
  personal_relationship: 'Never imply we know someone we do not, or that a mutual friend sent us.',
  legal_win: 'Never claim a WON or LANDMARK case, a precedent, or a court ruling in our favour. '
           + 'Operator, 2026-09-08: "we do like have a Case, just not a Landmark Finished Case." The '
           + 'case is live and unfinished. Saying otherwise is false today and stays false until a '
           + 'court says it.',
  legal_advice_to_reader: 'Never tell a READER that they can legally do something, that they are '
                        + 'protected, or that they will not be prosecuted. The operator\'s First '
                        + 'Amendment position is his to state and it is stated as a position; turning '
                        + 'it into "so you can go ahead" is individualized legal advice, it is out of '
                        + 'scope (CLAUDE.md §Scope), and it is the one line here that a stranger could '
                        + 'act on and be arrested for. His own exposure is his to carry. Theirs is not '
                        + 'ours to hand them.',
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
  // The legal boundary, and it is TWO lines, not one.
  //
  // An earlier version of this check blocked "it is legal under the First Amendment" outright. That
  // was wrong and the operator said so: that is his stated constitutional position, he is the one
  // carrying the case, and a guard that stops the founder from stating his own legal argument is a
  // rule nobody asked for. The two things that stay blocked are narrower and they are real:
  //
  //   1. A WON or LANDMARK case. There is a case; it is live and unfinished. Claiming a precedent is
  //      false today.
  //   2. Telling the READER that THEY are protected. His exposure is his to carry; theirs is not ours
  //      to hand them, and that is the sentence someone else could act on and be arrested for.
  if (/\b(we won|won (?:the|our) case|landmark (?:case|ruling|decision)|set(?: a)? precedent|court ruled|ruling in our favou?r|case (?:is )?(?:settled|decided))\b/.test(t)) {
    problems.push({ code: 'legal_win', why: REFUSED.legal_win });
  }
  if (/\b(you can legally|you'?re protected|you are protected|legal for you|it'?s legal to (?:use|carry|grow|possess)|you won'?t be prosecuted|no risk of arrest)\b/.test(t)) {
    problems.push({ code: 'legal_advice_to_reader', why: REFUSED.legal_advice_to_reader });
  }
  return problems.length
    ? { ok: false, problems, reason: problems.map((p) => p.why).join(' ') }
    : { ok: true, claims: Object.keys(CHECKABLE) };
}

/**
 * Draft the message. `year` is the class year when writing to a cohort; `seed` when writing to a
 * connector. Returns { ok, subject, body } or a refusal — and NEVER sends.
 */
/**
 * The opener for the friends list, and it is not a pitch.
 *
 * Operator, 2026-09-08: "in Highschool Everyone knew I was going to be like Famous or a Cult Leader,
 * or like Take Over the World."
 *
 * That changes the whole message. Every other audience gets told what we built; this audience already
 * predicted it. So the opener cashes their own prediction rather than making a claim: the strongest
 * thing that can be said to a person from home is a thing THEY said first.
 *
 * THE FRAME, and why it is the defensible version. The operator's framing is that this competes with
 * Kek — a group belief that produced a result. It does, and it wins on the only axis that can be
 * checked: that egregore produced memes, this one produced a chain you can open in a browser, a
 * mining pool you can point a miner at, and a company with a name on it. The claim is not
 * "collective belief has occult power". The claim is "a group of people believed something about a
 * person and the person went and built it" — which is what actually happened, is what they will
 * remember, and needs no defending. Stated that way it never trips the self-disclaim (BRIEF.md §5).
 *
 * What it must never become is flattery or a mutual-friend pretext (see REFUSED.personal_relationship).
 * It says what they said. They get to decide whether they meant it.
 */
/**
 * THE MAIN FRAME — and everything below it is a door into this, not a replacement for it.
 *
 * Operator, 2026-09-08: "Look for where we were Talking about the Matrix and Royal Families and stuff,
 * that all is the Main Framing, this is just a Small Addition." Then, correcting a wrong guess of
 * mine: "the 'Matrix' has to do the Tokenomics of Graphene Chains and Tokens."
 *
 * So the Matrix is not the film and it is not a metaphor. It is **The Token Matrix**, live at
 * `witness.melek.salon/dev/matrix` (`site/witness/server.mjs` → devMatrixPage), and its argument is
 * one sentence: **read a token by its structure, not by its price.** Two matrices on that page —
 * the Graphene social chains side by side (HIVE / STEEM / BLURT / MELEK: downvotes, fee model,
 * author-curator split, side-token layer), and the token rows read by what actually governs the cost
 * of holding a value — percent staked, cooldown length, and the real float that is left. VKBT and
 * CURE against high-float contrast rows, from live Hive-Engine data with an as-of date.
 *
 * That is the frame for the holder campaign, and it is the reason the holder list is the right list:
 * these are people who already hold a token whose structure the page explains. It is checkable — the
 * numbers are on-chain — which is the same argument the hometown pitch makes in a different register.
 *
 * The second half of the main framing is the corpus: the Van Kush Family Research Institute, the
 * Royal Military lineage out of Cush/Nubia, Temple Culture, and MELECH = ANGEL = KING = MESSENGER,
 * which is why the chain is named MELEK. Canon in `knowledge/scripture/`.
 *
 * Every hometown-specific angle below is a LOCAL DOOR into this. The prophecy line and the case are
 * how one particular audience gets in. They are not the building.
 */
export const MAIN_FRAME = Object.freeze({
  id: 'token-matrix-and-lineage',
  headline: 'Read a token by its structure, not by its price — percent staked, cooldown, and the real '
          + 'float that is left. That is the Token Matrix, and it is why these holders are the list.',
  url: 'https://witness.melek.salon/dev/matrix',
  source: 'site/witness/server.mjs (devMatrixPage) — live Hive-Engine rows, pinned with an as-of date',
  lineage: 'The other half: the Van Kush Family Research Institute, the Royal Military lineage, Temple '
         + 'Culture, and MELECH = ANGEL = KING = MESSENGER — which is why the chain is named MELEK.',
  canon: ['knowledge/scripture/van_kush_master_synthesis.md', 'knowledge/scripture/mythology_as_genealogy.md'],
  subordinate: 'Everything hometown-specific — the prophecy line, the case — is a door into this frame, '
             + 'not a substitute for it. Lead with the work; the local angle is why THIS list opens it.',
});

export const CALLED_IT = Object.freeze({
  claim: 'they-predicted-it',
  subordinateTo: MAIN_FRAME.id,   // a door into the frame above, never the frame itself
  line: 'You lot decided in high school that I was going to end up either famous, running a cult, or '
      + 'taking over the world. I want to report that I went with infrastructure.',
  /**
   * The second prediction, and the one that has to be worded exactly.
   *
   * Operator, 2026-09-08: "a lot of People knew I was going to do a Religious Marijuana Case and get
   * it like on the Record that it's Legal, like I have. Not that we have a Case, but we have put
   * together the Law Better than anyone."
   *
   * He drew the line himself and it is the right one. The claim is the BODY OF WORK — the religious-
   * exemption law assembled and published more completely than anyone else has assembled it. It is
   * not a case, not a ruling, and it is emphatically not "this is legal for you". REFUSED.legal_win
   * enforces that, because the overstatement here is the one a reader can act on and get arrested for.
   */
  lawLine: 'The other thing people said I would do was the religious cannabis case, and that one is '
         + 'live. My position is that religious use is protected under the First Amendment, and the '
         + 'work behind it — the law itself, assembled more completely than anyone else has assembled '
         + 'it — is published and you can read the whole argument yourself.',
  lawNeedsLink: 'This line does not ship until it carries the URL of the published corpus. A claim to '
              + 'have assembled the law better than anyone is only checkable if the reader can open '
              + 'it, and an unfinished case is exactly where a reader deserves the primary source.',
  frame: 'A group of people believed something about someone, and he went and built it. That is the '
       + 'whole of the claim — and unlike the other version of that story going around, this one '
       + 'produced a chain, a pool and a company you can open in a browser rather than a frog.',
  // Copy, for someone who was already building an audience back then. Peer to peer, not announcement
  // to audience — they were on the same track and they will notice immediately if the register is off.
  peerLine: 'You were already doing the audience thing back then, so you will know exactly how much of '
          + 'this is work and how little of it is luck.',
  peerNote: 'A creator gets the peer register, not the announcement register.',
});

export function draft({ audience = 'cohort', year = 0, seed = null, product = 'SoapBox', calledIt = true } = {}) {
  const who = audience === 'seed' && seed
    ? str(seed.name)
    : (year ? `Boyd ${year}` : 'Boyd alumni');

  const opener = audience === 'seed'
    ? `${who} — I'm reaching out directly because you actually build things here.`
    : `${who} — this is Ryan Gallagher, ${SCHOOL.name}${year ? `, class of ${year}` : ''}.`;

  // Someone who was already building an audience back then is a peer, not an announcement target.
  const peer = seed && (buyerFit(seed).fit === 'creator-media'
    || (seed.tags || []).map(low).includes('creator-account'));

  const body = [
    opener,
    ...(calledIt ? ['', CALLED_IT.line, ...(peer ? ['', CALLED_IT.peerLine] : [])] : []),
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
    calledIt: Boolean(calledIt),
    register: peer ? CALLED_IT.peerNote : '',
    subject: calledIt
      ? 'Turns out it was infrastructure'
      : (audience === 'seed'
        ? 'Built here in DFW — worth a look?'
        : `Boyd${year ? ` ${year}` : ''} — we built something here in DFW`),
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
export function plan({ years = COHORTS, seeds = null, venues = null } = {}) {
  const list = Array.isArray(seeds) ? seeds : loadSeeds();
  const bad = list.map((s) => ({ s, v: assertPublicOnly(s) })).filter((x) => !x.v.ok);
  const allVenues = Array.isArray(venues) ? venues.map((v) => makeVenue(v)) : loadVenues();
  const uncheckable = allVenues.filter((v) => !assertVenueCheckable(v).ok);
  const checkable = allVenues.filter((v) => assertVenueCheckable(v).ok);
  // Only a venue we can open AND whose rule we have read is postable. Unknown is not permission.
  const postable = checkable.filter((v) => v.promo === 'allowed' || v.promo === 'ask-first');
  return {
    ok: bad.length === 0,
    school: SCHOOL.name,
    years: [...years],
    widening: widen(years),
    seeds: list.filter((s) => assertPublicOnly(s).ok).map((s) => ({ id: s.id, name: s.name, reach: s.audience && s.audience.followers })),
    rejectedSeeds: bad.map((x) => ({ id: x.s.id, reason: x.v.reason })),
    venues: {
      total: allVenues.length,
      postable: postable.length,
      banned: checkable.filter((v) => v.promo === 'banned').length,
      unread: checkable.filter((v) => v.promo === 'unknown').length,
      uncheckable: uncheckable.length,
    },
    // The ones to work next: a venue we can open whose rules nobody has read yet. Reading a rule is
    // free and it is the only thing standing between this list and an actual post.
    readNext: checkable.filter((v) => v.promo === 'unknown').map((v) => ({ id: v.id, name: v.name, url: v.url })),
    blocked: [
      ...(allVenues.length ? [] : ['no venues loaded yet — the venue research is what turns this into outreach']),
      ...(allVenues.length && !postable.length
        ? [`${checkable.filter((v) => v.promo === 'unknown').length} venue(s) loaded but none readable as permission yet — read their posting rules (plan().readNext)`]
        : []),
      ...(uncheckable.length ? [`${uncheckable.length} venue(s) have no link and cannot be checked`] : []),
      ...(list.length ? [] : ['no seeds loaded — put them in .local/LOCAL_SEEDS.json, never in the repo']),
    ],
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'local-outreach',
    school: SCHOOL, cohorts: COHORTS, seeds: loadSeeds().length, venues: loadVenues().length,
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

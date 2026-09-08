// school-network — the Facebook-2004 mechanic, applied to our social stack.
//
// Operator, 2026-09-08: "Kind of like what Facebook was to Start, let's get Everyone from my School
// on the Social Media stuff if we can." Starting with McKinney Boyd, classes 2009-2012.
//
// WHAT ACTUALLY MADE THAT WORK, and what this module therefore enforces:
//
//   1. A BOUNDED NETWORK. Not "join our social network" — "your class is on here." The boundary is
//      the product. A school network is a school and a set of class years, and membership says which
//      one you are in.
//
//   2. THE ROOM WAS NEVER EMPTY. This is the part everyone forgets and the reason most clones die.
//      Facebook did not open a school until enough people from it had already signed up; the first
//      person through the door saw people they knew. So this module REFUSES to open a network below
//      a threshold and holds signups on a waitlist instead. An empty network shown to a classmate is
//      not a soft launch — it is the one impression you cannot take back, and you get one per person.
//
//   3. INVITES CAME FROM CLASSMATES. Growth is the existing invite tree (signup/invites.mjs), not a
//      broadcast. `inviteBudget()` reads that tree rather than inventing a second one.
//
// This module tracks membership and readiness. It does not create accounts (signup does), does not
// send anything (Herald does, behind its own gate), and never stores a member's personal details —
// an account name and a class year is the whole record.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { invitesFor } from './invites.mjs';

const env = (k, d) => (process.env[k] == null || process.env[k] === '' ? d : process.env[k]);

export const DATA_FILE = () => env('SCHOOL_NETWORK_DATA', pathJoin(process.cwd(), 'data', 'school-networks.json'));

/** How many members before a network is worth showing to the next person. */
export const OPEN_THRESHOLD = Number(env('SCHOOL_NETWORK_THRESHOLD', '12')) || 12;

const str = (v) => String(v == null ? '' : v).trim();
const acct = (v) => str(v).toLowerCase();
const slug = (v) => acct(v).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function ctx(opts = {}) {
  return { fs: opts.fs || { readFileSync, writeFileSync, mkdirSync }, file: opts.file || DATA_FILE() };
}
function load(fs, file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && j.networks ? j : { networks: {} }; }
  catch { return { networks: {} }; }
}
function save(fs, file, store) {
  try { fs.mkdirSync(dirname(file), { recursive: true }); } catch {}
  try { fs.writeFileSync(file, JSON.stringify(store, null, 1)); return true; } catch { return false; }
}
const now = (opts) => (typeof opts.now === 'number' ? opts.now : Date.now());

// ── networks ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Define a school network. `years` bounds who belongs: a class year outside it is refused at join,
 * which is what keeps "your class is on here" true instead of aspirational.
 */
export function defineNetwork({ id, school, city = '', state = '', years = [] } = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const nid = slug(id || school);
  if (!nid) return { ok: false, reason: 'network needs an id or a school name' };
  if (!str(school)) return { ok: false, reason: 'network needs a school name' };
  const ys = [...new Set(years.map(Number).filter((y) => y > 1900 && y < 2200))].sort();
  if (!ys.length) return { ok: false, reason: 'a school network needs at least one class year — the year is the boundary' };

  const store = load(fs, file);
  const existing = store.networks[nid];
  store.networks[nid] = {
    id: nid, school: str(school), city: str(city), state: str(state),
    years: ys,
    members: (existing && existing.members) || {},   // account -> { year, joined }
    waitlist: (existing && existing.waitlist) || {}, // account -> { year, added }
    opened: (existing && existing.opened) || null,
    created: (existing && existing.created) || now(opts),
  };
  save(fs, file, store);
  return { ok: true, network: summarize(store.networks[nid]) };
}

function summarize(n) {
  const members = Object.entries(n.members || {});
  const byYear = {};
  for (const [, m] of members) byYear[m.year] = (byYear[m.year] || 0) + 1;
  return {
    id: n.id, school: n.school, city: n.city, state: n.state, years: n.years,
    memberCount: members.length,
    waitlistCount: Object.keys(n.waitlist || {}).length,
    byYear,
    open: Boolean(n.opened),
    opened: n.opened,
  };
}

export function getNetwork(id, opts = {}) {
  const { fs, file } = ctx(opts);
  const n = load(fs, file).networks[slug(id)];
  return n ? summarize(n) : null;
}

export function listNetworks(opts = {}) {
  const { fs, file } = ctx(opts);
  return Object.values(load(fs, file).networks).map(summarize);
}

// ── joining ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Join a network as `account`, class of `year`.
 *
 * While the network is BELOW threshold the person goes on the WAITLIST, not into an empty room. That
 * is the point of the whole module: the returned status says plainly which happened, so nothing can
 * report a waitlisted signup as a member.
 */
export function join(account, { network, year } = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = acct(account);
  if (!who) return { ok: false, reason: 'account required' };
  const store = load(fs, file);
  const n = store.networks[slug(network)];
  if (!n) return { ok: false, reason: 'no such school network' };
  const y = Number(year);
  if (!n.years.includes(y)) {
    return {
      ok: false, code: 'year-outside-network',
      reason: `class of ${year || '?'} is outside ${n.school} ${n.years[0]}-${n.years[n.years.length - 1]}. `
            + 'Widen the network deliberately rather than letting the boundary blur — the boundary is the product.',
    };
  }
  if (n.members[who]) return { ok: true, status: 'member', already: true, network: summarize(n) };

  const t = now(opts);
  // Until the network is OPENED, everyone waits — including the person whose signup crosses the
  // threshold. Letting that one person in alone would hand exactly one classmate the empty room the
  // threshold exists to prevent. Opening is a deliberate act, and it admits the whole list at once.
  if (!n.opened) {
    n.waitlist[who] = { year: y, added: t };
    save(fs, file, store);
    const have = Object.keys(n.members).length + Object.keys(n.waitlist).length;
    return {
      ok: true, status: 'waitlisted', account: who, network: summarize(n),
      need: Math.max(0, OPEN_THRESHOLD - have),
      why: have >= OPEN_THRESHOLD
        ? `${n.school} has ${have} signed up and is ready to open — everyone on the list goes in together.`
        : `${n.school} has ${have} of ${OPEN_THRESHOLD} signed up. Nobody is shown an empty room — `
          + 'when the class is there, everyone on the list gets let in at once.',
    };
  }

  n.members[who] = { year: y, joined: t };
  if (n.waitlist[who]) delete n.waitlist[who];
  save(fs, file, store);
  return { ok: true, status: 'member', account: who, network: summarize(n) };
}

/**
 * Is this network ready to open? Members + waitlist against the threshold.
 * Reports the honest blocker rather than a bare false.
 */
export function readyToOpen(network, opts = {}) {
  const { fs, file } = ctx(opts);
  const n = load(fs, file).networks[slug(network)];
  if (!n) return { ok: false, reason: 'no such school network' };
  if (n.opened) return { ok: true, already: true, opened: n.opened, ...summarize(n) };
  const have = Object.keys(n.members).length + Object.keys(n.waitlist).length;
  const threshold = Number(opts.threshold) || OPEN_THRESHOLD;
  if (have < threshold) {
    return {
      ok: false, code: 'below-threshold', have, threshold, need: threshold - have,
      reason: `${have} of ${threshold}. Opening now means the next classmate arrives to an empty room, `
            + 'and that impression does not come round again.',
    };
  }
  return { ok: true, have, threshold, ...summarize(n) };
}

/** Open the network: everyone waiting becomes a member at the same moment. */
export function open(network, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = load(fs, file);
  const n = store.networks[slug(network)];
  if (!n) return { ok: false, reason: 'no such school network' };
  const check = readyToOpen(network, { ...opts, fs, file });
  if (!check.ok && !opts.force) return check;

  const t = now(opts);
  const admitted = [];
  for (const [who, rec] of Object.entries(n.waitlist)) {
    n.members[who] = { year: rec.year, joined: t };
    admitted.push(who);
  }
  n.waitlist = {};
  n.opened = t;
  save(fs, file, store);
  return { ok: true, opened: t, admitted: admitted.length, network: summarize(n) };
}

// ── growth ────────────────────────────────────────────────────────────────────────────────────────

/**
 * How many people this member can still bring, read from the EXISTING invite tree — not a second,
 * parallel quota that would silently disagree with the first.
 */
export function inviteBudget(account, opts = {}) {
  const who = acct(account);
  const v = invitesFor(who, opts) || {};
  const remaining = v.unlimited ? Infinity : (Number(v.remaining) || 0);
  return {
    account: who,
    registered: Boolean(v.registered),
    remaining,
    brought: Array.isArray(v.redeemed) ? v.redeemed.length : 0,
    note: v.registered
      ? `can bring ${remaining === Infinity ? 'any number of' : remaining} more classmates`
      : 'not registered yet — they cannot invite anyone until they have joined themselves',
  };
}

/**
 * The state of the push: which networks are open, which are filling, and what is actually blocking.
 * Deliberately blunt — a network sitting at 3 of 12 should read as "not working yet", not as progress.
 */
export function status(opts = {}) {
  const nets = listNetworks(opts).map((n) => {
    const r = readyToOpen(n.id, opts);
    return {
      ...n,
      state: n.open ? 'open' : (r.ok ? 'ready to open' : 'filling'),
      blocker: n.open ? null : (r.ok ? null : r.reason),
    };
  });
  const open2 = nets.filter((n) => n.open);
  return {
    ok: true,
    networks: nets,
    openCount: open2.length,
    totalMembers: nets.reduce((s, n) => s + n.memberCount, 0),
    totalWaiting: nets.reduce((s, n) => s + n.waitlistCount, 0),
    honest: open2.length
      ? null
      : 'No network is open yet. Everyone signed up so far is on a waitlist — that is a list, not a network.',
  };
}

export function handler(req, res) {
  const s = status();
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    service: 'school-network',
    threshold: OPEN_THRESHOLD,
    policy: 'A school network opens only when enough of the class is signed up. Below that, signups '
          + 'wait together and are let in at once — nobody is ever shown an empty room.',
    ...s,
  }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('school-network.mjs')) {
  console.log(JSON.stringify(status(), null, 1));
}

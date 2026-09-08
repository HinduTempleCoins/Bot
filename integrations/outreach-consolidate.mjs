// outreach-consolidate — one row per person, every route they actually published, and the reason
// each one is believed.
//
// WHY THIS EXISTS. The campaign's contacts arrived from three separate runs that never met:
//
//   the holder CSV          17,784 rows, 325 with an email, graded once by auditList()
//   the profile harvest      4,205 accounts with handles they typed into their own Graphene profile
//   the hub crawl              111 hub pages read, emails and handles pulled off each
//
// Only the first was ever graded. The other two sat in files, and any send list built by opening
// those files would have taken every value in them at face value — which is precisely how a crawl of
// 178 hub pages reported 111 email addresses that were 23, and how 52 of 283 Facebook "handles"
// turned out to be the string `profile.php`.
//
// So the rule here is: NOTHING becomes a route by being in a file. Every address goes through
// attribution(), every value goes through the cross-page boilerplate check, and anything reachable by
// more than one person belongs to none of them. A route that survives all three carries the verdict
// and the page it came from, so a human can check any single row without rerunning the crawl.
//
// Nothing here sends. It produces the list; sending stays behind the Herald gate
// (pentecaust/herald/entitlements.mjs).

import {
  attribution, crossPageBoilerplate, isUsableHandle, siteHost, confersNothing,
} from './holder-contact-harvest.mjs';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Networks we can carry, and whether a value is a place to write to or a place to read.
 *
 * The distinction matters for the campaign: a `contactable` person has at least one route that
 * accepts an inbound message. A YouTube channel id does not — it is corroboration that the account is
 * a real person, which is worth having and is not a route.
 */
export const NETWORKS = Object.freeze({
  email: { addressable: true, url: (v) => `mailto:${v}` },
  telegram: { addressable: true, url: (v) => `https://t.me/${v}` },
  discord: { addressable: true, url: (v) => `https://discord.gg/${v}` },
  instagram: { addressable: true, url: (v) => `https://instagram.com/${v}` },
  x: { addressable: true, url: (v) => `https://x.com/${v}` },
  tiktok: { addressable: true, url: (v) => `https://tiktok.com/@${v}` },
  facebook: { addressable: true, url: (v) => `https://facebook.com/${v}` },
  mastodon: { addressable: true, url: (v) => `https://${v}` },
  youtube: { addressable: false, url: (v) => `https://youtube.com/${v.startsWith('UC') ? 'channel/' : '@'}${v}` },
  linktree: { addressable: false, url: (v) => `https://linktr.ee/${v}` },
  website: { addressable: false, url: (v) => (/^https?:/i.test(v) ? v : `https://${v}`) },
});

export const isAddressable = (net) => !!(NETWORKS[net] && NETWORKS[net].addressable);
export const routeUrl = (net, v) => (NETWORKS[net] ? NETWORKS[net].url(str(v)) : '');

/**
 * A handle we should not treat as this person's, on top of the per-value checks.
 *
 * `isUsableHandle()` answers "is this a handle at all". This answers "is it HIS" — and the only
 * general answer available offline is that a handle claimed by several unrelated accounts is claimed
 * by none of them. Same rule as the shared-mailbox rule, same reason.
 */
export function sharedValues(rows = [], { key = 'value', owner = 'account' } = {}) {
  const owners = new Map();
  for (const r of rows) {
    const k = low(r[key]);
    if (!k) continue;
    if (!owners.has(k)) owners.set(k, new Set());
    owners.get(k).add(str(r[owner]));
  }
  const out = new Map();
  for (const [k, os] of owners) if (os.size > 1) out.set(k, os.size);
  return out;
}

// ── the three sources, each normalised to candidate routes ────────────────────────────────────────

/**
 * Is this "handle" just the account's own name with the punctuation taken out?
 *
 * THE FOURTH COUNTING BUG, and the largest of the four. Three columns of the holder CSV look
 * completely filled — x_handle 10,737 rows, youtube 8,338, telegram 485 — and every value in them was
 * MANUFACTURED from the Hive account name. `nathalie-s` -> `youtube.com/@nathalies`,
 * `alive.chat` -> `youtube.com/@alivechat`. All 8,338 of the YouTube values are that transform and
 * nothing else; not one of those channels was ever checked to exist.
 *
 * The X column was at least graded, and its own grade says so: `x_verdict` reads **collision** on
 * 10,158 of 10,737, **possible** on 228, and **confirmed** on 351. The label was right and sitting in
 * the file; the first consolidation run ignored it and produced 11,110 "X routes" — the same shape as
 * "111 emails that were 21", one order of magnitude larger.
 */
export function looksNameDerived(account, value) {
  const norm = (v) => low(v).replace(/^@/, '').replace(/^https?:\/\/[^/]*\//, '').replace(/^@/, '')
    .replace(/[^a-z0-9]/g, '');
  const a = norm(account); const v = norm(value);
  return !!a && !!v && a === v;
}

/** Columns of the holder CSV that hold a social value, and the column that grades it, if any. */
export const CSV_SOCIAL_COLUMNS = Object.freeze([
  { net: 'x', field: 'x_handle', verdictField: 'x_verdict' },
  { net: 'telegram', field: 'telegram', verdictField: '' },
  { net: 'youtube', field: 'youtube', verdictField: '' },
]);

/**
 * The holder CSV: an email with a site and a page it was found on, plus three social columns whose
 * provenance has to be respected — see looksNameDerived().
 *
 * A guess is not deleted, it is DEMOTED. `unverified` routes are carried, because "there may be a
 * YouTube at this name, go look" is worth something to a human working the list; they are never
 * addressable, so nothing can send to one.
 */
export function fromHolderRows(rows = []) {
  const out = [];
  for (const r of rows) {
    const account = str(r.hive_account || r.account);
    if (!account) continue;
    for (const field of ['email', 'email_2']) {
      const e = low(r[field]);
      if (!e.includes('@')) continue;
      out.push({
        account, net: 'email', value: e, source: 'holder-csv',
        page: str(r.email_found_on) || str(r.website),
        ctx: { site: str(r.website), foundOn: str(r.email_found_on) },
      });
    }
    const w = str(r.website);
    if (w && !confersNothing(w)) out.push({ account, net: 'website', value: w, source: 'holder-csv', page: w, ctx: {} });
    for (const { net, field, verdictField } of CSV_SOCIAL_COLUMNS) {
      const raw = str(r[field]);
      const v = raw.replace(/^https?:\/\/[^/]+\//, '').replace(/^@/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
      if (!isUsableHandle(v)) continue;
      const grade = low(r[verdictField]);
      if (grade === 'collision') {
        out.push({ account, net, value: v, source: 'holder-csv', page: `csv:${field}`, ctx: {}, refuse: `${verdictField} says collision — the name is taken by somebody else` });
        continue;
      }
      if (grade === 'confirmed') { out.push({ account, net, value: v, source: 'holder-csv', page: `csv:${field}`, ctx: {} }); continue; }
      // No grade, or "possible". If the value is the account name with the punctuation removed, it is
      // a construction, not a finding.
      const derived = looksNameDerived(account, v);
      out.push({
        account, net, value: v, source: 'holder-csv', page: `csv:${field}`, ctx: {},
        unverified: derived || grade === 'possible',
        why: derived
          ? `built from the account name — nobody has checked that this ${net} exists`
          : (grade === 'possible' ? `${verdictField} says possible, not confirmed` : ''),
      });
    }
  }
  return out;
}

/** The profile harvest: what an account typed about itself in its own Graphene metadata. */
export function fromProfileSocials(holders = []) {
  const out = [];
  for (const h of holders) {
    const account = str(h.account);
    if (!account) continue;
    for (const [net, vals] of Object.entries(h.socials || {})) {
      for (const v0 of vals || []) {
        const v = str(v0).replace(/^@/, '');
        if (net === 'website') {
          if (v && !confersNothing(v)) out.push({ account, net, value: v, source: 'profile-metadata', page: `profile:${account}`, ctx: {} });
          continue;
        }
        if (!isUsableHandle(v)) continue;
        out.push({ account, net, value: v, source: 'profile-metadata', page: `profile:${account}`, ctx: {} });
      }
    }
  }
  return out;
}

/**
 * The hub crawl. Every value carries the PAGE it was read from, because that is what makes the
 * boilerplate check possible — and the boilerplate check is the only thing standing between this
 * source and the 111-that-were-23 number.
 *
 * `hubOwnedBy` is the handle in the hub URL, which came from the account's own profile metadata. That
 * is what lets a hub page vouch at all; see attribution()'s hub-published verdict.
 */
export function fromHubPages(pages = []) {
  const out = [];
  for (const p of pages) {
    const account = str(p.account);
    const hub = str(p.hub);
    if (!account || !hub) continue;
    const handle = low(hub).replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
    for (const e of p.emails || []) {
      const v = low(e.email || e);
      if (!v.includes('@')) continue;
      out.push({ account, net: 'email', value: v, source: 'hub-page', page: hub, ctx: { foundOn: hub, hubOwnedBy: handle } });
    }
    for (const [net, vals] of Object.entries(p.socials || {})) {
      if (net === 'linktree') continue;         // the hub linking to itself is not a new route
      for (const v0 of vals || []) {
        const v = str(v0).replace(/^@/, '');
        if (!isUsableHandle(v)) continue;
        out.push({ account, net, value: v, source: 'hub-page', page: hub, ctx: {} });
      }
    }
  }
  return out;
}

// ── the gate ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Grade every candidate route and fold them into one row per account.
 *
 * Four things can disqualify a route, and each one is recorded rather than silently dropped, because
 * the count of what was refused is the only evidence that the gate ran at all:
 *
 *   boilerplate   the value appears on more than `maxPages` distinct source pages. This is the shape
 *                 of both counting bugs found by hand; here it runs across ALL sources at once.
 *   attribution   an email that is not demonstrably his (holder-contact-harvest.mjs).
 *   shared        the same value claimed by more than one account. One inbox, many pitches.
 *   unusable      not a handle, or a network we do not carry.
 */
export function consolidate({
  holderRows = [], profileHolders = [], hubPages = [], meta = {}, maxPages = 2,
} = {}) {
  const cands = [
    ...fromHolderRows(holderRows),
    ...fromProfileSocials(profileHolders),
    ...fromHubPages(hubPages),
  ];

  // 1. boilerplate, across every source at once and per network, so a handle repeating on many pages
  //    is caught the same way an address is.
  const byNet = new Map();
  for (const c of cands) {
    if (!byNet.has(c.net)) byNet.set(c.net, []);
    byNet.get(c.net).push(c);
  }
  const boilerplate = new Map();
  for (const [net, rows] of byNet) {
    const pages = new Map();
    for (const r of rows) {
      const p = str(r.page);
      if (!pages.has(p)) pages.set(p, []);
      pages.get(p).push(r.value);
    }
    const b = crossPageBoilerplate([...pages.entries()].map(([page, values]) => ({ page, values })), { maxPages });
    for (const [v, n] of b) boilerplate.set(`${net}|${v}`, n);
  }

  // 2. shared values, per network.
  const shared = new Map();
  for (const [net, rows] of byNet) {
    for (const [v, n] of sharedValues(rows)) shared.set(`${net}|${v}`, n);
  }

  const refused = { boilerplate: 0, attribution: 0, shared: 0, unusable: 0, unverified: 0 };
  const reasons = [];
  const people = new Map();
  const info = new Map(Object.entries(meta || {}));

  for (const c of cands) {
    const k = `${c.net}|${low(c.value)}`;
    const note = (why, bucket) => { refused[bucket] += 1; reasons.push({ ...c, why }); };
    if (!NETWORKS[c.net]) { note('network not carried', 'unusable'); continue; }
    if (boilerplate.has(k)) {
      note(`appears on ${boilerplate.get(k)} different pages — that is the crawl's furniture, not his`, 'boilerplate');
      continue;
    }
    if (shared.has(k)) {
      note(`claimed by ${shared.get(k)} different accounts — it belongs to none of them`, 'shared');
      continue;
    }
    if (c.refuse) { note(c.refuse, 'unverified'); continue; }
    let verdict = 'self-declared';
    let why = 'the account published this handle in its own profile or on its own page';
    if (c.unverified) {
      verdict = 'unverified';
      why = c.why || 'not checked against the platform — a lead to confirm, not a route to use';
    }
    if (c.net === 'email') {
      const a = attribution(c.value, c.ctx || {});
      if (!a.ok) { note(a.why, 'attribution'); continue; }
      verdict = a.verdict; why = a.why;
    }
    if (!people.has(c.account)) {
      const m = info.get(c.account) || {};
      people.set(c.account, {
        account: c.account,
        name: str(m.display_name || m.name),
        location: str(m.location),
        reach: num(m.reach_score || m.reach),
        holds: str(m.holds),
        routes: [],
      });
    }
    const p = people.get(c.account);
    const dup = p.routes.find((r) => r.net === c.net && low(r.value) === low(c.value));
    if (dup) {
      // The same value can arrive from a guess and from a self-declaration. Keep the better claim,
      // whichever order they came in — the CSV is read first, and its guesses must not shadow the
      // profile's own word.
      if (dup.verdict === 'unverified' && verdict !== 'unverified') {
        dup.verdict = verdict; dup.why = why; dup.source = c.source; dup.page = c.page;
        dup.addressable = isAddressable(c.net);
      }
      continue;
    }
    p.routes.push({
      net: c.net, value: c.value, url: routeUrl(c.net, c.value),
      // A guess is never a place to send. It is a place to look.
      addressable: isAddressable(c.net) && verdict !== 'unverified',
      verdict, why, source: c.source, page: c.page,
    });
  }

  const list = [...people.values()];
  for (const p of list) {
    p.routes.sort((a, b) => (Number(b.addressable) - Number(a.addressable))
      || (a.net === 'email' ? -1 : b.net === 'email' ? 1 : 0));
    p.addressable = p.routes.some((r) => r.addressable);
    p.bestRoute = p.routes.find((r) => r.addressable) || p.routes[0] || null;
  }
  list.sort((a, b) => (b.reach - a.reach) || (b.routes.length - a.routes.length)
    || a.account.localeCompare(b.account));

  return {
    people: list,
    stats: {
      candidates: cands.length,
      peopleWithAnyRoute: list.length,
      addressable: list.filter((p) => p.addressable).length,
      withEmail: list.filter((p) => p.routes.some((r) => r.net === 'email')).length,
      routes: list.reduce((n, p) => n + p.routes.length, 0),
      verifiedRoutes: list.reduce((n, p) => n + p.routes.filter((r) => r.verdict !== 'unverified').length, 0),
      unverifiedRoutes: list.reduce((n, p) => n + p.routes.filter((r) => r.verdict === 'unverified').length, 0),
      refused,
    },
    boilerplate: [...boilerplate.entries()].map(([k, n]) => ({ key: k, pages: n })).sort((a, b) => b.pages - a.pages),
    shared: [...shared.entries()].map(([k, n]) => ({ key: k, accounts: n })).sort((a, b) => b.accounts - a.accounts),
    reasons,
  };
}

/** Flat rows for a spreadsheet: one line per ROUTE, so nothing is hidden inside a nested field. */
/**
 * Who is worth searching for by hand, and why.
 *
 * Operator, 2026-09-08: "see if You can Google the Usernames and find anything, the ones that already
 * have Multiple known accounts with those Names might for sure have something."
 *
 * That is the right signal and it is one this module can already compute. A handle is worth searching
 * in proportion to how much evidence there is that it is a HANDLE rather than a guess:
 *
 *   CORROBORATED   the same string is this person's handle on two or more networks. Somebody who is
 *                  `@kateskarma` on Instagram and `@kateskarma` on X chose that name and reuses it,
 *                  which is exactly what makes it findable — and it cannot be an artefact of a
 *                  manufactured column, because no two of those columns were built the same way.
 *   DISTINCTIVE    one network, but the handle is NOT the account name. Nobody derived it; it was read
 *                  off a page or declared in a profile. A name that is not the obvious one is a name
 *                  a search engine can separate from everybody else's.
 *   NAME-ECHO      one network, handle equals the account name. This is the shape of the three
 *                  manufactured columns (10,737 X, 8,338 YouTube, 485 Telegram), so it ranks last —
 *                  but it is not zero, because plenty of real people do use their own name.
 *
 * The score is evidence of findability, NOT of importance. It says where a search is likely to return
 * something, not who matters — the operator decides that, and reach is carried alongside so he can.
 */
export const SEARCH_TIERS = Object.freeze({
  corroborated: { weight: 50, why: 'the same handle on two or more networks — a name this person chose and reuses' },
  distinctive: { weight: 25, why: 'a handle that is not their account name, so it was read or declared, not derived' },
  'name-echo': { weight: 8, why: 'handle equals the account name — real for some people, manufactured for many' },
});

/**
 * Networks worth searching FIRST, and why this is not a generic weighting.
 *
 * Operator, 2026-09-08: "People Follow me and Kate's Lead, so it is likely there is a lot going on on
 * Instagram if She is there."
 *
 * That is a testable claim about a specific cohort rather than a preference: one person's presence on
 * a network predicts the rest of the group's, because the group follows her. Kate Siamro is on
 * Instagram — `@kateskarma`, verified against the handle in the operator's own notes, plus
 * `@ladylovedallas` for her venue. So Instagram outranks the rest for the hometown cohort, and a
 * found Instagram is worth more than a found anything-else because it is where the group already is.
 */
export const NETWORK_SEARCH_PRIORITY = Object.freeze({
  instagram: 20, tiktok: 12, x: 8, facebook: 8, youtube: 6, discord: 4, telegram: 4, linktree: 10,
});

/** Normalised handle string — the same normalisation looksNameDerived() uses, exported for reuse. */
export const normHandle = (v) => low(v).replace(/^https?:\/\/[^/]*\//, '').replace(/^@/, '')
  .replace(/[^a-z0-9]/g, '');

export function searchTargets(result = {}, { limit = 0 } = {}) {
  const out = [];
  for (const p of result.people || []) {
    // Group this person's routes by the normalised handle, so `@kate` on two networks is one string
    // seen twice rather than two unrelated rows.
    const byHandle = new Map();
    for (const r of p.routes) {
      if (r.net === 'email' || r.net === 'website') continue;   // an address is not a handle to search
      const h = normHandle(r.value);
      if (!h) continue;
      if (!byHandle.has(h)) byHandle.set(h, { handle: h, nets: new Map() });
      byHandle.get(h).nets.set(r.net, { value: r.value, url: r.url, verdict: r.verdict, source: r.source });
    }
    for (const { handle, nets } of byHandle.values()) {
      const netNames = [...nets.keys()];
      const echo = looksNameDerived(p.account, handle);
      const tier = netNames.length > 1 ? 'corroborated' : (echo ? 'name-echo' : 'distinctive');
      const netScore = Math.max(0, ...netNames.map((n) => NETWORK_SEARCH_PRIORITY[n] || 0));
      out.push({
        account: p.account,
        name: p.name || '',
        handle,
        networks: netNames,
        tier,
        why: SEARCH_TIERS[tier].why,
        // Reach is carried, never scored. It says who matters; this list says who is findable.
        reach: p.reach || 0,
        onInstagram: netNames.includes('instagram'),
        score: SEARCH_TIERS[tier].weight + netScore + (netNames.length - 1) * 10,
        routes: Object.fromEntries([...nets.entries()].map(([n, v]) => [n, v.url || v.value])),
      });
    }
  }
  out.sort((a, b) => b.score - a.score || b.reach - a.reach);
  return limit > 0 ? out.slice(0, limit) : out;
}

export function toRows(result = {}) {
  const out = [];
  for (const p of result.people || []) {
    for (const r of p.routes) {
      out.push({
        account: p.account, name: p.name, location: p.location, reach: p.reach, holds: p.holds,
        net: r.net, value: r.value, url: r.url, addressable: r.addressable ? 'yes' : 'no',
        verdict: r.verdict, source: r.source, page: r.page, why: r.why,
      });
    }
  }
  return out;
}

const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
export function toCsv(result = {}) {
  const rows = toRows(result);
  const cols = ['account', 'name', 'location', 'reach', 'holds', 'net', 'value', 'url', 'addressable',
    'verdict', 'source', 'page', 'why'];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'outreach-consolidate',
    networks: Object.keys(NETWORKS),
    addressable: Object.keys(NETWORKS).filter(isAddressable),
    gate: ['boilerplate', 'attribution', 'shared', 'unverified', 'unusable'],
    note: 'merges the holder CSV, the profile harvest and the hub crawl into one graded list. '
        + 'Nothing becomes a route by being in a file. Sending stays behind the Herald gate.',
  }, null, 2));
}

export default {
  consolidate, fromHolderRows, fromProfileSocials, fromHubPages, sharedValues, toRows, toCsv,
  looksNameDerived, CSV_SOCIAL_COLUMNS,
  NETWORKS, isAddressable, routeUrl, handler,
  searchTargets, SEARCH_TIERS, NETWORK_SEARCH_PRIORITY, normHandle,
};

if (process.argv[1] && process.argv[1].endsWith('outreach-consolidate.mjs')) {
  console.log(JSON.stringify({
    networks: Object.keys(NETWORKS),
    note: 'this module grades data it is GIVEN. The private runner that feeds it the .local files is '
        + '.local/build-consolidated.mjs — the data never enters this repo.',
  }, null, 2));
}

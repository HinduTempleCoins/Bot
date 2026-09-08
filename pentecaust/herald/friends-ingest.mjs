// friends-ingest — the local list, into the CRM, with its own rules intact.
//
// `integrations/local-outreach.mjs` ranks ~123 people the operator personally knows and removes four
// kinds of row from that ranking outright:
//
//   family              his mother and his sister sat in the ranking for hours. His mother's profile
//                       lists her as a "Crypto Investor/Advisor", which read as the strongest topical
//                       match in the file right up until it read as a mother following her son's work.
//   personal history    people he dated. A drafted, sequenced, scored message reads completely
//                       differently from someone you dated than from a classmate, and a pipeline
//                       cannot hear that difference.
//   justice-involved    a man rebuilding after a sentence is the last person who should receive a
//                       message a pipeline decided to send. He is written to by hand or not at all.
//   identity-disputed   an account we cannot vouch for does not score and does not get written to.
//
// Those are REMOVALS, not score adjustments, and this module carries them across the boundary. A
// removed row never becomes a lead — not in the outreach segment, not in the business segment, not
// as a no-email row with a route on it. `removed` comes back with reasons so the refusal is legible,
// which is the same discipline holder-ingest.mjs uses.
//
// WHAT IS DIFFERENT FROM THE HOLDER LIST. `attribution()`'s own-domain test asks whether an address
// belongs to the person whose row it is — the right question for 17,784 strangers scraped off their
// own websites. It is the wrong question here: these are people the operator knows, and the routes
// were recorded by him in a research pass, not harvested. So what carries over is the part that is
// about the ADDRESS rather than about the provenance: a role mailbox is still never a person, a
// platform's own address is still not anybody's, and one address listed for two different people is
// still a service. The own-domain test does not apply and pretending otherwise would drop
// `kwhitney@communityimpact.com` — a real business address at a real employer, on a row with no
// personal website.
//
// THREE SEGMENTS, NOT ONE LIST.
//   outreach    ranked people with a route
//   businesses  people whose work already buys what SoapBox sells. Different conversation; burying
//               it in one ranked list with the chain is how it gets sent the wrong message.
//   owed        people he owes a reply. An unanswered message is a debt, not a lead — answer it
//               before pitching anything. These are never auto-drafted.
//
// Nothing here sends, fetches, or reads a seed file of its own: seeds are passed in, and the people
// themselves live outside this public repo in `.local/LOCAL_SEEDS.json`.
//
//   import { friendLeads, ingestFriends, bestRoute } from './friends-ingest.mjs'

import {
  rank, assertPublicOnly, isFamily, isPersonal, isDisputed, personalReason, buyerFit,
} from '../../integrations/local-outreach.mjs';
import { ROLE_NEVER, platformEmailDomain, emailUser, emailDomain, siteHost } from '../../integrations/holder-contact-harvest.mjs';
import { isValidEmail } from '../../integrations/email-verify.mjs';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();

// Bounded, for the same reason holder-contact-harvest.mjs bounds its own: an unbounded local-part
// quantifier is quadratic on any long run that never reaches an `@`.
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}/;

/**
 * The first usable address in a field that may be free text.
 *
 * One row in the real file reads `rachel@tonyfaypr.com (published on the agency's own team page);
 * agency general: info@TonyFayPR.com` — a note, not an address. Taking the field whole gives a
 * guaranteed bounce; taking the first match gives the personal address ahead of the general one,
 * which is also the right order.
 */
export function firstEmail(text = '') {
  const m = String(text || '').match(EMAIL_RE);
  return m ? low(m[0]) : '';
}

/**
 * Is this address one we would write to at all?
 *
 * Not "is it his" — see the header. Role mailboxes and platform-owned domains, only.
 */
export function addressUsable(email) {
  const e = low(email);
  if (!e) return { ok: false, why: 'no address' };
  if (!isValidEmail(e)) return { ok: false, why: 'not a valid address' };
  if (ROLE_NEVER.has(emailUser(e))) return { ok: false, why: `${emailUser(e)}@ is a role mailbox, not a person` };
  const plat = platformEmailDomain(emailDomain(e));
  if (plat) return { ok: false, why: `${plat} is a platform's own address, not this person's` };
  return { ok: true, why: '' };
}

/**
 * The routes a seed published about itself, best first.
 *
 * Email first because it is the only one this CRM can actually send on. The rest are recorded so a
 * lead with no address is still a person with a way to reach them — which is the difference between
 * a row worth keeping and a row worth deleting.
 *
 * Facebook is deliberately last and never the "best" route: the whole point of the research pass was
 * to find a route OFF Facebook, and a lead whose only route is a Facebook name has not been reached.
 */
export const ROUTE_ORDER = Object.freeze(['email', 'website', 'linkedin', 'instagram', 'linktree', 'facebook']);

export function routesFor(seed = {}) {
  const p = (seed && seed.public) || {};
  const out = [];
  const email = firstEmail(p.businessEmail || p.email || '');
  if (email) {
    const u = addressUsable(email);
    if (u.ok) out.push({ net: 'email', value: email, url: `mailto:${email}` });
  }
  const site = str(p.website);
  if (site) out.push({ net: 'website', value: siteHost(site) || site, url: /^https?:/i.test(site) ? site : `https://${site}` });
  const li = str(p.linkedin);
  if (li) out.push({ net: 'linkedin', value: li, url: /^https?:/i.test(li) ? li : `https://www.linkedin.com/in/${li}` });
  for (const h of [].concat(p.instagram || [])) {
    const v = str(h); if (v) out.push({ net: 'instagram', value: v, url: `https://instagram.com/${v}` });
  }
  for (const h of [].concat(p.linktree || [])) {
    const v = str(h); if (v) out.push({ net: 'linktree', value: v, url: `https://linktr.ee/${v}` });
  }
  const fb = str(p.facebook);
  if (fb) out.push({ net: 'facebook', value: fb, url: '' });
  return out.sort((a, b) => ROUTE_ORDER.indexOf(a.net) - ROUTE_ORDER.indexOf(b.net));
}

/** The route to actually use. Null when the only thing we have is a Facebook name. */
export function bestRoute(seed = {}) {
  const rs = routesFor(seed).filter((r) => r.net !== 'facebook');
  return rs[0] || null;
}

const seedIndex = (seeds) => new Map((Array.isArray(seeds) ? seeds : []).map((s) => [str(s && s.id) || low(s && s.name), s]));
const findSeed = (idx, row) => idx.get(str(row && row.id)) || idx.get(low(row && row.name)) || null;

function toLead(seed, row, { source, segment }) {
  const route = bestRoute(seed);
  const email = route && route.net === 'email' ? route.value : '';
  const b = buyerFit(seed);
  return {
    email,
    name: str(seed.name || row.name),
    company: str((seed.business && seed.business.name) || seed.employer || seed.work),
    title: str(seed.title),
    source,
    route: route ? `${route.net}:${route.value}` : '',
    signal: str(row.why || seed.why || b.why).slice(0, 300),
    notes: [
      segment,
      seed.metro || seed.city ? `${str(seed.city)}${seed.state ? `, ${str(seed.state)}` : ''}`.replace(/^, /, '') : '',
      row.score != null ? `score ${row.score}` : '',
      route ? `route ${route.net}` : 'no route off Facebook yet',
    ].filter(Boolean).join(' · ').slice(0, 500),
    reach: Number(row.score || 0),
    segment,
    routes: routesFor(seed),
  };
}

/**
 * Turn the local seed list into CRM-shaped leads, in three segments, with the removals honoured.
 *
 * `seeds` is passed in. This module never reads `.local/`.
 */
export function friendLeads(seeds = []) {
  const all = (Array.isArray(seeds) ? seeds : []).filter((s) => s && str(s.name));
  const idx = seedIndex(all);

  // Rows carrying private data leave before anything else looks at them — the same line
  // assertPublicOnly() draws, applied at the boundary rather than only inside the ranker.
  const removed = [];
  const publicOnly = [];
  for (const s of all) {
    const pub = assertPublicOnly(s);
    if (!pub.ok) { removed.push({ id: str(s.id), name: str(s.name), rule: 'private-data', why: pub.reason }); continue; }
    publicOnly.push(s);
  }

  const r = rank(publicOnly);

  // The four removals, recorded so it is visible that they were removed rather than merely absent.
  for (const f of (r.excludedAsFamily || [])) {
    removed.push({ id: str(f.id), name: str(f.name), rule: 'family', why: 'family are not outreach — this is a removal, not a low score' });
  }
  for (const p of (r.writeTheseYourself || [])) {
    removed.push({ id: str(p.id), name: str(p.name), rule: 'personal', why: str(p.why) });
  }
  for (const d of (r.excludedAsDisputed || [])) {
    removed.push({ id: str(d.id), name: str(d.name), rule: 'identity-disputed', why: str(d.reason) || 'identity in question until the operator resolves it' });
  }

  const businessIds = new Set((r.businessesWeKnow || []).map((b) => str(b.id)));

  const owed = (r.firstDoThis || []).map((row) => {
    const s = findSeed(idx, row); if (!s) return null;
    return { ...toLead(s, row, { source: 'local-seeds', segment: 'owed-a-reply' }), owed: str(row.owed) };
  }).filter(Boolean);

  const businesses = (r.businessesWeKnow || []).map((row) => {
    const s = findSeed(idx, row); if (!s) return null;
    const lead = toLead(s, { ...row, score: 0, why: row.why }, { source: 'local-seeds', segment: 'businesses-we-know' });
    return { ...lead, fit: str(row.fit), pitch: str(row.pitch), company: str(row.business) || lead.company };
  }).filter(Boolean);

  // The ranked outreach segment: everything that survived, minus the ones already placed elsewhere.
  const owedIds = new Set(owed.map((l) => str(l.name)));
  const leads = (r.then || []).map((row) => {
    const s = findSeed(idx, row); if (!s) return null;
    if (businessIds.has(str(row.id))) return null;      // a business row is a different conversation
    if (owedIds.has(str(row.name))) return null;
    return toLead(s, row, { source: 'local-seeds', segment: 'outreach' });
  }).filter(Boolean);

  const withEmail = (xs) => xs.filter((l) => l.email).length;
  const withRoute = (xs) => xs.filter((l) => l.route).length;
  return {
    leads, businesses, owed, removed,
    counts: {
      offered: all.length,
      outreach: leads.length, businesses: businesses.length, owed: owed.length, removed: removed.length,
      mailable: withEmail(leads) + withEmail(businesses),
      withARouteOffFacebook: withRoute(leads) + withRoute(businesses) + withRoute(owed),
    },
    note: `${leads.length} outreach, ${businesses.length} businesses we know, ${owed.length} owed a reply, `
        + `${removed.length} removed by rule (family, personal history, justice-involved, identity-disputed). `
        + `${withEmail(leads) + withEmail(businesses)} have an address this CRM could send to.`,
  };
}

/**
 * Load one segment into a campaign. `addLead(campaignId, lead)` is injected; with none passed nothing
 * is written and the return says so.
 *
 * `owed` is NOT ingested by default. A person he owes a reply to should not appear in a send queue at
 * all — pass `segment: 'owed'` deliberately if you want them somewhere he can see them, and know that
 * a campaign row for them is a reminder, not a lead.
 */
export function ingestFriends(campaignId, seeds = [], { addLead = null, segment = 'outreach' } = {}) {
  const built = friendLeads(seeds);
  const pick = { outreach: built.leads, businesses: built.businesses, owed: built.owed }[segment] || [];
  if (typeof addLead !== 'function') {
    return { ok: true, dryRun: true, segment, added: 0, offered: pick.length, ...built, reason: 'dry run — pass { addLead } to write leads' };
  }
  let added = 0; const rejected = [];
  for (const lead of pick) {
    let res;
    try { res = addLead(campaignId, lead); } catch (e) { res = { ok: false, reason: str(e && e.message) || 'addLead threw' }; }
    if (res && res.ok) added += 1;
    else rejected.push({ name: lead.name, reason: str(res && res.reason) || 'unknown' });
  }
  return { ok: true, dryRun: false, segment, added, offered: pick.length, rejected, ...built };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'herald-friends-ingest',
    segments: ['outreach', 'businesses', 'owed'],
    removedByRule: ['family', 'personal history (incl. justice-involved)', 'identity-disputed', 'private-data'],
    routeOrder: ROUTE_ORDER,
    note: 'the local-outreach removals cross into the CRM intact. A removed row never becomes a lead. '
        + 'Seeds are passed in; this module reads no file and sends nothing.',
  }, null, 2));
}

export default { friendLeads, ingestFriends, routesFor, bestRoute, firstEmail, addressUsable, ROUTE_ORDER, handler };

// holder-ingest — the attribution filter, placed between the holder file and the CRM.
//
// WHY THIS EXISTS, AND WHY IT IS THE HIGHEST-VALUE FIX IN THE CAMPAIGN.
//
// `integrations/holder-contact-harvest.mjs` was written to answer one question: is this address
// actually this holder's? It grades every row into `own-domain`, `published-on-site`,
// `hub-published`, `third-party` or `never`, and it explains each verdict. It has been tested since
// the day it was written.
//
// It was never on the path that builds the campaign. The loader read the holder file, took every row
// that had an `email` column, and handed it straight to `addLead()`. So the module that knows
// `contact@read.cash` is a support desk, and that one inbox listed for eleven different holders is a
// service rather than a person, was sitting next to a campaign that had loaded exactly those rows.
//
// The real numbers on the real file (325 rows carrying an address):
//
//     218  contactable      — 110 at the holder's own domain, 108 published on his own site
//      49  dropped          — 39 third-party, 10 role mailboxes and malformed addresses
//      58  shared           — one inbox listed for several different holders
//
// A campaign built without this filter mails those 58 the same pitch once per holder who linked to
// them. That is not outreach; that is the exact behaviour that put the operator's Hive accounts on
// Spaminator, and it is a thing you only get to do once per sending domain.
//
// WHAT THIS MODULE WILL NOT DO. It has no transport, no fetch, and no import of a mailbox. `addLead`
// is injected; called without one it grades and reports and writes nothing. The CLI prints COUNTS AND
// VERDICTS ONLY — never an address, never an account name — because contact data lives in `.local/`
// and this file is public.
//
//   import { gradeHolders, holderLeads, ingestHolders } from './holder-ingest.mjs'

import { auditList, siteHost } from '../../integrations/holder-contact-harvest.mjs';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();

/**
 * The column names the holder exports actually use, in one place.
 *
 * This mapping is load-bearing and it cost 107 contacts to learn. `HOLDERS_shortlist.json` has no
 * `email_found_on` column, and without it a freemail address printed on a man's own contact page
 * cannot be told from a freemail address that was merely nearby — so `attribution()` correctly refuses
 * it, and the shortlist grades 111 keep where the full `HOLDERS_CONTACTS.csv` grades 218. The
 * provenance column is not decoration. Ingest from the file that carries it.
 */
export function normalizeRow(input = {}) {
  const row = (input && typeof input === 'object') ? input : {};
  return {
    account: str(row.hive_account || row.account || row.hive || row.name),
    email: low(row.email || row.address),
    website: str(row.website || row.site),
    foundOn: str(row.email_found_on || row.foundOn || row.emailFoundOn),
    holds: str(row.holds || row.tokens),
    reach: Number(row.reach_score || row.reach || row.score) || 0,
  };
}

/**
 * Grade a holder list. A thin, named wrapper over `auditList()` so that every caller reaches the
 * filter by the same door and nobody can "just this once" build leads from the raw rows.
 */
export function gradeHolders(rows = []) {
  const norm = (Array.isArray(rows) ? rows : []).map(normalizeRow).filter((r) => r.email);
  const graded = auditList(norm.map((r) => ({
    hive_account: r.account, email: r.email, website: r.website, email_found_on: r.foundOn,
  })));
  const byAccount = new Map(norm.map((r) => [`${r.account}|${r.email}`, r]));
  const enrich = (g) => ({ ...g, row: byAccount.get(`${g.account}|${g.email}`) || null });
  return {
    offered: norm.length,
    keep: graded.keep.map(enrich),
    drop: graded.drop.map(enrich),
    shared: graded.shared.map(enrich),
    counts: { offered: norm.length, keep: graded.keep.length, drop: graded.drop.length, shared: graded.shared.length },
  };
}

/**
 * Turn a graded list into CRM leads.
 *
 * ONLY `keep` becomes a lead. `drop` and `shared` come back with their reasons attached so the refusal
 * is legible, and they are the point of the exercise — a filter whose rejections you cannot read is a
 * filter you will eventually be talked out of.
 */
export function holderLeads(rows = []) {
  const g = gradeHolders(rows);
  const leads = g.keep.map((k) => {
    const r = k.row || {};
    return {
      email: k.email,
      name: k.account,
      company: siteHost(r.website) || '',
      source: 'holders',
      route: 'email',
      // The reason to write, in the lead itself. `signal` is what grounds the opener, and "he printed
      // this address on his own site" is a better reason than anything a model could invent.
      signal: `${k.verdict} — ${k.why}`.slice(0, 300),
      notes: [r.holds, r.website ? `site ${siteHost(r.website)}` : ''].filter(Boolean).join(' · '),
      reach: r.reach || 0,
      verdict: k.verdict,
    };
  });
  const refused = [
    ...g.drop.map((d) => ({ account: d.account, verdict: d.verdict, why: d.why })),
    ...g.shared.map((s) => ({ account: s.account, verdict: 'shared', why: s.why })),
  ];
  return {
    leads, refused,
    counts: { ...g.counts, leads: leads.length, refused: refused.length },
    note: `${leads.length} of ${g.offered} holder addresses are this holder's own; `
        + `${g.counts.drop} are somebody else's and ${g.counts.shared} are one inbox listed for several holders`,
  };
}

/**
 * Load graded holders into a campaign.
 *
 * `addLead(campaignId, lead)` is INJECTED. With none passed nothing is written and the return says so
 * — a dry run is the default here for the same reason it is the default in batch-runner.mjs: the
 * ordinary way to call this should be the harmless way.
 */
export function ingestHolders(campaignId, rows = [], { addLead = null } = {}) {
  const built = holderLeads(rows);
  if (typeof addLead !== 'function') {
    return { ok: true, dryRun: true, added: 0, ...built, reason: 'dry run — pass { addLead } to write leads' };
  }
  let added = 0;
  const rejected = [];
  for (const lead of built.leads) {
    let r;
    try { r = addLead(campaignId, lead); } catch (e) { r = { ok: false, reason: str(e && e.message) || 'addLead threw' }; }
    if (r && r.ok) added += 1;
    else rejected.push({ email: lead.email, reason: str(r && r.reason) || 'unknown' });
  }
  return { ok: true, dryRun: false, added, rejected, ...built };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'herald-holder-ingest',
    contactable: ['own-domain', 'published-on-site', 'hub-published'],
    refused: ['third-party', 'never', 'shared'],
    note: 'every holder address passes integrations/holder-contact-harvest.attribution() before it can '
        + 'become a lead. Writing requires an injected addLead; the default is a graded dry run.',
  }, null, 2));
}

export default { normalizeRow, gradeHolders, holderLeads, ingestHolders, handler };

// CLI: grade a holder export and print COUNTS ONLY. No address, no account name — this file is public.
if (process.argv[1] && process.argv[1].endsWith('holder-ingest.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.log('usage: node pentecaust/herald/holder-ingest.mjs <holders.json>   (prints counts only)');
  } else {
    import('node:fs').then(({ readFileSync }) => {
      let rows = [];
      try { const j = JSON.parse(readFileSync(file, 'utf8')); rows = Array.isArray(j) ? j : (j.rows || j.holders || []); }
      catch (e) { console.log('could not read', file, '—', str(e && e.message)); return; }
      const r = holderLeads(rows);
      console.log(JSON.stringify({ counts: r.counts, note: r.note }, null, 1));
    });
  }
}

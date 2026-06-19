// accountability-apis.mjs — the catalog of Government + Media APIs built for watchdog work, plus
// thin, soft-failing readers for the best KEYLESS ones, shaped to feed accountability-graph /
// dossier.mjs directly (fromRecords()-shaped output).
//
// "Are there gov/media APIs meant for this?" — yes. This module is the source-of-truth registry
// (what exists, auth, license, which dossier dimension it serves) AND working readers for the
// no-key engines so we can confirm / disprove / expand a dossier and keep filing new pages.
//
// DISCIPLINE: every reader emits records carrying { source: { name, url }, asOf } so the graph's
// SOURCE-REQUIRED invariant holds. Network access is injectable (__setFetch) and every reader
// SOFT-FAILS to [] — never throws, never blocks a page.
//
//   import { API_REGISTRY, gdeltArticles, secEdgarFullText, congressTrades, discoverMedia } from './accountability-apis.mjs'

let _fetch = (...a) => fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const UA = process.env.ACCOUNTABILITY_UA || 'MELEK-Witness/1.0 (accountability; contact: hathor@melek.salon)';

// ── THE CATALOG ───────────────────────────────────────────────────────────────────────────────
// auth: 'none' (keyless) | 'key' (free registration) | 'scrape' (no clean API). serves: which
// dossier dimension(s) it feeds. This is the answer to "what APIs are meant for this stuff."
export const API_REGISTRY = Object.freeze([
  // ---- Government: money & elections ----
  { id: 'openfec', name: 'OpenFEC', gov: true, base: 'https://api.open.fec.gov/v1', auth: 'key', free: true, license: 'public-domain',
    serves: ['donations'], note: 'Federal campaign finance — receipts, disbursements, candidates, committees. DEMO_KEY works for light use.' },
  { id: 'congress', name: 'Congress.gov API', gov: true, base: 'https://api.congress.gov/v3', auth: 'key', free: true, license: 'public-domain',
    serves: ['member', 'votes', 'bills'], note: 'Official member/bill/vote/committee data (Library of Congress). Replaces the retired ProPublica Congress API.' },
  { id: 'senate-lda', name: 'Senate LDA (Lobbying)', gov: true, base: 'https://lda.senate.gov/api/v1', auth: 'key', free: true, license: 'public-domain',
    serves: ['lobbying'], note: 'Lobbying Disclosure Act filings — registrant, client, issues, $$.' },
  { id: 'followthemoney', name: 'FollowTheMoney (NIMP)', gov: false, base: 'https://www.followthemoney.org/api', auth: 'key', free: true, license: 'cc-attribution',
    serves: ['donations'], note: 'State + federal money-in-politics (incl. state races OpenFEC misses).' },
  // ---- Government: contracts & spending ----
  { id: 'usaspending', name: 'USAspending.gov', gov: true, base: 'https://api.usaspending.gov/api/v2', auth: 'none', free: true, license: 'public-domain',
    serves: ['contracts'], note: 'KEYLESS. Every federal award/contract/grant by recipient + agency — "who got the money."' },
  { id: 'samgov', name: 'SAM.gov', gov: true, base: 'https://api.sam.gov', auth: 'key', free: true, license: 'public-domain',
    serves: ['contracts', 'exclusions'], note: 'Entity registration + the federal exclusions (debarment) list.' },
  // ---- Government: stocks, companies owned & sold ----
  { id: 'sec-edgar', name: 'SEC EDGAR', gov: true, base: 'https://data.sec.gov', auth: 'none', free: true, license: 'public-domain',
    serves: ['holdings', 'companies', 'insider'], note: 'KEYLESS. Company filings + insider Forms 3/4/5 (stocks owned/bought/sold) + ownership. Full-text search at efts.sec.gov.' },
  { id: 'senate-stock-watcher', name: 'Senate Stock Watcher', gov: false, base: 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com', auth: 'none', free: true, license: 'cc-attribution',
    serves: ['holdings', 'trades'], note: 'KEYLESS JSON. Senators\' STOCK-Act periodic transaction reports, parsed. (House twin: house-stock-watcher.)' },
  { id: 'house-stock-watcher', name: 'House Stock Watcher', gov: false, base: 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com', auth: 'none', free: true, license: 'cc-attribution',
    serves: ['holdings', 'trades'], note: 'KEYLESS JSON. House members\' STOCK-Act periodic transaction reports.' },
  { id: 'senate-efd', name: 'Senate eFD', gov: true, base: 'https://efdsearch.senate.gov', auth: 'scrape', free: true, license: 'public-domain',
    serves: ['disclosure'], note: 'Primary STOCK-Act financial disclosures — official but no clean API (the watchers parse this).' },
  { id: 'house-clerk-fd', name: 'House Clerk Financial Disclosures', gov: true, base: 'https://disclosures-clerk.house.gov', auth: 'scrape', free: true, license: 'public-domain',
    serves: ['disclosure'], note: 'Bulk annual ZIP/XML of House financial disclosures — semi-API.' },
  // ---- Government: courts & judges ----
  { id: 'courtlistener', name: 'CourtListener (Free Law Project)', gov: false, base: 'https://www.courtlistener.com/api/rest/v4', auth: 'key', free: true, license: 'public-domain',
    serves: ['rulings', 'dockets', 'judicial-disclosure'], note: 'Opinions, dockets (RECAP), AND federal judges\' financial disclosures. Free token.' },
  { id: 'govinfo', name: 'GovInfo', gov: true, base: 'https://api.govinfo.gov', auth: 'key', free: true, license: 'public-domain',
    serves: ['documents'], note: 'GPO — bills, hearings, CRS reports, the Congressional Record.' },
  // ---- Media: the article / statement / resignation-call layer ----
  { id: 'gdelt', name: 'GDELT 2.0 DOC', gov: false, base: 'https://api.gdeltproject.org/api/v2/doc/doc', auth: 'none', free: true, license: 'cc-attribution',
    serves: ['media', 'resignation-call', 'statement', 'charge'], note: 'KEYLESS. Global news monitoring across thousands of outlets — the engine for "find the articles" (resign calls, statements, criticism) at scale.' },
  { id: 'guardian', name: 'The Guardian Open Platform', gov: false, base: 'https://content.guardianapis.com', auth: 'key', free: true, license: 'cc-by-nc',
    serves: ['media'], note: 'Full-text Guardian content + tags. Free developer key.' },
  { id: 'nyt', name: 'NYT Article Search', gov: false, base: 'https://api.nytimes.com/svc/search/v2', auth: 'key', free: true, license: 'attribution',
    serves: ['media'], note: 'NYT article metadata search. Free key.' },
  { id: 'wikidata', name: 'Wikidata', gov: false, base: 'https://www.wikidata.org/w/api.php', auth: 'none', free: true, license: 'cc0',
    serves: ['identity', 'positions'], note: 'KEYLESS. Structured entity facts — offices held, party, positions, identifiers (links the graph to everything else).' },
]);

/** Registry filtered by served dimension, or the keyless subset. */
export function apisFor(dimension) {
  const d = str(dimension).toLowerCase();
  return API_REGISTRY.filter((a) => a.serves.some((s) => s.toLowerCase() === d));
}
export function keylessApis() { return API_REGISTRY.filter((a) => a.auth === 'none'); }

async function getJson(url, headers = {}) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── GDELT: the media engine (KEYLESS) ───────────────────────────────────────────────────────────
// Find articles matching a query (e.g. a name + "resign"). Returns normalized media records.
export async function gdeltArticles(query, { max = 15, sourceLang = 'eng', timespan = '6m' } = {}) {
  const q = str(query);
  if (!q) return [];
  // GDELT wants the 3-letter ISO code (sourcelang:eng, not :english) and a timespan, else it 0s/limits.
  const u = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q + (sourceLang ? ` sourcelang:${sourceLang}` : ''))}&mode=ArtList&maxrecords=${Math.max(1, Math.min(250, max))}&timespan=${encodeURIComponent(timespan)}&format=json&sort=DateDesc`;
  const j = await getJson(u);
  const arts = (j && Array.isArray(j.articles)) ? j.articles : [];
  return arts.map((a) => ({
    title: str(a.title), url: str(a.url), domain: str(a.domain),
    asOf: gdeltDate(a.seendate), source: { name: str(a.domain) || 'GDELT', url: str(a.url) },
  })).filter((a) => a.url);
}

function gdeltDate(s) {
  const v = str(s); // 20260619T101500Z → 2026-06-19
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : v;
}

// Naively classify recent media about a person into candidate event records (for "keep filing pages").
// These are DRAFT candidates — a human/Resource-Center pass confirms before they enter a dossier as facts.
const MEDIA_PATTERNS = [
  { kind: 'resignation-call', re: /\bresign(ation)?\b/i },
  { kind: 'charge', re: /\bindict|charg(e|ed)|arrest|felony|fraud|bribery\b/i },
  { kind: 'disposition', re: /\bconvicted|acquitt|sentenc|dismiss|plea|mistrial|settle/i },
  { kind: 'investigation', re: /\binvestigat|subpoena|probe|FBI|DOJ|ethics complaint/i },
  { kind: 'statement', re: /\bsaid|statement|denied|testified|told investigators\b/i },
];
export async function discoverMedia(name, { max = 25, timespan = '24m' } = {}) {
  const who = str(name);
  if (!who) return [];
  // Scope the GDELT query to watchdog terms so the corpus that comes back is relevant, then classify
  // each headline. Results are DRAFT candidates (candidate:true) — confirmed before entering a dossier.
  const scoped = `"${who}" (resign OR indicted OR charged OR convicted OR bribery OR fraud OR investigation OR subpoena OR ethics OR sentenced)`;
  const arts = await gdeltArticles(scoped, { max, timespan });
  const out = [];
  for (const a of arts) {
    const hay = a.title;
    if (!hay.toLowerCase().includes(who.toLowerCase().split(' ').pop())) continue; // headline must name the subject
    const hit = MEDIA_PATTERNS.find((p) => p.re.test(hay));
    if (!hit) continue;
    out.push({ type: hit.kind, subject: who, label: a.title, candidate: true, source: a.source, asOf: a.asOf });
  }
  return out;
}

// ── SEC EDGAR: stocks / companies owned & sold (KEYLESS) ─────────────────────────────────────────
// Full-text search of filings (insider Forms 3/4/5 show holdings + buys/sells). Returns filing records.
export async function secEdgarFullText(query, { forms = '', max = 20 } = {}) {
  const q = str(query);
  if (!q) return [];
  const formsQ = forms ? `&forms=${encodeURIComponent(forms)}` : '';
  const u = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"' + q + '"')}${formsQ}`;
  const j = await getJson(u);
  const hits = (j && j.hits && Array.isArray(j.hits.hits)) ? j.hits.hits : [];
  return hits.slice(0, max).map((h) => {
    const s = h._source || {};
    const adsh = str(h._id).split(':')[0];
    return {
      type: 'disclosure', filing: str((s.file_type || (s.forms && s.forms[0]))),
      label: `SEC filing ${str(s.forms && s.forms[0])} — ${str((s.display_names && s.display_names[0]) || q)}`,
      asOf: str(s.file_date), source: { name: 'SEC EDGAR', url: adsh ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany` : 'https://www.sec.gov/edgar' },
    };
  });
}

// ── Congressional stock trades (KEYLESS JSON datasets) ───────────────────────────────────────────
// chamber: 'senate' | 'house'. Filters the public watcher dataset by representative/senator name.
export async function congressTrades(name, { chamber = 'senate', max = 50 } = {}) {
  const who = str(name).toLowerCase();
  const host = chamber === 'house'
    ? 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json'
    : 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json';
  const j = await getJson(host);
  const rows = Array.isArray(j) ? j : [];
  const out = [];
  for (const r of rows) {
    const member = str(r.senator || r.representative || r.member).toLowerCase();
    if (who && member && !member.includes(who)) continue;
    out.push({
      type: 'investment', holder: str(r.senator || r.representative || r.member), company: str(r.ticker || r.asset_description),
      status: /sale|sold/i.test(str(r.type)) ? 'sold' : 'current', label: `${str(r.type)} ${str(r.amount)} — ${str(r.asset_description)}`,
      source: { name: chamber === 'house' ? 'House Stock Watcher' : 'Senate Stock Watcher', url: host }, asOf: str(r.transaction_date || r.disclosure_date),
    });
    if (out.length >= max) break;
  }
  return out;
}

const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  const cmd = process.argv[2] || 'registry';
  if (cmd === 'registry') {
    process.stdout.write(`${API_REGISTRY.length} APIs (${keylessApis().length} keyless)\n`);
    for (const a of API_REGISTRY) process.stdout.write(`  [${a.auth.padEnd(6)}] ${a.name} — serves: ${a.serves.join(', ')}\n`);
  } else if (cmd === 'media') {
    process.stdout.write(JSON.stringify(await discoverMedia(process.argv[3] || 'Ken Paxton'), null, 2) + '\n');
  }
}

// cross-links.mjs — the SINGLE SOURCE OF TRUTH for inter-site links across the SoapBox family
// (task #276). The metadata extractors (legal-knowledge-graph, accountability-graph, company-profiles)
// already pull out the entities — judges, politicians, parties/companies, cases, citations, categories —
// but the sites that surface those entities don't yet point at each other. This module turns an entity
// into the canonical cross-site lookup URLs, so the web becomes "clear": from a case you can reach the
// company's profile on Stocks; from a company profile you can reach the cases that mention it on Law.
//
//   import { judgeLinks, companyLinks, politicianLinks, caseLinks, citationLinks, categoryLinks } from './cross-links.mjs';
//   judgeLinks('Thurgood Marshall')   → { law: '…/judges?q=Thurgood%20Marshall', politics: '…/accountability?q=Thurgood%20Marshall' }
//   companyLinks('Apple')             → { stocks: '…/?q=Apple', law: '…/cases?q=Apple', politics: '…/accountability?q=Apple' }
//   companyLinks('BTC', { crypto:true }) adds { data: '…/coin/btc' }
//
// DISCIPLINE (inherited from the readers): facts only, no fabricated relationships. EVERY returned URL is
// a SEARCH / LOOKUP link — "find cases mentioning X", "look this judge up" — never an assertion that a
// relationship exists. The caller renders them as "company profile →" style affordances, not claims.
//
// PURE: no network, no I/O. Just safe URL construction. Env overrides let a deployment (or a test) point
// at staging hosts; production defaults are the live subdomains.

// Production defaults — the live SoapBox subdomains. Override per-deployment via env.
const trim = (s, dflt) => String(s == null || s === '' ? dflt : s).replace(/\/+$/, '');
const LAW = trim(process.env.LAW_SITE, 'https://law.soapbox.community');
const POLITICS = trim(process.env.POLITICS_SITE, 'https://politics.soapbox.community');
const STOCKS = trim(process.env.STOCKS_SITE, 'https://stocks.soapbox.community');
const DATA = trim(process.env.DATA_SITE, 'https://data.soapbox.community');
const SCAM = trim(process.env.SCAM_ALERT_SITE, 'https://scam-alert.soapbox.community');
const HUB = trim(process.env.SOAPBOX_HUB, 'https://soapbox.community');

// Re-read env at call time too, so a test that sets process.env.* before calling sees the override
// without needing module re-import. The module-level consts above are the fast path / documented default.
function bases() {
  return {
    law: trim(process.env.LAW_SITE, LAW),
    politics: trim(process.env.POLITICS_SITE, POLITICS),
    stocks: trim(process.env.STOCKS_SITE, STOCKS),
    data: trim(process.env.DATA_SITE, DATA),
    scamAlert: trim(process.env.SCAM_ALERT_SITE, SCAM),
    hub: trim(process.env.SOAPBOX_HUB, HUB),
  };
}

// Safe component encoder. encodeURIComponent handles &, <, >, ", spaces, unicode — everything that could
// break out of a query-string value or inject into the surrounding HTML attribute once esc()'d by a caller.
const enc = (s) => encodeURIComponent(String(s == null ? '' : s).trim());

/**
 * Cross-site links for a JUDGE. Law has the judge profiles; Politics has the accountability power-map
 * (judges are §6A nodes there). Both are name searches — "look this person up", never a claim.
 * @param {string} name judge name, e.g. "Thurgood Marshall"
 * @returns {{law:string, politics:string}}
 */
export function judgeLinks(name) {
  const q = enc(name);
  const b = bases();
  return {
    law: `${b.law}/judges?q=${q}`,
    politics: `${b.politics}/accountability?q=${q}`,
  };
}

/**
 * Cross-site links for a POLITICIAN / public official. Politics has the accountability map; Law surfaces
 * any cases naming them (e.g. as a party). Name searches only.
 * @param {string} name
 * @returns {{politics:string, law:string}}
 */
export function politicianLinks(name) {
  const q = enc(name);
  const b = bases();
  return {
    politics: `${b.politics}/accountability?q=${q}`,
    law: `${b.law}/cases?q=${q}`,
  };
}

/**
 * Cross-site links for a COMPANY (by name OR ticker). Stocks has the per-symbol/company profile; Law
 * surfaces cases mentioning the company (as a party or subject); Politics surfaces the entity in the
 * power-map (lobbying / contracts via the accountability graph). If it's a crypto, also link the coin
 * page on Data. Every link is a lookup of the name/ticker, not an assertion of any relationship.
 * @param {string} nameOrTicker e.g. "Apple", "AAPL", "BTC"
 * @param {{crypto?:boolean}} [opts] crypto:true also returns a Data coin-page link
 * @returns {{stocks:string, law:string, politics:string, scamAlert:string, scams:string, data?:string}}
 */
export function companyLinks(nameOrTicker, opts = {}) {
  const raw = String(nameOrTicker == null ? '' : nameOrTicker).trim();
  const q = enc(raw);
  const b = bases();
  const out = {
    stocks: `${b.stocks}/?q=${q}`,
    law: `${b.law}/cases?q=${q}`,
    politics: `${b.politics}/accountability?q=${q}`,
    // scam-alert = the per-company official-records report; scams = the SoapBox hub's fraud section.
    scamAlert: `${b.scamAlert}/company?q=${q}`,
    scams: `${b.hub}/scams?q=${q}`,
  };
  if (opts.crypto) {
    // Data coin pages live at /coin/<slug>; the ticker/name lower-cased is the conventional slug.
    out.data = `${b.data}/coin/${enc(raw.toLowerCase())}`;
  }
  return out;
}

/**
 * Cross-site links for a CASE (by on-site id, cluster id, or name). Law's own detail route is the home;
 * Politics surfaces the case name in the power-map (a case can name an official). Lookup links only.
 * @param {string} id a CourtListener cluster id, CAP id, or a case name
 * @param {{cap?:boolean, name?:string}} [opts] cap:true → CAP id route (?cap=); name → label for a name-search fallback
 * @returns {{law:string, politics:string}}
 */
export function caseLinks(id, opts = {}) {
  const b = bases();
  const idStr = String(id == null ? '' : id).trim();
  const q = enc(idStr);
  // a numeric/string id routes to the on-site full-opinion detail; a name routes to case search.
  const law = idStr
    ? `${b.law}/cases?${opts.cap ? 'cap' : 'id'}=${q}`
    : `${b.law}/cases?q=${enc(opts.name || '')}`;
  const politicsQ = enc(opts.name || idStr);
  return {
    law,
    politics: `${b.politics}/accountability?q=${politicsQ}`,
  };
}

/**
 * Cross-site link for a reporter CITATION (e.g. "347 U.S. 483"). The Law cases tab resolves a reporter
 * citation to its case via the Caselaw Access Project. Lookup link only.
 * @param {string} citation
 * @returns {{law:string}}
 */
export function citationLinks(citation) {
  const b = bases();
  return { law: `${b.law}/cases?q=${enc(citation)}` };
}

/**
 * Cross-site link for a legal CATEGORY / topic (legal-knowledge-graph SEED_CATEGORIES, e.g. "Coercion").
 * Surfaced on the Law cases tab as a topic search. Lookup link only.
 * @param {string} category id ('cat:coercion') or display name ('Coercion')
 * @returns {{law:string}}
 */
export function categoryLinks(category) {
  const b = bases();
  // strip a 'cat:' id prefix so the search term reads naturally; keep a plain name as-is.
  const term = String(category == null ? '' : category).replace(/^cat:/, '').replace(/[-_]/g, ' ').trim();
  return { law: `${b.law}/cases?q=${enc(term)}` };
}

// The set of canonical site bases, exported for callers that want to build a link the helpers don't cover
// yet (keeps them from re-deriving the env/default logic — still the single source of truth).
export function siteBases() { return bases(); }

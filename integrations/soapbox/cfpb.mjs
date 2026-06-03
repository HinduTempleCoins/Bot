// cfpb.mjs — the SoapBox "Scams" vertical reader (queue task #103). Pulls from keyless public sources
// so an ordinary person can look up whether a company/product/wallet has a paper trail of complaints,
// enforcement, or scam reports BEFORE they get burned. Complementary to scam-registry.mjs (a curated
// list) — this one is a live READER over external authorities. All sources soft-fail to [] and the
// module never throws; a dead source just drops out of the summary.
//
// Sources (keyless anchors):
//   • CFPB Consumer Complaint Database  — public JSON API (the anchor; complaints by product/company)
//   • SEC EDGAR full-text search        — keyless EFTS search over filings
//   • SEC litigation releases           — enforcement actions (best-effort scrape of the index)
//   • CryptoScamDB                       — open data on GitHub (addresses/domains flagged as scams)
//   • Chainabuse                         — OPTIONAL key (process.env.CHAINABUSE_KEY); soft-fail if absent
//
//   import { complaints, secLitigation, cryptoScams, scamSummary } from './cfpb.mjs'
//   node integrations/soapbox/cfpb.mjs "tether"

import { cached, TTL } from './cache.mjs';

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const looksLikeAddress = (q) => /^(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,39}|bc1[a-z0-9]{20,80}|T[a-zA-Z0-9]{33})$/.test(str(q));

// ── CFPB Consumer Complaint Database ──────────────────────────────────────────────────────────────
// Public, keyless. The search-API endpoint returns hits[].hits.[]._source with the complaint fields.
// We filter by product (e.g. "Money transfer, virtual currency, or money service") and/or company.
export async function complaints({ product = '', company = '', size = 20 } = {}) {
  const key = `cfpb:complaints:${str(product).toLowerCase()}|${str(company).toLowerCase()}|${size}`;
  return cached(key, TTL.metadata, async () => {
    try {
      const p = new URLSearchParams();
      p.set('size', String(size));
      p.set('sort', 'created_date_desc');
      p.set('no_aggs', 'true');
      if (str(product)) p.set('product', str(product));
      if (str(company)) p.set('company', str(company));
      const u = `https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?${p.toString()}`;
      const r = await _fetch(u, { headers: UA });
      if (!r || !r.ok) return [];
      const j = await r.json();
      const hits = j?.hits?.hits || j?.hits || [];
      return hits.map((h) => {
        const s = h._source || h;
        return {
          id: str(s.complaint_id),
          date: str(s.date_received || s.created_date),
          product: str(s.product),
          subproduct: str(s.sub_product),
          issue: str(s.issue),
          company: str(s.company),
          state: str(s.state),
          narrative: str(s.complaint_what_happened),
          response: str(s.company_response),
          timely: str(s.timely),
          source: 'CFPB',
        };
      }).filter((c) => c.id || c.company || c.issue);
    } catch { return []; }
  });
}

// ── SEC EDGAR full-text search (EFTS) ─────────────────────────────────────────────────────────────
// Keyless. efts.sec.gov/LATEST/search-index?q=... returns hits with filing metadata. Useful for
// "is this company/term in SEC filings at all" — context, not a verdict.
export async function secEdgar(q, { size = 10 } = {}) {
  const query = str(q);
  if (!query) return [];
  return cached(`sec:edgar:${query.toLowerCase()}|${size}`, TTL.metadata, async () => {
    try {
      const u = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}&forms=&dateRange=custom`;
      const r = await _fetch(u, { headers: UA });
      if (!r || !r.ok) return [];
      const j = await r.json();
      const hits = j?.hits?.hits || [];
      return hits.slice(0, size).map((h) => {
        const s = h._source || h;
        const id = str(h._id);
        const accNo = id.split(':')[0] || '';
        const cik = (s.ciks && s.ciks[0]) ? str(s.ciks[0]) : '';
        return {
          title: str(s.display_names && s.display_names[0]) || str(s.file_type) || accNo,
          form: str(s.file_type || s.root_form),
          date: str(s.file_date),
          cik,
          url: accNo ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}` : 'https://efts.sec.gov/LATEST/search-index',
          source: 'SEC EDGAR',
        };
      });
    } catch { return []; }
  });
}

// ── SEC litigation releases ───────────────────────────────────────────────────────────────────────
// Enforcement actions. The litigation index is HTML; we best-effort parse the release links and titles
// and filter by the query term. Keyless. Soft-fail to [].
export async function secLitigation(q, { size = 15 } = {}) {
  const query = str(q).toLowerCase();
  return cached(`sec:lit:${query}|${size}`, TTL.metadata, async () => {
    try {
      const u = 'https://www.sec.gov/litigation/litreleases';
      const r = await _fetch(u, { headers: UA });
      if (!r || !r.ok) return [];
      const html = await r.text();
      const out = [];
      // anchors pointing at individual litigation releases (e.g. /litigation/litreleases/lr-12345)
      const re = /<a[^>]+href="([^"]*litreleases[^"]*lr[-_]?\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && out.length < 200) {
        const href = m[1];
        const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (!title) continue;
        const url = href.startsWith('http') ? href : `https://www.sec.gov${href.startsWith('/') ? '' : '/'}${href}`;
        out.push({ title, url, source: 'SEC Litigation' });
      }
      const filtered = query ? out.filter((x) => x.title.toLowerCase().includes(query)) : out;
      return filtered.slice(0, size);
    } catch { return []; }
  });
}

// ── CryptoScamDB (open data on GitHub) ────────────────────────────────────────────────────────────
// Community open dataset of scam addresses/domains. We read the consolidated blacklist JSON from the
// raw GitHub mirror (keyless). Match on address or free-text query against the entry's address/name/url.
const CRYPTOSCAMDB_URL = 'https://raw.githubusercontent.com/CryptoScamDB/blacklist/master/data/urls.json';

export async function cryptoScamDB(q, { size = 25 } = {}) {
  const query = str(q).toLowerCase();
  return cached('cryptoscamdb:all', TTL.metadata, async () => {
    try {
      const r = await _fetch(CRYPTOSCAMDB_URL, { headers: UA });
      if (!r || !r.ok) return [];
      const j = await r.json();
      // dataset can be an array of entries or an object keyed by id; normalize to a flat list.
      const rows = Array.isArray(j) ? j : Object.values(j || {});
      return rows.map((e) => ({
        name: str(e.name || e.id),
        url: str(e.url || e.hostname),
        category: str(e.category || e.subcategory || e.type),
        addresses: Array.isArray(e.addresses) ? e.addresses.map(str) : (e.address ? [str(e.address)] : []),
        description: str(e.description),
        source: 'CryptoScamDB',
      }));
    } catch { return []; }
  }).then((all) => {
    if (!query) return all.slice(0, size);
    return all.filter((e) =>
      e.name.toLowerCase().includes(query) ||
      e.url.toLowerCase().includes(query) ||
      e.description.toLowerCase().includes(query) ||
      e.addresses.some((a) => a.toLowerCase() === query || a.toLowerCase().includes(query)),
    ).slice(0, size);
  });
}

// ── Chainabuse (OPTIONAL key) ─────────────────────────────────────────────────────────────────────
// Reports of scam/abuse addresses. Requires an API key; if process.env.CHAINABUSE_KEY is absent we
// soft-fail to [] (no error, no network) so the module stays keyless-by-default.
export async function chainabuse(q, { size = 20 } = {}) {
  const key = process.env.CHAINABUSE_KEY;
  const query = str(q);
  if (!key || !query) return [];
  try {
    const u = `https://api.chainabuse.com/v0/reports?address=${encodeURIComponent(query)}&page=1&perPage=${size}`;
    const r = await _fetch(u, { headers: { ...UA, 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = j?.reports || j?.data || (Array.isArray(j) ? j : []);
    return rows.map((rep) => ({
      category: str(rep.scamCategory || rep.category),
      description: str(rep.description),
      address: query,
      createdAt: str(rep.createdAt),
      source: 'Chainabuse',
    }));
  } catch { return []; }
}

// ── crypto scam lookup (address OR free-text) — merges CryptoScamDB + Chainabuse ───────────────────
export async function cryptoScams(addressOrQ, { size = 25 } = {}) {
  const q = str(addressOrQ);
  const [db, ca] = await Promise.all([
    cryptoScamDB(q, { size }).catch(() => []),
    chainabuse(q, { size }).catch(() => []),
  ]);
  return {
    query: q,
    isAddress: looksLikeAddress(q),
    cryptoScamDB: db,
    chainabuse: ca,
    flagged: db.length > 0 || ca.length > 0,
    count: db.length + ca.length,
  };
}

// ── unified scam summary for a query (the homepage / Scams-tab card) ───────────────────────────────
export async function scamSummary(q) {
  const query = str(q);
  const addr = looksLikeAddress(query);
  const [cfpb, lit, edgar, crypto] = await Promise.all([
    complaints({ company: addr ? '' : query, size: 10 }).catch(() => []),
    secLitigation(query, { size: 10 }).catch(() => []),
    secEdgar(query, { size: 8 }).catch(() => []),
    cryptoScams(query, { size: 15 }).catch(() => ({ cryptoScamDB: [], chainabuse: [], flagged: false, count: 0 })),
  ]);
  const signals = cfpb.length + lit.length + (crypto.count || 0);
  return {
    query,
    isAddress: addr,
    complaints: cfpb,
    secLitigation: lit,
    secEdgar: edgar,
    cryptoScams: crypto,
    signals,
    riskFlagged: lit.length > 0 || (crypto.flagged === true) || cfpb.length >= 5,
    disclaimer: 'Aggregated public records (CFPB, SEC, community scam trackers). Presence of a complaint or report is not proof of wrongdoing; absence is not proof of safety. Not financial or legal advice.',
    sources: ['CFPB Consumer Complaint Database', 'SEC EDGAR', 'SEC Litigation Releases', 'CryptoScamDB', process.env.CHAINABUSE_KEY ? 'Chainabuse' : 'Chainabuse (no key — skipped)'],
  };
}

if (process.argv[1] && process.argv[1].endsWith('cfpb.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'tether';
  const s = await scamSummary(q).catch((e) => ({ error: e.message }));
  if (s.error) { console.error(s.error); process.exit(1); }
  console.log(`\nScam summary for: ${s.query}${s.isAddress ? ' (address)' : ''}`);
  console.log(`  signals: ${s.signals}   riskFlagged: ${s.riskFlagged}`);
  console.log(`\n== CFPB complaints (${s.complaints.length}) ==`);
  for (const c of s.complaints) console.log(`  • [${c.date}] ${c.company} — ${c.issue}`);
  console.log(`\n== SEC litigation (${s.secLitigation.length}) ==`);
  for (const l of s.secLitigation) console.log(`  • ${l.title}`);
  console.log(`\n== SEC EDGAR (${s.secEdgar.length}) ==`);
  for (const e of s.secEdgar) console.log(`  • [${e.form}] ${e.title}`);
  console.log(`\n== Crypto scam trackers (${s.cryptoScams.count}) ==`);
  for (const e of s.cryptoScams.cryptoScamDB) console.log(`  • [CryptoScamDB] ${e.name || e.url} — ${e.category}`);
  for (const e of s.cryptoScams.chainabuse) console.log(`  • [Chainabuse] ${e.category} — ${e.description}`);
  console.log(`\n${s.disclaimer}`);
}

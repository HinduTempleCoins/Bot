// oai-pmh.mjs — library federation for SoapBox (queue #85). OAI-PMH is the universal metadata-harvesting
// protocol: nearly every digital library, archive, and repository exposes a `?verb=ListRecords` endpoint
// that returns Dublin Core records. We harvest those, follow the resumptionToken pagination, and ship a
// curated REPOSITORIES directory (DPLA, Europeana, Trove, OAPEN + national libraries) so a person can
// federate across the world's collections from one place. Pure XML parsing is split out + tested offline.
//
// Soft-fail everywhere: a dead endpoint returns [] / null, never throws — the page still renders.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Curated OAI-PMH (and OAI-PMH-adjacent) repositories worth federating. Each: name, country/scope,
// the OAI base URL (verb appended at harvest time), a human landing page, and a short note. Endpoints
// that speak OAI-PMH carry oai:true; aggregators with their own APIs are listed for the directory but
// flagged oai:false so callers know harvest() may not apply directly.
export const REPOSITORIES = [
  { name: 'OAPEN', scope: 'Open-access books (global)', oai: 'https://library.oapen.org/oai/request', site: 'https://www.oapen.org/', oaiPmh: true, note: 'Peer-reviewed OA monographs & chapters' },
  { name: 'DOAB', scope: 'Directory of Open Access Books', oai: 'https://directory.doabooks.org/oai/request', site: 'https://www.doabooks.org/', oaiPmh: true, note: 'OA academic book index' },
  { name: 'BASE (Bielefeld)', scope: 'Academic web search (global)', oai: 'https://oai.base-search.net/oai', site: 'https://www.base-search.net/', oaiPmh: true, note: '300M+ docs harvested from repositories worldwide' },
  { name: 'CORE', scope: 'Open-access research papers', oai: 'https://core.ac.uk/oai', site: 'https://core.ac.uk/', oaiPmh: true, note: 'Aggregated OA papers; large API too' },
  { name: 'arXiv', scope: 'Physics / math / CS preprints', oai: 'http://export.arxiv.org/oai2', site: 'https://arxiv.org/', oaiPmh: true, note: 'oai_dc + arXiv metadata formats' },
  { name: 'PubMed Central (Europe)', scope: 'Life-science literature', oai: 'https://europepmc.org/oai.cgi', site: 'https://europepmc.org/', oaiPmh: true, note: 'Biomedical full-text & abstracts' },
  { name: 'HathiTrust', scope: 'Digitized library books (US)', oai: 'https://catalog.hathitrust.org/oai', site: 'https://www.hathitrust.org/', oaiPmh: true, note: 'Catalog records for 17M+ volumes' },
  { name: 'Internet Archive Scholar', scope: 'Scholarly works (global)', oai: 'https://archive.org/services/oai2.php', site: 'https://archive.org/', oaiPmh: true, note: 'Texts, audio, video, web' },
  { name: 'Trove (NLA)', scope: 'Australia — national aggregator', oai: 'https://www.nla.gov.au/apps/srw/search/peopleaustralia', site: 'https://trove.nla.gov.au/', oaiPmh: false, note: 'National Library of Australia; API key for full search' },
  { name: 'Gallica (BnF)', scope: 'France — national library', oai: 'https://gallica.bnf.fr/services/OAIRecord', site: 'https://gallica.bnf.fr/', oaiPmh: true, note: 'Bibliothèque nationale de France digitized holdings' },
  { name: 'Deutsche Digitale Bibliothek', scope: 'Germany — national aggregator', oai: 'https://www.deutsche-digitale-bibliothek.de/oai', site: 'https://www.deutsche-digitale-bibliothek.de/', oaiPmh: true, note: 'German libraries, archives & museums' },
  { name: 'Europeana', scope: 'Europe — cultural-heritage aggregator', oai: 'https://www.europeana.eu/api/v2/', site: 'https://www.europeana.eu/', oaiPmh: false, note: '50M+ items; REST API (key) is primary access' },
  { name: 'DPLA', scope: 'USA — Digital Public Library of America', oai: 'https://api.dp.la/v2/', site: 'https://dp.la/', oaiPmh: false, note: '40M+ items; REST API (key) is primary access' },
  { name: 'Biblioteca Digital Hispánica (BNE)', scope: 'Spain — national library', oai: 'https://bdh.bne.es/bnesearch/OAIHandler', site: 'https://bdh.bne.es/', oaiPmh: true, note: 'Biblioteca Nacional de España' },
  { name: 'Polona (BN Poland)', scope: 'Poland — national library', oai: 'https://polona.pl/oai', site: 'https://polona.pl/', oaiPmh: true, note: 'Biblioteka Narodowa digitized collections' },
  { name: 'Digital NZ', scope: 'New Zealand — national aggregator', oai: 'https://api.digitalnz.org/', site: 'https://digitalnz.org/', oaiPmh: false, note: 'National Library of NZ; REST API (key)' },
  { name: 'Zenodo', scope: 'Research data & software (CERN)', oai: 'https://zenodo.org/oai2d', site: 'https://zenodo.org/', oaiPmh: true, note: 'DOIs for datasets, papers, software' },
];

/** The curated repository directory (returns a copy so callers can't mutate the source list). */
export function listRepositories() {
  return REPOSITORIES.map((r) => ({ ...r }));
}

// --- text helpers (no XML library; OAI-PMH oai_dc is shallow + regex-tractable) -----------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ENTITIES[n]);
}
function safeChar(code) { try { return String.fromCodePoint(code); } catch { return ''; } }

// Strip a leading namespace prefix from a tag name: "dc:title" → "title", "oai_dc:dc" → "dc".
function localName(tag) { const i = tag.indexOf(':'); return i === -1 ? tag : tag.slice(i + 1); }

// Pull all values of a (namespace-agnostic) Dublin Core element from a record fragment, in order.
function dcValues(fragment, element) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${element}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${element}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(fragment)) !== null) {
    const v = decodeEntities(m[1].replace(/<[^>]*>/g, '').trim());
    if (v) out.push(v);
  }
  return out;
}

/**
 * PURE: parse an OAI-PMH ListRecords/ListIdentifiers XML response into Dublin Core records.
 * Returns { records: [{ title, creator, date, identifier, source }], resumptionToken|null }.
 * Multi-valued DC fields are joined with "; ". Deleted records (status="deleted") are skipped.
 * Never throws — malformed input yields an empty record set.
 */
export function parseOaiXml(xml) {
  const empty = { records: [], resumptionToken: null };
  if (typeof xml !== 'string' || !xml) return empty;

  const records = [];
  // Each <record>…</record> block. Some endpoints emit <oai:record> — be prefix-agnostic.
  const recRe = /<(?:[\w.-]+:)?record\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?record>/gi;
  let rm;
  while ((rm = recRe.exec(xml)) !== null) {
    const block = rm[1];
    // Skip records flagged deleted in the header.
    if (/<(?:[\w.-]+:)?header\b[^>]*\bstatus\s*=\s*["']deleted["']/i.test(block)) continue;
    // Strip the OAI <header> so its <identifier>/<datestamp> aren't mistaken for Dublin Core elements.
    const meta = block.replace(/<(?:[\w.-]+:)?header\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?header>/gi, '')
      .replace(/<(?:[\w.-]+:)?header\b[^>]*\/>/gi, '');
    const join = (arr) => (arr.length ? arr.join('; ') : '');
    const rec = {
      title: join(dcValues(meta, 'title')),
      creator: join(dcValues(meta, 'creator')),
      date: join(dcValues(meta, 'date')),
      identifier: join(dcValues(meta, 'identifier')),
      source: join(dcValues(meta, 'source')),
    };
    // Keep a record only if it carries any DC content (drop bare headers with no metadata).
    if (rec.title || rec.creator || rec.date || rec.identifier || rec.source) records.push(rec);
  }

  // resumptionToken: <resumptionToken ...>TOKEN</resumptionToken>. An empty/self-closed token means done.
  let resumptionToken = null;
  const tokMatch = xml.match(/<(?:[\w.-]+:)?resumptionToken\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?resumptionToken>/i);
  if (tokMatch) {
    const tok = decodeEntities(tokMatch[1].trim());
    if (tok) resumptionToken = tok;
  }

  return { records, resumptionToken };
}

function buildUrl(endpoint, params) {
  // Endpoint may already carry a query (rare); append cleanly either way.
  const sep = endpoint.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return endpoint + sep + qs;
}

/**
 * Harvest Dublin Core records from an OAI-PMH endpoint via ListRecords, following resumptionToken
 * pagination. Soft-fail: on any error returns whatever was gathered so far (often []), never throws.
 *
 * @param {object} o
 * @param {string} o.endpoint  OAI-PMH base URL (verb is appended).
 * @param {string} [o.set]     optional setSpec to scope the harvest.
 * @param {string} [o.from]    optional ISO date lower bound (YYYY-MM-DD or full UTC timestamp).
 * @param {string} [o.until]   optional ISO date upper bound.
 * @param {string} [o.prefix='oai_dc']  metadataPrefix.
 * @param {number} [o.maxPages=5]  cap on resumptionToken follows (politeness / safety).
 * @returns {Promise<Array<{title,creator,date,identifier,source}>>}
 */
export async function harvest({ endpoint, set, from, until, prefix = 'oai_dc', maxPages = 5 } = {}) {
  if (!endpoint || typeof endpoint !== 'string') return [];
  const all = [];
  let token = null;
  for (let page = 0; page < Math.max(1, maxPages); page++) {
    // Per OAI-PMH: once resuming, ONLY verb + resumptionToken are allowed (no set/from/until/prefix).
    const params = token
      ? { verb: 'ListRecords', resumptionToken: token }
      : { verb: 'ListRecords', metadataPrefix: prefix, set, from, until };
    let xml;
    try {
      const r = await _fetch(buildUrl(endpoint, params), { headers: { 'user-agent': UA, accept: 'application/xml,text/xml' } });
      if (!r || !r.ok) break;
      xml = await r.text();
    } catch { break; }
    const { records, resumptionToken } = parseOaiXml(xml);
    for (const rec of records) all.push(rec);
    if (!resumptionToken) break;
    token = resumptionToken;
  }
  return all;
}

if (process.argv[1] && process.argv[1].endsWith('oai-pmh.mjs')) {
  const endpoint = process.argv[2];
  if (!endpoint) {
    console.log('Curated OAI-PMH / library-federation repositories:\n');
    for (const r of listRepositories()) {
      console.log(`  ${r.name.padEnd(34)} ${r.oaiPmh ? 'OAI ' : '    '} ${r.scope}`);
    }
    console.log('\nUsage: node oai-pmh.mjs <oai-endpoint> [setSpec] [from-date]');
  } else {
    const recs = await harvest({ endpoint, set: process.argv[3], from: process.argv[4] });
    console.log(`Harvested ${recs.length} record(s) from ${endpoint}\n`);
    for (const rec of recs.slice(0, 20)) {
      console.log(`  ${rec.title || '(untitled)'}`);
      if (rec.creator) console.log(`    by ${rec.creator}${rec.date ? `  (${rec.date})` : ''}`);
      if (rec.identifier) console.log(`    ${rec.identifier}`);
    }
  }
}

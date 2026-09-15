// genealogy.mjs — SoapBox Genealogy vertical. AGGREGATION / DIRECTORY + INDEX, not scraping piracy.
// Keyless, soft-fail (never throw), provenance-tagged — same contract as cannabis.mjs and macro.mjs.
//
// The load-bearing code here is PURE and unit-tested offline: a minimal GEDCOM 5.5.1/7.0 reader and
// generationsInPlace(), which walks a pedigree and returns the longest UNBROKEN ancestral chain born
// in a given place. That function is the whole reason this module exists in a repo that also runs a
// litigation corpus: "fourth-generation Texan" is a computable claim, and a claim you can compute
// from primary records is a claim you can prove.
//
// Network readers are best-effort and degrade to null. Nothing here mirrors a third party's database;
// we index front doors and link out.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── PURE: GEDCOM ────────────────────────────────────────────────────────────────────────────────
// GEDCOM is a line-oriented format: "<level> [@xref@] <TAG> [value]". Both 5.5.1 (the de-facto
// standard since 1996) and 7.0 (2021) share that spine, so one reader covers the files people
// actually export from Ancestry, FamilySearch, Gramps and RootsMagic.

/** Parse GEDCOM text into a nested record tree. Never throws; malformed lines are skipped. */
export function parseGedcom(text) {
  const root = { level: -1, tag: 'ROOT', children: [] };
  const stack = [root];
  if (typeof text !== 'string') return root;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/.exec(line);
    if (!m) continue;
    const node = { level: +m[1], xref: m[2] || null, tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    (stack[stack.length - 1] || root).children.push(node);
    stack.push(node);
  }
  return root;
}

const kid = (n, tag) => (n?.children || []).find(c => c.tag === tag) || null;
const kids = (n, tag) => (n?.children || []).filter(c => c.tag === tag);

/** Extract a 4-digit year from a GEDCOM date string ("12 MAR 1887", "ABT 1887", "1887"). */
export function gedcomYear(value) {
  const m = /\b(\d{4})\b/.exec(String(value || ''));
  return m ? +m[1] : null;
}

/**
 * Build {individuals, families} from a parsed GEDCOM tree.
 * Individuals carry id, name, sex, birth {year, place}, death {year, place}, and famc (child-of).
 */
export function readGedcom(text) {
  const root = parseGedcom(text);
  const individuals = new Map();
  const families = new Map();
  for (const rec of root.children) {
    if (rec.tag === 'INDI' && rec.xref) {
      const nameNode = kid(rec, 'NAME');
      const birt = kid(rec, 'BIRT'), deat = kid(rec, 'DEAT');
      individuals.set(rec.xref, {
        id: rec.xref,
        name: String(nameNode?.value || '').replace(/\//g, '').trim() || null,
        surname: (/\/([^/]*)\//.exec(nameNode?.value || '') || [, ''])[1].trim() || null,
        sex: kid(rec, 'SEX')?.value || null,
        birth: { year: gedcomYear(kid(birt, 'DATE')?.value), place: kid(birt, 'PLAC')?.value || null },
        death: { year: gedcomYear(kid(deat, 'DATE')?.value), place: kid(deat, 'PLAC')?.value || null },
        famc: kids(rec, 'FAMC').map(f => f.value).filter(Boolean),
      });
    } else if (rec.tag === 'FAM' && rec.xref) {
      families.set(rec.xref, {
        id: rec.xref,
        husb: kid(rec, 'HUSB')?.value || null,
        wife: kid(rec, 'WIFE')?.value || null,
        children: kids(rec, 'CHIL').map(c => c.value).filter(Boolean),
      });
    }
  }
  return { individuals, families };
}

/** Parents of an individual, via their FAMC family links. */
export function parentsOf(tree, id) {
  const out = [];
  const p = tree?.individuals?.get(id);
  for (const fid of p?.famc || []) {
    const fam = tree.families.get(fid);
    if (!fam) continue;
    for (const pid of [fam.husb, fam.wife]) {
      const parent = pid && tree.individuals.get(pid);
      if (parent) out.push(parent);
    }
  }
  return out;
}

/** Normalise a place string for matching: lowercase, strip punctuation and extra space. */
export function normalisePlace(s) {
  return String(s || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when a GEDCOM place string names the given place (state/county/country). */
export function placeMatches(place, want) {
  const p = normalisePlace(place), w = normalisePlace(want);
  if (!p || !w) return false;
  if (p.includes(w)) return true;
  const ABBR = { texas: ['tx'], colorado: ['co'], louisiana: ['la'], oklahoma: ['ok'], arkansas: ['ar'] };
  return (ABBR[w] || []).some(a => new RegExp(`(^|\\s)${a}($|\\s)`).test(p));
}

/**
 * ⭐ THE LOAD-BEARING FUNCTION.
 * Longest UNBROKEN chain of ancestors — starting at `startId` and walking up — whose BIRTH place
 * matches `place`. Returns { generations, chain, brokenAt }.
 *
 * "generations" counts people, so a person born in Texas whose father and grandfather were also born
 * in Texas is generation 3. `brokenAt` names the first ancestor who breaks the chain, which is the
 * honest part: it says where the documentary claim stops.
 */
export function generationsInPlace(tree, startId, place, opts = {}) {
  const maxDepth = opts.maxDepth ?? 12;
  const chain = [];
  let brokenAt = null;
  let current = tree?.individuals?.get(startId) || null;
  let depth = 0;
  while (current && depth < maxDepth) {
    if (!placeMatches(current.birth?.place, place)) { brokenAt = current; break; }
    chain.push({ id: current.id, name: current.name, birthYear: current.birth?.year, birthPlace: current.birth?.place });
    const parents = parentsOf(tree, current.id)
      .filter(p => placeMatches(p.birth?.place, place))
      .sort((a, b) => (a.birth?.year ?? 9999) - (b.birth?.year ?? 9999));
    if (!parents.length) {
      const any = parentsOf(tree, current.id);
      brokenAt = any.length ? any[0] : null;
      current = null;
    } else {
      current = parents[0];
    }
    depth++;
  }
  return { generations: chain.length, chain, brokenAt: brokenAt ? { id: brokenAt.id, name: brokenAt.name, birthPlace: brokenAt.birth?.place, birthYear: brokenAt.birth?.year } : null, place };
}

/** Ordinal label for a generation count: 4 -> "fourth-generation". */
export function generationLabel(n) {
  const words = ['zero', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  return `${words[n] || `${n}th`}-generation`;
}

// ── DIRECTORY: where the records actually are ───────────────────────────────────────────────────
// Front doors only. Each entry carries whether it is keyless, because that decides whether this site
// can query it or must link out.
export const RECORD_SOURCES = {
  'Open APIs (queryable)': [
    ['WikiTree', 'https://www.wikitree.com/', 'Single collaborative tree; public API, no key'],
    ['Wikidata', 'https://query.wikidata.org/', 'SPARQL; P22 father / P25 mother / P40 child'],
    ['Chronicling America (LoC)', 'https://chroniclingamerica.loc.gov/', 'Digitised US newspapers 1777–1963; JSON search'],
    ['Open Library', 'https://openlibrary.org/', 'Published county/family histories'],
    ['HathiTrust', 'https://catalog.hathitrust.org/', 'Digitised county histories and city directories'],
  ],
  'Federal records': [
    ['National Archives Catalog', 'https://catalog.archives.gov/', 'Census, military, land, naturalisation'],
    ['1950 Census', 'https://1950census.archives.gov/', 'Name-searchable images, free'],
    ['NARA Fort Worth', 'https://www.archives.gov/fort-worth', 'The regional branch holding Texas federal records'],
    ['Bureau of Land Management GLO', 'https://glorecords.blm.gov/', 'Federal land patents — original-entry proof'],
  ],
  'Texas': [
    ['Portal to Texas History (UNT)', 'https://texashistory.unt.edu/', 'Newspapers, county records, photographs'],
    ['Texas State Library & Archives', 'https://www.tsl.texas.gov/', 'State vital statistics indexes, muster rolls'],
    ['Texas General Land Office', 'https://www.glo.texas.gov/history/', 'Original Texas land grants — the deepest Texas root record'],
    ['Collin County Clerk', 'https://www.collincountytx.gov/county_clerk/', 'Deeds, marriages, probate'],
    ['Dallas County Clerk', 'https://www.dallascounty.org/departments/county-clerk/', 'Deeds, marriages, probate'],
  ],
  'Cemetery & vital': [
    ['BillionGraves', 'https://billiongraves.com/', 'GPS-tagged headstone images'],
    ['Find a Grave', 'https://www.findagrave.com/', 'Largest cemetery index — no public API; link out only'],
    ['FamilySearch', 'https://www.familysearch.org/', 'Free, but OAuth-gated; link out'],
  ],
};

// ── NETWORK READERS (best-effort, soft-fail to null/[]) ─────────────────────────────────────────
// Every endpoint below was tested live 14 Sep 2026. The User-Agent strings are NOT decoration:
// loc.gov serves a Cloudflare interstitial to a bare "Mozilla/5.0", HathiTrust 403s it, and Wikidata
// rejects it — each wants a different shape, so each reader sets its own.

const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const UA_PROJECT = 'MELEK-genealogy/1.0 (+https://vankushfamily.org)';
const WIKITREE_APP_ID = 'MELEK';   // WikiTree: "API queries without an id will be subject to strict rate limits."

// Documented ceilings, for callers that want to pace themselves. loc.gov is the dangerous one:
// exceeding 20 req/min earns a ONE-HOUR block, and any request during the block restarts the clock.
export const RATE_LIMITS = {
  'loc.gov': { perMinute: 20, penalty: '1-hour block; requests during the block restart it' },
  'openlibrary.org': { perSecond: 1, perSecondWithUa: 3, note: 'docs: not intended as a backend for third-party services — cache, do not live-proxy' },
  'query.wikidata.org': { queryTimeoutSec: 60 },
  'api.wikitree.com': { note: 'no published number; always send appId' },
  'catalog.hathitrust.org': { perSecond: 1, maxIdsPerRequest: 20 },
};

async function getJson(url, { ua = UA_PROJECT, ms = 9000 } = {}) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const r = await _fetch(url, { headers: { 'User-Agent': ua, accept: 'application/json' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** WikiTree profile by ID ("Lincoln-25"). Private profiles return a stub, not an error — we null those. */
export async function wikitreeProfile(id) {
  if (!id) return null;
  const f = 'Id,Name,FirstName,LastNameAtBirth,LastNameCurrent,BirthDate,BirthLocation,DeathDate,DeathLocation,Father,Mother';
  const j = await getJson(`https://api.wikitree.com/api.php?action=getProfile&key=${encodeURIComponent(id)}&fields=${f}&appId=${WIKITREE_APP_ID}`);
  const p = Array.isArray(j) ? j[0]?.profile : null;
  if (!p || !p.Name) return null;
  return { source: 'WikiTree', id: p.Name,
    name: [p.FirstName, p.LastNameAtBirth || p.LastNameCurrent].filter(Boolean).join(' ') || null,
    birthDate: p.BirthDate || null, birthPlace: p.BirthLocation || null,
    deathDate: p.DeathDate || null, deathPlace: p.DeathLocation || null,
    fatherId: p.Father || null, motherId: p.Mother || null,
    url: `https://www.wikitree.com/wiki/${p.Name}` };
}

/** ⭐ Surname + birth-place search. This is the query that finds a family in a State. */
export async function wikitreeSearch(lastName, { birthLocation = '', firstName = '', limit = 20 } = {}) {
  if (!lastName) return { total: 0, matches: [] };
  const qs = new URLSearchParams({ action: 'searchPerson', LastName: lastName, limit: String(limit),
    fields: 'Id,Name,FirstName,LastNameAtBirth,BirthDate,BirthLocation,DeathDate', appId: WIKITREE_APP_ID });
  if (birthLocation) qs.set('BirthLocation', birthLocation);
  if (firstName) qs.set('FirstName', firstName);
  const j = await getJson(`https://api.wikitree.com/api.php?${qs}`);
  const r = Array.isArray(j) ? j[0] : null;
  if (!r) return { total: 0, matches: [] };
  return { total: r.total ?? 0, source: 'WikiTree',
    matches: (r.matches || []).map(m => ({ id: m.Name, name: [m.FirstName, m.LastNameAtBirth].filter(Boolean).join(' ') || null,
      birthDate: m.BirthDate || null, birthPlace: m.BirthLocation || null, deathDate: m.DeathDate || null,
      url: m.Name ? `https://www.wikitree.com/wiki/${m.Name}` : null })) };
}

/** Ancestors via getPeople. NOTE: action=getAncestors is DEPRECATED and returns empty stubs. */
export async function wikitreeAncestors(id, depth = 4) {
  if (!id) return [];
  const qs = new URLSearchParams({ action: 'getPeople', keys: id, ancestors: String(depth),
    fields: 'Id,Name,FirstName,LastNameAtBirth,BirthDate,BirthLocation', appId: WIKITREE_APP_ID });
  const j = await getJson(`https://api.wikitree.com/api.php?${qs}`);
  const people = Array.isArray(j) ? j[0]?.people : null;
  if (!people || typeof people !== 'object') return [];
  return Object.values(people).filter(p => p && p.Name).map(p => ({
    id: p.Name, name: [p.FirstName, p.LastNameAtBirth].filter(Boolean).join(' ') || null,
    birthDate: p.BirthDate || null, birthPlace: p.BirthLocation || null,
    url: `https://www.wikitree.com/wiki/${p.Name}` }));
}

/**
 * Chronicling America newspapers.
 * ⚠️ The legacy chroniclingamerica.loc.gov/search/pages/results/?format=json endpoint was RETIRED in
 * 2025 and now 308-redirects to a 404. Everything goes through the loc.gov API, which needs a
 * browser User-Agent and honours &at=results to trim the payload.
 */
export async function newspaperSearch(term, { rows = 10 } = {}) {
  if (!term) return [];
  const qs = new URLSearchParams({ qs: term, fo: 'json', c: String(rows), at: 'results' });
  const j = await getJson(`https://www.loc.gov/collections/chronicling-america/?${qs}`, { ua: UA_BROWSER });
  return (j?.results || []).map(r => ({ source: 'Chronicling America (loc.gov)',
    title: Array.isArray(r.title) ? r.title[0] : r.title || null, date: r.date || null,
    contributor: (r.contributor || [])[0] || null, url: r.id || null,
    image: (r.image_url || [])[0] || null,
    rights: r.rights || r.rights_advisory || null }));   // carry rights through — LoC does not own most of it
}

/**
 * ⭐ NARA 1950 Census — keyless, undocumented, live. Names are raw OCR of handwritten schedules and
 * are NOISY, so fuzzy-match downstream. `state` MUST be the two-letter code: state=TX works, state=Texas
 * returns zero.
 */
export async function census1950(name, { state = '', county = '', page = 1 } = {}) {
  if (!name) return { total: 0, results: [] };
  const qs = new URLSearchParams({ name, page: String(page) });
  if (state) qs.set('state', state.length === 2 ? state.toUpperCase() : state);
  if (county && state) qs.set('county', county);
  const j = await getJson(`https://1950census.archives.gov/api/search/?${qs}`);
  if (!j) return { total: 0, results: [] };
  return { source: 'NARA 1950 Census', total: j.total ?? 0,
    results: (j.results || []).map(r => ({ scheduleId: r.scheduleId || null, state: r.state || null,
      county: r.county || null, ed: r.ed || null, names: (r.names || []).map(n => n.name).filter(Boolean),
      url: r.scheduleId ? `https://1950census.archives.gov/search/?ed=${encodeURIComponent(r.ed || '')}` : null })) };
}

/** Published county and family histories. Cache these — Open Library asks not to be a live backend. */
export async function bookSearch(q, { limit = 10 } = {}) {
  if (!q) return [];
  const qs = new URLSearchParams({ q, limit: String(limit), fields: 'title,author_name,first_publish_year,ia,key' });
  const j = await getJson(`https://openlibrary.org/search.json?${qs}`);
  return (j?.docs || []).map(d => ({ source: 'Open Library', title: d.title || null,
    author: (d.author_name || [])[0] || null, year: d.first_publish_year || null,
    scan: (d.ia || [])[0] ? `https://archive.org/details/${d.ia[0]}` : null,
    url: d.key ? `https://openlibrary.org${d.key}` : null }));
}

/** Wikidata SPARQL. Needs a DESCRIPTIVE User-Agent; a browser UA is rejected. 60s query ceiling. */
export async function wikidataQuery(sparql) {
  if (!sparql) return [];
  const u = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const j = await getJson(u, { ua: UA_PROJECT, ms: 20000 });
  return (j?.results?.bindings || []).map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

/** Parents/children of a Wikidata entity. P22 father, P25 mother, P40 child. Notable people only. */
export function familySparql(qid, prop = 'P40') {
  return `SELECT ?pLabel ?dob WHERE { wd:${qid} wdt:${prop} ?p . OPTIONAL { ?p wdt:P569 ?dob } ` +
         `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
}

// ── GENETICS ────────────────────────────────────────────────────────────────────────────────────
// Genealogy answers "who were my people"; genetics answers "where did they come from and what did
// they carry." Both layers are keyless here. Ensembl and NCBI E-utilities need no key; gnomAD is an
// open GraphQL endpoint. Nothing here is a clinical tool and nothing here interprets a person's own
// DNA file — we resolve public reference data and link out.

/**
 * Y-DNA and mtDNA haplogroup reference. The backbone letters only — the full ISOGG/YFull trees run to
 * tens of thousands of subclades and are their own projects. This is the orientation layer.
 */
export const HAPLOGROUPS = {
  'Y-DNA (paternal line)': [
    ['A', '~275,000 ya', 'Africa', 'Deepest-rooting branch; highest diversity in southern/central Africa'],
    ['B', '~130,000 ya', 'Africa', 'Widespread in central African populations'],
    ['E', '~65,000 ya', 'Africa / Mediterranean', 'E-M215/E-M35 carried into the Levant and Europe; E-V38 dominant in West Africa'],
    ['C', '~50,000 ya', 'Asia / Oceania / Americas', 'Early coastal dispersal; present in Indigenous American and Australian populations'],
    ['D', '~50,000 ya', 'Tibet / Japan / Andamans', 'Relict distribution'],
    ['G', '~48,000 ya', 'Caucasus / Near East', 'Associated with the Neolithic farming expansion'],
    ['H', '~45,000 ya', 'South Asia', 'Common on the Indian subcontinent'],
    ['I', '~43,000 ya', 'Europe', 'The main palaeolithic European paternal lineage'],
    ['J', '~42,000 ya', 'Near East / Arabia', 'J1 Semitic-associated; J2 Fertile Crescent/Mediterranean'],
    ['L', '~30,000 ya', 'South Asia / Near East', ''],
    ['N', '~36,000 ya', 'Siberia / Finno-Ugric', ''],
    ['O', '~35,000 ya', 'East / Southeast Asia', 'The majority East Asian lineage'],
    ['Q', '~32,000 ya', 'Siberia / Americas', 'Q-M3 is the principal Indigenous American paternal lineage'],
    ['R', '~27,000 ya', 'Eurasia', 'R1b dominant in western Europe; R1a in eastern Europe and South Asia'],
    ['T', '~25,000 ya', 'Near East / Africa / Europe', ''],
  ],
  'mtDNA (maternal line)': [
    ['L0', '~150,000 ya', 'Southern Africa', 'Deepest branch of the human mtDNA tree'],
    ['L1 / L2 / L3', '~120,000–70,000 ya', 'Africa', 'L3 is the ancestor of every non-African lineage'],
    ['M', '~60,000 ya', 'Asia', 'Out-of-Africa founder; ancestral to many Asian/American branches'],
    ['N', '~60,000 ya', 'Eurasia', 'The other out-of-Africa founder'],
    ['R', '~55,000 ya', 'Eurasia', 'Descends from N; ancestral to most European lineages'],
    ['H', '~25,000 ya', 'Europe', 'Roughly 40% of modern Europeans'],
    ['U', '~50,000 ya', 'Europe / Near East', 'U5 is the oldest European maternal lineage'],
    ['J / T', '~45,000 ya', 'Near East / Europe', 'Associated with Neolithic expansion'],
    ['A / B / C / D / X', '—', 'Americas', 'The five founding Indigenous American maternal haplogroups'],
  ],
};

export const GENETIC_SOURCES = {
  'Reference genomes & variants (keyless APIs)': [
    ['Ensembl REST', 'https://rest.ensembl.org/', 'Genes, transcripts, variants, populations — no key'],
    ['NCBI E-utilities', 'https://www.ncbi.nlm.nih.gov/books/NBK25501/', 'dbSNP, ClinVar, Gene, PubMed — no key (10 req/s with one)'],
    ['gnomAD', 'https://gnomad.broadinstitute.org/', 'Population allele frequencies; open GraphQL'],
    ['1000 Genomes', 'https://www.internationalgenome.org/', 'Open reference panel across 26 populations'],
  ],
  'Haplogroup trees': [
    ['ISOGG Y-Tree', 'https://isogg.org/tree/', 'The long-running community Y-DNA phylogeny'],
    ['YFull YTree', 'https://www.yfull.com/tree/', 'Y-tree with age estimates from full sequences'],
    ['PhyloTree mtDNA', 'https://www.phylotree.org/', 'The reference mtDNA phylogeny (van Oven)'],
    ['FamilyTreeDNA public trees', 'https://www.familytreedna.com/public/', 'Surname and haplogroup projects'],
  ],
  'Ancient DNA': [
    ['AADR (Allen Ancient DNA Resource)', 'https://reich.hms.harvard.edu/allen-ancient-dna-resource-aadr-downloadable-genotypes-present-day-and-ancient-dna-data', 'The standard compiled ancient-genotype dataset'],
    ['AmtDB', 'https://amtdb.org/', 'Ancient human mitochondrial genomes'],
  ],
};

/** Ensembl gene lookup by symbol. Keyless. Soft-fails to null. */
export async function ensemblGene(symbol, species = 'homo_sapiens') {
  if (!symbol) return null;
  const j = await getJson(`https://rest.ensembl.org/lookup/symbol/${encodeURIComponent(species)}/${encodeURIComponent(symbol)}?expand=0`);
  if (!j || !j.id) return null;
  return { source: 'Ensembl', id: j.id, symbol: j.display_name || symbol, description: j.description || null,
    chromosome: j.seq_region_name || null, start: j.start ?? null, end: j.end ?? null,
    strand: j.strand ?? null, biotype: j.biotype || null, assembly: j.assembly_name || null,
    url: `https://www.ensembl.org/${species}/Gene/Summary?g=${j.id}` };
}

/** Ensembl variant lookup by rsID, with 1000 Genomes population frequencies where present. */
export async function ensemblVariant(rsid, species = 'homo_sapiens') {
  if (!rsid) return null;
  const j = await getJson(`https://rest.ensembl.org/variation/${encodeURIComponent(species)}/${encodeURIComponent(rsid)}?pops=1`);
  if (!j || !j.name) return null;
  const pops = (j.populations || []).filter(p => /1000GENOMES/.test(p.population || ''))
    .map(p => ({ population: p.population, allele: p.allele, frequency: p.frequency }));
  return { source: 'Ensembl', id: j.name, alleles: j.mappings?.[0]?.allele_string || null,
    consequence: j.most_severe_consequence || null, synonyms: (j.synonyms || []).slice(0, 5),
    populations: pops.slice(0, 40),
    url: `https://www.ensembl.org/Homo_sapiens/Variation/Explore?v=${encodeURIComponent(j.name)}` };
}

/** NCBI E-utilities search. db = 'snp' | 'clinvar' | 'gene' | 'pubmed'. Keyless: be polite, <=3 req/s. */
export async function ncbiSearch(db, term, { retmax = 10 } = {}) {
  if (!db || !term) return { total: 0, ids: [] };
  const qs = new URLSearchParams({ db, term, retmode: 'json', retmax: String(retmax), tool: 'MELEK-genealogy', email: 'guru@soapbox.community' });
  const j = await getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${qs}`);
  const r = j?.esearchresult;
  if (!r) return { total: 0, ids: [] };
  return { source: `NCBI ${db}`, total: +(r.count || 0), ids: r.idlist || [],
    url: `https://www.ncbi.nlm.nih.gov/${db}/?term=${encodeURIComponent(term)}` };
}

// ── DEEP TIME: SPECIMENS, TAXA, ANCIENT DNA ─────────────────────────────────────────────────────
// The same question — "what descended from what" — asked of plants, animals and the dead. Every
// endpoint below is keyless. Museums hold the specimens; GBIF and iDigBio index them; Open Tree of
// Life holds the phylogeny; PBDB holds the fossils; BOLD holds the barcode markers.

export const DEEP_TIME_SOURCES = {
  'Specimens & museum collections': [
    ['GBIF', 'https://www.gbif.org/', '3bn+ occurrence records from ~2,000 institutions; keyless API'],
    ['iDigBio', 'https://www.idigbio.org/', 'US natural-history specimen records + media; keyless'],
    ['Metropolitan Museum of Art', 'https://metmuseum.github.io/', 'Full collection API, keyless, CC0 images'],
    ['Smithsonian Open Access', 'https://www.si.edu/openaccess', '4.5M+ CC0 items — API needs a free key'],
    ['Natural History Museum (London)', 'https://data.nhm.ac.uk/', 'Specimen portal incl. type specimens'],
  ],
  'Phylogeny & taxonomy': [
    ['Open Tree of Life', 'https://tree.opentreeoflife.org/', 'Synthetic tree of ~2.3M tips; keyless API'],
    ['NCBI Taxonomy', 'https://www.ncbi.nlm.nih.gov/taxonomy', 'The naming backbone genomics runs on'],
    ['Catalogue of Life', 'https://www.catalogueoflife.org/', 'Consensus global species list'],
    ['Plants of the World Online (Kew)', 'https://powo.science.kew.org/', 'Accepted plant names and distributions'],
  ],
  'Genetic markers': [
    ['BOLD Systems', 'https://www.boldsystems.org/', 'DNA barcodes — COI for animals, rbcL/matK for plants'],
    ['Ensembl Genomes', 'https://ensemblgenomes.org/', 'Plants, metazoa, fungi, protists, bacteria'],
    ['Dog10K', 'https://dog10kgenomes.org/', 'Canine reference genomes across breeds and wild canids'],
  ],
  'Fossils & ancient DNA': [
    ['Paleobiology Database', 'https://paleobiodb.org/', 'Fossil occurrences with age and locality; keyless'],
    ['AADR (Reich Lab)', 'https://reich.hms.harvard.edu/', 'The standard compiled ancient-genotype dataset'],
    ['AmtDB', 'https://amtdb.org/', 'Ancient human mitochondrial genomes'],
  ],
};

/** GBIF species match — resolves a name to the taxonomic backbone. Keyless. */
export async function gbifSpecies(name) {
  if (!name) return null;
  const j = await getJson(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`);
  if (!j || j.matchType === 'NONE') return null;
  return { source: 'GBIF', key: j.usageKey ?? null, scientificName: j.scientificName || null,
    rank: j.rank || null, status: j.status || null, confidence: j.confidence ?? null,
    kingdom: j.kingdom || null, phylum: j.phylum || null, class: j.class || null,
    order: j.order || null, family: j.family || null, genus: j.genus || null,
    url: j.usageKey ? `https://www.gbif.org/species/${j.usageKey}` : null };
}

/** ⭐ GBIF occurrences — where actual physical specimens are held, and by whom. */
export async function gbifOccurrences(taxonKey, { country = '', limit = 20, preservedOnly = true } = {}) {
  if (!taxonKey) return { total: 0, records: [] };
  const qs = new URLSearchParams({ taxonKey: String(taxonKey), limit: String(limit) });
  if (country) qs.set('country', country);
  if (preservedOnly) qs.set('basisOfRecord', 'PRESERVED_SPECIMEN');
  const j = await getJson(`https://api.gbif.org/v1/occurrence/search?${qs}`);
  if (!j) return { total: 0, records: [] };
  return { source: 'GBIF', total: j.count ?? 0,
    records: (j.results || []).map(r => ({ institution: r.institutionCode || r.publishingOrgKey || null,
      collection: r.collectionCode || null, catalogNumber: r.catalogNumber || null,
      scientificName: r.scientificName || null, country: r.country || null,
      locality: r.locality || null, year: r.year ?? null, recordedBy: r.recordedBy || null,
      basisOfRecord: r.basisOfRecord || null,
      url: r.key ? `https://www.gbif.org/occurrence/${r.key}` : null })) };
}

/** Open Tree of Life — resolve a name to a tree node. Keyless POST. */
export async function otolMatch(names) {
  const list = Array.isArray(names) ? names : [names];
  if (!list.length) return [];
  try {
    const r = await _fetch('https://api.opentreeoflife.org/v3/tnrs/match_names', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA_PROJECT },
      body: JSON.stringify({ names: list }),
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    return (j.results || []).flatMap(res => (res.matches || []).slice(0, 1).map(m => ({
      source: 'Open Tree of Life', searched: res.name, matchedName: m.taxon?.name || null,
      ottId: m.taxon?.ott_id ?? null, rank: m.taxon?.rank || null,
      lineage: (m.taxon?.tax_sources || []).slice(0, 4),
      url: m.taxon?.ott_id ? `https://tree.opentreeoflife.org/taxonomy/browse?id=${m.taxon.ott_id}` : null })));
  } catch { return []; }
}

/** Paleobiology Database — fossil occurrences for a taxon, with age. Keyless. */
export async function fossilOccurrences(taxon, { limit = 20 } = {}) {
  if (!taxon) return { total: 0, records: [] };
  const qs = new URLSearchParams({ base_name: taxon, show: 'coords,attr,loc,time', limit: String(limit) });
  const j = await getJson(`https://paleobiodb.org/data1.2/occs/list.json?${qs}`);
  if (!j) return { total: 0, records: [] };
  return { source: 'Paleobiology Database', total: (j.records || []).length,
    records: (j.records || []).map(r => ({ name: r.tna || null, earlyAgeMa: r.eag ?? null, lateAgeMa: r.lag ?? null,
      country: r.cc2 || null, state: r.stp || null, formation: r.sfm || null,
      lat: r.lat ?? null, lng: r.lng ?? null })) };
}

/** Metropolitan Museum of Art — keyless, CC0 images. Museums layer for the historical side. */
export async function metMuseumSearch(q, { limit = 12 } = {}) {
  if (!q) return { total: 0, objects: [] };
  const s = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(q)}&hasImages=true`);
  const ids = (s?.objectIDs || []).slice(0, limit);
  const objects = [];
  for (const id of ids) {
    const o = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
    if (!o) continue;
    objects.push({ source: 'The Met', id: o.objectID, title: o.title || null, date: o.objectDate || null,
      culture: o.culture || null, medium: o.medium || null, department: o.department || null,
      creditLine: o.creditLine || null, isPublicDomain: !!o.isPublicDomain,
      image: o.primaryImageSmall || null, url: o.objectURL || null });
  }
  return { source: 'The Met', total: s?.total ?? 0, objects };
}

/** NCBI Taxonomy lineage by name. Keyless. */
export async function ncbiTaxonomy(name) {
  if (!name) return null;
  const s = await ncbiSearch('taxonomy', name, { retmax: 1 });
  const id = (s.ids || [])[0];
  if (!id) return null;
  const qs = new URLSearchParams({ db: 'taxonomy', id, retmode: 'json', tool: 'MELEK-genealogy', email: 'guru@soapbox.community' });
  const j = await getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${qs}`);
  const r = j?.result?.[id];
  if (!r) return null;
  return { source: 'NCBI Taxonomy', taxId: id, scientificName: r.scientificname || null,
    rank: r.rank || null, division: r.division || null, commonName: r.commonname || null,
    lineage: r.lineage ? String(r.lineage).split(';').map(x => x.trim()) : [],
    url: `https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=${id}` };
}

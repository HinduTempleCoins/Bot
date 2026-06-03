// biodiversity.mjs — the SoapBox Bio vertical (queue task #110). Keyless-first life-sciences data:
//   - GBIF (Global Biodiversity Information Facility) — the backbone. Keyless. Species name backbone
//     + occurrence records. https://api.gbif.org/v1
//   - iNaturalist — community observations (photos, geotags). Keyless. https://api.inaturalist.org/v1
//   - eBird (Cornell Lab) — bird sightings. Needs a free token; reads process.env.EBIRD_API_KEY and
//     SOFT-FAILS (returns []) if absent. https://api.ebird.org/v2
//
// Every call soft-fails (never throws): a dead source returns [] / null, never an exception, so the
// Bio tab degrades gracefully. Follows the macro.mjs shape: ESM, __setFetch hook, CLI guard.
//
//   import { speciesSearch, occurrences, observations, speciesProfile } from './biodiversity.mjs'
//   node integrations/soapbox/biodiversity.mjs "Panthera leo"

const UA = { 'User-Agent': 'SoapBoxBio/1.0 (+https://data.soapbox.community)' };
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// small soft-fail JSON helper — any network/parse failure becomes null, never a throw.
async function getJSON(url, headers = UA) {
  try {
    const r = await _fetch(url, { headers });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ---- GBIF: species name backbone search (the backbone) -------------------------------------------
// Normalizes the GBIF species-search payload into stable rows the Bio tab renders.
export function normalizeSpecies(results) {
  return (Array.isArray(results) ? results : [])
    .map((s) => s && (s.key || s.usageKey || s.nubKey || s.scientificName) ? {
      key: s.key || s.usageKey || s.nubKey || null,
      scientificName: s.scientificName || s.canonicalName || s.species || '',
      canonicalName: s.canonicalName || s.species || '',
      rank: s.rank || '',
      kingdom: s.kingdom || '',
      phylum: s.phylum || '',
      class: s.class || '',
      order: s.order || '',
      family: s.family || '',
      genus: s.genus || '',
      status: s.taxonomicStatus || s.status || '',
      source: 'GBIF',
    } : null)
    .filter(Boolean);
}

/** Search the GBIF taxonomic backbone for a name. Returns normalized species rows (never throws). */
export async function speciesSearch(q, { limit = 20 } = {}) {
  const term = String(q || '').trim();
  if (!term) return [];
  const u = `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(term)}&limit=${limit}`;
  const j = await getJSON(u);
  return normalizeSpecies(j?.results);
}

// ---- GBIF: occurrence records --------------------------------------------------------------------
export function normalizeOccurrences(results) {
  return (Array.isArray(results) ? results : [])
    .map((o) => o ? {
      key: o.key || o.gbifID || null,
      scientificName: o.scientificName || o.species || '',
      country: o.country || o.countryCode || '',
      locality: o.locality || o.stateProvince || '',
      lat: o.decimalLatitude ?? null,
      lon: o.decimalLongitude ?? null,
      date: o.eventDate || o.year || '',
      basis: o.basisOfRecord || '',
      dataset: o.datasetName || o.publishingOrgKey || '',
      source: 'GBIF',
    } : null)
    .filter((x) => x && (x.key || x.scientificName));
}

/** GBIF occurrence records for a taxon (name or numeric taxonKey), optionally filtered by country. */
export async function occurrences({ taxon, country, limit = 20 } = {}) {
  const t = taxon == null ? '' : String(taxon).trim();
  if (!t) return [];
  const params = new URLSearchParams();
  // numeric → taxonKey; otherwise a free-text scientificName filter.
  if (/^\d+$/.test(t)) params.set('taxonKey', t);
  else params.set('scientificName', t);
  if (country) params.set('country', String(country).trim().toUpperCase());
  params.set('limit', String(limit));
  const u = `https://api.gbif.org/v1/occurrence/search?${params.toString()}`;
  const j = await getJSON(u);
  return normalizeOccurrences(j?.results);
}

// ---- iNaturalist: community observations ---------------------------------------------------------
export function normalizeObservations(results) {
  return (Array.isArray(results) ? results : [])
    .map((o) => {
      if (!o) return null;
      const t = o.taxon || {};
      return {
        id: o.id || null,
        scientificName: t.name || '',
        commonName: t.preferred_common_name || '',
        place: o.place_guess || '',
        observedOn: o.observed_on || o.time_observed_at || '',
        user: o.user?.login || '',
        quality: o.quality_grade || '',
        photo: o.photos?.[0]?.url || t.default_photo?.square_url || null,
        url: o.uri || (o.id ? `https://www.inaturalist.org/observations/${o.id}` : ''),
        source: 'iNaturalist',
      };
    })
    .filter((x) => x && (x.id || x.scientificName));
}

/** iNaturalist observations for a taxon name. Verifiable-grade preferred. Never throws. */
export async function observations({ taxon, limit = 20 } = {}) {
  const t = taxon == null ? '' : String(taxon).trim();
  if (!t) return [];
  const u = `https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(t)}&per_page=${limit}&order=desc&order_by=created_at`;
  const j = await getJSON(u);
  return normalizeObservations(j?.results);
}

// ---- eBird: bird sightings (needs free token; soft-fails if absent) ------------------------------
export function normalizeEbird(results) {
  return (Array.isArray(results) ? results : [])
    .map((s) => s ? {
      scientificName: s.sciName || '',
      commonName: s.comName || '',
      count: s.howMany ?? null,
      location: s.locName || '',
      lat: s.lat ?? null,
      lon: s.lng ?? null,
      date: s.obsDt || '',
      source: 'eBird',
    } : null)
    .filter((x) => x && (x.scientificName || x.commonName));
}

/**
 * Recent eBird sightings in a region. Requires EBIRD_API_KEY (free) — returns [] if the key is
 * missing so the rest of the Bio vertical keeps working. region defaults to a wide one.
 */
export async function ebirdRecent({ region = 'US', limit = 20 } = {}) {
  const key = process.env.EBIRD_API_KEY;
  if (!key) return []; // soft-fail: no key, no birds, no crash
  const u = `https://api.ebird.org/v2/data/obs/${encodeURIComponent(region)}/recent?maxResults=${limit}`;
  const j = await getJSON(u, { ...UA, 'X-eBirdApiToken': key });
  return normalizeEbird(j);
}

// ---- combined profile ----------------------------------------------------------------------------
/**
 * One combined profile for a species name: the best GBIF taxonomy match + GBIF occurrences +
 * iNaturalist observations (+ eBird recent if a key is present and the taxon is a bird). Every
 * sub-source is independently soft-failed, so a partial profile still returns.
 */
export async function speciesProfile(name) {
  const term = String(name || '').trim();
  if (!term) return null;

  const species = await speciesSearch(term, { limit: 5 });
  const best = species[0] || null;
  // prefer the GBIF key for precise occurrence lookup; fall back to the name.
  const taxon = best?.key || term;

  const [occ, obs] = await Promise.all([
    occurrences({ taxon, limit: 20 }).catch(() => []),
    observations({ taxon: best?.scientificName || term, limit: 20 }).catch(() => []),
  ]);

  // only bother with eBird when this looks like a bird (GBIF class Aves) — and only if a key exists.
  let birds = [];
  if (best?.class && /aves/i.test(best.class)) {
    birds = await ebirdRecent({ limit: 10 }).catch(() => []);
  }

  return {
    query: term,
    taxonomy: best,
    matches: species,
    occurrences: occ,
    observations: obs,
    birds,
    sources: ['GBIF', 'iNaturalist', ...(birds.length ? ['eBird'] : [])],
  };
}

if (process.argv[1] && process.argv[1].endsWith('biodiversity.mjs')) {
  const name = process.argv.slice(2).join(' ') || 'Panthera leo';
  const p = await speciesProfile(name).catch((e) => ({ error: e.message }));
  if (!p || p.error) { console.error(p?.error || 'no result'); process.exit(1); }
  console.log(`\n${p.query}`);
  if (p.taxonomy) console.log(`  ${p.taxonomy.scientificName} (${p.taxonomy.rank}) — ${[p.taxonomy.kingdom, p.taxonomy.family].filter(Boolean).join(' / ')}  [GBIF ${p.taxonomy.key}]`);
  console.log(`  matches: ${p.matches.length} · occurrences: ${p.occurrences.length} · observations: ${p.observations.length} · birds: ${p.birds.length}`);
  console.log(`  sources: ${p.sources.join(', ')}`);
}

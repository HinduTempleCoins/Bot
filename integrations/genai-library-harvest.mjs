// genai-library-harvest.mjs — compiles OUR OWN library from the free/open sources: fuses the
// asset-library engine (API sources: Poly Haven, ambientCG, museum CC0) with the Resource Center
// scraper (scraper.mjs → clean markdown for sources without an API). Writes a single provenance-tagged,
// license-bucketed LIBRARY INDEX so downstream (mint/product/reference) knows what each asset may be used
// for. Bulk BINARY download is a separate, throttled job; this builds the INDEX (light, fast, safe).
//
// "Use the Scraper Resource Center where you can" (operator): API where an API exists (cleaner), the
// scraper (scraper.mjs) where it doesn't. No GPU, no paid service. Injectable deps → offline-testable.
//
//   import { harvestIndex } from './genai-library-harvest.mjs'
//   node integrations/genai-library-harvest.mjs          # run a bounded pass, write the index
//   node integrations/genai-library-harvest.mjs --out /path/library-index.json

import { harvestPolyHaven, harvestAmbientCG, SOURCES, licenseBucket } from './genai-asset-library.mjs';

// inject the scraper (Resource Center) + a writer for tests
let _fetchClean = null;
async function scraper() {
  if (_fetchClean) return _fetchClean;
  try { const m = await import('./scraper.mjs'); _fetchClean = m.fetchClean; } catch { _fetchClean = null; }
  return _fetchClean;
}
export function __setScraper(fn) { _fetchClean = fn; }

// reference pages worth scraping into the knowledge side of the library (no API / provenance context).
export const SCRAPE_REFS = [
  'https://www.rijksmuseum.nl/en/rijksstudio', // CC0 program page
  'https://www.si.edu/openaccess',             // Smithsonian OA (CC0) program
  'https://polyhaven.com/license',             // CC0 license confirmation
];

export async function harvestIndex({ scrapeRefs = SCRAPE_REFS, limitPerType = 50 } = {}) {
  const index = { built: new Date().toISOString(), sources: [], assets: {}, refs: [], summary: {} };
  // 1) API asset sources (metadata only — ids + license bucket)
  const ph = { textures: await harvestPolyHaven('textures', limitPerType), hdris: await harvestPolyHaven('hdris', limitPerType), models: await harvestPolyHaven('models', limitPerType) };
  const acg = await harvestAmbientCG(limitPerType);
  index.assets.polyhaven = { license: 'CC0', bucket: 'A', textures: ph.textures.count || 0, hdris: ph.hdris.count || 0, models: ph.models.count || 0, sample: (ph.textures.ids || []).slice(0, 5) };
  index.assets.ambientcg = { license: 'CC0', bucket: 'A', count: acg.count || 0, sample: (acg.ids || []).slice(0, 5) };
  // 2) catalog the rest (from the asset-library) with buckets
  index.sources = SOURCES.map((s) => ({ id: s.id, media: s.media, license: s.license, bucket: licenseBucket(s.license), tier: s.tier, mintOK: licenseBucket(s.license) === 'A' }));
  // 3) Resource Center scraper for API-less reference pages
  const fc = await scraper();
  if (fc) {
    for (const url of scrapeRefs) {
      try { const r = await fc(url); index.refs.push({ url, title: r && r.title, chars: r && r.markdown ? r.markdown.length : 0, ok: !!(r && r.markdown) }); }
      catch (e) { index.refs.push({ url, ok: false, error: String(e && e.message).slice(0, 120) }); }
    }
  }
  // 4) summary
  const buckets = { A: 0, B: 0, C: 0 };
  for (const s of index.sources) buckets[s.bucket] += 1;
  index.summary = {
    apiAssetsCataloged: (index.assets.polyhaven.textures + index.assets.polyhaven.hdris + index.assets.polyhaven.models + index.assets.ambientcg.count),
    sources: index.sources.length, mintSafeSources: buckets.A, refsScraped: index.refs.filter((r) => r.ok).length,
  };
  return index;
}

if (process.argv[1] && process.argv[1].endsWith('genai-library-harvest.mjs')) {
  const outArg = process.argv.indexOf('--out');
  const out = outArg > -1 ? process.argv[outArg + 1] : null;
  const idx = await harvestIndex();
  if (out) { const fs = await import('node:fs'); fs.writeFileSync(out, JSON.stringify(idx, null, 2)); console.log('wrote', out); }
  console.log('LIBRARY INDEX:', JSON.stringify(idx.summary, null, 2));
  console.log('assets:', JSON.stringify(idx.assets, null, 2));
  console.log('refs:', JSON.stringify(idx.refs, null, 2));
}

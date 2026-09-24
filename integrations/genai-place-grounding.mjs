// genai-place-grounding.mjs — Hathor REASONS about a place before drawing it. Given a location in a
// GenAI prompt (e.g., "North Texas"), it pulls REAL data — geocode (OSM/Nominatim), climate (Open-Meteo),
// facts (Wikidata), and, when available, demographics/cost-of-living from our own modules (local-business
// -intel / coliving) — then translates that into VISUAL cues (terrain, vegetation, architecture, sky,
// season, the people) so the generated scene is grounded, not generic. All keyless, CPU, soft-fail.
//
//   import { groundPlace, enrichPrompt } from './genai-place-grounding.mjs'
//   const g = await groundPlace('North Texas')      // { geo, climate, facts, visualBrief }
//   const p = await enrichPrompt('a market scene in North Texas', 'North Texas')

import { defaultSkyFor, skyCue } from './genai-sky.mjs';
let _fetch = (...a) => fetch(...a);
export function __setFetch(f) { _fetch = f || ((...a) => fetch(...a)); }
const j = async (url, opts) => { try { const r = await _fetch(url, { headers: { 'user-agent': 'MELEK-Bot/1.0' }, ...opts }); return r && r.ok ? await r.json() : null; } catch { return null; } };

async function geocode(place) {
  const d = await j(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1&addressdetails=1`);
  if (!d || !d[0]) return null;
  const a = d[0].address || {};
  return { lat: +d[0].lat, lon: +d[0].lon, display: d[0].display_name, country: a.country, state: a.state, region: a.region };
}
async function climate(lat, lon) {
  const d = await j(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
  const t = d && d.current_weather ? d.current_weather.temperature : null;
  const month = new Date().getMonth(); const north = lat >= 0;
  const season = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][north ? month : (month + 6) % 12];
  const band = t == null ? null : t >= 30 ? 'hot' : t >= 18 ? 'warm' : t >= 5 ? 'cool' : 'cold';
  return { tempC: t, season, band };
}
async function facts(place) {
  const d = await j(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(place)}`);
  return d && d.extract ? d.extract.slice(0, 400) : null;
}

// REFERENCE IMAGES (not just words): real CC0/Commons photos of the place/subject, so generation can be
// MODELED on actual references (visual conditioning), not a text description. Keyless, free.
export async function referenceImagesFor(queryStr, n = 3) {
  const q = encodeURIComponent(queryStr);
  const d = await j(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=${n}&prop=imageinfo&iiprop=url|extmetadata&format=json`);
  const pages = d && d.query && d.query.pages ? Object.values(d.query.pages) : [];
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0];
    if (!ii || !ii.url || !/\.(jpe?g|png)(\?|$)/i.test(ii.url)) continue; // allow ?utm_… query strings
    const lic = ii.extmetadata && ii.extmetadata.LicenseShortName && ii.extmetadata.LicenseShortName.value;
    out.push({ url: ii.url.split('?')[0], title: p.title, license: lic || 'see Commons' });
  }
  return out;
}

// region → visual cues (extend freely). Keyed by substrings found in the display name / query.
const REGION_CUES = [
  { re: /(north|dallas|fort worth|denton).*tex|^north texas/i, cues: 'flat blackland prairie and big open sky, live oak and mesquite, brick ranch homes and suburban sprawl, the Dallas–Fort Worth skyline in the distance, pickup trucks, hot hazy light' },
  { re: /\btexas\b/i, cues: 'wide plains, mesquite and prairie grass, big sky, ranch and Spanish-mission architecture, strong warm sun' },
  { re: /egypt|cairo|nile/i, cues: 'desert and Nile greenery, sandstone, palms, ancient monuments, dry golden light' },
  { re: /desert|arizona|nevada|sahara/i, cues: 'arid desert, red rock and sand, sparse scrub and cacti, vast dry sky' },
  { re: /tropic|hawaii|caribbean|bali|thailand/i, cues: 'lush tropical foliage, palms, turquoise water, humid bright light' },
  { re: /alp|mountain|colorado|himalaya|andes/i, cues: 'rugged mountains, pine forest, thin crisp air, dramatic peaks' },
  { re: /new york|manhattan/i, cues: 'dense skyscrapers, yellow cabs, steam vents, gridded avenues' },
  { re: /paris|france/i, cues: 'Haussmann stone facades, zinc roofs, cafés, soft grey light' },
];
function regionCues(name) { const m = REGION_CUES.find((c) => c.re.test(name || '')); return m ? m.cues : null; }

export async function groundPlace(place, { withImages = false } = {}) {
  const geo = await geocode(place);
  const cl = geo ? await climate(geo.lat, geo.lon) : null;
  const fx = await facts(place);
  const referenceImages = withImages ? await referenceImagesFor(place, 3) : [];
  const name = (geo && geo.display) || place;
  const cues = regionCues(place) || regionCues(name);
  const bits = [];
  if (cues) bits.push(cues);
  if (cl && cl.season) bits.push(`${cl.band ? cl.band + ' ' : ''}${cl.season}${cl.tempC != null ? `, around ${Math.round(cl.tempC)}°C` : ''}`);
  if (geo && geo.state && !cues) bits.push(`${geo.state}${geo.country ? ', ' + geo.country : ''}`);
  bits.push(`sky: ${defaultSkyFor(place || name)}`); // default clouds for the place (North Texas prairie sky by default)
  const visualBrief = bits.join('; ');
  return { ok: !!(geo || cues), place, geo, climate: cl, facts: fx, visualBrief, referenceImages };
}

// Append the grounding to a prompt so the scene is accurate. `clouds` optionally overrides the default sky
// (e.g., 'pyrocumulus'). Either place or clouds is enough to enrich.
export async function enrichPrompt(prompt, place, clouds) {
  const cloud = clouds ? skyCue(clouds) : null;
  if (!place && !cloud) return { prompt, grounded: false };
  let brief = '';
  let g = null;
  if (place) { g = await groundPlace(place); if (g && g.visualBrief) brief = g.visualBrief; }
  if (cloud) brief = brief ? `${brief}; sky (requested): ${cloud}` : `sky: ${cloud}`;
  if (!brief) return { prompt, grounded: false, grounding: g };
  return { prompt: `${prompt} — grounded${place ? ` in ${place}` : ''}: ${brief}`, grounded: true, grounding: g };
}

if (process.argv[1] && process.argv[1].endsWith('genai-place-grounding.mjs')) {
  const place = process.argv.slice(2).join(' ') || 'North Texas';
  console.log(JSON.stringify(await groundPlace(place), null, 2));
}

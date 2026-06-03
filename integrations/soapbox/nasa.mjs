// nasa.mjs — the SoapBox NASA / space portal (queue task #81). Pulls from api.nasa.gov: the
// Astronomy Picture of the Day (APOD), near-Earth asteroids (NeoWs), Mars rover photos, space
// weather (DONKI — solar flares / geomagnetic storms / CMEs), and live natural events (EONET —
// wildfires, storms, volcanoes). All keyless-friendly: DEMO_KEY works out of the box (low rate
// limit); set NASA_API_KEY for production headroom. Everything soft-fails — a feeder hiccup or a
// non-OK response yields null / [] rather than throwing, so the portal degrades gracefully.
//
//   import { apod, nearEarthObjects, marsPhotos, spaceWeather, naturalEvents } from './nasa.mjs'
//   node integrations/soapbox/nasa.mjs
//
// Note: the key is read from the environment and is never printed or returned in any payload.

import { cached, TTL } from './cache.mjs';

const KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
const BASE = 'https://api.nasa.gov';
const EONET = 'https://eonet.gsfc.nasa.gov/api/v3';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// append api_key to a NASA URL (EONET needs no key). Kept here so the key never leaks into logs.
function withKey(url) {
  return url + (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(KEY);
}

async function getJson(url) {
  try {
    const r = await _fetch(url);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const yyyymmdd = (d) => new Date(d).toISOString().slice(0, 10);

// ── Astronomy Picture of the Day ────────────────────────────────────────────
/** Today's APOD, normalized to a flat card. Images and videos both supported. Cached 1h. */
export async function apod() {
  return cached('nasa:apod', TTL.metadata, async () => {
    const j = await getJson(withKey(`${BASE}/planetary/apod`));
    if (!j || !j.url) return null;
    return {
      title: j.title || 'Astronomy Picture of the Day',
      date: j.date || null,
      explanation: j.explanation || '',
      mediaType: j.media_type || 'image',
      url: j.url,
      hdUrl: j.hdurl || null,
      copyright: j.copyright ? j.copyright.trim() : null,
    };
  });
}

// ── Near-Earth Objects (NeoWs) ──────────────────────────────────────────────
function normalizeNeo(n) {
  const approach = (n.close_approach_data && n.close_approach_data[0]) || {};
  const est = (n.estimated_diameter && n.estimated_diameter.meters) || {};
  return {
    id: n.id || null,
    name: (n.name || '').replace(/^\(|\)$/g, '').trim() || n.name || 'Unknown',
    hazardous: !!n.is_potentially_hazardous_asteroid,
    diameterMin: est.estimated_diameter_min != null ? Math.round(est.estimated_diameter_min) : null,
    diameterMax: est.estimated_diameter_max != null ? Math.round(est.estimated_diameter_max) : null,
    closeApproach: approach.close_approach_date_full || approach.close_approach_date || null,
    missDistanceKm: approach.miss_distance ? Math.round(Number(approach.miss_distance.kilometers)) : null,
    velocityKph: approach.relative_velocity ? Math.round(Number(approach.relative_velocity.kilometers_per_hour)) : null,
    url: n.nasa_jpl_url || null,
  };
}

/** Asteroids with a close approach in the next `days`. Sorted nearest-miss first. Cached 1h. */
export async function nearEarthObjects({ days = 1 } = {}) {
  return cached(`nasa:neo:${days}`, TTL.metadata, async () => {
    const start = new Date();
    const end = new Date(Date.now() + Math.max(0, days - 1) * 86400000);
    const url = withKey(`${BASE}/neo/rest/v1/feed?start_date=${yyyymmdd(start)}&end_date=${yyyymmdd(end)}`);
    const j = await getJson(url);
    if (!j || !j.near_earth_objects) return { count: 0, hazardousCount: 0, objects: [] };
    const objects = Object.values(j.near_earth_objects).flat().map(normalizeNeo);
    objects.sort((a, b) => (a.missDistanceKm ?? Infinity) - (b.missDistanceKm ?? Infinity));
    return {
      count: objects.length,
      hazardousCount: objects.filter((o) => o.hazardous).length,
      objects,
    };
  });
}

// ── Mars rover photos ───────────────────────────────────────────────────────
/** Latest photos from a Mars rover (default Curiosity). Normalized to flat cards. Cached 1h. */
export async function marsPhotos({ rover = 'curiosity', limit = 12 } = {}) {
  return cached(`nasa:mars:${rover}:${limit}`, TTL.metadata, async () => {
    const url = withKey(`${BASE}/mars-photos/api/v1/rovers/${encodeURIComponent(rover)}/latest_photos`);
    const j = await getJson(url);
    const raw = (j && (j.latest_photos || j.photos)) || [];
    return raw.slice(0, limit).map((p) => ({
      id: p.id || null,
      img: p.img_src || null,
      earthDate: p.earth_date || null,
      sol: p.sol != null ? p.sol : null,
      camera: (p.camera && (p.camera.full_name || p.camera.name)) || null,
      rover: (p.rover && p.rover.name) || rover,
    })).filter((p) => p.img);
  });
}

// ── Space weather (DONKI) ───────────────────────────────────────────────────
/** Recent solar flares + geomagnetic storms over the last `days`. Cached 1h. */
export async function spaceWeather({ days = 7 } = {}) {
  return cached(`nasa:weather:${days}`, TTL.metadata, async () => {
    const start = yyyymmdd(new Date(Date.now() - Math.max(0, days) * 86400000));
    const end = yyyymmdd(new Date());
    const range = `startDate=${start}&endDate=${end}`;
    const [flr, gst] = await Promise.all([
      getJson(withKey(`${BASE}/DONKI/FLR?${range}`)),
      getJson(withKey(`${BASE}/DONKI/GST?${range}`)),
    ]);
    const flares = (Array.isArray(flr) ? flr : []).map((f) => ({
      class: f.classType || null,
      beginTime: f.beginTime || null,
      peakTime: f.peakTime || null,
      sourceLocation: f.sourceLocation || null,
      link: f.link || null,
    }));
    const storms = (Array.isArray(gst) ? gst : []).map((g) => {
      const kp = (g.allKpIndex || []).reduce((m, k) => Math.max(m, Number(k.kpIndex) || 0), 0);
      return { startTime: g.startTime || null, maxKp: kp || null, link: g.link || null };
    });
    return { flares, storms, flareCount: flares.length, stormCount: storms.length };
  });
}

// ── Natural events (EONET) ──────────────────────────────────────────────────
/** Open natural events from EONET (wildfires, storms, volcanoes…). No key needed. Cached 1h. */
export async function naturalEvents({ limit = 20, status = 'open' } = {}) {
  return cached(`nasa:eonet:${status}:${limit}`, TTL.metadata, async () => {
    const j = await getJson(`${EONET}/events?status=${encodeURIComponent(status)}&limit=${limit}`);
    const raw = (j && j.events) || [];
    return raw.map((e) => {
      const geo = (e.geometry && e.geometry[e.geometry.length - 1]) || {};
      const coords = Array.isArray(geo.coordinates) ? geo.coordinates : null;
      return {
        id: e.id || null,
        title: e.title || 'Untitled event',
        category: (e.categories && e.categories[0] && e.categories[0].title) || null,
        date: geo.date || null,
        coordinates: coords,
        closed: !!e.closed,
        link: (e.sources && e.sources[0] && e.sources[0].url) || e.link || null,
      };
    });
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('nasa.mjs')) {
  const pic = await apod();
  console.log('\nAPOD:', pic ? `${pic.title} (${pic.date}) — ${pic.url}` : '(unavailable)');

  const neo = await nearEarthObjects({ days: 1 });
  console.log(`\nNear-Earth objects today: ${neo.count} (${neo.hazardousCount} potentially hazardous)`);
  for (const o of neo.objects.slice(0, 5)) {
    console.log(`  ${o.name.padEnd(16)} ${o.missDistanceKm != null ? o.missDistanceKm.toLocaleString() + ' km' : '?'}${o.hazardous ? '  ⚠ hazardous' : ''}`);
  }

  const mars = await marsPhotos({ limit: 3 });
  console.log(`\nMars (${mars.length} latest photos):`);
  for (const p of mars) console.log(`  sol ${p.sol} ${p.camera || ''} — ${p.img}`);

  const sw = await spaceWeather({ days: 7 });
  console.log(`\nSpace weather (7d): ${sw.flareCount} flares, ${sw.stormCount} geomagnetic storms`);

  const events = await naturalEvents({ limit: 5 });
  console.log(`\nNatural events (${events.length}):`);
  for (const e of events) console.log(`  ${(e.category || '').padEnd(14)} ${e.title}`);
}

// brain-sky.mjs — Hathor's SKY lobe: identify what's overhead. Given a time + place she computes the real
// sky — Sun, Moon (+ phase), and the planets: where each is (altitude/azimuth), whether it's up, and which
// CONSTELLATION it sits in — plus rise/set times. Native + deterministic via `astronomy-engine` (pure JS,
// MIT, VSOP87/NOVAS, ±1 arcminute), ZERO API, ZERO model weights. This is the "what am I looking at"
// companion to the vision head (which coarse-IDs a sky photo by label); together they answer the sky.
//
// Lazy-loaded + soft-fail (house style): if the library is absent, methods return null/[]; never throws.
//
//   import { createSky } from './brain-sky.mjs';
//   const sky = createSky();
//   sky.whatsUp({ date: new Date(), lat: 40.7, lon: -74.0 });  // visible bodies + constellations
//   sky.moonPhase(new Date());                                  // { angle, name, illumination }

import { createRequire } from 'node:module';
import { STARS, getStar } from './star-catalog.mjs';

const DEG = Math.PI / 180;
/** Angular separation (degrees) between two alt/az directions. */
function angSep(a1, z1, a2, z2) {
  const c = Math.sin(a1 * DEG) * Math.sin(a2 * DEG) + Math.cos(a1 * DEG) * Math.cos(a2 * DEG) * Math.cos((z1 - z2) * DEG);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

const BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const PHASES = [
  [0, 'New Moon'], [45, 'Waxing Crescent'], [90, 'First Quarter'], [135, 'Waxing Gibbous'],
  [180, 'Full Moon'], [225, 'Waning Gibbous'], [270, 'Last Quarter'], [315, 'Waning Crescent'], [360, 'New Moon'],
];
export function phaseName(angle) {
  let best = 'New Moon', bd = 999;
  for (const [a, n] of PHASES) { const d = Math.abs(((angle - a + 540) % 360) - 180); if (d < bd) { bd = d; best = n; } }
  return best;
}

let _A = null, _tried = false;
function lib() {
  if (_tried) return _A;
  _tried = true;
  try { _A = createRequire(import.meta.url)('astronomy-engine'); } catch { _A = null; }
  return _A;
}

export function createSky() {
  return {
    available() { return !!lib(); },

    /** Moon phase for a date: { angle (0..360), name, illumination (0..1) }. */
    moonPhase(date = new Date()) {
      const A = lib(); if (!A) return null;
      try {
        const angle = A.MoonPhase(date);
        const ill = A.Illumination(A.Body.Moon, date);
        return { angle: Math.round(angle * 10) / 10, name: phaseName(angle), illumination: Math.round((ill.phase_fraction ?? 0) * 100) / 100 };
      } catch { return null; }
    },

    /** Every body: position (alt/az), visible (above horizon), constellation, magnitude. */
    positions({ date = new Date(), lat, lon, elevation = 0 } = {}) {
      const A = lib(); if (!A || typeof lat !== 'number' || typeof lon !== 'number') return [];
      let obs; try { obs = new A.Observer(lat, lon, elevation); } catch { return []; }
      const out = [];
      for (const name of BODIES) {
        try {
          const body = A.Body[name];
          const eq = A.Equator(body, date, obs, true, true);          // ra (hours), dec (deg)
          const hor = A.Horizon(date, obs, eq.ra, eq.dec, 'normal');  // altitude, azimuth
          let constellation = null;
          try { constellation = A.Constellation(eq.ra, eq.dec).name; } catch { /* ignore */ }
          let mag = null; try { mag = A.Illumination(body, date).mag; } catch { /* sun/own */ }
          out.push({ body: name, altitude: Math.round(hor.altitude * 10) / 10, azimuth: Math.round(hor.azimuth * 10) / 10,
            visible: hor.altitude > 0, constellation, magnitude: mag != null ? Math.round(mag * 10) / 10 : null });
        } catch { /* skip this body */ }
      }
      return out;
    },

    /** Rise/set times for a body (Date | null). dir: +1 rise, -1 set. */
    riseSet({ body = 'Sun', date = new Date(), lat, lon, dir = 1, limitDays = 1 } = {}) {
      const A = lib(); if (!A || typeof lat !== 'number' || typeof lon !== 'number') return null;
      try { const obs = new A.Observer(lat, lon, 0); const t = A.SearchRiseSet(A.Body[body], obs, dir, date, limitDays); return t ? t.date : null; }
      catch { return null; }
    },

    /** Only the bodies currently above the horizon, with their constellations. */
    whatsUp(opts = {}) { return this.positions(opts).filter((b) => b.visible); },

    /** The bright NAMED stars currently above the horizon, brightest first, with alt/az. */
    visibleStars({ date = new Date(), lat, lon, limit = 12 } = {}) {
      const A = lib(); if (!A || typeof lat !== 'number' || typeof lon !== 'number') return [];
      let obs; try { obs = new A.Observer(lat, lon, 0); } catch { return []; }
      const out = [];
      for (const s of STARS) {
        try {
          const hor = A.Horizon(date, obs, s.ra, s.dec, 'normal');
          if (hor.altitude > 0) out.push({ name: s.name, constellation: s.constellation, mag: s.mag,
            altitude: Math.round(hor.altitude * 10) / 10, azimuth: Math.round(hor.azimuth * 10) / 10 });
        } catch { /* skip */ }
      }
      return out.sort((a, b) => a.mag - b.mag).slice(0, limit);
    },

    /** Look up a named star; with lat/lon/date also give its current alt/az + visibility. */
    star(name, { date = new Date(), lat, lon } = {}) {
      const s = getStar(name); if (!s) return null;
      const base = { name: s.name, constellation: s.constellation, mag: s.mag, ra: s.ra, dec: s.dec };
      const A = lib();
      if (A && typeof lat === 'number' && typeof lon === 'number') {
        try { const hor = A.Horizon(date, new A.Observer(lat, lon, 0), s.ra, s.dec, 'normal');
          return { ...base, altitude: Math.round(hor.altitude * 10) / 10, azimuth: Math.round(hor.azimuth * 10) / 10, visible: hor.altitude > 0 }; }
        catch { /* ignore */ }
      }
      return base;
    },

    /** "What's that bright star over there?" — nearest cataloged star to an alt/az direction. */
    identifyStar({ altitude, azimuth, date = new Date(), lat, lon, maxDeg = 8 } = {}) {
      const vis = this.visibleStars({ date, lat, lon, limit: STARS.length });
      let best = null, bd = 1e9;
      for (const s of vis) { const d = angSep(altitude, azimuth, s.altitude, s.azimuth); if (d < bd) { bd = d; best = s; } }
      if (best && bd <= maxDeg) return { ...best, separationDeg: Math.round(bd * 10) / 10 };
      return null;
    },

    /** A human-readable "what's in the sky" summary. */
    identify({ date = new Date(), lat, lon } = {}) {
      const A = lib(); if (!A) return 'My sky lobe is offline.';
      const up = this.whatsUp({ date, lat, lon });
      const mp = this.moonPhase(date);
      const planets = up.filter((b) => !['Sun', 'Moon'].includes(b.body));
      const parts = [];
      if (mp) parts.push(`The Moon is a ${mp.name} (${Math.round(mp.illumination * 100)}% lit)`);
      if (planets.length) parts.push('Visible now: ' + planets.map((p) => `${p.body} in ${p.constellation || '—'}`).join(', '));
      else parts.push('No planets are above the horizon');
      const bright = this.visibleStars({ date, lat, lon, limit: 1 })[0];
      if (bright) parts.push(`The brightest star up is ${bright.name} in ${bright.constellation}`);
      return parts.join('. ') + '.';
    },
  };
}

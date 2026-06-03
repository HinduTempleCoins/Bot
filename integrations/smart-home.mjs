// smart-home.mjs — Home Assistant control bridge (queue #82). The operator's HA long-lived access
// token is a CAPABILITY GRANT: this module NEVER holds it raw. Every call takes a `token` (or a
// token-getter) injected by the caller; the token is used to build the Authorization header and is
// never returned, never logged, never stored. Reads (states) are watcher-style and Hathor-safe;
// the control verbs (turnOn/turnOff/setScene/armCameras) are explicit grants and mutate the home.
//
// Pattern mirrors integrations/soapbox/macro.mjs: ESM, __setFetch hook, soft-fail (never throw),
// CLI guarded by process.argv[1].endsWith('smart-home.mjs').

const UA = 'MELEK-Bot/1.0 (home-assistant-bridge)';

// Injectable fetch (so tests/offline runs supply their own). __setFetch(null) resets to global.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Default HA base URL; override per-call via opts.baseUrl or the HA_BASE_URL env var.
const DEFAULT_BASE = process.env.HA_BASE_URL || 'http://homeassistant.local:8123';

// Resolve the capability grant. Accepts a raw token string OR a (sync/async) getter that returns one.
// Returns the token string or null. The token is treated as opaque — never logged or echoed back.
async function resolveToken(token) {
  try {
    const t = typeof token === 'function' ? await token() : token;
    return (typeof t === 'string' && t.length) ? t : null;
  } catch { return null; }
}

function baseOf(opts) {
  return String((opts && opts.baseUrl) || DEFAULT_BASE).replace(/\/+$/, '');
}

/**
 * Call a Home Assistant service: POST /api/services/{domain}/{service} with {data} body.
 * @param {{domain:string, service:string, data?:object}} call
 * @param {{token:string|function, baseUrl?:string}} opts  capability grant (token never returned/logged)
 * @returns {Promise<{ok:boolean, status?:number, result?:any, error?:string}>}  soft-fail, never throws
 */
export async function callService({ domain, service, data = {} } = {}, opts = {}) {
  if (!domain || !service) return { ok: false, error: 'missing domain/service' };
  const token = await resolveToken(opts.token);
  if (!token) return { ok: false, error: 'no token (capability grant required)' };
  const url = `${baseOf(opts)}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': UA,
      },
      body: JSON.stringify(data || {}),
    });
    if (!r.ok) return { ok: false, status: r.status, error: `HA ${r.status}` };
    let result = null;
    try { result = await r.json(); } catch { /* HA may return empty body */ }
    return { ok: true, status: r.status, result };
  } catch (e) {
    // Soft-fail: never surface the token, only a generic reason.
    return { ok: false, error: e && e.name ? e.name : 'fetch failed' };
  }
}

/**
 * Read all entity states: GET /api/states. Watcher-style read (Hathor-safe).
 * @param {{token:string|function, baseUrl?:string}} opts
 * @returns {Promise<{ok:boolean, status?:number, states?:any[], error?:string}>}  soft-fail, never throws
 */
export async function states(opts = {}) {
  const token = await resolveToken(opts.token);
  if (!token) return { ok: false, error: 'no token (capability grant required)' };
  const url = `${baseOf(opts)}/api/states`;
  try {
    const r = await _fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, 'user-agent': UA },
    });
    if (!r.ok) return { ok: false, status: r.status, error: `HA ${r.status}` };
    let body = null;
    try { body = await r.json(); } catch { body = []; }
    return { ok: true, status: r.status, states: Array.isArray(body) ? body : [] };
  } catch (e) {
    return { ok: false, error: e && e.name ? e.name : 'fetch failed' };
  }
}

// --- Control verbs (explicit grants) — thin wrappers over callService. ---

/** Turn an entity on. domain is derived from the entity_id prefix (e.g. light.kitchen → light). */
export function turnOn(entity, opts = {}) {
  return callService({ domain: domainOf(entity), service: 'turn_on', data: { entity_id: entity } }, opts);
}

/** Turn an entity off. */
export function turnOff(entity, opts = {}) {
  return callService({ domain: domainOf(entity), service: 'turn_off', data: { entity_id: entity } }, opts);
}

/** Activate a scene. Accepts a bare scene name or a full scene.* entity_id. */
export function setScene(scene, opts = {}) {
  const entity = String(scene || '').startsWith('scene.') ? scene : `scene.${scene}`;
  return callService({ domain: 'scene', service: 'turn_on', data: { entity_id: entity } }, opts);
}

/** Arm cameras by setting the alarm control panel to armed_away. */
export function armCameras(opts = {}) {
  const entity = (opts && opts.alarmEntity) || 'alarm_control_panel.home';
  return callService({ domain: 'alarm_control_panel', service: 'alarm_arm_away', data: { entity_id: entity } }, opts);
}

// entity_id "light.kitchen" → "light"; falls back to "homeassistant" for the generic service domain.
function domainOf(entity) {
  const s = String(entity || '');
  const i = s.indexOf('.');
  return i > 0 ? s.slice(0, i) : 'homeassistant';
}

if (process.argv[1] && process.argv[1].endsWith('smart-home.mjs')) {
  // CLI reads states only (never mutates the home from the command line). Token from env, never printed.
  const res = await states({ token: process.env.HA_TOKEN });
  if (!res.ok) { console.log(`states: unavailable (${res.error})`); }
  else {
    console.log(`${res.states.length} entities`);
    for (const e of res.states.slice(0, 20)) console.log(`  ${(e.entity_id || '').padEnd(36)} ${e.state}`);
  }
}

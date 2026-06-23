// hathor-limb.mjs — the thin client EVERY surface uses to speak to the ONE Hathor brain.
//
// A limb (Discord, the Pentecaust/Minecraft bridge, the MELEK chat, Hathor.live, the game servers) does not
// have its own Hathor — it forwards what it heard to the one brain's /perceive and speaks back her reply.
// Critically, each limb passes its OWN `surface` so her memory stays COMPARTMENTALIZED: the game's thread
// doesn't frame a MELEK reply, but a PERSON follows them across surfaces (Crypt-ology). One self, walls inside.
//
// House style: ESM, soft-fail-never-throw (a limb must never crash because the brain blinked), injectable
// fetch for offline tests, env-configurable brain URL.

const AGENCY_URL = process.env.HATHOR_AGENCY_URL || 'http://127.0.0.1:8175';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/**
 * Ask the one Hathor brain to perceive a message on THIS surface and reply.
 * @param {string} text   what the person said
 * @param {object} opts { surface, from, now, timeoutMs }
 *   surface — the limb's compartment: 'discord' | 'melek' | 'game' | 'trading' | 'prana'
 *   from    — a stable id for the person (so memory follows them); soft-defaults to 'someone'
 * @returns {Promise<{reply, person, surface}|null>}  null if the brain is unreachable (caller falls back)
 */
export async function askHathor(text, { surface = 'melek', from = 'someone', now, timeoutMs = 30000 } = {}) {
  if (!text || !String(text).trim()) return null;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await _fetch(`${AGENCY_URL}/perceive`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface, from: from || 'someone', text: String(text), now }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!r || !r.ok) return null;
    const d = await r.json();
    return d && d.ok ? { reply: d.reply, person: d.person, surface: d.surface } : null;
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}

/** The brain's base URL (for limbs that want to call other endpoints, e.g. /recall). */
export function brainUrl() { return AGENCY_URL; }

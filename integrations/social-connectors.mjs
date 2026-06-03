// social-connectors.mjs — open-tier social posting connectors (queue #79). A thin, PURE planning
// layer over the open, self-serve social networks the Witness can post to without a paywalled
// aggregator: Discord (incoming webhook), Bluesky / AT Protocol, Mastodon, Nostr, and Telegram.
// Gated platforms (X/Twitter, Instagram, TikTok, LinkedIn, Facebook, Threads, YouTube) require a
// unified posting API (Ayrshare / Phyllo) — we describe them in the catalog but never claim to post
// to them without that unified key.
//
// DESIGN (key custody — CLAUDE.md §7, "Zero WIF in Bot repo", "never log tokens"):
//   • This module holds NO tokens and performs NO real network I/O. It builds the request *plan*
//     (endpoint shape + formatted payload) and hands it to an INJECTED `send` function. The caller
//     supplies the actual transport, so the live token never enters this file or its tests.
//   • Authorization arrives as a *capability grant* (an opaque, revocable handle the caller's signer
//     understands), NEVER as a raw token, and the grant is NEVER logged or echoed back in results.
//   • Everything soft-fails: a connector that lacks a grant, is gated without a unified key, or whose
//     `send` throws returns an { ok:false, … } record rather than throwing — so a broadcast fan-out
//     never aborts the whole batch on one bad leg.
//
//   import { SERVICES, post, broadcast, formatFor } from './social-connectors.mjs';
//   const send = async ({ service, endpoint, payload, grant }) => myTransport(...);
//   await broadcast({ text }, ['discord', 'mastodon'], { grants, send });
//   node integrations/social-connectors.mjs

// ── Catalog ──────────────────────────────────────────────────────────────────────────────────────
// `tier`: 'open' — self-serve, post directly via the injected send + a per-service grant.
//         'gated' — needs a unified posting API; only reachable when grants.unified is present.
// `limit`: hard character ceiling we truncate to in formatFor (a safe floor per network).
// `kind` : transport shape, so an injected send can route without us hard-coding any URL/token.
export const SERVICES = {
  discord: { tier: 'open', label: 'Discord', kind: 'webhook', limit: 2000, media: true,
    note: 'Incoming webhook — grant is the opaque webhook handle, never the raw URL with token.' },
  bluesky: { tier: 'open', label: 'Bluesky (AT Protocol)', kind: 'atproto', limit: 300, media: true,
    note: 'AT Protocol post; grant is an app-password/session capability the signer resolves.' },
  mastodon: { tier: 'open', label: 'Mastodon', kind: 'mastodon', limit: 500, media: true,
    note: 'Status POST to the instance; grant is the access-token capability.' },
  nostr: { tier: 'open', label: 'Nostr', kind: 'nostr', limit: 8000, media: false,
    note: 'Signed kind-1 event relayed; grant is the signing capability (never a raw nsec).' },
  telegram: { tier: 'open', label: 'Telegram', kind: 'telegram', limit: 4096, media: true,
    note: 'sendMessage to a channel/chat; grant is the bot capability + chat target.' },

  // Gated — described for completeness, unreachable without a unified API key (grants.unified).
  x: { tier: 'gated', label: 'X (Twitter)', kind: 'unified', limit: 280, media: true,
    note: 'Requires Ayrshare/Phyllo unified API.' },
  instagram: { tier: 'gated', label: 'Instagram', kind: 'unified', limit: 2200, media: true,
    note: 'Requires Ayrshare/Phyllo unified API (media-first).' },
  tiktok: { tier: 'gated', label: 'TikTok', kind: 'unified', limit: 2200, media: true,
    note: 'Requires Ayrshare/Phyllo unified API (video).' },
  linkedin: { tier: 'gated', label: 'LinkedIn', kind: 'unified', limit: 3000, media: true,
    note: 'Requires Ayrshare/Phyllo unified API.' },
  facebook: { tier: 'gated', label: 'Facebook', kind: 'unified', limit: 63206, media: true,
    note: 'Requires Ayrshare/Phyllo unified API.' },
  threads: { tier: 'gated', label: 'Threads', kind: 'unified', limit: 500, media: true,
    note: 'Requires Ayrshare/Phyllo unified API.' },
  youtube: { tier: 'gated', label: 'YouTube (community)', kind: 'unified', limit: 5000, media: true,
    note: 'Requires Ayrshare/Phyllo unified API.' },
};

export const OPEN_SERVICES = Object.keys(SERVICES).filter((s) => SERVICES[s].tier === 'open');
export const GATED_SERVICES = Object.keys(SERVICES).filter((s) => SERVICES[s].tier === 'gated');

// ── Per-network formatting ───────────────────────────────────────────────────────────────────────
const ELLIPSIS = '…';

/** Format/truncate `text` for a given service's hard limit. Truncates on a word boundary where it
 *  can, appending an ellipsis. Unknown services pass through unchanged. PURE — no I/O, no token. */
export function formatFor(service, text) {
  const svc = SERVICES[service];
  const s = String(text == null ? '' : text);
  if (!svc) return s;
  const limit = svc.limit;
  if (s.length <= limit) return s;
  const room = Math.max(0, limit - ELLIPSIS.length);
  let cut = s.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > room * 0.6) cut = cut.slice(0, lastSpace); // prefer a word boundary if it's close
  return cut.replace(/\s+$/, '') + ELLIPSIS;
}

// ── Posting ──────────────────────────────────────────────────────────────────────────────────────
// We never log a grant; this strips it from anything we might surface in a result/error.
function safeResult(obj) {
  const { grant, ...rest } = obj || {};
  return rest;
}

/** Build the request plan (no token, no I/O) for a single post. The injected `send` does the work. */
function planFor({ service, text, media }) {
  const svc = SERVICES[service];
  const formatted = formatFor(service, text);
  const payload = { text: formatted };
  if (media && svc.media) payload.media = media;
  // Endpoint is a *shape* descriptor, not a URL — the injected transport resolves the real target
  // from the capability grant. We never embed a token-bearing URL here.
  return { service, kind: svc.kind, tier: svc.tier, endpoint: { kind: svc.kind }, payload };
}

/**
 * Post to a single service. Soft-fails (returns { ok:false, … }, never throws).
 *   @param {{service:string, text:string, media?:any}} msg
 *   @param {{grant:any, send:Function, unified?:any}} ctx — `grant` is an opaque capability (NOT a
 *          raw token); `send` is the injected transport; `unified` is the capability for the unified
 *          API (only consulted for gated services). The grant is never logged.
 *   @returns {Promise<{ok:boolean, service:string, ...}>}
 */
export async function post({ service, text, media } = {}, { grant, send, unified } = {}) {
  const svc = SERVICES[service];
  if (!svc) return { ok: false, service, skipped: true, reason: 'unknown-service' };
  if (typeof send !== 'function') return { ok: false, service, skipped: true, reason: 'no-send' };

  // Gated services need the unified-API capability; without it we skip (never pretend to post).
  if (svc.tier === 'gated') {
    if (!unified) return { ok: false, service, skipped: true, tier: 'gated', reason: 'no-unified-key' };
  } else if (grant == null) {
    return { ok: false, service, skipped: true, tier: 'open', reason: 'no-grant' };
  }

  const cap = svc.tier === 'gated' ? unified : grant; // capability handed to the transport, not logged
  const plan = planFor({ service, text, media });
  try {
    // The transport receives the capability under `grant`; we never read or print it here.
    const res = await send({ ...plan, grant: cap });
    return { ok: true, service, tier: svc.tier, kind: svc.kind, length: plan.payload.text.length, result: safeResult(res) };
  } catch (e) {
    return { ok: false, service, tier: svc.tier, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * Fan a single text out to multiple OPEN-tier services. Gated services are skipped unless a unified
 * key is supplied (grants.unified). Per-service grants come from `grants[service]`. Soft-fails per
 * leg — one bad connector never aborts the batch.
 *   @param {{text:string, media?:any}} msg
 *   @param {string[]} [services] — defaults to all open services
 *   @param {{grants:object, send:Function}} ctx — grants is a map service→capability (+ optional
 *          `grants.unified`); never logged.
 *   @returns {Promise<{ok:boolean, posted:number, skipped:number, results:Array}>}
 */
export async function broadcast({ text, media } = {}, services = OPEN_SERVICES, { grants = {}, send } = {}) {
  const list = (services && services.length ? services : OPEN_SERVICES).filter((s) => SERVICES[s]);
  const unified = grants.unified;
  const results = await Promise.all(list.map((service) =>
    post({ service, text, media }, { grant: grants[service], send, unified })));
  const posted = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok).length;
  return { ok: posted > 0, posted, skipped, results };
}

// ── CLI: show the catalog + a dry plan (no posting, no tokens) ────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('social-connectors.mjs')) {
  const text = process.argv.slice(2).join(' ') || 'The Witness keeps the ledger. A small word goes out to the open networks.';
  console.log('Open tier (post directly with a per-service capability grant):');
  for (const s of OPEN_SERVICES) {
    console.log(`  • ${SERVICES[s].label.padEnd(24)} limit ${String(SERVICES[s].limit).padStart(6)}  → "${formatFor(s, text)}"`);
  }
  console.log('\nGated tier (needs a unified API key — Ayrshare/Phyllo):');
  for (const s of GATED_SERVICES) console.log(`  • ${SERVICES[s].label.padEnd(24)} limit ${String(SERVICES[s].limit).padStart(6)}  (${SERVICES[s].note})`);
  console.log('\n(No network calls were made; no tokens are held by this module.)');
}

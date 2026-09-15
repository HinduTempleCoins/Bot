// pentecaust/herald/signer-broadcast.mjs — the ONLY path from Herald to a chain.
//
// crossposter.mjs formats posts and refuses to broadcast them: it takes an INJECTED broadcaster and,
// with none, every target came back { ok:false, reason:'no broadcaster' }. That refusal is the custody
// rule from BRIEF.md §7, not an oversight — this repo holds no WIF and signs nothing locally. So the
// missing piece was never "let the crossposter sign"; it was a broadcaster that DELEGATES to MELEK-Signer.
//
// POST /v1/broadcast, Authorization: Bearer <scoped token>, per MELEK_SIGNER.md §3a. The token is scoped
// server-side — a comment-scoped token cannot move funds no matter what ops are handed to it — and it is
// read from the environment at call time so it never enters the repo, a log line, or an error message.
//
// House style: ESM, injectable fetch, soft-fail-never-throw, handler(req,res) for tests, CLI guarded.
//
//   import { makeSignerBroadcaster, signerConfigured } from './signer-broadcast.mjs';

const env = (k, d = '') => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

const SIGNER_URL = () => String(env('MELEK_SIGNER_URL', 'https://signer.melek.salon')).replace(/\/$/, '');
const SIGNER_TOKEN = () => String(env('MELEK_SIGNER_TOKEN', ''));
const CLIENT = () => String(env('MELEK_SIGNER_CLIENT', 'herald'));

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

/** Non-secret readiness for a dashboard: is a token present at all? NEVER returns the token. */
export function signerConfigured() {
  return { ok: !!SIGNER_TOKEN(), url: SIGNER_URL(), client: CLIENT() };
}

/**
 * makeSignerBroadcaster — returns the fn crossposter.__setBroadcaster() expects: (chain, op) => result.
 *
 * ⚠️ Fails CLOSED. No token ⇒ { ok:false, reason:'signer not configured' } and no request is made, so an
 * unconfigured box quietly posts nothing rather than erroring into a retry loop.
 */
export function makeSignerBroadcaster({ fetch: f, url, token, client, timeoutMs = 20000 } = {}) {
  return async function broadcast(chain, op) {
    const tok = token != null ? String(token) : SIGNER_TOKEN();
    if (!tok) return { ok: false, reason: 'signer not configured' };
    if (!op || typeof op !== 'object') return { ok: false, reason: 'no operation' };

    const base = (url || SIGNER_URL()).replace(/\/$/, '');
    const doFetch = typeof f === 'function' ? f : _fetch;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch {} }, timeoutMs) : null;
    try {
      const r = await doFetch(`${base}/v1/broadcast`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          ops: [['comment', op]],
          chain: String(chain || '').toLowerCase(),
          client_ref: `${client || CLIENT()}-crosspost-${op.author || ''}-${op.permlink || ''}`,
        }),
        ...(ctl ? { signal: ctl.signal } : {}),
      });
      const status = Number(r && r.status) || 0;
      let j = null; try { j = await r.json(); } catch { j = null; }
      // ⚠️ Never surface the signer's raw body — a 401/403 from an auth endpoint is exactly the place a
      // token gets echoed back into a log. Report the STATUS and a fixed phrase.
      if (status === 401 || status === 403) return { ok: false, reason: `signer refused (${status}) — token missing or out of scope` };
      if (status >= 400) return { ok: false, reason: `signer error (${status})` };
      if (j && j.ok === false) return { ok: false, reason: 'signer declined the operation' };
      return { ok: true, txid: (j && (j.txid || j.id || (j.result && j.result.id))) || null };
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
      return { ok: false, reason: aborted ? 'signer timeout' : 'signer unreachable' };
    } finally { if (timer) clearTimeout(timer); }
  };
}

/** handler(req,res) — readiness only. Deliberately exposes no way to trigger a broadcast over HTTP. */
export function handler(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(signerConfigured()));
}

export default { makeSignerBroadcaster, signerConfigured, handler, __setFetch };

if (process.argv[1] && process.argv[1].endsWith('signer-broadcast.mjs')) {
  const c = signerConfigured();
  process.stdout.write(`signer ${c.ok ? 'CONFIGURED' : 'NOT configured'} at ${c.url} as ${c.client}\n`);
}

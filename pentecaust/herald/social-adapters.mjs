// pentecaust/herald/social-adapters.mjs — Herald off-chain social-posting scaffold.
// The Graphene cross-poster (./crossposter.mjs) fans an authored source out onto the social CHAINS
// (MELEK / Blurt / Hive / Steem). This scaffold lets the same fan-out reach the mainstream Web-2 social
// networks (X / LinkedIn / Facebook) so a post can go everywhere at once. Each network is a small adapter
// behind one entrypoint, postToSocial({ network, text, link, token }).
//
// Custody discipline (BRIEF.md §7): this module is a SCAFFOLD. It NEVER stores, caches, logs, or persists a
// token — the caller passes a per-call bearer/access token that lives only for the duration of the call and
// is dropped when it returns. No token → the adapter SOFT-FAILS to { ok:false, reason:'unconfigured' } and
// makes no network call. Nothing throws; every path returns a result object. The actual HTTP is done by an
// INJECTED fetch (__setFetch) so the suite runs fully offline.
//
//   import { postToSocial, NETWORKS, __setFetch } from './social-adapters.mjs'
//
// ── Real API surfaces (documented for when tokens are wired; endpoints/token shapes only, no secrets) ──
//
// X (Twitter) — POST https://api.twitter.com/2/tweets
//   Auth:  Authorization: Bearer <OAuth2 user-context access token, scope tweet.write tweet.read users.read>
//          (obtained via the OAuth2 Authorization Code + PKCE flow; app-only tokens CANNOT post)
//   Body:  { "text": "<=280 chars" }  — a link counts as a t.co-shortened 23 chars toward the limit.
//   Ref:   https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
//
// LinkedIn — POST https://api.linkedin.com/v2/ugcPosts   (or /rest/posts with LinkedIn-Version header)
//   Auth:  Authorization: Bearer <OAuth2 3-legged member token, scope w_member_social>
//          Also send  X-Restli-Protocol-Version: 2.0.0
//   Body:  { author:"urn:li:person:<id>", lifecycleState:"PUBLISHED",
//            specificContent:{ "com.linkedin.ugc.ShareContent":{ shareCommentary:{ text:"…" },
//              shareMediaCategory: link ? "ARTICLE" : "NONE",
//              media: link ? [{ status:"READY", originalUrl:"<link>" }] : [] } },
//            visibility:{ "com.linkedin.ugc.MemberNetworkVisibility":"PUBLIC" } }
//   Ref:   https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
//
// Facebook (Page feed) — POST https://graph.facebook.com/v19.0/<page-id>/feed
//   Auth:  Page access token as ?access_token=<token> (a long-lived Page token from the Graph OAuth flow;
//          scopes pages_manage_posts + pages_read_engagement). We send it as a Bearer header instead of the
//          query string so the token never lands in a URL/log.
//   Body:  { message:"…", link:"<optional url>" }
//   Ref:   https://developers.facebook.com/docs/pages-api/posts

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

// esc() every value we interpolate into an outbound payload or preview string (house rule).
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── injectable fetch (mocked offline in the suite; never a live network call under test) ──────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export const NETWORKS = ['x', 'linkedin', 'facebook'];
const norm = (n) => String(n || '').toLowerCase().trim();

// Compose the visible message: text with the link appended once when the link is not already present.
function composeText(text, link) {
  const t = esc(text).trim();
  const l = esc(link).trim();
  if (!l) return t;
  if (t.includes(l)) return t;
  return t ? `${t} ${l}` : l;
}

// ── per-network adapters: each returns a { url, options } request descriptor (or null if it needs no link) ──
const ADAPTERS = {
  x(text, link) {
    return {
      url: env('HERALD_X_API', 'https://api.twitter.com/2/tweets'),
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: composeText(text, link) }),
      },
    };
  },
  linkedin(text, link, meta = {}) {
    const author = esc(meta.author || env('HERALD_LINKEDIN_AUTHOR', 'urn:li:person:UNKNOWN'));
    const body = {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: composeText(text, '') },
          shareMediaCategory: link ? 'ARTICLE' : 'NONE',
          media: link ? [{ status: 'READY', originalUrl: esc(link) }] : [],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    return {
      url: env('HERALD_LINKEDIN_API', 'https://api.linkedin.com/v2/ugcPosts'),
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-restli-protocol-version': '2.0.0' },
        body: JSON.stringify(body),
      },
    };
  },
  facebook(text, link, meta = {}) {
    const pageId = esc(meta.pageId || env('HERALD_FACEBOOK_PAGE_ID', 'me'));
    const base = env('HERALD_FACEBOOK_API', 'https://graph.facebook.com/v19.0');
    const body = { message: composeText(text, '') };
    if (link) body.link = esc(link);
    return {
      url: `${base}/${pageId}/feed`,
      options: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    };
  },
};

// postToSocial — post one message to one social network.
//   { network, text, link, token, meta } → { ok, network, id?, url?, reason?, status? }
// Soft-fails (never throws) for: unknown network, missing token (→ 'unconfigured'), empty text, or an HTTP
// error. The token is used ONLY as an in-call Bearer header and is never stored, logged, or returned.
export async function postToSocial(args = {}) {
  const network = norm(args.network);
  if (!NETWORKS.includes(network)) return { ok: false, network, reason: 'unknown_network' };

  const text = args.text == null ? '' : String(args.text);
  const link = args.link == null ? '' : String(args.link);
  if (!text.trim() && !link.trim()) return { ok: false, network, reason: 'empty' };

  const token = args.token == null ? '' : String(args.token);
  if (!token.trim()) return { ok: false, network, reason: 'unconfigured' };

  let req;
  try { req = ADAPTERS[network](text, link, args.meta || {}); }
  catch (e) { return { ok: false, network, reason: 'compose_failed', error: String(e && e.message || e) }; }

  const options = req.options;
  // Token attached here, per call, never persisted. Facebook accepts the same Bearer header form.
  options.headers = { ...options.headers, authorization: `Bearer ${token}` };

  let res;
  try {
    res = await _fetch(req.url, options);
  } catch (e) {
    return { ok: false, network, reason: 'network_error', error: String(e && e.message || e) };
  }

  const status = res && typeof res.status === 'number' ? res.status : 0;
  let data = null;
  try { data = res && typeof res.json === 'function' ? await res.json() : null; } catch { data = null; }

  const ok = !!(res && (res.ok || (status >= 200 && status < 300)));
  if (!ok) return { ok: false, network, status, reason: 'http_error', data };

  // Best-effort id extraction across the three response shapes.
  const id = (data && (data.id || (data.data && data.data.id))) || null;
  return { ok: true, network, status, id, data };
}

// Fan one message out to several networks with a per-network token map: { x, linkedin, facebook }.
// Networks with no token soft-fail to 'unconfigured' rather than blocking the others.
export async function postToNetworks(args = {}) {
  const nets = Array.isArray(args.networks) && args.networks.length ? args.networks : NETWORKS;
  const tokens = args.tokens || {};
  const out = {};
  for (const n of nets) {
    const network = norm(n);
    // eslint-disable-next-line no-await-in-loop
    out[network] = await postToSocial({
      network,
      text: args.text,
      link: args.link,
      token: tokens[network],
      meta: (args.meta && args.meta[network]) || {},
    });
  }
  return { ok: Object.values(out).some((r) => r.ok), results: out };
}

// CLI: a dry preview of the composed message per network (no token → no network call).
if (typeof process !== 'undefined' && process.argv[1] &&
    (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = process.argv[2] || 'Hello from Herald.';
  const link = process.argv[3] || 'https://melek.salon';
  for (const n of NETWORKS) {
    const r = await postToSocial({ network: n, text, link }); // no token → unconfigured
    console.log(`${n}: ${r.reason} — preview="${composeText(text, link)}"`);
  }
}

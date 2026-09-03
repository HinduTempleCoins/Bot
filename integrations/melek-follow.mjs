// melek-follow.mjs — the follow/unfollow WRITE for the MELEK social graph.
//
// The read side already exists (pentecaust reads condenser_api.get_following/get_followers;
// melek-notify.mjs parses the incoming `follow` custom_json). The WRITE was the one missing capability —
// nothing on our stack broadcast a follow. This is it: build the standard Steem/Hive `follow` custom_json
// and hand it to MELEK-Signer's /v1/broadcast with a scoped, revocable posting-scope bearer token. Zero WIF
// here and zero WIF on any box — same custody boundary as autovote/signer-castvote.mjs (the token is a
// capability handle, never key material; never logged).
//
// The op format matches EXACTLY what melek-notify.mjs already parses, so a follow lights up the target's
// notifications for free: custom_json id:'follow', json: ['follow',{follower,following,what:['blog']}].
// Unfollow = the same op with what:[] (the chain convention).
//
// House style: ESM, injectable fetch, soft-fail (throws on a failed broadcast so a caller's try/catch can
// skip and continue), no top-level network, offline-testable.
//
//   import { followOp, unfollowOp, follow, unfollow, makeFollow } from './melek-follow.mjs'

const DEFAULT_SIGNER_URL = 'https://signer.melek.salon';
const lc = (s) => String(s || '').toLowerCase();

/**
 * Build the Graphene `follow` custom_json op. `what:['blog']` = follow; `what:[]` = unfollow.
 * required_posting_auths:[follower] — a posting-scope op (cannot transfer or touch keys).
 */
export function followJsonOp(follower, following, what = ['blog']) {
  const f = lc(follower); const t = lc(following);
  if (!f || !t) throw new Error('melek-follow: follower and following required');
  if (f === t) throw new Error('melek-follow: cannot follow yourself');
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [f],
    id: 'follow',
    json: JSON.stringify(['follow', { follower: f, following: t, what }]),
  }];
}
export const followOp = (follower, following) => followJsonOp(follower, following, ['blog']);
export const unfollowOp = (follower, following) => followJsonOp(follower, following, []);

/** Broadcast one op through MELEK-Signer with a scoped bearer token (posting role for custom_json). */
async function broadcast({ token, op, signerUrl = DEFAULT_SIGNER_URL, clientId = 'follow', fetch: f = fetch }) {
  if (!token) throw new Error('melek-follow: no bearer token (token NOT logged)');
  const res = await f(`${signerUrl}/v1/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ops: [op], client_ref: clientId, role: 'posting' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error((j && j.error) || `MELEK-Signer broadcast failed: ${res.status}`);
  return j.result;
}

/**
 * Follow — broadcast a follow from `follower` to `following`.
 * @param {object} cfg { token, follower, following, signerUrl?, clientId?, fetch? }
 * @returns {Promise<object>} the chain result
 */
export function follow({ token, follower, following, signerUrl, clientId, fetch: f } = {}) {
  return broadcast({ token, op: followOp(follower, following), signerUrl, clientId, fetch: f });
}
/** Unfollow — same, with what:[]. */
export function unfollow({ token, follower, following, signerUrl, clientId, fetch: f } = {}) {
  return broadcast({ token, op: unfollowOp(follower, following), signerUrl, clientId, fetch: f });
}

/**
 * makeFollow — bind a signed-in account's token into a {follow, unfollow} pair the Follow button injects.
 * The button reads follow-state from pentecaust's GET /following; this is only the write.
 */
export function makeFollow({ token, follower, signerUrl = DEFAULT_SIGNER_URL, clientId = 'follow', fetch: f = fetch } = {}) {
  if (!token) throw new Error('melek-follow: no bearer token (token NOT logged)');
  if (!follower) throw new Error('melek-follow: no follower account');
  return {
    follow: (following) => follow({ token, follower, following, signerUrl, clientId, fetch: f }),
    unfollow: (following) => unfollow({ token, follower, following, signerUrl, clientId, fetch: f }),
  };
}

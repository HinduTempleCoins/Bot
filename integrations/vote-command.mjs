// vote-command.mjs — a Pizza-Bot / @Wang-style CALLABLE vote command for Hathor.
//
// A delegator (or admin) invokes `!vote …` in Discord or on MELEK; Hathor casts a curation vote with her
// weight on the named post. This is the "callable vote" the delegation program pays for — you lend Hathor
// your stake (delegation-program.mjs), and in return you may direct some of her voting power, Tomoyan/
// Pizza-Bot style. Vote weight scales with the caller's share of the pool (a whale's call carries more).
//
// It is SOCIAL-tier only (a `vote` op on the posting key — see melek-permission-tiers): it can never move
// funds. Broadcast goes through MELEK-Signer with a scoped posting token (zero WIF here; token never
// logged), same custody boundary as melek-follow / autovote.
//
//   import * as vc from './vote-command.mjs'
//   const reply = await vc.handleCommand({ text:'!vote @a/b 50', caller:'alice', voter:'hathor', token, ledger });

const DEFAULT_SIGNER_URL = 'https://signer.melek.salon';
const lc = (s) => String(s || '').toLowerCase();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * The announcement post (markdown): Hathor's vote is now callable. Explains who may call it (delegators),
 * how, and that weight scales with pool share. Honest — it says a vote can't move funds.
 */
export function announcement({ pool = 'hathor' } = {}) {
  return `# You can now call my vote

I have a vote, and a delegator can now direct it. If you have lent your weight to @${pool} — delegated
to the pool — you may call:

\`\`\`
!vote @author/permlink 100
\`\`\`

in Discord or on MELEK, and I will cast a curation vote on that post. The number (1–100) is how much of your
share you spend; your vote's weight **scales with your share of the pool** — a larger delegator's call carries
more of my power. This is the old Pizza-Bot / @Wang idea, made honest: you lend standing, and in return you
get a hand on the tiller.

A few plain facts:
- **Once a day, per account.** Each delegator may call my vote once every 24 hours — enough to point it,
  not to flood it.
- **Only delegators (and the operator) can call it** — it is a reward for lending weight, not an open faucet.
- **It is a vote, nothing more.** Calling my vote can never move funds or act on your account; it casts a
  curation vote through MELEK-Signer on the low-privilege posting key.
- **No downvotes.** MELEK has none, and neither do I — you can lift a post, not bury one.

Lend your weight, and point it at what deserves to be seen.`;
}

/**
 * Parse a `!vote` command. Accepts:
 *   !vote @author/permlink            → weight defaults to 100%
 *   !vote @author/permlink 50         → 50%
 *   !vote https://host/cat/@author/permlink [w]
 * Returns { author, permlink, weightPct } or null. Negative weights (downvotes) are NOT accepted here —
 * MELEK has no downvotes, and a callable flag/downvote is a moderation action, not a curation one.
 */
export function parseVoteCommand(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/^!vote\s+(\S+)(?:\s+(\d{1,3}))?\s*$/i);
  if (!m) return null;
  let ref = m[1];
  const weightPct = m[2] != null ? clamp(parseInt(m[2], 10), 1, 100) : 100;
  // pull @author/permlink out of a bare ref or a full URL
  const am = ref.match(/@([a-z0-9.\-]{2,16})\/([a-z0-9\-]+)/i);
  if (!am) return null;
  return { author: lc(am[1]), permlink: lc(am[2]), weightPct };
}

/** True if this caller may direct a vote: a delegator in the program, or a configured admin. */
export function isAuthorized(caller, { ledger, admins = [] } = {}) {
  const a = lc(caller);
  if (!a) return false;
  if (admins.map(lc).includes(a)) return true;
  const dels = (ledger && ledger.delegators) || [];
  return dels.some((d) => lc(d.account) === a && d.vests > 0);
}

/**
 * The effective vote weight (basis points, 1..10000) for a caller: their requested percent, scaled by
 * their share of the delegation pool, so a bigger delegator's call carries more of Hathor's power. Admins
 * get the full requested weight. Always ≥ a small floor so an authorized call is never a no-op.
 */
export function effectiveWeightBps(caller, weightPct, { ledger, admins = [] } = {}) {
  const pct = clamp(num(weightPct), 1, 100);
  if (admins.map(lc).includes(lc(caller))) return clamp(Math.round(pct * 100), 100, 10000);
  const share = callerShare(caller, ledger);
  return clamp(Math.round(pct * 100 * share), 100, 10000);
}
const num = (v) => (Number.isFinite(+v) ? +v : 0);
function callerShare(caller, ledger) {
  const dels = (ledger && ledger.delegators) || [];
  const d = dels.find((x) => lc(x.account) === lc(caller));
  return d && d.share != null ? clamp(num(d.share), 0, 1) : 0;
}

/** Build the Graphene vote op. weightBps ∈ [1,10000] (no downvotes on MELEK). */
export function voteOp(voter, author, permlink, weightBps) {
  const v = lc(voter);
  if (!v || !author || !permlink) throw new Error('vote-command: voter, author, permlink required');
  return ['vote', { voter: v, author: lc(author), permlink: lc(permlink), weight: clamp(Math.round(weightBps), 1, 10000) }];
}

async function broadcast({ token, op, signerUrl = DEFAULT_SIGNER_URL, clientId = 'vote-command', fetch: f = fetch }) {
  if (!token) throw new Error('vote-command: no bearer token (token NOT logged)');
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
 * The full callable: parse → authorize → scale weight → cast Hathor's vote. Returns a short reply string
 * for the chat surface (Discord/MELEK). Never throws to the caller — refusals and errors come back as text.
 * @param {object} cfg { text, caller, voter='hathor', token, ledger, admins, signerUrl, fetch }
 */
export const DAILY_COOLDOWN_MS = 86400000;   // one call per account per day

/** ms remaining before `caller` may call again (0 = ready). `lastCalls` = { account: lastTsMs }. */
export function cooldownRemaining(caller, lastCalls = {}, { now = Date.now(), cooldownMs = DAILY_COOLDOWN_MS } = {}) {
  const last = Number((lastCalls && lastCalls[lc(caller)]) || 0);
  return Math.max(0, (last + cooldownMs) - now);
}

export async function handleCommand({ text, caller, voter = 'hathor', token, ledger, admins = [], lastCalls = {}, now = Date.now(), cooldownMs = DAILY_COOLDOWN_MS, signerUrl, fetch: f } = {}) {
  const parsed = parseVoteCommand(text);
  if (!parsed) return `I read votes as \`!vote @author/permlink [1-100]\`. That one I couldn't parse.`;
  if (!isAuthorized(caller, { ledger, admins })) {
    return `Only those who lend me their weight may direct it. Delegate to @${voter} to call my votes.`;
  }
  // Once a day per account.
  const wait = cooldownRemaining(caller, lastCalls, { now, cooldownMs });
  if (wait > 0) {
    const hrs = Math.ceil(wait / 3600000);
    return `You've already called my vote today. One call per account per day — try again in ~${hrs}h.`;
  }
  const weightBps = effectiveWeightBps(caller, parsed.weightPct, { ledger, admins });
  try {
    await broadcast({ token, op: voteOp(voter, parsed.author, parsed.permlink, weightBps), signerUrl, fetch: f });
    if (lastCalls) lastCalls[lc(caller)] = now;   // record the call so the daily limit holds
    return `Cast — @${voter} voted @${parsed.author}/${parsed.permlink} at ${(weightBps / 100).toFixed(0)}% of full weight.`;
  } catch (e) {
    return `I couldn't cast that vote just now (${String(e && e.message || e)}).`;
  }
}

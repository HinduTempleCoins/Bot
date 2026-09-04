// server.mjs — the Signup-help HTTP server (Phase 2, task #295).
//
// The bridge between the tutorial's deterministic unlock model and the condenser signup flow at
// alpha.melek.salon. It does THREE things and no more:
//
//   1. SERVES the tutorial stage catalog + a given account's progress/next-unlock, all DETERMINISTIC
//      (no LLM) — composed from tutorial/ modules (detector, composer, composers) and read-only
//      condenser RPC reads of public chain activity.
//   2. KICKS OFF email verification by reusing integrations/email-verify.mjs (Resend). Soft-fails
//      honestly when the Resend key is absent.
//   3. NOTHING ELSE. ZERO keys, ZERO broadcast. It never signs, never holds a WIF, never creates an
//      account (the testnet faucet does that, separately — see signup/faucet-testnet.mjs). It only
//      reads public chain data, composes deterministic text, and triggers an email.
//
// CUSTODY (BRIEF.md §7 / repo HARD RULE): no key material anywhere here. The only "secret" touched is
// the Resend API key, and only inside email-verify.mjs's capability scope — never in this file.
//
// CORS: only the alpha.melek.salon origin (the condenser signup page) is allowed. Everything else
// gets no CORS headers (and OPTIONS preflight from a disallowed origin is refused).
//
//   PORT=8112 BASE_URL=https://signup.melek.salon MELEK_RPC_URL=http://127.0.0.1:8090 \
//     node signup/server.mjs
//
// ── Routes ────────────────────────────────────────────────────────────────────────────────────────
//   GET  /health                       liveness probe -> "ok"
//   GET  /api/stages                   the tutorial stage catalog (from stages.json), trimmed
//   GET  /api/progress?account=X       X's per-stage completion + unlocks (read-only chain reads)
//   GET  /api/next?account=X           X's next unlock, composed deterministically (lesson post)
//   POST /api/verify-email  {email}    starts the Resend email-verification flow (reused)
//   POST /api/report  {target,kind,reason,reporter}  files a moderation flag into a REAL append-only
//                                      store the moderation layer reads (POLICY.md §1/§7). Idempotent
//                                      per (reporter,target,kind) while open; rate-limited (anti-abuse).
//
// Offline-testable: handler(req,res) exported; fetch is injectable (__setChainFetch) so the live
// condenser RPC is never touched in tests; the email mailer is injected via email-verify's __setMailer.

import { createServer } from 'node:http';

import { loadStages, detectCompletedStages, nextStageFor } from '../tutorial/detector.js';
import { composeLessonPost } from '../tutorial/composers.mjs';
import { startVerification, isValidEmail } from '../integrations/email-verify.mjs';
import { Limiter, clientIp } from '../integrations/rate-limit.mjs';
import { moderationFlags, normalizeKind, REPORT_KINDS } from '../integrations/moderation-flags.mjs';
import { listProviders, PROVIDER_SCHEMA } from './providers.mjs';

const PORT = +(process.env.PORT || 8112);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://signup.melek.salon').replace(/\/$/, '');

// The single allowed browser origin: the condenser signup page.
export const ALLOWED_ORIGIN = (process.env.SIGNUP_ALLOWED_ORIGIN || 'https://alpha.melek.salon').replace(/\/$/, '');

// MELEK testnet condenser RPC for read-only progress reads.
const MELEK_RPC_URL = process.env.MELEK_RPC_URL || 'http://127.0.0.1:8090';

// Abuse cap on the email-verify route — it triggers a Resend send, so it must not be free to spam.
// Per-IP + per-email-address over a window. Env-tunable; soft-fails open. Injectable for tests.
let _emailLimiter = new Limiter({
  scope: 'signup-email',
  ipMax: parseInt(process.env.EMAIL_RL_IP_MAX || '5', 10),
  fpMax: parseInt(process.env.EMAIL_RL_FP_MAX || '3', 10),
  windowSec: parseInt(process.env.EMAIL_RL_WINDOW_SEC || '3600', 10),
});
export function __setEmailLimiter(l) { _emailLimiter = l || _emailLimiter; }

// Abuse cap on the report/flag route (POLICY.md §1: false/mass reporting is itself a violation, so the
// report path must not be a free punishment button). Per-IP + per-(account-or-target) over a window.
let _reportLimiter = new Limiter({
  scope: 'signup-report',
  ipMax: parseInt(process.env.REPORT_RL_IP_MAX || '30', 10),
  fpMax: parseInt(process.env.REPORT_RL_FP_MAX || '10', 10),
  windowSec: parseInt(process.env.REPORT_RL_WINDOW_SEC || '3600', 10),
});
export function __setReportLimiter(l) { _reportLimiter = l || _reportLimiter; }

// The moderation flag store is injectable so tests use a temp/in-memory store, never the real file.
let _modStore = moderationFlags;
export function __setModerationStore(s) { _modStore = s || moderationFlags; }

// Injectable fetch (offline tests never touch the network).
let _chainFetch = (...a) => globalThis.fetch(...a);
export function __setChainFetch(fn) { _chainFetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── account-name guard (mirrors signup/account-create.mjs; conservative) ───────────────────────────
const SEGMENT_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
export function validAccountName(name) {
  if (typeof name !== 'string') return false;
  if (name.length < 3 || name.length > 16) return false;
  for (const seg of name.split('.')) {
    if (seg.length < 3 || seg.length > 16) return false;
    if (!SEGMENT_RE.test(seg)) return false;
    if (seg.includes('--')) return false;
  }
  return true;
}

// ── read-only condenser RPC ────────────────────────────────────────────────────────────────────────
async function chainRpc(method, params) {
  const res = await _chainFetch(MELEK_RPC_URL, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const j = await res.json();
  if (j && j.error) throw new Error(j.error.message || 'rpc error');
  return j ? j.result : null;
}

// Pull the public activity the tutorial detector needs for an account and shape it into the
// `userActivity` object detectCompletedStages/nextStageFor expect:
//   { posts, comments, votes_received, transfers_to_vesting, witness_votes }.
//
// All reads are read-only condenser_api calls. Returns null on any failure (honest soft-fail — the
// caller renders an "unavailable" response rather than inventing progress).
export async function readAccountActivity(account, { rpc = chainRpc } = {}) {
  if (!validAccountName(account)) return null;
  try {
    // History stream: covers comments, transfer_to_vesting, account_witness_vote. -1 = most recent.
    // The two PRIMARY reads (history + blog) are NOT caught here on purpose: if the chain is genuinely
    // unreachable, the throw propagates to the outer try/catch and we honestly return null rather than
    // inventing empty progress. The account-field read is enrichment, so it stays soft.
    const [history, blog, witnessVotesField] = await Promise.all([
      rpc('condenser_api.get_account_history', [account, -1, 1000]),
      rpc('condenser_api.get_discussions_by_blog', [{ tag: account, limit: 100 }]),
      rpc('condenser_api.get_accounts', [[account]]).catch(() => []),
    ]);

    const posts = (Array.isArray(blog) ? blog : [])
      .filter((p) => p && p.author === account && (p.depth === 0 || p.parent_author === ''))
      .map((p) => ({
        author: p.author, permlink: p.permlink, title: p.title, body: p.body,
        json_metadata: p.json_metadata, tags: p.tags,
      }));

    const comments = [];
    const transfers_to_vesting = [];
    const witness_votes = [];
    const transfers_sent = [];   // stage 9
    const delegations = [];      // stage 10
    const follows = [];          // stage 8
    for (const entry of Array.isArray(history) ? history : []) {
      const op = entry && entry[1] && entry[1].op;
      if (!Array.isArray(op)) continue;
      const [type, data] = op;
      if (type === 'comment' && data.author === account && data.parent_author) {
        comments.push({
          author: data.author, permlink: data.permlink, body: data.body,
          parent_author: data.parent_author, parent_permlink: data.parent_permlink,
        });
      } else if (type === 'transfer_to_vesting' && data.from === account) {
        transfers_to_vesting.push({ amount: data.amount });
      } else if (type === 'account_witness_vote' && data.account === account) {
        witness_votes.push({ witness: data.witness, approve: data.approve !== false });
      } else if (type === 'transfer' && data.from === account) {
        // stage 9 (send_first_transfer). The detector applies the self-send exclusion.
        transfers_sent.push({ from: data.from, to: data.to, amount: data.amount, memo: '' });
      } else if (type === 'delegate_vesting_shares' && data.delegator === account) {
        // stage 10 (delegate_some_mp). Nodes differ on the field name, so pass both through and
        // let the detector pick — it reads amount_mp first, then vesting_shares.
        delegations.push({
          delegator: data.delegator, delegatee: data.delegatee,
          vesting_shares: data.vesting_shares, amount_mp: data.amount_mp,
        });
      } else if (type === 'custom_json' && data.id === 'follow') {
        // stage 8 (follow_three_authors). `follow` is a custom_json convention, not a consensus op:
        // ["follow",{follower,following,what:["blog"]}]. An empty `what` is an UNFOLLOW, so it is
        // skipped rather than counted.
        try {
          const j = JSON.parse(data.json);
          const f = Array.isArray(j) ? j[1] : j;
          if (f && f.follower === account && f.following && Array.isArray(f.what) && f.what.includes('blog')) {
            follows.push({ following: f.following });
          }
        } catch { /* a malformed follow payload loses one follow, not the read */ }
      }
    }

    // votes_received: the upvotes ON the user's posts. get_active_votes per post; first organic wins.
    const votes_received = [];
    for (const p of posts) {
      try {
        const av = await rpc('condenser_api.get_active_votes', [account, p.permlink]).catch(() => []);
        for (const v of Array.isArray(av) ? av : []) {
          votes_received.push({ voter: v.voter, weight: v.rshares ?? v.weight ?? 0, time: v.time ?? v.last_update });
        }
      } catch { /* skip this post's votes; soft-fail */ }
    }

    // witness_votes field is authoritative for vote_for_a_witness even without a history op.
    const acct = Array.isArray(witnessVotesField) ? witnessVotesField[0] : null;
    if (acct && Array.isArray(acct.witness_votes)) {
      for (const w of acct.witness_votes) {
        if (!witness_votes.some((x) => x.witness === w)) witness_votes.push({ witness: w, approve: true });
      }
    }

    // stage 7 (set_profile): posting_json_metadata is the modern location, json_metadata the legacy
    // one. Either satisfies it — the detector only asks whether one required field is non-empty.
    let profile = null;
    for (const field of ['posting_json_metadata', 'json_metadata']) {
      if (profile || !acct || !acct[field]) continue;
      try {
        const meta = JSON.parse(acct[field]);
        if (meta && typeof meta.profile === 'object' && meta.profile) profile = meta.profile;
      } catch { /* unparseable metadata is not a profile; fall through to the next field */ }
    }

    return {
      account, posts, comments, votes_received, transfers_to_vesting, witness_votes,
      profile, follows, transfers_sent, delegations,
    };
  } catch {
    return null;
  }
}

// ── progress computation ─────────────────────────────────────────────────────────────────────────
// Deterministic. Given an account's activity, return per-stage completion + the next unlock key.
export function computeProgress(account, activity) {
  const { stages } = loadStages();
  const completions = detectCompletedStages(activity);

  const trackedStages = stages.filter((s) => completions[s.key]); // detector-evaluable spine
  const perStage = trackedStages.map((s) => ({
    id: s.id,
    key: s.key,
    label: s.label,
    tier: s.tier,
    complete: Boolean(completions[s.key]?.complete),
  }));

  const completedCount = perStage.filter((s) => s.complete).length;
  const next = nextStageFor(activity); // stage object or null (all detectable stages done)

  return {
    account,
    completed: completedCount,
    trackable: perStage.length,
    stages: perStage,
    nextStageKey: next ? next.key : null,
    allDetectableComplete: next === null,
  };
}

// ── stage catalog (trimmed for the public API; no internal-only fields needed by the UI) ───────────
export function stageCatalog() {
  const doc = loadStages();
  return {
    currency: doc._meta?.currency ?? 'MELEK',
    tier_legend: doc._meta?.tier_legend ?? {},
    stages: doc.stages.map((s) => ({
      id: s.id,
      key: s.key,
      tier: s.tier,
      label: s.label,
      description: s.description,
      infra_gated: Boolean(s.infra_gated),
      next_stage: s.next_stage ?? null,
    })),
  };
}

// ── responses ──────────────────────────────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  // Only emit CORS for the one allowed origin. Other origins get NO cross-origin grant.
  if (origin && origin.replace(/\/$/, '') === ALLOWED_ORIGIN) {
    return {
      'access-control-allow-origin': ALLOWED_ORIGIN,
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      vary: 'Origin',
    };
  }
  return { vary: 'Origin' };
}

function sendJson(res, code, body, origin) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(origin),
  });
  res.end(data);
}

function readBody(req, limit = 8192) {
  return new Promise((resolve) => {
    let buf = '';
    let aborted = false;
    req.on('data', (c) => {
      buf += c;
      if (buf.length > limit) { aborted = true; req.destroy(); }
    });
    req.on('end', () => resolve(aborted ? null : buf));
    req.on('error', () => resolve(null));
  });
}

// ── the request handler (exported for offline tests) ───────────────────────────────────────────────
export async function handler(req, res) {
  const origin = req.headers ? req.headers.origin : undefined;
  let url;
  try {
    url = new URL(req.url, BASE_URL);
  } catch {
    return sendJson(res, 400, { ok: false, reason: 'bad-url' }, origin);
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // CORS preflight.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  // GET /health
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }

  // GET /api/stages
  if (req.method === 'GET' && path === '/api/stages') {
    return sendJson(res, 200, { ok: true, ...stageCatalog() }, origin);
  }

  // GET /api/providers[?status=all&chain=MELEK] — the signup vendor-picker registry. The picker page
  // (account/get-started.html) renders this; third parties' entries show up here once merged/approved.
  if (req.method === 'GET' && path === '/api/providers') {
    const status = (url.searchParams.get('status') || 'active').trim();
    const chain = (url.searchParams.get('chain') || '').trim() || undefined;
    const allowed = new Set(['active', 'planned', 'community', 'all']);
    const s = allowed.has(status) ? status : 'active';
    return sendJson(res, 200, {
      ok: true,
      providers: listProviders({ status: s, chain }),
      schema: PROVIDER_SCHEMA,
    }, origin);
  }

  // GET /api/progress?account=X
  if (req.method === 'GET' && path === '/api/progress') {
    const account = (url.searchParams.get('account') || '').trim().toLowerCase();
    if (!validAccountName(account)) {
      return sendJson(res, 400, { ok: false, reason: 'invalid-account' }, origin);
    }
    const activity = await readAccountActivity(account);
    if (!activity) {
      // Honest soft-fail: chain unreachable / account not found. Never invent progress.
      return sendJson(res, 200, { ok: false, reason: 'chain-unavailable', account }, origin);
    }
    return sendJson(res, 200, { ok: true, ...computeProgress(account, activity) }, origin);
  }

  // GET /api/next?account=X
  if (req.method === 'GET' && path === '/api/next') {
    const account = (url.searchParams.get('account') || '').trim().toLowerCase();
    if (!validAccountName(account)) {
      return sendJson(res, 400, { ok: false, reason: 'invalid-account' }, origin);
    }
    const activity = await readAccountActivity(account);
    if (!activity) {
      return sendJson(res, 200, { ok: false, reason: 'chain-unavailable', account }, origin);
    }
    const next = nextStageFor(activity);
    if (!next) {
      return sendJson(res, 200, {
        ok: true, account, done: true,
        message: 'Every stage the Witness can detect from the chain is complete. The conversation continues.',
      }, origin);
    }
    const lesson = composeLessonPost(next); // deterministic, no LLM
    return sendJson(res, 200, {
      ok: true, account, done: false,
      stage: { id: next.id, key: next.key, tier: next.tier, label: next.label },
      title: lesson.title,
      body: lesson.body,
    }, origin);
  }

  // POST /api/verify-email { email }
  if (req.method === 'POST' && path === '/api/verify-email') {
    const raw = await readBody(req);
    if (raw == null) return sendJson(res, 400, { ok: false, reason: 'bad-body' }, origin);
    let input;
    try { input = JSON.parse(raw || '{}'); }
    catch { return sendJson(res, 400, { ok: false, reason: 'bad-json' }, origin); }
    const email = input && input.email;
    if (!isValidEmail(email)) {
      return sendJson(res, 400, { ok: false, reason: 'invalid-email' }, origin);
    }
    // Abuse cap CHECKED before the mailer runs (per-IP + per-email-address), but only RECORDED after
    // a mail actually goes out — a failed/unconfigured send must not burn the user's slot. Soft-fails open.
    const rlKey = { ip: clientIp(req), fingerprint: String(email).toLowerCase() };
    const rl = _emailLimiter.check(rlKey);
    if (!rl.allowed) {
      return sendJson(res, 429, { ok: false, reason: 'rate-limited', retryAfter: rl.retryAfter }, origin);
    }
    // Reuse the existing Resend flow. It soft-fails honestly when the key is absent (sent:false).
    const r = await startVerification(email, { baseUrl: ALLOWED_ORIGIN });
    if (!r || !r.ok) {
      return sendJson(res, 400, { ok: false, reason: (r && r.reason) || 'verify-failed' }, origin);
    }
    if (!r.sent) {
      // The flow ran but no mail went out — almost always a missing RESEND key. Be honest.
      // No mail sent => no slot consumed (the user can retry once the key is configured).
      return sendJson(res, 200, { ok: false, reason: 'email-not-configured', email: r.email }, origin);
    }
    _emailLimiter.record(rlKey); // count ONLY a verification mail that actually sent
    return sendJson(res, 200, { ok: true, sent: true, email: r.email, expiresAt: r.expiresAt }, origin);
  }

  // POST /api/report { target, kind, reason, reporter, context }
  // The condenser's "Report / Flag" control posts here. It writes to a REAL append-only moderation
  // store (integrations/moderation-flags.mjs) that the moderation layer / Hathor's resolution flow
  // reads — NOT a console.log, NOT an alert. POLICY.md §1: a report is a marker for a human, never a
  // delete/punish button, and false/mass reporting is itself a violation — hence the rate limit.
  if (req.method === 'POST' && path === '/api/report') {
    const raw = await readBody(req);
    if (raw == null) return sendJson(res, 400, { ok: false, reason: 'bad-body' }, origin);
    let input;
    try { input = JSON.parse(raw || '{}'); }
    catch { return sendJson(res, 400, { ok: false, reason: 'bad-json' }, origin); }

    const target = String((input && input.target) || '').trim();
    if (!target) return sendJson(res, 400, { ok: false, reason: 'missing-target' }, origin);
    const kind = normalizeKind(input && input.kind);
    const reason = String((input && input.reason) || '');
    // reporter is an opaque account/id the UI may pass; NOT PII, NOT trusted for auth. Used only to
    // dedup + rate-limit. Fall back to the target for the fingerprint so anon reports still get bound.
    const reporter = String((input && input.reporter) || '').trim().toLowerCase();
    const context = input && input.context;

    // Anti-abuse cap BEFORE the write (per-IP + per-reporter/target fingerprint). Soft-fails open.
    const rlKey = { ip: clientIp(req), fingerprint: reporter || target };
    const rl = _reportLimiter.check(rlKey);
    if (!rl.allowed) {
      return sendJson(res, 429, { ok: false, reason: 'rate-limited', retryAfter: rl.retryAfter }, origin);
    }

    let result;
    try { result = _modStore.raiseReport({ target, kind, reason, reporter, context }); }
    catch { result = { report: null, error: 'store-error' }; }
    if (!result || !result.report) {
      return sendJson(res, 500, { ok: false, reason: (result && result.error) || 'store-error' }, origin);
    }
    // Count a genuinely-new report against the cap; a deduped retry does NOT burn a slot.
    if (!result.deduped) _reportLimiter.record(rlKey);

    return sendJson(res, 200, {
      ok: true,
      deduped: Boolean(result.deduped),
      id: result.report.id,
      status: result.report.status,
      kind: result.report.kind,
      kinds: REPORT_KINDS,
      message: 'Thanks — this has been recorded for moderator review. Reports are evidence for a human, not an automatic removal.',
    }, origin);
  }

  return sendJson(res, 404, { ok: false, reason: 'not-found' }, origin);
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /signup\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`signup-help server on ${BASE_URL} (bound ${HOST}:${PORT})`);
    console.log(`  allowed origin: ${ALLOWED_ORIGIN}`);
    console.log(`  condenser RPC:  ${MELEK_RPC_URL} (read-only)`);
    console.log('  custody: ZERO keys, ZERO broadcast — read + compose + email-verify only.');
  });
}

// discord-upvote-handler.mjs — the "powdered upvote" command for the PIZZA-style Discord bot.
//
// A user asks Hathor for a small upvote on their MELEK-testnet post via Discord. Hathor casts a
// dust-weight `vote` (default 1%, operator-tunable up to a ceiling), rate-limited to ONE per
// requesting Discord account per day. PURE + TESTABLE: this parses the request, enforces the
// 1/day cap, and builds the Graphene `vote` op. It NEVER broadcasts and NEVER holds a key — the
// host (discord-upvote-cli.mjs) JIT-fetches Hathor's POSTING key and broadcasts (BRIEF.md §7).
//
//   import { handleUpvote, parseUpvote, makeUpvoteLedger, UPVOTE_DEFAULTS } from './discord-upvote-handler.mjs'
//   const out = await handleUpvote('!upvote @alice/my-post 2', { from: 'discorduser', deps: { broadcast, ledger } });
//   -> { ok, reply, op? }

const DAY_MS = 24 * 3600 * 1000;

export const UPVOTE_DEFAULTS = {
  voter: 'hathor',     // the witness account that casts the vote
  defaultPct: 1,       // "powdered" — 1% weight by default
  maxPct: 10,          // ceiling ("maybe more", but bounded) — operator may raise via rules
  perDay: 1,           // ONE upvote per requesting Discord account per day
};

// ── parseUpvote — Discord text → { author, permlink, pct } | null ──────────────────────────────────
// Accepts: "!upvote @author/permlink", "author/permlink", a full condenser/explorer URL
// (…/@author/permlink), with an optional trailing weight ("2" or "2%").
export function parseUpvote(text, { defaultPct = UPVOTE_DEFAULTS.defaultPct, maxPct = UPVOTE_DEFAULTS.maxPct } = {}) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/^\s*[!/]upvote\b\s*(.*)$/is);
  if (!m) return null;
  const rest = (m[1] || '').split('\n')[0].trim();
  if (!rest) return { author: '', permlink: '', pct: clampPct(defaultPct, maxPct), error: 'usage' };

  // Prefer the @author/permlink form (always present in a condenser/explorer URL); fall back to a
  // bare author/permlink only when there's no @ anywhere (a directly-typed ref). Preferring @ stops
  // the bare-form regex from grabbing the domain ("…melek.salon/hive-1") out of a pasted URL.
  const ref = rest.match(/@([a-z][a-z0-9.-]{1,15})\/([a-z0-9][a-z0-9-]{0,255})/i)
    || (rest.includes('@') ? null : rest.match(/\b([a-z][a-z0-9.-]{1,15})\/([a-z0-9][a-z0-9-]{0,255})/i));
  const author = ref ? ref[1].toLowerCase() : '';
  const permlink = ref ? ref[2].toLowerCase() : '';

  // optional trailing weight: a standalone number, optionally with % (not the one inside the permlink)
  let pct = defaultPct;
  const after = ref ? rest.slice(rest.indexOf(ref[0]) + ref[0].length) : rest;
  const w = after.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (w) pct = Number(w[1]);

  return { author, permlink, pct: clampPct(pct, maxPct) };
}

function clampPct(pct, maxPct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return UPVOTE_DEFAULTS.defaultPct;
  return Math.min(n, maxPct);
}

// ── makeUpvoteLedger — "1 per account per day" gate (injectable persistence + clock) ───────────────
// Keyed by the requesting Discord user. load()/save() make it durable across the per-request CLI
// spawn (same reason the tip ledger is file-backed). check() does not record; record() advances.
export function makeUpvoteLedger({ load, save } = {}) {
  const byUser = new Map(); // user -> { dayStart:ms, count:number }
  if (typeof load === 'function') {
    try {
      const raw = load();
      const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw) : [];
      for (const [u, rec] of entries) if (u && rec) byUser.set(String(u), rec);
    } catch { /* soft-fail: missing/corrupt store starts empty */ }
  }
  const persist = () => { if (typeof save === 'function') { try { save([...byUser.entries()]); } catch { /* soft-fail */ } } };
  return {
    check(user, perDay = UPVOTE_DEFAULTS.perDay, now = Date.now()) {
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const rec = byUser.get(user) || { dayStart, count: 0 };
      const used = rec.dayStart === dayStart ? rec.count : 0;
      if (used >= perDay) {
        const hrs = Math.ceil((dayStart + DAY_MS - now) / 3600000);
        return { ok: false, reason: `you already used your ${perDay}/day upvote — try again in ~${hrs}h` };
      }
      return { ok: true, reason: '' };
    },
    record(user, now = Date.now()) {
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const rec = byUser.get(user) || { dayStart, count: 0 };
      const used = rec.dayStart === dayStart ? rec.count : 0;
      byUser.set(user, { dayStart, count: used + 1 });
      persist();
    },
    _peek(user) { return byUser.get(user) || null; },
  };
}

// ── voteOp — the Graphene vote op (posting auth). weight is basis points: 1% = 100, 100% = 10000. ──
export function voteOp({ voter, author, permlink, pct }) {
  const weight = Math.round(Math.max(1, Math.min(100, Number(pct))) * 100); // pct% → bp, 1..10000
  return ['vote', { voter, author, permlink, weight }];
}

// ── handleUpvote — end to end. deps: { broadcast(op), ledger, voter, now } ─────────────────────────
export async function handleUpvote(text, { from, deps = {} } = {}) {
  const rules = { ...UPVOTE_DEFAULTS, ...(deps.rules || {}) };
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const voter = deps.voter || rules.voter;

  const t = parseUpvote(text, rules);
  if (!t) return { ok: false, kind: 'noop', reply: '' };
  if (!from) return { ok: false, reply: 'I could not tell who is asking.' };
  if (!t.author || !t.permlink) {
    return { ok: false, reply: 'Usage: `!upvote @author/permlink [percent]` — e.g. `!upvote @alice/my-first-post` (1% by default, 1 per day).' };
  }
  if (t.author === voter) return { ok: false, reply: `@${voter} does not vote on its own posts.` };

  // 1-per-account-per-day gate
  if (deps.ledger && typeof deps.ledger.check === 'function') {
    const g = deps.ledger.check(from, rules.perDay, now);
    if (!g.ok) return { ok: false, reply: `🛑 ${g.reason}` };
  }

  if (!deps.broadcast) return { ok: false, reply: 'Upvotes are not wired to the chain here.' };
  const op = voteOp({ voter, author: t.author, permlink: t.permlink, pct: t.pct });
  try {
    const r = await deps.broadcast(op);
    if (r && r.error) return { ok: false, reply: `Upvote failed: ${String(r.error).slice(0, 90)}` };
    if (deps.ledger && typeof deps.ledger.record === 'function') deps.ledger.record(from, now);
    const tx = r && (r.id || r.trx_id) ? String(r.id || r.trx_id).slice(0, 10) : 'sent';
    return { ok: true, op, reply: `🗳️ @${voter} gave @${t.author}/${t.permlink} a ${t.pct}% upvote on the MELEK testnet! (tx ${tx})` };
  } catch (e) {
    return { ok: false, reply: `Upvote failed: ${String(e.message || e).slice(0, 90)}` };
  }
}

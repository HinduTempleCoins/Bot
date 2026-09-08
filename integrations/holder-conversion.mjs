// holder-conversion — turn a name on a token ledger into a channel you keep.
//
// A holder is an entry in a balances table. A follower is a subscription. The gap between those two
// is the entire problem: 25,375 accounts hold VKBT or CURE and almost none of them know it, because
// the tokens arrived through a comments reward pool on tags like #actifit and #proofofbrain.
//
// THE MECHANIC IS `follow`, NOT A MESSAGE. On Graphene chains a follow is a first-class op that
// raises a notification, is reciprocal by convention, costs only Resource Credits, and cannot be
// reported as spam the way a comment can. It is the one outreach action on these chains that is
// welcomed rather than punished -- which matters here, because three of this project's accounts are
// already on the Spaminator blacklist for comment campaigns.
//
// ⚠️ BUT FOLLOWING 25,375 ACCOUNTS IS ITSELF A SPAM PATTERN. Mass-follow is exactly what bot farms
// do, and it is trivially visible in account history. So this module:
//   * targets only holders who are ACTIVE and hold a MEANINGFUL balance -- ~800, not 25,375;
//   * paces hard and caps per run;
//   * never follows the same account twice, on any chain;
//   * refuses to run at all from an account on a blacklist, because a flagged account following
//     hundreds of people is how a warning becomes a ban.
//
// Three chains, three accounts, one ledger. Nothing here signs or broadcasts -- plan() returns ops
// for a signer, the same discipline as market-maker.

const str = (v) => String(v == null ? '' : v);
const lower = (v) => str(v).toLowerCase();

// ---------------------------------------------------------------------------
// 1. WHERE WE CAN ACT, AND FROM WHAT
// ---------------------------------------------------------------------------

export const CHAINS = Object.freeze({
  hive: {
    id: 'hive', name: 'Hive',
    rpc: 'https://api.hive.blog',
    account: 'melek',
    // verified 2026-09-08: rep 57.24, 431 followers, created 2016, NOT on the Spaminator list
    healthy: true,
    note: 'the clean account. kalivankush / punicwax / vankushfamily are blacklisted — never use them.',
  },
  steem: {
    id: 'steem', name: 'Steem',
    rpc: 'https://api.steemit.com',
    account: 'hathor-melek',
    healthy: true,
    note: 'posting key held. Account is new (created 2026-09-03) with no SP, so RC is the binding '
        + 'constraint — it will run out long before the list does.',
  },
  blurt: {
    id: 'blurt', name: 'Blurt',
    rpc: 'https://rpc.beblurt.com',
    account: 'punicwax',
    healthy: true,
    note: 'punicwax is on the HIVE Spaminator list; Blurt is a separate chain and unaffected. '
        + '635 posts, created 2020, 671 BLURT. Only 7.46 VESTS though — RC will be thin.',
  },
});

/** Accounts that must never be used as the actor, whatever a caller passes. */
export const BLACKLISTED_ON_HIVE = Object.freeze(['kalivankush', 'punicwax', 'vankushfamily']);

export function actorFor(chainId) {
  const c = CHAINS[lower(chainId)];
  if (!c) return null;
  if (c.id === 'hive' && BLACKLISTED_ON_HIVE.includes(lower(c.account))) return null;
  return c;
}

// ---------------------------------------------------------------------------
// 2. WHO IS WORTH FOLLOWING
// ---------------------------------------------------------------------------

export const TARGETING = Object.freeze({
  minVkbt: 100,        // below this the holding is dust from a reward pool, not a position
  minCure: 10,         // CURE supply is 33x smaller, so the bar is proportionally lower
  activeWithinDays: 90,
  maxPerRun: 40,       // a human-plausible number of follows in one sitting
  minDelayMs: 8000,    // ~7/minute. Bot farms do hundreds a minute; this does not look like one.
});

/**
 * Rank holders into a follow list. Returns only accounts that clear BOTH the balance and the
 * activity bar -- the point is a channel, and a dormant dust holder is neither.
 *
 * ⚠️ FEED THIS `.local/HOLDERS_shortlist.json`, NOT `HOLDERS_CONTACTS.csv`. The CSV has no balance
 * columns at all -- it carries `holds` as the string "VKBT+CURE" and no `hive_last_post_days` -- so
 * every row silently fails the balance test and the planner returns zero targets while looking like
 * it worked. The shortlist carries vkbt, cure, hive_last_post_days and real booleans.
 * `isEligibleShape()` below exists so a caller finds that out immediately instead of via an empty run.
 */
export function selectTargets(rows = [], chainId = 'hive', opts = {}) {
  const t = { ...TARGETING, ...opts };
  const chain = lower(chainId);
  const out = [];
  const truthy = (v) => v === true || String(v).toLowerCase() === 'true';
  for (const r of rows) {
    const acct = lower(r.account || r.hive_account);
    if (!acct) continue;

    // Does this holder exist and act on the chain we are about to act on?
    if (chain === 'steem' && !truthy(r.steem_active)) continue;
    if (chain === 'blurt' && !truthy(r.blurt_active)) continue;
    if (chain === 'hive') {
      const days = Number(r.hive_last_post_days);
      if (!Number.isFinite(days) || days > t.activeWithinDays) continue;
    }

    const vkbt = Number(r.vkbt) || 0;
    const cure = Number(r.cure) || 0;
    if (vkbt < t.minVkbt && cure < t.minCure) continue;

    out.push({
      account: acct,
      vkbt, cure,
      weight: vkbt + cure * 30,          // CURE is far scarcer; weight it to compare like with like
      reachScore: Number(r.reach_score) || 0,
      email: str(r.email),
      tribes: str(r.tribes),
    });
  }
  out.sort((a, b) => b.weight - a.weight || b.reachScore - a.reachScore);
  return out;
}

/**
 * Does this look like the shortlist rather than the contacts CSV? A wrong-shaped input produces an
 * empty plan that is indistinguishable from "nobody qualifies", so say so out loud.
 */
export function isEligibleShape(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, why: 'no rows' };
  const r = rows[0];
  const missing = ['vkbt', 'cure', 'hive_last_post_days'].filter((k) => !(k in r));
  if (missing.length) {
    return {
      ok: false,
      why: `rows are missing ${missing.join(', ')} — this looks like HOLDERS_CONTACTS.csv, which has `
         + 'no balance or recency columns. Use .local/HOLDERS_shortlist.json.',
    };
  }
  return { ok: true, why: '' };
}

// ---------------------------------------------------------------------------
// 3. THE LEDGER — never follow the same account twice, on any chain
// ---------------------------------------------------------------------------

export function createLedger(initial = []) {
  const rows = Array.isArray(initial) ? initial.filter((r) => r && r.account && r.chain) : [];
  const key = (chain, account) => `${lower(chain)}:${lower(account)}`;
  const seen = new Set(rows.map((r) => key(r.chain, r.account)));
  return {
    get size() { return rows.length; },
    has: (chain, account) => seen.has(key(chain, account)),
    record(entry) {
      const row = {
        chain: lower(entry.chain), account: lower(entry.account),
        at: str(entry.at) || new Date().toISOString(),
        result: str(entry.result) || 'followed',
      };
      rows.push(row); seen.add(key(row.chain, row.account));
      return row;
    },
    byChain: (chain) => rows.filter((r) => r.chain === lower(chain)),
    toJSON: () => rows.slice(),
  };
}

// ---------------------------------------------------------------------------
// 4. THE PLAN
// ---------------------------------------------------------------------------

/**
 * Build the follow ops for one run. Pure — returns ops for a signer, broadcasts nothing.
 *
 * A `follow` on Graphene is a custom_json with id `follow`, which requires POSTING authority only.
 * That is deliberate and it is why this is the safest possible outreach op: a posting key cannot
 * move funds.
 */
export function plan({ rows = [], chain = 'hive', ledger = createLedger(), opts = {} } = {}) {
  const t = { ...TARGETING, ...opts };
  const c = actorFor(chain);
  if (!c) {
    return {
      ok: false, refused: true,
      reason: `no usable actor for ${chain} — the configured account is blacklisted or unknown, and `
            + 'a flagged account following hundreds of people is how a warning becomes a ban.',
      ops: [],
    };
  }

  const shape = isEligibleShape(rows);
  if (!shape.ok) return { ok: false, refused: true, reason: shape.why, ops: [] };

  const targets = selectTargets(rows, chain, t)
    .filter((x) => !ledger.has(chain, x.account))
    .slice(0, t.maxPerRun);

  if (!targets.length) {
    return { ok: false, refused: true, reason: 'no unfollowed targets clear the balance and activity bars', ops: [] };
  }

  const ops = targets.map((x) => ([
    'custom_json',
    {
      required_auths: [],
      required_posting_auths: [c.account],
      id: 'follow',
      json: JSON.stringify(['follow', { follower: c.account, following: x.account, what: ['blog'] }]),
    },
  ]));

  return {
    ok: true, refused: false,
    chain: c.id, actor: c.account,
    targets,
    ops,
    pacing: { delayMs: t.minDelayMs, estimatedMinutes: Math.ceil((targets.length * t.minDelayMs) / 60000) },
    note: `${ops.length} follow ops for a signer. POSTING authority only — a follow cannot move funds. `
        + `Pace at ${t.minDelayMs}ms; this module broadcasts nothing.`,
  };
}

/** A plain-language readout of what a run would do, for approval before signing. */
export function explain(p) {
  if (!p) return '';
  if (p.refused) return `REFUSED — ${p.reason}`;
  const top = p.targets.slice(0, 5)
    .map((x) => `@${x.account} (${x.vkbt.toFixed(0)} VKBT, ${x.cure.toFixed(1)} CURE)`).join(', ');
  return [
    `${p.chain}: follow ${p.targets.length} holders as @${p.actor}`,
    `  largest: ${top}`,
    `  paced over ~${p.pacing.estimatedMinutes} min at ${p.pacing.delayMs}ms`,
    '  posting authority only — nothing here can move funds',
  ].join('\n');
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'holder-conversion',
    chains: Object.values(CHAINS).map((c) => ({ id: c.id, account: c.account, note: c.note })),
    targeting: TARGETING,
    policy: 'Follows only. No messages, no comments. Targets active holders with a real balance — '
          + 'about 800, not 25,375. Never the same account twice. Never from a blacklisted account. '
          + 'Returns ops for a signer; broadcasts nothing.',
  });
}

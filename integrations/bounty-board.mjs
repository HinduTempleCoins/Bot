// bounty-board — the reason someone shows up, instead of the reason they were interrupted.
//
// Operator's framing: "You come to get Paid Bounties for using Your Socials, and Eventually maybe
// You make a Token Yourself." That inverts the whole outreach problem. Cold outreach begs for
// attention; a bounty board means people arrive wanting something, and the token-creation step is
// what keeps them after the first payout.
//
// THE THING THAT DECIDES WHETHER THIS WORKS IS PROOF, NOT REWARD SIZE.
//
// Every bounty programme that has died, died of farming. A task anyone can claim without evidence
// attracts accounts that exist only to claim it, and the honest participants leave because the pool
// is being split with bots. So a bounty here CANNOT be created without a verification method, and
// `verify()` returns `unverifiable` rather than a guess when it cannot check.
//
// ⚠️ AND THE SECOND HONESTY PROBLEM, WHICH IS OURS SPECIFICALLY.
//
// Paying someone in a token they cannot sell is not paying them. Measured 2026-09-08: VKBT's bid is
// 0.00001902 HIVE with 0.36 HIVE of total depth, CURE's ask is 2,638x its bid. `describeReward()`
// therefore states the fill reality on the bounty itself. A bounty board that quotes a mark price it
// knows is unreachable is running a con, however unintentionally.
//
// House rules: ESM, soft-fail-never-throw, no keys. Nothing here pays anyone; it produces a payout
// instruction for whatever holds the key.

const str = (v) => String(v == null ? '' : v);
const lower = (v) => str(v).toLowerCase().trim();
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// 1. WHAT CAN BE ASKED FOR
//
// Every type declares how a claim is PROVED. A type with no proof method cannot exist -- that is
// enforced in createBounty(), not left to the author's judgement.
// ---------------------------------------------------------------------------

export const TASK_TYPES = Object.freeze({
  post: {
    id: 'post', label: 'Publish a post',
    proof: 'onchain-post',
    how: 'The post must exist on Hive/Steem/Blurt under the required tag, authored by the claimant.',
  },
  reshare: {
    id: 'reshare', label: 'Reblog / reshare',
    proof: 'onchain-reblog',
    how: 'A reblog custom_json by the claimant naming the target post.',
  },
  follow: {
    id: 'follow', label: 'Follow an account',
    proof: 'onchain-follow',
    how: 'The follow relationship is readable from the chain.',
  },
  offchain_post: {
    id: 'offchain_post', label: 'Post on an off-chain platform',
    proof: 'url-review',
    how: 'A public URL a human can open. ⚠️ NOT auto-verifiable — a person approves it.',
  },
  thunderclap: {
    id: 'thunderclap', label: 'Post at a coordinated moment',
    proof: 'url-review-timed',
    how: 'A public URL, published inside the campaign window. The platform posts NOTHING on anyone\'s '
       + 'behalf — every participant posts themselves.',
  },
  referral: {
    id: 'referral', label: 'Bring someone who completes a bounty',
    proof: 'derived',
    how: 'Paid only when the referred account has itself completed and been verified.',
  },
  build: {
    id: 'build', label: 'Ship something',
    proof: 'url-review',
    how: 'A repo, a PR, or a running URL. Reviewed by a person.',
  },
});

export const PROOF_METHODS = Object.freeze(
  [...new Set(Object.values(TASK_TYPES).map((t) => t.proof))],
);

/** Proof methods a machine can settle without a human. */
export const AUTO_VERIFIABLE = Object.freeze(['onchain-post', 'onchain-reblog', 'onchain-follow', 'derived']);

// ---------------------------------------------------------------------------
// 2. THE REWARD, DESCRIBED HONESTLY
// ---------------------------------------------------------------------------

// Live book state, 2026-09-08. Kept as data so it can be refreshed rather than hidden in prose.
export const TOKEN_REALITY = Object.freeze({
  VKBT: { bidHive: 0.00001902, askHive: 0.000945, depthHive: 0.36,
    note: 'ask is 50x the bid; 0.36 HIVE of total bid depth' },
  CURE: { bidHive: 0.00001592, askHive: 0.04199, depthHive: 2.33,
    note: 'ask is 2,638x the bid' },
  KULA: { bidHive: null, askHive: null, depthHive: null,
    note: 'trades on KulaSwap (PRANA), not on Hive-Engine' },
});

/**
 * State plainly what a reward is worth to sell today. A bounty that quotes a number the claimant
 * cannot realise is dishonest even when the number is technically the market price.
 */
export function describeReward(symbol, amount) {
  const sym = str(symbol).toUpperCase();
  const amt = Number(amount) || 0;
  const t = TOKEN_REALITY[sym];
  if (!t) return { symbol: sym, amount: amt, honest: `${amt} ${sym}`, caveat: '' };
  if (t.bidHive == null) {
    return { symbol: sym, amount: amt, honest: `${amt} ${sym}`, caveat: t.note };
  }
  const atBid = amt * t.bidHive;
  const sellable = Math.min(atBid, t.depthHive);
  return {
    symbol: sym, amount: amt,
    markHive: Number(atBid.toFixed(6)),
    caveat: `${t.note}. At the top bid this is about ${atBid.toFixed(6)} HIVE, and the whole book `
          + `only holds ${t.depthHive} HIVE — so a claimant selling immediately would realise less `
          + `than that.`,
    honest: `${amt} ${sym} (~${atBid.toFixed(6)} HIVE at the current bid, thin book)`,
    fullyLiquid: atBid <= sellable && atBid > 0,
  };
}

// ---------------------------------------------------------------------------
// 3. BOUNTIES
// ---------------------------------------------------------------------------

export function createBounty({
  id = '', title = '', type = '', reward = {}, tag = '', target = '',
  maxClaims = 0, opensAt = '', closesAt = '', window = null, notes = '',
} = {}) {
  const t = TASK_TYPES[lower(type)];
  const problems = [];
  if (!str(title).trim()) problems.push('a bounty needs a title');
  if (!t) problems.push(`unknown task type "${type}" — every type must declare how a claim is proved`);
  if (!Number(reward.amount)) problems.push('a bounty with no reward is a request, not a bounty');
  if (!str(reward.symbol).trim()) problems.push('reward needs a symbol');
  if (!Number(maxClaims)) problems.push('maxClaims must be set — an uncapped bounty is an open tap');
  if (t && t.id === 'thunderclap' && !(window && window.start && window.end)) {
    problems.push('a thunderclap needs a window {start,end} — the coordinated moment IS the bounty');
  }

  if (problems.length) return { ok: false, problems, bounty: null };

  const r = describeReward(reward.symbol, reward.amount);
  return {
    ok: true, problems: [],
    bounty: {
      id: str(id) || `b_${lower(title).replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
      title: str(title), type: t.id,
      proof: t.proof, autoVerifiable: AUTO_VERIFIABLE.includes(t.proof),
      how: t.how,
      reward: { symbol: r.symbol, amount: r.amount, honest: r.honest, caveat: r.caveat },
      tag: lower(tag), target: lower(target),
      maxClaims: Number(maxClaims),
      opensAt: str(opensAt) || now(), closesAt: str(closesAt),
      window: window || null,
      notes: str(notes),
      created: now(),
    },
  };
}

// ---------------------------------------------------------------------------
// 4. CLAIMS
// ---------------------------------------------------------------------------

export function createBoard(initial = {}) {
  const bounties = new Map(Object.entries(initial.bounties || {}));
  const claims = Array.isArray(initial.claims) ? initial.claims.slice() : [];
  const key = (b, a) => `${str(b)}::${lower(a)}`;
  const claimed = new Set(claims.map((c) => key(c.bounty, c.account)));

  const api = {
    get bountyCount() { return bounties.size; },
    get claimCount() { return claims.length; },
    add(b) { if (b && b.id) bounties.set(b.id, b); return b; },
    get: (id) => bounties.get(str(id)) || null,
    open: (at = now()) => [...bounties.values()].filter((b) =>
      (!b.opensAt || b.opensAt <= at) && (!b.closesAt || b.closesAt >= at)
      && api.claimsFor(b.id).length < b.maxClaims),

    claimsFor: (id) => claims.filter((c) => c.bounty === str(id)),

    /** Register a claim. One per account per bounty, never more. */
    claim({ bounty, account, proofUrl = '', at = now() } = {}) {
      const b = api.get(bounty);
      if (!b) return { ok: false, reason: 'no such bounty' };
      if (!lower(account)) return { ok: false, reason: 'no account' };
      if (claimed.has(key(bounty, account))) return { ok: false, reason: 'already claimed by this account' };
      if (api.claimsFor(bounty).length >= b.maxClaims) return { ok: false, reason: 'bounty is fully claimed' };
      if (b.closesAt && at > b.closesAt) return { ok: false, reason: 'bounty has closed' };
      const c = {
        bounty: str(bounty), account: lower(account), proofUrl: str(proofUrl),
        at: str(at), status: 'pending', verifiedBy: '', reason: '',
      };
      claims.push(c); claimed.add(key(bounty, account));
      return { ok: true, claim: c };
    },

    settle(bountyId, account, verdict) {
      const c = claims.find((x) => x.bounty === str(bountyId) && x.account === lower(account));
      if (!c) return { ok: false, reason: 'no such claim' };
      c.status = verdict.ok ? 'verified' : 'rejected';
      c.verifiedBy = str(verdict.method);
      c.reason = str(verdict.reason);
      return { ok: true, claim: c };
    },

    payable: () => claims.filter((c) => c.status === 'verified' && !c.paid),
    markPaid(bountyId, account, ref) {
      const c = claims.find((x) => x.bounty === str(bountyId) && x.account === lower(account));
      if (!c) return { ok: false, reason: 'no such claim' };
      c.paid = { at: now(), ref: str(ref) };
      return { ok: true, claim: c };
    },
    toJSON: () => ({ bounties: Object.fromEntries(bounties), claims: claims.slice() }),
  };
  return api;
}

// ---------------------------------------------------------------------------
// 5. VERIFICATION
//
// `readers` is injected so this is testable offline and so the module never talks to a chain itself.
// ---------------------------------------------------------------------------

/**
 * Verify one claim. Returns { ok, method, reason }.
 * ⚠️ An unverifiable claim is NEVER approved by default. It returns ok:false with method
 * 'unverifiable', which routes it to a human — silently approving what you cannot check is exactly
 * how a bounty pool gets farmed.
 */
export async function verify(claim = {}, bounty = {}, readers = {}) {
  const acct = lower(claim.account);
  if (!acct) return { ok: false, method: 'none', reason: 'no account on the claim' };

  try {
    if (bounty.proof === 'onchain-post') {
      if (typeof readers.hasPost !== 'function') {
        return { ok: false, method: 'unverifiable', reason: 'no post reader supplied' };
      }
      const found = await readers.hasPost(acct, bounty.tag, bounty.opensAt);
      return found
        ? { ok: true, method: 'onchain-post', reason: `post found under #${bounty.tag}` }
        : { ok: false, method: 'onchain-post', reason: `no post by @${acct} under #${bounty.tag} since the bounty opened` };
    }

    if (bounty.proof === 'onchain-follow') {
      if (typeof readers.follows !== 'function') {
        return { ok: false, method: 'unverifiable', reason: 'no follow reader supplied' };
      }
      const ok = await readers.follows(acct, bounty.target);
      return ok
        ? { ok: true, method: 'onchain-follow', reason: `@${acct} follows @${bounty.target}` }
        : { ok: false, method: 'onchain-follow', reason: 'follow not found on chain' };
    }

    if (bounty.proof === 'onchain-reblog') {
      if (typeof readers.hasReblog !== 'function') {
        return { ok: false, method: 'unverifiable', reason: 'no reblog reader supplied' };
      }
      const ok = await readers.hasReblog(acct, bounty.target);
      return ok
        ? { ok: true, method: 'onchain-reblog', reason: 'reblog found' }
        : { ok: false, method: 'onchain-reblog', reason: 'reblog not found' };
    }

    if (bounty.proof === 'url-review-timed') {
      if (!str(claim.proofUrl)) return { ok: false, method: 'none', reason: 'no proof URL' };
      const w = bounty.window || {};
      if (claim.at < w.start || claim.at > w.end) {
        return { ok: false, method: 'window', reason: `claimed at ${claim.at}, outside ${w.start}..${w.end}` };
      }
      return { ok: false, method: 'unverifiable', reason: 'inside the window; needs a human to open the URL' };
    }

    if (bounty.proof === 'url-review') {
      if (!str(claim.proofUrl)) return { ok: false, method: 'none', reason: 'no proof URL' };
      return { ok: false, method: 'unverifiable', reason: 'needs a human to open the URL' };
    }

    if (bounty.proof === 'derived') {
      if (typeof readers.referralCompleted !== 'function') {
        return { ok: false, method: 'unverifiable', reason: 'no referral reader supplied' };
      }
      const ok = await readers.referralCompleted(acct);
      return ok
        ? { ok: true, method: 'derived', reason: 'the referred account completed a bounty' }
        : { ok: false, method: 'derived', reason: 'the referred account has not completed anything yet' };
    }
  } catch (e) {
    return { ok: false, method: 'error', reason: str(e && e.message).slice(0, 120) };
  }
  return { ok: false, method: 'unverifiable', reason: `no verifier for proof type "${bounty.proof}"` };
}

// ---------------------------------------------------------------------------
// 6. THUNDERCLAP
//
// The original Thunderclap died in 2018 when the platforms revoked the API access it depended on --
// it posted on users' behalf, and that permission is what got withdrawn. This version cannot die
// that way, because it holds no tokens and posts for nobody: it coordinates a moment and counts who
// showed up. That is also why it cannot get an app banned.
// ---------------------------------------------------------------------------

export function thunderclap({ title, window, reward, maxClaims = 500, message = '', links = [] } = {}) {
  const built = createBounty({
    title: str(title) || 'Coordinated post',
    type: 'thunderclap', reward, maxClaims, window,
    notes: 'Everyone posts themselves at the agreed moment. Nothing is posted on your behalf and no '
         + 'account access is requested.',
  });
  if (!built.ok) return built;
  return {
    ok: true, problems: [],
    bounty: {
      ...built.bounty,
      suggestedMessage: str(message),
      links: (Array.isArray(links) ? links : []).map(str),
      pledgePolicy: 'A pledge is not a post. Reach is only counted from claims that actually carry a '
                  + 'URL published inside the window.',
    },
  };
}

/** Honest reach: pledges are intentions, verified posts are the number that means anything. */
export function clapStatus(board, bountyId) {
  const b = board.get(bountyId);
  if (!b) return null;
  const cs = board.claimsFor(bountyId);
  return {
    bounty: bountyId, title: b.title, window: b.window,
    pledged: cs.length,
    posted: cs.filter((c) => c.proofUrl).length,
    verified: cs.filter((c) => c.status === 'verified').length,
    slotsLeft: Math.max(0, b.maxClaims - cs.length),
    note: 'pledged is an intention; verified is the only number worth reporting to anyone.',
  };
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'bounty-board',
    taskTypes: Object.values(TASK_TYPES).map((t) => ({ id: t.id, label: t.label, proof: t.proof, how: t.how })),
    autoVerifiable: AUTO_VERIFIABLE,
    policy: 'Every bounty declares how a claim is proved. One claim per account. An unverifiable '
          + 'claim goes to a human, never to auto-approval. Reward descriptions state what the token '
          + 'would actually fill for, not its mark price. This module pays nobody — it produces '
          + 'payout instructions for whoever holds the key.',
  });
}

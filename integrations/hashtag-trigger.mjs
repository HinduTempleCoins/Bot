// hashtag-trigger.mjs — PURE hashtag-triggered reward/vote rule evaluator (backlog 342/348/349).
//
// WHAT THIS IS (and is NOT). This is a deterministic RULE-MATCHER, nothing else. Given a post and a
// list of configured trigger rules, it answers: which rules fire, how big a stake-weighted reward
// each fires for (capped at the pool that funds it), and whether that author already triggered the
// same tag inside a cooldown window. It does NO network IO, holds NO keys, and NEVER broadcasts —
// the caller decides whether to act (vote / transfer) on what this returns.
//
// It is intentionally DISTINCT from its neighbors:
//   - soapbox/hashtags.mjs  — FETCHES cross-platform trending tags (network, estimates). Not us.
//   - curation-engine.mjs   — SCORES posts for curation quality. Not us.
// This file just matches author-supplied tags against operator-configured trigger rules.
//
// API:
//   parseTags(text)                              -> normalized lowercase tag array
//   matchRules(post, rules)                      -> [{tag, weightPct, rewardToken, minStake, rule}]
//   computeReward({matched, voterStake, pools})  -> {ok, rewards:[{tag, rewardToken, amount, capped}]}
//   dedupeTriggers(matched, history, windowSec, now) -> matched minus tags already fired in window
//
// House rules: ESM, soft-fail (never throw — return [] / {ok:false}), injectable `now`, no network,
// no broadcast. CLI guarded by process.argv[1].
//
//   import { parseTags, matchRules, computeReward, dedupeTriggers } from './hashtag-trigger.mjs'
//   node integrations/hashtag-trigger.mjs        # print a worked example

// A tag is letters/digits/underscore, 1..64 chars, lowercased. Leading '#' optional.
const TAG_RE = /#?([a-z0-9_]{1,64})/gi;

// parseTags(text) — pull normalized, de-duplicated, lowercase tags out of a post body/title.
// Accepts a string, or {title, body, tags} shaped object. Soft-fail -> [].
export function parseTags(text) {
  try {
    let src = '';
    if (typeof text === 'string') {
      src = text;
    } else if (text && typeof text === 'object') {
      const parts = [];
      if (typeof text.title === 'string') parts.push(text.title);
      if (typeof text.body === 'string') parts.push(text.body);
      if (Array.isArray(text.tags)) parts.push(text.tags.filter((t) => typeof t === 'string').map((t) => `#${t}`).join(' '));
      src = parts.join(' ');
    } else {
      return [];
    }
    const out = [];
    const seen = new Set();
    for (const m of src.matchAll(TAG_RE)) {
      const tag = (m[1] || '').toLowerCase();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
    return out;
  } catch {
    return [];
  }
}

// Normalize a single configured rule into the canonical shape, or null if unusable.
function normRule(r) {
  if (!r || typeof r !== 'object') return null;
  const tag = typeof r.tag === 'string' ? r.tag.replace(/^#/, '').toLowerCase() : '';
  if (!tag || !/^[a-z0-9_]{1,64}$/.test(tag)) return null;
  let weightPct = Number(r.weightPct);
  if (!Number.isFinite(weightPct) || weightPct < 0) weightPct = 0;
  if (weightPct > 100) weightPct = 100; // a vote weight is at most 100%
  const rewardToken = typeof r.rewardToken === 'string' && r.rewardToken ? r.rewardToken : null;
  let minStake = Number(r.minStake);
  if (!Number.isFinite(minStake) || minStake < 0) minStake = 0;
  return { tag, weightPct, rewardToken, minStake };
}

// matchRules(post, rules) — which configured rules fire for this post.
// A rule fires iff its tag appears in the post's parsed tags. Soft-fail -> [].
// (The minStake gate is applied later in computeReward, where voterStake is known.)
export function matchRules(post, rules) {
  try {
    if (!Array.isArray(rules)) return [];
    const tags = new Set(parseTags(post));
    if (tags.size === 0) return [];
    const out = [];
    const firedTags = new Set();
    for (const raw of rules) {
      const rule = normRule(raw);
      if (!rule) continue;
      if (!tags.has(rule.tag)) continue;
      if (firedTags.has(rule.tag)) continue; // one fire per tag — first matching rule wins
      firedTags.add(rule.tag);
      out.push({ tag: rule.tag, weightPct: rule.weightPct, rewardToken: rule.rewardToken, minStake: rule.minStake, rule });
    }
    return out;
  } catch {
    return [];
  }
}

// computeReward({matched, voterStake, pools}) — stake-weighted reward per fired rule, pool-capped.
//   voterStake : the author's/voter's staked-token balance (gates minStake, scales the reward).
//   pools      : { token -> remaining balance }. A reward is capped at its pool's balance, and
//                pools deplete across rules in order so two rules can't double-spend one pool.
// reward = weightPct% * voterStake, capped at the remaining pool for rewardToken. Soft-fail -> {ok:false}.
export function computeReward({ matched, voterStake, pools } = {}) {
  try {
    if (!Array.isArray(matched)) return { ok: false, rewards: [] };
    const stake = Number(voterStake);
    if (!Number.isFinite(stake) || stake < 0) return { ok: false, rewards: [] };
    const remaining = new Map();
    if (pools && typeof pools === 'object') {
      for (const [k, v] of Object.entries(pools)) {
        const bal = Number(v);
        if (Number.isFinite(bal) && bal >= 0) remaining.set(k, bal);
      }
    }
    const rewards = [];
    for (const m of matched) {
      if (!m || typeof m !== 'object') continue;
      const minStake = Number.isFinite(Number(m.minStake)) ? Number(m.minStake) : 0;
      if (stake < minStake) continue; // under the stake gate — no reward
      const token = m.rewardToken;
      if (!token) continue; // vote-only rule: no token payout to compute
      const weightPct = Number.isFinite(Number(m.weightPct)) ? Number(m.weightPct) : 0;
      const want = (weightPct / 100) * stake;
      const pool = remaining.has(token) ? remaining.get(token) : 0;
      const amount = Math.max(0, Math.min(want, pool));
      const capped = want > pool;
      remaining.set(token, pool - amount);
      rewards.push({ tag: m.tag, rewardToken: token, amount, capped });
    }
    return { ok: true, rewards };
  } catch {
    return { ok: false, rewards: [] };
  }
}

const now_ = (now) => (Number.isFinite(now) ? now : Date.now());

// dedupeTriggers(matched, history, windowSec, now) — drop tags this author already triggered
// inside the cooldown window. history: [{author, tag, at}] where `at` is epoch ms.
// Soft-fail -> returns `matched` unchanged (fail-open is wrong for payouts, so on bad input we
// return [] to be safe). Each matched item is expected to carry `author`.
export function dedupeTriggers(matched, history, windowSec, now) {
  try {
    if (!Array.isArray(matched)) return [];
    const win = Number(windowSec);
    const windowMs = Number.isFinite(win) && win > 0 ? win * 1000 : 0;
    const cutoff = now_(now) - windowMs;
    const hist = Array.isArray(history) ? history : [];
    // Build a set of "author|tag" that fired at-or-after the cutoff.
    const recent = new Set();
    for (const h of hist) {
      if (!h || typeof h !== 'object') continue;
      const at = Number(h.at);
      if (!Number.isFinite(at)) continue;
      if (windowMs > 0 && at < cutoff) continue;
      const author = typeof h.author === 'string' ? h.author : '';
      const tag = typeof h.tag === 'string' ? h.tag.toLowerCase() : '';
      if (!tag) continue;
      recent.add(`${author}|${tag}`);
    }
    const out = [];
    const firedNow = new Set();
    for (const m of matched) {
      if (!m || typeof m !== 'object' || typeof m.tag !== 'string') continue;
      const author = typeof m.author === 'string' ? m.author : '';
      const key = `${author}|${m.tag.toLowerCase()}`;
      if (recent.has(key) || firedNow.has(key)) continue; // already fired in window (or twice this batch)
      firedNow.add(key);
      out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

// --- CLI: worked example (guarded; no IO beyond stdout) ---
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const post = { author: 'alice', title: 'My #MELEK build', body: 'staking on #prana and #melek again' };
  const rules = [
    { tag: 'melek', weightPct: 50, rewardToken: 'MBD', minStake: 10 },
    { tag: 'prana', weightPct: 100, rewardToken: 'PRANA', minStake: 1000 },
    { tag: 'vouch', weightPct: 25 }, // vote-only
  ];
  const matched = matchRules(post, rules).map((m) => ({ ...m, author: post.author }));
  const reward = computeReward({ matched, voterStake: 100, pools: { MBD: 30, PRANA: 5000 } });
  const history = [{ author: 'alice', tag: 'melek', at: Date.now() - 60_000 }];
  const fresh = dedupeTriggers(matched, history, 3600, Date.now());
  console.log(JSON.stringify({ tags: parseTags(post), matched, reward, freshAfterDedupe: fresh }, null, 2));
}

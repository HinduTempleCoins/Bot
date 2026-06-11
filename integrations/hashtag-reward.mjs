// hashtag-reward.mjs — deterministic reward computation for hashtag-triggered campaigns.
//
// Backlog 6287fa532e: "Hashtag-triggered reward computation (deterministic distribution)".
//
// This is a PURE CALCULATOR. Given a set of posts that carry one or more campaign hashtags and a
// fixed reward budget, it computes who earns what. There are NO broadcasts, NO chain ops, NO IO —
// just math. It complements integrations/soapbox/hashtags.mjs, which only PARSES/aggregates tags;
// this module turns tag matches into a deterministic payout split.
//
// Money invariants (the load-bearing part):
//   - Budget is treated as a whole-dollar amount, distributed at INTEGER-CENT granularity.
//   - The proportional split rounds DOWN per author so the sum of rewards is ALWAYS <= budget.
//   - Whatever is not handed out (the rounding remainder) is reported as `leftover`. We never
//     overspend the budget, and `totalDistributed + leftover === budget` (to the cent) always holds.
//
// Soft-fail, never throw: no eligible posts -> empty distributions + full leftover; a NaN/garbage
// budget -> 0 (and 0 leftover); bad inputs coerce to empty rather than blowing up.
//
// House style: ESM, esc() any HTML interpolation, CLI guarded by process.argv[1].

/** HTML-escape any interpolated string. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Canonical comparison key for a tag: trim, strip leading '#', collapse whitespace, lowercase. */
function normTag(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
}

/** Normalize a campaign-tag list into a Set of lowercased keys. */
function tagSet(campaignTags) {
  const s = new Set();
  for (const t of Array.isArray(campaignTags) ? campaignTags : [campaignTags]) {
    const k = normTag(t);
    if (k) s.add(k);
  }
  return s;
}

/**
 * extractCampaignTags(body, campaignTags) -> Array<string>
 * Find which of the campaign tags appear (as #hashtags) in a post body. Returns the matched,
 * lowercased campaign-tag keys (deduped, in campaign order). Case-insensitive. Pure.
 */
export function extractCampaignTags(body, campaignTags) {
  const want = tagSet(campaignTags);
  if (!want.size) return [];
  const text = String(body == null ? '' : body);
  // collect the hashtags present in the body, normalized.
  const present = new Set();
  const re = /#([\p{L}\p{N}_]+)/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const k = normTag(m[1]);
    if (k) present.add(k);
  }
  // preserve campaign order; only return tags that are both wanted and present.
  const out = [];
  for (const k of want) if (present.has(k)) out.push(k);
  return out;
}

/**
 * eligiblePosts(posts, campaignTags, {oncePerAuthor?}) -> Array<post>
 * Filter posts down to those whose body OR tags array carries at least one campaign tag.
 * When oncePerAuthor is set, keep only the FIRST eligible post per author (stable order).
 * Pure, soft-fail (non-array -> []).
 */
export function eligiblePosts(posts, campaignTags, { oncePerAuthor = false } = {}) {
  if (!Array.isArray(posts)) return [];
  const want = tagSet(campaignTags);
  if (!want.size) return [];
  const seen = new Set();
  const out = [];
  for (const p of posts) {
    if (!p || typeof p !== 'object') continue;
    if (!postMatches(p, want)) continue;
    if (oncePerAuthor) {
      const a = authorKey(p);
      if (seen.has(a)) continue;
      seen.add(a);
    }
    out.push(p);
  }
  return out;
}

/** Author identity key for dedupe (lowercased, trimmed). */
function authorKey(p) {
  return String((p && p.author) == null ? '' : p.author).trim().toLowerCase();
}

/** Does a post carry any of the wanted campaign tags (via its body or its tags array)? */
function postMatches(p, want) {
  // explicit tags array on the post.
  const tags = Array.isArray(p.tags) ? p.tags : [];
  for (const t of tags) if (want.has(normTag(t))) return true;
  // hashtags inside the body.
  const present = extractCampaignTags(p.body, [...want]);
  return present.length > 0;
}

/** Engagement signal for a post: votes + comments + 1 (so a zero-engagement post still counts). */
function engagementOf(p) {
  const votes = Number(p && p.votes);
  const comments = Number(p && p.comments);
  return (Number.isFinite(votes) ? votes : 0) + (Number.isFinite(comments) ? comments : 0) + 1;
}

/**
 * computeRewards({posts, campaignTags, budget, weightBy?}) ->
 *   { distributions: [{author, posts, weight, reward}], totalDistributed, leftover }
 *
 * Deterministic proportional split of `budget` (a whole-dollar amount) among eligible authors.
 *   - weightBy 'equal'      -> every author weighs the same (1 each).
 *   - weightBy 'engagement' -> author weight = sum of (votes+comments+1) over their eligible posts.
 * Posts are deduped to one-per-author by default for reward purposes (an author is paid once,
 * carrying their post count). The split is computed in integer cents, rounding DOWN per author so
 * the total NEVER exceeds the budget; the unspent remainder is reported as `leftover`. Pure, never
 * throws. NaN/garbage budget -> everything zero.
 */
export function computeRewards({ posts, campaignTags, budget, weightBy = 'equal' } = {}) {
  const want = tagSet(campaignTags);
  const budgetCents = toCents(budget);

  // group eligible posts by author. (We do NOT pass oncePerAuthor here — we want the full post
  // count and full engagement per author — then collapse to one distribution row each.)
  const elig = eligiblePosts(posts, [...want], { oncePerAuthor: false });
  const byAuthor = new Map();
  for (const p of elig) {
    const a = authorKey(p);
    let g = byAuthor.get(a);
    if (!g) {
      g = { author: (p.author == null ? '' : String(p.author)), posts: 0, weight: 0 };
      byAuthor.set(a, g);
    }
    g.posts += 1;
    // engagement: weight accumulates per post; equal: each AUTHOR weighs exactly 1 (set below).
    if (weightBy === 'engagement') g.weight += engagementOf(p);
  }
  // 'equal' (and any unrecognized mode) => one unit of weight per author, regardless of post count.
  if (weightBy !== 'engagement') for (const g of byAuthor.values()) g.weight = 1;

  const rows = [...byAuthor.values()];
  // stable, deterministic ordering: heaviest weight first, then most posts, then author name.
  rows.sort((x, y) => (y.weight - x.weight) || (y.posts - x.posts) || x.author.localeCompare(y.author));

  if (!rows.length || budgetCents <= 0) {
    return {
      distributions: rows.map((r) => ({ author: r.author, posts: r.posts, weight: r.weight, reward: 0 })),
      totalDistributed: 0,
      leftover: round2(budgetCents / 100),
    };
  }

  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);
  let distributedCents = 0;
  const distributions = rows.map((r) => {
    // round DOWN so we can never overspend; the remainder accumulates into leftover.
    const cents = totalWeight > 0 ? Math.floor((budgetCents * r.weight) / totalWeight) : 0;
    distributedCents += cents;
    return { author: r.author, posts: r.posts, weight: r.weight, reward: round2(cents / 100) };
  });

  const leftoverCents = budgetCents - distributedCents; // >= 0 by construction.
  return {
    distributions,
    totalDistributed: round2(distributedCents / 100),
    leftover: round2(leftoverCents / 100),
  };
}

/** Coerce a whole-dollar budget into a non-negative integer number of cents. NaN/garbage -> 0. */
function toCents(budget) {
  const n = Number(budget);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** Round to 2 decimals, avoiding binary float drift. */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * renderPayoutTable(result) -> string of esc()'d lines (one per author + a footer).
 * Pure, soft-fail. Safe to drop into HTML — every interpolated field is esc()'d.
 */
export function renderPayoutTable(result) {
  const r = result && typeof result === 'object' ? result : { distributions: [], totalDistributed: 0, leftover: 0 };
  const dists = Array.isArray(r.distributions) ? r.distributions : [];
  const lines = dists.map((d) => {
    const author = esc(d && d.author);
    const posts = esc(d && d.posts);
    const weight = esc(d && d.weight);
    const reward = esc(fmtMoney(d && d.reward));
    return `${author}  posts=${posts}  weight=${weight}  reward=${reward}`;
  });
  lines.push(`— distributed=${esc(fmtMoney(r.totalDistributed))}  leftover=${esc(fmtMoney(r.leftover))}`);
  return lines.join('\n');
}

/** Format a money amount as a fixed-2 string (soft-fail to 0.00). */
function fmtMoney(n) {
  const v = Number(n);
  return (Number.isFinite(v) ? v : 0).toFixed(2);
}

// CLI: demo a tiny campaign so the math is eyeball-checkable.
if (process.argv[1] && process.argv[1].endsWith('hashtag-reward.mjs')) {
  const posts = [
    { author: 'alice', body: 'building on #melek today', votes: 9, comments: 1 },
    { author: 'bob', body: 'also #MELEK and #vankush', votes: 4, comments: 0 },
    { author: 'bob', body: 'second #melek post', votes: 0, comments: 0 },
    { author: 'carol', body: 'no campaign tag here', votes: 100, comments: 100 },
  ];
  const eq = computeRewards({ posts, campaignTags: ['melek'], budget: 100, weightBy: 'equal' });
  const en = computeRewards({ posts, campaignTags: ['melek'], budget: 100, weightBy: 'engagement' });
  console.log('equal weighting:');
  console.log(renderPayoutTable(eq));
  console.log('\nengagement weighting:');
  console.log(renderPayoutTable(en));
}

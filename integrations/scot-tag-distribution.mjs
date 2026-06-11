/**
 * scot-tag-distribution.mjs — pure SCOT/SMT tag-based reward distribution.
 *
 * Distributes a FIXED reward pool for a posting window ACROSS many tagged posts
 * by their score, then splits each post's slice author/curation. No chain, no
 * I/O — every input is passed in.
 *
 * This is distinct from engine/lib/reward-split.mjs, which splits ONE post's
 * payout between author and curators. Here the pool is first apportioned ACROSS
 * a set of posts (by tag-weighted score), and only then is each post's own slice
 * split author/curation.
 *
 * Scoring: a post's score is the sum, over the configured tags it carries, of
 * tagWeight * rawRshares. A post carrying none of the configured tags scores 0
 * (it does not draw from the pool).
 *
 * Conservation invariant: the per-post shares always sum *EXACTLY* to the
 * (clamped, integer) poolUnits. Apportionment is largest-remainder (Hamilton);
 * any leftover "dust" base-units accrue to the top-scored post (deterministic
 * tie-break by permlink). Nothing is created or destroyed.
 *
 * Soft-fail discipline: non-numeric / negative / NaN / Infinity inputs clamp to
 * 0 and the functions never throw.
 */

/** HTML-escape for summarize() interpolation. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Coerce x to a finite, non-negative integer base-unit count; else 0. */
function toCount(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** Coerce x to a finite, non-negative number (weights / rshares); else 0. */
function toNonNegNumber(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Clamp a percentage to 0..100; non-numeric -> fallback. */
function toPct(x, fallback) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * scorePosts(posts, {tags, tagWeights}) -> posts annotated with a `score`.
 *
 * posts: array of { permlink, tags?, rshares? }. A post's `score` is the sum
 * over its tags that appear in the configured `tags` (or `tagWeights`) of
 * tagWeight * rawRshares. Posts carrying none of the configured tags score 0.
 *
 * tagWeights: optional { tag: weight } map. tags: optional array of tag names;
 * any tag listed there but absent from tagWeights weights 1. If neither is
 * supplied, every tag a post carries weights 1.
 *
 * Returns a NEW array of shallow-cloned posts each with a numeric `score`,
 * `matchedTags`, and a normalised `permlink`. Never mutates inputs, never
 * throws.
 */
export function scorePosts(posts, { tags, tagWeights } = {}) {
  const list = Array.isArray(posts) ? posts : [];

  // Build the configured weight map. Tags listed without a weight default to 1.
  const weights = new Map();
  if (tagWeights && typeof tagWeights === 'object') {
    for (const [k, v] of Object.entries(tagWeights)) {
      weights.set(String(k), toNonNegNumber(v));
    }
  }
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const key = String(t);
      if (!weights.has(key)) weights.set(key, 1);
    }
  }
  // If nothing was configured at all, treat every carried tag as weight 1.
  const matchAll = weights.size === 0;

  return list.map((p, i) => {
    const src = p && typeof p === 'object' ? p : {};
    const permlink = src.permlink != null ? String(src.permlink) : '';
    const rshares = toNonNegNumber(src.rshares);
    const postTags = Array.isArray(src.tags) ? src.tags.map((t) => String(t)) : [];

    let score = 0;
    const matchedTags = [];
    for (const t of postTags) {
      let w;
      if (matchAll) {
        w = 1;
      } else if (weights.has(t)) {
        w = weights.get(t);
      } else {
        continue; // tag not configured -> contributes nothing
      }
      score += w * rshares;
      matchedTags.push(t);
    }

    return { ...src, permlink, score: toNonNegNumber(score), matchedTags, _i: i };
  });
}

/**
 * distributePool({poolUnits, posts, authorPct=50})
 *   -> {perPost:[{permlink, share, author, curation}], dust, totalScore}
 *
 * poolUnits: integer base-unit count of the window's reward pool.
 * posts: array of scored posts (each with a numeric `score`, e.g. from
 *   scorePosts) — a missing/zero score draws nothing.
 * authorPct: 0..100, the fraction of each post's slice that goes to the author;
 *   the remainder is curation. Clamps; non-numeric falls back to 50.
 *
 * The pool is apportioned across posts proportional to score via largest-
 * remainder (Hamilton) so the per-post `share` values sum *EXACTLY* to the
 * clamped integer poolUnits. Leftover dust (when total score is 0, or as the
 * Hamilton remainder) goes to the top-scored post, tie-broken by permlink, and
 * is reported in `dust`. Each post's slice is then split author/curation with
 * the author absorbing that split's rounding remainder.
 *
 * Output `perPost` order matches input order. Soft-fail: empty/invalid posts or
 * a zero pool yields an empty/zero distribution; never throws.
 */
export function distributePool({ poolUnits, posts, authorPct = 50 } = {}) {
  const pool = toCount(poolUnits);
  const list = Array.isArray(posts) ? posts : [];
  const aPct = toPct(authorPct, 50);

  const entries = list.map((p, i) => {
    const src = p && typeof p === 'object' ? p : {};
    const permlink = src.permlink != null ? String(src.permlink) : '';
    const score = toNonNegNumber(src.score);
    return { permlink, score, i, share: 0, floor: 0, frac: 0 };
  });

  const totalScore = entries.reduce((s, e) => s + e.score, 0);

  if (entries.length === 0 || pool === 0) {
    return {
      perPost: entries.map((e) => splitSlice(e.permlink, 0, aPct)),
      dust: pool, // pool with nowhere to go (no posts) is reported as dust
      totalScore,
    };
  }

  let dust = 0;

  if (totalScore <= 0) {
    // No post scored: the whole pool is dust, parked on the top post.
    dust = pool;
    const top = topEntry(entries);
    top.share = pool;
  } else {
    // Largest-remainder apportionment proportional to score.
    let allocated = 0;
    for (const e of entries) {
      const exact = (pool * e.score) / totalScore;
      e.floor = Math.floor(exact);
      e.frac = exact - e.floor;
      e.share = e.floor;
      allocated += e.floor;
    }
    let remainder = pool - allocated; // integer 0..entries.length-1
    dust = remainder;
    // Distribute remainder units to the largest fractional parts; tie-break by
    // permlink then index. (Deterministic dust placement.)
    const order = [...entries].sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return cmpByPermlink(a, b);
    });
    for (let k = 0; k < remainder; k++) order[k].share += 1;
  }

  return {
    perPost: entries.map((e) => splitSlice(e.permlink, e.share, aPct)),
    dust,
    totalScore,
  };
}

/** Split one post's slice into {permlink, share, author, curation}. */
function splitSlice(permlink, share, aPct) {
  const s = toCount(share);
  const author = Math.floor((s * aPct) / 100);
  const curation = s - author; // author absorbs the rounding remainder
  return { permlink, share: s, author, curation };
}

/** Pick the highest-scored entry, tie-broken by permlink then index. */
function topEntry(entries) {
  return [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return cmpByPermlink(a, b);
  })[0];
}

/** Deterministic ordering by permlink, then original index. */
function cmpByPermlink(a, b) {
  if (a.permlink < b.permlink) return -1;
  if (a.permlink > b.permlink) return 1;
  return a.i - b.i;
}

/**
 * summarize({perPost, dust, totalScore}) -> markdown string.
 *
 * Renders a human-readable window distribution table. All interpolated values
 * are esc()'d. Soft-fail: a missing/invalid result renders an empty table.
 */
export function summarize(result) {
  const r = result && typeof result === 'object' ? result : {};
  const perPost = Array.isArray(r.perPost) ? r.perPost : [];
  const dust = toCount(r.dust);
  const totalScore = toNonNegNumber(r.totalScore);
  const poolTotal = perPost.reduce((s, p) => s + toCount(p && p.share), 0);

  const lines = [];
  lines.push('# SCOT tag-based pool distribution');
  lines.push('');
  lines.push(`- posts: **${esc(perPost.length)}**`);
  lines.push(`- pool (base units): **${esc(poolTotal)}**`);
  lines.push(`- total score: **${esc(totalScore)}**`);
  lines.push(`- dust: **${esc(dust)}**`);
  lines.push('');
  lines.push('| permlink | share | author | curation |');
  lines.push('| --- | ---: | ---: | ---: |');
  for (const p of perPost) {
    const row = p && typeof p === 'object' ? p : {};
    lines.push(
      `| ${esc(row.permlink)} | ${esc(toCount(row.share))} | ` +
        `${esc(toCount(row.author))} | ${esc(toCount(row.curation))} |`
    );
  }
  return lines.join('\n');
}

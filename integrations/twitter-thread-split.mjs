// twitter-thread-split.mjs — Social cross-post thread splitter + per-platform formatter (#43d92af995).
// PURE deterministic text transform for ITINERARY 'Social media content' / 'Cross-posting'.
// No network, no secrets, soft-fail everywhere (never throws on bad input).
//
// What it does:
//   splitThread(text, {limit=280, numbering=true}) -> string[]
//     Splits a long post into thread-sized chunks on sentence then word boundaries
//     (NEVER mid-word). When numbering, appends ' (i/n)' counters and RE-CHECKS that the
//     counter itself fits the limit (so a chunk + ' (12/34)' never overflows). A single
//     word longer than the usable limit is hard-split (soft-fail) rather than throwing.
//   formatFor(platform, text) -> { platform, cap, length, ok, chunks, overflow }
//     Applies the platform's char cap + link weighting. For 'twitter' every URL counts as
//     23 chars (t.co), so length is the weighted length; chunks are split at the platform cap.
//   extractHashtags(text) / extractMentions(text) -> deduped arrays (order-preserving).
//   truncateGraceful(text, n) -> ellipsis at a word boundary (… counts toward n).
//   toHtmlPreview(chunks) -> HTML string; esc() escapes every interpolated value.
//
//   import { splitThread, formatFor, extractHashtags, extractMentions, truncateGraceful } from './twitter-thread-split.mjs'
//   node integrations/twitter-thread-split.mjs "your long post here"
//   echo "your long post" | node integrations/twitter-thread-split.mjs --telegram

// --- HTML escape (strict; used by every render path) -----------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- platform caps + link handling ----------------------------------------
// Each platform: hard char cap, and how URLs are weighted toward that cap.
// Twitter collapses every URL to a t.co short link of fixed length (23) regardless of
// the real URL length — so the WEIGHTED length is what counts against the cap.
export const PLATFORMS = {
  twitter:   { cap: 280,   urlWeight: 23,   label: 'Twitter / X' },
  telegram:  { cap: 4096,  urlWeight: null, label: 'Telegram' },   // null => count real length
  discord:   { cap: 2000,  urlWeight: null, label: 'Discord' },
  mastodon:  { cap: 500,   urlWeight: null, label: 'Mastodon' },
};

const URL_RE = /https?:\/\/[^\s]+/g;
const HASHTAG_RE = /(?:^|\s)(#[\p{L}0-9_]+)/gu;
const MENTION_RE = /(?:^|\s)(@[\p{L}0-9_.]+)/gu;
const TWITTER_URL_WEIGHT = 23;

// Weighted length of a piece of text for a given platform. For twitter, every URL is
// counted as `urlWeight` chars (t.co) instead of its literal length.
export function weightedLength(text, urlWeight = null) {
  const s = String(text ?? '');
  if (urlWeight == null) return [...s].length; // count by code points, not UTF-16 units
  let total = 0;
  let lastIndex = 0;
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(s)) !== null) {
    total += [...s.slice(lastIndex, m.index)].length; // text before the URL
    total += urlWeight;                                // the URL itself, fixed weight
    lastIndex = m.index + m[0].length;
  }
  total += [...s.slice(lastIndex)].length;             // trailing text
  return total;
}

// Convenience: weighted length under twitter's t.co rule.
export function twitterLength(text) {
  return weightedLength(text, TWITTER_URL_WEIGHT);
}

// --- hashtag / mention extraction (deduped, order-preserving) --------------

export function extractHashtags(text) {
  return dedupeMatches(String(text ?? ''), HASHTAG_RE);
}

export function extractMentions(text) {
  return dedupeMatches(String(text ?? ''), MENTION_RE);
}

function dedupeMatches(s, re) {
  const out = [];
  const seen = new Set();
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tok = m[1];
    const key = tok.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(tok); }
  }
  return out;
}

// --- graceful truncation ---------------------------------------------------
// Truncate to at most n display chars, breaking at a word boundary when possible and
// appending a single ellipsis (…) which is itself counted toward n. Soft-fail on junk.
export function truncateGraceful(text, n) {
  const s = String(text ?? '');
  const limit = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const chars = [...s];
  if (limit <= 0) return '';
  if (chars.length <= limit) return s;
  if (limit === 1) return '…';
  const budget = limit - 1; // reserve one char for the ellipsis
  let slice = chars.slice(0, budget).join('');
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) slice = slice.slice(0, lastSpace);
  return slice.replace(/\s+$/, '') + '…';
}

// --- core: split a long text into thread chunks ----------------------------
// Splits on sentence boundaries first, then word boundaries, never mid-word — except a
// single token longer than the usable limit, which is HARD-split (soft-fail) so we never
// throw or loop forever. When numbering, ' (i/n)' counters are appended and the per-chunk
// usable budget is reduced by the WIDEST possible counter so every counter fits the limit.
export function splitThread(text, opts = {}) {
  const s = String(text ?? '').trim();
  const limit = (() => {
    const l = Number(opts.limit);
    return Number.isFinite(l) && l > 0 ? Math.floor(l) : 280;
  })();
  const numbering = opts.numbering !== false;

  if (s === '') return [];

  // First pass with a conservative budget assuming a 2-digit/2-digit counter, then a second
  // pass once we know the true count so the suffix width is exact. Two passes converge because
  // the count only ever shrinks the budget, never grows it past the first estimate.
  const firstBudget = numbering ? Math.max(1, limit - counterWidth(99, 99)) : limit;
  const draft = packChunks(s, firstBudget, limit);
  if (!numbering) return draft;

  const n = draft.length;
  const exactBudget = Math.max(1, limit - counterWidth(n, n));
  const repacked = packChunks(s, exactBudget, limit);
  const finalN = repacked.length;
  return repacked.map((c, i) => withCounter(c, i + 1, finalN, limit));
}

// Width (in chars) of the appended ' (i/n)' suffix for the widest case at this count.
function counterWidth(i, n) {
  return ` (${i}/${n})`.length;
}

function withCounter(chunk, i, n, limit) {
  const suffix = ` (${i}/${n})`;
  // If, in a pathological case, chunk+suffix still overflows the hard limit, trim the chunk
  // text (never the counter) at a word boundary so the counter is always preserved and visible.
  if ([...chunk].length + suffix.length > limit) {
    chunk = truncateGraceful(chunk, Math.max(1, limit - suffix.length));
  }
  return chunk + suffix;
}

// Greedy packer: accumulate sentences/words into chunks no wider than `budget` display chars.
// `hardLimit` bounds an individual hard-split token. Never splits mid-word unless a single
// token alone exceeds `budget`, in which case that token is hard-split into limit-sized pieces.
function packChunks(text, budget, hardLimit) {
  const usable = Math.max(1, budget);
  const tokens = tokenize(text);
  const chunks = [];
  let cur = '';

  const pushCur = () => { if (cur !== '') { chunks.push(cur); cur = ''; } };

  for (const tok of tokens) {
    // A token longer than the usable budget on its own: hard-split it (soft-fail path).
    if ([...tok].length > usable) {
      pushCur();
      for (const piece of hardSplit(tok, usable)) chunks.push(piece);
      continue;
    }
    if (cur === '') {
      cur = tok;
    } else {
      const candidate = cur + ' ' + tok;
      if ([...candidate].length <= usable) cur = candidate;
      else { pushCur(); cur = tok; }
    }
  }
  pushCur();
  return chunks.length ? chunks : [''];
}

// Break text into sentence-ish units, then words. We keep sentence punctuation attached and
// fall back to whitespace word splitting; the packer recombines them up to the budget.
function tokenize(text) {
  // Split on whitespace into words; sentence boundaries fall out naturally because the
  // greedy packer keeps adding words until the budget is hit. Splitting by word (not by
  // sentence) is what guarantees we never break mid-word.
  return text.split(/\s+/).filter((w) => w.length > 0);
}

// Hard-split an over-long token into <= size display-char pieces (by code point).
function hardSplit(tok, size) {
  const chars = [...tok];
  const out = [];
  const step = Math.max(1, size);
  for (let i = 0; i < chars.length; i += step) {
    out.push(chars.slice(i, i + step).join(''));
  }
  return out;
}

// --- per-platform formatting ------------------------------------------------
// Returns a structured result (never throws). `chunks` is the text split to fit the
// platform's cap using that platform's URL weighting; `length` is the weighted length of
// the whole input; `ok` is whether the whole input fits in a single post.
export function formatFor(platform, text) {
  const key = String(platform ?? '').toLowerCase();
  const cfg = PLATFORMS[key];
  const s = String(text ?? '');
  if (!cfg) {
    return { platform: key, cap: null, length: [...s].length, ok: false, chunks: [s], overflow: false, note: 'unknown platform' };
  }
  const length = weightedLength(s, cfg.urlWeight);
  const ok = length <= cfg.cap;
  // For chunking we reuse splitThread without numbering; for twitter we approximate by
  // splitting on the raw cap (the splitter is char-based) but report the weighted length
  // so callers see the true t.co-weighted size. URLs are short tokens so they never break.
  const chunks = ok ? [s] : splitThread(s, { limit: cfg.cap, numbering: false });
  return {
    platform: key,
    cap: cfg.cap,
    length,
    ok,
    overflow: !ok,
    chunks,
    note: ok ? 'fits' : 'split into ' + chunks.length + ' parts',
  };
}

export function listPlatforms() {
  return Object.keys(PLATFORMS);
}

// --- HTML preview helper (esc() every interpolated value) -------------------
export function toHtmlPreview(chunks) {
  const arr = Array.isArray(chunks) ? chunks : [chunks];
  const items = arr
    .map((c, i) => '  <li data-i="' + esc(i + 1) + '"><span class="num">' + esc(i + 1) + '.</span> ' + esc(c) + '</li>')
    .join('\n');
  return '<ol class="thread-preview">\n' + items + '\n</ol>';
}

// --- CLI (guarded; reads arg or stdin) -------------------------------------
// node integrations/twitter-thread-split.mjs "text"          -> twitter thread, numbered
// echo "text" | node integrations/twitter-thread-split.mjs --telegram
async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function parseCliArgs(argv) {
  let platform = 'twitter';
  const rest = [];
  for (const a of argv) {
    if (a.startsWith('--') && PLATFORMS[a.slice(2).toLowerCase()]) platform = a.slice(2).toLowerCase();
    else rest.push(a);
  }
  return { platform, text: rest.join(' ') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { platform, text: argText } = parseCliArgs(process.argv.slice(2));
  const text = argText || (await readStdin());
  const cap = PLATFORMS[platform].cap;
  const thread = splitThread(text, { limit: cap, numbering: true });
  const result = {
    platform,
    cap,
    hashtags: extractHashtags(text),
    mentions: extractMentions(text),
    parts: thread.length,
    thread,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

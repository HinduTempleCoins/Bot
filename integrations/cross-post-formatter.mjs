// cross-post-formatter.mjs — one canonical blog post -> per-platform variants.
// Backlog 78666c4cf9 / itinerary "Blog posts -> all platforms".
//
// PURE transform. No network, no posting, no secrets. Deterministic. Soft-fail:
// missing fields coerce to '' (or []), non-strings are coerced, never throws.
//
// A canonical post is { title, body, tags, url }. Each platform gets a variant
// tailored to its length budget + tag conventions:
//   twitter  — title + url + a few hashtags, within 280; url is ALWAYS preserved
//              even when the body/title has to be truncated to make room.
//   telegram — title (emphasised) + body excerpt + url, within 4096.
//   discord  — title (emphasised) + body excerpt + url, within 2000.
//   hive     — full markdown body + a tag footer, no hard length limit.
//
//   import { formatFor, formatAll, truncate, renderTags, PLATFORM_LIMITS, esc }
//     from './integrations/cross-post-formatter.mjs'
//   node integrations/cross-post-formatter.mjs   # demo

// --- HTML escape (strict) --------------------------------------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- per-platform budgets (0 == no limit) ----------------------------------

export const PLATFORM_LIMITS = Object.freeze({
  twitter: 280,
  telegram: 4096,
  discord: 2000,
  hive: 0,
});

// twitter caps how many hashtags we emit; others are uncapped.
const TAG_CAPS = Object.freeze({
  twitter: 3,
  telegram: 0, // 0 == no cap
  discord: 0,
  hive: 0,
});

// --- helpers ---------------------------------------------------------------

function str(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return ''; // objects/arrays/etc. coerce to empty rather than "[object Object]"
}

// Word-boundary-safe truncation. If text fits in `limit`, returns it unchanged
// (truncated:false). Otherwise trims to the last word boundary that still
// leaves room for `suffix`, appends the suffix (truncated:true). limit<=0 means
// "no limit" -> never truncates.
export function truncate(text, limit, suffix = '…') {
  const s = str(text);
  const lim = Number.isFinite(limit) ? Math.floor(limit) : 0;
  const suf = str(suffix);
  if (lim <= 0 || s.length <= lim) return { text: s, truncated: false };
  // Degenerate: suffix alone doesn't fit -> hard-cut the suffix itself.
  if (suf.length >= lim) return { text: suf.slice(0, lim), truncated: true };
  const room = lim - suf.length;
  let cut = s.slice(0, room);
  // Back up to the last whitespace so we don't slice a word in half.
  const lastSpace = cut.search(/\s\S*$/);
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/\s+$/, '');
  return { text: cut + suf, truncated: true };
}

// Normalise a tags input into a clean array of bare tag words (no '#').
function normalizeTags(tags) {
  let arr;
  if (Array.isArray(tags)) arr = tags;
  else if (typeof tags === 'string') arr = tags.split(/[\s,]+/);
  else arr = [];
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    const bare = str(t).trim().replace(/^#+/, '').toLowerCase();
    // tag-legal characters only; drop empties/dupes
    const clean = bare.replace(/[^a-z0-9_-]/g, '');
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

// Render tags for a platform. Hive uses plain words (its post metadata wants
// bare tags, no '#'); the chat/social platforms use '#hashtag'. Twitter caps
// the count. Returns a single space-joined string (possibly '').
export function renderTags(tags, platform) {
  const list = normalizeTags(tags);
  const cap = TAG_CAPS[platform] || 0;
  const capped = cap > 0 ? list.slice(0, cap) : list;
  if (platform === 'hive') return capped.join(' ');
  return capped.map((t) => '#' + t).join(' ');
}

// --- per-platform renderers ------------------------------------------------

function done(text) {
  const t = str(text);
  return { text: t, truncated: false, length: t.length };
}

// Twitter: title + url + a few hashtags, all within 280. The url is sacred —
// we reserve room for it (and the tags) first, then fit as much title as is
// left. truncated reflects whether the title had to be cut.
function formatTwitter(title, _body, tags, url) {
  const limit = PLATFORM_LIMITS.twitter;
  const u = str(url).trim();
  const tagStr = renderTags(tags, 'twitter');
  // Reserve url + tags (each on its own line) from the budget.
  const tail =
    (u ? '\n' + u : '') + (tagStr ? '\n' + tagStr : '');
  const titleBudget = limit - tail.length;
  let truncated = false;
  let titleOut;
  if (titleBudget <= 0) {
    // No room for any title at all — keep the url (truncate the tail to fit).
    titleOut = '';
    const cut = truncate(tail.replace(/^\n/, ''), limit, '');
    return { text: cut.text, truncated: true, length: cut.text.length };
  } else {
    const r = truncate(title, titleBudget);
    titleOut = r.text;
    truncated = r.truncated;
  }
  const text = (titleOut + tail).trim();
  return { text, truncated, length: text.length };
}

// Telegram / Discord share a shape: emphasised title, body excerpt, url.
function formatChat(platform, title, body, _tags, url) {
  const limit = PLATFORM_LIMITS[platform];
  const t = str(title).trim();
  const u = str(url).trim();
  const head = t ? '*' + t + '*' : '';
  const tail = u ? '\n\n' + u : '';
  const sep = head ? '\n\n' : '';
  // Body gets whatever budget remains after head + sep + tail.
  const fixed = head.length + sep.length + tail.length;
  const bodyBudget = limit - fixed;
  let bodyOut = '';
  let truncated = false;
  const b = str(body).trim();
  if (b) {
    if (bodyBudget <= 0) {
      // Not even room for body — drop it; mark truncated if body existed.
      truncated = true;
    } else {
      const r = truncate(b, bodyBudget);
      bodyOut = r.text;
      truncated = r.truncated;
    }
  }
  let text = head + (bodyOut ? sep + bodyOut : (head && tail ? '' : '')) + tail;
  text = text.trim();
  // Final guard: never exceed the limit even with the (preserved) url.
  if (limit > 0 && text.length > limit) {
    const r = truncate(text, limit);
    text = r.text;
    truncated = true;
  }
  return { text, truncated, length: text.length };
}

// Hive: full markdown — H1 title, full body, tag footer. No hard limit.
function formatHive(title, body, tags, url) {
  const t = str(title).trim();
  const b = str(body).trim();
  const u = str(url).trim();
  const tagStr = renderTags(tags, 'hive');
  const parts = [];
  if (t) parts.push('# ' + t);
  if (b) parts.push(b);
  if (u) parts.push('Source: ' + u);
  if (tagStr) parts.push('Tags: ' + tagStr);
  const text = parts.join('\n\n');
  return { text, truncated: false, length: text.length };
}

// --- public API ------------------------------------------------------------

const RENDERERS = {
  twitter: (p) => formatTwitter(p.title, p.body, p.tags, p.url),
  telegram: (p) => formatChat('telegram', p.title, p.body, p.tags, p.url),
  discord: (p) => formatChat('discord', p.title, p.body, p.tags, p.url),
  hive: (p) => formatHive(p.title, p.body, p.tags, p.url),
};

// formatFor(platform, post) -> { text, truncated, length }.
// Unknown platform -> empty variant (soft-fail). Never throws.
export function formatFor(platform, post) {
  try {
    const key = str(platform).trim().toLowerCase();
    const r = RENDERERS[key];
    if (!r) return done('');
    const p = post && typeof post === 'object' ? post : {};
    return r(p);
  } catch {
    return done('');
  }
}

// formatAll(post) -> { twitter, telegram, discord, hive }.
export function formatAll(post) {
  return {
    twitter: formatFor('twitter', post),
    telegram: formatFor('telegram', post),
    discord: formatFor('discord', post),
    hive: formatFor('hive', post),
  };
}

// --- CLI demo (guarded) ----------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const demo = {
    title: 'Introducing Hathor on MELEK',
    body: 'A founding witness joins the chain. '.repeat(20),
    tags: ['melek', 'witness', 'hathor', 'crypto', 'blockchain'],
    url: 'https://melek.salon/@hathor/introducing-hathor-on-melek',
  };
  const all = formatAll(demo);
  for (const [k, v] of Object.entries(all)) {
    console.log(`\n=== ${k} (len ${v.length}, truncated=${v.truncated}) ===`);
    console.log(v.text);
  }
}

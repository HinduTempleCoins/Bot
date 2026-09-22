// hashtag-optimizer.mjs — turn a post into optimized, platform-tuned hashtags. PURE, deterministic,
// LLM-free, no network, soft-fail-never-throw. The generative counterpart to the tools we already have:
//
//   - cross-post-formatter.mjs  FORMATS a post per platform and caps caller-supplied tags. It does not
//                               DECIDE the tags. This module decides them.
//   - hashtag-trigger.mjs       matches author tags against reward RULES. Not us.
//   - hashtag-external.mjs / soapbox/hashtags.mjs  FETCH live trending tags (network). Not us — offline.
//   - topic-tagger.mjs          classifies text onto the frozen MELEK corpus topics. We REUSE it.
//
// WHAT IT DOES. Given { title, body, tags? }, it derives candidate hashtags from four honest sources —
// (1) tags the author already supplied, (2) proper nouns in the text, (3) MELEK-corpus topics (via
// topic-tagger), (4) salient keywords by frequency, plus (5) ecosystem/brand terms that ACTUALLY appear
// in the text — ranks and de-dupes them, then renders them to each platform's convention (CamelCase and
// capped for X/IG/LinkedIn; bare hyphenated lowercase for Hive/Blurt/MELEK; none for BitcoinTalk).
//
// It is reusable for BOTH Hathor's own posts and any user's posts (Herald content factory, the troll-box,
// cross-posting). Internal canonical tag form is hyphen-joined lowercase words ("free-law-project"), which
// preserves word boundaries so each platform can render CamelCase or bare-lowercase from the same source.
//
//   import { suggestHashtags, formatHashtags, hashtagsFor, optimize, PLATFORM_TAG_STYLE } from './hashtag-optimizer.mjs'
//   node integrations/hashtag-optimizer.mjs   # worked demo

import { tagTopics } from './topic-tagger.mjs';

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────
function str(v) { return v == null ? '' : (typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')); }

// Canonical tag form: lowercase words joined by single hyphens ("Free Law Project" -> "free-law-project",
// "#MELEK" -> "melek"). Retains word boundaries so a platform renderer can rebuild CamelCase or bare form.
export function canonicalTag(raw) {
  return str(raw).toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^a-z0-9]+/g, '-')   // any run of non-alnum becomes one hyphen
    .replace(/^-+|-+$/g, '')       // trim edge hyphens
    .replace(/-{2,}/g, '-');       // collapse runs
}

// Acronyms/brand tokens that render in ALL-CAPS in CamelCase output (so "melek" -> "MELEK", not "Melek").
const ACRONYMS = new Set([
  'melek', 'prana', 'kula', 'mbd', 'dpos', 'defi', 'nft', 'nfts', 'dao', 'tdcs', 'tens', 'seo', 'geo',
  'ai', 'btt', 'xmr', 'zeph', 'usc', 'cfr', 'faq', 'us', 'uk', 'eu', 'llc', 'scotus', 'dmt', 'thc', 'cbd',
]);

// Ecosystem/brand terms — only surfaced as tags when they ACTUALLY appear in the text (honest, not spammy).
const BRAND_TERMS = [
  'melek', 'prana', 'kula', 'soapbox', 'hathor', 'blurt', 'hive', 'steem', 'crypto', 'cryptocurrency',
  'blockchain', 'web3', 'witness', 'cannabis', 'hemp', 'ayahuasca', 'neuroscience', 'temple',
];

// English + generic-filler stopwords excluded from keyword mining.
const STOPWORDS = new Set(('a an the and or but if then else of to in on at by for with from as is are was were '
  + 'be been being it its this that these those i you he she we they them our your their his her my me us '
  + 'do does did done have has had will would can could should may might must not no yes so up out down over '
  + 'about into than too very just also more most some any all each other new now here there what which who '
  + 'when where why how one two three first get got make made how-to via per vs into onto your youre').split(/\s+/));

// ── candidate mining ────────────────────────────────────────────────────────────────────────────────
// Each candidate: { key(canonical), score, source }. Higher score = more relevant, ranked first.
function mine(post, { brandTags = [] } = {}) {
  const p = post && typeof post === 'object' ? post : {};
  const title = str(p.title);
  const body = str(p.body);
  const text = `${title}\n${body}`;
  const lc = text.toLowerCase();
  const cand = new Map();
  const bump = (raw, score, source) => {
    const key = canonicalTag(raw);
    if (!key || key.length < 2) return;
    const prev = cand.get(key);
    if (!prev || score > prev.score) cand.set(key, { key, score, source });
  };

  // (1) author-supplied tags — the strongest signal.
  const explicit = Array.isArray(p.tags) ? p.tags : (typeof p.tags === 'string' ? p.tags.split(/[\s,]+/) : []);
  for (const t of explicit) bump(t, 100, 'explicit');
  for (const t of (Array.isArray(brandTags) ? brandTags : [])) bump(t, 95, 'brand-forced');

  // (2) proper nouns — capitalized single words and multi-word runs (title-case phrases make great tags).
  //     Skip the leading word of a sentence-ish run only when it's a lone common word; multi-word runs pass.
  const properRe = /\b([A-Z][a-z0-9]+(?:[ \t]+[A-Z][a-z0-9]+){0,3})\b/g;
  let m;
  while ((m = properRe.exec(text))) {
    const phrase = m[1];
    const words = phrase.split(/\s+/);
    const key = canonicalTag(phrase);
    if (!key) continue;
    if (words.length === 1 && STOPWORDS.has(words[0].toLowerCase())) continue;
    // multi-word proper nouns score higher (more specific / higher-intent).
    bump(phrase, 60 + Math.min(20, words.length * 6), 'proper-noun');
  }

  // (3) corpus topics via topic-tagger (mythology / religion / archaeology / esoteric / genetics / philosophy).
  for (const t of tagTopics(text)) bump(t.topic, 40 + Math.min(15, t.score), 'topic');

  // (4) salient keywords by frequency (single tokens, min length 4, not stopwords, not pure digits).
  const freq = new Map();
  for (const w of lc.match(/[a-z][a-z0-9]{3,}/g) || []) {
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  for (const [w, f] of freq) if (f >= 2 || title.toLowerCase().includes(w)) bump(w, 20 + Math.min(15, f * 3), 'keyword');

  // (5) brand/ecosystem terms that appear in the text.
  for (const b of BRAND_TERMS) if (new RegExp(`\\b${b}\\b`, 'i').test(lc)) bump(b, 50, 'brand');

  return [...cand.values()];
}

/**
 * Ranked, de-duplicated hashtag suggestions (canonical hyphen-joined form). Soft-fail -> [].
 * @param {object} post  { title, body, tags? }
 * @param {object} [opts] { max, brandTags, platform }  platform caps to that platform's tag budget.
 */
export function suggestHashtags(post, opts = {}) {
  try {
    const list = mine(post, opts).sort((a, b) => (b.score - a.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    let out = list.map((c) => c.key);
    const platMax = opts.platform ? (PLATFORM_TAG_STYLE[opts.platform] || {}).max : undefined;
    const cap = Number.isFinite(opts.max) ? opts.max : (Number.isFinite(platMax) ? platMax : out.length);
    return out.slice(0, Math.max(0, cap));
  } catch { return []; }
}

// ── per-platform rendering ──────────────────────────────────────────────────────────────────────────
// style: 'camel' -> "#FreeLawProject" ; 'lower' -> bare hyphenated lowercase "free-law-project" (Hive-family
// tag metadata, no '#') ; 'none' -> platform doesn't use hashtags. max = the platform's tag budget.
export const PLATFORM_TAG_STYLE = Object.freeze({
  twitter:     { max: 3,  style: 'camel' },
  x:           { max: 3,  style: 'camel' },
  instagram:   { max: 12, style: 'camel' },
  linkedin:    { max: 4,  style: 'camel' },
  tiktok:      { max: 5,  style: 'camel' },
  facebook:    { max: 3,  style: 'camel' },
  mastodon:    { max: 4,  style: 'camel' },
  threads:     { max: 5,  style: 'camel' },
  blog:        { max: 6,  style: 'camel' },
  hive:        { max: 5,  style: 'lower' },
  blurt:       { max: 5,  style: 'lower' },
  steem:       { max: 5,  style: 'lower' },
  melek:       { max: 5,  style: 'lower' },
  bitcointalk: { max: 0,  style: 'none' },
});

function renderWordsCamel(words) {
  return words.map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join('');
}

/**
 * Render canonical tags to a platform's convention. Returns a space-joined string (Hive-family: bare
 * hyphenated lowercase words; others: '#CamelCase'; BitcoinTalk: ''). Soft-fail -> ''.
 */
export function formatHashtags(tags, platform) {
  try {
    const style = (PLATFORM_TAG_STYLE[str(platform).toLowerCase()] || { max: 6, style: 'camel' });
    if (style.style === 'none') return '';
    const list = [...new Set((Array.isArray(tags) ? tags : []).map(canonicalTag).filter(Boolean))].slice(0, style.max);
    return list.map((c) => {
      const words = c.split('-').filter(Boolean);
      if (style.style === 'lower') return words.join('-');        // Hive-family: bare, hyphen-joined tag
      return '#' + renderWordsCamel(words);                        // social: #CamelCase, no separators
    }).filter(Boolean).join(' ');
  } catch { return ''; }
}

/** Convenience: suggest for a post AND render for one platform in one call. Soft-fail -> ''. */
export function hashtagsFor(post, platform, opts = {}) {
  return formatHashtags(suggestHashtags(post, { ...opts, platform }), platform);
}

/**
 * Full optimize: for each requested platform, the capped canonical tags + the rendered hashtag string.
 * @param {object} post
 * @param {object} [opts] { platforms, brandTags, max } ; platforms default = the whole style map.
 * @returns {{ suggested: string[], platforms: Record<string,{tags:string[],hashtags:string}> }}
 */
export function optimize(post, opts = {}) {
  const platforms = Array.isArray(opts.platforms) && opts.platforms.length ? opts.platforms : Object.keys(PLATFORM_TAG_STYLE);
  const suggested = suggestHashtags(post, { brandTags: opts.brandTags, max: opts.max });
  const out = {};
  for (const plat of platforms) {
    const key = str(plat).toLowerCase();
    const tags = suggestHashtags(post, { brandTags: opts.brandTags, platform: key });
    out[key] = { tags, hashtags: formatHashtags(tags, key) };
  }
  return { suggested, platforms: out };
}

// ── CLI demo (guarded) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const demo = {
    title: 'Hathor joins MELEK as a founding Witness',
    body: 'The MELEK blockchain welcomes Hathor, an AI witness. We publish free legal reference at SoapBox Law, '
        + 'the Caselaw Access Project mirror, and a harm-reduction library. Cannabis, hemp, and neuroscience '
        + 'education for everyone. Crypto that earns, not speculation.',
    tags: ['melek', 'witness'],
  };
  const r = optimize(demo, { platforms: ['x', 'instagram', 'hive', 'bitcointalk', 'linkedin'] });
  console.log('suggested (ranked):', r.suggested.join(', '), '\n');
  for (const [plat, v] of Object.entries(r.platforms)) {
    console.log(`${plat.padEnd(12)} ${v.hashtags || '(no hashtags on this platform)'}`);
  }
}

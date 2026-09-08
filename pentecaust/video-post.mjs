// video-post.mjs — THE MELEK VIDEO POST. One video, end to end, on a standard Graphene `comment`.
//
// ── THE ARCHITECTURE (settled; this module implements it, it does not redesign it) ────────────────
// A MELEK video is an ordinary `comment` operation whose `json_metadata` carries a *reference* to the
// video. Nothing else. No custom chain op (CLAUDE.md: "No custom chain ops for AI" / chain stays standard
// Graphene), no new consensus rule, no plugin. Rewards come from the existing pool on the existing
// 75/25 author/curator split, because a video post is just a post. This is exactly DTube v1 (Steem for
// the metadata, IPFS for the bytes) and exactly what 3Speak does on Hive today. MELEK is a Steem fork,
// so it works by construction.
//
// ── WHY THE BYTES CANNOT GO ON THE CHAIN (the arithmetic, not an opinion) ─────────────────────────
// MELEK's live testnet config (decoded 2026-06-06, see spamtest/limits.mjs CHAIN_DEFAULTS) is a 65,536
// byte cap on a 4-second block: 65536 * 21600 blocks/day = 1.42 GB/day for the ENTIRE chain — every user,
// every op, forever, on every witness's disk. One 10-minute 1080p video is ~350 MB single-rendition and
// ~680 MB with a ladder: a quarter to a half of a full day of total chain capacity, for one video.
// `video-cost.mjs` computes that number rather than asserting it (`chainDayShare`).
//
// ── WHAT KILLED DTUBE WAS PINNING, NOT ARCHITECTURE ───────────────────────────────────────────────
// IPFS keeps nothing alive on its own. DTube ended up running its own pinning cluster, which put the
// storage bill back on DTube and recentralised the thing; when content fell out of pinning it vanished.
// So the load-bearing question is not "which protocol" but "WHO PAYS TO KEEP THIS ALIVE, AND WHAT
// HAPPENS WHEN THEY STOP". The operator runs the boxes, so plain hosting off our own storage is the
// default and IPFS is optional. That is why `provider` + `providerId` are FIRST-CLASS and separate from
// `url`: the durable identity of a video is (provider, providerId); the URL is a cache of where that
// resolved today. Move the bytes to a different backend, change one env var, and every post ever made
// still resolves. Old posts never break, and nothing here is welded to one storage vendor or ideology.
//
// ── THE DIFFERENTIATOR: CAPTIONS PER LANGUAGE, ORIGINAL ALWAYS PRESERVED ──────────────────────────
// Pentecaust is the descent of tongues: "each reader sees a message in THEIR preferred language, the
// original always preserved" (pentecaust/translate.mjs). A MELEK video post carries a caption TRACK PER
// LANGUAGE in its metadata, exactly one of which is marked `original:true` and can never be dropped or
// overwritten. Translated tracks record `translatedFrom` so the chain of custody back to the original is
// always legible. YouTube and DTube do not do this; the India research called translation the strongest
// product fit by a distance. Generation comes later — the metadata is built for it now.
//
// ── HARD BOUNDARY ─────────────────────────────────────────────────────────────────────────────────
// This module BROADCASTS NOTHING. It builds the *intent* — an unsigned `comment` op — and validates it.
// Signing and broadcast happen at the MELEK-Signer boundary, which this repo never holds (MELEK_SIGNER.md).
// No keys, no WIF, no network, no upload, no pinning. Pure functions; soft-fail, never throw.
//
//   import { buildVideoMetadata, validateVideoMetadata, parseVideoMetadata, buildCommentIntent } from './video-post.mjs'
//   node pentecaust/video-post.mjs --demo

import { fileURLToPath } from 'node:url';
import { normLang } from './translate.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

// ── identity of the format ───────────────────────────────────────────────────────────────────────
// `app` follows the Steem/Hive convention ("<app>/<semver>") so condensers and indexers that already
// key on it (dtube/0.9, 3speak/0.3.0) treat ours the same way. `type` mirrors 3Speak's discriminator.
export const APP = 'melek/video/1.0.0';
export const TYPE = 'melek/video';
export const PLATFORM = 'melek';

// The default tag/category for the video feed — already live in engine/api ScotTube and site/tunein.
export const VIDEO_TAG = 'reel';

// ── chain budget ─────────────────────────────────────────────────────────────────────────────────
// json_metadata rides inside the comment op, inside a transaction capped at 65,536 bytes. A post also
// carries a body, a title and the op envelope, so the metadata gets a fraction of that. 8 KiB is a
// deliberate, generous ceiling; we warn well before it because a 40-language caption list is real.
export const MAX_JSON_METADATA_BYTES = Math.max(1024, Number(env('MELEK_VIDEO_META_MAX_BYTES', 8192)) || 8192);
export const WARN_JSON_METADATA_BYTES = Math.floor(MAX_JSON_METADATA_BYTES * 0.75);

// ── sane bounds (validation rejects outside these; they are limits, not preferences) ──────────────
export const LIMITS = Object.freeze({
  titleMax: 255,
  descriptionMax: 5000,
  durationMin: 1,
  durationMax: 14400,                    // 4 hours
  filesizeMin: 1,
  filesizeMax: 32 * 1024 ** 3,           // 32 GiB
  widthMin: 16, widthMax: 7680,          // up to 8K
  heightMin: 16, heightMax: 4320,
  tagsMax: 8,
  captionsMax: 64,
  renditionsMax: 8,
});

// Container/codec types we are willing to claim a browser can play (or an hls.js shim can).
export const CONTENT_TYPES = Object.freeze([
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'application/x-mpegurl', 'application/dash+xml',
]);

// ── the storage backends ─────────────────────────────────────────────────────────────────────────
// A provider is (label, how to turn a providerId into a playable https URL, how to recognise one of
// its URLs). Bases are env-overridable so the backend can move without rewriting a single post.
// `custody` is the honest answer to "who pays to keep this alive, and what happens when they stop".
const MELEK_VIDEO_BASE = () => String(env('MELEK_VIDEO_BASE', 'https://video.melek.salon')).replace(/\/+$/, '');
const IPFS_GATEWAY = () => String(env('IPFS_GATEWAY', 'https://ipfs.io')).replace(/\/+$/, '');

const REF_SAFE = /^[\w.\-~/]{1,200}$/;   // provider ids: no scheme, no query, no traversal (checked below)
const CID_SAFE = /^[A-Za-z0-9]{20,120}$/;

export const PROVIDERS = Object.freeze({
  melek: {
    label: 'MELEK storage',
    custody: 'the operator runs the boxes; it lives as long as we pay the box. Falls back to a re-upload from the master.',
    resolve: (ref) => (REF_SAFE.test(ref) && !ref.includes('..') ? `${MELEK_VIDEO_BASE()}/${ref.replace(/^\/+/, '')}` : ''),
  },
  https: {
    label: 'Direct HTTPS',
    custody: 'whoever owns that host. If they stop, the video is gone and only the post remains.',
    resolve: (ref) => (/^https:\/\/[^\s"'<>]+$/i.test(ref) ? ref : ''),
  },
  ipfs: {
    label: 'IPFS',
    custody: 'OPTIONAL and NOT self-sustaining — a CID is an address, not a promise. Someone must pin it. This is the exact failure that killed DTube.',
    resolve: (ref) => (CID_SAFE.test(ref) ? `${IPFS_GATEWAY()}/ipfs/${ref}` : ''),
  },
  archive: {
    label: 'Internet Archive',
    custody: 'the Internet Archive, under their own terms — durable but not ours, and not guaranteed.',
    resolve: (ref) => (REF_SAFE.test(ref) && !ref.includes('..') ? `https://archive.org/download/${ref.replace(/^\/+/, '')}` : ''),
  },
});
export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));
export const isProvider = (p) => Object.prototype.hasOwnProperty.call(PROVIDERS, String(p || '').toLowerCase());

// ── small helpers (total; never throw) ───────────────────────────────────────────────────────────
const str = (v) => (v == null ? '' : String(v)).trim();
const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const isHttps = (u) => /^https:\/\/[^\s"'<>]+$/i.test(str(u));
const uniq = (a) => Array.from(new Set(a));

/** Infer (provider, providerId) from a bare URL — so legacy posts that only carry a URL still get a
 *  durable address. Returns { provider, providerId } and never throws. */
export function inferProvider(url) {
  const u = str(url);
  if (!u) return { provider: '', providerId: '' };
  const ipfsScheme = u.match(/^ipfs:\/\/(?:ipfs\/)?([A-Za-z0-9]+)/);
  if (ipfsScheme) return { provider: 'ipfs', providerId: ipfsScheme[1] };
  let parsed = null;
  try { parsed = new URL(u); } catch { return { provider: '', providerId: '' }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { provider: '', providerId: '' };
  const gwCid = parsed.pathname.match(/^\/ipfs\/([A-Za-z0-9]+)/);
  if (gwCid) return { provider: 'ipfs', providerId: gwCid[1] };
  const host = parsed.hostname.toLowerCase();
  if (host === 'archive.org' || host.endsWith('.archive.org')) {
    const m = parsed.pathname.match(/^\/download\/(.+)$/);
    if (m) return { provider: 'archive', providerId: m[1] };
  }
  const base = MELEK_VIDEO_BASE();
  if (u.startsWith(base + '/')) return { provider: 'melek', providerId: u.slice(base.length + 1) };
  return { provider: 'https', providerId: parsed.protocol === 'https:' ? u : '' };
}

/**
 * resolveVideoUrl — turn a video reference into a playable https URL, or '' if it cannot be addressed.
 * The durable address is (provider, providerId); `url` is only the cached convenience and is used as a
 * fallback. This ordering is the whole point of the provider field: re-point the base, and every post
 * ever written resolves again without an edit.
 */
export function resolveVideoUrl(ref = {}) {
  const provider = str(ref.provider).toLowerCase();
  const providerId = str(ref.providerId);
  if (provider && providerId && isProvider(provider)) {
    let out = '';
    try { out = PROVIDERS[provider].resolve(providerId) || ''; } catch { out = ''; }
    if (isHttps(out)) return out;
  }
  const url = str(ref.url);
  if (isHttps(url)) return url;
  // last resort: a bare ipfs:// url with no provider fields set
  const inferred = inferProvider(url);
  if (inferred.provider && inferred.providerId && inferred.provider !== 'https') {
    let out = '';
    try { out = PROVIDERS[inferred.provider].resolve(inferred.providerId) || ''; } catch { out = ''; }
    if (isHttps(out)) return out;
  }
  return '';
}

// ── CAPTIONS — the differentiator ────────────────────────────────────────────────────────────────
// A track is { lang, label, url|provider+providerId, format, kind, source, original, translatedFrom }.
// INVARIANT: exactly one track is `original:true`, it matches the video's spoken language, and it is
// never dropped. Translated tracks are `kind:'subtitles'` (the correct HTML <track> semantics) and
// carry `translatedFrom` so the provenance back to the original is always readable.
export const CAPTION_FORMATS = Object.freeze(['vtt', 'srt']);
export const CAPTION_SOURCES = Object.freeze(['human', 'machine', 'asr', 'imported']);

const LANG_LABELS = {
  en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', it: 'Italiano',
  nl: 'Nederlands', ru: 'Русский', uk: 'Українська', pl: 'Polski', zh: '中文', ja: '日本語',
  ko: '한국어', ar: 'العربية', hi: 'हिन्दी', bn: 'বাংলা', ta: 'தமிழ்', te: 'తెలుగు', mr: 'मराठी',
  gu: 'ગુજરાતી', kn: 'ಕನ್ನಡ', ml: 'മലയാളം', pa: 'ਪੰਜਾਬੀ', ur: 'اردو', tr: 'Türkçe', ku: 'Kurdî',
  fa: 'فارسی', he: 'עברית', el: 'Ελληνικά', sw: 'Kiswahili', vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
  th: 'ไทย', ms: 'Bahasa Melayu', tl: 'Tagalog',
};
/** A human label for a language code — its own endonym where we know it, else the code. */
export const langLabel = (l) => LANG_LABELS[normLang(l).split('-')[0]] || normLang(l) || '';

/**
 * normalizeCaptions — clean a caption list and enforce the original-preserved invariant.
 * Soft-fails: unusable rows are dropped, never thrown. Returns the normalized array.
 * @param {Array} list
 * @param {string} originalLang the video's spoken language (from video.info.lang)
 */
export function normalizeCaptions(list, originalLang) {
  const src = Array.isArray(list) ? list : [];
  const orig = normLang(originalLang);
  const seen = new Set();
  const out = [];
  for (const raw of src) {
    if (!raw || typeof raw !== 'object') continue;
    const lang = normLang(raw.lang || raw.language || raw.srclang);
    if (!lang || seen.has(lang)) continue;
    const provider = str(raw.provider).toLowerCase();
    const providerId = str(raw.providerId);
    const url = resolveVideoUrl({ provider, providerId, url: raw.url });
    if (!url) continue;                                    // a track we cannot address is not a track
    const format = CAPTION_FORMATS.includes(str(raw.format).toLowerCase())
      ? str(raw.format).toLowerCase()
      : (/\.srt(\?|$)/i.test(url) ? 'srt' : 'vtt');
    const source = CAPTION_SOURCES.includes(str(raw.source).toLowerCase()) ? str(raw.source).toLowerCase() : 'machine';
    const track = {
      lang,
      label: str(raw.label) || langLabel(lang) || lang,
      url,
      format,
      source,
      original: raw.original === true || (!!orig && lang === orig && raw.original !== false),
      kind: '',            // filled below from `original`
    };
    if (provider && isProvider(provider) && providerId) { track.provider = provider; track.providerId = providerId; }
    const from = normLang(raw.translatedFrom);
    if (from) track.translatedFrom = from;
    seen.add(lang);
    out.push(track);
  }
  if (!out.length) return out;

  // Exactly one original. Prefer an explicitly-marked one, else the track matching the spoken language,
  // else the first track. Extra `original` flags are demoted rather than rejected (soft-fail).
  let chosen = out.find((t) => t.original && (!orig || t.lang === orig))
    || out.find((t) => t.original)
    || (orig ? out.find((t) => t.lang === orig) : null)
    || out[0];
  for (const t of out) {
    t.original = t === chosen;
    t.kind = t.original ? 'captions' : 'subtitles';        // captions = same language as the audio
    if (t.original) { delete t.translatedFrom; }
    else if (!t.translatedFrom) { t.translatedFrom = chosen.lang; }
  }
  // The original always sorts first so it is never lost in a truncation downstream.
  out.sort((a, b) => (a.original === b.original ? a.lang.localeCompare(b.lang) : (a.original ? -1 : 1)));
  return out.slice(0, LIMITS.captionsMax);
}

/** The one original track, or null. */
export const originalCaption = (captions) => (Array.isArray(captions) ? captions.find((t) => t && t.original) || null : null);

/** Every language this video is captioned in. */
export const captionLanguages = (captions) => (Array.isArray(captions) ? captions.map((t) => t && t.lang).filter(Boolean) : []);

/**
 * captionFor — the best track for a reader's preferred language.
 * Exact match → same base language (es-mx → es) → the ORIGINAL. Never null when any track exists:
 * the original is always the fallback, which is what "the original is always preserved" means in use.
 */
export function captionFor(captions, lang) {
  const list = Array.isArray(captions) ? captions.filter(Boolean) : [];
  if (!list.length) return null;
  const want = normLang(lang);
  if (want) {
    const exact = list.find((t) => t.lang === want);
    if (exact) return exact;
    const base = want.split('-')[0];
    const loose = list.find((t) => t.lang.split('-')[0] === base);
    if (loose) return loose;
  }
  return originalCaption(list) || list[0];
}

// ── BUILD ────────────────────────────────────────────────────────────────────────────────────────
/**
 * buildVideoMetadata — the json_metadata object for a MELEK video post.
 *
 * Shape (DTube/3Speak-compatible where that is free, plus what we actually need):
 *   {
 *     app, type, tags[], image[],                        // condenser conventions
 *     video: {
 *       url,                                             // flat playable URL — the shape our already-shipped
 *                                                        //   ScotTube/tunein readers understand (meta.video.url)
 *       info: { platform, title, author, permlink, duration, filesize, lang, width, height,
 *               contentType, thumbnail, provider, providerId, sourceMap[] },   // 3Speak-shaped
 *       content: { description, tags[] },                                       // DTube/3Speak-shaped
 *       captions: [ …one per language, exactly one original… ],                 // OURS
 *     }
 *   }
 *
 * Pure and total: bad input yields a metadata object that `validateVideoMetadata` will reject with a
 * reason. It never throws and it never invents a URL it cannot resolve.
 */
export function buildVideoMetadata(input = {}) {
  const i = input || {};
  const provider = isProvider(i.provider) ? str(i.provider).toLowerCase() : (i.provider ? str(i.provider).toLowerCase() : '');
  const providerId = str(i.providerId);
  const url = resolveVideoUrl({ provider, providerId, url: i.url });

  // If only a URL was given, recover a durable address from it so the post is still backend-portable.
  const inferred = (!provider || !providerId) ? inferProvider(i.url || url) : { provider, providerId };
  const finalProvider = isProvider(provider) && providerId ? provider : (inferred.provider || provider || '');
  const finalId = isProvider(provider) && providerId ? providerId : (inferred.providerId || providerId || '');

  const lang = normLang(i.lang) || 'en';
  const thumbnail = resolveVideoUrl({ provider: str(i.thumbnailProvider).toLowerCase(), providerId: str(i.thumbnailId), url: i.thumbnail });

  const tags = uniq([VIDEO_TAG, 'video', ...(Array.isArray(i.tags) ? i.tags : [])]
    .map((t) => str(t).toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean)).slice(0, LIMITS.tagsMax);

  // sourceMap — 3Speak's field name and row shape, so a 3Speak-aware reader can walk ours unchanged.
  const sourceMap = [];
  const renditions = Array.isArray(i.renditions) ? i.renditions.slice(0, LIMITS.renditionsMax) : [];
  for (const r of renditions) {
    if (!r || typeof r !== 'object') continue;
    const rUrl = resolveVideoUrl({ provider: str(r.provider).toLowerCase() || finalProvider, providerId: str(r.providerId), url: r.url });
    if (!rUrl) continue;
    const row = { type: 'video', url: rUrl, format: str(r.format) || guessFormat(rUrl, i.contentType) };
    const h = int(r.height);
    if (h) row.quality = `${h}p`;
    const kbps = int(r.bitrateKbps);
    if (kbps) row.bitrateKbps = kbps;
    sourceMap.push(row);
  }
  if (!sourceMap.length && url) {
    const row = { type: 'video', url, format: guessFormat(url, i.contentType) };
    const h = int(i.height);
    if (h) row.quality = `${h}p`;
    sourceMap.push(row);
  }
  if (thumbnail) sourceMap.push({ type: 'thumbnail', url: thumbnail, format: '' });

  const info = {
    platform: PLATFORM,
    title: str(i.title).slice(0, LIMITS.titleMax),
    author: str(i.author).toLowerCase(),
    permlink: str(i.permlink).toLowerCase(),
    duration: int(i.durationSec ?? i.duration) || 0,          // seconds — DTube and 3Speak both use seconds
    filesize: int(i.filesizeBytes ?? i.filesize) || 0,        // bytes
    lang,                                                     // the ORIGINAL spoken language
    provider: finalProvider,
    providerId: finalId,
    contentType: normContentType(i.contentType, url),
    sourceMap,
  };
  const w = int(i.width); const h = int(i.height);
  if (w) info.width = w;
  if (h) info.height = h;
  if (thumbnail) info.thumbnail = thumbnail;

  const meta = {
    app: str(i.app) || APP,
    type: TYPE,
    tags,
    video: {
      url,                                                    // read by engine/api ScotTube + site/tunein today
      info,
      content: {
        description: str(i.description).slice(0, LIMITS.descriptionMax),
        tags,
      },
      captions: normalizeCaptions(i.captions, lang),
    },
  };
  // captionIndex — the overflow valve. A caption track costs ~150–200 bytes of json_metadata, so ~40
  // languages would blow the 8 KiB budget on their own. When a video is captioned in more languages
  // than fit, the post carries the ORIGINAL plus the most-wanted few inline and points at an off-chain
  // manifest for the rest. The original is never the one that gets dropped (normalizeCaptions sorts it
  // first), so the invariant survives truncation.
  const idxUrl = resolveVideoUrl({ provider: str(i.captionIndexProvider).toLowerCase(), providerId: str(i.captionIndexId), url: i.captionIndex });
  if (idxUrl) {
    meta.video.captionIndex = { url: idxUrl };
    const total = int(i.captionCount);
    if (total) meta.video.captionIndex.count = total;
  }
  if (thumbnail) meta.image = [thumbnail];
  return meta;
}

function guessFormat(url, contentType) {
  const u = str(url).toLowerCase();
  if (/\.m3u8(\?|$)/.test(u)) return 'm3u8';
  if (/\.mpd(\?|$)/.test(u)) return 'mpd';
  const m = u.match(/\.(mp4|webm|ogv|ogg|mov)(\?|$)/);
  if (m) return m[1] === 'ogv' ? 'ogg' : m[1];
  const ct = str(contentType).toLowerCase();
  if (ct.startsWith('video/')) return ct.slice(6);
  return 'mp4';
}

function normContentType(contentType, url) {
  const ct = str(contentType).toLowerCase();
  if (CONTENT_TYPES.includes(ct)) return ct;
  const f = guessFormat(url, ct);
  if (f === 'm3u8') return 'application/x-mpegurl';
  if (f === 'mpd') return 'application/dash+xml';
  if (f === 'mov') return 'video/quicktime';
  if (['mp4', 'webm', 'ogg'].includes(f)) return `video/${f}`;
  return '';
}

/** The chain byte cost of a metadata object as it will actually ride in the op. */
export function metadataBytes(meta) {
  try { return Buffer.byteLength(JSON.stringify(meta), 'utf8'); } catch { return 0; }
}

// ── VALIDATE ─────────────────────────────────────────────────────────────────────────────────────
const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;
const PERMLINK_RE = /^[a-z0-9][a-z0-9-]{0,254}$/;

/**
 * validateVideoMetadata — reject a post that claims a video it cannot address, and keep the numbers sane.
 * Total: returns { ok, errors[], warnings[], addressable, url, bytes, captionLangs[] }. NEVER throws.
 * `errors` block the post; `warnings` do not.
 */
export function validateVideoMetadata(meta) {
  const errors = [];
  const warnings = [];
  const m = (meta && typeof meta === 'object') ? meta : {};
  const v = (m.video && typeof m.video === 'object') ? m.video : null;
  if (!v) {
    return { ok: false, errors: ['json_metadata carries no `video` object'], warnings, addressable: false, url: '', bytes: metadataBytes(m), captionLangs: [] };
  }
  const info = (v.info && typeof v.info === 'object') ? v.info : {};

  // ── addressability: the one rule that matters most ─────────────────────────────────────────────
  const url = resolveVideoUrl({ provider: info.provider, providerId: info.providerId, url: v.url });
  const addressable = !!url;
  if (!addressable) {
    errors.push('unaddressable video: neither (provider, providerId) nor a https `video.url` resolves to a playable URL');
  }
  if (!info.provider) warnings.push('no `provider` — this post is welded to whatever host that URL points at; it cannot be moved without an edit');
  else if (!isProvider(info.provider)) warnings.push(`unknown provider "${info.provider}" — resolution falls back to video.url`);
  if (String(info.provider).toLowerCase() === 'ipfs') {
    warnings.push('IPFS provider: a CID is an address, not a promise — somebody must pin it, or this post outlives its video (the DTube failure)');
  }

  // ── identity ───────────────────────────────────────────────────────────────────────────────────
  if (!str(info.title)) errors.push('missing title');
  else if (str(info.title).length > LIMITS.titleMax) errors.push(`title over ${LIMITS.titleMax} chars`);
  if (info.author && !ACCOUNT_RE.test(str(info.author))) errors.push(`invalid author account "${info.author}"`);
  if (info.permlink && !PERMLINK_RE.test(str(info.permlink))) errors.push(`invalid permlink "${info.permlink}"`);

  // ── sanity on the numbers ──────────────────────────────────────────────────────────────────────
  const dur = int(info.duration);
  if (!dur) errors.push('missing duration (seconds)');
  else if (dur < LIMITS.durationMin || dur > LIMITS.durationMax) {
    errors.push(`duration ${dur}s outside ${LIMITS.durationMin}–${LIMITS.durationMax}s`);
  }
  const size = int(info.filesize);
  if (size == null || size <= 0) warnings.push('no filesize — the cost model cannot check the claim against the bitrate');
  else if (size < LIMITS.filesizeMin || size > LIMITS.filesizeMax) errors.push(`filesize ${size} bytes outside 1 byte–32 GiB`);
  for (const [k, lo, hi] of [['width', LIMITS.widthMin, LIMITS.widthMax], ['height', LIMITS.heightMin, LIMITS.heightMax]]) {
    if (info[k] == null) continue;
    const n = int(info[k]);
    if (n == null || n < lo || n > hi) errors.push(`${k} ${info[k]} outside ${lo}–${hi}`);
  }
  if (info.contentType && !CONTENT_TYPES.includes(str(info.contentType).toLowerCase())) {
    warnings.push(`unrecognised contentType "${info.contentType}" — a player may refuse it`);
  }
  if (info.thumbnail && !isHttps(info.thumbnail)) warnings.push('thumbnail is not an https URL — it will not render');

  // ── captions: the original-preserved invariant ─────────────────────────────────────────────────
  const captions = Array.isArray(v.captions) ? v.captions.filter((t) => t && typeof t === 'object') : [];
  const originals = captions.filter((t) => t.original === true);
  if (captions.length && originals.length !== 1) {
    errors.push(`captions must mark exactly ONE original track (found ${originals.length}) — the original is never dropped`);
  }
  if (originals.length === 1 && normLang(info.lang) && originals[0].lang !== normLang(info.lang)) {
    errors.push(`the original caption track is "${originals[0].lang}" but the video's spoken language is "${info.lang}"`);
  }
  const langs = [];
  for (const t of captions) {
    const l = normLang(t.lang);
    if (!l) { errors.push('a caption track has no usable language code'); continue; }
    if (langs.includes(l)) errors.push(`duplicate caption language "${l}"`);
    langs.push(l);
    if (!resolveVideoUrl({ provider: t.provider, providerId: t.providerId, url: t.url })) {
      errors.push(`caption track "${l}" is unaddressable`);
    }
    if (t.original !== true && !normLang(t.translatedFrom)) {
      warnings.push(`caption track "${l}" does not record what it was translated from`);
    }
  }
  if (captions.length > LIMITS.captionsMax) errors.push(`more than ${LIMITS.captionsMax} caption tracks`);
  if (!captions.length) warnings.push('no caption tracks — translation is the differentiator; a video without an original track cannot be translated later');
  const idx = (v.captionIndex && typeof v.captionIndex === 'object') ? v.captionIndex : null;
  if (idx) {
    if (!resolveVideoUrl({ provider: idx.provider, providerId: idx.providerId, url: idx.url })) {
      errors.push('captionIndex is unaddressable');
    }
    const claimed = int(idx.count);
    if (claimed != null && claimed < captions.length) warnings.push(`captionIndex claims ${claimed} tracks but ${captions.length} are inline`);
  }

  // ── chain budget ───────────────────────────────────────────────────────────────────────────────
  const bytes = metadataBytes(m);
  if (bytes > MAX_JSON_METADATA_BYTES) {
    errors.push(`json_metadata is ${bytes} bytes, over the ${MAX_JSON_METADATA_BYTES}-byte budget (the whole transaction is capped at 65,536)`);
  } else if (bytes > WARN_JSON_METADATA_BYTES) {
    warnings.push(`json_metadata is ${bytes} bytes — approaching the ${MAX_JSON_METADATA_BYTES}-byte budget; caption tracks are URL references (never inline text) and overflow belongs in \`captionIndex\``);
  }

  return { ok: errors.length === 0, errors, warnings, addressable, url, bytes, captionLangs: langs };
}

// ── PARSE (legacy-tolerant) ──────────────────────────────────────────────────────────────────────
/**
 * parseVideoMetadata — read a post's json_metadata into one flat, normalized view.
 * Accepts the MELEK shape, our own already-shipped ScotTube shape (`video` as a bare string, or
 * `video.url`), DTube v1 (`video.info.snaphash` / `video.files.ipfs`) and 3Speak (`video.info.sourceMap`,
 * `video_v2: "ipfs://…"`). Returns { ok:false, reason } for anything that isn't a video post.
 * Total — a malformed JSON string is a soft `{ ok:false }`, never a throw.
 */
export function parseVideoMetadata(raw) {
  let m = raw;
  if (typeof raw === 'string') {
    try { m = JSON.parse(raw); } catch { return { ok: false, reason: 'json_metadata is not valid JSON' }; }
  }
  if (!m || typeof m !== 'object') return { ok: false, reason: 'no metadata' };
  const app = str(m.app);

  // legacy: `video` is a bare URL string (engine/api ScotTube's own post-builder writes this today)
  if (typeof m.video === 'string') {
    const url = resolveVideoUrl({ url: m.video });
    if (!url) return { ok: false, reason: 'video is a string but not an addressable URL' };
    const inf = inferProvider(m.video);
    return {
      ok: true, legacy: 'flat-string', app, platform: platformOf(app),
      url, provider: inf.provider, providerId: inf.providerId,
      title: str(m.title), author: '', permlink: '', description: '',
      duration: 0, filesize: 0, width: null, height: null, contentType: normContentType('', url),
      thumbnail: firstImage(m), lang: '', tags: tagsOf(m), captions: [], sourceMap: [],
    };
  }

  const v = (m.video && typeof m.video === 'object') ? m.video : null;
  if (!v) return { ok: false, reason: 'not a video post' };
  const info = (v.info && typeof v.info === 'object') ? v.info : {};
  const content = (v.content && typeof v.content === 'object') ? v.content : {};

  // Candidate addresses, best first: our flat url → 3Speak video_v2 → DTube ipfs hashes → sourceMap.
  const sourceMap = Array.isArray(info.sourceMap) ? info.sourceMap.filter((r) => r && typeof r === 'object') : [];
  const smVideo = sourceMap.find((r) => str(r.type).toLowerCase() === 'video' && str(r.url));
  const smThumb = sourceMap.find((r) => str(r.type).toLowerCase() === 'thumbnail' && str(r.url));
  const dtubeFiles = (v.files && typeof v.files === 'object' && v.files.ipfs && typeof v.files.ipfs === 'object') ? v.files.ipfs : {};
  const dtubeHash = ['video1080hash', 'video720hash', 'video480hash', 'video240hash']
    .map((k) => str(dtubeFiles[k])).find(Boolean) || str(content.videohash) || str(info.ipfs);

  let provider = str(info.provider).toLowerCase();
  let providerId = str(info.providerId);
  let url = resolveVideoUrl({ provider, providerId, url: v.url });
  if (!url) url = resolveVideoUrl({ url: str(info.video_v2) || str(v.video_v2) });
  if (!url && dtubeHash) url = resolveVideoUrl({ provider: 'ipfs', providerId: dtubeHash });
  if (!url && smVideo) url = resolveVideoUrl({ url: smVideo.url });
  if (!url) return { ok: false, reason: 'unaddressable video' };
  if (!provider || !providerId) {
    const inf = inferProvider(v.url || info.video_v2 || (smVideo && smVideo.url) || url);
    provider = provider || inf.provider;
    providerId = providerId || inf.providerId;
  }

  const lang = normLang(info.lang);
  const captions = normalizeCaptions(v.captions || m.captions, lang);
  const thumbnail = resolveVideoUrl({ url: info.thumbnail || (smThumb && smThumb.url) || firstImage(m) })
    || resolveVideoUrl({ provider: 'ipfs', providerId: str(info.snaphash) });

  return {
    ok: true,
    legacy: str(v.info && v.info.platform).toLowerCase() === PLATFORM || app.startsWith('melek/') ? '' : (platformOf(app) || 'foreign'),
    app,
    platform: str(info.platform).toLowerCase() || platformOf(app),
    url, provider, providerId,
    title: str(info.title) || str(m.title),
    author: str(info.author).toLowerCase(),
    permlink: str(info.permlink).toLowerCase(),
    description: str(content.description),
    duration: int(info.duration) || 0,
    filesize: int(info.filesize) || 0,
    width: int(info.width),
    height: int(info.height),
    contentType: normContentType(info.contentType, url),
    thumbnail,
    lang,
    tags: tagsOf(m).length ? tagsOf(m) : (Array.isArray(content.tags) ? content.tags.map(str).filter(Boolean) : []),
    captions,
    captionIndex: (v.captionIndex && typeof v.captionIndex === 'object')
      ? resolveVideoUrl({ provider: v.captionIndex.provider, providerId: v.captionIndex.providerId, url: v.captionIndex.url })
      : '',
    sourceMap,
  };
}

function platformOf(app) {
  const a = str(app).toLowerCase();
  if (a.startsWith('dtube')) return 'dtube';
  if (a.startsWith('3speak')) return '3speak';
  if (a.startsWith('melek')) return PLATFORM;
  return '';
}
function firstImage(m) {
  if (Array.isArray(m.image)) return str(m.image.find((x) => str(x))) || '';
  return str(m.image);
}
function tagsOf(m) {
  return Array.isArray(m.tags) ? uniq(m.tags.map((t) => str(t).toLowerCase()).filter(Boolean)) : [];
}

// ── THE INTENT (unsigned; broadcast happens at the MELEK-Signer boundary, never here) ────────────
/** A deterministic, chain-legal permlink for a video post. */
export function videoPermlink(title, at = Date.now()) {
  const slug = str(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const stamp = Number(at) > 0 ? Number(at).toString(36) : '0';
  return `${VIDEO_TAG}-${slug || 'video'}-${stamp}`.replace(/-+/g, '-').slice(0, 255);
}

/**
 * buildCommentIntent — the UNSIGNED standard Graphene `comment` op for a video post, plus its validation.
 * NOTHING here signs, holds a key, or touches the network. The caller hands `op` to MELEK-Signer.
 * @returns {{ ok, op, metadata, validation, permlink, note }}
 */
export function buildCommentIntent(input = {}) {
  const i = input || {};
  const author = str(i.author).toLowerCase();
  const permlink = str(i.permlink).toLowerCase() || videoPermlink(i.title, i.at);
  const metadata = buildVideoMetadata({ ...i, author, permlink });
  const validation = validateVideoMetadata(metadata);
  const body = str(i.body) || [
    str(i.description),
    '',
    validation.url ? `▶ ${validation.url}` : '',
  ].filter((l) => l !== null).join('\n').trim();

  const op = ['comment', {
    parent_author: '',
    parent_permlink: str(i.category).toLowerCase() || VIDEO_TAG,
    author,
    permlink,
    title: str(i.title).slice(0, LIMITS.titleMax),
    body,
    json_metadata: JSON.stringify(metadata),
  }];
  if (!ACCOUNT_RE.test(author)) validation.errors.push(`invalid author account "${i.author}"`);
  return {
    ok: validation.errors.length === 0,
    op,
    metadata,
    validation: { ...validation, ok: validation.errors.length === 0 },
    permlink,
    note: 'UNSIGNED INTENT — hand this op to MELEK-Signer. This repo holds no keys and broadcasts nothing.',
  };
}

// ── CLI (guarded) — `node pentecaust/video-post.mjs --demo` ───────────────────────────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const intent = buildCommentIntent({
    author: 'hathor',
    title: 'Pentecaust: the descent of tongues',
    description: 'The first MELEK video — captioned in every language, the original always preserved.',
    provider: 'melek',
    providerId: 'hathor/pentecaust-intro-1080p.mp4',
    durationSec: 600,
    filesizeBytes: 347_100_000,
    width: 1920, height: 1080,
    contentType: 'video/mp4',
    thumbnail: 'https://video.melek.salon/hathor/pentecaust-intro.jpg',
    lang: 'en',
    tags: ['melek', 'pentecaust'],
    at: 0,
    captions: [
      { lang: 'en', url: 'https://video.melek.salon/hathor/pentecaust-intro.en.vtt', source: 'human', original: true },
      { lang: 'hi', url: 'https://video.melek.salon/hathor/pentecaust-intro.hi.vtt', source: 'machine' },
      { lang: 'es', url: 'https://video.melek.salon/hathor/pentecaust-intro.es.vtt', source: 'machine' },
    ],
  });
  console.log('MELEK video post — UNSIGNED intent (nothing is broadcast)');
  console.log('─'.repeat(72));
  console.log(JSON.stringify(intent.op, null, 2));
  console.log('─'.repeat(72));
  console.log(`ok=${intent.ok}  json_metadata=${intent.validation.bytes} bytes (budget ${MAX_JSON_METADATA_BYTES})`);
  console.log(`url → ${intent.validation.url}`);
  console.log(`captions → ${intent.validation.captionLangs.join(', ') || '(none)'} · original = ${(originalCaption(intent.metadata.video.captions) || {}).lang || '—'}`);
  for (const e of intent.validation.errors) console.log(`  ERROR   ${e}`);
  for (const w of intent.validation.warnings) console.log(`  warn    ${w}`);
  console.log(`  ${intent.note}`);
}

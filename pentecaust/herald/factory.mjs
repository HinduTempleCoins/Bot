// pentecaust/herald/factory.mjs — the Herald CONTENT FACTORY (outreach brief, Component 5): one source
// document → per-platform drafts matched to each community's tone. It DRAFTS ONLY. Nothing in this module
// sends, posts, submits, or publishes anywhere — a human takes the draft and posts it on the third-party
// platform, per repo policy (Herald never posts to third-party sites; sending/posting is out of scope here).
//
// The LLM is INJECTED (like builder.mjs's __setLLM); with no LLM every platform still produces a real draft
// from a deterministic template, so the module is soft-fail-never-throw and fully offline-testable. Whatever
// text comes back — template or model — is run through the same voice/scrubber pipeline, so guardrails hold
// regardless of source.
//
//   import { PLATFORMS, draftFor, draftAll, __setLLM } from './factory.mjs'

// ── env helper (house style) ──────────────────────────────────────────────────────────────────────────
export function env(k, d) { const v = process.env[k]; return v == null || v === '' ? d : v; }

// ── injectable LLM (prompt:string) -> Promise<string>. Null = deterministic templates only. ──────────────
let _llm = null;
export function __setLLM(fn) { _llm = typeof fn === 'function' ? fn : null; }
async function ask(p) {
  if (!_llm) return null;
  try { const r = await _llm(String(p || '')); return r == null ? null : String(r); } catch { return null; }
}

// ── HTML escape (house style: esc() any interpolation that could reach HTML) ────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── the platforms/verticals + per-platform tone. Order is the public contract of draftAll(). ────────────
export const PLATFORMS = [
  'permies', 'indiadivine', 'historum', 'legalqa',
  'bitcointalk', 'greensheet', 'church_bulletin', 'nextdoor',
];

// "Royal We" = institutional first-person plural (a body speaks). Others = a person participating in a forum.
const ROYAL_WE = new Set(['church_bulletin', 'greensheet', 'bitcointalk']);
const isRoyalWe = (platform) => ROYAL_WE.has(platform);

const TONE = {
  permies:          'a permaculture / gardening forum; earthy, practical, first-person, share-what-you-grow',
  indiadivine:      'a Hindu community forum; devotional, respectful, first-person, plain and warm',
  historum:         'a mythology / history forum; curious, sourced, first-person, no hype',
  legalqa:          'a legal Q&A board; careful, plain-language, first-person, no legal advice, just information',
  bitcointalk:      'an ANN (announcement) update thread; concise project update, institutional first-person plural',
  greensheet:       'short classified copy; plain, honest, institutional first-person plural',
  church_bulletin:  'a church bulletin notice; gentle, communal, institutional first-person plural',
  nextdoor:         'a neighborhood board; neighborly, local, first-person, low-key',
};

// ── guardrails ──────────────────────────────────────────────────────────────────────────────────────────
// "first coin" plain-language: strip crypto-speculation jargon (never the word "invest").
const BANNED_JARGON = /\b(?:invest(?:ing|ment)?|HODL|to the moon|guaranteed returns)\b/gi;
// deliverability spam words that also read as hype in a community post.
const BANNED_SPAM = /\b(?:free|guarantee(?:d)?|act ?now|limited ?time|risk-?free)\b/gi;

// Neutralize both banned sets, then tidy the whitespace/punctuation the removals leave behind.
function scrub(s) {
  return String(s || '')
    .replace(BANNED_JARGON, '')
    .replace(BANNED_SPAM, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// "first coin" plain-language framing — earn/publish/participate, never invest/buy/trade.
const CALL_TO = 'You can read more, and if it fits, publish and participate — this is how many people earn their first coin.';

const clean = (s) => String(s || '').trim();

// Reference line: the canonical source URL, always appended as a plain reference (never a hyped link).
function referenceLine(url) {
  const u = clean(url);
  return u ? `Reference: ${u}` : '';
}

// ── build the LLM prompt for a platform (guardrailed; take its text if it answers). ──────────────────────
function promptFor(platform, source) {
  const voice = isRoyalWe(platform)
    ? 'Write in the institutional first-person plural ("we"/"our") — a body speaking, not one person.'
    : 'Write in the personal first person ("I") — one person participating in the community.';
  return [
    `You are drafting a community post for ${TONE[platform] || platform}.`,
    voice,
    'Plain language only. Do NOT use crypto jargon. NEVER use the word "invest". Use earn / publish / participate.',
    'Do NOT use spam/hype words (free, guaranteed, act now, limited time, risk-free).',
    'Keep it short and honest. End with a plain reference to the source URL. Return ONLY the post text.',
    `TITLE: ${clean(source && source.title)}`,
    `BODY: ${clean(source && source.body)}`,
    `VALUE: ${clean(source && source.valueProp)}`,
    `URL: ${clean(source && source.url)}`,
  ].join('\n');
}

// ── deterministic per-platform templates (used when no LLM, and as the guaranteed fallback). ────────────
function templateFor(platform, source) {
  const title = clean(source && source.title) || 'a small MELEK project';
  const value = clean(source && source.valueProp) || clean(source && source.body) || 'a place to publish and earn your first coin';
  const ref = referenceLine(source && source.url);
  const tail = ref ? `\n\n${ref}` : '';

  switch (platform) {
    // ── Royal We (institutional / distribution) ──
    case 'bitcointalk':
      return `[ANN UPDATE] ${title}\n\nWe are sharing a short update: ${value}. We built this so people can publish and participate, and earn their first coin by doing so. We welcome questions in the thread.${tail}`;
    case 'greensheet':
      return `${title} — ${value}. We invite you to publish and participate; this is how many earn their first coin. No cost to join.${tail}`;
    case 'church_bulletin':
      return `A note from our community: ${title}. ${value}. We warmly welcome anyone who would like to publish, participate, and earn their first coin alongside us. All are welcome.${tail}`;

    // ── personal first person (forum participation) ──
    case 'permies':
      return `I wanted to share something I've been growing with: ${title}. ${value}. I like that you can just publish what you know and participate — that's how I earned my first coin. Curious what folks here think.${tail}`;
    case 'indiadivine':
      return `Namaste. I'd like to share ${title} with this community. ${value}. I've found it a gentle place to publish and participate, and it's where I earned my first coin. Sharing in case it serves someone here.${tail}`;
    case 'historum':
      return `I came across ${title} and thought it might interest people here. ${value}. What drew me is that you publish and participate openly — I earned my first coin that way. Happy to discuss the details.${tail}`;
    case 'legalqa':
      return `Sharing for information only (not legal advice): ${title}. ${value}. As I understand it, you publish and participate, and that is how people earn their first coin. Please verify anything important yourself.${tail}`;
    case 'nextdoor':
      return `Hi neighbors — a quick share: ${title}. ${value}. It's an easy way to publish and participate locally, and how I earned my first coin. Happy to answer questions.${tail}`;

    default:
      return `${title}. ${value}. ${CALL_TO}${tail}`;
  }
}

// Make sure the URL survived the scrub (URLs shouldn't hit the banned lists, but re-append defensively).
function ensureReference(draft, source) {
  const ref = referenceLine(source && source.url);
  if (ref && !String(draft).includes(clean(source.url))) return `${draft}\n\n${ref}`;
  return draft;
}

// ── draftFor: one platform → { ok, platform, draft }. Unknown platform soft-fails { ok:false }. ─────────
export async function draftFor(platform, source = {}, opts = {}) {
  const key = String(platform || '').trim();
  if (!PLATFORMS.includes(key)) return { ok: false, platform: key, error: 'unknown platform' };

  let text = null;
  if (_llm) { try { text = await ask(promptFor(key, source)); } catch { text = null; } }
  const raw = clean(text) || templateFor(key, source);   // LLM text if it answered, else the template
  const draft = ensureReference(scrub(raw), source);      // one guardrail pipeline for both sources

  return { ok: true, platform: key, draft, voice: isRoyalWe(key) ? 'royal_we' : 'personal', source: text ? 'llm' : 'template' };
}

// ── draftAll: one source document → a draft for every platform. Never throws. ──────────────────────────
export async function draftAll(source = {}, opts = {}) {
  const out = {};
  for (const p of PLATFORMS) {
    try { const r = await draftFor(p, source, opts); out[p] = r && r.ok ? r.draft : ''; }
    catch { out[p] = ''; }
  }
  return out;
}

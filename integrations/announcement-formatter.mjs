// announcement-formatter.mjs — PURE multi-surface community-announcement RENDERER.
// (queue #440 community announcements, #438 social media content.) No network, no posting,
// no secrets, soft-fail everywhere — never throws. Returns strings the caller sends.
//
// Distinct from integrations/soapbox/announcements.mjs: that sibling is a STORE/LIST (it holds
// the set of announcements). THIS module takes ONE announcement object and FORMATS it for several
// surfaces (Discord, Telegram, Twitter/X, plain Markdown). One announcement in, surface-tailored
// text out. The caller owns the announcement data and the actual sending.
//
//   import { formatAnnouncement, formatAll, SURFACES, esc, charCount } from './announcement-formatter.mjs'
//   formatAnnouncement({ title, body, link, tags }, 'twitter')   -> string (<=280 incl link)
//   formatAll({ title, body, link, tags })                       -> { discord, telegram, twitter, markdown }
//   node integrations/announcement-formatter.mjs                 -> demo render of all surfaces

// --- HTML escape (strict; used for any HTML interpolation) -----------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- supported surfaces ----------------------------------------------------

export const SURFACES = ['discord', 'telegram', 'twitter', 'markdown'];

const TWITTER_MAX = 280;

// --- helpers (all soft-fail) -----------------------------------------------

export function charCount(s) {
  return String(s ?? '').length;
}

// Collapse to a single trimmed line of plain text. Used where a surface forbids
// newlines (e.g. the body fragment of a tweet).
function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function clean(s) {
  return String(s ?? '').trim();
}

// Normalize a tag into a #hashtag: strip leading '#', drop whitespace and any
// char that is not a word char, then re-prefix. Empty / junk tags drop out.
function hashtag(t) {
  const word = String(t ?? '').replace(/^#+/, '').replace(/[^\w]/g, '');
  return word ? `#${word}` : '';
}

function tagList(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map(hashtag).filter(Boolean);
}

// Telegram bold uses HTML parse-mode style; escape so a title/body can never
// inject markup. Discord uses Markdown **bold** — its content is plain text
// (no HTML rendering), so we leave it literal but still trim.
function telegramBold(s) {
  return `<b>${esc(s)}</b>`;
}

// --- per-surface renderers (each soft-fails to empty-safe strings) ---------

function renderMarkdown({ title, body, link, tags }) {
  const t = clean(title);
  const b = clean(body);
  const l = clean(link);
  const tg = tagList(tags);
  const parts = [];
  if (t) parts.push(`## ${t}`);
  if (b) parts.push(b);
  if (l) parts.push(l);
  if (tg.length) parts.push(tg.join(' '));
  return parts.join('\n\n');
}

function renderDiscord({ title, body, link, tags }) {
  const t = clean(title);
  const b = clean(body);
  const l = clean(link);
  const tg = tagList(tags);
  const parts = [];
  if (t) parts.push(`**${t}**`);
  if (b) parts.push(b);
  if (l) parts.push(l);
  if (tg.length) parts.push(tg.join(' '));
  return parts.join('\n\n');
}

function renderTelegram({ title, body, link, tags }) {
  const t = clean(title);
  const b = clean(body);
  const l = clean(link);
  const tg = tagList(tags);
  const parts = [];
  if (t) parts.push(telegramBold(t));
  // Body/link are escaped for HTML parse mode so user content can't inject tags.
  if (b) parts.push(esc(b));
  if (l) parts.push(esc(l));
  if (tg.length) parts.push(tg.map(esc).join(' '));
  return parts.join('\n\n');
}

// Twitter/X: a single line, <= 280 chars INCLUDING the link and hashtags.
// We reserve room for the link + tags, then truncate the title/body fragment
// with an ellipsis so the whole thing fits.
function renderTwitter({ title, body, link, tags }) {
  const l = clean(link);
  const tg = tagList(tags);
  const tagStr = tg.join(' ');

  // The lead text is title + body, collapsed to one line.
  const lead = oneLine([clean(title), oneLine(body)].filter(Boolean).join(' — '));

  // Suffix = trailing link + tags. Each present piece costs a leading space.
  const suffixPieces = [l, tagStr].filter(Boolean);
  const suffix = suffixPieces.join(' ');
  // Space between lead and suffix, only if both exist.
  const sep = lead && suffix ? ' ' : '';

  const full = `${lead}${sep}${suffix}`;
  if (charCount(full) <= TWITTER_MAX) return full;

  // Need to truncate the lead. Budget = 280 - (sep + suffix) - 1 for ellipsis.
  const reserve = charCount(sep) + charCount(suffix);
  let budget = TWITTER_MAX - reserve - 1; // 1 for the ellipsis char
  if (budget < 0) budget = 0;

  if (budget === 0) {
    // No room for any lead; fall back to a hard-truncated suffix-only string
    // (or empty). Keep it <=280 no matter what.
    return suffix.slice(0, TWITTER_MAX);
  }

  const truncated = `${lead.slice(0, budget).trimEnd()}…`;
  const out = `${truncated}${sep}${suffix}`;
  // Final guard: never exceed the cap even if trimEnd shifted things.
  return out.length <= TWITTER_MAX ? out : out.slice(0, TWITTER_MAX);
}

const RENDERERS = {
  discord: renderDiscord,
  telegram: renderTelegram,
  twitter: renderTwitter,
  markdown: renderMarkdown,
};

// --- public API ------------------------------------------------------------

// Format ONE announcement for ONE surface. Unknown / missing surface falls
// back to markdown. Missing announcement -> empty-safe markdown ('').
export function formatAnnouncement(announcement, surface) {
  const a = announcement && typeof announcement === 'object' ? announcement : {};
  const key = SURFACES.includes(surface) ? surface : 'markdown';
  const render = RENDERERS[key] || renderMarkdown;
  try {
    return render({
      title: a.title,
      body: a.body,
      link: a.link,
      tags: a.tags,
    });
  } catch {
    // Defensive: contract is never-throw.
    return '';
  }
}

// Format for ALL surfaces at once.
export function formatAll(announcement) {
  const out = {};
  for (const surface of SURFACES) {
    out[surface] = formatAnnouncement(announcement, surface);
  }
  return out;
}

// --- CLI demo (guarded) ----------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const demo = {
    title: 'MELEK testnet is live',
    body: 'Hathor is producing blocks and the price feed is publishing hourly. Join the witness school to learn how to sign up.',
    link: 'https://witness.melek.salon/hathor',
    tags: ['MELEK', 'witness', 'crypto'],
  };
  const all = formatAll(demo);
  for (const surface of SURFACES) {
    process.stdout.write(`\n=== ${surface} (${charCount(all[surface])} chars) ===\n`);
    process.stdout.write(all[surface] + '\n');
  }
}

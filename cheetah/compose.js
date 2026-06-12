/**
 * compose.js — Cheetah's comment generator.
 *
 * Deterministic template pool. Each surface (crediting / discovery / footer)
 * has multiple variants; the chosen variant is `sha256(account+permlink) % N`
 * so the same comment on the same post is stable across re-runs but
 * different posts/authors get different phrasings (avoids "always says the
 * same thing" complaints).
 *
 * Same pattern as `welcomer/composer.js` — operator's reference design.
 *
 * Per CHEETAH_ADVANCED.md §2: Cheetah states facts, never accuses. These
 * templates reflect that — "this also appears here" not "this is plagiarized."
 */

import { createHash } from 'node:crypto';
import { SELF_ID_LINK } from './config.js';

function pickVariant(seed, n) {
  const h = createHash('sha256').update(seed).digest('hex');
  return parseInt(h.slice(0, 8), 16) % n;
}

// ---- self-ID footer (appended to every Cheetah comment) -------------------
//
// Per Reddit-bot norms (CHEETAH_ADVANCED.md §7): self-identify on every
// comment, link to docs, name the opt-out path. Without this the bot gets
// treated as spam regardless of quality.

const FOOTER_VARIANTS = [
  `\n\n---\n*I'm Cheetah — a content-attribution and discovery librarian for the MELEK chain. I state where else content appears; I don't accuse. Reply with proof of authorship to update the record. [About / opt out](${SELF_ID_LINK}).*`,
  `\n\n---\n*Cheetah here. I find where content also appears and surface the link — crediting first, not accusing. If you're the original author, reply with proof and the record updates. [What I am / how to opt out](${SELF_ID_LINK}).*`,
  `\n\n---\n*Cheetah, the MELEK chain's attribution/discovery bot. Facts only; intent is for Hathor + you to resolve. [About me / opt out](${SELF_ID_LINK}).*`,
];

export function footer(seed = '') {
  return FOOTER_VARIANTS[pickVariant(seed || 'default', FOOTER_VARIANTS.length)];
}

// ---- crediting note (when match found in prior content) -------------------

const CREDITING_VARIANTS = [
  ({ source, confidence }) =>
    `Cross-reference: this content also appears at [${source.title || source.url}](${source.url}) ` +
    `(text similarity ${(confidence * 100).toFixed(0)}%). ` +
    `If you're the original author or have context on the relationship, reply below and the record will update.`,

  ({ source, confidence }) =>
    `Found a similar piece here: [${source.title || source.url}](${source.url}). ` +
    `Overlap is ${(confidence * 100).toFixed(0)}% by text-shingle match. ` +
    `Credit, self-quote, license? Reply and Hathor will help sort it.`,

  ({ source, confidence }) =>
    `Source link: [${source.title || source.url}](${source.url}) — text overlaps yours at ${(confidence * 100).toFixed(0)}%. ` +
    `Not an accusation; could be your own work, a quote, a license. Reply to add context and the entry gets resolved.`,
];

export function composeCreditingNote({ match, source, confidence }, seedKey = '') {
  if (!match || !source) {
    throw new Error('composeCreditingNote requires a positive match with source');
  }
  const variant = CREDITING_VARIANTS[pickVariant(seedKey || source.url, CREDITING_VARIANTS.length)];
  return variant({ source, confidence }) + footer(seedKey);
}

// ---- image credit note (pHash / reverse-image match) ----------------------
//
// The credit-giver core (operator 2026-06-01): state where an image FIRST appeared, as a
// fact, never an accusation. Handles both the on-chain-original case (source.author/permlink
// from perceptual-hash) and the open-web reverse-image case (source.url).

const IMAGE_CREDIT_VARIANTS = [
  ({ where, conf }) =>
    `Image credit: this image appears to have first appeared at ${where} (${conf}% match). ` +
    `If it's your own image, a licensed use, or a coincidence, reply and the record updates.`,
  ({ where, conf }) =>
    `Heads up — this image also appears at ${where} (${conf}% perceptual match), posted earlier. ` +
    `Crediting the source, not accusing. Reply with context and Hathor will help resolve.`,
  ({ where, conf }) =>
    `Source of this image (by earliest appearance): ${where} — ${conf}% match. ` +
    `Could be your own re-post, a license, or a coincidence; reply to add context.`,
];

// Render a single source as a clickable link. on-chain original -> /@author/permlink (condenser
// resolves it); open-web (reverse-image) -> the external url/title. Used for both single and
// multi-image credit notes, so EXTERNAL sources (Google Lens / Bing reverse-image hits) are
// credited the same way as on-chain ones.
function linkFor(s) {
  return s.author
    ? `[@${s.author}/${s.permlink}](/@${s.author}/${s.permlink})`
    : `[${s.title || s.url}](${s.url})`;
}

// Accepts a single source ({source, confidence}) OR a list ({sources:[{...,confidence}]}). With more
// than one distinct source — e.g. a post with 5 images each first seen elsewhere — it credits EVERY
// source (on-chain and open-web), one line each, instead of only the first.
export function composeImageCreditNote({ match, source, sources, confidence }, seedKey = '') {
  const list = (sources && sources.length)
    ? sources
    : (source ? [{ ...source, confidence }] : []);
  if (!match || !list.length) throw new Error('composeImageCreditNote requires a positive match with source(s)');

  if (list.length === 1) {
    const s = list[0];
    const where = linkFor(s);
    const conf = Math.round((s.confidence || confidence || 0) * 100);
    const variant = IMAGE_CREDIT_VARIANTS[pickVariant(seedKey || s.permlink || s.url || 'img', IMAGE_CREDIT_VARIANTS.length)];
    return variant({ where, conf }) + footer(seedKey);
  }

  const lines = list.map((s) => `- ${linkFor(s)} — ${Math.round((s.confidence || 0) * 100)}% match`);
  return `${list.length} images in this post appear to have first appeared elsewhere. Crediting each source (not accusing):\n\n${lines.join('\n')}\n\nIf any are your own, licensed, or coincidental, reply and the record updates.${footer(seedKey)}`;
}

// ---- discovery note (similar internal content, no plagiarism implied) -----

const DISCOVERY_VARIANTS = [
  ({ related }) =>
    `Related on MELEK: ` +
    related.slice(0, 3).map((r) => `[@${r.author}](${r.url})`).join(', ') +
    `. Same general thread; might be worth a read.`,

  ({ related }) =>
    `If this is your topic, these MELEK authors are also writing about it: ` +
    related.slice(0, 3).map((r) => `[@${r.author}](${r.url})`).join(', ') +
    `.`,

  ({ related }) =>
    `Discovery: similar work by ` +
    related.slice(0, 3).map((r) => `[@${r.author}](${r.url})`).join(', ') +
    ` — same thread, different voices.`,
];

export function composeDiscoveryNote({ related }, seedKey = '') {
  if (!related || related.length === 0) {
    throw new Error('composeDiscoveryNote requires at least one related entry');
  }
  const variant = DISCOVERY_VARIANTS[pickVariant(seedKey || related[0].url, DISCOVERY_VARIANTS.length)];
  return variant({ related }) + footer(seedKey);
}

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

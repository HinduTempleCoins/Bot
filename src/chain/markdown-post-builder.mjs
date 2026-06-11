/**
 * src/chain/markdown-post-builder.mjs — pure Graphene `comment` op assembler.
 *
 * PURE. No signing, no broadcast, no key access, no network, no I/O. Takes
 * plain inputs and assembles a standard Graphene `comment` operation tuple
 * (and its stringified `json_metadata`) for the Surface-2/Witness publisher
 * to hand to MELEK-Signer. This module never touches a WIF, never reaches a
 * chain client — it only shapes the payload.
 *
 * A Graphene `comment` op is the tuple:
 *   ['comment', {
 *     parent_author, parent_permlink, author, permlink,
 *     title, body, json_metadata
 *   }]
 * A root post has an empty parent_author; parent_permlink then carries the
 * primary tag (category). A reply sets parent_author/parent_permlink to the
 * comment being answered, and (by convention) an empty title.
 *
 * Exports:
 *   buildComment({author, parentAuthor='', parentPermlink, permlink,
 *                 title, body, tags=[], app='melek'})
 *                                  -> ['comment', {...}] op tuple, or {error}
 *   buildMetadata({tags, app, images})  -> json_metadata object
 *   normalizeTags(tags)                 -> deduped, lowercased, max-5 array
 *                                          (first tag = category)
 *   esc(s)                              -> HTML-escape for safe interpolation
 *
 * Soft-fail: missing required fields produce a `{ error }` marker object
 * rather than throwing. Over-long bodies are left intact (the caller's
 * concern), but tags are always clamped to 5.
 */

// ---- constants -------------------------------------------------------------

const MAX_TAGS = 5;
const DEFAULT_APP = 'melek';

// ---- helpers ---------------------------------------------------------------

/** Coerce anything to a string; null/undefined/non-string -> ''. */
function asString(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Is `v` a non-empty string after trimming? */
function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** HTML-escape for safe interpolation. Never throws. */
export function esc(s) {
  return asString(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalize a tag list:
 *  - coerce each entry to a trimmed lowercase string
 *  - drop empties
 *  - dedupe (first occurrence wins, preserving order)
 *  - clamp to MAX_TAGS (5)
 * The first surviving tag is the post's category (parent_permlink on a root).
 * Returns [] for non-array / all-empty input. Never throws.
 */
export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const t = asString(raw).trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Build a json_metadata object for a comment.
 *  - tags: normalized (deduped/lowercased/clamped)
 *  - app:  defaults to 'melek'
 *  - format: always 'markdown'
 *  - images: included only when a non-empty array of strings is supplied
 * Returns a plain object. Never throws.
 */
export function buildMetadata({ tags, app, images } = {}) {
  const meta = {
    tags: normalizeTags(tags),
    app: nonEmpty(app) ? app.trim() : DEFAULT_APP,
    format: 'markdown',
  };
  if (Array.isArray(images)) {
    const imgs = images.map((s) => asString(s).trim()).filter((s) => s.length > 0);
    if (imgs.length > 0) meta.image = imgs;
  }
  return meta;
}

/**
 * Assemble a Graphene `comment` operation tuple from inputs.
 *
 * Required: author, parentPermlink, permlink. (For a root post,
 * parentPermlink is the category — typically the first tag.)
 * Missing any required field returns a `{ error, missing }` marker object
 * instead of throwing.
 *
 * parentAuthor === '' (default) => root post; otherwise => reply.
 * json_metadata is stringified ({tags, app, format:'markdown'[, image]}).
 * Returns ['comment', {...}] on success.
 */
export function buildComment({
  author,
  parentAuthor = '',
  parentPermlink,
  permlink,
  title,
  body,
  tags = [],
  app = DEFAULT_APP,
  images,
} = {}) {
  const missing = [];
  if (!nonEmpty(author)) missing.push('author');
  if (!nonEmpty(parentPermlink)) missing.push('parentPermlink');
  if (!nonEmpty(permlink)) missing.push('permlink');
  if (missing.length > 0) {
    return { error: `missing required field(s): ${missing.join(', ')}`, missing };
  }

  const meta = buildMetadata({ tags, app, images });

  const payload = {
    parent_author: asString(parentAuthor),
    parent_permlink: asString(parentPermlink),
    author: asString(author),
    permlink: asString(permlink),
    title: asString(title),
    body: asString(body),
    json_metadata: JSON.stringify(meta),
  };

  return ['comment', payload];
}

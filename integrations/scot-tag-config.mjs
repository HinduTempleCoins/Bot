/**
 * scot-tag-config.mjs — pure SCOT/SMT tag-CONFIG validator + normalizer.
 *
 * This validates and normalizes the tag CONFIGURATION itself — the list of tags
 * an operator wants a SCOT/SMT token to reward (e.g. #vankush, #punicwax,
 * #cryptology). It is DISTINCT from scot-tag-distribution.mjs, which takes an
 * already-valid config and computes reward distribution across tagged posts.
 * Nothing here touches the chain or any I/O.
 *
 * Hive tag rules encoded here (string-only, public-safe):
 *   - a tag is at most 24 characters,
 *   - allowed characters are lowercase letters, digits, and single hyphens,
 *   - a leading '#' is stripped, the rest is lowercased,
 *   - runs of hyphens collapse to one and leading/trailing hyphens are trimmed,
 *   - the FIRST / main tag must START WITH A LETTER (category rule),
 *   - a post (and thus a reward config) carries at most 5 tags.
 *
 * Everything is pure and deterministic. Bad input soft-fails to '' / false /
 * empty buckets; nothing throws.
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

/** Hive tag limits. */
export const MAX_TAG_LEN = 24;
export const MAX_TAGS = 5;

/**
 * normalizeTag(raw) -> canonical tag.
 *
 * Strips a single leading '#', lowercases, keeps only [a-z0-9-], collapses runs
 * of hyphens to one, trims leading/trailing hyphens. Returns '' if the raw value
 * is not a string-like scalar or normalizes to something invalid (empty, or
 * longer than MAX_TAG_LEN). Never throws.
 */
export function normalizeTag(raw) {
  if (raw == null) return '';
  // Only accept scalars; objects/arrays/functions are not tags.
  const t = typeof raw;
  if (t !== 'string' && t !== 'number' && t !== 'boolean') return '';

  let s = String(raw).trim();
  if (s === '') return '';

  // Strip one leading '#' (a hashtag form like '#vankush').
  if (s.startsWith('#')) s = s.slice(1);

  s = s.toLowerCase();
  // Drop everything that is not a lowercase letter, digit, or hyphen.
  s = s.replace(/[^a-z0-9-]/g, '');
  // Collapse hyphen runs, trim leading/trailing hyphens.
  s = s.replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');

  if (s === '') return '';
  if (s.length > MAX_TAG_LEN) return '';
  return s;
}

/**
 * isMainTagValid(tag) -> boolean.
 *
 * True when `tag`, after normalization, is a valid Hive *main* (first) tag: it
 * normalizes to a non-empty value within length, AND starts with a letter
 * (a-z). The main/category tag may not start with a digit or hyphen.
 * Soft-fail: invalid input -> false. Never throws.
 */
export function isMainTagValid(tag) {
  const norm = normalizeTag(tag);
  if (norm === '') return false;
  return /^[a-z]/.test(norm);
}

/**
 * dedupe(list) -> ordered unique normalized tags.
 *
 * Normalizes each entry, drops empties, and returns the distinct tags in
 * first-seen order. Non-array input -> []. Never throws.
 */
export function dedupe(list) {
  const arr = Array.isArray(list) ? list : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const norm = normalizeTag(raw);
    if (norm === '') continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/**
 * validateTags(list) -> {valid, invalid, duplicates}.
 *
 * Walks the raw list in order and bins each entry:
 *   - invalid:    raw entries that normalize to '' (unusable), reported as their
 *                 original raw form (string-coerced) for operator feedback.
 *   - duplicates: entries that normalize to a tag already accepted, reported by
 *                 their normalized form.
 *   - valid:      the accepted normalized tags, in first-seen order, capped at
 *                 MAX_TAGS — and with the FIRST accepted tag required to be a
 *                 valid main tag (starts with a letter). If the first otherwise-
 *                 acceptable tag fails the main-tag rule it is moved to `invalid`
 *                 and the search continues for a valid main tag.
 *
 * Tags accepted beyond the MAX_TAGS cap are reported in `invalid` (over-limit).
 * Soft-fail: non-array input -> all empty buckets. Never throws.
 */
export function validateTags(list) {
  const arr = Array.isArray(list) ? list : [];
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const accepted = new Set();
  let haveMain = false;

  for (const raw of arr) {
    const norm = normalizeTag(raw);
    if (norm === '') {
      invalid.push(rawLabel(raw));
      continue;
    }
    if (accepted.has(norm)) {
      duplicates.push(norm);
      continue;
    }
    // The first VALID (kept) tag must be a usable main tag.
    if (!haveMain) {
      if (!/^[a-z]/.test(norm)) {
        // Cannot serve as the main tag; reject this one and keep looking.
        invalid.push(norm);
        continue;
      }
      haveMain = true;
    }
    if (valid.length >= MAX_TAGS) {
      invalid.push(norm); // over the per-config tag cap
      continue;
    }
    accepted.add(norm);
    valid.push(norm);
  }

  return { valid, invalid, duplicates };
}

/** Render a raw entry as a short label for the `invalid` bucket. */
function rawLabel(raw) {
  if (raw == null) return '';
  const t = typeof raw;
  if (t === 'string' || t === 'number' || t === 'boolean') return String(raw);
  return `[${t}]`;
}

/**
 * summarize(list) -> markdown string.
 *
 * Runs validateTags(list) and renders a human-readable report. All interpolated
 * values are esc()'d. Soft-fail: invalid input renders an empty report.
 */
export function summarize(list) {
  const { valid, invalid, duplicates } = validateTags(list);
  const main = valid.length ? valid[0] : '';

  const lines = [];
  lines.push('# SCOT/SMT tag-config validation');
  lines.push('');
  lines.push(`- main tag: **${main ? esc(main) : '(none)'}**`);
  lines.push(`- valid (${esc(valid.length)}/${esc(MAX_TAGS)}): ${valid.length ? valid.map((t) => esc(t)).join(', ') : '(none)'}`);
  lines.push(`- invalid (${esc(invalid.length)}): ${invalid.length ? invalid.map((t) => esc(t)).join(', ') : '(none)'}`);
  lines.push(`- duplicates (${esc(duplicates.length)}): ${duplicates.length ? duplicates.map((t) => esc(t)).join(', ') : '(none)'}`);
  return lines.join('\n');
}

/* ----------------------------------------------------------------------------
 * CLI worked example — guarded so importing this module never runs it.
 * ------------------------------------------------------------------------- */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // The queue example: '#vankush', '#punicwax', '#cryptology', plus messy input.
  const example = [
    '#VanKush',
    '  punicwax ',
    '#crypt--ology',
    'vankush', // duplicate of the first once normalized
    '7bad-main', // starts with a digit: invalid as a leading/main tag
    'this-tag-is-way-too-long-to-be-valid', // > 24 chars
    'extra1',
    'extra2',
    'extra3', // pushes past the 5-tag cap
  ];
  // eslint-disable-next-line no-console
  console.log(summarize(example));
  // eslint-disable-next-line no-console
  console.log('\nnormalizeTag("#Van Kush!") =>', JSON.stringify(normalizeTag('#Van Kush!')));
  // eslint-disable-next-line no-console
  console.log('isMainTagValid("7coins") =>', isMainTagValid('7coins'));
  // eslint-disable-next-line no-console
  console.log('dedupe(["#a","a","b"]) =>', JSON.stringify(dedupe(['#a', 'a', 'b'])));
}

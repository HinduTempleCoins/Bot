/**
 * src/chain/permlink.mjs — deterministic Graphene permlink + slug helpers.
 *
 * PURE. No network, no chain client, no I/O. The Surface-2 publisher needs
 * stable, Graphene-legal permlinks plus a versioning convention so that
 * re-publishing a post (or resolving a collision) yields a predictable
 * '-vN' suffix rather than an arbitrary id.
 *
 * Graphene permlink legality (the comment_operation permlink validator):
 *   - characters: a-z, 0-9, and '-' only (lowercase)
 *   - no leading or trailing hyphen
 *   - no consecutive ('--') hyphens
 *   - 1..256 characters
 *
 * Exports:
 *   slugify(title)                     -> Graphene-legal slug ('' on bad input)
 *   permalink({title,date,version})    -> versioned (and optionally date-prefixed) permlink
 *   bumpVersion(permlink)              -> next '-vN' suffix (v1->v2, none->v2)
 *   isValidPermlink(s)                 -> boolean against the Graphene regex
 *   esc(s)                             -> HTML-escape for safe interpolation
 *
 * Soft-fail: non-string / empty / nullish inputs clamp to '' and never throw.
 */

// ---- spec ------------------------------------------------------------------

const MAX_LEN = 256;

// Graphene-legal permlink: lowercase a-z0-9, single hyphens between runs,
// no leading/trailing/double hyphen, 1..256 chars.
const PERMLINK_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---- helpers ---------------------------------------------------------------

/** Coerce anything to a string; null/undefined/non-string -> ''. */
function asString(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * HTML-escape for safe interpolation. Soft: non-string clamps to ''.
 */
export function esc(s) {
  return asString(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Fold a title to a Graphene-legal permlink slug.
 *  - Unicode-normalize (NFKD) and strip combining marks (é -> e).
 *  - Lowercase.
 *  - Replace any run of non [a-z0-9] (incl. emoji, punctuation, whitespace)
 *    with a single hyphen.
 *  - Trim leading/trailing hyphens, collapse doubles.
 *  - Clamp to 256 chars (and re-trim any trailing hyphen the clamp produced).
 * Returns '' for empty / non-string / all-stripped input. Never throws.
 */
export function slugify(title) {
  const raw = asString(title);
  if (!raw) return '';

  let s;
  try {
    s = raw.normalize('NFKD');
  } catch {
    s = raw;
  }

  s = s
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')     // any non-legal run -> single hyphen
    .replace(/^-+/, '')              // trim leading
    .replace(/-+$/, '');             // trim trailing

  if (s.length > MAX_LEN) {
    s = s.slice(0, MAX_LEN).replace(/-+$/, '');
  }
  return s;
}

/**
 * True iff `s` is a valid Graphene permlink (1..256, the PERMLINK_RE shape).
 * Soft: non-string returns false, never throws.
 */
export function isValidPermlink(s) {
  const v = asString(s);
  if (!v || v.length > MAX_LEN) return false;
  return PERMLINK_RE.test(v);
}

/**
 * Bump (or add) a trailing '-vN' version suffix.
 *  - 'my-post'      -> 'my-post-v2'   (no version => next is v2, v1 is implicit)
 *  - 'my-post-v2'   -> 'my-post-v3'
 *  - 'v3' alone     -> 'v4' (a bare version token still bumps)
 * Soft: non-string / empty -> '' (nothing to bump). Never throws. Result is
 * clamped to stay <= 256 chars; if appending the suffix would overflow, the
 * base is trimmed to make room.
 */
export function bumpVersion(permlink) {
  const v = asString(permlink);
  if (!v) return '';

  const m = v.match(/^(.*?)-v(\d+)$/);
  let base, next;
  if (m) {
    base = m[1];
    next = (parseInt(m[2], 10) || 1) + 1;
  } else {
    // a bare 'vN' token (no base) still bumps
    const bare = v.match(/^v(\d+)$/);
    if (bare) {
      return 'v' + ((parseInt(bare[1], 10) || 1) + 1);
    }
    base = v;
    next = 2; // implicit v1 -> v2
  }

  const suffix = '-v' + next;
  let out = base + suffix;
  if (out.length > MAX_LEN) {
    base = base.slice(0, MAX_LEN - suffix.length).replace(/-+$/, '');
    out = base + suffix;
  }
  return out;
}

/**
 * Build a versioned permlink from a structured spec.
 *
 *   permalink({ title })                       -> slug
 *   permalink({ title, version: 2 })           -> slug-v2   (version <=1 omitted)
 *   permalink({ title, date: '2026-06-10' })   -> 2026-06-10-slug (date-prefixed)
 *   permalink({ title, date, version: 3 })     -> 2026-06-10-slug-v3
 *
 * `date` accepts a YYYY-MM-DD string or a Date; anything else is ignored.
 * `version` < 2 (or absent / non-numeric) produces no suffix (v1 is implicit).
 * Result is always Graphene-legal (re-slugified) and clamped to 256 chars.
 * Soft: empty/garbage title -> '' . Never throws.
 */
export function permalink(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const slug = slugify(s.title);
  if (!slug) return '';

  let prefix = '';
  if (s.date != null) {
    let d = '';
    if (s.date instanceof Date && !Number.isNaN(s.date.getTime())) {
      d = s.date.toISOString().slice(0, 10);
    } else if (typeof s.date === 'string') {
      const dm = s.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (dm) d = `${dm[1]}-${dm[2]}-${dm[3]}`;
    }
    if (d) prefix = d + '-';
  }

  let suffix = '';
  const ver = Number(s.version);
  if (Number.isFinite(ver) && ver >= 2) {
    suffix = '-v' + Math.floor(ver);
  }

  // Compose then re-slugify to guarantee legality, then clamp.
  let out = slugify(prefix + slug) ;
  if (suffix) {
    // append suffix as-is (it is already legal), trimming base if needed
    if (out.length + suffix.length > MAX_LEN) {
      out = out.slice(0, MAX_LEN - suffix.length).replace(/-+$/, '');
    }
    out = out + suffix;
  } else if (out.length > MAX_LEN) {
    out = out.slice(0, MAX_LEN).replace(/-+$/, '');
  }
  return out;
}

// ---- CLI guard -------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('permlink.mjs')) {
  const title = process.argv.slice(2).join(' ') || 'Hello MELEK World';
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    title,
    slug: slugify(title),
    permalink: permalink({ title, date: new Date(), version: 2 }),
    bumped: bumpVersion(slugify(title)),
  }, null, 2));
}

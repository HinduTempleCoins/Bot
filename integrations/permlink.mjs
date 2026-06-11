// permlink.mjs — Permlink slug + version generator (backlog 73b81cb916).
// PURE deterministic string utility for Graphene comment permlinks.
// No network, no keys, no clock-by-default. Soft-fail to safe defaults; never throws.
// MediaWiki and chain sinks are decoupled — this file produces the canonical chain-side
// permlink string only; callers map titles -> permlinks however they like.
//
// Graphene permlink rules this respects: lowercase, ASCII, [a-z0-9-] only, length-bounded
// (we cap at 255 to be safe across forks). Idempotent: slugify(slugify(x)) === slugify(x).
//
//   import { slugify, permlink, versionedPermlink, parseVersion, nextVersion } from './permlink.mjs'
//   node integrations/permlink.mjs

// --- diacritic stripping (best-effort, no external deps) -------------------
// NFD decomposition splits accented chars into base + combining marks; we then drop
// the combining-marks block (U+0300–U+036F). Falls back gracefully if normalize is absent.

function stripDiacritics(s) {
  try {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    return s;
  }
}

// --- slugify ---------------------------------------------------------------
// title -> lowercase ASCII slug:
//   strip diacritics best-effort, lowercase, replace every non-[a-z0-9] run with a single '-',
//   collapse/trim hyphens, truncate to maxLen (default 255), fallback 'post' if empty.

export function slugify(title, { maxLen = 255 } = {}) {
  let s;
  try {
    s = String(title ?? '');
  } catch {
    return 'post';
  }
  s = stripDiacritics(s).toLowerCase();
  // replace any run of non-slug chars with a single hyphen
  s = s.replace(/[^a-z0-9]+/g, '-');
  // collapse repeats (defensive) and trim leading/trailing hyphens
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');

  let lim = Number(maxLen);
  if (!Number.isFinite(lim) || lim <= 0) lim = 255;
  lim = Math.floor(lim);
  if (s.length > lim) {
    s = s.slice(0, lim).replace(/-+$/g, '');
  }
  return s || 'post';
}

// --- permlink --------------------------------------------------------------
// Convenience alias: a permlink IS a slug. Kept distinct so callers read intent.

export function permlink(title, { maxLen = 255 } = {}) {
  return slugify(title, { maxLen });
}

// --- versionedPermlink -----------------------------------------------------
// base, n -> base (for n<=1) or `${base}-v${n}` (for n>1). n is floored; non-numeric -> base.

export function versionedPermlink(base, n) {
  let b;
  try {
    b = String(base ?? '');
  } catch {
    b = '';
  }
  let v = Number(n);
  if (!Number.isFinite(v)) v = 1;
  v = Math.floor(v);
  if (v <= 1) return b;
  return `${b}-v${v}`;
}

// --- parseVersion ----------------------------------------------------------
// permlink -> { base, version }. A trailing `-vN` (N>=2, integer) is parsed off;
// version defaults to 1 when there is no such suffix. `-v1` is not a real version
// suffix (versionedPermlink never emits it), so it is left as part of the base.

export function parseVersion(pl) {
  let s;
  try {
    s = String(pl ?? '');
  } catch {
    return { base: '', version: 1 };
  }
  const m = s.match(/^(.*)-v([0-9]+)$/);
  if (m) {
    const v = parseInt(m[2], 10);
    if (Number.isFinite(v) && v >= 2) {
      return { base: m[1], version: v };
    }
  }
  return { base: s, version: 1 };
}

// --- nextVersion -----------------------------------------------------------
// permlink -> the next versioned permlink (bumps the parsed version by one).

export function nextVersion(pl) {
  const { base, version } = parseVersion(pl);
  return versionedPermlink(base, version + 1);
}

// --- CLI -------------------------------------------------------------------

function examples() {
  const lines = [];
  const titles = [
    'Hello, MELEK World!',
    'Café déjà vu — naïve résumé',
    '   ___   ',
    '',
    'A'.repeat(300),
  ];
  for (const t of titles) {
    const shown = t.length > 30 ? t.slice(0, 27) + '...' : t;
    lines.push(`slugify(${JSON.stringify(shown)}) -> ${slugify(t)}`);
  }
  const base = slugify('Introducing Hathor on MELEK');
  lines.push(`versionedPermlink(${JSON.stringify(base)}, 1) -> ${versionedPermlink(base, 1)}`);
  lines.push(`versionedPermlink(${JSON.stringify(base)}, 3) -> ${versionedPermlink(base, 3)}`);
  const v3 = versionedPermlink(base, 3);
  lines.push(`parseVersion(${JSON.stringify(v3)}) -> ${JSON.stringify(parseVersion(v3))}`);
  lines.push(`nextVersion(${JSON.stringify(v3)}) -> ${nextVersion(v3)}`);
  lines.push(`nextVersion(${JSON.stringify(base)}) -> ${nextVersion(base)}`);
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('permlink.mjs')) {
  console.log(examples());
}

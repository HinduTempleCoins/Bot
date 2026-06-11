// handle-suggest.mjs — PURE, deterministic handle/username suggester for MELEK signup.
// No network, no chain calls, no keys, no I/O, no LLM, no randomness. Backlog 8b0cb42b09.
//
// PURPOSE (read before changing rules):
//   Signup and the Witness's "post as her / create a handle" flow (queue id 281) need to turn a
//   human-typed name into a valid, AVAILABLE chain-handle, and to OFFER a short list of fallbacks
//   when the first choice is taken. This module does that with pure string rules:
//     - slugifyHandle: normalize any name to the allowed charset.
//     - suggestHandles: derive a ranked list of candidates via deterministic suffix strategies,
//                       skipping anything already taken (case-insensitive).
//     - isValidHandle:  validate a single handle against the chain-handle shape rules.
//     - firstAvailable: the single best available handle (or a deterministic fallback).
//
//   DETERMINISTIC: given the same (name, taken) inputs the output is always identical. No Date,
//   no Math.random, no clock — "year-agnostic counter" means a plain numeric counter, not the year.
//
// HANDLE SHAPE (isValidHandle):
//     - 3..16 chars
//     - charset [a-z0-9-]
//     - must start with a letter [a-z]
//     - no leading/trailing dash, no doubled dashes (slugify already collapses these)
//
// SOFT-FAIL, NEVER THROW: empty / garbage / wrong-type names collapse to a deterministic fallback
//   ('user', then 'user2', 'user3', ... against `taken`). Functions always return well-formed values.
//
//   import { slugifyHandle, suggestHandles, isValidHandle, firstAvailable }
//     from './integrations/handle-suggest.mjs';
//   suggestHandles('Mehit the Witness', { taken: ['mehit'], count: 5 });
//   // -> ['mehitthewitness', 'mehit2', 'mehitwitness', 'mhtthwtnss', ...]  (deterministic)
//
// CLI:  node integrations/handle-suggest.mjs        # print a worked example

// ── HTML escape: used for any interpolated value ────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── shape constants ─────────────────────────────────────────────────────────────────────────────
export const MIN_LEN = 3;
export const MAX_LEN = 16;
const FALLBACK = 'user';
const VOWELS = /[aeiou]/g;

// safe string coercion: anything nullish / non-string → '' (never throws)
function str(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return '';
}

// ── slugifyHandle: normalize a name to lowercase ascii [a-z0-9-], collapse repeats, trim dashes ───
export function slugifyHandle(name, { maxLen = MAX_LEN } = {}) {
  const cap = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : MAX_LEN;
  let s = str(name).toLowerCase();
  // strip diacritics where the JS runtime supports it (deterministic, no IO)
  try { s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch { /* soft-fail */ }
  s = s
    .replace(/[^a-z0-9-]+/g, '-') // anything outside charset → dash
    .replace(/-+/g, '-')          // collapse repeated dashes
    .replace(/^-+|-+$/g, '');     // trim leading/trailing dashes
  if (s.length > cap) {
    s = s.slice(0, cap).replace(/-+$/g, ''); // re-trim a dash exposed by the cut
  }
  return s;
}

// ── isValidHandle: enforce 3..16 chars, starts alpha, allowed charset ─────────────────────────────
export function isValidHandle(h) {
  const s = str(h);
  if (s === '') return { ok: false, reason: 'empty' };
  if (s !== s.toLowerCase()) return { ok: false, reason: 'must be lowercase' };
  if (s.length < MIN_LEN) return { ok: false, reason: `too short (min ${MIN_LEN})` };
  if (s.length > MAX_LEN) return { ok: false, reason: `too long (max ${MAX_LEN})` };
  if (!/^[a-z]/.test(s)) return { ok: false, reason: 'must start with a letter' };
  if (!/^[a-z0-9-]+$/.test(s)) return { ok: false, reason: 'allowed: a-z 0-9 -' };
  if (/--/.test(s)) return { ok: false, reason: 'no doubled dashes' };
  if (/-$/.test(s)) return { ok: false, reason: 'no trailing dash' };
  return { ok: true, reason: 'ok' };
}

// build a case-insensitive lookup Set from a taken[] list (soft-fails on non-arrays)
function takenSet(taken) {
  const set = new Set();
  if (Array.isArray(taken)) {
    for (const t of taken) {
      const s = str(t).toLowerCase();
      if (s) set.add(s);
    }
  }
  return set;
}

// ensure a candidate is a VALID handle: pad too-short, ensure alpha start. Returns '' if unsalvageable.
function coerceValid(candidate) {
  let s = slugifyHandle(candidate);
  if (s === '') return '';
  // strip leading digits/dashes so it starts with a letter
  s = s.replace(/^[0-9-]+/, '');
  if (s === '') return '';
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN).replace(/-+$/g, '');
  if (s.length < MIN_LEN) return ''; // caller decides on padding
  return isValidHandle(s).ok ? s : '';
}

// append a numeric suffix while respecting MAX_LEN (truncates the base, not the number)
function withNumber(base, n) {
  const suffix = String(n);
  const room = MAX_LEN - suffix.length;
  if (room < 1) return '';
  let b = base.slice(0, room).replace(/-+$/g, '');
  if (b === '') return '';
  const out = b + suffix;
  return isValidHandle(out).ok ? out : '';
}

// ── candidate strategies (deterministic order = ranking) ──────────────────────────────────────────
// Each generator yields raw candidates derived from the slug + word parts; coerceValid cleans them.
function* candidateStream(name) {
  const slug = slugifyHandle(name);
  const base = coerceValid(slug) || '';
  const words = slug.split('-').filter(Boolean);

  // 0. the slug itself (word-join with dashes dropped → plain concatenation)
  if (base) yield base;

  // 1. word-join: first+last word concatenated (e.g. "mehit witness" -> "mehitwitness")
  if (words.length >= 2) {
    const j = coerceValid(words[0] + words[words.length - 1]);
    if (j) yield j;
    // also first two words
    const j2 = coerceValid(words[0] + words[1]);
    if (j2) yield j2;
  }

  // 2. numeric suffixes on the base (year-agnostic plain counter 2..)
  if (base) {
    for (let n = 2; n <= 9; n++) {
      const c = withNumber(base, n);
      if (c) yield c;
    }
  }

  // 3. first word alone, then first-word + counter
  if (words.length >= 1) {
    const w0 = coerceValid(words[0]);
    if (w0) {
      yield w0;
      for (let n = 2; n <= 9; n++) {
        const c = withNumber(w0, n);
        if (c) yield c;
      }
    }
  }

  // 4. vowel-drop: remove interior vowels (keep first char) for a compact variant
  if (base) {
    const dropped = base[0] + base.slice(1).replace(VOWELS, '');
    const vd = coerceValid(dropped);
    if (vd) yield vd;
    if (vd) {
      for (let n = 2; n <= 9; n++) {
        const c = withNumber(vd, n);
        if (c) yield c;
      }
    }
  }

  // 5. deterministic fallback family: user, user2, user3, ...
  yield FALLBACK;
  for (let n = 2; n <= 99; n++) {
    const c = withNumber(FALLBACK, n);
    if (c) yield c;
  }
}

// ── suggestHandles: ranked list of AVAILABLE, valid candidates ────────────────────────────────────
export function suggestHandles(name, { taken = [], count = 5 } = {}) {
  const want = Number.isFinite(count) && count > 0 ? Math.floor(count) : 5;
  const used = takenSet(taken);
  const out = [];
  const seen = new Set();
  for (const cand of candidateStream(name)) {
    if (!cand) continue;
    const key = cand.toLowerCase();
    if (seen.has(key)) continue; // de-dupe within our own list
    seen.add(key);
    if (used.has(key)) continue; // skip taken (case-insensitive)
    if (!isValidHandle(cand).ok) continue;
    out.push(cand);
    if (out.length >= want) break;
  }
  return out;
}

// ── firstAvailable: the single best available handle (deterministic fallback if needed) ───────────
export function firstAvailable(name, taken) {
  const list = suggestHandles(name, { taken, count: 1 });
  return list.length ? list[0] : FALLBACK;
}

// ── CLI: worked example (guarded so importing never runs it) ──────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2] || 'Mehit the Witness';
  const taken = process.argv.slice(3);
  const suggestions = suggestHandles(name, { taken, count: 8 });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    name,
    taken,
    slug: slugifyHandle(name),
    firstAvailable: firstAvailable(name, taken),
    suggestions,
  }, null, 2));
}

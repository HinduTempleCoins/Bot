/**
 * smt-token-spec.mjs — SMT / SCOT token-SPECIFICATION builder + validator.
 *
 * A pure, read-only CONFIG helper: it takes a partial token config and produces a
 * normalized, validated SMT/SCOT token spec (the kind of object you'd hand to an
 * off-repo setup/issuance step). It does NOT build chain ops, does NOT sign, does
 * NOT broadcast, and reads no keys — distinct from engine/lib/op-builder.mjs (which
 * assembles the actual chain operations) and engine/lib/tokens.mjs.
 *
 * Exports:
 *   buildTokenSpec(cfg) -> { ok, spec|null, errors[] }
 *       Fills defaults for missing fields, validates, and returns a frozen spec.
 *       Soft-fails (ok:false, spec:null, errors[]) on bad input — never throws.
 *   validateSymbol(sym) -> { ok, errors[] }   uppercase + length + charset rules.
 *   normalizeSplit(authorPct) -> { author, curator }   integers summing to 100.
 *   defaultSpec() -> a canonical example spec object.
 *
 * KEY-CUSTODY / SCOPE: no WIF, seed, key, or network access. Pure object work only.
 * (BRIEF.md §7.)
 */

// ---------------------------------------------------------------------------
// Rules / constants
// ---------------------------------------------------------------------------

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const SYMBOL_MIN = 1;
const SYMBOL_MAX = 10;
const MIN_PRECISION = 0;
const MAX_PRECISION = 8;

// SMT max supply is a uint64 of base units; cap at the int64 max for safety.
const MAX_SUPPLY_CEILING = 9223372036854775807n; // 2^63 - 1

const DEFAULTS = Object.freeze({
  symbol: 'MELEK',
  precision: 3,
  maxSupply: '1000000000', // whole tokens, pre-precision
  tags: Object.freeze(['melek']),
  authorCuratorSplit: 50, // author percent; curator gets the rest
  inflationPerDay: '0', // whole tokens minted per day (string, integer)
});

/** Escape HTML — present for house-style parity even though this module emits no HTML. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// Validators / normalizers
// ---------------------------------------------------------------------------

/**
 * validateSymbol(sym) -> { ok, errors[] }.
 * A valid SMT symbol is 1..10 uppercase ASCII letters. We do NOT auto-uppercase
 * here — a lowercase symbol is a real config error worth surfacing — but the
 * error message names the canonical form so callers can fix it.
 */
export function validateSymbol(sym) {
  const errors = [];
  if (typeof sym !== 'string') {
    errors.push('symbol must be a string');
    return { ok: false, errors };
  }
  const s = sym.trim();
  if (s.length < SYMBOL_MIN || s.length > SYMBOL_MAX) {
    errors.push(`symbol length must be ${SYMBOL_MIN}..${SYMBOL_MAX} (got ${s.length})`);
  }
  if (s !== s.toUpperCase()) {
    errors.push(`symbol must be uppercase (try "${s.toUpperCase()}")`);
  }
  if (!SYMBOL_RE.test(s)) {
    errors.push('symbol must be uppercase A-Z only (no digits, spaces, or punctuation)');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * normalizeSplit(authorPct) -> { author, curator } as integers summing to 100.
 * Clamps to 0..100, rounds to the nearest integer, and gives the remainder to
 * the curator so the two always sum to exactly 100. Non-numeric input falls
 * back to the default author share.
 */
export function normalizeSplit(authorPct) {
  let a = Number(authorPct);
  if (!Number.isFinite(a)) a = DEFAULTS.authorCuratorSplit;
  a = Math.round(a);
  if (a < 0) a = 0;
  if (a > 100) a = 100;
  return { author: a, curator: 100 - a };
}

/** True for an integer precision in [0,8]. */
function isValidPrecision(p) {
  return Number.isInteger(p) && p >= MIN_PRECISION && p <= MAX_PRECISION;
}

/**
 * Parse a whole-token amount (string|number) into a non-negative BigInt of whole
 * tokens, or null if it isn't a clean non-negative integer. Accepts "1000",
 * 1000, and "  1000  "; rejects "1.5", "-1", "abc", Infinity.
 */
function parseWholeAmount(v) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) return null;
    return BigInt(v);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!/^\d+$/.test(t)) return null;
    return BigInt(t);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Spec builder
// ---------------------------------------------------------------------------

/**
 * buildTokenSpec(cfg) -> { ok, spec|null, errors[] }.
 *
 * cfg (all optional; missing fields take DEFAULTS):
 *   symbol             1..10 uppercase A-Z
 *   precision          integer 0..8
 *   maxSupply          whole-token integer (string|number), > 0, <= int64 ceiling
 *   tags               array of short slug strings (lowercased, de-duped)
 *   authorCuratorSplit author percent 0..100 (curator gets the rest)
 *   inflationPerDay     whole-token integer >= 0; must not exceed maxSupply
 *
 * Returns a frozen, normalized spec on success, or ok:false with errors[].
 * Never throws — bad/odd input is reported, not raised.
 */
export function buildTokenSpec(cfg = {}) {
  const errors = [];
  const c = (cfg && typeof cfg === 'object') ? cfg : {};

  // --- symbol ---
  const symbol = c.symbol == null ? DEFAULTS.symbol : String(c.symbol).trim();
  const symCheck = validateSymbol(symbol);
  if (!symCheck.ok) errors.push(...symCheck.errors);

  // --- precision ---
  const precision = c.precision == null ? DEFAULTS.precision : Number(c.precision);
  if (!isValidPrecision(precision)) {
    errors.push(`precision must be an integer ${MIN_PRECISION}..${MAX_PRECISION}`);
  }

  // --- maxSupply (whole tokens) ---
  const rawMax = c.maxSupply == null ? DEFAULTS.maxSupply : c.maxSupply;
  const maxSupply = parseWholeAmount(rawMax);
  if (maxSupply == null) {
    errors.push(`maxSupply must be a non-negative whole-token integer (got "${rawMax}")`);
  } else if (maxSupply <= 0n) {
    errors.push('maxSupply must be greater than 0');
  } else if (maxSupply > MAX_SUPPLY_CEILING) {
    errors.push(`maxSupply exceeds the int64 ceiling (${MAX_SUPPLY_CEILING})`);
  }

  // --- tags ---
  const tags = normalizeTags(c.tags == null ? DEFAULTS.tags : c.tags);
  if (tags.length === 0) errors.push('at least one tag is required');

  // --- author/curator split ---
  const split = normalizeSplit(c.authorCuratorSplit == null ? DEFAULTS.authorCuratorSplit : c.authorCuratorSplit);

  // --- inflationPerDay (whole tokens) ---
  const rawInfl = c.inflationPerDay == null ? DEFAULTS.inflationPerDay : c.inflationPerDay;
  const inflationPerDay = parseWholeAmount(rawInfl);
  if (inflationPerDay == null) {
    errors.push(`inflationPerDay must be a non-negative whole-token integer (got "${rawInfl}")`);
  } else if (maxSupply != null && inflationPerDay > maxSupply) {
    errors.push('inflationPerDay cannot exceed maxSupply');
  }

  if (errors.length > 0) return { ok: false, spec: null, errors };

  const spec = Object.freeze({
    symbol,
    precision,
    maxSupply: maxSupply.toString(),
    tags: Object.freeze(tags),
    authorCuratorSplit: Object.freeze({ author: split.author, curator: split.curator }),
    inflationPerDay: inflationPerDay.toString(),
    // derived convenience fields (do not affect validation)
    primaryTag: tags[0],
    capImmutable: false,
  });

  return { ok: true, spec, errors: [] };
}

/**
 * Normalize a tags input into a clean, de-duplicated, lowercase slug array.
 * Accepts an array or a comma/space-separated string. Drops empties and anything
 * that isn't a [a-z0-9-] slug. Caps at 10 tags.
 */
function normalizeTags(input) {
  let raw = [];
  if (Array.isArray(input)) raw = input;
  else if (typeof input === 'string') raw = input.split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const slug = String(t == null ? '' : t).trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * defaultSpec() -> a canonical example spec (the same shape buildTokenSpec emits).
 * Always valid by construction; useful as a template / fixture.
 */
export function defaultSpec() {
  const r = buildTokenSpec({});
  return r.spec;
}

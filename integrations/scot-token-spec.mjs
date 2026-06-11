// scot-token-spec.mjs — PURE SCOT/SMT token-specification builder + validator.
// No chain calls, no deployment, no keys, no broadcast. Spec authoring only.
//
// Supports the "Design Van Kush SMTs" item: turn loose token parameters into a
// normalized spec object (with a computed author/curator reward split that must
// sum to 100), and validate that spec before anyone hand-carries it to a real
// SMT/SCOT setup_token op elsewhere. This module never touches a node — it is the
// design surface, not the deploy surface.
//
//   import { buildTokenSpec, validateTokenSpec, renderSpec, DEFAULT_TAGS } from './scot-token-spec.mjs'
//   node integrations/scot-token-spec.mjs            # print a sample spec + validation
//
// Deterministic + soft-fail-never-throw: invalid input yields an errors[] array,
// never an exception. esc() guards all HTML interpolation.

// Canonical tag whitelist for Van Kush SMTs (display includes the leading '#').
export const DEFAULT_TAGS = ['vankush', 'punicwax', 'cryptology'];

// Graphene/SCOT symbol bounds: uppercase A-Z, 3..16 chars (no leading digit).
const SYMBOL_RE = /^[A-Z][A-Z0-9]{2,15}$/;
const PRECISION_MIN = 0;
const PRECISION_MAX = 8;        // Graphene asset precision ceiling

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Normalize a tag: strip a leading '#', lowercase, trim. Non-strings → ''.
function normTag(t) {
  return String(t ?? '').trim().replace(/^#+/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// buildTokenSpec — normalize loose params into a canonical spec object.
// Never throws. The computed author/curator split is derived so it sums to 100:
//   - both given            → kept as-is (validator catches a bad sum)
//   - only authorPct given  → curatorPct = 100 - authorPct
//   - only curatorPct given → authorPct  = 100 - curatorPct
//   - neither given         → 50 / 50 default
// ---------------------------------------------------------------------------
export function buildTokenSpec(input = {}) {
  const src = (input && typeof input === 'object') ? input : {};

  const symbol = String(src.symbol ?? '').trim().toUpperCase();
  const name = String(src.name ?? '').trim();

  const precision = isNum(src.precision) ? Math.trunc(src.precision) : 0;
  const maxSupply = isNum(src.maxSupply) ? src.maxSupply : 0;
  const stakeApr = isNum(src.stakeApr) ? src.stakeApr : 0;

  // Resolve the reward split deterministically.
  const aGiven = isNum(src.authorPct);
  const cGiven = isNum(src.curatorPct);
  let authorPct, curatorPct;
  if (aGiven && cGiven) {
    authorPct = src.authorPct;
    curatorPct = src.curatorPct;
  } else if (aGiven) {
    authorPct = src.authorPct;
    curatorPct = 100 - src.authorPct;
  } else if (cGiven) {
    curatorPct = src.curatorPct;
    authorPct = 100 - src.curatorPct;
  } else {
    authorPct = 50;
    curatorPct = 50;
  }

  // Tags: normalize, drop empties, dedupe, preserve order. Default to DEFAULT_TAGS.
  let rawTags = Array.isArray(src.tags) ? src.tags : null;
  let tags;
  if (rawTags) {
    const seen = new Set();
    tags = [];
    for (const t of rawTags) {
      const n = normTag(t);
      if (n && !seen.has(n)) { seen.add(n); tags.push(n); }
    }
  } else {
    tags = [...DEFAULT_TAGS];
  }

  return {
    symbol,
    name,
    precision,
    maxSupply,
    authorPct,
    curatorPct,
    stakeApr,
    tags,
  };
}

// ---------------------------------------------------------------------------
// validateTokenSpec — returns {ok, errors[]}. Never throws.
// ---------------------------------------------------------------------------
export function validateTokenSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return { ok: false, errors: ['spec must be an object'] };
  }

  // symbol format
  if (typeof spec.symbol !== 'string' || !SYMBOL_RE.test(spec.symbol)) {
    errors.push('symbol must be uppercase A-Z(0-9), 3-16 chars, no leading digit');
  }

  // name presence
  if (typeof spec.name !== 'string' || spec.name.trim() === '') {
    errors.push('name is required');
  }

  // precision range
  if (!isNum(spec.precision) || !Number.isInteger(spec.precision)
      || spec.precision < PRECISION_MIN || spec.precision > PRECISION_MAX) {
    errors.push(`precision must be an integer ${PRECISION_MIN}-${PRECISION_MAX}`);
  }

  // non-negative supply
  if (!isNum(spec.maxSupply) || spec.maxSupply < 0) {
    errors.push('maxSupply must be a non-negative number');
  }

  // non-negative APR
  if (!isNum(spec.stakeApr) || spec.stakeApr < 0) {
    errors.push('stakeApr must be a non-negative number');
  }

  // split sums to 100
  if (!isNum(spec.authorPct) || spec.authorPct < 0) {
    errors.push('authorPct must be a non-negative number');
  }
  if (!isNum(spec.curatorPct) || spec.curatorPct < 0) {
    errors.push('curatorPct must be a non-negative number');
  }
  if (isNum(spec.authorPct) && isNum(spec.curatorPct)
      && Math.abs((spec.authorPct + spec.curatorPct) - 100) > 1e-9) {
    errors.push('authorPct + curatorPct must sum to 100');
  }

  // tags must be a non-empty list drawn from DEFAULT_TAGS
  if (!Array.isArray(spec.tags) || spec.tags.length === 0) {
    errors.push('tags must be a non-empty list');
  } else {
    const allowed = new Set(DEFAULT_TAGS);
    const bad = spec.tags.filter((t) => !allowed.has(normTag(t)));
    if (bad.length) {
      errors.push(`invalid tag(s): ${bad.map(String).join(', ')} (allowed: ${DEFAULT_TAGS.map((t) => '#' + t).join(', ')})`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// renderSpec({html}) — render a spec as plain text (default) or escaped HTML.
// Pure; never throws. Pass a spec via .spec or as the first positional fallback.
// ---------------------------------------------------------------------------
export function renderSpec(opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const spec = o.spec && typeof o.spec === 'object' ? o.spec : o;
  const html = !!o.html;

  const v = validateTokenSpec(spec);
  const rows = [
    ['Symbol', spec.symbol],
    ['Name', spec.name],
    ['Precision', spec.precision],
    ['Max supply', spec.maxSupply],
    ['Author %', spec.authorPct],
    ['Curator %', spec.curatorPct],
    ['Stake APR %', spec.stakeApr],
    ['Tags', Array.isArray(spec.tags) ? spec.tags.map((t) => '#' + normTag(t)).join(' ') : ''],
    ['Valid', v.ok ? 'yes' : 'no'],
  ];

  if (html) {
    const trs = rows
      .map(([k, val]) => `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`)
      .join('');
    const errs = v.ok
      ? ''
      : `<ul class="errors">${v.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    return `<table class="token-spec">${trs}</table>${errs}`;
  }

  const lines = rows.map(([k, val]) => `${k}: ${val}`);
  if (!v.ok) lines.push('Errors:', ...v.errors.map((e) => '  - ' + e));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI: print a sample spec + its validation. Guarded so importing is side-effect-free.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('scot-token-spec.mjs')) {
  const sample = buildTokenSpec({
    symbol: 'vkush',
    name: 'Van Kush Family Token',
    precision: 3,
    maxSupply: 1_000_000_000,
    authorPct: 60,        // curatorPct derived → 40
    stakeApr: 12,
    tags: ['#vankush', 'cryptology'],
  });
  console.log('--- sample spec ---');
  console.log(renderSpec({ spec: sample }));
  console.log('\n--- validation ---');
  console.log(JSON.stringify(validateTokenSpec(sample), null, 2));
}

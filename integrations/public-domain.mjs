// public-domain.mjs — PURE copyright-term / public-domain status calculator.
// No network, no keys, no IO. Deterministic date math for the corpus scrapers
// (Sacred-Texts / Theoi / Gutenberg) so ingestion can flag PD vs restricted.
//
// Two legal regimes, both pure arithmetic:
//
//   US RULE (publication-based, rolling): a work first published before
//     (currentYear - 95) is in the public domain in the US. This is the
//     "anything published before <thisYear-95> is PD" rolling 95-year window.
//
//   LIFE+N RULE (author-death-based): most of the EU/UK and many countries
//     grant life-of-the-author plus a post-mortem term (life+70; a few life+50).
//     The work enters PD at (authorDeathYear + term + 1) — the term runs to the
//     end of the Nth calendar year after death, so PD begins the following year.
//
// Soft-fail: missing data => { status: 'unknown' }. Never throws.
//
//   import { lifePlusYears, isPublicDomainUS, classify, TERMS } from './public-domain.mjs'
//   node integrations/public-domain.mjs --pubYear 1920 --authorDeathYear 1948 --country US
//
// All HTML interpolation goes through esc() (none rendered here, but exported
// for handler-style callers that might embed a status string).

// ---- injectable clock (fixed default; tests override via __setClock) -------
// Default to a fixed deterministic year so the rolling US window is stable in
// tests regardless of the real wall-clock; production callers pass { asOf }.
let _clock = () => 2026;

/** Override the default "current year" clock. Pass a function or a number. */
export function __setClock(fnOrYear) {
  if (typeof fnOrYear === 'function') _clock = fnOrYear;
  else if (Number.isFinite(Number(fnOrYear))) { const y = Number(fnOrYear); _clock = () => y; }
}

/** Resolve the as-of year: explicit asOf wins, else the injected clock. */
function asOfYear(opts) {
  const a = opts && opts.asOf;
  if (Number.isFinite(Number(a))) return Number(a);
  const c = _clock();
  return Number.isFinite(Number(c)) ? Number(c) : new Date().getUTCFullYear();
}

// ---- country -> post-mortem term map ---------------------------------------
// 'US' is special-cased to the 95-from-publication rolling rule and carries no
// life+N post-mortem term (term: null). Everything else is a life+N number.
export const TERMS = Object.freeze({
  US: { rule: 'pub95', term: null },   // rolling 95-year-from-publication
  GB: { rule: 'life', term: 70 },      // UK — life+70
  UK: { rule: 'life', term: 70 },      // alias
  EU: { rule: 'life', term: 70 },      // EU harmonised — life+70
  DE: { rule: 'life', term: 70 },
  FR: { rule: 'life', term: 70 },
  IT: { rule: 'life', term: 70 },
  ES: { rule: 'life', term: 70 },
  CA: { rule: 'life', term: 70 },      // Canada moved to life+70 (2022)
  AU: { rule: 'life', term: 70 },
  CN: { rule: 'life', term: 50 },      // China — life+50
  JP: { rule: 'life', term: 70 },
  IN: { rule: 'life', term: 60 },      // India — life+60
  NZ: { rule: 'life', term: 50 },      // New Zealand — life+50
});

const US_WINDOW = 95;

// ---- HTML escape (house rule: esc() any interpolation) ---------------------
const _ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => _ESC[c]); }

// ---------------------------------------------------------------------------
// lifePlusYears — year a work enters PD under a life+N regime
// ---------------------------------------------------------------------------
/**
 * @param {number} deathYear  author's year of death
 * @param {{term?:number, asOf?:number}} [opts]  post-mortem term (default 70)
 * @returns {number|null}  first calendar year the work is in the public domain,
 *                         or null if deathYear is unusable (soft-fail).
 */
export function lifePlusYears(deathYear, opts = {}) {
  const d = Number(deathYear);
  if (!Number.isFinite(d)) return null;
  const term = Number.isFinite(Number(opts.term)) ? Number(opts.term) : 70;
  // term runs through the end of the Nth year after death; PD begins next year.
  return d + term + 1;
}

// ---------------------------------------------------------------------------
// isPublicDomainUS — rolling 95-year-from-publication rule
// ---------------------------------------------------------------------------
/**
 * True when pubYear < (asOfYear - 95). Soft-fails to false on bad input.
 * @param {number} pubYear  year of first US publication
 * @param {{asOf?:number}} [opts]
 * @returns {boolean}
 */
export function isPublicDomainUS(pubYear, opts = {}) {
  const p = Number(pubYear);
  if (!Number.isFinite(p)) return false;
  return p < (asOfYear(opts) - US_WINDOW);
}

// ---------------------------------------------------------------------------
// classify — combined status for a work
// ---------------------------------------------------------------------------
/**
 * @param {{pubYear?:number, authorDeathYear?:number, country?:string, asOf?:number}} [info]
 * @returns {{status:string, reason:string, entersPdYear:(number|null)}}
 *   status: 'public-domain' | 'likely-public-domain' | 'in-copyright' | 'unknown'
 */
export function classify(info = {}) {
  const country = String(info.country || 'US').toUpperCase();
  const asOf = asOfYear(info);
  const pubYear = Number(info.pubYear);
  const deathYear = Number(info.authorDeathYear);
  const rule = TERMS[country];

  // --- US (and any pub95-rule country): publication-based rolling window ---
  if (rule && rule.rule === 'pub95') {
    if (!Number.isFinite(pubYear)) {
      return { status: 'unknown', reason: 'US rule needs pubYear', entersPdYear: null };
    }
    const entersPdYear = pubYear + US_WINDOW + 1;
    if (isPublicDomainUS(pubYear, { asOf })) {
      return {
        status: 'public-domain',
        reason: `published ${pubYear}, before US cutoff ${asOf - US_WINDOW} (95-year rolling rule)`,
        entersPdYear,
      };
    }
    return {
      status: 'in-copyright',
      reason: `published ${pubYear}; US PD not until ${entersPdYear} (95-year rolling rule)`,
      entersPdYear,
    };
  }

  // --- life+N regimes ---
  if (rule && rule.rule === 'life') {
    if (!Number.isFinite(deathYear)) {
      // No death year. If we at least know it's very old by publication, call
      // it likely-public-domain; otherwise we genuinely don't know.
      if (Number.isFinite(pubYear) && pubYear < (asOf - 120)) {
        return {
          status: 'likely-public-domain',
          reason: `${country} is life+${rule.term} and authorDeathYear unknown, but pubYear ${pubYear} is old enough that the author is almost certainly long dead`,
          entersPdYear: null,
        };
      }
      return {
        status: 'unknown',
        reason: `${country} is life+${rule.term} but authorDeathYear missing`,
        entersPdYear: null,
      };
    }
    const entersPdYear = lifePlusYears(deathYear, { term: rule.term });
    if (asOf >= entersPdYear) {
      return {
        status: 'public-domain',
        reason: `${country} life+${rule.term}: author died ${deathYear}, PD since ${entersPdYear}`,
        entersPdYear,
      };
    }
    return {
      status: 'in-copyright',
      reason: `${country} life+${rule.term}: author died ${deathYear}, PD not until ${entersPdYear}`,
      entersPdYear,
    };
  }

  // --- unknown country / unmapped regime ---
  return {
    status: 'unknown',
    reason: `no term rule for country '${esc(country)}'`,
    entersPdYear: null,
  };
}

// ---------------------------------------------------------------------------
// CLI — classify() of argv (no network)
// ---------------------------------------------------------------------------
function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('public-domain.mjs')) {
  const args = parseArgv(process.argv.slice(2));
  const info = {
    pubYear: args.pubYear != null ? Number(args.pubYear) : undefined,
    authorDeathYear: args.authorDeathYear != null ? Number(args.authorDeathYear) : undefined,
    country: args.country || 'US',
    asOf: args.asOf != null ? Number(args.asOf) : undefined,
  };
  console.log(JSON.stringify(classify(info), null, 2));
}

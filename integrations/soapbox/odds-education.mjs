// odds-education.mjs — "true vs implied odds" vig-exposure teaching surface for SoapBox (queue #123).
// EDUCATION & ANALYTICS ONLY — this module never takes, places, settles, or brokers a bet. It is a
// pure-math + HTML-string teaching layer: given our odds engine's TRUE probabilities and a
// bookmaker's quoted (decimal) odds, it shows the gap between them — and that gap IS the house edge.
//
// The whole lesson: a decimal odd d implies a probability of 1/d. Bookmakers price each outcome a
// touch short so the implied probabilities across the market sum to MORE than 1. That excess is the
// overround (the "vig" / margin) — the slice the house keeps no matter who wins. Seeing your true
// estimate next to the book's implied number makes the margin visible.
//
// PURE: no network, no I/O. Small helpers are reimplemented here (NOT imported) to keep this module
// self-contained, matching the math style of gambling.mjs / sports-odds.mjs.
//
//   import { vigLesson, renderLesson } from './odds-education.mjs'
//   node integrations/soapbox/odds-education.mjs

// ── PURE math ───────────────────────────────────────────────────────────────

/** Implied probability (0..1) of a decimal odd d: p = 1/d. Returns null for non-positive/invalid. */
export function impliedFromDecimal(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return null;
  return 1 / n;
}

/** HTML-escape (reimplemented locally, same shape as seo.mjs#esc). */
export function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]),
  );
}

/**
 * The lesson. Given:
 *   trueProbs — { [outcome]: probability 0..1 }  (from our odds engine)
 *   bookOdds  — { [outcome]: decimal odd }        (the bookmaker's quoted line)
 * Computes:
 *   impliedProbs  — { [outcome]: 1/decimalOdd }   (the book's implied probability per outcome)
 *   overroundPct  — (sum(impliedProbs) − 1) × 100  (the house edge / margin, in %)
 *   edgeByOutcome — { [outcome]: { true, implied, decimal, edge, edgePct } } side-by-side;
 *                   edge = implied − true  (how much the book shades that outcome above fair)
 *   explanation   — plain-English summary naming the vig.
 * PURE. Outcomes are the union of trueProbs + bookOdds keys; missing values → null and are skipped
 * from the overround sum. Soft-returns a well-formed object even on sparse input.
 */
export function vigLesson({ trueProbs = {}, bookOdds = {} } = {}) {
  const outcomes = Array.from(new Set([...Object.keys(trueProbs), ...Object.keys(bookOdds)]));
  const impliedProbs = {};
  const edgeByOutcome = {};
  let impliedSum = 0;

  for (const o of outcomes) {
    const decimal = bookOdds[o] != null ? Number(bookOdds[o]) : null;
    const implied = impliedFromDecimal(decimal);
    if (implied != null) {
      impliedProbs[o] = implied;
      impliedSum += implied;
    }
    const tru = trueProbs[o] != null && Number.isFinite(Number(trueProbs[o]))
      ? Number(trueProbs[o])
      : null;
    const edge = implied != null && tru != null ? implied - tru : null;
    edgeByOutcome[o] = {
      true: tru,
      implied: implied,
      decimal: Number.isFinite(decimal) ? decimal : null,
      edge,
      edgePct: edge != null ? edge * 100 : null,
    };
  }

  const overround = Object.keys(impliedProbs).length > 0 ? impliedSum - 1 : null;
  const overroundPct = overround != null ? overround * 100 : null;

  let explanation;
  if (overround == null) {
    explanation = 'No valid bookmaker odds supplied — nothing to compare against true probabilities.';
  } else if (overround <= 0.0005) {
    explanation =
      `The book's implied probabilities sum to ${(impliedSum * 100).toFixed(2)}% — essentially 100%. ` +
      'This is a (near-)fair line with no overround: the house has built in no margin (vig).';
  } else {
    explanation =
      `The book's implied probabilities sum to ${(impliedSum * 100).toFixed(2)}%, not 100%. ` +
      `That extra ${overroundPct.toFixed(2)}% is the overround — the "vig" the house keeps. ` +
      'Each implied probability sits above the fair (true) probability for that outcome; ' +
      'the difference is the edge baked into the line. Education only — no bets are taken.';
  }

  return { impliedProbs, overroundPct, edgeByOutcome, explanation };
}

// ── HTML rendering ───────────────────────────────────────────────────────────

const fmtPct = (p) => (p == null ? '—' : `${(p * 100).toFixed(2)}%`);
const fmtNum = (n) => (n == null ? '—' : Number(n).toFixed(3));

/**
 * renderLesson(lesson) → HTML string. Shows true vs implied probability side by side per outcome,
 * the per-outcome edge, and names the vig (overround). All dynamic text is escaped. PURE.
 */
export function renderLesson(lesson) {
  const l = lesson || {};
  const edges = l.edgeByOutcome || {};
  const rows = Object.keys(edges)
    .map((o) => {
      const e = edges[o];
      return (
        '<tr>' +
        `<th scope="row">${esc(o)}</th>` +
        `<td>${fmtNum(e.decimal)}</td>` +
        `<td>${fmtPct(e.true)}</td>` +
        `<td>${fmtPct(e.implied)}</td>` +
        `<td>${e.edgePct == null ? '—' : esc(e.edgePct.toFixed(2)) + '%'}</td>` +
        '</tr>'
      );
    })
    .join('');

  const overround = l.overroundPct == null ? '—' : `${esc(l.overroundPct.toFixed(2))}%`;

  return (
    '<section class="odds-education" aria-label="True vs implied odds — the house edge">' +
    '<h2>True vs Implied Odds — Where the House Edge Hides</h2>' +
    '<table class="vig-table">' +
    '<thead><tr>' +
    '<th scope="col">Outcome</th>' +
    '<th scope="col">Book (decimal)</th>' +
    '<th scope="col">True prob.</th>' +
    '<th scope="col">Implied prob.</th>' +
    '<th scope="col">Edge (vig)</th>' +
    '</tr></thead>' +
    `<tbody>${rows}</tbody>` +
    '</table>' +
    `<p class="overround">Overround (the vig): <strong>${overround}</strong></p>` +
    `<p class="explanation">${esc(l.explanation || '')}</p>` +
    '<p class="disclaimer"><em>Education and analytics only. This surface never takes, places, ' +
    'or settles a bet.</em></p>' +
    '</section>'
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('odds-education.mjs')) {
  // Demo: a coin-flip market priced with a ~4.8% vig (both sides at 1.91 decimal).
  const lesson = vigLesson({
    trueProbs: { Heads: 0.5, Tails: 0.5 },
    bookOdds: { Heads: 1.91, Tails: 1.91 },
  });
  console.log(JSON.stringify(lesson, null, 2));
  console.log('\n' + renderLesson(lesson));
}

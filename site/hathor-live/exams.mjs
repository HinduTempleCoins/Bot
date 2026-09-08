// site/hathor-live/exams.mjs — the Temple Exams: the perception battery, and the rules that bind it.
//
// ── THE FRAMING RULE, INHERITED VERBATIM ─────────────────────────────────────────────────────────
//
//   AN EXAM IS AN INSTRUMENT, NEVER A DIAGNOSIS, AND IS NEVER WORDED AS A CLEARANCE.
//   (.local/TEMPLE_EXAMS_SAFETY_GATE.md §2)
//
// That rule bites hardest here, not in the flicker gate. Aphantasia and synaesthesia are things a
// person can score into on a web page and then carry around for the rest of their life as an
// identity. So: report the measurement, name the reference class, treat consistency rather than
// confidence as the finding, and never route a result to anything consequential.
//
// ── THREE CONCLUSIONS THREE SEPARATE RESEARCH PASSES REACHED INDEPENDENTLY ────────────────────────
//
//   1. COMPARE A PERSON TO THEMSELVES, NEVER TO A POPULATION. The grapheme–colour consistency test
//      derives its validity from its own test–retest behaviour, so it needs no external norms, no
//      display calibration and no comparison group, and it is interpretable on a single individual.
//      That shape is copied everywhere in this directory.
//   2. NEVER PRODUCE A SCORE THAT BUYS SOMETHING. A score worth anything gets optimised and the data
//      dies. No tiers, no ranks, no credentials, no reward. Enforced below, not merely intended.
//   3. WITHIN-SUBJECT IS THE ENTIRE SCIENTIFIC VALUE. You sober against you tired, not you against a
//      stranger. Everything about the participant key and the State Card exists to serve that.
//
// ── THE PAYMENT BOUNDARY ─────────────────────────────────────────────────────────────────────────
//
// integrations/token-exams.mjs is the KNOWLEDGE exam module and it pays. Its rule — "pay for
// knowledge, never for perception" — is imported here rather than restated, so the two modules can
// never drift into disagreeing about which side of the line something is on. Every exam in this
// file is `kind: 'perception'`, and `assertNeverPayable()` is a hard failure, not a warning.
//
// ── AND NOTHING FROM THESE EXAMS GOES ON CHAIN ───────────────────────────────────────────────────
//
// A pseudonym on a public ledger makes every entry permanently, globally readable. See
// participant-key.mjs. The chain sees a boolean at most, and nothing here emits one.
//
// Offline, pure, no I/O. esc() everything.

import { esc, themeCSS } from '../../integrations/melek-theme.mjs';
import { KINDS, isPayableKind } from '../../integrations/token-exams.mjs';

export { esc, KINDS, isPayableKind };

/** The kind every exam in this file is, and the only kind it may be. */
export const PERCEPTION = 'perception';

/**
 * The four wording rules, kept as data so a result screen can render them rather than a developer
 * remembering them. They are printed on every result page in this battery.
 */
export const FRAMING = Object.freeze([
  {
    id: 'measurement-not-category',
    rule: 'Report the measurement, not the category.',
    why: '"Your VVIQ score was 19 out of 80. Scores at or below 24 are the range in which most published aphantasia research recruits participants." Never "you have aphantasia."',
  },
  {
    id: 'name-the-reference-class',
    rule: 'Name the reference class, every time.',
    why: 'A percentile is meaningless without saying among whom. Ours is: among people who found this page and chose to take the test. That group is systematically enriched for exactly the traits being measured, because people who suspect something about themselves go looking.',
  },
  {
    id: 'consistency-not-confidence',
    rule: 'Consistency, not confidence.',
    why: 'For every instrument the second administration is part of the instrument. A one-shot result is a reading, not a finding.',
  },
  {
    id: 'no-consequence',
    rule: 'Never route a result to anything consequential.',
    why: 'No credential tier, no karma weight, no grant eligibility, no payment. The moment a score buys something, people optimise it and the data dies.',
  },
]);

/**
 * What a browser cannot do, stated on the page rather than in a comment.
 *
 * These are not disclaimers bolted on at the end. Each one changed what got built: the colour exams
 * that need absolute chromaticity are absent, and the ones that survive are here because both sides
 * of their measurement are sampled inside one observer on one display.
 */
export const BROWSER_LIMITS = Object.freeze([
  {
    id: 'calibration',
    limit: 'Your display is not calibrated and cannot be.',
    detail: 'sRGB is a standard, not a description of your panel. Its actual primaries and transfer curve are unknown and unknowable from JavaScript, and auto-brightness means the display can change itself mid-session. Every exam here is therefore built as a within-person, within-display measurement.',
  },
  {
    id: 'gamut',
    limit: 'Your screen cannot show every colour.',
    detail: 'An sRGB panel cannot display a saturated spectral green; where a stimulus falls outside the triangle the browser silently clips it to the edge. Clipping is not noise — it is a systematic compression that makes different people’s settings look more similar than they are.',
  },
  {
    id: 'ambient',
    limit: 'The room you are in is part of the stimulus.',
    detail: 'A screen in a bright room has a grey veil over it: contrast falls, the black point rises, and your adaptation is set by the room rather than by anything we sent you.',
  },
  {
    id: 'wavelength',
    limit: 'We will never print a wavelength.',
    detail: 'Converting a screen colour to nanometres requires the display’s primaries, which we do not have. Any site that gives you a nanometre figure from a browser is making it up.',
  },
  {
    id: 'tetrachromacy',
    limit: 'No web page can test for tetrachromacy, including this one.',
    detail: 'A three-primary device cannot present a stimulus that needs a fourth primary to match. This is arithmetic about the display, not a calibration problem, and no amount of calibration fixes it. Every online "how many colours do you see" test is measuring banding, bit depth and patience.',
  },
  {
    id: 'diagnosis',
    limit: 'None of this is a diagnosis, and none of it is a clearance.',
    detail: 'These are instruments. They measure something real and they measure it imperfectly. A result here is not a medical finding, does not clear you for anything, and buys you nothing on this site or any other.',
  },
]);

// ── the register ─────────────────────────────────────────────────────────────────────────────────
/**
 * Each entry declares what it measures, what its result may and may not be worded as, and when the
 * retest falls due. `retestDays` is part of the instrument, not a nag: two administrations are what
 * turn a score into a measurement.
 */
export const EXAMS = Object.freeze([
  {
    id: 'grapheme',
    kind: PERCEPTION,
    name: 'Letters and colours',
    route: '/exams/grapheme',
    duration: '12–18 minutes',
    measures: 'Whether your letter and digit colour associations are consistent when you are asked again without warning.',
    why: 'This is the methodological exemplar of the whole battery. Its validity criterion IS its own test–retest behaviour, so it needs no external norms, no calibration and no comparison group. You are compared to yourself, and the result is interpretable on one person.',
    neverSay: 'You have synaesthesia.',
    retestDays: 14,
    citations: [
      'Eagleman et al. (2007), J Neurosci Methods 159(1):139–145 — the standardised battery.',
      'Rothen, Seth, Witzel & Ward (2013), J Neurosci Methods 215(1):156–160 — colour spaces compared.',
      'Carmichael et al. (2015), Consciousness and Cognition 33:375–385 — the failure modes.',
      'Simner et al. (2019), Atten Percept Psychophys — pairings can change in adulthood.',
    ],
  },
  {
    id: 'vviq',
    kind: PERCEPTION,
    name: 'The mind’s eye',
    route: '/exams/vviq',
    duration: '5–8 minutes',
    measures: 'How vivid your voluntary visual imagery is, on the scale the whole modern aphantasia literature is built on.',
    why: 'The highest revelation-per-minute of anything in the battery. Most people assume everyone else’s inner life looks like theirs. It does not, and the range is enormous at both ends.',
    neverSay: 'You have aphantasia.',
    retestDays: 14,
    citations: [
      'Marks, D.F. (1973), British Journal of Psychology 64(1):17–24 — the VVIQ.',
      'Marks, D.F. (1995) — VVIQ-2, which reversed the scale direction.',
      'Zeman et al. (2020), Cortex 130:426–440 — the imagery-extremes study.',
      'Zeman, A. (2024), Trends in Cognitive Sciences 28(5) — the current review.',
    ],
  },
  {
    id: 'colour-naming',
    kind: PERCEPTION,
    name: 'What you call a colour',
    route: '/exams/colour-naming',
    duration: '4 minutes, or as long as you like',
    measures: 'Your own colour lexicon: we show a colour, you type what you call it.',
    why: 'The most browser-honest colour exam there is. The question is about the mapping from appearance to word, and BOTH SIDES of that mapping are sampled inside one observer on one screen — so the display’s errors largely cancel instead of accumulating. The exam is native to the medium; the xkcd colour survey collected ~3.4 million responses this way.',
    neverSay: 'Anything at all about your eyes.',
    retestDays: 14,
    citations: [
      'Lindsey & Brown (2014), Journal of Vision 14(2):17 — the colour lexicon of American English.',
      'Berlin & Kay (1969), Basic Color Terms.',
      'Munroe (2010), the xkcd Color Survey — crowdsourced, blog-published, not peer-reviewed.',
      'Zaslavsky et al. (2019), Topics in Cognitive Science — naming reflects communicative need, not only perceptual structure.',
    ],
  },
]);

export const examById = (id) => EXAMS.find((e) => e.id === String(id || '').toLowerCase()) || null;

/**
 * The enforcement of conclusion 2, as a throw rather than a comment.
 *
 * Called at module load below, so the process refuses to start if anybody ever marks one of these
 * payable. That is deliberate: a soft-fail here would let a wrong build serve traffic.
 */
export function assertNeverPayable(list = EXAMS) {
  for (const e of list) {
    if (e.kind !== PERCEPTION) {
      throw new Error(`exams.mjs: ${e.id} declares kind '${e.kind}' — every exam here must be '${PERCEPTION}'`);
    }
    if (isPayableKind(e.kind)) {
      throw new Error(`exams.mjs: ${e.id} is payable, and a perception exam may never be — ${KINDS[PERCEPTION].why}`);
    }
    if (e.payable === true || e.reward != null || e.tier != null || e.rank != null) {
      throw new Error(`exams.mjs: ${e.id} carries a reward, tier or rank. A score that buys something gets optimised and the data dies.`);
    }
  }
  return true;
}
assertNeverPayable();

// ── honest reporting helpers ─────────────────────────────────────────────────────────────────────

/** Below this many completions for an instrument, we show the raw score and the count, never a rank. */
export const MIN_N_FOR_RANK = 100;

/**
 * The reference-class sentence, generated rather than remembered. Returns '' when n is too small to
 * say anything about rank — and the caller must then print the score and the count instead.
 */
export function referenceClass(n) {
  const count = Number(n) || 0;
  if (count < MIN_N_FOR_RANK) {
    return `Only ${count} ${count === 1 ? 'person has' : 'people have'} completed this here, which is too few to place you among them. `
      + 'You are shown your own score and nothing else, which is the honest thing to show.';
  }
  return `Where you sit is among the ${count} people who found this page and chose to take this test. `
    + 'That is not a random sample of anybody: many arrive because they already suspect something '
    + 'about their own experience, so this group is enriched for exactly the thing being measured. '
    + 'Your rank here is not your rank in the general population, and more visitors would not fix that.';
}

/**
 * A LANDMARK cites its source and makes no claim about the reader. A percentile borrowed from
 * someone else's sample makes a claim we cannot support. This renders the former and has no way to
 * render the latter.
 */
export function landmark({ text, source }) {
  return { text: String(text || ''), source: String(source || ''), isVerdict: false };
}

/**
 * Compare two administrations of the same instrument. This — not the single score — is the result.
 *
 * Returns a plain description. It deliberately does not say whether the difference is "significant":
 * that needs the standard error of measurement from our own retest sample, which does not exist yet
 * and cannot be invented. It says so.
 */
export function retestPair(first, second, { unit = '', sem = null } = {}) {
  // Number(null) is 0 and Number('') is 0, and a missing second sitting is neither of those. Treat
  // "not given" as not-a-number so a person who has sat this once is told so instead of being shown
  // a fabricated change from their score to zero.
  const n = (v) => (v == null || v === '' ? NaN : Number(v));
  const a = n(first);
  const b = n(second);
  if (!Number.isFinite(a)) return { ok: false, text: 'No first administration to compare against.' };
  if (!Number.isFinite(b)) {
    return { ok: false, text: 'One administration is a reading, not a finding. Come back and take it again — the second sitting is part of the instrument.' };
  }
  const diff = b - a;
  const base = `First sitting ${a}${unit}, second ${b}${unit} — a change of ${diff > 0 ? '+' : ''}${Math.round(diff * 1000) / 1000}${unit}.`;
  if (!Number.isFinite(n(sem))) {
    return {
      ok: true, first: a, second: b, diff,
      text: `${base} We cannot yet tell you whether a change that size is more than measurement noise: `
        + 'that needs this instrument’s own test–retest error, computed from our own repeat takers, '
        + 'and we do not have enough of them yet. When we do, it will be printed here.',
    };
  }
  const s = n(sem);
  return {
    ok: true, first: a, second: b, diff, sem: s,
    text: `${base} The measurement error of this instrument in our own repeat takers is ${s}${unit}, so a `
      + `change of ${Math.abs(diff) > 2 * s ? 'this size is larger than' : 'this size sits inside'} what we see when the same person retakes it unchanged.`,
  };
}

// ── the page shell ───────────────────────────────────────────────────────────────────────────────

export function examShell(title, body, { extraCSS = '', extraJS = '' } = {}) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} — Temple Exams</title>
<meta name=robots content="index,follow">
<meta name=description content="Temple Exams — instruments, not diagnoses. No account, no name, no score that buys anything.">
<style>${themeCSS({ context: 'temple' })}
  body{margin:0;font:16px/1.65 -apple-system,Segoe UI,Roboto,Arial,sans-serif;
    background:var(--mk-bg);color:var(--mk-text)}
  .wrap{max-width:760px;margin:0 auto;padding:28px 18px 80px}
  h1{font-size:1.7rem;margin:0 0 6px} h2{font-size:1.15rem;margin:26px 0 8px}
  .muted{color:var(--mk-text-muted)} .prov{color:var(--mk-text-muted);font-size:13px;margin:6px 0}
  .card{border:1px solid var(--mk-border);border-radius:12px;padding:16px 18px;margin:14px 0;background:var(--mk-panel)}
  fieldset{border:1px solid var(--mk-border);border-radius:10px;margin:14px 0;padding:12px 14px}
  legend{padding:0 6px;font-weight:700}
  .opt{display:flex;gap:9px;align-items:flex-start;padding:4px 0;cursor:pointer}
  .field{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:6px 0;flex-wrap:wrap}
  .field input,.field select{background:var(--mk-bg);color:var(--mk-text);border:1px solid var(--mk-border);
    border-radius:8px;padding:7px 10px;font:inherit;min-width:8ch}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:5px 0}
  .rowlab{min-width:11ch;color:var(--mk-text-muted);font-size:13px}
  .vas{margin:10px 0} .vas input[type=range]{width:100%}
  .vasends{display:flex;justify-content:space-between;font-size:12px;color:var(--mk-text-muted)}
  button{padding:10px 18px;border:1px solid var(--mk-accent);background:var(--mk-accent);color:#1a1306;
    border-radius:10px;font-weight:800;cursor:pointer;font:inherit;font-weight:800}
  button.ghost{background:transparent;color:var(--mk-text);border-color:var(--mk-border)}
  button[disabled]{opacity:.45;cursor:not-allowed}
  a{color:var(--mk-accent)}
  .limits li{margin:8px 0} .limits b{display:block}
  .key{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;letter-spacing:.06em;
    background:var(--mk-bg);border:1px dashed var(--mk-border);border-radius:8px;padding:9px 11px;
    display:inline-block;word-break:break-all}
  table{width:100%;border-collapse:collapse;font-size:14px} td,th{border-bottom:1px solid var(--mk-border);padding:6px 4px;text-align:left}
  ${extraCSS}</style></head><body><div class=wrap>
${body}
<footer class=muted style="margin-top:44px;font-size:13px;border-top:1px solid var(--mk-border);padding-top:14px">
  <a href="/exams">Temple Exams</a> · <a href="/40hz">the entrainment library</a> · <a href="/reports">the report archive</a><br>
  No account, no name, no email. Nothing here goes on the chain. Nothing here pays anything, and that is on purpose.
</footer>
</div>${extraJS ? `<script>${extraJS}</script>` : ''}</body></html>`;
}

/** The battery's front page. */
export function examsIndexHTML({ counts = {} } = {}) {
  const cards = EXAMS.map((e) => `<div class=card>
    <h2 style="margin-top:0"><a href="${esc(e.route)}">${esc(e.name)}</a></h2>
    <p>${esc(e.measures)}</p>
    <p class=muted>${esc(e.why)}</p>
    <p class=prov>${esc(e.duration)} · retest after ${esc(String(e.retestDays))} days · completed here ${esc(String(counts[e.id] || 0))} ${(counts[e.id] || 0) === 1 ? 'time' : 'times'}<br>
      <b>This result will never be worded as:</b> “${esc(e.neverSay)}”</p>
  </div>`).join('');

  return examShell('Temple Exams', `<h1>Temple Exams</h1>
<p class=muted>Instruments for looking at your own experience. Not diagnoses, not clearances, and not
worth anything to anybody but you.</p>

<div class=card>
  <h2 style="margin-top:0">Four rules, and they are the whole design</h2>
  <ul class=limits>${FRAMING.map((f) => `<li><b>${esc(f.rule)}</b><span class=muted>${esc(f.why)}</span></li>`).join('')}</ul>
</div>

${cards}

<div class=card>
  <h2 style="margin-top:0">What a browser cannot do, said out loud</h2>
  <ul class=limits>${BROWSER_LIMITS.map((l) => `<li><b>${esc(l.limit)}</b><span class=muted>${esc(l.detail)}</span></li>`).join('')}</ul>
</div>

<div class=card>
  <h2 style="margin-top:0">Who you are to us</h2>
  <p>Nobody. There is no account, no name, no email address and no password. Your browser makes a
  random key, keeps it, and that key is the only thing that links one sitting of yours to the next —
  which is the point, because the comparison worth making is <b>you against you</b>: you sober
  against you tired, not you against a stranger.</p>
  <p class=muted>We store a one-way hash of that key, not the key. If you keep it you can delete
  everything you ever submitted. <b>If you lose it we cannot delete your entries, because we have no
  way to know which ones are yours.</b> That is said here, in advance, rather than promised and then
  not done.</p>
  <p class=muted>None of this goes on the MELEK chain. A pseudonym on a public ledger is permanent
  and readable by everyone forever, and these are the wrong entries for that.</p>
</div>`);
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    service: 'temple-exams',
    kind: PERCEPTION,
    payable: isPayableKind(PERCEPTION),
    rule: 'an exam is an instrument, never a diagnosis, and is never worded as a clearance',
    onChain: false,
    exams: EXAMS,
    framing: FRAMING,
    browserLimits: BROWSER_LIMITS,
  }, null, 2));
}

export default {
  PERCEPTION, EXAMS, FRAMING, BROWSER_LIMITS, MIN_N_FOR_RANK,
  examById, assertNeverPayable, referenceClass, landmark, retestPair,
  examShell, examsIndexHTML, handler, esc,
};

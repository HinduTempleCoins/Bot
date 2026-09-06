// the-line.mjs — where the library sits relative to the FDA's intended-use line, and why.
//
// THE DOCTRINE. A thing is classified by its INTENDED USE, and intended use is shown through CLAIMS —
// not through ingredients, not through the name, not through how it is administered. That is why this
// module exists in code rather than as a paragraph someone remembers to paste: the exposure comes from
// sentences, so the sentences get linted.
//
// THE PRECEDENT. United States v. An Article or Device "Hubbard Electrometer", 333 F. Supp. 357
// (D.D.C. 1971) (Gesell, J.), following Founding Church of Scientology v. United States, 409 F.2d 1146
// (D.C. Cir. 1969), modified 1973. The E-Meter was held a misbranded device of no medical value, and the
// First Amendment nonetheless barred its forfeiture: it went back to the Church for bona fide religious
// use, carrying a court-ordered disclaimer. The 1973 modification kept the disclaimer and the religious-use
// limit but STRUCK the FDA-affidavit and "condemned" labeling as excessive church-state entanglement.
//
// The reasoning matters more than the result. Courts may not judge whether a religious doctrine is true
// (the Ballard line). Belief and bona fide religious practice are protected; secular MEDICAL EFFICACY
// CLAIMS are regulable. The disclaimer was chosen as the least-restrictive tool that neutralises the
// CLAIM while leaving the PRACTICE intact.
//
// OUR POSITION — "not even an E-Meter, but let's talk about it."
// The E-Meter stayed in circulation by disclaiming medical value. We start further back than that. We do
// not assert the efficacy the E-Meter's disclaimer had to deny; we publish what the studies found,
// including where they found nothing, and we let the reader weigh it. That is not a legal hedge dressed
// up as honesty — it is the same discipline that makes the corpus worth reading. A library that grades
// its own weakest entries "weak" is, by construction, not making an efficacy claim.
//
// This is why teaching the practice in full — dose, route, interaction, construction — is compatible with
// the line rather than in tension with it. The regulable thing is the promise, not the instruction.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, offline-testable.
//
//   import { EMETER, disclaimer, claimsCheck, THE_LINE_HTML } from './the-line.mjs';

/** esc — every value interpolated into HTML goes through this. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The precedent, as facts rather than as vibes. */
export const EMETER = Object.freeze({
  case: 'United States v. An Article or Device "Hubbard Electrometer"',
  cite: '333 F. Supp. 357 (D.D.C. 1971)',
  judge: 'Gesell, J.',
  priorCase: 'Founding Church of Scientology v. United States, 409 F.2d 1146 (D.C. Cir. 1969)',
  modified: '1973 (D.C. Cir.) — disclaimer and religious-use limit kept; FDA-affidavit and "condemned" labeling struck as excessive entanglement',
  holding: 'A misbranded device of no medical value, but the First Amendment barred forfeiture. Released for bona fide religious use subject to a mandatory disclaimer.',
  // Verbatim as reported. Do not paraphrase this string.
  orderedDisclaimer:
    'The E-Meter is not medically or scientifically useful for the diagnosis, treatment or prevention of '
    + 'any disease. It is not medically or scientifically capable of improving the health or bodily '
    + 'functions of anyone.',
  principle: 'Classification follows intended use, and intended use is shown through claims — not through ingredients, name, or method of administration.',
});

/** Disclaimers per surface. Each is a plain string; callers esc() when embedding. */
const DISCLAIMERS = Object.freeze({
  entrainment:
    'This is not a medical device and this is not medical advice. Nothing here diagnoses, treats, cures '
    + 'or prevents any disease, and nothing here is offered as capable of improving anyone’s health or '
    + 'bodily functions. What is offered is the published research, including the studies that found no '
    + 'effect, so you can weigh it yourself.',
  practices:
    'These are practices, not treatments. Each entry carries the evidence behind it and the grade that '
    + 'evidence earns — including "no controlled study" where that is the honest answer. Nothing here '
    + 'diagnoses, treats, cures or prevents any disease.',
  reports:
    'These are first-person reports submitted by readers. They are experience, not evidence of efficacy, '
    + 'and they are not medical advice. Nothing here diagnoses, treats, cures or prevents any disease.',
  preparations:
    'Prepared and used as a religious practice. This is not a drug, not a medical device, and not medical '
    + 'advice. Nothing here diagnoses, treats, cures or prevents any disease, and no claim is made that it '
    + 'improves health or bodily function.',
});

/**
 * disclaimer(context) — the non-medical statement for a surface.
 * Unknown or junk context falls back to the strictest wording rather than to nothing.
 */
export function disclaimer(context) {
  const key = String(context == null ? '' : context).trim().toLowerCase();
  return DISCLAIMERS[key] || DISCLAIMERS.preparations;
}

/** The contexts a caller may ask for. */
export const CONTEXTS = Object.freeze(Object.keys(DISCLAIMERS));

// Phrases that convert a description into a regulable CLAIM. Ordered longest-first at match time so the
// most specific phrase is what gets reported.
const CLAIM_PATTERNS = Object.freeze([
  { re: /\bcures?\b/i, why: 'asserts a cure' },
  { re: /\bcured\b/i, why: 'asserts a cure' },
  { re: /\btreats?\b/i, why: 'asserts treatment of a condition' },
  { re: /\btreatment for\b/i, why: 'asserts treatment of a condition' },
  { re: /\bprevents?\b/i, why: 'asserts prevention of disease' },
  { re: /\bheals?\b/i, why: 'asserts healing' },
  { re: /\breverses?\b/i, why: 'asserts reversal of a condition' },
  { re: /\bclinically proven\b/i, why: 'asserts clinical proof' },
  { re: /\bmedically proven\b/i, why: 'asserts medical proof' },
  { re: /\bFDA[- ]approved\b/i, why: 'asserts regulatory approval' },
  { re: /\bdiagnos(e|es|is|tic)\b/i, why: 'asserts diagnosis' },
  { re: /\bguaranteed?\b/i, why: 'asserts a guarantee of result' },
  { re: /\bwill (?:fix|repair|restore)\b/i, why: 'asserts a certain outcome' },
  { re: /\brestores? (?:your )?(?:health|cognition|memory|function)\b/i, why: 'asserts restoration of function' },
]);

/**
 * claimsCheck(text) — flag language that turns a description into an efficacy claim.
 * Returns { ok, hits: [{ phrase, why }] }. Never throws. Advisory, not a legal opinion:
 * a clean result is not clearance, it is only the absence of the phrases we know to look for.
 */
export function claimsCheck(text) {
  const s = typeof text === 'string' ? text : (text == null ? '' : String(text));
  const hits = [];
  for (const { re, why } of CLAIM_PATTERNS) {
    const m = s.match(re);
    if (m) hits.push({ phrase: m[0], why });
  }
  return { ok: hits.length === 0, hits };
}

/**
 * THE_LINE_HTML(context) — the framing block for a page. Self-contained, no external assets.
 * Everything interpolated is esc()'d even though the sources are module constants, because the
 * cost of that habit is nothing and the cost of losing it once is an injection.
 */
export function THE_LINE_HTML(context = 'entrainment') {
  return `<section class="the-line">
  <h2>Not even an E-Meter</h2>
  <p>${esc(disclaimer(context))}</p>
  <p>In <em>${esc(EMETER.case)}</em>, ${esc(EMETER.cite)}, a device was held to have no medical value and
  was <b>still not forfeited</b> — the First Amendment protected its use in bona fide religious practice,
  on condition it carried this notice:</p>
  <blockquote>${esc(EMETER.orderedDisclaimer)}</blockquote>
  <p>The rule that produced that outcome is the one worth stating plainly:
  <b>${esc(EMETER.principle)}</b> A court may not decide whether a religious practice is true. It may
  regulate a medical promise.</p>
  <p><b>We start further back than the disclaimer requires.</b> We do not assert the efficacy that notice
  had to deny. We publish what the studies found — including
  <a href="/practices">the ones that found nothing</a> — and we grade our own weakest entries weak.
  A library that does that is not making a claim. It is showing its work, and leaving the weighing to you.</p>
</section>`;
}

/** handler(req,res) — serve the framing as JSON, for other surfaces that need it. */
export function handler(req, res, context = 'entrainment') {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ context, disclaimer: disclaimer(context), precedent: EMETER }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('the-line.mjs');
if (isMain) {
  for (const c of CONTEXTS) console.log(`\n[${c}]\n${disclaimer(c)}`);
  console.log('\nclaimsCheck("cures insomnia") ->', JSON.stringify(claimsCheck('cures insomnia')));
}

export default THE_LINE_HTML;

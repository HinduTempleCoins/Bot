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
// ⭐ THE COUNTERFACTUAL, and the reason this module now holds two precedents instead of one.
//
// The E-Meter shows what SURVIVES. Spectro-Chrome shows what does not, and it is the closer case for us,
// because Spectro-Chrome was a COLOUR-THERAPY LAMP and we are about to publish a colour tradition.
// United States v. Ghadiali, 165 F.2d 957 (3d Cir. 1948) (per curiam), cert. denied, 334 U.S. 821 (1948).
// Twelve counts of introducing a misbranded device into interstate commerce, affirmed.
//
// Hold the two cases side by side and the doctrine stops being abstract. Both devices were found to have
// no medical value. One went back to its church; the other's owner was fined, put on probation, and had
// his literature destroyed. The devices are not what differ. THE SENTENCES DIFFER:
//
//   E-Meter, after the order      "not medically or scientifically useful for the diagnosis, treatment
//                                  or prevention of any disease"                       → RELEASED
//   Spectro-Chrome, on its label  "Measurement And Restoration Of The Human Radio-Active And
//                                  Radio-Emanative Equilibrium ... Attuned Color Waves ...
//                                  No Diagnosis — No Drugs — No Manipulation — No Surgery"  → CONDEMNED
//
// Ghadiali's own defences are the ones a project like this one would reach for first, and every one of
// them failed. He was a Parsee Zoroastrian and said so in the record (Ghadiali v. Delaware State Medical
// Society, 48 F. Supp. 789 (D. Del. 1943)) — the court never reached religion, because he had never
// framed Spectro-Chrome as a religious practice; he framed it as better medicine. He argued free speech —
// that he was only LECTURING — and the court held the lecture was the practice. Sincerity was not the
// question. The question was the claim, and the claim was an efficacy claim.
//
// So the operative rule for this library is narrower and more useful than "be careful": a religious frame
// is not a shield you can raise after the fact over a sentence that promises a cure. The E-Meter is the
// permission; Ghadiali is the boundary of it.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, offline-testable.
//
//   import { EMETER, SPECTRO_CHROME, THE_PAIR, disclaimer, claimsCheck, THE_LINE_HTML } from './the-line.mjs';

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

/**
 * ⭐ The counterfactual precedent. Same doctrine, colour-therapy facts, opposite outcome.
 *
 * Kept as a separate frozen object rather than folded into EMETER because the pair is the argument:
 * one released, one condemned, and the only variable that moved was the sentence on the label.
 */
export const SPECTRO_CHROME = Object.freeze({
  case: 'United States v. Ghadiali',
  cite: '165 F.2d 957 (3d Cir. 1948)',
  disposition: 'per curiam; conviction affirmed on all twelve counts',
  cert: 'cert. denied, Ghadiali v. United States, 334 U.S. 821 (1948)',
  statute: 'Federal Food, Drug, and Cosmetic Act — introducing a misbranded device into interstate commerce',
  device:
    'a cabinet with a 1000-watt bulb, a fan and a water container for cooling, two condenser lenses and '
    + 'five ordinary coloured glass slides',
  // Verbatim as reported in the opinion. Do not paraphrase this string: it is the whole exhibit.
  labelClaim:
    'Measurement And Restoration Of The Human Radio-Active And Radio-Emanative Equilibrium '
    + 'By Attuned Color Waves — No Diagnosis — No Drugs — No Manipulation — No Surgery',
  related: Object.freeze([
    'State v. Ghadiali, 36 Del. 308, 175 A. 315 (Del. Ct. Gen. Sess. 1933) — practising medicine without a licence; cert. denied, Ghadiali v. Delaware, 292 U.S. 653 (1934)',
    'Ghadiali v. Delaware State Medical Soc., 28 F. Supp. 841 (D. Del. 1939)',
    'Ghadiali v. Delaware State Medical Society, 48 F. Supp. 789 (D. Del. 1943) (Biggs, Cir. J.) — statute upheld; the free-speech "I was only lecturing" defence rejected',
  ]),
  religionInTheRecord:
    'The 1943 opinion opens by identifying the plaintiff as "a Parsee Zoroastrian by birth" and a '
    + 'naturalised citizen. The court never reached religion, because Spectro-Chrome had never been '
    + 'framed as religious practice — only as better medicine, and then as protected speech.',
  lesson:
    'A religious frame is not a shield raised after the fact over a sentence that promises a cure. '
    + 'The E-Meter kept its practice by surrendering its claim; Spectro-Chrome kept its claim and lost '
    + 'the device, the literature and the practice.',
});

/**
 * THE_PAIR — the two precedents as one comparison, because neither is much use alone.
 * Ordered released-then-condemned so a reader meets the permission before the boundary.
 */
export const THE_PAIR = Object.freeze([
  Object.freeze({
    id: 'e-meter', label: 'E-Meter', year: 1971, outcome: 'released',
    cite: EMETER.cite, sentence: EMETER.orderedDisclaimer,
    why: 'No medical value found — and no medical claim left standing once the disclaimer was ordered. Bona fide religious use was protected.',
  }),
  Object.freeze({
    id: 'spectro-chrome', label: 'Spectro-Chrome', year: 1948, outcome: 'condemned',
    cite: SPECTRO_CHROME.cite, sentence: SPECTRO_CHROME.labelClaim,
    why: 'The label promised measurement and restoration of the body by colour. That is an intended use, and the device was misbranded for it.',
  }),
]);

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
  // Colour and light. Its own context because Ghadiali is its own precedent: the coloured lamp is the
  // exact article that was condemned, so this surface disclaims measurement and restoration by name.
  colour:
    'Coloured light is presented here as history and as published research, not as a treatment. This is '
    + 'not a medical device and not medical advice. Nothing here diagnoses, treats, cures or prevents any '
    + 'disease, no colour is matched to a condition, and no claim is made that light measures or restores '
    + 'anything about your body. Where the research is strong we say so; where the tradition\u2019s claims are '
    + 'unsupported we say that too.',
  // The exam battery. Different from the others in one way that matters: these produce a NUMBER about
  // the person, and a number invites interpretation. So this wording says who is allowed to do the
  // interpreting, rather than only what we are not.
  exams:
    'These are research instruments, not tests of health. They measure what a person reports or does on '
    + 'one occasion, against a stated reference group. Nothing here diagnoses, treats, cures or prevents '
    + 'any disease, and a score is not a finding about your health. Take the record to a clinician if you '
    + 'want it interpreted — that reading is theirs to make, not ours.',
});

/**
 * ⭐ The affirmative half, which the DISCLAIMERS above do not carry.
 *
 * Every line in this module is a NEGATION — not a device, not advice, does not diagnose. That is what
 * keeps the surface on the right side of the intended-use line, and it is also useless to a reader who
 * has just been handed a number and wants to know what to do with it. Answering that with silence is
 * how a person decides for themselves that a score means something clinical.
 *
 * So this is the referral, stated positively and in the same breath: the record is portable, the
 * clinician is the reader, and the interpretation belongs to them. It is the operator's instruction —
 * "the Doctor can look at what we have" — and it is also the safest sentence on the page, because it
 * routes interpretation to the only person licensed to do it.
 */
export const CONSULT = Object.freeze({
  short: 'Consult your doctor.',
  line: 'Consult your doctor. Take this record with you — it is written to be read by a clinician.',
  full:
    'Consult your doctor before changing anything you do, take, or stop taking, and bring this record '
    + 'with you. It is written to be handed to a clinician: it states what was measured, how, when, and '
    + 'against which reference group, so that someone qualified can interpret it. We do not interpret it. '
    + 'If something here worries you, that is a conversation with a clinician and not with this page.',
  // Said explicitly because the export is FORMATTED to be clinically legible, and legibility is exactly
  // what invites the mistake. Legible like a lab report; not a lab report.
  notALab:
    'This is not a laboratory result. No specimen was taken and no clinical assay was run. It is a record '
    + 'of self-administered measurements — the same kind of thing as a sleep diary or a home blood-pressure '
    + 'log — laid out so a clinician can read it quickly.',
});

/**
 * The compact banner for pages that are not primarily about the library — one line, always the same
 * words, so it is recognisable rather than read anew each time.
 */
export function consultBanner(context = 'exams') {
  return `<aside class="consult" role="note">
  <p><b>${esc(CONSULT.short)}</b> ${esc(disclaimer(context))}</p>
  <p class="muted">${esc(CONSULT.notALab)}</p>
</aside>`;
}

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
  // ⭐ The Ghadiali family. These are the words that were actually on the condemned label, so they are
  // the words this library must never write about itself. "Balances your energy" is 1920s copy for
  // "restores equilibrium", and it is an intended-use claim in exactly the same way.
  // The window allows the intervening words the 1920s copy actually used — "Restoration Of The Human
  // Radio-Active And Radio-Emanative Equilibrium" is six words between the verb and its object.
  { re: /\b(?:restor\w+|rebalanc\w+|balanc(?:e|es|ed|ing)|normaliz\w+|normalis\w+)\b(?:\s+[\w-]+){0,7}\s+\b(?:body|equilibrium|energy|energies|aura|field|system)\b/i, why: 'asserts restoration or rebalancing of the body — the Spectro-Chrome label claim' },
  { re: /\battuned colou?r waves?\b/i, why: 'the Spectro-Chrome label claim, verbatim' },
  { re: /\bcolou?r therapy for\b/i, why: 'matches a colour to a condition — an intended use' },
  { re: /\bhealing (?:colou?r|frequency|light) for\b/i, why: 'matches a stimulus to a condition — an intended use' },
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
  <h3>And the case that went the other way</h3>
  <p>In <em>${esc(SPECTRO_CHROME.case)}</em>, ${esc(SPECTRO_CHROME.cite)}, a colour-therapy lamp —
  ${esc(SPECTRO_CHROME.device)} — was held a misbranded device and its owner's conviction was affirmed
  on twelve counts. Its label had said:</p>
  <blockquote>${esc(SPECTRO_CHROME.labelClaim)}</blockquote>
  <p>Both devices were found to have no medical value. One went home to its church; the other was
  condemned. <b>The devices are not what differ — the sentences differ.</b>
  ${esc(SPECTRO_CHROME.lesson)}</p>
</section>`;
}

/** handler(req,res) — serve the framing as JSON, for other surfaces that need it. */
export function handler(req, res, context = 'entrainment') {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    context,
    disclaimer: disclaimer(context),
    precedent: EMETER,
    counterfactual: SPECTRO_CHROME,
    pair: THE_PAIR,
  }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('the-line.mjs');
if (isMain) {
  for (const c of CONTEXTS) console.log(`\n[${c}]\n${disclaimer(c)}`);
  console.log('\nclaimsCheck("cures insomnia") ->', JSON.stringify(claimsCheck('cures insomnia')));
  console.log('claimsCheck("restores your energy field") ->', JSON.stringify(claimsCheck('restores your energy field')));
  for (const p of THE_PAIR) console.log(`\n[${p.label} ${p.year} — ${p.outcome}] ${p.cite}\n  ${p.sentence}`);
}

export default THE_LINE_HTML;

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
//   import { FDA_GUIDANCE, GENERAL_WELLNESS, guidance, GUIDANCE_HTML } from './the-line.mjs';
//
// ⚠️ CITATION CURRENCY. The two cases are 1948 and 1971 and are stable. The FDA guidance is not:
// it was reissued on 6 January 2026 and superseded the 2019 version this file used to rest on
// implicitly. Every guidance fact below carries an issue date, a docket and the date it was last
// read off fda.gov (GUIDANCE_CHECKED). Re-read before you bump that date.

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


// ────────────────────────────────────────────────────────────────────────────────────────────────
// ⭐ THE CURRENT GUIDANCE, DATED — added 2026-09-09.
//
// WHY THIS EXISTS NOW. Everything above is case law from 1948 and 1971, and case law does not go
// stale quietly. Guidance does. This module had been resting implicitly on the FDA's 2019 General
// Wellness guidance, and that document was superseded on 6 January 2026 while nothing here noticed.
// A citation with no date cannot be audited, so every entry below carries its issue date, its
// docket, its CDRH copy-request number and the date the fact was checked against fda.gov.
//
// ⚠️ THE SUBSTANCE DID NOT MOVE, AND THIS MODULE DOES NOT PRETEND IT DID. The two-factor test and
// the two categories of general wellness intended use read in the 2026 document exactly as they did
// before. FDA's own town-hall deck states the purpose of the reissue in one line — to clarify how
// non-invasive sensing can be considered a general wellness product — and that is a clarification
// about wearables, not a change to the intended-use doctrine the rest of this file encodes. If a
// later reader is tempted to narrate a doctrinal shift here, there was none. The fix was the date.
//
// ⭐ AND THE AFFIRMATIVE HALF, WHICH THIS MODULE HAD NEVER CARRIED. Every other line in this file is
// a negation. The General Wellness guidance is the one federal document that says, in FDA's own
// words, what a surface like this one is ALLOWED to be about — relaxation and stress management,
// sleep management, mental acuity, physical fitness — and it lists, as its own worked example,
// "[c]laims to increase, improve, or enhance the flow of qi 'energy'". A library that teaches
// practice, grades its evidence and refuses to promise an outcome is not near the line. It is
// inside a category the agency wrote down.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** The day every fact in FDA_GUIDANCE was last read off fda.gov. Bump it only after re-reading. */
export const GUIDANCE_CHECKED = '2026-09-09';

/**
 * General Wellness: Policy for Low Risk Devices — the guidance this library actually sits under.
 *
 * Verified 2026-09-09 against the guidance PDF itself (fda.gov/media/90652/download), not against a
 * summary: the cover page reads "Document issued on January 6, 2026. This document supersedes
 * 'General Wellness: Policy for Low Risk Devices' issued on September 27, 2019."
 */
export const GENERAL_WELLNESS = Object.freeze({
  id: 'general-wellness',
  title: 'General Wellness: Policy for Low Risk Devices — Guidance for Industry and Food and Drug Administration Staff',
  status: 'final',
  issued: '2026-01-06',
  supersedes: '“General Wellness: Policy for Low Risk Devices” issued on September 27, 2019',
  docket: 'FDA-2014-N-1039',
  // The number FDA asks you to quote when requesting a copy from CDRH-Guidance@fda.hhs.gov.
  documentNumber: '1300013',
  office: 'Center for Devices and Radiological Health — Digital Health Center of Excellence',
  url: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices',
  pdf: 'https://www.fda.gov/media/90652/download',
  checked: '2026-09-09',
  // From CDRH's own 11 February 2026 town-hall deck (fda.gov/media/100032/download), verbatim.
  lineage: Object.freeze([
    'Draft Guidance published on January 20, 2015',
    'Final Guidance published on July 29, 2016',
    'Final Guidance published on September 27, 2019, to clarify, per the Cures Act, that software functions intended for maintaining or encouraging a healthy lifestyle are not devices',
    'Final Guidance published on January 6, 2026, to clarify how non-invasive sensing can be considered a general wellness product',
  ]),
  whatChanged:
    'Final Guidance published on January 6, 2026, to clarify how non-invasive sensing can be '
    + 'considered a general wellness product.',
  substanceUnchanged:
    'The two-factor test and the two categories of general wellness intended use are unchanged from '
    + 'the superseded 2019 document. Nothing in the 2026 revision alters the intended-use doctrine '
    + 'this module encodes.',
  // Verbatim from §III. Do not paraphrase these strings.
  twoFactors: Object.freeze([
    'are intended for only general wellness use, as defined in this guidance',
    'present a low risk to the safety of users and other persons',
  ]),
  categories: Object.freeze([
    'an intended use that relates to maintaining or encouraging a general state of health or a healthy activity',
    'an intended use that relates the role of healthy lifestyle with helping to reduce the risk or impact of certain chronic diseases or conditions and where it is well understood and accepted that healthy lifestyle choices may play an important role in health outcomes for the disease or condition',
  ]),
  /** §III's list of what the first category of general wellness claims may relate to. Verbatim. */
  firstCategoryClaims: Object.freeze([
    'weight management',
    'physical fitness, including products intended for recreational use',
    'relaxation or stress management',
    'mental acuity',
    'self-esteem (e.g., devices with a cosmetic function that make claims related only to self-esteem)',
    'sleep management',
    'sexual function',
  ]),
  /**
   * FDA's own worked example, and the reason this object is worth having rather than a link.
   * A traditional-practice library reads its own vocabulary back out of a federal guidance document.
   */
  qiExample: 'Claims to increase, improve, or enhance the flow of qi “energy”',
  /**
   * ⭐ The sentence in the guidance that is closest to this library's whole posture, verbatim.
   * Being inside the policy is not a finding that anything works — which is exactly what we say.
   */
  notAnEfficacyFinding:
    'A product’s inclusion under the general wellness policy in this guidance does not establish '
    + 'that it has been shown to be safe and/or effective for its intended use.',
});

/**
 * Clinical Decision Support Software. Reported to the operator as law-firm-sourced and unverified.
 * ✅ CONFIRMED on fda.gov 2026-09-09 — the cover page reads "Document issued on January 29, 2026.
 * This document supersedes 'Clinical Decision Support Software' issued on January 6, 2026." The
 * January reissue was itself reissued three weeks later; both dates are real and the later one wins.
 *
 * ⚠️ It is NOT this library's guidance, and the entry says so in `appliesToUs`. CDS is about software
 * that tells a health care professional what to do about a specific patient. Nothing on these
 * surfaces does that, and the day something here starts to, this is the document it answers to.
 */
export const CLINICAL_DECISION_SUPPORT = Object.freeze({
  id: 'clinical-decision-support',
  title: 'Clinical Decision Support Software — Guidance for Industry and Food and Drug Administration Staff',
  status: 'final',
  issued: '2026-01-29',
  supersedes: '“Clinical Decision Support Software” issued on January 6, 2026',
  docket: 'FDA-2017-D-6569',
  documentNumber: 'GUI01400062',
  office: 'CDRH, CBER, CDER, and the Office of Combination Products',
  url: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software',
  pdf: 'https://www.fda.gov/media/109618/download',
  checked: '2026-09-09',
  verified: true,
  appliesToUs:
    'No. CDS is software that supports a clinician’s decision about an identified patient, under '
    + 'section 520(o)(1)(E) of the FD&C Act. This library publishes research and teaches practice; it '
    + 'does not read a patient’s record and it does not recommend a clinical action. Recorded here '
    + 'so that the day anything here starts to, the document it answers to is already named.',
});

/**
 * Software as a Medical Device (SaMD): Clinical Evaluation — reported as withdrawn, and it is.
 * ✅ CONFIRMED on fda.gov 2026-09-09 in CDRH's own "Withdrawn or Expired Guidance" table: issue date
 * 12/08/2017, withdrawal date 01/06/2026 — the same day the General Wellness guidance was reissued.
 *
 * Carried because a withdrawn guidance is a live hazard for a corpus: it stays online, it still
 * reads authoritative, and a reader who cites it is citing something FDA has said no longer
 * represents its thinking. Naming it here is cheaper than catching it in prose later.
 */
export const SAMD_CLINICAL_EVALUATION = Object.freeze({
  id: 'samd-clinical-evaluation',
  title: 'Software as a Medical Device (SaMD): Clinical Evaluation — Guidance for Industry and Food and Drug Administration Staff',
  status: 'withdrawn',
  issued: '2017-12-08',
  withdrawn: '2026-01-06',
  office: 'Center for Devices and Radiological Health',
  url: 'https://www.fda.gov/medical-devices/guidance-documents-medical-devices-and-radiation-emitting-products/withdrawn-or-expired-guidance',
  checked: '2026-09-09',
  verified: true,
  note:
    'Withdrawn guidance stays reachable online and still reads authoritative. CDRH says withdrawn '
    + 'documents "no longer represent FDA’s current thinking and are presented for historical '
    + 'purposes only." Do not cite it as current.',
});

/** Every guidance document this module tracks, current first, withdrawn last. */
export const FDA_GUIDANCE = Object.freeze([
  GENERAL_WELLNESS, CLINICAL_DECISION_SUPPORT, SAMD_CLINICAL_EVALUATION,
]);

/**
 * guidance(id) — one tracked document, or null. Never throws, never guesses: an id that is not in
 * the list returns null rather than the nearest match, because the nearest match to a regulatory
 * citation is a wrong regulatory citation.
 */
export function guidance(id) {
  const key = String(id == null ? '' : id).trim().toLowerCase();
  if (!key) return null;
  return FDA_GUIDANCE.find((g) => g.id === key) || null;
}

/** The tracked documents FDA has withdrawn — the list a citation pass should check prose against. */
export function withdrawnGuidance() {
  return FDA_GUIDANCE.filter((g) => g.status === 'withdrawn');
}

/**
 * GUIDANCE_HTML() — the dated citations, rendered, so the page states which document it rests on
 * and when that was last checked. A reader who wants to audit us can, in one click.
 */
export function GUIDANCE_HTML() {
  const rows = FDA_GUIDANCE.map((g) => {
    const when = g.status === 'withdrawn'
      ? `issued ${esc(g.issued)} · <b>withdrawn ${esc(g.withdrawn)}</b>`
      : `issued ${esc(g.issued)}`;
    const sup = g.supersedes ? `<br><span class="prov">supersedes ${esc(g.supersedes)}</span>` : '';
    const doc = g.docket
      ? `<br><span class="prov">docket ${esc(g.docket)} · document ${esc(g.documentNumber)}</span>` : '';
    return `<tr>
    <td><a href="${esc(g.url)}">${esc(g.title)}</a>${sup}${doc}</td>
    <td>${when}<br><span class="prov">checked ${esc(g.checked)}</span></td>
  </tr>`;
  }).join('');
  return `<section class="guidance">
  <h2>The guidance this rests on, with its dates</h2>
  <p>The two cases above are from 1948 and 1971 and they do not move. Guidance does, quietly, and a
  citation with no date on it cannot be audited. So:</p>
  <table>
    <tr><th>document</th><th>dates</th></tr>
    ${rows}
  </table>
  <p><b>The substance did not change.</b> ${esc(GENERAL_WELLNESS.substanceUnchanged)}
  FDA states the purpose of the reissue in one line: <q>${esc(GENERAL_WELLNESS.whatChanged)}</q></p>
  <h3>And the half of the doctrine that is not a prohibition</h3>
  <p>Everything else on this page is a negation. This is the one federal document that says what a
  surface like this one is <i>allowed</i> to be about. A general wellness product, in the guidance's
  own two factors, is one that ${esc(GENERAL_WELLNESS.twoFactors.join('; and '))}. The first category
  of such claims may relate to: ${esc(GENERAL_WELLNESS.firstCategoryClaims.join(', '))}.</p>
  <p>Among FDA's own worked examples in that category: <q>${esc(GENERAL_WELLNESS.qiExample)}</q></p>
  <p class="prov">And the sentence closest to this library's whole posture, which is the agency's,
  not ours: <q>${esc(GENERAL_WELLNESS.notAnEfficacyFinding)}</q> Being inside the policy is not a
  finding that anything works. We say the same thing, and we grade our weakest entries weak.</p>
</section>`;
}

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
export function consultBanner(context = 'exams', opts) {
  // ⚠️ `= {}` as a destructuring default fires only for `undefined`. `consultBanner('exams', null)`
  // destructured null and threw a TypeError out of a module whose whole contract is soft-fail —
  // and this banner is the safety copy, so the failure mode was a page rendering with no
  // disclaimer on it. Normalise first, destructure never.
  const o = (opts && typeof opts === 'object') ? opts : {};
  const also = Array.isArray(o.also) ? o.also : (o.also == null ? [] : [o.also]);
  // ⭐ `also` exists because some surfaces sit under TWO doctrines at once. A colour exam is an
  // instrument that produces a number about a person — the `exams` wording, which says who is allowed
  // to interpret it — AND it is a coloured light on a screen, which is the exact article that was
  // condemned in United States v. Ghadiali. Both sentences have to appear, and neither substitutes
  // for the other. Unknown contexts fall back to the strictest wording rather than to nothing, and a
  // context repeated in `also` is dropped rather than printed twice.
  const extra = also
    .map((c) => String(c == null ? '' : c).trim().toLowerCase())
    .filter((c) => c && c !== String(context || '').trim().toLowerCase() && DISCLAIMERS[c]);
  const seen = new Set();
  const lines = extra.filter((c) => (seen.has(c) ? false : seen.add(c)))
    .map((c) => `\n  <p>${esc(disclaimer(c))}</p>`).join('');
  return `<aside class="consult" role="note">
  <p><b>${esc(CONSULT.short)}</b> ${esc(disclaimer(context))}</p>${lines}
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

/**
 * ⭐ THE_PAIR_HTML() — the two sentences side by side, which is the only way either case teaches.
 *
 * Until now THE_PAIR existed only as a data structure, reachable by a developer and by nobody else.
 * The pair is the clearest statement of the intended-use doctrine in this repo — two devices, both
 * found to have no medical value, one released to its church and one condemned, and the only variable
 * that moved was the sentence — so a reader has to be able to get at it.
 */
export function THE_PAIR_HTML() {
  const rows = THE_PAIR.map((p) => `<tr>
    <td><b>${esc(p.label)}</b><br><span class="prov">${esc(p.cite)}</span></td>
    <td>${esc(String(p.year))}</td>
    <td><q>${esc(p.sentence)}</q></td>
    <td><b>${esc(p.outcome)}</b><br><span class="prov">${esc(p.why)}</span></td>
  </tr>`).join('');
  return `<section class="the-pair">
  <h2>Two lamps</h2>
  <p>Both devices were held to have <b>no medical value</b>. One went home to its church under a
  court-ordered disclaimer; the other's owner was convicted on twelve counts, and his literature was
  destroyed. <b>The devices are not what differ. The sentences differ.</b></p>
  <table>
    <tr><th>device</th><th>year</th><th>the sentence</th><th>outcome</th></tr>
    ${rows}
  </table>
  <p>That is the intended-use doctrine with the abstraction taken out of it, and it is worth more than
  any amount of general caution because it is <i>specific</i>: it names the exact register of sentence
  — measurement, restoration, equilibrium, attunement — that converts a description into a claim.</p>
</section>`;
}

/**
 * ⭐ The three defences that failed, and they are the ones a project like this one would reach for
 * first. Worth rendering rather than leaving in a comment, because "we are religious" is exactly the
 * reflex this page exists to correct.
 */
export const FAILED_DEFENCES = Object.freeze([
  {
    defence: 'He was religious, and it is in the record.',
    what: SPECTRO_CHROME.religionInTheRecord,
    lesson: 'A religious frame is not a shield you can raise after the fact over a sentence that '
      + 'promises a cure. It has to be what the practice actually was.',
  },
  {
    defence: 'He argued free speech — that he was only lecturing.',
    what: 'The 1943 opinion rejected it: the court held the lecture was the practice.',
    lesson: 'Describing an intended use is not saved by calling the description a lecture.',
  },
  {
    defence: 'He was sincere, and nobody suggested otherwise.',
    what: 'Sincerity was never the question. The question was the claim, and the claim was an '
      + 'efficacy claim.',
    lesson: 'A court may not decide whether a religious practice is true. It may regulate a medical '
      + 'promise. Those are different questions and only the second one was ever asked.',
  },
]);

export function FAILED_DEFENCES_HTML() {
  return `<section class="failed-defences">
  <h3>And the part that should stop anyone reaching for the religious frame as a shield</h3>
  <ul>${FAILED_DEFENCES.map((d) => `<li><b>${esc(d.defence)}</b><br>${esc(d.what)}<br>
    <span class="prov">${esc(d.lesson)}</span></li>`).join('')}</ul>
</section>`;
}

/** The contexts a reader may ask /the-line to show. An allow-list, not a filter. */
export const PAGE_CONTEXTS = Object.freeze(['colour', 'entrainment', 'practices', 'preparations', 'reports', 'exams']);

/**
 * theLinePageHTML(context) — the whole thing as a standalone page.
 *
 * Self-contained: no external stylesheet, no script, nothing to load. It carries the CONSULT banner
 * like every other page in this directory, and it renders the pair, the failed defences and the
 * disclaimer for whichever surface the reader arrived from.
 */
export function theLinePageHTML(context = 'colour') {
  const c = PAGE_CONTEXTS.includes(String(context || '').toLowerCase())
    ? String(context).toLowerCase() : 'colour';
  const others = PAGE_CONTEXTS.filter((x) => x !== c)
    .map((x) => `<a href="/the-line?context=${esc(x)}">${esc(x)}</a>`).join(' · ');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Two lamps — where the line is</title>
<meta name=robots content="index,follow">
<meta name=description content="Two devices, both found to have no medical value. One released, one condemned. The sentences differ.">
<style>
  :root{--bg:#0e0b14;--panel:#161020;--text:#efe9f7;--muted:#a99fc0;--border:#2c2338;--accent:#e2b857}
  body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  main{max-width:800px;margin:0 auto;padding:28px 18px 80px}
  h1{font-size:1.7rem;margin:0 0 6px} h2{font-size:1.2rem;margin:28px 0 8px} h3{font-size:1.05rem;margin:22px 0 6px}
  a{color:var(--accent)}
  .prov,.muted{color:var(--muted);font-size:13px}
  blockquote,q{color:var(--muted)}
  blockquote{margin:10px 0;padding:8px 14px;border-left:3px solid var(--border)}
  table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}
  td,th{border-bottom:1px solid var(--border);padding:8px 6px;text-align:left;vertical-align:top}
  ul li{margin:10px 0}
  .consult{border:1px solid var(--border);border-left:3px solid var(--muted);border-radius:8px;
    padding:10px 14px;margin:0 0 18px;background:var(--panel);font-size:14px}
  .consult p{margin:4px 0}
  section{border-top:1px solid var(--border);margin-top:26px;padding-top:6px}
</style></head><body><main>
${consultBanner(c)}
<h1>Two lamps</h1>
<p class="muted">Where the line actually is, according to the two cases that drew it. This page is the
public record, not our opinion of it.</p>
${THE_LINE_HTML(c)}
${THE_PAIR_HTML()}
${FAILED_DEFENCES_HTML()}
${GUIDANCE_HTML()}
<section>
  <h3>The same page, from another surface’s point of view</h3>
  <p class="prov">The doctrine does not change; the sentence a given surface has to avoid does.
  ${others}</p>
  <p class="prov">${esc(CONSULT.notALab)}</p>
</section>
</main></body></html>`;
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
    guidance: FDA_GUIDANCE,
    guidanceChecked: GUIDANCE_CHECKED,
  }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('the-line.mjs');
if (isMain) {
  for (const c of CONTEXTS) console.log(`\n[${c}]\n${disclaimer(c)}`);
  console.log('\nclaimsCheck("cures insomnia") ->', JSON.stringify(claimsCheck('cures insomnia')));
  console.log('claimsCheck("restores your energy field") ->', JSON.stringify(claimsCheck('restores your energy field')));
  for (const p of THE_PAIR) console.log(`\n[${p.label} ${p.year} — ${p.outcome}] ${p.cite}\n  ${p.sentence}`);
  console.log(`\nFDA guidance, checked ${GUIDANCE_CHECKED}:`);
  for (const g of FDA_GUIDANCE) {
    console.log(`  [${g.status}] ${g.title}\n    issued ${g.issued}${g.withdrawn ? ` · withdrawn ${g.withdrawn}` : ''}`);
  }
}

export default THE_LINE_HTML;
export const THE_LINE = Object.freeze({
  EMETER, SPECTRO_CHROME, THE_PAIR, FAILED_DEFENCES, PAGE_CONTEXTS,
  FDA_GUIDANCE, GENERAL_WELLNESS, CLINICAL_DECISION_SUPPORT, SAMD_CLINICAL_EVALUATION, GUIDANCE_CHECKED,
  disclaimer, consultBanner, claimsCheck, THE_LINE_HTML, THE_PAIR_HTML, FAILED_DEFENCES_HTML,
  guidance, withdrawnGuidance, GUIDANCE_HTML, theLinePageHTML, handler,
});

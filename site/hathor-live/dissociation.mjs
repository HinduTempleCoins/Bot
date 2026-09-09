// dissociation.mjs — R9. AN EXPLAINER, NOT AN INSTRUMENT.
//
// From `.local/temple-exams/trance-colour-and-divination.md` §5.4 and its R9 recommendation, stated
// in one line: *"What dissociation is, that it is dimensional and ordinary at the low end, that
// clinicians screen for it with a validated 28-item instrument, that we are not going to administer
// one on a web page, and CONSULT.full."*
//
// ⭐ WHY THE REFUSAL IS THE PRODUCT. This battery measures trance-adjacent things — absorption,
// expectancy uptake, the Thread Protocol, lucid practice. Every one of them sits near a clinical
// construct, and the temptation is to add "and here is your dissociation score" because the items are
// free and the arithmetic is easy. That is the move this file exists to not make.
//
// The reason is not squeamishness, it is base rates. `identity-grade-instruments.md` §7 establishes
// the number that settles it: the MMSE has a positive predictive value of 86.3% in a memory clinic
// and 34.5% in the community — same instrument, same cutoff, only the prevalence moved. A screener
// aimed at a low-prevalence population produces mostly false positives, and a dissociation screener
// on an open web page is exactly that population.
//
// So: teach the construct, name the instrument clinicians actually use, and refuse to run it.
//
//   import { DISSOCIATION, WHY_NO_INSTRUMENT, dissociationHTML, handler } from './dissociation.mjs'

import { esc, CONSULT } from './the-line.mjs';
export { esc };

export const DISSOCIATION = Object.freeze({
  what: 'A disruption in the normally continuous experience of memory, identity, perception, or the '
    + 'sense of being present in one\'s own body and surroundings.',
  dimensional: 'It is DIMENSIONAL, not a switch. The low end is ordinary and nearly universal — missing '
    + 'your exit because you were thinking, losing an hour in a book or a film, arriving somewhere with '
    + 'no memory of the drive. Most people experience that. It is not a disorder and it is not a sign '
    + 'of one.',
  highEnd: 'The high end is clinically significant, is strongly associated with trauma history, and is '
    + 'assessed by a clinician over time — never by a single questionnaire and never by a web page.',
  adjacent: 'It borders things this battery does measure. Absorption — sustained imaginative '
    + 'involvement — overlaps with dissociation at the low end and is NOT the same construct. Neither '
    + 'is expectancy uptake. Scoring high on either says nothing about the clinical end.',
});

export const INSTRUMENT = Object.freeze({
  name: 'the Dissociative Experiences Scale (DES-II)',
  items: 28,
  whoUses: 'clinicians and researchers',
  note: 'It is widely used, freely available for research and clinical use, and it is a SCREENING '
    + 'instrument — it does not diagnose. Even in clinical hands a high score is the start of an '
    + 'assessment, not the end of one.',
});

/** ⭐ The refusal, with its reason — because a refusal without a reason reads as squeamishness. */
export const WHY_NO_INSTRUMENT = Object.freeze([
  Object.freeze({
    reason: 'Base rates decide it, not caution.',
    detail: 'A screener\'s positive predictive value collapses as prevalence falls. The MMSE runs at '
      + '86.3% PPV in a memory clinic and 34.5% in the community — same instrument, same cutoff, only '
      + 'the population changed. An open web page is the lowest-prevalence population there is, so most '
      + 'positives would be false ones, handed to people with no clinician in the room.',
  }),
  Object.freeze({
    reason: 'The permission is scoped, and a public page is outside it.',
    detail: 'The DES-II is made available for research or clinical use. A public self-administered page '
      + 'is neither of those things, whatever the fee is.',
  }),
  Object.freeze({
    reason: 'The result would have nowhere to go.',
    detail: 'A number about dissociation is only useful to somebody who can act on it. We do not '
      + 'interpret results — see /exams/who-says — so we would be handing a person a frightening number '
      + 'and a referral we could have given them without the number.',
  }),
]);

export function dissociationHTML() {
  const whys = WHY_NO_INSTRUMENT.map((w) => `<li><b>${esc(w.reason)}</b><span class=muted>${esc(w.detail)}</span></li>`).join('');
  return `<h1>Dissociation</h1>
<p class=muted>This page explains a construct. <b>It does not measure you, and that is deliberate.</b></p>

<div class=card>
  <h2 style="margin-top:0">What it is</h2>
  <p>${esc(DISSOCIATION.what)}</p>
  <p>${esc(DISSOCIATION.dimensional)}</p>
  <p>${esc(DISSOCIATION.highEnd)}</p>
</div>

<div class=card>
  <h2 style="margin-top:0">How it borders what we do measure</h2>
  <p class=muted>${esc(DISSOCIATION.adjacent)}</p>
</div>

<div class=card>
  <h2 style="margin-top:0">What clinicians use</h2>
  <p>Clinicians and researchers screen with <b>${esc(INSTRUMENT.name)}</b>, ${esc(String(INSTRUMENT.items))} items.</p>
  <p class=muted>${esc(INSTRUMENT.note)}</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Why we are not going to give you one</h2>
  <ul class=limits>${whys}</ul>
</div>

<div class=card>
  <p>${esc(CONSULT.full)}</p>
</div>`;
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'dissociation',
    isInstrument: false,
    instrumentCliniciansUse: { name: INSTRUMENT.name, items: INSTRUMENT.items },
    refusalReasons: WHY_NO_INSTRUMENT.map((w) => w.reason),
    note: 'An explainer, not an instrument. We do not administer a dissociation screener: on an open '
        + 'page the base rate makes most positives false ones, and the result would have nowhere to go.',
  }, null, 2));
}

export default { DISSOCIATION, INSTRUMENT, WHY_NO_INSTRUMENT, dissociationHTML, handler };

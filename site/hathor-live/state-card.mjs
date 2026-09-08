// site/hathor-live/state-card.mjs — the Temple State Card.
//
// One screen, under a minute, in front of EVERY instrument, EVERY time. It is not a test. It is the
// thing that makes a repeat administration analysable: you sober on Tuesday against you tired on
// Friday, with every stable fact about you — your trait, your monitor, your eyesight, your room —
// held constant by construction. That within-subject comparison is the entire scientific value of
// the battery, and it is worth several times the effect size of the between-subject version.
//
// ── THE ONE RULE THAT LOOKS LIKE AN OMISSION AND IS NOT ───────────────────────────────────────────
//
// IT NEVER ASKS DOSE, AMOUNT, OR ROUTE. Not once, not optionally, not in free text.
//
// Two independent reasons, and both are load-bearing:
//   1. MEASUREMENT. Self-reported quantity is unreliable. What actually predicts performance is
//      CURRENT SUBJECTIVE EFFECT, which is what DEQ-5 measures — validated across three drug classes
//      and against placebo (Morean et al. 2013). The better instrument is also the safer one.
//   2. HARM. Asking "how much" converts a benign covariate into sensitive substance-use-QUANTITY
//      data, which in several jurisdictions is special-category personal data with real legal
//      consequences for the person who answered honestly.
//
// This is NOT the scope guard CLAUDE.md retired twice. The Library serves dose, route, preparation
// and interaction detail, in full, because withholding it from someone who is going to proceed
// anyway is the harm. That is about what we TELL people. This is about what we ASK them and then
// keep on a disk. Teaching a dose and recording a stranger's are opposite acts.
//
// ── WORDING RULES, WHICH ARE THE INSTRUMENT ──────────────────────────────────────────────────────
//
//   * RIGHT NOW, never habits. "Do you drink?" is a different question with a different answer and
//     a different legal shadow.
//   * NEUTRAL. No approval, no disapproval, no health messaging on this screen. A leading question
//     produces a lying answer and a lying covariate is worse than no covariate.
//   * Prescribed medication is listed in the same breath as alcohol ON PURPOSE. It de-moralises the
//     question and improves disclosure.
//   * "Prefer not to say" on every item, as a FIRST-CLASS RECORDED VALUE, never coerced to a
//     default. A forced answer is a fabricated answer.
//   * The card comes BEFORE the instrument, so the state report is not contaminated by how the
//     person thinks they did.
//
// ── AND IT NEVER GOES ON CHAIN ───────────────────────────────────────────────────────────────────
//
// Current intoxication and prescribed medication are health-adjacent. .local/TEMPLE_EXAMS_SAFETY_GATE.md
// §4 is inherited verbatim: the chain sees a boolean at most, and nothing here emits one.
//
// Pure and offline: no I/O, no clock of its own, no network. esc() everything on the way out.

import { esc } from '../../integrations/melek-theme.mjs';
import { hasContact } from './reports.mjs';

export { esc };

// ── item 1: Karolinska Sleepiness Scale ───────────────────────────────────────────────────────────
// Åkerstedt & Gillberg (1990). Validated against EEG alpha/theta and slow eye movements — Kaida et
// al. (2006), Clinical Neurophysiology. THE ANCHORS ARE THE INSTRUMENT: reworded anchors are a
// different scale with no validation behind it, so they are reproduced as published and the even
// numbers genuinely carry no label of their own.
export const KSS = Object.freeze([
  { value: 1, label: 'Extremely alert' },
  { value: 2, label: 'Very alert' },
  { value: 3, label: 'Alert' },
  { value: 4, label: 'Rather alert' },
  { value: 5, label: 'Neither alert nor sleepy' },
  { value: 6, label: 'Some signs of sleepiness' },
  { value: 7, label: 'Sleepy, but no effort to keep awake' },
  { value: 8, label: 'Sleepy, some effort to keep awake' },
  { value: 9, label: 'Very sleepy, great effort to keep awake, fighting sleep' },
]);

// ── item 5/6: the substance gate ──────────────────────────────────────────────────────────────────
export const SUBSTANCE_QUESTION =
  'Is anything you have taken affecting how you feel right now? This includes alcohol, cannabis, '
  + 'prescribed medication, caffeine — anything.';

export const SUBSTANCE_CLASSES = Object.freeze([
  'alcohol', 'cannabis', 'caffeine', 'nicotine', 'prescribed medication',
  'psychedelic', 'stimulant', 'sedative', 'other', 'prefer not to say',
]);

// ── item 7: DEQ-5 ─────────────────────────────────────────────────────────────────────────────────
// Morean, M.E. et al. (2013). The Drug Effects Questionnaire: psychometric support across three drug
// types. Psychopharmacology 227, 177–192. Substance-agnostic, five items, and it measures the thing
// that matters (current subjective effect) instead of the thing people misreport (how much).
export const DEQ5 = Object.freeze([
  { id: 'feel', prompt: 'Do you feel any drug effect?' },
  { id: 'high', prompt: 'Do you feel high?' },
  { id: 'like', prompt: 'Do you like the effects?' },
  { id: 'dislike', prompt: 'Do you dislike the effects?' },
  { id: 'more', prompt: 'Do you want more?' },
]);

export const ENVIRONMENT = Object.freeze({
  company: ['alone', 'others present', 'prefer not to say'],
  noise: ['quiet', 'noisy', 'prefer not to say'],
  headphones: ['yes', 'no', 'prefer not to say'],
  interruptions: ['none expected', 'interruptions likely', 'prefer not to say'],
});

// Joins the battery to the existing practices library without duplicating it. Free-form ids are
// accepted so practices.mjs can grow without this file changing.
export const PRACTICE_OPTIONS = Object.freeze([
  'meditation', 'fasting', 'breathwork', 'entrainment session', 'none', 'prefer not to say',
]);

export const PREFER_NOT_TO_SAY = 'prefer not to say';

/**
 * Fields this card MUST NOT carry, checked on the way in rather than trusted to stay absent.
 *
 * A future contributor adding `dose` to the client form would otherwise get it silently stored. The
 * submission is REFUSED with the reason, so the mistake shows up in a test run instead of on a disk.
 */
export const FORBIDDEN_FIELDS = Object.freeze([
  'dose', 'doses', 'dosage', 'amount', 'quantity', 'route', 'mg', 'grams', 'units',
  'name', 'email', 'phone', 'address', 'dob', 'ip',
]);

const num = (v) => (v === '' || v == null ? null : Number(v));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const str = (v) => String(v == null ? '' : v).trim();

function optional(value, allowed, errors, field) {
  const v = str(value).toLowerCase();
  if (!v) return null;                       // unanswered is a real state, distinct from refused
  if (allowed.includes(v)) return v;
  errors.push(`${field}: "${v}" is not one of the offered answers.`);
  return null;
}

/**
 * Validate and normalise a state card. Returns { ok, errors, card }. Never throws.
 *
 * Nothing is required. A card of all nulls is a valid card and means "this person told us nothing",
 * which is a true and useful record. The only things that FAIL are a forbidden field, a value that
 * is not on the menu, and free text carrying contact details.
 */
export function validateStateCard(input = {}, { now = () => new Date() } = {}) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  for (const f of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, f)) {
      errors.push(`The state card does not accept "${f}" and never will — see the header of state-card.mjs.`);
    }
  }

  // 1. KSS
  let kss = null;
  if (str(src.kss) && str(src.kss).toLowerCase() !== PREFER_NOT_TO_SAY) {
    const n = num(src.kss);
    if (!Number.isFinite(n) || n < 1 || n > 9 || n !== Math.round(n)) {
      errors.push('Sleepiness: pick one of the nine anchors, or leave it.');
    } else kss = n;
  }
  const kssRefused = str(src.kss).toLowerCase() === PREFER_NOT_TO_SAY;

  // 2/3. hours awake, hours slept — free numerics with sane bounds, clamped rather than rejected
  // because a typo should cost the value, not the whole card.
  const hoursAwake = Number.isFinite(num(src.hoursAwake)) ? clamp(num(src.hoursAwake), 0, 24) : null;
  const hoursSlept = Number.isFinite(num(src.hoursSlept)) ? clamp(num(src.hoursSlept), 0, 14) : null;
  const sleepUnusual = src.sleepUnusual === true || str(src.sleepUnusual) === 'true';

  // 4. Local clock — RECORDED, not asked. The client sends what its own clock says; the server
  // stamps arrival separately, and the pair is more informative than either alone.
  const localTime = str(src.localTime).slice(0, 32);
  const tz = str(src.tz).slice(0, 64);
  const tzOffsetMin = Number.isFinite(num(src.tzOffsetMin)) ? clamp(num(src.tzOffsetMin), -900, 900) : null;

  // 5. the gate
  const affected = optional(src.affected, ['yes', 'no', PREFER_NOT_TO_SAY], errors, 'Substance gate');

  // 6. which — only meaningful if the gate said yes. Never a dose, never a route.
  let classes = [];
  if (Array.isArray(src.classes)) {
    for (const c of src.classes.slice(0, SUBSTANCE_CLASSES.length)) {
      const v = str(c).toLowerCase();
      if (SUBSTANCE_CLASSES.includes(v)) classes.push(v);
      else if (v) errors.push(`Substance class: "${esc(v)}" is not one of the offered answers.`);
    }
    classes = [...new Set(classes)];
  }
  // Free text is allowed for "other" and it is the one place a person can type anything, so it is
  // the one place a contact detail can arrive. Refuse it, the way reports.mjs does.
  const otherText = str(src.otherText).slice(0, 120);
  if (otherText && hasContact(otherText)) {
    errors.push('That box has what looks like an email address or a phone number in it. This card '
      + 'holds no contact details — take it out and send it again.');
  }
  if (affected !== 'yes' && classes.length) {
    // Not an error: a person can change the gate after ticking. Drop rather than bounce.
    classes = [];
  }

  // 7. DEQ-5 — 0–100 visual analogue, per item
  const deq5 = {};
  const deqSrc = src.deq5 && typeof src.deq5 === 'object' ? src.deq5 : {};
  for (const item of DEQ5) {
    const n = num(deqSrc[item.id]);
    deq5[item.id] = Number.isFinite(n) ? clamp(Math.round(n), 0, 100) : null;
  }

  // 8. alcohol-specific subjective intoxication VAS. Kept because alcohol's effects REVERSE SIGN
  // across the rising and falling limbs of the blood-alcohol curve, so a single "drunk" flag is not
  // just coarse, it is sometimes backwards.
  const intoxicationVas = classes.includes('alcohol') && Number.isFinite(num(src.intoxicationVas))
    ? clamp(Math.round(num(src.intoxicationVas)), 0, 100) : null;

  // 9. mood — two sliders, large explanatory power, no diagnostic framing
  const valence = Number.isFinite(num(src.valence)) ? clamp(Math.round(num(src.valence)), 0, 100) : null;
  const arousal = Number.isFinite(num(src.arousal)) ? clamp(Math.round(num(src.arousal)), 0, 100) : null;

  // 10. environment
  const environment = {
    company: optional(src.company, ENVIRONMENT.company, errors, 'Company'),
    noise: optional(src.noise, ENVIRONMENT.noise, errors, 'Noise'),
    headphones: optional(src.headphones, ENVIRONMENT.headphones, errors, 'Headphones'),
    interruptions: optional(src.interruptions, ENVIRONMENT.interruptions, errors, 'Interruptions'),
  };

  // 11. practice today
  const practices = Array.isArray(src.practices)
    ? [...new Set(src.practices.map((p) => str(p).toLowerCase()).filter(Boolean))].slice(0, 8)
    : [];

  if (errors.length) return { ok: false, errors, card: null };

  return {
    ok: true,
    errors: [],
    card: {
      v: 1,
      kss, kssRefused,
      hoursAwake, hoursSlept, sleepUnusual,
      localTime, tz, tzOffsetMin,
      recordedAt: now().toISOString(),
      affected, classes, otherText,
      deq5, intoxicationVas,
      valence, arousal,
      environment, practices,
    },
  };
}

/**
 * The honest one-line summary a result screen can print back. Deliberately descriptive and
 * deliberately not an interpretation — "you were tired" is a claim, "KSS 8 of 9" is a reading.
 */
export function summariseStateCard(card) {
  if (!card || typeof card !== 'object') return 'No state card was recorded for this sitting.';
  const bits = [];
  if (card.kss != null) {
    const anchor = KSS.find((k) => k.value === card.kss);
    bits.push(`sleepiness ${card.kss}/9${anchor ? ` (${anchor.label.toLowerCase()})` : ''}`);
  } else if (card.kssRefused) bits.push('sleepiness not given');
  if (card.hoursSlept != null) bits.push(`${card.hoursSlept}h slept`);
  if (card.hoursAwake != null) bits.push(`${card.hoursAwake}h awake`);
  if (card.affected === 'yes') {
    const d = card.deq5 && card.deq5.feel;
    bits.push(`something in effect${Number.isFinite(d) ? `, drug-effect ${d}/100` : ''}`);
  } else if (card.affected === 'no') bits.push('nothing in effect');
  else if (card.affected === PREFER_NOT_TO_SAY) bits.push('substance question declined');
  if (card.environment && card.environment.noise) bits.push(card.environment.noise);
  return bits.length ? bits.join(' · ') : 'A state card was recorded with nothing answered.';
}

// ── the screen ───────────────────────────────────────────────────────────────────────────────────

const radios = (name, options, opts = {}) => options.map((o, i) => {
  const v = typeof o === 'object' ? o.value : o;
  const label = typeof o === 'object' ? o.label : o;
  return `<label class=opt><input type=radio name="${esc(name)}" value="${esc(String(v))}"${opts.id ? ` id="${esc(opts.id)}${i}"` : ''}> <span>${esc(String(label))}</span></label>`;
}).join('');

const vas = (name, prompt) => `<div class=vas>
  <label for="${esc(name)}">${esc(prompt)}</label>
  <input type=range id="${esc(name)}" name="${esc(name)}" min=0 max=100 value=0 step=1>
  <div class=vasends><span>not at all</span><span>extremely</span></div>
</div>`;

/**
 * Render the card. `formId` lets a caller mount more than one on a page without colliding.
 *
 * There is no warning, no advice and no interstitial on this screen, by design. If the institute
 * wants to say something about testing while intoxicated, it belongs in the consent text, once,
 * before any of this.
 */
export function stateCardHTML({ formId = 'statecard' } = {}) {
  return `<section class=card id="${esc(formId)}">
  <h2>Before you start</h2>
  <p class=muted>Under a minute. None of it is required, every question can be skipped, and
  <b>"prefer not to say" is recorded as itself</b> rather than turned into a default. This is not
  part of the exam and nothing here is scored.</p>

  <fieldset><legend>How sleepy are you right now?</legend>
    <p class=prov>Karolinska Sleepiness Scale (Åkerstedt &amp; Gillberg 1990), validated against EEG
    alpha/theta and slow eye movements (Kaida et al. 2006). The anchors are reproduced as published.</p>
    ${radios('kss', KSS.map((k) => ({ value: k.value, label: `${k.value} — ${k.label}` })))}
    ${radios('kss', [{ value: PREFER_NOT_TO_SAY, label: 'Prefer not to say' }])}
  </fieldset>

  <fieldset><legend>Sleep and clock</legend>
    <label class=field>Hours since you woke <input type=number name=hoursAwake min=0 max=24 step=0.5 inputmode=decimal></label>
    <label class=field>Hours slept last night <input type=number name=hoursSlept min=0 max=14 step=0.5 inputmode=decimal></label>
    <label class=opt><input type=checkbox name=sleepUnusual value=true> <span>That is unusual for me</span></label>
    <p class=prov>Your local clock time and timezone are recorded automatically. We do not ask for them.</p>
  </fieldset>

  <fieldset><legend>${esc(SUBSTANCE_QUESTION)}</legend>
    ${radios('affected', ['yes', 'no', PREFER_NOT_TO_SAY])}
    <div class=subq hidden id="${esc(formId)}-which">
      <p class=muted>Which? Tick any that apply.</p>
      ${SUBSTANCE_CLASSES.map((c) => `<label class=opt><input type=checkbox name=classes value="${esc(c)}"> <span>${esc(c)}</span></label>`).join('')}
      <label class=field>Other — one or two words <input type=text name=otherText maxlength=120 autocomplete=off></label>
      <p class=prov><b>We do not ask how much, and we never will.</b> Self-reported quantity is
      unreliable, and asking for it would turn a harmless covariate into sensitive data about you.
      The five sliders below measure the thing that actually matters — what you feel right now —
      and they are the validated instrument (DEQ-5; Morean et al. 2013, Psychopharmacology 227:177–192).</p>
      ${DEQ5.map((d) => vas(`deq5.${d.id}`, d.prompt)).join('')}
    </div>
  </fieldset>

  <fieldset><legend>Mood right now</legend>
    ${vas('valence', 'Unpleasant → pleasant')}
    ${vas('arousal', 'Calm → activated')}
  </fieldset>

  <fieldset><legend>Where you are</legend>
    ${Object.entries(ENVIRONMENT).map(([k, opts]) => `<div class=row><span class=rowlab>${esc(k)}</span>${radios(k, opts)}</div>`).join('')}
  </fieldset>

  <fieldset><legend>Anything you practised today</legend>
    ${PRACTICE_OPTIONS.map((p) => `<label class=opt><input type=checkbox name=practices value="${esc(p)}"> <span>${esc(p)}</span></label>`).join('')}
  </fieldset>
</section>`;
}

export default {
  KSS, DEQ5, SUBSTANCE_CLASSES, SUBSTANCE_QUESTION, ENVIRONMENT, PRACTICE_OPTIONS,
  FORBIDDEN_FIELDS, PREFER_NOT_TO_SAY, validateStateCard, summariseStateCard, stateCardHTML, esc,
};

// site/hathor-live/exam-vviq.mjs — the Vividness of Visual Imagery Questionnaire.
//
// The flagship. Highest revelation-per-minute of anything in the battery, because most people
// assume everyone else's inner life looks like theirs, and the range is enormous at both ends. This
// is the instrument the whole modern aphantasia literature is built on, and the reason "some people
// have no mind's eye" went from an anecdote to a research programme.
//
// ── SCALE DIRECTION, WHICH IS A LIVE SOURCE OF CONFUSION ─────────────────────────────────────────
//
// Marks (1973) ran it the other way up: 1 meant "perfectly clear and as vivid as normal vision".
// VVIQ-2 (Marks 1995) REVERSED it so that low = low vividness, and virtually all aphantasia-era work
// reports the reversed direction, 16–80, low = aphantasic. We ship the reversed direction and the
// page says so on screen, because a score quoted in the wrong direction is not a small error — it is
// the opposite result.
//
// ── SCORING, STATED HONESTLY ─────────────────────────────────────────────────────────────────────
//
// Zeman et al. (2020) treated VVIQ < 24 as aphantasia, splitting "extreme" (16, the floor) from
// "moderate" (17–23). A ≤ 32 threshold also circulates. Hyperphantasia is the upper tail, ~75+.
// THERE IS NO CONSENSUS CUT-OFF and the result screen says so, in those words. The landmarks are
// printed as landmarks — each cites its source and makes no claim about the reader.
//
// ── WHAT THIS RESULT MAY NEVER BE WORDED AS ──────────────────────────────────────────────────────
//
//   "You have aphantasia." This is the single most likely place in the battery for someone to score
//   into an identity on a web page and carry it for life. Report the number, name the landmark, say
//   what the number is not.
//
// ── AND THE THING A VISUAL SCORE CANNOT TELL YOU ─────────────────────────────────────────────────
//
// Andrade, May, Deeprose, Baugh & Ganis (2014) found imagery modalities do NOT collapse into a
// single factor: someone can be visually aphantasic and have vivid auditory, emotional or bodily
// imagery. A VVIQ score alone will never show them that, so the page says it rather than letting a
// visual number stand in for an inner life. Psi-Q is the companion instrument and is not built yet;
// the page names the gap instead of papering over it.
//
// ── ITEM PROVENANCE AND LICENCE ──────────────────────────────────────────────────────────────────
//
// The 16 VVIQ items below are Marks (1973), reproduced from the published appendix as they appear
// across the instrument libraries and the aphantasia literature, for a free, non-commercial research
// use that pays nobody anything (exams.mjs enforces the "never payable" half). VVIQ-2's 32 items are
// deliberately NOT reproduced — that set is Marks' and the safe move there is to link, not reprint.
// If the rights holder wants this changed, it is one constant.
//
// ── ADMINISTRATION ───────────────────────────────────────────────────────────────────────────────
//
// Marks administered each scenario twice, eyes open then eyes closed. Most modern online use
// administers once, and so do we — and the page says which, because the two are not the same
// instrument and a score is not comparable across them.
//
// Pure and offline. No I/O. esc() everything.

import { esc } from '../../integrations/melek-theme.mjs';
import { seedFrom } from '../../integrations/token-exams.mjs';
import { FRAMING, examShell, referenceClass, retestPair, examById } from './exams.mjs';
import { stateCardHTML } from './state-card.mjs';
import { KEYGEN_JS } from './participant-key.mjs';

export { esc };

export const EXAM_ID = 'vviq';

/**
 * The five-point scale, in the REVERSED (VVIQ-2 / aphantasia-era) direction.
 * 1 = no image at all, 5 = as vivid as real seeing.
 */
export const SCALE = Object.freeze([
  { value: 1, label: 'No image at all — you only "know" that you are thinking of the object' },
  { value: 2, label: 'Vague and dim' },
  { value: 3, label: 'Moderately clear and vivid' },
  { value: 4, label: 'Clear and reasonably vivid' },
  { value: 5, label: 'Perfectly clear and as vivid as normal vision' },
]);

export const MIN_SCORE = 16;
export const MAX_SCORE = 80;

/** Four scenarios of four items. Scenario order is randomised; items within a scenario are not. */
export const SCENARIOS = Object.freeze([
  {
    id: 'person',
    stem: 'Think of some relative or friend whom you frequently see, and consider carefully the picture that comes before your mind’s eye.',
    items: [
      'The exact contour of face, head, shoulders and body.',
      'Characteristic poses of head, attitudes of body, and so on.',
      'The precise carriage, length of step, and so on, in walking.',
      'The different colours worn in some familiar clothes.',
    ],
  },
  {
    id: 'sunrise',
    stem: 'Visualise a rising sun. Consider carefully the picture that comes before your mind’s eye.',
    items: [
      'The sun is rising above the horizon into a hazy sky.',
      'The sky clears and surrounds the sun with blueness.',
      'Clouds. A storm blows up, with flashes of lightning.',
      'A rainbow appears.',
    ],
  },
  {
    id: 'shop',
    stem: 'Think of the front of a shop which you often go to. Consider the picture that comes before your mind’s eye.',
    items: [
      'The overall appearance of the shop from the opposite side of the road.',
      'A window display including colours, shapes and details of individual items for sale.',
      'You are near the entrance. The colour, shape and details of the door.',
      'You enter the shop and go to the counter. The counter assistant serves you. Money changes hands.',
    ],
  },
  {
    id: 'country',
    stem: 'Finally think of a country scene which involves trees, mountains and a lake. Consider the picture that comes before your mind’s eye.',
    items: [
      'The contours of the landscape.',
      'The colour and shape of the trees.',
      'The colour and shape of the lake.',
      'A strong wind blows on the trees and on the lake, causing waves.',
    ],
  },
]);

export const ITEM_COUNT = SCENARIOS.reduce((n, s) => n + s.items.length, 0); // 16

/** Every item as a flat, stably-identified list: `${scenarioId}.${1-based index}`. */
export const ITEMS = Object.freeze(SCENARIOS.flatMap((s) => s.items.map((text, i) => ({
  id: `${s.id}.${i + 1}`, scenario: s.id, index: i, text,
}))));

/**
 * Landmarks, each citing its source and making no claim about the reader.
 * `noConsensus` is not a caveat bolted on — it is the finding about this literature.
 */
export const LANDMARKS = Object.freeze({
  noConsensus: 'There is no consensus cut-off for any of this, and different research groups use different ones.',
  entries: [
    { text: 'Scores below 24 are the range within which most published aphantasia research recruits participants; the floor of 16 is sometimes separated out as the extreme case, and 17–23 as the moderate one.',
      source: 'Zeman, A. et al. (2020), Phantasia — the psychological significance of lifelong visual imagery vividness extremes, Cortex 130:426–440.' },
    { text: 'A cut-off of 32 or below also circulates in the literature for the same construct.',
      source: 'Reported across the aphantasia-era literature; there is no agreed figure, which is itself the point.' },
    { text: 'The upper tail, around 75 and above, is the range described as hyperphantasia.',
      source: 'Zeman et al. (2020), same study, upper extreme.' },
  ],
});

// ── administration order ─────────────────────────────────────────────────────────────────────────

function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Randomise SCENARIO order; keep items within a scenario in their published order.
 *
 * The scenario is a narrative — the storm follows the clear sky, the assistant follows the door —
 * and shuffling inside it would change what is being asked. Shuffling between scenarios removes the
 * order effect without touching the instrument.
 */
export function buildForm({ seed = 'anon' } = {}) {
  const rand = rng(seedFrom(String(seed)) ^ 0x2545F491);
  const order = [...SCENARIOS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((s, position) => ({
    ...s,
    position,
    items: s.items.map((text, i) => ({ id: `${s.id}.${i + 1}`, text })),
  }));
}

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Score a completed form.
 *
 * `answers` maps item id -> 1..5. `times` maps item id -> milliseconds on that item (optional).
 * A missing or out-of-range answer is left out, and the result says how many items were answered:
 * a 12-item total is not a VVIQ score and must never be printed as if it were.
 */
export function scoreForm(answers = {}, times = {}) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const t = times && typeof times === 'object' ? times : {};
  const perItem = [];
  for (const item of ITEMS) {
    const v = Number(a[item.id]);
    if (!Number.isFinite(v) || v < 1 || v > 5 || v !== Math.round(v)) continue;
    const ms = Number(t[item.id]);
    perItem.push({ id: item.id, scenario: item.scenario, value: v, ms: Number.isFinite(ms) ? ms : null });
  }
  const answered = perItem.length;
  const total = answered ? perItem.reduce((n, x) => n + x.value, 0) : null;

  const byScenario = {};
  for (const s of SCENARIOS) {
    const rows = perItem.filter((x) => x.scenario === s.id);
    byScenario[s.id] = rows.length ? rows.reduce((n, x) => n + x.value, 0) : null;
  }

  // The straight-lining OBSERVATION. Deliberately not a judgement: a person with no voluntary
  // imagery at all legitimately answers 1 to every item, and answers fast, which looks identical to
  // a person clicking through. We report what we saw and let them decide; we never discard the data
  // and never accuse anybody of anything.
  const values = perItem.map((x) => x.value);
  const mss = perItem.map((x) => x.ms).filter((x) => Number.isFinite(x));
  const identical = answered >= ITEM_COUNT && new Set(values).size === 1;
  const medianMs = median(mss);
  const fast = Number.isFinite(medianMs) && medianMs < 1500;

  return {
    exam: EXAM_ID,
    answered,
    itemCount: ITEM_COUNT,
    complete: answered === ITEM_COUNT,
    score: { total, min: MIN_SCORE, max: MAX_SCORE },
    byScenario,
    perItem,
    medianMsPerItem: medianMs,
    allSameAnswer: identical,
    answeredQuickly: fast,
    direction: 'reversed — 1 is no image, 5 is as vivid as seeing, so a LOW total means LOW vividness',
  };
}

/**
 * The result copy. There is no branch in this function that emits a category.
 */
export function resultCopy(result, { n = 0, priorScore = null } = {}) {
  const total = result && result.score ? result.score.total : null;
  if (total == null) {
    return { headline: 'Nothing was answered, so there is nothing to score.', lines: [], landmarks: [], retest: null };
  }
  const lines = [];
  if (!result.complete) {
    lines.push(`You answered ${result.answered} of ${result.itemCount} items, so this total is not on the `
      + `${MIN_SCORE}–${MAX_SCORE} scale the published work uses and cannot be read against the landmarks below. `
      + 'It is kept as what it is: a partial sitting.');
  } else {
    lines.push(`Your VVIQ total was ${total} out of ${MAX_SCORE}, on a scale that runs from ${MIN_SCORE}.`);
  }
  lines.push('The scale here runs the aphantasia-era way round: 1 is no image at all and 5 is as vivid as '
    + 'normal vision, so a LOW total means LOW vividness. Marks’ original ran the other way, and a score '
    + 'quoted in the wrong direction is not a small error — it is the opposite result.');
  lines.push('This is a self-report of a trait, which is not the same thing as the trait. It moves with mood, '
    + 'fatigue and expectation, which is why the second sitting is part of the instrument.');
  lines.push('A visual score cannot tell you about the rest of your imagery. Andrade and colleagues (2014) '
    + 'found the modalities do not collapse into one factor: a person can have no visual imagery and vivid '
    + 'auditory, emotional or bodily imagery, and this questionnaire would never show them that.');
  if (result.allSameAnswer && result.answeredQuickly) {
    lines.push('You gave the same answer to every item, quickly. That is exactly what someone with no voluntary '
      + 'imagery does, and also exactly what someone clicking through does, and this page cannot tell them '
      + 'apart. It is recorded as an observation, not a verdict — if you were clicking through, take it again '
      + 'unhurried and the pair will be more use than either sitting alone.');
  }
  lines.push(referenceClass(n));

  return {
    headline: result.complete ? `VVIQ ${total} of ${MAX_SCORE}` : `${result.answered} of ${result.itemCount} items answered`,
    lines,
    landmarks: [
      { text: LANDMARKS.noConsensus, source: 'Stated first, because every number below is contingent on it.' },
      ...LANDMARKS.entries,
    ],
    retest: retestPair(priorScore, total),
    neverSay: (examById(EXAM_ID) || {}).neverSay || '',
  };
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

export function vviqPageHTML() {
  const exam = examById(EXAM_ID) || {};
  const body = `<h1>${esc(exam.name || 'The mind’s eye')}</h1>
<p class=muted>${esc(exam.measures || '')}</p>

<div class=card>
  <h2 style="margin-top:0">Before you start, the direction of the scale</h2>
  <p><b>1 means no image at all. 5 means as vivid as actually seeing it.</b> So a low total means low
  vividness. Marks’ original questionnaire ran the other way up, and VVIQ-2 reversed it; nearly all
  the aphantasia-era literature uses the reversed direction and so does this page. A score quoted the
  wrong way round is not a small error — it is the opposite result.</p>
  <p class=prov>Sixteen items, four scenes, about five minutes. You are asked once, eyes open, which is
  the usual modern online administration. Marks administered each scene twice — eyes open, then eyes
  closed — so a score from here is not interchangeable with one from that version.</p>
  <p class=prov><b>This result will never be worded as: “${esc(exam.neverSay || '')}”</b> — it is not a
  diagnosis, does not clear you for anything, and buys you nothing here or anywhere.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Your key</h2>
  <p>Your browser made you a random key. We store a one-way hash of it, never the key. It is the only
  thing linking this sitting to your next one — <b>write it down</b>. Without it we cannot delete your
  entries later, because we will have no way to know which ones are yours.</p>
  <p><span class=key id=keyout>…</span></p>
  <p><label class=field>Already have one? <input type=text id=keyin size=32 autocomplete=off placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
     <button class=ghost type=button id=keyset>Use that key</button></p>
</div>

${stateCardHTML({ formId: 'statecard' })}

<div class=card id=runner>
  <h2 style="margin-top:0">The questionnaire</h2>
  <div id=form></div>
  <p><button type=button id=submit>Score it</button> <span class=muted id=progress></span></p>
</div>

<div class=card id=result style="display:none"></div>

<div class=card>
  <h2 style="margin-top:0">What this number is not</h2>
  <ul class=limits>
    <li><b>It is not a diagnosis.</b><span class=muted>It is a self-report of a trait, which is not the
    same thing as the trait. Self-reported vividness moves with mood, fatigue and expectation.</span></li>
    <li><b>There is no agreed cut-off.</b><span class=muted>Different research groups use different
    thresholds for the same construct. We print the landmarks with their sources and no verdict.</span></li>
    <li><b>It says nothing about your other senses.</b><span class=muted>Andrade et al. (2014) found
    imagery modalities do not collapse into a single factor — a person can have no visual imagery and
    vivid auditory, emotional or bodily imagery. The instrument that shows that is the Psi-Q, and we
    have not built it yet. Rather than let a visual number stand in for an inner life, we say so.</span></li>
    <li><b>One sitting is a reading.</b><span class=muted>Come back in a fortnight with the same key.
    The pair is the result.</span></li>
  </ul>
</div>

<div class=card>
  <h2 style="margin-top:0">Where this comes from</h2>
  <ul>${(exam.citations || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  <p class=prov>The sixteen items are Marks (1973), reproduced from the published appendix for free,
  non-commercial research use. VVIQ-2’s thirty-two items are not reproduced here.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">The rules this page is bound by</h2>
  <ul class=limits>${FRAMING.map((f) => `<li><b>${esc(f.rule)}</b><span class=muted>${esc(f.why)}</span></li>`).join('')}</ul>
</div>`;

  const js = `${KEYGEN_JS}
(function(){
  var SCALE=${JSON.stringify(SCALE)};
  var key=teKey(), answers={}, times={}, lastTouch={}, form=[];
  var $=function(id){return document.getElementById(id);};
  $('keyout').textContent=teFormat(key);
  $('keyset').onclick=function(){ var k=teSetKey($('keyin').value); if(k){ key=k; $('keyout').textContent=teFormat(k); } else { alert('That is not a 25-character participant key.'); } };
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  // The FORM ORDER comes from the server: scenarios shuffled, items inside a scenario left in their
  // published sequence, because a scenario is a narrative and reordering it changes the question.
  fetch('/api/exams/vviq/form').then(function(r){return r.json();}).then(function(d){
    form=(d&&d.form)||[];
    var h='', t0=Date.now();
    for(var i=0;i<form.length;i++){
      var s=form[i];
      h+='<fieldset><legend>Scene '+(i+1)+'</legend><p>'+esc(s.stem)+'</p>';
      for(var j=0;j<s.items.length;j++){
        var it=s.items[j];
        h+='<div class=row style="display:block;border-top:1px solid var(--mk-border);padding-top:8px">'
          +'<p style="margin:4px 0"><b>'+esc(it.text)+'</b></p>';
        for(var k=0;k<SCALE.length;k++){
          h+='<label class=opt><input type=radio name="'+esc(it.id)+'" value="'+SCALE[k].value+'"> <span>'
            +SCALE[k].value+' — '+esc(SCALE[k].label)+'</span></label>';
        }
        h+='</div>';
      }
      h+='</fieldset>';
    }
    $('form').innerHTML=h;
    var mark=t0;
    $('form').addEventListener('change',function(e){
      var el=e.target; if(!el||el.type!=='radio') return;
      var now=Date.now();
      // Time on item: from the previous answer to this one. Recorded as a straight-lining
      // OBSERVATION only — a person with no imagery legitimately answers fast, and the result copy
      // says exactly that instead of throwing their data away.
      if(!(el.name in answers)) { times[el.name]=now-mark; mark=now; }
      answers[el.name]=Number(el.value);
      $('progress').textContent=Object.keys(answers).length+' of 16 answered';
    });
  }).catch(function(){ $('form').innerHTML='<p>Could not load the questionnaire.</p>'; });

  function readCard(){
    var f=document.getElementById('statecard'), out={deq5:{},classes:[],practices:[]};
    if(!f) return out;
    var els=f.querySelectorAll('input');
    for(var i=0;i<els.length;i++){
      var el=els[i], n=el.name; if(!n) continue;
      if(el.type==='radio'){ if(el.checked) out[n]=el.value; }
      else if(el.type==='checkbox'){ if(!el.checked) continue;
        if(n==='classes'||n==='practices') out[n].push(el.value); else out[n]=true; }
      else if(n.indexOf('deq5.')===0){ out.deq5[n.slice(5)]=el.value; }
      else if(el.value!=='') out[n]=el.value;
    }
    out.localTime=new Date().toISOString();
    try{ out.tz=Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
    out.tzOffsetMin=new Date().getTimezoneOffset();
    return out;
  }

  $('submit').onclick=function(){
    $('progress').textContent='scoring…';
    fetch('/api/exams/vviq',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:key,stateCard:readCard(),answers:answers,times:times})})
      .then(function(r){return r.json();}).then(function(d){
        var box=$('result'); box.style.display='';
        if(!d.ok){ box.innerHTML='<h2>That did not save.</h2><p>'+esc(d.error||'Nothing was stored.')+'</p>'; $('progress').textContent=''; return; }
        var h='<h2>'+esc(d.copy.headline)+'</h2>';
        h+=d.copy.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        h+='<h3>Landmarks, not verdicts</h3>';
        h+=d.copy.landmarks.map(function(l){return '<p>'+esc(l.text)+'<br><span class=prov>'+esc(l.source)+'</span></p>';}).join('');
        if(d.copy.retest&&d.copy.retest.text) h+='<h3>The second sitting</h3><p>'+esc(d.copy.retest.text)+'</p>';
        // \u2b50 The expectancy covariate (R7). This questionnaire's datum is what you SAY you saw, and
        // Lush et al. (2020) found that the capacity to produce a task-implied experience predicts
        // experiential change on standard laboratory measures. So it is printed here, beside the score,
        // rather than left out.
        if(d.covariate){
          h+='<h3>'+esc(d.covariate.headline||'')+'</h3>';
          h+=(d.covariate.lines||[]).map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
          if(!d.covariate.hasIndex) h+='<p><a href="/exams/suggestibility">Sit the expectancy index</a></p>';
          h+='<p class=prov>'+esc(d.covariate.source||'')+'</p>';
        }
        h+='<p class=prov>Sitting '+d.sessionNumber+'.</p>';
        box.innerHTML=h; box.scrollIntoView({behavior:'smooth'});
        $('progress').textContent='done';
      }).catch(function(){ $('progress').textContent='could not reach the server — nothing was saved.'; });
  };
})();`;

  return examShell(exam.name || 'The mind’s eye', body, { extraJS: js });
}

export default {
  EXAM_ID, SCALE, SCENARIOS, ITEMS, ITEM_COUNT, MIN_SCORE, MAX_SCORE, LANDMARKS,
  buildForm, scoreForm, resultCopy, vviqPageHTML, esc,
};

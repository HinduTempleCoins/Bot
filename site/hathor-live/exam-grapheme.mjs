// site/hathor-live/exam-grapheme.mjs — the grapheme–colour consistency test.
//
// THIS IS THE METHODOLOGICAL EXEMPLAR OF THE WHOLE BATTERY, and it is built first for that reason
// rather than because synaesthesia is the most interesting subject in the corpus.
//
// What makes it the exemplar: its validity criterion IS its own test–retest behaviour. The thing it
// measures is the agreement between administrations. So it needs no external norms, no display
// calibration and no comparison group — the participant is compared to themselves, and the result
// is interpretable on ONE person. Every other exam in this directory copies that shape.
//
// Self-report cannot do this job. Non-synaesthetes readily report letter–colour associations, and
// then fail to reproduce them when asked again without warning. That failure to reproduce is the
// measurement; the report is not.
//
// ── THE PROTOCOL, AND THE DETAILS ARE THE INSTRUMENT ─────────────────────────────────────────────
//
//   1. 36 graphemes: A–Z and 0–9. Shortening the set below ~26 makes the score's variance fall apart.
//   2. THREE presentations of every grapheme, INTERLEAVED IN RANDOM ORDER — 108 trials in one
//      sitting. Blocked presentation lets a person rehearse, which measures memory, not synaesthesia.
//   3. A full continuous colour picker: a 2-D hue/saturation field plus a lightness slider. NOT a
//      swatch palette — a discrete palette destroys the distance metric that the score is made of.
//   4. An explicit "no colour for this one" button, scored separately rather than coerced to grey.
//   5. Score = mean, across graphemes, of the summed pairwise distances between that grapheme's
//      three chosen colours.
//
// ── THE COLOUR SPACE, WHICH HAS A RIGHT ANSWER AND AN HONEST GAP ─────────────────────────────────
//
// Rothen, Seth, Witzel & Ward (2013) compared RGB / HSV / CIELUV / CIELAB and city-block vs
// Euclidean distance specifically to find which maximises sensitivity and specificity. We compute in
// CIELUV and CIELAB, which are perceptually near-uniform, and we ALSO compute the Eagleman-convention
// unit-RGB score — not because RGB is good, but because the only widely-quoted landmark (the
// Synesthesia Battery's < 1.0) was computed that way, and a landmark quoted against a differently
// computed score is a lie.
//
// ⚠ WHAT IS DELIBERATELY MISSING: Rothen et al.'s space-specific thresholds. They are not encoded
// because they have not been read off the paper in this build, and a threshold invented from memory
// is worse than no threshold. THE EXAM DOES NOT NEED ONE: it reports the score and never a verdict.
// Whoever reads the paper puts the number in THRESHOLDS below, with the page reference.
//
// ── WHAT THIS RESULT MAY NEVER BE WORDED AS ──────────────────────────────────────────────────────
//
//   "You have synaesthesia." Not once, not softened, not implied by a badge. Report the score, name
//   the landmark and its provenance, and say that the second sitting is part of the instrument.
//   (.local/TEMPLE_EXAMS_SAFETY_GATE.md §2, inherited.)
//
// Pure and offline. No I/O; the caller injects the store. esc() everything on the way out.

import { esc } from '../../integrations/melek-theme.mjs';
import { seedFrom } from '../../integrations/token-exams.mjs';
import { hexToRgb, rgbToHex, deltaLab, deltaLuv, deltaRgbUnit } from './colour-space.mjs';
import { FRAMING, BROWSER_LIMITS, examShell, referenceClass, retestPair, examById } from './exams.mjs';
import { stateCardHTML } from './state-card.mjs';
import { KEYGEN_JS } from './participant-key.mjs';

export { esc };

export const EXAM_ID = 'grapheme';

/** A–Z then 0–9. Do not shorten this. */
export const GRAPHEMES = Object.freeze([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'0123456789'.split(''),
]);

export const PRESENTATIONS = 3;
export const TRIAL_COUNT = GRAPHEMES.length * PRESENTATIONS; // 108

/**
 * The published landmarks, each with its provenance, and each making a claim about a THRESHOLD in
 * the literature rather than a claim about the reader.
 *
 * `value: null` means "not established in this build" and the page prints it as exactly that. It is
 * not a TODO to be quietly filled with a guess.
 */
export const THRESHOLDS = Object.freeze({
  rgbUnit: {
    value: 1.0,
    space: 'unit-RGB, Euclidean, summed over three pairs',
    source: 'The Synesthesia Battery convention (Eagleman et al. 2007, J Neurosci Methods 159(1):139–145). '
      + 'It is a convention on that battery’s particular normalisation, not a law of nature.',
  },
  luv: {
    value: null,
    space: 'CIELUV',
    source: 'Rothen, Seth, Witzel & Ward (2013), J Neurosci Methods 215(1):156–160 give refined, '
      + 'space-specific cut-offs with reported sensitivity and specificity. They are NOT reproduced here '
      + 'because they have not been read off the paper in this build, and an invented threshold is worse '
      + 'than none. The score below stands on its own; it does not need a cut-off to be meaningful.',
  },
});

// ── trial order ──────────────────────────────────────────────────────────────────────────────────

/** mulberry32, same generator token-exams uses, so a sitting can be re-derived from its seed. */
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
 * 108 trials, three of each grapheme, interleaved at random — with one constraint: the same grapheme
 * never appears twice in a row. Back-to-back repeats let a person copy their last answer, which
 * turns the trial into a memory test and inflates consistency for everyone.
 *
 * Seeded, so the same seed produces the same order and a sitting is reconstructible from its record.
 */
export function buildTrials({ seed = 'anon' } = {}) {
  const rand = rng(seedFrom(String(seed)) ^ 0x5F3759DF);
  const pool = [];
  for (let p = 1; p <= PRESENTATIONS; p += 1) for (const g of GRAPHEMES) pool.push({ grapheme: g, presentation: p });

  // Fisher–Yates, then a local repair pass for adjacent duplicates. Repair rather than reject: a
  // reject-and-retry loop on 108 items is unbounded work for no extra randomness.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // ⚠️ The repair pass used to search only FORWARD from the duplicate, and when it found no partner it
  // silently gave up and left the repeat in place. Measured over 3,000 seeds: 3.73% of sittings — about
  // one in 27 — shipped a back-to-back repeat, with failures clustering near the end of the list where
  // there are fewest forward candidates to swap with (the first was at index 106 of 108).
  //
  // That is not cosmetic. This module's own reason for the constraint is that a back-to-back repeat lets
  // a person copy their last answer, "which turns the trial into a memory test and inflates consistency
  // for everyone" — i.e. it corrupts the very number the exam exists to produce, silently, for 1 in 27
  // takers. It surfaced as an intermittently failing test, which is exactly what a 3.73% defect looks
  // like from the outside.
  //
  // The repair now searches the WHOLE array and checks both sides of both positions, so a swap can never
  // fix one collision by creating another. A valid arrangement is always reachable here: no grapheme
  // appears more than PRESENTATIONS times out of 108, which is far below the ceil(n/2) bound at which
  // non-adjacent rearrangement becomes impossible.
  const clashes = (a, b) => a != null && b != null && a === b;
  for (let i = 1; i < pool.length; i += 1) {
    if (pool[i].grapheme !== pool[i - 1].grapheme) continue;
    for (let k = 1; k < pool.length; k += 1) {
      if (k === i) continue;
      const gi = pool[i].grapheme;
      const gk = pool[k].grapheme;
      if (gk === gi) continue;
      // gk must sit at i without touching an identical neighbour...
      if (clashes(pool[i - 1] && pool[i - 1].grapheme, gk)) continue;
      if (i + 1 !== k && clashes(pool[i + 1] && pool[i + 1].grapheme, gk)) continue;
      // ...and gi must sit at k the same way. The `!== i` guards stop a position from being compared
      // against the very element we are moving out of it.
      if (k - 1 !== i && clashes(pool[k - 1] && pool[k - 1].grapheme, gi)) continue;
      if (k + 1 !== i && clashes(pool[k + 1] && pool[k + 1].grapheme, gi)) continue;
      [pool[i], pool[k]] = [pool[k], pool[i]];
      break;
    }
  }
  return pool.map((t, index) => ({ ...t, index }));
}

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

const PAIRS = [[0, 1], [0, 2], [1, 2]];

function summedPairwise(colours, metric) {
  return PAIRS.reduce((n, [i, j]) => n + metric(colours[i], colours[j]), 0);
}

/**
 * Score a completed sitting.
 *
 * `responses` is an array of { grapheme, presentation, hex | noColour, ms }. Anything malformed is
 * dropped rather than thrown on: losing one trial is a smaller harm than losing the sitting.
 *
 * Returns per-grapheme detail and three whole-sitting means — CIELUV (primary), CIELAB, and
 * unit-RGB (so the published landmark is readable). It returns NO verdict, and there is no code path
 * in this module that produces one.
 */
export function scoreSitting(responses = []) {
  const byGrapheme = new Map();
  let dropped = 0;
  for (const r of Array.isArray(responses) ? responses : []) {
    const g = String((r && r.grapheme) || '').toUpperCase();
    if (!GRAPHEMES.includes(g)) { dropped += 1; continue; }
    if (!byGrapheme.has(g)) byGrapheme.set(g, []);
    if (r.noColour === true) { byGrapheme.get(g).push({ noColour: true, ms: Number(r.ms) || null }); continue; }
    // A malformed colour is dropped, not silently read as black: black is a legitimate answer and
    // must not become the bucket that every parse failure lands in.
    if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String((r && r.hex) || '').trim())) { dropped += 1; continue; }
    const hex = rgbToHex(hexToRgb(r.hex));
    byGrapheme.get(g).push({ hex, rgb: hexToRgb(hex), ms: Number(r.ms) || null });
  }

  const scored = [];
  const noColour = [];
  const partial = [];
  for (const g of GRAPHEMES) {
    const rows = byGrapheme.get(g) || [];
    if (rows.length < PRESENTATIONS) { if (rows.length) partial.push(g); continue; }
    const three = rows.slice(0, PRESENTATIONS);
    const blanks = three.filter((x) => x.noColour).length;
    if (blanks === PRESENTATIONS) { noColour.push(g); continue; }
    if (blanks > 0) { partial.push(g); continue; }
    const rgbs = three.map((x) => x.rgb);
    scored.push({
      grapheme: g,
      hexes: three.map((x) => x.hex),
      luv: summedPairwise(rgbs, deltaLuv),
      lab: summedPairwise(rgbs, deltaLab),
      rgbUnit: summedPairwise(rgbs, deltaRgbUnit),
    });
  }

  const mean = (key) => (scored.length
    ? Math.round((scored.reduce((n, s) => n + s[key], 0) / scored.length) * 1000) / 1000
    : null);

  const byConsistency = [...scored].sort((a, b) => a.luv - b.luv);
  return {
    exam: EXAM_ID,
    graphemesScored: scored.length,
    graphemesTotal: GRAPHEMES.length,
    noColour,
    partial,
    dropped,
    complete: scored.length + noColour.length === GRAPHEMES.length && partial.length === 0,
    score: { luv: mean('luv'), lab: mean('lab'), rgbUnit: mean('rgbUnit') },
    perGrapheme: scored,
    // Named for the person, not for the analysis: "these were the same every time you were asked"
    // is a sentence about their own experience and makes no claim about a category.
    mostConsistent: byConsistency.slice(0, 5).map((s) => ({ grapheme: s.grapheme, luv: Math.round(s.luv * 100) / 100 })),
    leastConsistent: byConsistency.slice(-5).reverse().map((s) => ({ grapheme: s.grapheme, luv: Math.round(s.luv * 100) / 100 })),
  };
}

/**
 * The result copy. This function is the reason there is no verdict anywhere: the page renders what
 * it returns, and it has no branch that produces a category.
 */
export function resultCopy(result, { n = 0, priorScore = null } = {}) {
  const lines = [];
  const s = result && result.score ? result.score : {};
  if (s.rgbUnit == null) {
    return { headline: 'Not enough of the sitting came through to score it.', lines: [], landmarks: [], retest: null };
  }
  lines.push(`Your consistency score was ${s.rgbUnit} on the unit-RGB scale the Synesthesia Battery uses, `
    + `and ${s.luv} in CIELUV, over ${result.graphemesScored} of ${result.graphemesTotal} characters.`);
  lines.push('A LOW score means you picked nearly the same colour each of the three times you were asked. '
    + 'A high score means the colours moved. That is the whole measurement.');
  if (result.noColour.length) {
    lines.push(`You said ${result.noColour.length} ${result.noColour.length === 1 ? 'character has' : 'characters have'} no colour at all `
      + `(${result.noColour.join(', ')}). Those are recorded and left out of the score rather than turned into grey.`);
  }
  if (result.partial.length) {
    lines.push(`${result.partial.length} ${result.partial.length === 1 ? 'character was' : 'characters were'} answered inconsistently `
      + 'between "a colour" and "no colour", so they could not be scored. That is a real answer too, and it is kept.');
  }
  lines.push(referenceClass(n));

  const landmarks = [
    { text: `Scores below ${THRESHOLDS.rgbUnit.value} on the unit-RGB scale are the conventional threshold in the Synesthesia Battery.`,
      source: THRESHOLDS.rgbUnit.source },
    { text: 'We do not publish a CIELUV cut-off.', source: THRESHOLDS.luv.source },
  ];

  return {
    headline: `Consistency ${s.rgbUnit} (unit-RGB) · ${s.luv} (CIELUV)`,
    lines,
    landmarks,
    retest: retestPair(priorScore, s.rgbUnit),
    neverSay: (examById(EXAM_ID) || {}).neverSay || '',
  };
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

const PICKER_JS = `
// A CONTINUOUS picker: a hue/saturation field plus a lightness slider. Not a swatch palette —
// a discrete palette would quantise the very distances the score is made of.
function hsl2rgb(h,s,l){
  h=((h%360)+360)%360; s=Math.max(0,Math.min(1,s)); l=Math.max(0,Math.min(1,l));
  var c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2, r=0,g=0,b=0;
  if(h<60){r=c;g=x;} else if(h<120){r=x;g=c;} else if(h<180){g=c;b=x;}
  else if(h<240){g=x;b=c;} else if(h<300){r=x;b=c;} else {r=c;b=x;}
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
function hex(rgb){ return '#'+rgb.map(function(n){return ('0'+n.toString(16)).slice(-2);}).join(''); }
`;

export function graphemePageHTML() {
  const exam = examById(EXAM_ID) || {};
  const body = `<h1>${esc(exam.name || 'Letters and colours')}</h1>
<p class=muted>${esc(exam.measures || '')}</p>

<div class=card>
  <h2 style="margin-top:0">What this is, and what it is not</h2>
  <p>You will see each letter and digit <b>three times, in a shuffled order</b>, and pick a colour for
  it each time. You are not being asked to remember what you picked before — you are being asked
  again, and the measurement is how close the three answers land.</p>
  <p>That is why the test works on <b>one person</b>. There is no group to compare you to and none is
  needed: the thing being measured is the agreement between your own answers.</p>
  <p class=prov><b>This result will never be worded as: “${esc(exam.neverSay || '')}”</b> — and it is not
  a diagnosis, does not clear you for anything, and buys you nothing here or anywhere.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Your key</h2>
  <p>Your browser has made you a random key. It is the only thing linking this sitting to your next
  one, and we store a one-way hash of it, never the key itself. <b>Write it down</b> — with it you can
  come back in a fortnight and see the pair, and you can delete everything. Without it we cannot,
  because we will have no way to know which entries were yours.</p>
  <p><span class=key id=keyout>…</span></p>
  <p><label class=field>Already have one? <input type=text id=keyin size=32 autocomplete=off placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
     <button class=ghost type=button id=keyset>Use that key</button></p>
</div>

${stateCardHTML({ formId: 'statecard' })}

<div class=card id=runner>
  <h2 style="margin-top:0">The test</h2>
  <p class=muted id=progress>${esc(String(TRIAL_COUNT))} trials, about 12–18 minutes. You can stop at any point; a partial sitting is scored on what you finished and says so.</p>
  <div id=stage style="display:none">
    <div id=glyph style="font-size:96px;font-weight:700;text-align:center;padding:18px;background:#808080;color:#fff;border-radius:12px;margin:12px 0">A</div>
    <canvas id=field width=300 height=180 style="width:100%;max-width:420px;border-radius:10px;border:1px solid var(--mk-border);touch-action:none;cursor:crosshair"></canvas>
    <div class=vas><label for=light>Lightness</label><input type=range id=light min=2 max=98 value=50></div>
    <p><span id=swatch style="display:inline-block;width:52px;height:28px;border-radius:6px;border:1px solid var(--mk-border);vertical-align:middle"></span>
       <span class=muted id=swatchhex style="margin-left:8px">pick a colour</span></p>
    <p><button type=button id=accept>That one</button>
       <button class=ghost type=button id=none>No colour for this one</button></p>
  </div>
  <p><button type=button id=start>Start</button>
     <button class=ghost type=button id=finish disabled>Finish and score what I did</button></p>
</div>

<div class=card id=result style="display:none"></div>

<div class=card>
  <h2 style="margin-top:0">What this page cannot do</h2>
  <ul class=limits>${BROWSER_LIMITS.slice(0, 3).map((l) => `<li><b>${esc(l.limit)}</b><span class=muted>${esc(l.detail)}</span></li>`).join('')}
  <li><b>Your three answers all pass through the same wrong screen.</b><span class=muted>Which is exactly
  why this exam survives an uncalibrated display: the score is a distance <i>within</i> one sitting on
  one monitor, so whatever your panel does to a colour, it does to all three of them. What it does
  <i>not</i> license is comparing the actual hues you picked with somebody else's.</span></li></ul>
</div>

<div class=card>
  <h2 style="margin-top:0">Where the method comes from</h2>
  <ul>${(exam.citations || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  <p class=prov>${esc(THRESHOLDS.luv.source)}</p>
</div>

<div class=card>
  <h2 style="margin-top:0">The rules this page is bound by</h2>
  <ul class=limits>${FRAMING.map((f) => `<li><b>${esc(f.rule)}</b><span class=muted>${esc(f.why)}</span></li>`).join('')}</ul>
</div>`;

  const js = `${KEYGEN_JS}${PICKER_JS}
(function(){
  var GRAPHEMES=${JSON.stringify(GRAPHEMES)}, TOTAL=${TRIAL_COUNT};
  var key=teKey(), trials=[], responses=[], ix=0, cur={h:0,s:1,l:0.5}, picked=false, t0=0;
  var $=function(id){return document.getElementById(id);};
  $('keyout').textContent=teFormat(key);
  $('keyset').onclick=function(){ var k=teSetKey($('keyin').value); if(k){ key=k; $('keyout').textContent=teFormat(k); } else { alert('That is not a 25-character participant key.'); } };

  var fld=$('field'), ctx=fld.getContext('2d');
  function paintField(){
    var w=fld.width,h=fld.height,img=ctx.createImageData(w,h),d=img.data;
    for(var y=0;y<h;y++) for(var x=0;x<w;x++){
      var rgb=hsl2rgb(x/w*360, 1-y/h, cur.l), o=(y*w+x)*4;
      d[o]=rgb[0];d[o+1]=rgb[1];d[o+2]=rgb[2];d[o+3]=255;
    }
    ctx.putImageData(img,0,0);
  }
  function showSwatch(){
    var rgb=hsl2rgb(cur.h,cur.s,cur.l), hx=hex(rgb);
    $('swatch').style.background=hx; $('swatchhex').textContent=picked?hx:'pick a colour';
  }
  function pick(e){
    var r=fld.getBoundingClientRect();
    var pt=(e.touches&&e.touches[0])||e;
    cur.h=Math.max(0,Math.min(1,(pt.clientX-r.left)/r.width))*360;
    cur.s=1-Math.max(0,Math.min(1,(pt.clientY-r.top)/r.height));
    picked=true; showSwatch();
  }
  fld.addEventListener('pointerdown',function(e){ fld.setPointerCapture(e.pointerId); pick(e); });
  fld.addEventListener('pointermove',function(e){ if(e.buttons) pick(e); });
  $('light').oninput=function(){ cur.l=this.value/100; paintField(); showSwatch(); };

  function render(){
    if(ix>=trials.length){ submit(); return; }
    $('glyph').textContent=trials[ix].grapheme;
    picked=false; showSwatch();
    $('progress').textContent='trial '+(ix+1)+' of '+trials.length;
    t0=Date.now();
  }
  function answer(noColour){
    if(!noColour && !picked){ alert('Pick a colour, or say it has none.'); return; }
    var rgb=hsl2rgb(cur.h,cur.s,cur.l);
    responses.push({grapheme:trials[ix].grapheme,presentation:trials[ix].presentation,
      hex:noColour?null:hex(rgb),noColour:!!noColour,ms:Date.now()-t0});
    ix++; render();
  }
  $('accept').onclick=function(){ answer(false); };
  $('none').onclick=function(){ answer(true); };
  // The trial ORDER comes from the server, so there is exactly one implementation of the
  // interleaving rule (three of each grapheme, shuffled, never the same character twice in a row)
  // and it is the one the tests cover. A client-side copy would drift.
  $('start').onclick=function(){
    var btn=this; btn.disabled=true; $('progress').textContent='shuffling…';
    fetch('/api/exams/grapheme/trials').then(function(r){return r.json();}).then(function(d){
      trials=(d&&d.trials)||[]; ix=0; responses=[];
      if(!trials.length){ $('progress').textContent='could not reach the server.'; btn.disabled=false; return; }
      $('stage').style.display=''; $('finish').disabled=false;
      paintField(); render();
    }).catch(function(){ $('progress').textContent='could not reach the server.'; btn.disabled=false; });
  };
  $('finish').onclick=function(){ submit(); };

  function readCard(){
    var form=document.getElementById('statecard'), out={deq5:{},classes:[],practices:[]};
    if(!form) return out;
    var els=form.querySelectorAll('input');
    for(var i=0;i<els.length;i++){
      var el=els[i], n=el.name;
      if(!n) continue;
      if(el.type==='radio'){ if(el.checked) out[n]=el.value; }
      else if(el.type==='checkbox'){
        if(!el.checked) continue;
        if(n==='classes'||n==='practices') out[n].push(el.value); else out[n]=true;
      }
      else if(n.indexOf('deq5.')===0){ out.deq5[n.slice(5)]=el.value; }
      else if(el.value!=='') out[n]=el.value;
    }
    out.localTime=new Date().toISOString();
    try{ out.tz=Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
    out.tzOffsetMin=new Date().getTimezoneOffset();
    return out;
  }

  function submit(){
    $('stage').style.display='none'; $('finish').disabled=true;
    $('progress').textContent='scoring…';
    fetch('/api/exams/grapheme',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:key,stateCard:readCard(),responses:responses})})
      .then(function(r){return r.json();})
      .then(function(d){
        var box=$('result'); box.style.display='';
        if(!d.ok){ box.innerHTML='<h2>That did not save.</h2><p>'+esc(d.error||'Nothing was stored.')+'</p>'; return; }
        var h='<h2>'+esc(d.copy.headline)+'</h2>';
        h+=d.copy.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        h+='<h3>Landmarks, not verdicts</h3>';
        h+=d.copy.landmarks.map(function(l){return '<p>'+esc(l.text)+'<br><span class=prov>'+esc(l.source)+'</span></p>';}).join('');
        if(d.copy.retest&&d.copy.retest.text) h+='<h3>The second sitting</h3><p>'+esc(d.copy.retest.text)+'</p>';
        if(d.result.mostConsistent&&d.result.mostConsistent.length){
          h+='<h3>Steadiest, and least steady</h3><p>Same every time: '+d.result.mostConsistent.map(function(x){return esc(x.grapheme);}).join(', ')
            +'.<br>Moved the most: '+d.result.leastConsistent.map(function(x){return esc(x.grapheme);}).join(', ')+'.</p>';
        }
        h+='<p class=prov>Sitting '+d.sessionNumber+'. Come back in a fortnight with the same key — the second administration is part of the instrument, and the pair is the result.</p>';
        box.innerHTML=h;
        box.scrollIntoView({behavior:'smooth'});
        $('progress').textContent='done';
      })
      .catch(function(){ $('progress').textContent='could not reach the server — nothing was saved.'; });
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
})();`;

  return examShell(exam.name || 'Letters and colours', body, { extraJS: js });
}

export default {
  EXAM_ID, GRAPHEMES, PRESENTATIONS, TRIAL_COUNT, THRESHOLDS,
  buildTrials, scoreSitting, resultCopy, graphemePageHTML, esc,
};

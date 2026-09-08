// site/hathor-live/exam-colour-naming.mjs — free colour naming. Your own colour lexicon.
//
// ── WHY THIS ONE, AND NOT UNIQUE HUE SETTINGS ────────────────────────────────────────────────────
//
// The colour research ranked E1 (unique hue settings) and E9 (free naming) as the two to build
// first. E9 is the one that is HONEST IN A BROWSER, and it is not close:
//
//   * E1 needs the display-and-environment harness (E0) as a prerequisite, needs binary-hue
//     settings (E2) shipped alongside it or it is uninterpretable, and survives only as a RELATIVE,
//     repeated-measures instrument. Its own entry says: never print a nanometre figure from a
//     browser setting, because converting a screen colour to a wavelength needs the display's
//     primaries and we do not have them.
//   * E9 asks about the mapping from APPEARANCE to WORD — and both sides of that mapping are
//     sampled inside one observer, on one screen, in one sitting. Whatever the panel does to a
//     colour, it does to the colour the person is naming and to the word they attach to it. The
//     limits section puts naming under "survives usefully"; unique hues survive only "as relative
//     measurements". This exam is NATIVE to the medium: the xkcd colour survey collected on the
//     order of 3.4 million responses this way, on uncalibrated consumer monitors, at a scale no
//     laboratory will reach.
//
// ── THE RULE THAT MATTERS MOST HERE ──────────────────────────────────────────────────────────────
//
//   RECORD VERBATIM. DO NOT NORMALISE AT COLLECTION TIME. The non-basic terms are the interesting
//   part — Lindsey & Brown's 51 informants produced 122 monolexemic terms — and a tidy-up on the way
//   in destroys exactly the data the exam exists to gather. We fold case and whitespace ONLY for the
//   summary, and the raw string is what goes to the store.
//
// ── AND WHAT THIS RESULT IS NEVER ABOUT ──────────────────────────────────────────────────────────
//
//   YOUR EYES. Naming is the most language-loaded measure in the whole battery. It is a trait, but a
//   cultural and linguistic one, not a retinal one, and it must never be reported back as a fact
//   about a person's vision. That is this exam's `neverSay`, and it is broader than the other two.
//
// Sampling is done in Oklch rather than HSL, because an HSL sweep clusters swatches in the yellows
// and starves the blues — HSL "hue" is an sRGB-cube hack whose lightness swings around the circle.
// And chroma is drawn as a FRACTION of what the display can actually reach at that lightness and
// hue, so nothing ever needs clipping: clipping is a systematic compression toward the gamut edge
// that moves hue as well as chroma, and a clipped swatch is not the colour the sampler asked about.
//
// Pure and offline. No I/O. esc() everything.

import { esc } from '../../integrations/melek-theme.mjs';
import { seedFrom } from '../../integrations/token-exams.mjs';
import { rgbToHex, hexToRgb, oklchToRgb, rgbToOklch, deltaOklab } from './colour-space.mjs';
import { FRAMING, examShell, referenceClass, examById } from './exams.mjs';
import { stateCardHTML } from './state-card.mjs';
import { KEYGEN_JS } from './participant-key.mjs';

export { esc };

export const EXAM_ID = 'colour-naming';

/** The default block. Long enough to be a lexicon, short enough to finish in about four minutes. */
export const DEFAULT_SWATCHES = 40;
export const MAX_SWATCHES = 200;
export const MAX_TERM_LENGTH = 60;

/**
 * Berlin & Kay's eleven basic colour terms, in English.
 *
 * Present ONLY to compute the share of a person's own answers that fell outside them. It is not a
 * scoring key and there are no right answers here — "cerulean" and "blue" are both correct, and the
 * interesting thing is which one a given person reaches for.
 *
 * Berlin, B. & Kay, P. (1969), Basic Color Terms: Their Universality and Evolution.
 */
export const BASIC_TERMS = Object.freeze([
  'black', 'white', 'red', 'green', 'yellow', 'blue', 'brown', 'purple', 'pink', 'orange', 'grey',
]);
const BASIC_SET = new Set([...BASIC_TERMS, 'gray']); // the spelling split is orthographic, not lexical

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
 * The largest chroma this display can actually show at a given lightness and hue, found by bisection
 * on the sRGB gamut boundary.
 *
 * This exists so the sampler never has to clip. Clipping is not noise — it is a systematic
 * compression toward the gamut edge that moves hue as well as chroma, and it moves it differently in
 * different directions, so a clipped sample is not the colour the sampler asked about.
 */
export function maxChroma(L, H) {
  let lo = 0;
  let hi = 0.45;                              // past any sRGB chroma at any lightness
  if (oklchToRgb({ L, C: hi, H }).inGamut) return hi;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (oklchToRgb({ L, C: mid, H }).inGamut) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * A block of swatches, sampled across the hue circle and over a range of lightness and chroma.
 *
 * Hue is STRATIFIED — the circle is divided into `count` equal arcs and one sample is jittered
 * inside each — rather than drawn uniformly at random, because an unstratified draw of 40 leaves
 * visible holes in the circle and a person cannot name a colour they were never shown.
 *
 * Chroma is drawn as a FRACTION of what the display can reach at that lightness and hue, so the
 * sample is even across the gamut that actually exists rather than piling up against its edge.
 */
export function buildSwatches({ seed = 'anon', count = DEFAULT_SWATCHES } = {}) {
  const n = Math.max(1, Math.min(Number(count) || DEFAULT_SWATCHES, MAX_SWATCHES));
  const rand = rng(seedFrom(String(seed)) ^ 0x85EBCA6B);
  const arc = 360 / n;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const H = (i * arc + rand() * arc) % 360;
    const L = 0.32 + rand() * 0.58;           // near-black and near-white are named trivially
    const frac = 0.08 + rand() * 0.92;        // includes the near-greys, where the terms multiply
    const C = maxChroma(L, H) * frac;
    const { rgb, inGamut } = oklchToRgb({ L, C, H });
    out.push({
      i,
      hex: rgbToHex(rgb),
      oklch: { L: Math.round(L * 1e4) / 1e4, C: Math.round(C * 1e4) / 1e4, H: Math.round(H * 10) / 10 },
      // Recorded as a covariate. It should always be true — if it is ever false the sampler has a
      // bug, and the analysis should be able to see that rather than trust a comment.
      inGamut,
      chromaFraction: Math.round(frac * 1e3) / 1e3,
    });
  }
  // Shuffle so the presentation order is not a march around the hue circle, which would let each
  // answer prime the next one.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((s, order) => ({ ...s, order }));
}

// ── summary ──────────────────────────────────────────────────────────────────────────────────────

const tidy = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
/** Fold case and whitespace FOR ANALYSIS ONLY. The verbatim string is what gets stored. */
const fold = (s) => tidy(s).toLowerCase();

/**
 * Summarise one person's naming block.
 *
 * There is no score. The readout is a description of their own lexicon: how many distinct words they
 * used, which ones, how much colour space each word covered, and how much of their vocabulary fell
 * outside the eleven basic English terms. All of it is within-person and needs no comparison group.
 */
export function summariseNaming(responses = []) {
  const rows = [];
  for (const r of Array.isArray(responses) ? responses : []) {
    const verbatim = tidy(r && r.name).slice(0, MAX_TERM_LENGTH);
    if (!verbatim) continue;
    if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String((r && r.hex) || '').trim())) continue;
    const rgb = hexToRgb(r.hex);
    rows.push({
      hex: rgbToHex(rgb),
      rgb,
      oklch: rgbToOklch(rgb),
      // VERBATIM. Stored as typed; `folded` exists for the summary and never replaces it.
      name: verbatim,
      folded: fold(verbatim),
      ms: Number.isFinite(Number(r && r.ms)) ? Number(r.ms) : null,
    });
  }

  const byTerm = new Map();
  for (const row of rows) {
    if (!byTerm.has(row.folded)) byTerm.set(row.folded, []);
    byTerm.get(row.folded).push(row);
  }

  const terms = [...byTerm.entries()].map(([folded, uses]) => {
    const mean = uses.reduce((acc, u) => ({
      L: acc.L + u.oklch.L / uses.length,
      C: acc.C + u.oklch.C / uses.length,
      // Hue is circular: a plain mean of 350° and 10° is 180°, which is the opposite colour.
      x: acc.x + Math.cos((u.oklch.H * Math.PI) / 180) / uses.length,
      y: acc.y + Math.sin((u.oklch.H * Math.PI) / 180) / uses.length,
    }), { L: 0, C: 0, x: 0, y: 0 });
    const H = ((Math.atan2(mean.y, mean.x) * 180) / Math.PI + 360) % 360;
    // How wide a patch of colour space one word covered, in Oklab units, as the mean distance
    // between every pair of swatches the person gave that word to.
    let spread = 0;
    let pairs = 0;
    for (let i = 0; i < uses.length; i += 1) {
      for (let j = i + 1; j < uses.length; j += 1) { spread += deltaOklab(uses[i].rgb, uses[j].rgb); pairs += 1; }
    }
    return {
      term: uses[0].name,                     // the first VERBATIM spelling, not the folded key
      spellings: [...new Set(uses.map((u) => u.name))],
      n: uses.length,
      basic: BASIC_SET.has(folded),
      meanOklch: { L: Math.round(mean.L * 1e3) / 1e3, C: Math.round(mean.C * 1e3) / 1e3, H: Math.round(H * 10) / 10 },
      hexes: uses.map((u) => u.hex),
      spread: pairs ? Math.round((spread / pairs) * 1e3) / 1e3 : null,
    };
  }).sort((a, b) => b.n - a.n || a.term.localeCompare(b.term));

  const nonBasic = terms.filter((t) => !t.basic);
  const mss = rows.map((r) => r.ms).filter((m) => Number.isFinite(m));

  return {
    exam: EXAM_ID,
    answered: rows.length,
    distinctTerms: terms.length,
    terms,
    basicTermCount: terms.length - nonBasic.length,
    nonBasicTerms: nonBasic.map((t) => t.term),
    // Share of ANSWERS, not of terms — a person who says "blue" thirty times and "chartreuse" once
    // has a different lexicon from one who splits them evenly, and the term count hides that.
    nonBasicShare: rows.length ? Math.round((rows.filter((r) => !BASIC_SET.has(r.folded)).length / rows.length) * 100) / 100 : null,
    widestTerm: terms.length ? terms.slice().sort((a, b) => (b.spread || 0) - (a.spread || 0))[0].term : null,
    medianMs: mss.length ? mss.slice().sort((a, b) => a - b)[Math.floor(mss.length / 2)] : null,
    rows,
  };
}

export function resultCopy(summary, { n = 0 } = {}) {
  if (!summary || !summary.answered) {
    return { headline: 'Nothing was named, so there is nothing to describe.', lines: [], terms: [], neverSay: '' };
  }
  const lines = [];
  lines.push(`You named ${summary.answered} ${summary.answered === 1 ? 'colour' : 'colours'} and used `
    + `${summary.distinctTerms} different ${summary.distinctTerms === 1 ? 'word' : 'words'} to do it.`);
  if (summary.nonBasicTerms.length) {
    lines.push(`${summary.nonBasicTerms.length} of those words fall outside the eleven basic English colour terms: `
      + `${summary.nonBasicTerms.slice(0, 12).join(', ')}. Those are the interesting ones — they are what a `
      + 'personal colour lexicon is made of, and they are the reason your answers were kept exactly as you typed them.');
  } else {
    lines.push('Every word you used was one of the eleven basic English colour terms. That is a real result and '
      + 'not a smaller one: where a person draws the line between "blue" and "purple" is a measurement in itself.');
  }
  if (summary.widestTerm) {
    lines.push(`The word you stretched furthest was "${summary.widestTerm}" — it covered more of colour space than `
      + 'any of your others. Nobody else has to agree with where you put it.');
  }
  lines.push('THIS SAYS NOTHING ABOUT YOUR EYES. Naming is the most language-loaded thing in this battery: it is a '
    + 'trait, but a cultural and linguistic one, not a retinal one. Two people with identical colour vision and '
    + 'different vocabularies produce different results here, and that is the phenomenon, not an error.');
  lines.push('It also reflects communicative need, not only perceptual structure — a language grows the words its '
    + 'speakers have to distinguish between (Zaslavsky et al. 2019).');
  lines.push(referenceClass(n));
  return {
    headline: `${summary.distinctTerms} words for ${summary.answered} colours`,
    lines,
    terms: summary.terms.slice(0, 20),
    neverSay: (examById(EXAM_ID) || {}).neverSay || '',
  };
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

export function colourNamingPageHTML() {
  const exam = examById(EXAM_ID) || {};
  const body = `<h1>${esc(exam.name || 'What you call a colour')}</h1>
<p class=muted>${esc(exam.measures || '')}</p>

<div class=card>
  <h2 style="margin-top:0">There are no right answers here</h2>
  <p>We show you a colour. You type what you call it. One word or several, whatever you would
  actually say — “blue”, “teal”, “that green my aunt’s kitchen was”. <b>We keep exactly what you
  type.</b> Nothing is corrected, nothing is snapped to a list of approved colour words, and the
  unusual answers are the point rather than the noise.</p>
  <p class=prov>${esc(String(DEFAULT_SWATCHES))} colours, about four minutes. You can keep going for as long as
  you like — people do — and you can stop whenever you want.</p>
  <p class=prov><b>This result will never be worded as: “${esc(exam.neverSay || '')}”</b> — naming is a
  cultural and linguistic trait, not a retinal one, and this page is not a vision test.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Your key</h2>
  <p>Your browser made you a random key; we store a one-way hash of it and never the key. Write it
  down if you want to come back or delete this later.</p>
  <p><span class=key id=keyout>…</span></p>
  <p><label class=field>Already have one? <input type=text id=keyin size=32 autocomplete=off placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
     <button class=ghost type=button id=keyset>Use that key</button></p>
</div>

<div class=card>
  <h2 style="margin-top:0">Which language are you naming in?</h2>
  <p class=muted>This changes what the answers mean and nothing else. It is not required.</p>
  <label class=field>Language you are naming in <input type=text id=lang maxlength=40 autocomplete=off placeholder="English"></label>
  <label class=field>Other languages you speak <input type=text id=langs maxlength=120 autocomplete=off placeholder="optional"></label>
</div>

${stateCardHTML({ formId: 'statecard' })}

<div class=card id=runner>
  <h2 style="margin-top:0">The colours</h2>
  <div id=stage style="display:none">
    <div id=swatch style="height:180px;border-radius:12px;border:1px solid var(--mk-border);margin:10px 0"></div>
    <label class=field style="display:block">What do you call this colour?
      <input type=text id=name style="width:100%;margin-top:6px" autocomplete=off autocapitalize=off spellcheck=false></label>
    <p><button type=button id=next>Next</button>
       <button class=ghost type=button id=skip>I have no word for this one</button>
       <span class=muted id=progress></span></p>
  </div>
  <p><button type=button id=start>Start</button>
     <button class=ghost type=button id=more disabled>Another block of ${esc(String(DEFAULT_SWATCHES))}</button>
     <button class=ghost type=button id=finish disabled>Finish</button></p>
</div>

<div class=card id=result style="display:none"></div>

<div class=card>
  <h2 style="margin-top:0">What this page can and cannot do</h2>
  <ul class=limits>
    <li><b>It can do this one honestly.</b><span class=muted>The question is about the mapping from
    appearance to word, and both sides of that mapping are sampled inside one observer on one screen.
    Whatever your display does to a colour, it does to the colour you are naming — so the errors that
    wreck most online colour tests largely cancel here. This exam is native to the medium: the xkcd
    colour survey collected roughly 3.4 million responses this way on uncalibrated monitors.</span></li>
    <li><b>It cannot guarantee two people saw the same colour.</b><span class=muted>They did not, quite.
    Pooling answers across people needs the display’s gamut class as a covariate, and comparing them
    directly needs matched hardware.</span></li>
    <li><b>It is not a vision test and cannot become one.</b><span class=muted>A colour-vision
    deficiency is diagnosed with plates and an anomaloscope by a clinician, not by a text box.</span></li>
  </ul>
</div>

<div class=card>
  <h2 style="margin-top:0">Where this comes from</h2>
  <ul>${(exam.citations || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</div>

<div class=card>
  <h2 style="margin-top:0">The rules this page is bound by</h2>
  <ul class=limits>${FRAMING.map((f) => `<li><b>${esc(f.rule)}</b><span class=muted>${esc(f.why)}</span></li>`).join('')}</ul>
</div>`;

  const js = `${KEYGEN_JS}
(function(){
  var key=teKey(), swatches=[], ix=0, responses=[], t0=0;
  var $=function(id){return document.getElementById(id);};
  $('keyout').textContent=teFormat(key);
  $('keyset').onclick=function(){ var k=teSetKey($('keyin').value); if(k){ key=k; $('keyout').textContent=teFormat(k); } else { alert('That is not a 25-character participant key.'); } };
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  // The panel's gamut class, recorded as a MEASUREMENT covariate. Never used to identify anybody,
  // and never pooled across classes without it.
  function display(){
    var g='unknown';
    try{
      if(window.matchMedia('(color-gamut: rec2020)').matches) g='rec2020';
      else if(window.matchMedia('(color-gamut: p3)').matches) g='p3';
      else if(window.matchMedia('(color-gamut: srgb)').matches) g='srgb';
    }catch(e){}
    var scheme='unknown';
    try{ scheme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'; }catch(e){}
    return {gamut:g, scheme:scheme, dpr:window.devicePixelRatio||1,
      width:(window.screen&&window.screen.width)||null, height:(window.screen&&window.screen.height)||null};
  }

  function show(){
    if(ix>=swatches.length){ $('more').disabled=false; $('progress').textContent='block finished — another block, or finish?'; $('stage').style.display='none'; return; }
    $('swatch').style.background=swatches[ix].hex;
    $('name').value=''; $('name').focus();
    $('progress').textContent=(ix+1)+' of '+swatches.length+' in this block · '+responses.length+' named so far';
    t0=Date.now();
  }
  function answer(skip){
    var v=skip?'':$('name').value;
    if(!skip && !v.trim()){ $('name').focus(); return; }
    if(!skip) responses.push({hex:swatches[ix].hex, name:v, ms:Date.now()-t0, order:swatches[ix].order});
    ix++; show();
  }
  $('next').onclick=function(){ answer(false); };
  $('skip').onclick=function(){ answer(true); };
  $('name').addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); answer(false); } });

  function block(){
    $('progress').textContent='loading…';
    return fetch('/api/exams/colour-naming/swatches').then(function(r){return r.json();}).then(function(d){
      swatches=(d&&d.swatches)||[]; ix=0;
      if(!swatches.length){ $('progress').textContent='could not reach the server.'; return; }
      $('stage').style.display=''; $('finish').disabled=false; $('more').disabled=true;
      show();
    }).catch(function(){ $('progress').textContent='could not reach the server.'; });
  }
  $('start').onclick=function(){ this.disabled=true; block(); };
  $('more').onclick=function(){ block(); };

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

  $('finish').onclick=function(){
    $('progress').textContent='summarising…';
    fetch('/api/exams/colour-naming',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:key, stateCard:readCard(), responses:responses,
        language:$('lang').value, languages:$('langs').value, display:display()})})
      .then(function(r){return r.json();}).then(function(d){
        var box=$('result'); box.style.display='';
        if(!d.ok){ box.innerHTML='<h2>That did not save.</h2><p>'+esc(d.error||'Nothing was stored.')+'</p>'; return; }
        var h='<h2>'+esc(d.copy.headline)+'</h2>';
        h+=d.copy.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        if(d.copy.terms&&d.copy.terms.length){
          h+='<h3>Your words</h3><table><tr><th>word</th><th>times</th><th>the colours you gave it</th></tr>';
          h+=d.copy.terms.map(function(t){
            var chips=t.hexes.slice(0,10).map(function(x){
              return '<span style="display:inline-block;width:16px;height:16px;border-radius:3px;border:1px solid var(--mk-border);background:'+esc(x)+'"></span>';
            }).join(' ');
            return '<tr><td>'+esc(t.term)+(t.basic?'':' <span class=prov>(not a basic term)</span>')+'</td><td>'+t.n+'</td><td>'+chips+'</td></tr>';
          }).join('');
          h+='</table>';
        }
        h+='<p class=prov>Sitting '+d.sessionNumber+'. Your answers were stored exactly as you typed them.</p>';
        box.innerHTML=h; box.scrollIntoView({behavior:'smooth'});
        $('progress').textContent='done';
      }).catch(function(){ $('progress').textContent='could not reach the server — nothing was saved.'; });
  };
})();`;

  return examShell(exam.name || 'What you call a colour', body, { extraJS: js });
}

export default {
  EXAM_ID, DEFAULT_SWATCHES, MAX_SWATCHES, BASIC_TERMS,
  buildSwatches, summariseNaming, resultCopy, colourNamingPageHTML, esc,
};

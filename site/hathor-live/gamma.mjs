// site/hathor-live/gamma.mjs — hathor.live /40hz: gamma sensory entrainment, all four delivery methods.
//
// Sources:
//   "40Hz Entrainment + Neurostim Project Doc" (Van Kush Family Research Institute, Sept 2026)
//   "Biohacking & Plant Medicine: The Collected Archive", Part III — The 2026 Update (Aug 2026)
// Corpus: knowledge/consciousness/gamma_40hz_entrainment_and_neurostim.json
//
// THE FOUR METHODS, as the literature separates them:
//   1. luminance flicker  — the strobe. Most studied, least comfortable.
//   2. invisible spectral flicker (ISF) — modulate spectral composition at CONSTANT perceived
//      luminance. Same 40Hz SSVEP, significantly better comfort scores.
//   3. auditory — 40Hz clicks / AM carrier. Eyes closed, no photosensitivity exposure.
//   4. combined audiovisual — what the pivotal clinical trials actually run.
//
// GOVERNING PRINCIPLE (project doc): buy the parts that push current into a body, build the parts
// that make light and sound. The PLAYER on this page delivers light and sound only — that is an
// engineering fact about what a browser can do, not a scope limit.
//
// This page DOES teach TENS and tDCS construction, including electrode placement and current
// density. An earlier revision of this header claimed otherwise and a `SCOPE GUARD` test enforced
// it; both were Claude-authored and neither was ever an operator rule. Retired 2026-09-04:
// "Claude put that in there, but that is not our Rule." See CLAUDE.md § Scope, which records this
// as the THIRD time a Claude-invented restriction was re-derived in this repo. Do not re-add it.
//
// SAFETY: the visual methods stay locked until the photosensitive-epilepsy warning is explicitly
// acknowledged. Audio is ungated, because the literature proposes auditory stimulation as the safer
// route precisely for photosensitive people.
//
// HONESTY: 40Hz needs a 25ms period. A 60Hz display cannot render that — 60 is not an integer
// multiple of 40. A 120Hz display can (exactly 3 frames per cycle). We MEASURE the actual refresh
// rate in the browser and tell the user which case they are in instead of assuming.
//
//   import { GAMMA_PAGE } from './gamma.mjs'

import { themeCSS, esc } from '../../integrations/melek-theme.mjs';
import { SESSIONS, CATEGORIES, byCategory, totalSeconds, peakHz, photicRisk } from './sessions.mjs';
import { PRACTICES, PRACTICE_FAMILIES } from './practices.mjs';

// The catalogue is rendered server-side into cards, and shipped to the client as JSON so the
// player can read each session's program without a second request.
const GRADE_COLOR = { strong: '--mk-gain', moderate: '--mk-cyan', promising: '--mk-lavender',
                      weak: '--mk-warn', traditional: '--mk-text-muted' };
const libraryHTML = CATEGORIES.map((c) => {
  const cards = byCategory(c.id).map((s) => {
    const mins = Math.round(totalSeconds(s) / 60);
    const risk = photicRisk(s);
    return `<div class=sx data-id="${esc(s.id)}" role=button tabindex=0>
      <div class=sxh><b>${esc(s.name)}</b><span class=g style="color:var(${GRADE_COLOR[s.grade] || '--mk-text-muted'})">${esc(s.grade)}</span></div>
      <div class=sxm>${esc(String(mins))} min · ${esc(String(peakHz(s)))}Hz peak · ${esc(s.method)}${risk === 'high' ? ' · <b class=hr>HIGH PHOTIC RISK</b>' : ''}</div>
      <div class=sxe>${esc(s.evidence)}</div>
      ${s.note ? `<div class=sxn>${esc(s.note)}</div>` : ''}
    </div>`;
  }).join('');
  return `<h3 class=cath>${esc(c.name)}</h3><p class=muted style="margin:0 0 8px">${esc(c.blurb)}</p><div class=sxgrid>${cards}</div>`;
}).join('');
const LIB_JSON = JSON.stringify(SESSIONS).replace(/</g, '\\u003c');

const PARTS = [
  ['ESP32 dev board', '$6–10', 'Wi-Fi built in, so an app can control it'],
  ['12V LED strip (warm white, ~1m) or 4× 1W LEDs', '$8', 'Diffuse light; not aimed at the eyes'],
  ['Logic-level MOSFET (IRLZ44N or similar)', '$2', 'Switches the LEDs at 40Hz'],
  ['Small speaker + PAM8403 amp board', '$5', '40Hz click train / isochronic tone'],
  ['12V power supply', '$8', 'Shared with the LED strip'],
  ['Breadboard, wires, resistors', '$5', ''],
];
const partRows = PARTS.map(([p, c, n]) =>
  `<tr><td>${esc(p)}</td><td class=c>${esc(c)}</td><td class=n>${esc(n)}</td></tr>`).join('');

export const GAMMA_PAGE = `<!doctype html>
<html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>40Hz — Hathor</title>
${themeCSS({ context: 'default' })}
<style>
*{box-sizing:border-box}
body{background:var(--mk-bg);color:var(--mk-text);margin:0;
     font:16px/1.65 ui-sans-serif,system-ui,-apple-system,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:30px 20px 90px}
.hero{background:var(--mk-sunset);border-radius:14px;padding:26px 24px;margin-bottom:26px}
h1{font-size:38px;margin:0;letter-spacing:.16em;text-transform:uppercase;
   color:#fff;text-shadow:0 0 18px var(--mk-magenta),0 0 40px var(--mk-violet)}
.sub{color:#f4ecff;opacity:.9;margin:8px 0 0;letter-spacing:.05em}
h2{font-size:19px;margin:34px 0 10px;color:var(--mk-cyan);
   border-bottom:1px solid var(--mk-border);padding-bottom:6px;letter-spacing:.04em}
h3{font-size:15px;margin:20px 0 6px;color:var(--mk-lavender)}
.muted{color:var(--mk-text-muted);font-size:14px}
.card{background:var(--mk-surface);border:1px solid var(--mk-border);border-radius:12px;padding:20px;margin:18px 0}
.warn{background:var(--mk-surface-2);border:1px solid var(--mk-warn);border-left-width:4px;
      border-radius:8px;padding:14px 16px;margin:18px 0}
.warn b{color:var(--mk-warn)}
button{font:inherit;padding:11px 18px;border-radius:9px;cursor:pointer;
       border:1px solid var(--mk-magenta);background:var(--mk-magenta);color:var(--mk-on-primary)}
button.ghost{background:transparent;color:var(--mk-text);border-color:var(--mk-border)}
button[disabled]{opacity:.4;cursor:not-allowed}
.methods{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:14px 0}
.m{border:1px solid var(--mk-border);border-radius:10px;padding:12px;background:var(--mk-surface-2);cursor:pointer}
.m[aria-pressed=true]{border-color:var(--mk-cyan);box-shadow:0 0 0 1px var(--mk-cyan) inset}
.m b{display:block;color:var(--mk-cyan);font-size:14px}
.m span{color:var(--mk-text-muted);font-size:12.5px}
.m.locked{opacity:.55}
#stage{margin-top:14px;height:170px;border-radius:10px;border:1px solid var(--mk-border);background:#000}
.stat{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--mk-text-muted)}
table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border-bottom:1px solid var(--mk-border);padding:8px 6px;text-align:left;vertical-align:top}
td.c{white-space:nowrap;color:var(--mk-magenta)}
td.n{color:var(--mk-text-muted)}
a{color:var(--mk-cyan)}
ol li,ul li{margin:8px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
/* THE CHAMBER — full field, enclosed, mirrored. The 2026 study's active ingredient is the
   encounter, not the frequency, so this is built as a room with a threshold rather than a player. */
#chamber{position:fixed;inset:0;z-index:9999;background:#05030a;display:flex;align-items:center;
  justify-content:center;flex-direction:column;text-align:center;padding:32px}
#chamber[hidden]{display:none!important}
#chField{position:absolute;inset:0;background:#000;transition:none}
/* the reflective surround: opposed gradients standing in for the mirrored cube's infinite regress */
#chMirror{position:absolute;inset:0;pointer-events:none;opacity:.55;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(255,45,149,.30), transparent 62%),
    radial-gradient(ellipse at 50% 100%, rgba(0,229,255,.26), transparent 62%),
    radial-gradient(ellipse at 0% 50%, rgba(123,47,247,.22), transparent 58%),
    radial-gradient(ellipse at 100% 50%, rgba(123,47,247,.22), transparent 58%)}
#chUI{position:relative;z-index:2;max-width:560px;color:#f4ecff}
#chUI h2{color:#fff;border:0;font-size:24px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 10px}
#chUI p{color:#cfc3e8;font-size:15px;line-height:1.7}
#chIntent{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18);
  border-radius:10px;color:#fff;font:inherit;padding:12px 14px;margin:14px 0}
#chIntent::placeholder{color:#8d82a8}
#chClock{font-family:ui-monospace,monospace;font-size:44px;color:#fff;letter-spacing:.06em;margin:10px 0}
#chSub{color:#a99fc4;font-size:13px;font-family:ui-monospace,monospace}
.chbtn{background:transparent;border:1px solid rgba(255,255,255,.5);color:#fff;padding:12px 26px;
  border-radius:10px;font:inherit;cursor:pointer;letter-spacing:.06em}
.chbtn.solid{background:var(--mk-magenta);border-color:var(--mk-magenta)}
.np{background:var(--mk-surface-2);border:1px solid var(--mk-border);border-radius:10px;
    padding:12px 14px;margin:4px 0 12px;color:var(--mk-text-muted);font-size:14px}
.np b{color:var(--mk-cyan)}
.cath{color:var(--mk-magenta);margin:26px 0 2px;font-size:16px;letter-spacing:.05em;text-transform:uppercase}
.sxgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0 4px}
.sx{border:1px solid var(--mk-border);border-radius:10px;padding:13px;background:var(--mk-surface);cursor:pointer}
.sx:hover{border-color:var(--mk-cyan)}
.sx[aria-pressed=true]{border-color:var(--mk-magenta);box-shadow:0 0 0 1px var(--mk-magenta) inset}
.sxh{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.sxh b{color:var(--mk-text);font-size:15px}
.g{font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.sxm{color:var(--mk-text-muted);font-size:12px;margin:4px 0 7px}
.hr{color:var(--mk-loss)}
.sxe{color:var(--mk-text-muted);font-size:12.5px;line-height:1.5}
.sxn{color:var(--mk-warn);font-size:12.5px;margin-top:7px}

.pfam{margin:1.6rem 0}
.pfam h3{margin:.2rem 0 .2rem;font-size:1.1rem}
.pblurb{opacity:.7;margin:.1rem 0 .6rem;font-size:.93rem}
.prac{border:1px solid var(--line,#2a2a33);border-radius:9px;padding:.85rem 1rem;margin:.7rem 0;background:var(--bg2,#15151c)}
.prac header{display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline;margin-bottom:.35rem}
.pname{font-weight:700}
.pgrade{border:1px solid currentColor;border-radius:999px;padding:.02rem .5rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}
.g-moderate{color:#7fc08a}.g-promising{color:#c9a227}.g-weak{color:#c98a6a}.g-traditional{color:#9aa0a6}.g-strong{color:#7fc08a}
.pmin{margin-left:auto;opacity:.55;font-size:.82rem}
.psum{margin:.2rem 0 .5rem}
.psteps{margin:.3rem 0 .6rem;padding-left:1.2rem}
.psteps li{margin:.22rem 0}
.pev{font-size:.9rem;opacity:.85;margin:.4rem 0}
.pnote{font-size:.88rem;opacity:.72;margin:.3rem 0}
.pcaution{font-size:.9rem;color:#e0796f;margin:.3rem 0}
.pcite{font-size:.82rem;margin:.4rem 0 0}
.warn-lite{border-left:3px solid #c2554d;padding-left:.9rem;opacity:.9}
</style></head><body><div class=wrap>

<div class=hero>
  <h1>40 Hz</h1>
  <p class=sub>gamma entrainment · light and sound · nothing here puts current into a body</p>
</div>

<div class=warn>
<b>Photosensitive epilepsy.</b> Flicker in this range can trigger seizures in susceptible people. If you
have epilepsy or a family history of seizures, <b>use the auditory method only</b> — it does not flicker.
The visual methods stay locked until you confirm.
</div>

<h2>Session</h2>
<div class=card>
  <div id=nowPlaying class=np>No session selected — pick one from the library below.</div>
  <div id=ack class=warn hidden>
    <b>Confirm before any visual method.</b> I do not have epilepsy or a family history of seizures, and
    I understand the visual channel may be approximate on this display.
    <div class=row style="margin-top:10px">
      <button id=ackYes>I confirm — unlock visual methods</button>
      <button id=ackNo class=ghost>Cancel</button>
    </div>
  </div>

  <div class=row style="margin-top:6px">
    <button id=go>Start</button>
    <button id=stop class=ghost disabled>Stop</button>
    <span class=stat id=cap>measuring display…</span>
  </div>
  <div id=stage hidden></div>
  <p class=stat id=stat>idle</p>
  <p class=muted>Audio is <b>sample-accurate</b> — it runs on the audio clock, so the beat frequency is
  exact at any Hz. Video is bounded by your refresh rate: a 60Hz display cannot place 40Hz pulses on equal
  frame boundaries, a 120Hz display can. Diffuse room light, never a strobe aimed at the eyes. Comfortable
  volume. The clinical protocol for 40Hz is one hour per day, daily.</p>
</div>

<h2>The library</h2>
<p class=muted>Every session carries its evidence grade in the data, not in the marketing.
<b style="color:var(--mk-gain)">strong</b> = trials in progress ·
<b style="color:var(--mk-cyan)">moderate</b> = replicated, entrainment verified ·
<b style="color:var(--mk-lavender)">promising</b> = small studies ·
<b style="color:var(--mk-warn)">weak</b> = inconsistent, listed honestly ·
<b>traditional</b> = no clinical evidence at all.</p>
${libraryHTML}

<h2>What the evidence says</h2>
<p>The MIT line is <b>GENUS</b> — Gamma ENtrainment Using Sensory stimuli. The hypothesis is that driving
40Hz does downstream biological work rather than just producing a matching EEG trace: increased phagocytic
activity of microglia, augmented vasodilation and transcytosis across the brain endothelium, and glymphatic
clearance — arterial vasomotor pulsation entrained by the envelope of local gamma oscillations, moving
cerebrospinal fluid and clearing amyloid in mouse models.</p>
<p class=muted>Whether <b>exactly</b> 40 matters is genuinely unsettled. Recent work drives the 36–44Hz
range to test it, on the reasoning that comparing against frequencies far outside that vicinity reveals
nothing about specificity.</p>

<h3>1 · Luminance flicker</h3>
<p>The original and most-studied route — and the least comfortable. In the OVERTURE trial, 40Hz flicker
combined with 40Hz-modulated 10kHz clicks produced <b>headache in 20.7%</b> and <b>tinnitus in 15.2%</b>
of the active group (n=46), against 10.7% and 0% in sham (n=28). In a healthy cohort it rated <b>6.2 points
higher for discomfort</b> on a 0–10 scale than steady light.</p>

<h3>2 · Invisible spectral flicker (ISF)</h3>
<p>Modulates the light's spectral composition while holding perceived luminance constant — the eye sees a
steady field, the visual cortex still gets a 40Hz drive. All three visual variants produce a 40Hz
steady-state evoked potential, but ISF scores significantly better on comfort and perceived flicker.
Reducing brightness had no significant effect on the response, and peripheral viewing angles cost only
slightly — which may free a patient from gazing directly at the light. Now in randomised, triple-masked,
placebo-controlled trial.</p>
<p class=muted>Here it is approximated by alternating two colours matched for <b>relative luminance</b>
(sRGB-linearised, the WCAG formula) but differing in spectral content. The luminance match is computed in
the browser, not eyeballed.</p>

<h3>3 · Auditory</h3>
<p>40Hz clicks, or a carrier amplitude-modulated at 40Hz. Works with the eyes closed and sidesteps
photosensitivity entirely. Produced the highest EEG response and increased regional cerebral blood flow in
healthy participants; in dementia patients it enhanced default-mode-network connectivity, strengthening
frontal–parietal rhythmic synchrony, and those improvements correlated with memory performance.
<b>Because visual gamma drive is more likely to provoke seizure or pre-seizure activity in photosensitive
people, auditory stimulation has been proposed as the safer route for that population</b> — which is why it
is the one method unlocked by default here.</p>

<h3>4 · Combined audiovisual</h3>
<p>What the pivotal clinical work runs. The protocol is consistent across trials: <b>one hour per day, at
home, daily</b>. A Phase 2A pilot over 3 months in mild probable Alzheimer's showed lesser ventricular
dilation and hippocampal atrophy, increased default-mode-network connectivity, better face-name delayed
recall, and improved daily activity rhythmicity versus control. Adherence over the 6-month study averaged
85% among completers.</p>
<p class=muted>Status: Cognito Therapeutics completed enrolment of <b>670 participants in the HOPE study
(NCT05637801)</b>. Re-read all of the above against that readout. And the 2016 reason for interest in 40Hz
— lucid dreaming — has <b>largely fallen apart</b>; the therapeutic gamma literature and the lucid-dream
literature are separate stories and should not prop each other up.</p>

<h2>Practices — the half that needs no hardware</h2>
<p class=lede>Everything above needs a screen, headphones or a device you built. These need nothing at
all. They are graded on the same scale, for the same reason: this corner is thick with confident
instruction and thin with evidence, and the useful thing is saying which is which.</p>
<p class=warn-lite><strong>None of this is a treatment for insomnia.</strong> Sleep that stays broken for
weeks is a clinical matter, not a technique problem.</p>
${PRACTICE_FAMILIES.map((f) => `
<section class=pfam>
  <h3>${esc(f.name)}</h3>
  <p class=pblurb>${esc(f.blurb)}</p>
  ${PRACTICES.filter((p) => p.family === f.id).map((p) => `
  <article class="prac grade-${esc(p.grade)}">
    <header>
      <span class=pname>${esc(p.name)}</span>
      <span class="pgrade g-${esc(p.grade)}">${esc(p.grade)}</span>
      ${p.minutes ? `<span class=pmin>${esc(String(p.minutes))} min</span>` : ''}
    </header>
    <p class=psum>${esc(p.summary)}</p>
    <ol class=psteps>${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class=pev><strong>Evidence.</strong> ${esc(p.evidence)}</p>
    ${p.note ? `<p class=pnote>${esc(p.note)}</p>` : ''}
    ${p.caution ? `<p class=pcaution><strong>Caution.</strong> ${esc(p.caution)}</p>` : ''}
    <p class=pcite>${p.citations.map((c) => `<a href="${esc(c.url)}" rel="noopener" target="_blank">${esc(c.label)}</a>`).join(' &middot; ')}</p>
  </article>`).join('')}
</section>`).join('')}

<h2>Why dedicated hardware</h2>
<p>A microcontroller hardware timer gives true 40Hz; a screen usually cannot. 40Hz means a 25&nbsp;ms
period, so the output toggles every 12.5&nbsp;ms — a timer alarm at 12500&nbsp;µs hits that exactly where a
frame loop drifts. A 60Hz display <b>cannot</b> place pulses on equal boundaries,
because 60 is not an integer multiple of 40. A 120Hz display <b>can</b> — exactly three frames per cycle. This page measures your
refresh rate and says which case you are in.</p>

<h2>The build — about $35–40</h2>
<table><thead><tr><th>Part</th><th>Est.</th><th>Notes</th></tr></thead><tbody>${partRows}</tbody></table>

<h2>Building a TENS unit</h2>
<p>A TENS unit is a pulse generator driving a <b>current-limited, DC-blocked</b> output into two skin
electrodes. Every part of that sentence is load-bearing, and the failure modes come from getting one of
them wrong — so build it understanding what each stage is protecting you from.</p>

<h3>The five stages</h3>
<ol>
<li><b>Oscillator / timing.</b> Pulse rate 1–150&nbsp;Hz, pulse width 50–300&nbsp;µs. Conventional TENS runs
high rate (80–120&nbsp;Hz) and narrow; acupuncture-like TENS runs low rate (2–10&nbsp;Hz) and wide. A
microcontroller does this far better than a 555, because you get exact timing and a hard watchdog.</li>
<li><b>Constant-current output — the stage that matters.</b> Skin impedance swings enormously with
sweat, electrode contact and time. A constant-<i>voltage</i> output therefore delivers wildly varying
current: comfortable at first contact, then rising as the gel wets. A constant-<i>current</i> sink holds
delivered current steady as impedance changes. This is why commercial units feel stable and why bad DIY
units burn people.</li>
<li><b>DC blocking.</b> Put a series capacitor in the output path. Any net DC across skin drives
<b>electrochemical</b> reactions at the electrode — that is not a heating burn, it is a chemical one, and
it happens at currents far below what feels alarming. Charge-balanced biphasic pulses plus a blocking
capacitor is the standard answer.</li>
<li><b>Isolation.</b> Run it from a battery. Never mains-derived, never while charging. This removes the
entire class of fault where a mains transient reaches the electrodes.</li>
<li><b>Fault behaviour.</b> Decide what happens on a broken wire, a lifted electrode, a brownout, or a
firmware hang — and make the safe state <b>output off</b>. A watchdog that stops output beats one that
resets into a live output.</li>
</ol>

<h3>Verify before it touches skin</h3>
<p>This is the step that separates a build from a hazard, and it needs no special equipment beyond a
multimeter and, ideally, a scope:</p>
<ul>
<li><b>Load resistor first.</b> 500&nbsp;Ω–2&nbsp;kΩ across the output stands in for skin. Never test on
yourself first.</li>
<li><b>Measure current, not voltage.</b> Across the load, confirm the peak current matches what the dial
claims, and that it <b>stays constant</b> when you swap 500&nbsp;Ω for 2&nbsp;kΩ. If current changes with
load, you have built a voltage source and the constant-current stage is not working.</li>
<li><b>Check for DC offset.</b> Meter on DC volts across the load, output running. You want ≈0. Anything
persistent means your blocking capacitor or charge balance is wrong — fix it before proceeding.</li>
<li><b>Scope the pulse.</b> Confirm width and that the waveform is biphasic and returns to baseline.</li>
<li><b>Sweep the dial to maximum on the load</b> and confirm it never exceeds your design ceiling.</li>
</ul>
<p class=muted>Electrodes: use proper self-adhesive hydrogel pads with adequate surface area. Small
electrodes concentrate current density, which is what causes hot spots. Never place electrodes across the
chest, over the carotid sinus, or on broken skin. Do not use with an implanted pacemaker or defibrillator.</p>

<h2>Building a tDCS unit</h2>
<p>tDCS is a much simpler circuit than TENS and a more consequential one — a low, steady direct current
between two scalp electrodes. There is no oscillator; the whole device is a <b>regulated constant-current
source with a ramp and a cutoff</b>.</p>
<ul>
<li><b>Current range.</b> Research protocols overwhelmingly use <b>1–2&nbsp;mA</b>. That is the studied
band; build your ceiling there rather than making a device that can exceed it.</li>
<li><b>Constant current, again.</b> A regulated current sink is the entire device. Scalp and hair make
impedance unstable, so a voltage source is not acceptable here at all.</li>
<li><b>Ramp up and down.</b> 30&nbsp;seconds in and out. Abrupt onset produces a bright phosphene flash and
a much less comfortable sensation; ramping is standard practice for both comfort and blinding.</li>
<li><b>Impedance monitoring and cutoff.</b> Measure the voltage the current source needs to maintain its
setpoint — that is your impedance readout. If it rises past a threshold (electrode drying, poor contact),
<b>shut the output off</b> rather than pushing harder. This is the single feature that separates a safe
build from an unsafe one, and it is entirely achievable: it is one ADC reading and one comparison.</li>
<li><b>Hard ceiling in hardware.</b> A resistor that physically limits maximum current, independent of
firmware, so a software bug cannot exceed it.</li>
<li><b>Electrodes.</b> Saline-soaked sponges over conductive rubber, ~25–35&nbsp;cm². Keep them wet — a
drying sponge raises impedance and concentrates current, which is the usual cause of skin irritation and
small burns. Re-wet between sessions.</li>
</ul>
<p class=muted>Sensation: a mild tingle or itch under the electrodes is expected and usually fades. A
metallic taste, a phosphene at switch-on, and mild transient headache are commonly reported. <b>Stop if
sensation exceeds mild tingling</b>, if it becomes a sharp or burning point, or if the skin under an
electrode is anything more than transiently pink. Never over broken skin.</p>
<p class=muted>Evidence, so you know what you are building for: the best-supported territory for tDCS is
<b>depression and chronic-pain</b> research protocols. The lucid-dream literature (Voss 2014 tACS 25/40Hz;
Stumbrys 2013 tDCS over DLPFC) timed stimulation to REM sleep in a lab, results were weak to mixed, and a
replication failed — treat that use as experimental.</p>

<p class=muted style="margin-top:34px"><a href="/">← back to Hathor</a></p>

<div id=chamber hidden aria-live=polite>
  <div id=chField></div><div id=chMirror></div>
  <div id=chUI>
    <div id=chStep0>
      <h2>The threshold</h2>
      <p>This is an enclosure, not a player. Darken the room. Put headphones on. Turn your phone over.
      When you cross in, you stay until it ends — about twelve minutes.</p>
      <p style="color:#a99fc4;font-size:13.5px">The 2026 chamber study found alpha and theta arms worked
      equally well. The frequency is not what is doing the work. The room is.</p>
      <input id=chIntent placeholder="One line — why are you here? (optional, never leaves this device)">
      <div class=row style="justify-content:center;margin-top:6px">
        <button class="chbtn solid" id=chEnter>Cross in</button>
        <button class=chbtn id=chLeave1>Not now</button>
      </div>
    </div>
    <div id=chStep1 hidden>
      <h2 id=chTitle>Settling</h2>
      <div id=chClock>0:00</div>
      <p id=chIntentEcho style="color:#b8abd6;font-style:italic"></p>
      <p id=chSub></p>
      <div class=row style="justify-content:center;margin-top:14px">
        <button class=chbtn id=chLeave2>Leave</button>
      </div>
    </div>
    <div id=chStep2 hidden>
      <h2>Return</h2>
      <p>Sit for a moment before you stand. Notice what is different and what is not — both are data.</p>
      <p id=chDone style="color:#a99fc4;font-family:ui-monospace,monospace;font-size:13px"></p>
      <div class=row style="justify-content:center;margin-top:10px">
        <button class="chbtn solid" id=chClose>Step out</button>
      </div>
    </div>
  </div>
</div>

<script>
(function(){
  var LIB=${LIB_JSON};
  var ctx=null,oscL=null,oscR=null,gainL=null,gainR=null,merger=null,atimer=null,raf=null;
  var t0=0,running=false,sess=null,stepIx=0,stepEndsAt=0,unlocked=false,refresh=0;
  var go=d('go'),stop=d('stop'),stage=d('stage'),stat=d('stat'),cap=d('cap'),np=d('nowPlaying');
  var ack=d('ack'),ackYes=d('ackYes'),ackNo=d('ackNo');
  function d(id){return document.getElementById(id);}
  function find(id){for(var i=0;i<LIB.length;i++) if(LIB[i].id===id) return LIB[i]; return null;}
  function isVisual(m){return m==='flicker'||m==='isf'||m==='combined';}
  function totalSecs(s){var n=0;for(var i=0;i<s.program.length;i++)n+=s.program[i].secs;return n;}

  // ---- measure the real refresh rate ----------------------------------------
  (function measure(){
    var n=0,last=0,ds=[];
    function step(ts){
      if(last) ds.push(ts-last);
      last=ts;
      if(++n<70){requestAnimationFrame(step);return;}
      ds.sort(function(a,b){return a-b;});
      refresh=Math.round(1000/(ds[Math.floor(ds.length/2)]||16.7));
      cap.textContent='display ~'+refresh+'Hz · audio always exact';
    }
    requestAnimationFrame(step);
  })();

  // ---- ISF: luminance-matched pair -------------------------------------------
  function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
  function lum(r,g,b){return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);}
  var A=[255,45,149], B=(function(){
    var t=lum(A[0],A[1],A[2]),lo=0,hi=1,mid;
    for(var i=0;i<40;i++){mid=(lo+hi)/2;if(lum(0,Math.round(229*mid),Math.round(255*mid))<t)lo=mid;else hi=mid;}
    return [0,Math.round(229*mid),Math.round(255*mid)];
  })();
  var rgbA='rgb('+A.join(',')+')', rgbB='rgb('+B.join(',')+')';

  // ---- audio -----------------------------------------------------------------
  // binaural: two carriers, offset by the beat frequency, one per ear (needs headphones).
  // isochronic: one carrier, gated on/off at the beat frequency (no headphones needed).
  function curHz(){
    var p=sess.program[Math.min(stepIx,sess.program.length-1)];
    return p?p.hz:40;
  }
  function buildAudio(){
    var AC=window.AudioContext||window.webkitAudioContext;
    if(!AC){stat.textContent='Web Audio unavailable';return false;}
    ctx=new AC();
    var carrier=sess.carrier||220;
    merger=ctx.createChannelMerger(2);
    oscL=ctx.createOscillator();oscR=ctx.createOscillator();
    oscL.type=oscR.type='sine';
    gainL=ctx.createGain();gainR=ctx.createGain();
    if(sess.method==='binaural'){
      oscL.frequency.value=carrier;
      oscR.frequency.value=carrier+curHz();
      gainL.gain.value=gainR.gain.value=0.12;
    }else{
      oscL.frequency.value=oscR.frequency.value=carrier;
      gainL.gain.value=gainR.gain.value=0.0001;   // gated below
    }
    oscL.connect(gainL);oscR.connect(gainR);
    gainL.connect(merger,0,0);gainR.connect(merger,0,1);
    merger.connect(ctx.destination);
    oscL.start();oscR.start();
    t0=ctx.currentTime+0.1;
    return true;
  }
  function scheduleIso(until){
    var hz=curHz(), period=1/hz, pulse=Math.min(0.006, period*0.24);
    while(t0<until){
      [gainL,gainR].forEach(function(g){
        g.gain.setValueAtTime(0.0001,t0);
        g.gain.exponentialRampToValueAtTime(0.22,t0+0.001);
        g.gain.exponentialRampToValueAtTime(0.0001,t0+pulse);
      });
      t0+=period;
    }
  }
  function tick(){
    if(!ctx||!running) return;
    var now=ctx.currentTime;
    // advance the program
    if(now>=stepEndsAt && stepIx<sess.program.length-1){
      stepIx++; stepEndsAt=now+sess.program[stepIx].secs;
      if(sess.method==='binaural'){ oscR.frequency.setValueAtTime((sess.carrier||220)+curHz(), now); }
      t0=Math.max(t0,now);
    }
    if(sess.method!=='binaural') scheduleIso(now+0.25);
    var left=Math.max(0,Math.round(stepEndsAt-now));
    stat.textContent='running · '+sess.name+' · '+curHz()+'Hz · step '+(stepIx+1)+'/'+sess.program.length+' · '+left+'s left in step';
    if(now>=stepEndsAt && stepIx>=sess.program.length-1) halt();
  }
  function paint(){
    var hz=curHz(), periodMs=1000/hz;
    var on=(performance.now()%periodMs)<(periodMs/2);
    stage.style.background = sess.method==='isf' ? (on?rgbA:rgbB) : (on?'#fff6e0':'#000');
    raf=requestAnimationFrame(paint);
  }
  function start(){
    if(running||!sess) return;
    var vis=isVisual(sess.method);
    if(vis && !unlocked){ ack.hidden=false; return; }
    running=true; stepIx=0;
    if(sess.method!=='flicker'){ if(!buildAudio()){running=false;return;} stepEndsAt=ctx.currentTime+sess.program[0].secs; }
    else { stepEndsAt=Infinity; }
    if(vis){ stage.hidden=false; raf=requestAnimationFrame(paint); }
    if(ctx){ atimer=setInterval(tick,100); tick(); }
    go.disabled=true; stop.disabled=false;
  }
  function halt(){
    running=false;
    if(atimer){clearInterval(atimer);atimer=null;}
    [oscL,oscR].forEach(function(o){ if(o){try{o.stop();}catch(e){}} });
    oscL=oscR=null;
    if(ctx){try{ctx.close();}catch(e){} ctx=null;}
    if(raf){cancelAnimationFrame(raf);raf=null;}
    stage.hidden=true; stage.style.background='#000';
    go.disabled=false; stop.disabled=true; stat.textContent='idle';
  }
  function select(id){
    var s=find(id); if(!s) return;
    halt(); sess=s;
    var cards=document.querySelectorAll('.sx');
    for(var i=0;i<cards.length;i++) cards[i].setAttribute('aria-pressed', cards[i].getAttribute('data-id')===id?'true':'false');
    var mins=Math.round(totalSecs(s)/60);
    var warn='';
    if(isVisual(s.method)){
      var peak=0; for(var j=0;j<s.program.length;j++) peak=Math.max(peak,s.program[j].hz);
      if(peak>=13&&peak<=26) warn=' — <b style="color:var(--mk-loss)">this session drives light in the 13–26Hz band, the most seizure-provocative range</b>';
      else warn=' — visual session, photosensitivity warning applies';
    }
    np.innerHTML='<b>'+s.name+'</b> · '+mins+' min · '+s.method+' · grade: '+s.grade+warn
      + (s.eyesClosed?' — <b>eyes closed</b>':'')
      + (s.method==='binaural'?' — <b>headphones required</b>':'');
    go.disabled=false;
  }
  document.addEventListener('click',function(e){
    var c=e.target.closest?e.target.closest('.sx'):null;
    if(c) select(c.getAttribute('data-id'));
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' ')return;
    var c=e.target.closest?e.target.closest('.sx'):null;
    if(c){e.preventDefault();select(c.getAttribute('data-id'));}
  });
  ackYes.addEventListener('click',function(){unlocked=true;ack.hidden=true;start();});
  ackNo.addEventListener('click',function(){ack.hidden=true;});
  // ── THE CHAMBER ────────────────────────────────────────────────────────────────────────────
  // Threshold in, settling, session, defined return. Fullscreen and full-field, because the
  // 2026 study's active ingredient is the encounter rather than the frequency.
  var ch=d('chamber'), chField=d('chField'), chClock=d('chClock'), chSub=d('chSub'),
      chTitle=d('chTitle'), chIntent=d('chIntent'), chIntentEcho=d('chIntentEcho'), chDone=d('chDone');
  var chStep=[d('chStep0'),d('chStep1'),d('chStep2')];
  var chRaf=null, chT0=0, chDur=0, chSettle=45, chActive=false;

  function chShow(i){ for(var k=0;k<chStep.length;k++) chStep[k].hidden = (k!==i); }
  function mmss(t){ t=Math.max(0,Math.round(t)); return Math.floor(t/60)+':'+String(t%60).padStart(2,'0'); }

  function chOpen(){
    if(!sess) return;
    chShow(0); ch.hidden=false;
    try{ if(ch.requestFullscreen) ch.requestFullscreen(); }catch(e){}
  }
  function chBegin(){
    if(!unlocked){ ch.hidden=true; ack.hidden=false; return; }   // visual gate still applies
    chActive=true; chShow(1);
    var line=(chIntent.value||'').trim();
    chIntentEcho.textContent = line ? '\u201c'+line+'\u201d' : '';
    chDur = totalSecs(sess);
    start();                                   // the existing player drives audio + program
    chT0 = performance.now();
    chTick();
  }
  function chTick(){
    if(!chActive) return;
    var el=(performance.now()-chT0)/1000;
    if(el<chSettle){
      chTitle.textContent='Settling';
      chClock.textContent=mmss(chSettle-el);
      chSub.textContent='breathe out longer than you breathe in';
      chField.style.background='#05030a';
    } else {
      var t=el-chSettle;
      chTitle.textContent=sess.name;
      chClock.textContent=mmss(chDur-t);
      chSub.textContent=curHz()+' Hz \u00b7 '+sess.method+' \u00b7 grade: '+sess.grade;
      // full-field drive; ISF uses the luminance-matched pair, others luminance flicker
      var hz=curHz(), periodMs=1000/hz, on=(performance.now()%periodMs)<(periodMs/2);
      chField.style.background = sess.method==='isf' ? (on?rgbA:rgbB) : (on?'#fff4e2':'#05030a');
      if(t>=chDur){ chEnd(); return; }
    }
    chRaf=requestAnimationFrame(chTick);
  }
  function chEnd(){
    chActive=false;
    if(chRaf){cancelAnimationFrame(chRaf);chRaf=null;}
    halt();
    chField.style.background='#05030a';
    chDone.textContent='completed \u00b7 '+sess.name+' \u00b7 '+Math.round(chDur/60)+' min \u00b7 '+curHz()+' Hz';
    chShow(2);
  }
  function chClose(){
    chActive=false;
    if(chRaf){cancelAnimationFrame(chRaf);chRaf=null;}
    halt(); ch.hidden=true; chField.style.background='#05030a';
    try{ if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); }catch(e){}
  }
  d('chEnter').addEventListener('click',chBegin);
  d('chLeave1').addEventListener('click',chClose);
  d('chLeave2').addEventListener('click',chClose);
  d('chClose').addEventListener('click',chClose);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape' && !ch.hidden) chClose(); });

  // Deep link — Hathor hands out /40hz?s=<id> in chat; open pre-selected on that session.
  (function deepLink(){
    try{
      var want=new URLSearchParams(location.search).get('s');
      if(!want) return;
      var s0=find(want); if(!s0) return;
      select(want);
      var card=document.querySelector('.sx[data-id="'+want.replace(/"/g,'')+'"]');
      if(card && card.scrollIntoView) card.scrollIntoView({block:'center'});
    }catch(e){}
  })();

  go.addEventListener('click',function(){
    // A chamber session opens the room; everything else plays inline.
    if(sess && sess.chamber) chOpen(); else start();
  });
  stop.addEventListener('click',halt);
})();
</script>
</div></body></html>`;

export default GAMMA_PAGE;

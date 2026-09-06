// chamber.mjs — the Chamber: entrainment delivered in VR, in flat 3D, or on a plain screen.
//
// WHY WEBXR AND NOT THE GODOT BUILD. integrations/vr/openxr-manifest.mjs is the NATIVE path — one OpenXR
// build fanned out across headset families. That is the right long game and it is unchanged. This is the
// short one: WebXR runs in the headset's own browser, so the Chamber ships the moment a page ships. No
// store review, no APK, no signing. A Quest user opens hathor.live/40hz and is inside it.
//
// WHY A HEADSET IS THE RIGHT INSTRUMENT FOR THIS. Photic entrainment wants a controlled luminance field.
// A phone at arm's length competes with room light, drifts with head movement, and covers a few degrees
// of view. A headset is a calibrated light source fixed to the skull in a dark enclosure covering the
// whole field. For the delivery of a 40Hz visual drive it is straightforwardly the better instrument.
//
// AND THAT IS EXACTLY WHY IT IS MORE DANGEROUS. Full-field flicker at high luminance with no escape for
// peripheral vision is the worst case for photosensitive epilepsy, not the best. So the gating here is
// STRICTER than the flat-screen page, not the same:
//
//   * A session that photicRisk() rates 'high' is refused in immersive mode outright. Not warned — refused.
//   * Visual delivery in a headset requires an explicit, separate confirmation from the flat-screen one.
//     Consent given to a phone screen is not consent given to a headset.
//   * Every immersive session offers an auditory-only path, and that path is the default.
//   * Luminance is capped below full white, and the ramp is enforced rather than suggested.
//
// The three tiers degrade in that order and none of them is a dead end:
//   immersive  → WebXR 'immersive-vr', headset, full field
//   cardboard  → stereo side-by-side on a PHONE, in a folded viewer. No WebXR, no app, no account.
//   flat3d     → WebGL scene in an ordinary browser, no headset, mouse/touch look-around
//   plain      → the existing 2D page. Always available. Never worse than today.
//
// CARDBOARD IS NOT A CONSOLATION TIER. It is the one most people can actually reach. A folded viewer and
// a phone already in the pocket gives the thing that matters here — an enclosed dark field at a fixed
// distance — for the price of a sandwich. It needs no WebXR at all: two viewports rendered side by side
// is ordinary CSS and canvas, supported by every phone browser made this decade. Google discontinued the
// Cardboard SDK; the FORMAT outlived it, because stereo SBS was never Google's to own.
//
// It is also, on the specific axis that matters for photic safety, GENTLER than a Quest: a phone panel
// behind plastic lenses peaks well below a dedicated headset. So it is gated like immersive for the
// full-field reason, at a luminance cap between headset and flat screen.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, offline-testable. The functions here
// are pure — capability planning and gating decided in JS that runs under `node --test` with no DOM.
//
//   import { planChamber, gateVisual, CHAMBER_TIERS, chamberScene } from './chamber.mjs';

import { photicRisk } from './sessions.mjs';
import { disclaimer } from './the-line.mjs';

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Delivery tiers, best first. Each degrades to the next without losing the session. */
export const CHAMBER_TIERS = Object.freeze(['immersive', 'cardboard', 'flat3d', 'plain']);

/** Peak luminance allowed per tier, 0..1 of full white. A headset never runs to full. */
export const LUMINANCE_CAP = Object.freeze({ immersive: 0.55, cardboard: 0.7, flat3d: 0.85, plain: 1 });

/** Seconds of ramp-in before a visual program reaches its programmed amplitude. */
export const RAMP_SECONDS = Object.freeze({ immersive: 12, cardboard: 10, flat3d: 6, plain: 4 });

/**
 * CHEAP_OPTIONS — what someone actually needs to reach the Chamber, cheapest first.
 * Prices are indicative and deliberately rough; the point is the order of magnitude, not a price list.
 * No affiliate links, ever — this is a library, not a storefront.
 */
export const CHEAP_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'cardboard', name: 'Folded cardboard viewer + the phone you own',
    approxUSD: '10-15', tier: 'cardboard',
    what: 'A folded viewer with two 45mm lenses. The open Cardboard spec is public; the viewers are generic and interchangeable.',
    why: 'Gets you the enclosed dark field, which is the part that matters for a visual drive. Everything above this is comfort and tracking, not efficacy.',
    caveat: 'Hold-to-face or strap models both work. No app and no account are needed — it is a web page rendered twice.',
  }),
  Object.freeze({
    id: 'plastic-phone-hmd', name: 'Plastic phone headset with a head strap',
    approxUSD: '20-35', tier: 'cardboard',
    what: 'The same optics in a moulded shell with a strap and an adjustable focal slider.',
    why: 'Hands free, which for a twenty-minute session is the difference between finishing it and not.',
    caveat: 'Check the phone fits before buying; large phones do not fit older shells.',
  }),
  Object.freeze({
    id: 'used-standalone', name: 'Used standalone headset',
    approxUSD: '100-200', tier: 'immersive',
    what: 'A second-hand Quest-class device. Runs the Chamber in its own browser over WebXR.',
    why: 'Best tracking and the most consistent luminance field. Not required for the session to work.',
    caveat: 'Requires an account with the vendor to set up. That is a real privacy cost and it is the reason it is listed third rather than first.',
  }),
]);

/**
 * planChamber(caps) — choose the delivery tier from what the client reports.
 * `caps` is whatever the browser could tell us; every field is optional and junk is treated as absent.
 *   { xrImmersive:boolean, webgl:boolean, reducedMotion:boolean }
 * Never throws. Always returns a usable tier — 'plain' is the floor, and 'plain' is the page we already have.
 */
export function planChamber(caps) {
  const c = caps && typeof caps === 'object' ? caps : {};
  const reduced = c.reducedMotion === true;
  if (c.xrImmersive === true && !reduced) return { tier: 'immersive', reason: 'WebXR immersive-vr available' };
  if (c.xrImmersive === true && reduced) {
    return { tier: 'flat3d', reason: 'headset present but the OS asks for reduced motion — honouring that' };
  }
  if (c.stereoViewer === true) {
    return { tier: 'cardboard', reason: 'phone in a viewer — stereo side-by-side, no WebXR required' };
  }
  if (c.webgl === true) return { tier: 'flat3d', reason: 'no headset; WebGL available' };
  return { tier: 'plain', reason: 'no 3D capability reported; serving the 2D page' };
}

/**
 * gateVisual(session, tier, consent) — may this session run VISUALLY at this tier?
 * Returns { allowed, method, reason }. `method` is what the caller should actually run, which may be
 * 'auditory' even when the session asked for flicker. Never throws.
 *
 * The rule that matters: a 'high' photic-risk session is REFUSED in immersive mode. There is no consent
 * checkbox for it, because informed consent to a full-field high-risk drive is not something a checkbox
 * on a web page can carry.
 */
export function gateVisual(session, tier, consent) {
  const s = session && typeof session === 'object' ? session : {};
  const t = CHAMBER_TIERS.includes(tier) ? tier : 'plain';
  const visualWanted = s.method === 'flicker' || s.method === 'isf' || s.method === 'combined';

  if (!visualWanted) return { allowed: true, method: 'auditory', reason: 'auditory session — no photic exposure' };

  // A session we cannot READ is a session we cannot clear. photicRisk() answers 'standard' for a session
  // with no program at all, which is the right answer to "does this program contain a high-risk band" and
  // the wrong answer to "is this safe to run". So the absence of a readable program is checked first.
  let risk = 'high';
  const readable = Array.isArray(s.program) && s.program.length > 0
    && s.program.every((step) => step && Number.isFinite(Number(step.hz)));
  if (readable) {
    try { risk = photicRisk(s) || 'high'; } catch { risk = 'high'; }
  }

  const fullField = t === 'immersive' || t === 'cardboard';
  if (fullField && risk === 'high') {
    return {
      allowed: false,
      method: 'auditory',
      reason: `refused: high photic-risk program in a full-field viewer (${t}). The auditory path is offered instead.`,
    };
  }
  if (!consentGiven(consent, t)) {
    return {
      allowed: false,
      method: 'auditory',
      reason: fullField
        ? 'full-field visual delivery needs its own confirmation — consent given for a flat screen does not carry into a viewer strapped to your face'
        : 'visual delivery needs the photosensitivity confirmation',
    };
  }
  return { allowed: true, method: s.method, reason: `visual delivery permitted at ${t}` };
}

/** Consent is per-tier on purpose: agreeing on a phone is not agreeing in a headset. */
function consentGiven(consent, tier) {
  if (!consent || typeof consent !== 'object') return false;
  if (tier === 'immersive' || tier === 'cardboard') return consent.immersive === true;
  return consent.immersive === true || consent.screen === true;
}

/**
 * chamberPlan(session, caps, consent) — the whole decision in one call, for a route handler.
 * Returns { tier, method, allowed, luminanceCap, rampSeconds, reason, disclaimer }.
 */
export function chamberPlan(session, caps, consent) {
  const { tier, reason: tierReason } = planChamber(caps);
  const gate = gateVisual(session, tier, consent);
  return {
    tier,
    tierReason,
    method: gate.method,
    allowed: gate.allowed,
    luminanceCap: LUMINANCE_CAP[tier],
    rampSeconds: RAMP_SECONDS[tier],
    reason: gate.reason,
    cheapOptions: CHEAP_OPTIONS,
    disclaimer: disclaimer('entrainment'),
  };
}

/**
 * chamberScene(plan) — the client-side bootstrap for a tier. Returns a self-contained <script> + markup.
 * Deliberately small: feature-detects, requests the session, and hands frame timing to the caller's
 * existing oscillator. No external library, no CDN, nothing to pin.
 */
/**
 * jsonForScript — JSON.stringify for a value going INSIDE a <script> block. A payload containing the
 * literal characters `</script>` closes the tag and everything after it becomes markup. Escaping `<`
 * as \u003c is the standard fix and costs nothing.
 */
const jsonForScript = (v) => {
  try { return JSON.stringify(v == null ? '' : v).replace(/</g, '\\u003c'); } catch { return '""'; }
};

export function chamberScene(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const tier = CHAMBER_TIERS.includes(p.tier) ? p.tier : 'plain';
  const cap = LUMINANCE_CAP[tier];
  const ramp = RAMP_SECONDS[tier];
  const method = esc(p.method || 'auditory');

  return `<div class="chamber" data-tier="${esc(tier)}" data-method="${method}">
  <p class="chamber-note">${esc(p.reason || '')}</p>
  <p class="chamber-disclaimer">${esc(p.disclaimer || disclaimer('entrainment'))}</p>
  ${tier === 'immersive' ? '<button id="enter-chamber" type=button>Enter the Chamber</button>' : ''}
</div>
<script>
(function(){
  var TIER=${jsonForScript(tier)}, CAP=${cap}, RAMP=${ramp}, METHOD=${jsonForScript(p.method || 'auditory')};
  // Capability probe. Reported back so the server's plan and the client's reality agree.
  window.__CHAMBER__={tier:TIER,cap:CAP,ramp:RAMP,method:METHOD,xr:false};
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then(function(ok){
      window.__CHAMBER__.xr=!!ok;
    }).catch(function(){ window.__CHAMBER__.xr=false; });
  }
  var btn=document.getElementById('enter-chamber');
  if (btn && navigator.xr) {
    btn.addEventListener('click', function(){
      navigator.xr.requestSession('immersive-vr').then(function(session){
        window.__CHAMBER__.session=session;
        // Luminance is capped here and the ramp is enforced here — not left to the visual program.
        window.dispatchEvent(new CustomEvent('chamber:enter',{detail:{cap:CAP,ramp:RAMP,method:METHOD}}));
        session.addEventListener('end', function(){
          window.dispatchEvent(new CustomEvent('chamber:exit'));
        });
      }).catch(function(e){
        // A refused or unavailable session is not an error state — fall back, do not break.
        window.dispatchEvent(new CustomEvent('chamber:fallback',{detail:{reason:String(e&&e.message||e)}}));
      });
    });
  }
})();
</script>`;
}

/** handler(req,res) — JSON plan, so other surfaces can ask what the Chamber would do. */
export function handler(req, res, session = {}, caps = {}, consent = {}) {
  const plan = chamberPlan(session, caps, consent);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(plan, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('chamber.mjs');
if (isMain) {
  const demo = { id: 'genus-40', method: 'flicker', program: [{ hz: 40 }] };
  for (const caps of [{ xrImmersive: true }, { webgl: true }, {}]) {
    console.log(JSON.stringify(chamberPlan(demo, caps, { immersive: true, screen: true }), null, 2));
  }
}

export default chamberPlan;

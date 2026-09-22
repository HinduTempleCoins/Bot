// hathor-product-ad.mjs — Hathor's product-ad reel/script generator.
//
// GOAL (operator, 2026-09-22): Hathor produces short VIDEOS advertising our products (MELEK, PRANA,
// KulaSwap, the tools, hathor.live/40hz, SoapBox, …), starring the VR-Hathor-Mehit figure.
//
// This is the SCRIPT + STORYBOARD + RENDER-PREP layer. It reuses the existing pieces rather than
// reinventing them:
//   • integrations/hathor-video.mjs  — composeVideoPlan(): the deterministic 4-beat director (arc,
//     scenes, captions, timings, music). We build the ad on top of it, then overlay product specifics
//     (name, tagline, benefits, CTA URL) and Hathor-as-presenter visuals.
//   • witness/hathor-post-image.mjs  — HATHOR_SIGNATURE: her canonical look, so presenter shots stay
//     on-model.
//   • integrations/genai-providers.mjs — generateImage(): free-first image backend for the STILLS the
//     buildable-now slideshow path animates (Ken Burns) — keyless pollinations fallback.
//
// TWO RENDER PATHS, honestly labelled (see buildable-now vs needs-GPU in HATHOR_MEDIA_PIPELINE.md):
//   • 'slideshow'  — BUILDABLE NOW, cheap, no GPU: one GenAI still per scene → Ken-Burns pan/zoom →
//                    burn captions → TTS voiceover → concat + music bed (ffmpeg on the box).
//   • 'svd'        — NEEDS GPU / a video model: the composeVideoPlan svd-img2video manifest (ComfyUI
//                    on a woken RunPod, or a hosted text/image-to-video service like Runway/Kling/Luma).
//
// SIGNER BOUNDARY (BRIEF.md §7): builds media + plans only. No WIF, no signing, no broadcast. Hosting
// the finished clip (→ a URL for hathor.live or an on-chain video post) is the caller's wiring step.
//
// Pure/deterministic offline (no LLM, no network); generateImage is injected in tests. Never throws.

import { fileURLToPath } from 'node:url';
import { composeVideoPlan } from './hathor-video.mjs';
import { HATHOR_SIGNATURE } from '../witness/hathor-post-image.mjs';

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// ── product catalog ───────────────────────────────────────────────────────────────────────────────
// The things Hathor advertises. tagline + two benefits + a CTA feed the ad copy; `url` is the CTA link;
// `look` seeds the product b-roll visuals. Kept honest — no fabricated claims; edit as products ship.
export const PRODUCTS = [
  { id: 'melek', name: 'MELEK', tagline: 'a blockchain that remembers what it is for',
    benefits: ['A witness you can talk to', 'Your stake, your voice'],
    call: 'Join the chain', url: 'https://witness.melek.salon',
    look: 'a luminous chain of golden temple-glyphs, block after block streaming into light' },
  { id: 'kulaswap', name: 'KulaSwap', tagline: 'swap the ecosystem tokens, straight from the pool',
    benefits: ['Live pool prices, no oracle guesswork', 'No custody — your keys, your coins'],
    call: 'Swap now', url: 'https://kulaswap',
    look: 'glowing liquidity pools of token orbs, streams of value flowing between them, fintech-temple UI' },
  { id: 'prana', name: 'PRANA', tagline: 'the compute chain that pays for real work',
    benefits: ['Proof-of-work that means something', 'wrapped assets, bridged in'],
    call: 'Build on PRANA', url: 'https://prana',
    look: 'a lattice of humming compute-nodes exhaling breath-like light, an EVM temple' },
  { id: 'tools', name: 'The People Tools', tagline: 'a price ticker and a data hub you can take anywhere',
    benefits: ['Paste it into any forum or blog', 'Every figure links to its source'],
    call: 'Grab the tools', url: 'https://data.soapbox.community',
    look: 'floating modular tool-panels — a ticker, a data hub — clean product-hero composition' },
  { id: 'hathor-live-40hz', name: 'hathor.live/40hz', tagline: 'binaural sessions to tune your mind',
    benefits: ['A free entrainment session library', 'Focus, calm, sleep — on demand'],
    call: 'Start a session', url: 'https://hathor.live/40hz',
    look: 'neon waveforms and 40hz light-ribbons pulsing in a dark meditation studio' },
  { id: 'soapbox', name: 'SoapBox', tagline: 'every coin, one clear view',
    benefits: ['Markets, metals, forex — one page', 'No signup, no wallet connection'],
    call: 'Open SoapBox', url: 'https://soapbox.community',
    look: 'a wide market-wall of live tiles and charts, calm and legible' },
  { id: 'pool', name: 'The MELEK Pool', tagline: 'mine in your browser, keep your keys',
    benefits: ['Browser mining, wallet made in-page', 'Your coins, your mnemonic'],
    call: 'Start mining', url: 'https://pool.soapbox.community',
    look: 'a browser window glowing with a mining hashrate, coins accruing, in-page wallet' },
  { id: 'move', name: 'MELEK Move', tagline: 'walk, and the chain rewards you',
    benefits: ['A step-counter geo-miner', 'Move first — earn as you go'],
    call: 'Move to earn', url: 'https://melek.salon/move',
    look: 'a sunrise city street, footsteps leaving trails of light, a phone showing steps → coins' },
];

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
export function listProducts() { return PRODUCTS; }
export function getProduct(id) { return BY_ID.get(String(id || '').toLowerCase().trim()) || null; }

// which beats show Hathor herself (presenter) vs. the product (b-roll)
const PRESENTER_BEATS = new Set(['hook', 'reveal', 'call']);

/**
 * Compose a product ad — a full, renderable plan starring Hathor. Never throws.
 * Reuses composeVideoPlan for arc/timing/captions, then overlays the product's copy and Hathor's look.
 * @param {string} productId
 * @param {{ format?:string, durationSec?:number }} [opts]  format ∈ hathor-video FORMATS (default 'ad')
 * @returns {{ ok, product, name, format, aspect, durationSec, title, hook, cta, ctaUrl, scenes,
 *             captions, voiceover, music, renderPaths, error? }}
 */
export function composeProductAd(productId, opts = {}) {
  const prod = getProduct(productId);
  if (!prod) return { ok: false, error: `unknown product: ${clean(productId)}`, products: PRODUCTS.map((p) => p.id) };

  const format = opts.format || 'ad';
  const brief = `an ad for ${prod.name}, ${prod.tagline}`;
  const base = composeVideoPlan({ brief, kind: 'ad', format, durationSec: opts.durationSec, cta: prod.call });

  // overlay product copy + Hathor's look onto the deterministic scenes
  const benefits = prod.benefits.slice();
  let bi = 0;
  const scenes = base.scenes.map((s) => {
    const presenter = PRESENTER_BEATS.has(s.beat);
    const visual = presenter
      ? `${HATHOR_SIGNATURE}; ${s.beat === 'hook' ? 'addressing the viewer directly, drawing them in' : s.beat === 'reveal' ? `presenting ${prod.name} beside her, ${prod.look}` : `inviting the viewer onward, warm and radiant`}; cinematic, vaporwave-meets-ancient-Egypt`
      : `${prod.look}; the product itself, clean and vivid, motion`;
    let onScreenText = s.onScreenText, voiceover = s.voiceover;
    if (s.beat === 'hook') { voiceover = `${prod.tagline[0].toUpperCase() + prod.tagline.slice(1)}.`; onScreenText = prod.name; }
    else if (s.beat === 'reveal') { voiceover = `${prod.name} — ${prod.tagline}.`; onScreenText = prod.name; }
    else if (s.beat === 'call') { voiceover = `${prod.call}.`; onScreenText = `${prod.call} →`; }
    else if (benefits[bi]) { const b = benefits[bi++]; voiceover = b + '.'; onScreenText = `✓ ${b}`; }
    return { ...s, visual: clean(visual), onScreenText: clean(onScreenText), voiceover: clean(voiceover), presenter };
  });

  // rebuild captions + voiceover off the overlaid scenes (timings unchanged)
  let t = 0;
  const captions = scenes.map((s) => { const c = { start: r1(t), end: r1(t + s.durationSec), text: s.onScreenText }; t += s.durationSec; return c; });
  const voLines = scenes.map((s) => s.voiceover);

  return {
    ok: true,
    product: prod.id, name: prod.name,
    format, aspect: base.aspect, durationSec: base.durationSec,
    title: prod.name,
    hook: scenes[0].voiceover,
    cta: prod.call, ctaUrl: prod.url,
    scenes, captions,
    voiceover: { lines: voLines, text: voLines.join(' '), lineCount: voLines.length, voice: 'Hathor (TTS)' },
    music: base.music,
    renderPaths: renderPaths(scenes, base),
  };
}
const r1 = (n) => Math.round(n * 10) / 10;

// ── the two render paths, described as data ─────────────────────────────────────────────────────────
function renderPaths(scenes, base) {
  return {
    // BUILDABLE NOW — no GPU. One still per scene, animated with a Ken-Burns move, captions burned in,
    // TTS voiceover, music bed, concatenated. Everything here runs on a cheap CPU box with ffmpeg.
    slideshow: {
      buildableNow: true, needsGpu: false,
      summary: 'GenAI still per scene → Ken-Burns pan/zoom → burn captions → TTS voiceover → concat + music bed (ffmpeg).',
      imageBackend: 'genai-providers.generateImage (cloudflare→gemini→pollinations, keyless fallback)',
      steps: scenes.map((s) => ({
        scene: s.n, beat: s.beat, seconds: s.durationSec,
        still: { prompt: s.visual, aspect: base.aspect },
        kenBurns: s.presenter ? 'slow push-in on the figure' : 'pan across the product',
        caption: s.onScreenText,
        tts: s.voiceover,
      })),
      assemble: { tool: 'ffmpeg', recipe: 'zoompan per still → drawtext captions → concat → amix(tts, music bed) → export mp4', tts: 'a TTS voice (Hathor); e.g. piper/coqui on the box, or a hosted TTS' },
    },
    // NEEDS GPU / a video model — richer motion. Reuses the composeVideoPlan svd-img2video manifest.
    svd: {
      buildableNow: false, needsGpu: true,
      summary: 'True motion: animate each still with Stable Video Diffusion (svd-img2video) on a GPU, or use a hosted text/image-to-video service (Runway / Kling / Luma / Pika).',
      manifest: base.renderManifest,
      hostedAlternatives: ['runway', 'kling', 'luma-dream-machine', 'pika'],
    },
  };
}

/**
 * Prepare the buildable-now slideshow: actually render the per-scene STILLS through the image backend.
 * Injectable generator (default genai-providers.generateImage) keeps tests offline. Never throws.
 * Returns the ad plus a `stills` array (media or a soft error per scene) — ffmpeg assembly is the
 * caller's on-box step (see renderPaths.slideshow.assemble).
 * @returns {{ ok, ad, stills:Array<{scene,prompt,ok,base64?,mime?,provider?,error?}> }}
 */
export async function renderSlideshowStills(productId, opts = {}, deps = {}) {
  const ad = composeProductAd(productId, opts);
  if (!ad.ok) return { ok: false, error: ad.error };
  const gen = deps.generate || (async (a) => (await import('./genai-providers.mjs')).generateImage(a));
  const stills = [];
  for (const step of ad.renderPaths.slideshow.steps) {
    let r;
    try { r = await gen({ prompt: step.still.prompt, size: aspectToSize(ad.aspect) }); }
    catch (e) { stills.push({ scene: step.scene, prompt: step.still.prompt, ok: false, error: String(e && e.message || e).slice(0, 120) }); continue; }
    if (r && r.ok && r.base64) stills.push({ scene: step.scene, prompt: step.still.prompt, ok: true, base64: r.base64, mime: r.mime || 'image/png', provider: r.provider });
    else stills.push({ scene: step.scene, prompt: step.still.prompt, ok: false, error: (r && r.error) || 'no image' });
  }
  return { ok: true, ad, stills };
}

function aspectToSize(aspect) {
  return aspect === '9:16' ? '576x1024' : aspect === '16:9' ? '1024x576' : '1024x1024';
}

/** A plain-text ad script / shotlist for humans (and a second downloadable format). */
export function adScript(ad) {
  if (!ad || !ad.ok) return '';
  const L = [];
  L.push(`${ad.name} — ${ad.format} (${ad.aspect}, ${ad.durationSec}s), ${ad.scenes.length} scenes`);
  L.push(`HOOK:  ${ad.hook}`);
  L.push(`CTA:   ${ad.cta} → ${ad.ctaUrl}`);
  L.push(`MUSIC: ${ad.music.mood} (${ad.music.bpmHint}bpm)`);
  L.push('');
  for (const s of ad.scenes) {
    const end = (ad.captions.find((c) => c.text === s.onScreenText) || {}).end;
    L.push(`[${s.n}] ${s.beat.padEnd(7)} ${s.durationSec}s ${s.presenter ? '· 🜍 Hathor on-screen' : '· product b-roll'}`);
    L.push(`     TEXT: "${s.onScreenText}"`);
    L.push(`     VO:   ${s.voiceover}`);
    L.push(`     🎨    ${s.visual}`);
  }
  return L.join('\n').trim();
}

// ── CLI: print an ad script — node integrations/hathor-product-ad.mjs kulaswap [--format=short] ──────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0] || 'melek';
  const format = (process.argv.find((a) => a.startsWith('--format=')) || '').split('=')[1] || 'ad';
  const ad = composeProductAd(id, { format });
  if (!ad.ok) { console.error(ad.error, '· try one of:', (ad.products || []).join(', ')); process.exit(1); }
  console.log(adScript(ad));
}

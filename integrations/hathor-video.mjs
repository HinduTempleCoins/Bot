// hathor-video.mjs — the BRAIN of Hathor.Live's CapCut/InVideo-style AI video maker.
//
// Hathor.Live is becoming our dTube/Twitch competitor with an in-house AI video generator. The hard
// part is NOT rendering (the repo already curates ComfyUI / Stable-Video-Diffusion img2video templates
// in genai-comfyui-templates.mjs) — it's the DIRECTOR: turning a one-line brief into a complete,
// renderable plan. This module is that director. Hathor takes a brief and produces a structured
// VIDEO PLAN: hook, script, scene-by-scene storyboard (each with a visual prompt + on-screen caption +
// voiceover line + duration), a captions track with timings, a music mood, and a RENDER MANIFEST that
// maps each scene to a render step (SVD img2video) + an ffmpeg assembly recipe.
//
// The plan is backend-agnostic data: a human editor, a ComfyUI pipeline, or a hosted render service can
// all execute it. Hathor can make her own ads with it; other users get the same composer.
//
// Pure + deterministic (template director) so it works offline with NO model; an LLM (injected, like
// hathor-converse) upgrades the copy to "clever" mode. No network, no keys. Soft-fails, never throws.
//
//   import { composeVideoPlan, FORMATS } from './hathor-video.mjs';
//   const plan = composeVideoPlan({ brief: 'an ad for MELEK Move, the step-counter geo-miner', kind: 'ad', format: 'short' });
//
// CLI:  node integrations/hathor-video.mjs "ad for MELEK Move" --kind=ad --format=short

import { fileURLToPath } from 'node:url';

// injectable LLM seam (tests stay offline; default = llm-router if configured)
let _complete = null;
export function __setComplete(fn) { _complete = typeof fn === 'function' ? fn : null; }

// ── formats (aspect + default length + scene budget) ──────────────────────────────────────────────
export const FORMATS = {
  short:    { aspect: '9:16', durationSec: 30, label: 'Short (vertical, 30s)' },   // TikTok/Reels/Shorts
  ad:       { aspect: '9:16', durationSec: 20, label: 'Ad (vertical, 20s)' },
  explainer:{ aspect: '16:9', durationSec: 60, label: 'Explainer (wide, 60s)' },
  trailer:  { aspect: '16:9', durationSec: 45, label: 'Trailer (wide, 45s)' },
  square:   { aspect: '1:1',  durationSec: 30, label: 'Square (feed, 30s)' },
};
export const KINDS = ['ad', 'explainer', 'short', 'trailer', 'announcement'];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const words = (s) => String(s || '').trim().replace(/\s+/g, ' ');

// ── the deterministic director (no LLM) — produces a real, renderable plan from the brief ─────────
// We turn the brief into a 4-beat arc (Hook → Problem → Reveal → Call) scaled to the scene budget,
// each beat a scene with a visual prompt, caption, and voiceover line. It's templated but specific —
// the brief's own words carry through, so different briefs make different videos.
const ARC = [
  { beat: 'hook',    vo: (s) => `What if ${s} changed everything?`,                visual: (s) => `cinematic establishing shot evoking ${s}, dramatic lighting, shallow depth of field`,   text: (s) => titleCase(s) },
  { beat: 'problem', vo: (s) => `The old way was slow, scattered, unfair.`,         visual: (s) => `moody shot showing the frustration ${s} solves, desaturated, close-up`,                     text: () => `The old way` },
  { beat: 'reveal',  vo: (s) => `${titleCase(s)} — here, now.`,                     visual: (s) => `bright product-hero shot of ${s}, vibrant, confident, motion`,                            text: (s) => titleCase(s) },
  { beat: 'call',    vo: () => `Join us. Move first.`,                              visual: (s) => `uplifting wide shot, sunrise palette, a crowd/community around ${s}`,                     text: () => `Start now →` },
];

function titleCase(s) { return words(s).replace(/^[a-z]/, (c) => c.toUpperCase()); }

function subjectOf(brief) {
  // strip "an ad for / a video about / make a …" framing to get the subject phrase
  return words(String(brief || '')
    .replace(/^\s*(make|create|do|build)\s+/i, '')
    .replace(/^\s*(an?|the)\s+/i, '')
    .replace(/\b(ad|advert|advertisement|video|short|reel|trailer|explainer|clip)\b\s*(for|about|of|on)?\s*/i, '')
    .trim()) || 'MELEK';
}

/** Plan how many scenes fit the duration (≈ one scene per 5–6s, min 3, max 8). */
function sceneCount(durationSec) { return clamp(Math.round(durationSec / 6), 3, 8); }

function buildScenes(subject, n, perSceneSec) {
  const scenes = [];
  for (let i = 0; i < n; i++) {
    // walk the 4-beat arc, repeating the middle beats if there are more scenes than beats
    const a = i === 0 ? ARC[0] : i === n - 1 ? ARC[3] : ARC[1 + ((i - 1) % 2)];
    scenes.push({
      n: i + 1,
      beat: a.beat,
      durationSec: perSceneSec,
      visual: a.visual(subject),
      onScreenText: a.text(subject),
      voiceover: a.vo(subject),
      broll: `b-roll: ${subject}, ${a.beat}`,
    });
  }
  return scenes;
}

// ── captions track (derived timings) ──────────────────────────────────────────────────────────────
function captionsFrom(scenes) {
  let t = 0;
  return scenes.map((s) => {
    const cap = { start: round1(t), end: round1(t + s.durationSec), text: s.onScreenText };
    t += s.durationSec;
    return cap;
  });
}
const round1 = (n) => Math.round(n * 10) / 10;

// ── render manifest — maps the plan onto the existing render path (SVD img2video + ffmpeg) ─────────
function renderManifest(scenes, fmt) {
  return {
    backend: 'comfyui',
    imageModel: 'sdxl (txt2img per scene)',
    videoModel: 'svd-img2video',   // the genai-comfyui-templates.mjs SVD template animates each still
    aspect: fmt.aspect,
    steps: scenes.map((s) => ({
      scene: s.n,
      txt2img: { prompt: s.visual, aspect: fmt.aspect },
      img2video: { template: 'svd-img2video', seconds: s.durationSec, motion: s.beat === 'reveal' ? 'high' : 'medium' },
    })),
    assemble: {
      tool: 'ffmpeg',
      recipe: 'concat scene clips → burn captions track → mix voiceover + music bed → export',
      voiceover: 'tts (per-scene voiceover lines, Hathor voice)',
      captions: 'srt from the captions track',
    },
  };
}

/**
 * Compose a complete, renderable video plan from a brief. Never throws.
 * @param {{ brief?:string, kind?:string, format?:string, durationSec?:number, voiceover?:boolean, cta?:string }} opts
 * @returns {{ ok, brief, subject, kind, format, aspect, durationSec, title, hook, cta, scenes, captions, voiceover, music, renderManifest, usedLLM }}
 */
export function composeVideoPlan({ brief = '', kind = 'ad', format = 'short', durationSec, cta } = {}) {
  const fmt = FORMATS[format] || FORMATS.short;
  const dur = clamp(Number(durationSec) || fmt.durationSec, 6, 180);
  const subject = subjectOf(brief);
  const k = KINDS.includes(kind) ? kind : 'ad';
  const n = sceneCount(dur);
  const perScene = round1(dur / n);
  const scenes = buildScenes(subject, n, perScene);
  const captions = captionsFrom(scenes);
  const voLines = scenes.map((s) => s.voiceover);
  return {
    ok: true,
    brief: words(brief), subject, kind: k, format, aspect: fmt.aspect, durationSec: dur,
    title: titleCase(subject),
    hook: scenes[0].voiceover,
    cta: cta || 'Start now →',
    scenes,
    captions,
    voiceover: { lines: voLines, text: voLines.join(' '), lineCount: voLines.length },
    music: { mood: k === 'ad' || k === 'trailer' ? 'driving, uplifting' : 'calm, contemplative', bpmHint: k === 'ad' ? 120 : 90 },
    renderManifest: renderManifest(scenes, fmt),
    usedLLM: false,
  };
}

/**
 * Clever mode: the same plan, but the copy (title/hook/voiceover/captions) is rewritten by an LLM in
 * Hathor's voice. Falls back to the deterministic plan if no LLM is available or it errs. Never throws.
 */
export async function composeVideoPlanLLM(opts = {}) {
  const base = composeVideoPlan(opts);
  const complete = _complete || (await defaultComplete());
  if (!complete) return base;
  try {
    const persona = await import('./hathor-persona.mjs').then((m) => m.systemPrompt({ grounding: '' })).catch(() => '');
    const prompt = [
      persona,
      `Write the copy for a ${base.durationSec}s ${base.kind} video about: "${base.brief || base.subject}".`,
      `Return STRICT JSON: {"title":"","hook":"","cta":"","scenes":[{"n":1,"onScreenText":"","voiceover":""}]} with exactly ${base.scenes.length} scenes.`,
      'Keep each voiceover line under 16 words and each onScreenText under 6 words. No markdown, JSON only.',
    ].filter(Boolean).join('\n\n');
    const res = await complete(prompt, { task: 'quality', temperature: 0.7, maxTokens: 500 });
    const txt = (typeof res === 'string' ? res : res && res.text) || '';
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    if (j && Array.isArray(j.scenes) && j.scenes.length) {
      const scenes = base.scenes.map((s, i) => ({ ...s, onScreenText: words(j.scenes[i]?.onScreenText) || s.onScreenText, voiceover: words(j.scenes[i]?.voiceover) || s.voiceover }));
      const voLines = scenes.map((s) => s.voiceover);
      return {
        ...base, title: words(j.title) || base.title, hook: words(j.hook) || base.hook, cta: words(j.cta) || base.cta,
        scenes, captions: captionsFrom(scenes), voiceover: { lines: voLines, text: voLines.join(' '), lineCount: voLines.length },
        renderManifest: renderManifest(scenes, FORMATS[base.format] || FORMATS.short), usedLLM: true,
      };
    }
  } catch { /* fall back to the deterministic plan */ }
  return base;
}

async function defaultComplete() {
  try {
    const r = await import('./llm-router.mjs');
    if (typeof r.complete !== 'function') return null;
    if (typeof r.availableProviders === 'function' && !Object.values(r.availableProviders()).some(Boolean)) return null;
    return (p, o) => r.complete(p, o);
  } catch { return null; }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n, d) => { const f = args.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=')[1] : d; };
  const brief = args.filter((a) => !a.startsWith('--')).join(' ');
  if (!brief) { console.error('usage: hathor-video.mjs "<brief>" [--kind=ad] [--format=short] [--sec=20]'); process.exit(1); }
  const plan = composeVideoPlan({ brief, kind: flag('kind', 'ad'), format: flag('format', 'short'), durationSec: Number(flag('sec', '')) || undefined });
  console.log(`🎬 ${plan.title} — ${plan.kind}, ${plan.aspect}, ${plan.durationSec}s, ${plan.scenes.length} scenes`);
  console.log(`HOOK: ${plan.hook}\nCTA:  ${plan.cta}\nMUSIC: ${plan.music.mood} (${plan.music.bpmHint}bpm)\n`);
  for (const s of plan.scenes) console.log(`  [${s.n}] ${s.beat.padEnd(7)} ${s.durationSec}s · "${s.onScreenText}"\n        VO: ${s.voiceover}\n        🎨 ${s.visual}`);
  if (args.includes('--json')) console.log('\n' + JSON.stringify(plan, null, 2));
}

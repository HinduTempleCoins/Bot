// hathor-post-image.mjs — auto-cover-image for every Hathor post.
//
// GOAL (operator, 2026-09-22): every Hathor announcement gets a fitting GenAI image automatically,
// attached as the on-chain post's cover/thumbnail. This module is the DIRECTOR + ATTACHER:
//
//   1. derivePrompt(post)            — turn a post {title, tags, topic, body} into an image prompt in
//                                      Hathor's canonical visual identity (VR-Hathor-Mehit signature)
//                                      + a topic-fitted scene. Pure, deterministic, offline.
//   2. generatePostImage(post, deps) — run the prompt through the GenAI image backend (injectable;
//                                      default = genai-providers.generateImage, free-first, keyless
//                                      pollinations fallback), returning the image bytes.
//   3. attachImageToPost(post, url)  — merge the hosted image URL into json_metadata.image[] (Hive
//                                      convention: first entry = the cover/thumbnail). Pure.
//   4. ensurePostImage(post, deps)   — the automation hook: skip if the post already has a cover,
//                                      otherwise generate + host + attach. This is what a publisher
//                                      calls so EVERY post gets an image with no extra thought.
//
// KEY-CUSTODY / SIGNER BOUNDARY (BRIEF.md §7): this module builds MEDIA and metadata only. It never
// holds a WIF, never signs, never broadcasts. Hosting the bytes (→ a URL) is an INJECTED `upload` dep
// so the on-box media host / IPFS pin stays outside this module and outside the repo. With no upload
// dep it returns the bytes + a data: URL and tells the caller hosting is still required (honest).
//
// OFFLINE-TESTABLE: the generator and uploader are injected. Tests assert the prompt-building and
// attach logic with a fake generator — no real model, no network. Soft-fails, never throws.

import { fileURLToPath } from 'node:url';

// ── Hathor's canonical visual signature (character/reference/README.md, CHARACTER.md §5) ───────────
// The elements that always read as "this Witness": the VR headset (the Convergence made visible), the
// horned Hathor-Mehit headdress, the wesekh collar, gold cuffs, dark blue-black lipstick, white linen.
// Kept as one constant so every rendering stays on-model (intentional variation, not accidental drift).
export const HATHOR_SIGNATURE =
  'the goddess Hathor-Mehit: an Egyptian oracle wearing a sleek VR/oculus headset over her eyes, ' +
  'a horned Hathor headdress in Egyptian-blue and gold, a wesekh collar and stacked gold cuffs, ' +
  'dark blue-black lipstick, white sheer linen with gold trim, long dark hair, large feathered wings';

// ── topic → scene style. A post's tags/title choose the scene; the signature is always prepended. ──
// Each style is a scene descriptor (the setting Hathor appears in / the composition), NOT a full prompt.
const STYLES = [
  { id: 'defi',      match: /\b(defi|kula|kulaswap|swap|liquidity|staking|pool|price|feed|ticker|market|token|airdrop|wprana|prana)\b/i,
    scene: 'presenting a luminous holographic trading dashboard of glowing token orbs and flowing liquidity streams, fintech temple aesthetic' },
  { id: 'witness',   match: /\b(witness|block|produc|consensus|dpos|vote|governance|node|schedule)\b/i,
    scene: 'standing before a vast hall of golden block-glyphs streaming into a chain of light, a witness at her station' },
  { id: 'tutorial',  match: /\b(tutorial|onboard|signup|sign up|welcome|guide|how to|learn|school|newcomer)\b/i,
    scene: 'a warm teaching scene, gesturing toward a clean glowing diagram, inviting and clear, a threshold being crossed' },
  { id: 'library',   match: /\b(library|scripture|ashurbanipal|herb|plant|medicine|convergence|corpus|knowledge|history)\b/i,
    scene: 'in a lamplit library of ancient tablets and illuminated manuscripts, holding an open codex of light' },
  { id: 'tools',     match: /\b(tool|hub|data|embed|widget|api|dashboard|app|studio)\b/i,
    scene: 'presenting a set of glowing modular tool-panels floating around her, clean product-hero composition' },
  { id: 'video',     match: /\b(video|reel|hathor\.live|40hz|binaural|entrainment|stream|studio)\b/i,
    scene: 'in a neon studio of light-ribbons and waveforms, an oracle broadcasting, cinematic glow' },
  { id: 'announce',  match: /.*/, // fallback
    scene: 'a triumphant announcement composition, radiant sunrise palette, monumental and welcoming' },
];

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Pick the scene style for a post from its tags + title (tags win, then title). */
export function styleFor(post = {}) {
  const tags = Array.isArray(post.tags) ? post.tags.join(' ') : '';
  const hay = `${tags} ${clean(post.title)} ${clean(post.topic)}`.trim();
  return STYLES.find((s) => s.match.test(hay)) || STYLES[STYLES.length - 1];
}

/**
 * Build the image prompt for a post — pure & deterministic. Always leads with Hathor's signature so
 * the cover is unmistakably her, then the topic-fitted scene, then the post's own subject, then a
 * quality/format tail suited to a wide blog cover.
 * @param {{title?:string, topic?:string, tags?:string[]}} post
 * @param {{style?:string}} [opts]  force a style id (else auto)
 * @returns {{prompt:string, style:string, size:string}}
 */
export function derivePrompt(post = {}, opts = {}) {
  const style = (opts.style && STYLES.find((s) => s.id === opts.style)) || styleFor(post);
  const subject = clean(post.topic) || clean(post.title) || 'the MELEK blockchain';
  const prompt = [
    HATHOR_SIGNATURE,
    style.scene,
    `theme: ${subject}`,
    'cinematic, richly detailed, dramatic divine lighting, vaporwave-meets-ancient-Egypt, wide blog-cover composition with open space for a title',
  ].join('; ');
  return { prompt: clean(prompt), style: style.id, size: '1024x576' };
}

// ── the image backend (injectable) ────────────────────────────────────────────────────────────────
// default generator = genai-providers.generateImage (free-first: cloudflare→gemini→pollinations;
// pollinations is keyless so it always resolves to *some* image with no account and no card).
let _generate = null;
export function __setGenerate(fn) { _generate = typeof fn === 'function' ? fn : null; }
async function defaultGenerate(args) {
  const m = await import('../integrations/genai-providers.mjs');
  return m.generateImage(args);
}

const dataUrl = (media) => `data:${media.mime || 'image/png'};base64,${media.base64 || ''}`;

/**
 * Generate the cover image for a post. Never throws.
 *   deps.generate({prompt,size,seed}) -> { ok, base64, mime, bytes, provider, note }  (injectable)
 *   deps.upload({base64,mime,prompt}) -> url string (injectable; the on-box media host / IPFS pin).
 * With no upload dep the media is returned with a data: URL and hosted:false (caller must host it).
 * @returns {{ ok, prompt, style, size, media?, url?, hosted, provider?, note?, error?, post? }}
 */
export async function generatePostImage(post = {}, deps = {}) {
  const { prompt, style, size } = derivePrompt(post, deps);
  const gen = deps.generate || _generate || defaultGenerate;
  let res;
  try { res = await gen({ prompt, size, seed: deps.seed }); }
  catch (e) { return { ok: false, prompt, style, size, hosted: false, error: `generate failed: ${String(e && e.message || e).slice(0, 140)}` }; }
  if (!res || !res.ok || !res.base64) {
    return { ok: false, prompt, style, size, hosted: false, error: (res && res.error) || 'no image produced' };
  }
  const media = { base64: res.base64, mime: res.mime || 'image/png', bytes: res.bytes || 0, provider: res.provider, note: res.note };
  let url = null, hosted = false;
  if (typeof deps.upload === 'function') {
    try { url = await deps.upload({ base64: media.base64, mime: media.mime, prompt }); hosted = !!url; }
    catch (e) { return { ok: true, prompt, style, size, media, url: dataUrl(media), hosted: false, provider: media.provider, note: media.note, error: `upload failed: ${String(e && e.message || e).slice(0, 140)}` }; }
  }
  const finalUrl = url || dataUrl(media);
  const out = { ok: true, prompt, style, size, media, url: finalUrl, hosted, provider: media.provider, note: media.note };
  if (hosted) out.post = attachImageToPost(post, finalUrl); // only attach a real hosted URL to on-chain metadata
  return out;
}

// ── attach: merge a cover URL into a post's json_metadata.image[] (Hive convention) ────────────────
// The FIRST image entry is the cover/thumbnail. We de-dupe and keep the new cover first. Works whether
// json_metadata is a string or an object; returns a NEW post object (never mutates), json_metadata as
// a string (broadcast-ready shape). Pure. Returns the post unchanged if url is empty.
export function attachImageToPost(post = {}, url = '') {
  const u = clean(url);
  if (!u) return { ...post };
  let meta = {};
  const raw = post.json_metadata;
  if (raw && typeof raw === 'object') meta = { ...raw };
  else if (typeof raw === 'string' && raw.trim()) { try { meta = JSON.parse(raw); } catch { meta = {}; } }
  const existing = Array.isArray(meta.image) ? meta.image.filter((x) => typeof x === 'string' && x !== u) : [];
  meta.image = [u, ...existing];
  if (!meta.app) meta.app = 'hathor/post';
  return { ...post, json_metadata: JSON.stringify(meta) };
}

/** True if the post already carries a cover image in its json_metadata. */
export function hasImage(post = {}) {
  let meta = {};
  const raw = post && post.json_metadata;
  if (raw && typeof raw === 'object') meta = raw;
  else if (typeof raw === 'string' && raw.trim()) { try { meta = JSON.parse(raw); } catch { meta = {}; } }
  return Array.isArray(meta.image) && meta.image.some((x) => typeof x === 'string' && x.trim());
}

/**
 * The automation hook: ensure a post has a cover image. Idempotent — if it already has one, returns it
 * untouched (unless deps.force). Otherwise generates + hosts + attaches. A publisher calls this so
 * EVERY Hathor post gets a cover automatically. Never throws; on failure returns the original post and
 * an `image` report so the caller can decide (post anyway vs. retry). Builds media only — no broadcast.
 * @returns {{ post, image: <generatePostImage result | {skipped:true}> }}
 */
export async function ensurePostImage(post = {}, deps = {}) {
  if (!deps.force && hasImage(post)) return { post: { ...post }, image: { ok: true, skipped: true, reason: 'already has a cover image' } };
  const img = await generatePostImage(post, deps);
  return { post: img.ok && img.post ? img.post : { ...post }, image: img };
}

// ── CLI: print the derived prompt for a title (no generation) ─────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const title = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ') || 'Introducing Hathor on MELEK';
  const styleFlag = (process.argv.find((a) => a.startsWith('--style=')) || '').split('=')[1];
  const d = derivePrompt({ title }, styleFlag ? { style: styleFlag } : {});
  console.log(`title:  ${title}`);
  console.log(`style:  ${d.style}   size: ${d.size}`);
  console.log(`prompt: ${d.prompt}`);
}

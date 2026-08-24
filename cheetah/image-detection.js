/**
 * image-detection.js — Cheetah's image-attribution step (Step 6). Operator 2026-06-01: use the
 * APIs we already have (Gemini Vision), NOT a GPU. Same posture as text-detection: it STATES where
 * an image (or its content) also appears — it never decides "guilt." A vision model DESCRIBES the
 * image + extracts any embedded text/watermark/source; that description then feeds the same
 * source-matching the text path uses. A reverse-image-search API (keyed) is the ideal "where else
 * does this exact image appear" and is pluggable via CHEETAH_REVERSE_IMAGE.
 *
 * Keys come from the environment (vault/gate-provided), never hard-coded.
 *
 *   detectImage(imageUrl) -> { match, source, confidence, description, extractedText }
 */

import { findSimilarOnChain, findSimilarOnWeb } from './text-detection.js';
import { imageHash, findOriginal } from './perceptual-hash.js';

const GEMINI_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const REVERSE_BACKEND = process.env.CHEETAH_REVERSE_IMAGE || 'none'; // 'bing' | 'serpapi' | 'none'
const UA = 'MELEK-Cheetah/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// The single vision instruction, shared by every provider (free ladder + gated Gemini).
const VISION_PROMPT =
  'Describe this image factually in one sentence, then on a new line after "TEXT:" transcribe any ' +
  'text, watermark, signature, or source/URL visible in it (or "none"). Do not speculate about ownership.';

// fetch is injectable so the logic can be tested without network or a real key.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function fetchImageBase64(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`image HTTP ${r.status}`);
    const mime = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    return { mime, data: buf.toString('base64') };
  } finally { clearTimeout(t); }
}

// Split a vision model's "<desc>\nTEXT: <embedded>" reply into our shape. "none" -> empty.
function parseVision(out) {
  const [desc, ...rest] = String(out || '').split(/\n?TEXT:/i);
  return {
    description: (desc || '').trim(),
    extractedText: (rest.join(' ') || '').trim().replace(/^none\.?$/i, ''),
  };
}

// FREE-FIRST vision ladder. Each rung is an OpenAI-compatible /chat/completions vision endpoint,
// gated by its own env key and skipped when the key is absent. Reuses the SAME env var names as
// guest-api-proxy.js so whatever free key is already on the box is picked up. Keys read at call
// time (vault-JIT friendly). Order: Groq -> OpenRouter -> Cloudflare Workers-AI. Model ids are
// env-overridable so the operator can retune without a code change. NO paid provider here.
function freeVisionProviders() {
  const out = [];
  if (process.env.GROQ_API_KEY) out.push({
    name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions',
    key: process.env.GROQ_API_KEY,
    model: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
  });
  if (process.env.OPENROUTER_API_KEY) out.push({
    name: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions',
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_VISION_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct:free',
  });
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) out.push({
    name: 'cloudflare',
    url: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
    key: process.env.CLOUDFLARE_API_TOKEN,
    model: process.env.CLOUDFLARE_VISION_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct',
  });
  return out;
}

// One OpenAI-compatible vision call (data-URL image). Throws on non-OK so the ladder falls through.
async function callOpenAIVision(p, img) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await _fetch(p.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA, authorization: `Bearer ${p.key}` },
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } },
        ] }],
        temperature: 0.2,
        max_tokens: 512,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`${p.name} HTTP ${r.status}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || '';
  } finally { clearTimeout(t); }
}

// Gemini Vision — METERED, so OFF by default. Only reached when the operator explicitly opts in with
// LLM_ALLOW_GEMINI=1 (mirrors the $0 hard-pin in integrations/llm-router.mjs). NOT a guilt call.
async function callGeminiVision(img) {
  const key = process.env.GEMINI_API_KEY || '';
  const body = {
    contents: [{ parts: [
      { text: VISION_PROMPT },
      { inline_data: { mime_type: img.mime, data: img.data } },
    ] }],
  };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await _fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify(body), signal: ctrl.signal });
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } finally { clearTimeout(t); }
}

// Describe the image + pull any embedded text/watermark/source clue, FREE-FIRST. Tries every free
// vision provider whose key is present (Groq/OpenRouter/Cloudflare) in order; only if none are
// configured AND the operator has opted into the metered tier (LLM_ALLOW_GEMINI=1) does it touch
// Gemini. With no free key and no opt-in it soft-returns a note — the caller (detectImage) then
// still credits via the keyless perceptual-hash + reverse-image + text paths. Never throws.
export async function describeImage(imageUrl) {
  const free = freeVisionProviders();
  const geminiAllowed = process.env.LLM_ALLOW_GEMINI === '1' && Boolean(process.env.GEMINI_API_KEY);
  if (!free.length && !geminiAllowed) {
    return { description: '', extractedText: '', note: 'no free vision key; Gemini gated off (set a free key, or LLM_ALLOW_GEMINI=1)' };
  }
  let img;
  try { img = await fetchImageBase64(imageUrl); }
  catch (e) { return { description: '', extractedText: '', note: `image fetch failed: ${e.message}` }; }

  for (const p of free) {
    try {
      const out = await callOpenAIVision(p, img);
      if (out.trim()) return parseVision(out);
    } catch { /* free rung failed — fall through to the next free provider */ }
  }
  if (geminiAllowed) {
    try {
      const out = await callGeminiVision(img);
      return parseVision(out);
    } catch (e) { return { description: '', extractedText: '', note: `gemini vision failed: ${e.message}` }; }
  }
  return { description: '', extractedText: '', note: 'all free vision providers failed' };
}

// optional reverse-image search (keyed). Returns matches [{url,title}] or [].
async function reverseImageSearch(imageUrl) {
  if (REVERSE_BACKEND === 'none') return [];
  const key = process.env.CHEETAH_REVERSE_IMAGE_KEY || '';
  if (!key) return [];
  try {
    if (REVERSE_BACKEND === 'serpapi') {
      const r = await _fetch(`https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(imageUrl)}&api_key=${key}`, { headers: { 'user-agent': UA } });
      const j = await r.json();
      return (j.visual_matches || []).slice(0, 5).map(m => ({ url: m.link, title: m.title }));
    }
    if (REVERSE_BACKEND === 'bing') {
      const r = await _fetch('https://api.bing.microsoft.com/v7.0/images/visualsearch', { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'content-type': 'application/json' }, body: JSON.stringify({ imageInfo: { url: imageUrl } }) });
      const j = await r.json();
      const tag = (j.tags || []).flatMap(t => t.actions || []).find(a => a.actionType === 'PagesIncluding');
      return (tag?.data?.value || []).slice(0, 5).map(m => ({ url: m.hostPageUrl, title: m.name }));
    }
  } catch { /* fall through */ }
  return [];
}

// the public entry: state where this image (or its content) also appears. Credit-first, no accusation.
export async function detectImage(imageUrl, opts = {}) {
  const { description, extractedText, note } = await describeImage(imageUrl).catch(() => ({ description: '', extractedText: '' }));
  // 0. perceptual-hash credit check (keyless, legally-meaningful): did THIS image
  //    appear earlier on our chain? If so, credit the earliest poster. Strongest,
  //    cheapest signal — runs before any API call. Skipped if jimp/decoder absent.
  if (opts.creditIndex !== false) {
    const hash = await imageHash(imageUrl).catch(() => null);
    if (hash) {
      const credit = await findOriginal(hash, { before: opts.before }, opts.hashStorePath).catch(() => null);
      if (credit?.match) {
        return { match: true, source: { kind: 'on-chain-original', author: credit.original.author, permlink: credit.original.permlink, seen_at: credit.original.seen_at }, confidence: credit.confidence, phash: hash, appearances: credit.appearances, description, extractedText };
      }
    }
  }
  // 1. direct reverse-image hits (strongest open-web "this exact image appears here")
  const reverse = await reverseImageSearch(imageUrl);
  if (reverse.length) return { match: true, source: { kind: 'reverse-image', url: reverse[0].url, title: reverse[0].title }, confidence: 0.8, description, extractedText, all_matches: reverse };
  // 2. if the image carries text/a source, match that text the same way the text path does
  const probe = (extractedText || description || '').trim();
  if (probe.length >= 12) {
    const web = await findSimilarOnWeb(probe, opts).catch(() => null);
    const chain = await findSimilarOnChain(probe, opts).catch(() => null);
    const best = [web, chain].filter(Boolean).sort((a, b) => (b?.confidence || 0) - (a?.confidence || 0))[0];
    if (best?.match) return { match: true, source: best.source, confidence: best.confidence, description, extractedText };
  }
  return { match: false, source: null, confidence: 0, description, extractedText, note };
}

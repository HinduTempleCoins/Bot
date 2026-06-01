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

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
const REVERSE_BACKEND = process.env.CHEETAH_REVERSE_IMAGE || 'none'; // 'bing' | 'serpapi' | 'none'
const UA = 'MELEK-Cheetah/1.0 (+https://github.com/HinduTempleCoins/Bot)';

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

// Gemini Vision: describe the image + pull any embedded text/watermark/source clue. NOT a guilt call.
export async function describeImage(imageUrl) {
  if (!GEMINI_KEY) return { description: '', extractedText: '', note: 'no GEMINI_API_KEY (vault/gate)' };
  const img = await fetchImageBase64(imageUrl);
  const body = {
    contents: [{ parts: [
      { text: 'Describe this image factually in one sentence, then on a new line after "TEXT:" transcribe any text, watermark, signature, or source/URL visible in it (or "none"). Do not speculate about ownership.' },
      { inline_data: { mime_type: img.mime, data: img.data } },
    ] }],
  };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await _fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify(body), signal: ctrl.signal });
    const j = await r.json();
    const out = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const [desc, ...rest] = out.split(/\n?TEXT:/i);
    return { description: (desc || '').trim(), extractedText: (rest.join(' ') || '').trim().replace(/^none\.?$/i, '') };
  } finally { clearTimeout(t); }
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
  // 1. direct reverse-image hits (strongest "this exact image appears here")
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

// pentecaust/connect/byok-image.mjs — make a picture with the USER'S OWN provider key (the fast lane).
//
// Our own CPU pool makes a picture in a few minutes and is shared by everyone. A user who has connected
// their own OpenAI / Stability / fal / Replicate key in Integrations gets their picture in seconds, on
// their own quota. This module is the only place a user's key is spent on graphics, and it sends that key
// to exactly one host — the provider's own (apikeys.PROVIDERS[].host, checked again here).
//
// The result is always returned as a data URL (base64 image) so nothing is rehosted and no third-party
// URL expires in someone's draft. Soft-fails to { ok:false, reason } — never throws, never leaks the key.
//
//   import { generateImage, IMAGE_PROVIDERS } from './byok-image.mjs'

import { useKey, providerById } from './apikeys.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** providers this module can draw with, best first */
export const IMAGE_PROVIDERS = ['openai', 'stability', 'fal', 'replicate'];

const SIZES = { wide: '1536x1024', square: '1024x1024', tall: '1024x1536' };
export const sizeOf = (s) => SIZES[s] || (/^\d{3,4}x\d{3,4}$/.test(String(s || '')) ? String(s) : SIZES.square);

const dataUrl = (b64, mime = 'image/png') => `data:${mime};base64,${b64}`;

async function asJson(res) {
  if (!res || !res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// Each drawer returns a data URL string, or null. It MUST only call its own provider host.
const DRAWERS = {
  async openai(key, prompt, size) {
    const r = await _fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: sizeOf(size), n: 1 }),
    });
    const j = await asJson(r);
    const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
    return b64 ? dataUrl(b64) : null;
  },
  async stability(key, prompt, size) {
    const [w, h] = sizeOf(size).split('x').map(Number);
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('output_format', 'png');
    form.append('aspect_ratio', w > h ? '3:2' : h > w ? '2:3' : '1:1');
    const r = await _fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, body: form,
    });
    const j = await asJson(r);
    return j && j.image ? dataUrl(j.image) : null;
  },
  async fal(key, prompt, size) {
    const [w, h] = sizeOf(size).split('x').map(Number);
    const r = await _fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: { width: w, height: h }, num_images: 1 }),
    });
    const j = await asJson(r);
    const url = j && j.images && j.images[0] && j.images[0].url;
    if (!url) return null;
    if (String(url).startsWith('data:')) return url;
    const img = await _fetch(url);
    if (!img || !img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    return dataUrl(buf.toString('base64'));
  },
  async replicate(key, prompt, size) {
    const [w, h] = sizeOf(size).split('x').map(Number);
    const r = await _fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({ input: { prompt, aspect_ratio: w > h ? '3:2' : h > w ? '2:3' : '1:1' } }),
    });
    const j = await asJson(r);
    const out = j && (Array.isArray(j.output) ? j.output[0] : j.output);
    if (!out) return null;
    const img = await _fetch(String(out));
    if (!img || !img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    return dataUrl(buf.toString('base64'));
  },
};

/**
 * Draw with this account's own key.
 * @param {string} account  the signed-in Pentecaust account
 * @param {{prompt:string,size?:string,provider?:string}} req
 * @param {object} opts     { file } for tests
 * @returns {Promise<{ok:true,image:string,provider:string}|{ok:false,reason:string}>}
 */
export async function generateImage(account, req = {}, opts = {}) {
  const prompt = String(req.prompt || '').slice(0, 1000).trim();
  if (!prompt) return { ok: false, reason: 'Describe the picture first.' };
  const wanted = req.provider ? [String(req.provider).toLowerCase()] : IMAGE_PROVIDERS;
  for (const id of wanted) {
    const p = providerById(id);
    if (!p || !DRAWERS[id]) continue;
    const r = await useKey(account, id, (key) => DRAWERS[id](key, prompt, req.size), opts);
    if (r.ok && r.result) return { ok: true, image: r.result, provider: id };
  }
  return { ok: false, reason: 'no-key' };     // the caller falls back to our own CPU pool
}

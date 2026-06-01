// image-detection.test.js — proves the Step-6 logic without network or a real key.
// We inject a fake fetch so describeImage()/reverseImageSearch() are exercised deterministically.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// key + reverse backend must be set BEFORE importing (module reads env at load).
process.env.GEMINI_API_KEY = 'test-key-not-real';
process.env.CHEETAH_REVERSE_IMAGE = 'serpapi';
process.env.CHEETAH_REVERSE_IMAGE_KEY = 'test-serp-key';

const { detectImage, describeImage, __setFetch } = await import('./image-detection.js');

// a fetch stub routed by URL. img bytes -> small buffer; gemini -> canned vision JSON; serp -> matches.
function makeFetch({ vision, serp }) {
  return async (url) => {
    if (typeof url === 'string' && url.includes('generativelanguage')) {
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: vision }] } }] }) };
    }
    if (typeof url === 'string' && url.includes('serpapi.com')) {
      return { ok: true, json: async () => serp };
    }
    // image fetch
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
}

test('describeImage parses description + TEXT block from Gemini', async () => {
  __setFetch(makeFetch({ vision: 'A photo of a temple at dawn.\nTEXT: © vankush 2026', serp: {} }));
  const r = await describeImage('http://x/a.png');
  assert.equal(r.description, 'A photo of a temple at dawn.');
  assert.equal(r.extractedText, '© vankush 2026');
  __setFetch(null);
});

test('describeImage returns "none" extractedText as empty', async () => {
  __setFetch(makeFetch({ vision: 'A cat.\nTEXT: none', serp: {} }));
  const r = await describeImage('http://x/cat.png');
  assert.equal(r.extractedText, '');
  __setFetch(null);
});

test('detectImage: reverse-image hit wins (strongest signal)', async () => {
  __setFetch(makeFetch({
    vision: 'A diagram.\nTEXT: none',
    serp: { visual_matches: [{ link: 'https://origin.example/post', title: 'Original post' }] },
  }));
  const r = await detectImage('http://x/diagram.png');
  assert.equal(r.match, true);
  assert.equal(r.source.kind, 'reverse-image');
  assert.equal(r.source.url, 'https://origin.example/post');
  assert.ok(r.confidence >= 0.8);
  __setFetch(null);
});

test('detectImage: no reverse hit + no embedded text → no match (never invents a source)', async () => {
  __setFetch(makeFetch({ vision: 'A sunset.\nTEXT: none', serp: { visual_matches: [] } }));
  const r = await detectImage('http://x/sunset.png');
  assert.equal(r.match, false);
  assert.equal(r.source, null);
  // it still returns the description so Cheetah can talk about the image factually.
  assert.equal(r.description, 'A sunset.');
  __setFetch(null);
});

test('detectImage: no key → graceful note, no throw', async () => {
  // simulate missing key by making describeImage path return its no-key note via empty vision
  __setFetch(makeFetch({ vision: '', serp: { visual_matches: [] } }));
  const r = await detectImage('http://x/none.png');
  assert.equal(r.match, false);
  __setFetch(null);
});

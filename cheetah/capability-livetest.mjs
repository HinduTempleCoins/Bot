// cheetah-livetest.mjs — LIVE exercise of every Cheetah detector with real inputs, writes a JSON
// the alpha /cheetah/ page renders. Run on the box (keys + jimp + chain local). No chain writes.
import fs from 'node:fs';
import * as text from './text-detection.js';
import * as disc from './discovery.js';
import * as phash from './perceptual-hash.js';
import * as imgdet from './image-detection.js';

// Give the image fetchers a real browser UA (some hosts 400 a generic bot UA).
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const browserFetch = (u, o = {}) => globalThis.fetch(u, { ...o, headers: { 'user-agent': UA, ...(o.headers || {}) } });
phash.__setFetch(browserFetch);
imgdet.__setFetch(browserFetch);

const OUT = process.env.OUT || './.capability-livetest.json';
const log = (...a) => console.log(...a);
const results = { generated: new Date().toISOString(), tests: [] };

// ── 1. TEXT PLAGIARISM (shingle + Jaccard vs a known corpus) ─────────────────
{
  const original = 'The witness produces blocks and publishes a price feed every hour on the MELEK testnet.';
  const corpus = [
    { author: 'someone', permlink: 'orig', body: original, created: '2026-06-01T00:00:00' },
    { author: 'other', permlink: 'unrelated', body: 'A recipe for sourdough bread needs flour water salt and patience over many hours.', created: '2026-06-01T00:00:00' },
  ];
  const nearCopy = 'The witness produces blocks and publishes a price feed every hour on the MELEK testnet!!';
  const novel = 'Quantum entanglement lets two distant particles share a correlated state instantly.';
  const hit = await text.findSimilarOnChain(nearCopy, { corpus });
  const miss = await text.findSimilarOnChain(novel, { corpus });
  results.tests.push({ capability: 'Text plagiarism', engine: 'shingle + Jaccard (on-chain corpus)',
    cases: [
      { input: 'near-verbatim copy of an existing post', verdict: hit.matches[0] ? 'MATCH' : 'clear', confidence: hit.matches[0]?.confidence ?? 0, against: hit.matches[0]?.permlink || '—' },
      { input: 'a genuinely novel sentence', verdict: miss.matches[0]?.confidence > 0.5 ? 'MATCH' : 'ORIGINAL', confidence: miss.matches[0]?.confidence ?? 0 },
    ] });
  log('1 TEXT:', JSON.stringify(results.tests.at(-1).cases));
}

// ── 2. DISCOVERY / CITATIONS (related prior work → "see also") ────────────────
{
  const corpus = [
    { author: 'a', permlink: 'feeds', body: 'A witness must publish the price feed regularly. The price feed tells the chain the value of the token so reward and conversion math stays correct for everyone.' },
    { author: 'b', permlink: 'cats', body: 'Domestic cats sleep twelve to sixteen hours a day and groom themselves frequently throughout the afternoon.' },
  ];
  const post = { body: 'New witness guide: how to publish the price feed reliably, why the price feed matters for the token value, and how reward math depends on it.' };
  const d = disc.discover(post, { corpus });
  results.tests.push({ capability: 'Discovery / citations', engine: 'relatedness band (see-also librarian)',
    cases: [{ input: 'a witness guide vs a corpus with a price-feed article + a cats article',
      verdict: d.related.length ? 'SEE ALSO ' + d.related.length + ' related' : 'no related',
      related: d.related.map(r => ({ permlink: r.permlink, score: Number(r.score?.toFixed?.(3) ?? r.score) })),
      note: (d.note || '').slice(0, 160) }] });
  log('2 DISCOVERY:', JSON.stringify(results.tests.at(-1).cases));
}

// ── 3. PERCEPTUAL-HASH IMAGE DUPLICATE (dHash + Hamming, real images) ─────────
{
  const A1 = 'https://picsum.photos/id/237/320/240';
  const A2 = 'https://picsum.photos/id/237/480/360'; // same source image, bigger render
  const B  = 'https://picsum.photos/id/1062/320/240';
  const [h1, h2, hb] = await Promise.all([phash.imageHash(A1), phash.imageHash(A2), phash.imageHash(B)]);
  const dupDist = (h1 && h2) ? phash.hammingDistance(h1, h2) : null;
  const diffDist = (h1 && hb) ? phash.hammingDistance(h1, hb) : null;
  results.tests.push({ capability: 'Image duplicate (perceptual hash)', engine: 'dHash + Hamming distance (jimp)',
    cases: [
      { input: 'same source photo at two sizes', verdict: dupDist != null && dupDist <= phash.HAMMING_MATCH_MAX ? 'DUPLICATE' : 'distinct', hamming: dupDist, threshold: phash.HAMMING_MATCH_MAX },
      { input: 'photo A vs an unrelated photo B', verdict: diffDist != null && diffDist > phash.HAMMING_MATCH_MAX ? 'DISTINCT' : 'match?', hamming: diffDist, threshold: phash.HAMMING_MATCH_MAX },
    ] });
  log('3 PHASH:', JSON.stringify(results.tests.at(-1).cases));
}

// ── 4. IMAGE RECOGNITION (Gemini Vision: describe + extract any text/watermark) ─
{
  const imgUrl = 'https://picsum.photos/id/237/512/384';
  let desc; try { desc = await imgdet.describeImage(imgUrl); } catch (e) { desc = { description: 'error: ' + e.message, extractedText: '' }; }
  results.tests.push({ capability: 'Image recognition', engine: 'Gemini Vision (describe + OCR text/watermark)',
    cases: [{ input: 'a real photo (picsum id 237)', description: (desc.description || desc.note || '').slice(0, 200), extractedText: (desc.extractedText || '').slice(0, 80) }] });
  log('4 IMAGE-RECOG:', JSON.stringify(results.tests.at(-1).cases));
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
log('WROTE', OUT);

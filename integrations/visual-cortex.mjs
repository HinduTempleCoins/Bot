// visual-cortex.mjs — Hathor's OCCIPITAL LOBE: visual acuity, wired from Cheetah's systems.
//
// Operator (2026-06-20): "connect her to Cheetah's systems, but differently — Cheetah's systems are part
// of the Resource Center, and that can begin to be her visual acuity." Cheetah already perceives images
// (Gemini Vision, NOT a GPU): `describeImage` → {description, extractedText}; `detectImage` → adds where
// the image appears (match/source/confidence). Cheetah uses that to POLICE (attribution/theft). This lobe
// uses the SAME organs DIFFERENTLY — as Hathor's PERCEPTION: "what am I looking at, what does it say, does
// it matter, have I seen it before." It routes the description through the amygdala so a seen image gets a
// salience/threat read, and returns one clean percept the Language Center / Hathor can speak from.
//
// Pure orchestration: the Cheetah organs are INJECTED (so it's offline-testable and doesn't drag in keys).
// Soft-fails to a blind-but-not-broken percept. House style: ESM, CLI guard, handler(req,res).

import { scoreSalience } from './amygdala.mjs';

/**
 * See one image — Hathor's visual percept.
 * @param {string} imageUrl
 * @param {object} deps injected Cheetah organs (all optional, soft-fail):
 *   describeImage(url) -> { description, extractedText, note? }
 *   detectImage(url)   -> { match, source, confidence, description, extractedText }
 *   seen?:Set<string>  — novelty across a stream of frames
 * @returns {Promise<{ url, description, text, salience, tags, known, source, confidence, blind }>}
 */
export async function see(imageUrl, deps = {}) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return blindPercept(imageUrl, 'no-image');
  }
  let description = '';
  let text = '';
  let known = false;
  let source = null;
  let confidence = 0;

  // Prefer detectImage (richer: description + attribution); fall back to describeImage; else blind.
  try {
    if (typeof deps.detectImage === 'function') {
      const d = await deps.detectImage(imageUrl);
      description = (d && d.description) || '';
      text = (d && d.extractedText) || '';
      known = !!(d && d.match);
      source = (d && d.source) || null;
      confidence = Number(d && d.confidence) || 0;
    } else if (typeof deps.describeImage === 'function') {
      const d = await deps.describeImage(imageUrl);
      description = (d && d.description) || '';
      text = (d && d.extractedText) || '';
    } else {
      return blindPercept(imageUrl, 'no-organ');
    }
  } catch {
    return blindPercept(imageUrl, 'organ-error');
  }

  if (!description && !text) return blindPercept(imageUrl, 'nothing-perceived');

  // Route the percept through the amygdala — a described scene can be urgent/threatening (a scam image,
  // a violent frame) or important; gives Hathor an emotional read on what she sees.
  const sal = scoreSalience(`${description} ${text}`.trim(), { seen: deps.seen });
  return {
    url: imageUrl,
    description,
    text,
    salience: sal.salience,
    tags: sal.tags,
    known,         // Cheetah recognized it from chain/web
    source,        // where it was seen before (if known)
    confidence,
    blind: false,
  };
}

function blindPercept(url, why) {
  return { url: url || null, description: '', text: '', salience: 0, tags: [], known: false, source: null, confidence: 0, blind: true, why };
}

// See several frames/images in order, sharing one novelty set (so a video's repeated frames don't all
// read as novel). Returns percepts newest-salient first is NOT applied — order is preserved (it's a stream).
export async function watch(urls, deps = {}) {
  const seen = deps.seen || new Set();
  const out = [];
  for (const u of urls || []) out.push(await see(u, { ...deps, seen }));
  return out;
}

// One spoken-ready line Hathor can say about what she sees.
export function describePercept(p) {
  if (!p || p.blind) return 'I cannot make out the image right now.';
  const bits = [p.description];
  if (p.text) bits.push(`It reads: "${p.text.slice(0, 120)}".`);
  if (p.known && p.source) bits.push(`I have seen this before — ${p.source}.`);
  if (p.tags.includes('threat')) bits.push('Something about it puts me on guard.');
  return bits.filter(Boolean).join(' ');
}

export function handler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let url = '';
    try { url = (JSON.parse(body || '{}').url) || ''; } catch {}
    // handler has no Cheetah organs injected here (would be wired on the box); returns the blind shape.
    const p = await see(url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(p, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // demo with a stub organ
  const describeImage = async () => ({ description: 'a burning rooftop at night with a winged figure overhead', extractedText: '' });
  see('demo://x', { describeImage }).then((p) => console.log(describePercept(p), '\n', p));
}

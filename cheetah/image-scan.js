/**
 * image-scan.js — connect the image credit-giver into Cheetah's scan loop.
 *
 * The library pieces (perceptual-hash credit index, Gemini vision, reverse-image) live in
 * image-detection.js / perceptual-hash.js. This module is the glue that makes a POST flow
 * through them: pull the images out of a post body, ask "where did this first appear?", and
 * record the image so LATER posts can be credited against it. Credit-first, fact-stating.
 */

import { detectImage } from './image-detection.js';
import { imageHash, indexImage } from './perceptual-hash.js';

// pull image URLs from a post body: markdown ![alt](url), <img src="">, and bare image links.
export function extractImageUrls(body = '') {
  const urls = new Set();
  const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  const img = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
  const bare = /(https?:\/\/[^\s)"'<>]+\.(?:png|jpe?g|gif|webp|bmp))/gi;
  let m;
  while ((m = md.exec(body))) urls.add(m[1]);
  while ((m = img.exec(body))) urls.add(m[1]);
  while ((m = bare.exec(body))) urls.add(m[1]);
  // De-dupe truncated duplicates: the bare-URL regex stops at the extension, so an image URL with
  // a query string (e.g. `img.jpg?w=600` or `pic.png&text=x`) is captured both full (markdown/img)
  // and truncated (bare). Drop any URL that is a strict prefix of another captured URL — the longer
  // one is the real, complete URL. (Without this, a 5-image post counts as 10.)
  const all = [...urls];
  return all.filter((u) => !all.some((v) => v !== u && v.startsWith(u)));
}

/**
 * Scan every image in a post. For each: find where it first appeared (credit), then index
 * THIS post's image so future reposts can be credited to whoever is earliest. Returns
 * { findings, indexed } — findings are positive credit matches (someone posted it earlier).
 * `before` (default the post's own timestamp) keeps a post from being "credited" to itself.
 */
export async function scanPostImages(post, opts = {}) {
  const urls = extractImageUrls(post.body || '');
  const findings = [];
  let indexed = 0;
  const before = opts.before || post.created || undefined;
  for (const url of urls) {
    // 1. who, if anyone, posted this image earlier?
    const det = await detectImage(url, { before, hashStorePath: opts.hashStorePath, ...opts }).catch(() => null);
    if (det?.match) findings.push({ url, source: det.source, confidence: det.confidence, phash: det.phash, description: det.description });
    // 2. record this post's image so it's creditable from here forward (skip in dry-run if asked).
    if (!opts.noIndex) {
      const hash = det?.phash || (await imageHash(url).catch(() => null));
      if (hash) {
        const r = await indexImage({ hash, author: post.author, permlink: post.permlink, seenAt: post.created }, opts.hashStorePath);
        if (r.indexed) indexed++;
      }
    }
  }
  return { findings, indexed, imageCount: urls.length };
}

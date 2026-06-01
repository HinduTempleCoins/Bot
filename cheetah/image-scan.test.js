// image-scan.test.js — the image credit-giver wired into the scan flow. Uses injected decode +
// fetch so no network/jimp; proves: URL extraction, earliest-poster credit, and indexing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { extractImageUrls, scanPostImages } from './image-scan.js';
import * as ph from './perceptual-hash.js';
import * as det from './image-detection.js';

function tmp(t) { return join(tmpdir(), `cheetah-imgscan-${t}-${process.pid}.json`); }

// deterministic decode: map a URL to a fixed gray matrix so the same url -> same hash, and two
// different urls -> different hashes.
function decoderFor(urlToShade) {
  return (buf) => { // buf carries the shade via our injected fetch below
    const shade = buf[0];
    const g = new Array(72);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) g[y * 9 + x] = (x % 2 ? shade : 255 - shade);
    return { gray: g, w: 9, h: 8 };
  };
}

test('extractImageUrls finds markdown, html, and bare image links', () => {
  const body = 'see ![cat](https://a.com/c.png) and <img src="https://b.com/d.jpg"> and https://e.com/f.gif here';
  const urls = extractImageUrls(body);
  assert.ok(urls.includes('https://a.com/c.png'));
  assert.ok(urls.includes('https://b.com/d.jpg'));
  assert.ok(urls.includes('https://e.com/f.gif'));
  assert.equal(urls.length, 3);
});

test('a repost is credited to the earliest poster, and images get indexed', async () => {
  const path = tmp('credit');
  await rm(path, { force: true });
  // fetch returns a 1-byte buffer whose value is the URL's "shade" (same url -> same bytes -> same hash)
  const shadeOf = (url) => (url.includes('shared') ? 50 : 200);
  det.__setFetch(async (url) => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([shadeOf(url)]).buffer }));
  ph.__setFetch(async (url) => ({ ok: true, arrayBuffer: async () => new Uint8Array([shadeOf(url)]).buffer }));
  ph.__setDecoder(decoderFor());
  det.__setDecoder?.(decoderFor());

  // alice posts the shared image first
  const r1 = await scanPostImages(
    { author: 'alice', permlink: 'orig', created: '2026-01-01T00:00:00Z', body: '![x](https://img/shared.png)' },
    { hashStorePath: path }
  );
  assert.equal(r1.findings.length, 0); // first poster -> no prior credit
  assert.equal(r1.indexed, 1);

  // bob reposts the SAME image later -> credited to alice
  const r2 = await scanPostImages(
    { author: 'bob', permlink: 'repost', created: '2026-03-01T00:00:00Z', body: 'look ![x](https://img/shared.png)' },
    { hashStorePath: path }
  );
  assert.equal(r2.findings.length, 1);
  assert.equal(r2.findings[0].source.kind, 'on-chain-original');
  assert.equal(r2.findings[0].source.author, 'alice');

  det.__setFetch(null); ph.__setFetch(null); ph.__setDecoder(null);
  await rm(path, { force: true });
});

test('a brand-new image yields no findings (it IS the original) but is indexed', async () => {
  const path = tmp('new');
  await rm(path, { force: true });
  det.__setFetch(async () => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([123]).buffer }));
  ph.__setFetch(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([123]).buffer }));
  ph.__setDecoder(decoderFor());
  const r = await scanPostImages({ author: 'carol', permlink: 'fresh', created: '2026-02-01T00:00:00Z', body: '![y](https://img/unique.png)' }, { hashStorePath: path });
  assert.equal(r.findings.length, 0);
  assert.equal(r.indexed, 1);
  det.__setFetch(null); ph.__setFetch(null); ph.__setDecoder(null);
  await rm(path, { force: true });
});

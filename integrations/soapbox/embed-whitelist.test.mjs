// embed-whitelist.test.mjs — offline tests for the video-embed safety gate. Pure module (no network).
// Run: node --test integrations/soapbox/embed-whitelist.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedEmbed, embedUrl, ALLOWED_PROVIDERS } from './embed-whitelist.mjs';

// ── allowed providers (official players only) ──────────────────────────────────────────────────────
test('YouTube watch/short/youtu.be all resolve to the official nocookie embed', () => {
  const a = allowedEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(a.ok, true);
  assert.equal(a.provider, 'YouTube');
  assert.equal(a.id, 'dQw4w9WgXcQ');
  assert.equal(a.embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(allowedEmbed('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(allowedEmbed('https://www.youtube.com/shorts/abc123XYZ_-').ok, true);
});

test('Vimeo + Dailymotion + Internet Archive build their official embeds', () => {
  const v = allowedEmbed('https://vimeo.com/123456789');
  assert.equal(v.ok, true);
  assert.equal(v.embed, 'https://player.vimeo.com/video/123456789');

  const d = allowedEmbed('https://www.dailymotion.com/video/x7tgad0');
  assert.equal(d.ok, true);
  assert.equal(d.embed, 'https://www.dailymotion.com/embed/video/x7tgad0');

  const ia = allowedEmbed('https://archive.org/details/night_of_the_living_dead');
  assert.equal(ia.ok, true);
  assert.equal(ia.provider, 'Internet Archive');
  assert.equal(ia.embed, 'https://archive.org/embed/night_of_the_living_dead');
});

test('3Speak (HIVE-native) user/permlink ids are accepted', () => {
  const s = allowedEmbed('https://3speak.tv/watch?v=vankush/abc-permlink');
  assert.equal(s.ok, true);
  assert.equal(s.provider, '3Speak');
  assert.equal(s.id, 'vankush/abc-permlink');
  assert.equal(s.embed, 'https://3speak.tv/embed?v=vankush/abc-permlink');
});

// ── refusals (the Samy-worm rule) ──────────────────────────────────────────────────────────────────
test('scraper/aggregator iframe hosts are REFUSED (not on the allowlist)', () => {
  for (const bad of [
    'https://2embed.cc/embed/tt1234567',
    'https://vidsrc.to/embed/movie/tt1234567',
    'https://www.2embed.to/embed/abc',
    'https://evil.example.com/embed/x',
  ]) {
    const r = allowedEmbed(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, /allowlist/);
  }
});

test('non-https schemes are refused — no javascript:/data:/file:/http: origins', () => {
  assert.equal(allowedEmbed('javascript:alert(1)').ok, false);
  assert.equal(allowedEmbed('data:text/html,<script>alert(1)</script>').ok, false);
  assert.equal(allowedEmbed('http://www.youtube.com/watch?v=abc').ok, false); // http even for an allowed host
  assert.match(allowedEmbed('http://www.youtube.com/watch?v=abc').reason, /https only/);
});

test('a YouTube-lookalike subdomain trick does not bypass the host match', () => {
  // youtube.com.evil.com must NOT match youtube.com
  const r = allowedEmbed('https://youtube.com.evil.com/watch?v=abc');
  assert.equal(r.ok, false);
  assert.match(r.reason, /allowlist/);
});

test('allowed host but no extractable id is refused', () => {
  const r = allowedEmbed('https://www.youtube.com/feed/subscriptions');
  assert.equal(r.ok, false);
  assert.match(r.reason, /video id/);
});

test('a slash-bearing id on a strict provider fails the safety check', () => {
  // an attacker-style id with a path traversal must not splice into the embed url
  const r = allowedEmbed('https://archive.org/embed/..%2F..%2Fadmin');
  // decoded id would contain slashes/dots beyond ID_SAFE → refused
  assert.equal(r.ok, false);
});

// ── total / soft-fail + helpers ────────────────────────────────────────────────────────────────────
test('bad input never throws — returns { ok:false, reason }', () => {
  assert.equal(allowedEmbed(undefined).ok, false);
  assert.equal(allowedEmbed('').ok, false);
  assert.equal(allowedEmbed('not a url').ok, false);
  assert.equal(allowedEmbed(42).ok, false);
});

test('embedUrl returns the embed string for allowed, null for refused; ALLOWED_PROVIDERS listed', () => {
  assert.equal(embedUrl('https://vimeo.com/55'), 'https://player.vimeo.com/video/55');
  assert.equal(embedUrl('https://2embed.cc/embed/x'), null);
  assert.deepEqual(ALLOWED_PROVIDERS, ['YouTube', 'Vimeo', 'Dailymotion', '3Speak', 'Internet Archive']);
});

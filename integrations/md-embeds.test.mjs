// md-embeds.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandEmbeds, expandShortcodes, expandVideoLinks, videoEmbedHtml, SHORTCODES } from './md-embeds.mjs';

test('videoEmbedHtml frames allowed providers + our own hosts, refuses the rest', () => {
  const yt = videoEmbedHtml('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.match(yt, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(yt, /<iframe/);
  const ours = videoEmbedHtml('https://engine.melek.salon/dtube/watch/abc');
  assert.match(ours, /engine\.melek\.salon/);
  assert.match(ours, /embed=1/);                          // our surfaces render the bare player
  assert.equal(videoEmbedHtml('https://2embed.cc/embed/tt123'), null); // not on the allowlist → refused
  assert.equal(videoEmbedHtml('http://youtube.com/watch?v=x'), null);  // non-https refused
});

test('expandVideoLinks turns a bare autolinked video URL into a player, leaves other links alone', () => {
  const html = '<p><a href="https://vimeo.com/12345">https://vimeo.com/12345</a></p>';
  assert.match(expandVideoLinks(html), /<iframe/);
  const normal = '<p><a href="https://example.com/page">https://example.com/page</a></p>';
  assert.equal(expandVideoLinks(normal), normal);         // untouched
  // a link whose text != href (a real hyperlink) is NOT auto-embedded
  const worded = '<a href="https://www.youtube.com/watch?v=x">my video</a>';
  assert.equal(expandVideoLinks(worded), worded);
});

test('[follow] shortcode → a hydratable button; bad handle guarded; escaped', () => {
  const out = expandShortcodes('[follow @Hathor]');
  assert.match(out, /data-widget="follow"/);
  assert.match(out, /data-account="hathor"/);             // lowercased
  assert.match(out, /Follow @hathor/);
  assert.match(out, /^<button/);
  assert.equal(expandShortcodes('[follow @nope!!]'), '[follow ?]'); // invalid account guarded
});

test('[comments], [video], [chat], [translate] shortcodes', () => {
  assert.match(expandShortcodes('[comments coin:btc]'), /data-widget="comments"[^>]*data-ref="coin:btc"/);
  assert.match(expandShortcodes('[video https://vimeo.com/9]'), /<iframe/);
  assert.match(expandShortcodes('[video https://evil.example/x]'), /<a href="https:\/\/evil\.example\/x"/); // bad → plain link
  assert.match(expandShortcodes('[chat]'), /data-widget="chat"/);
  assert.match(expandShortcodes('[translate]'), /data-widget="translate"/);
});

test('expandEmbeds runs both passes; output carries NO inline JS (loader hydrates data-*)', () => {
  const md = '<p><a href="https://www.youtube.com/watch?v=abc">https://www.youtube.com/watch?v=abc</a></p>'
    + '<p>[follow @hathor] [chat]</p>';
  const out = expandEmbeds(md);
  assert.match(out, /youtube-nocookie/);
  assert.match(out, /data-widget="follow"/);
  assert.doesNotMatch(out, /<script|onclick=|javascript:/i);  // safe: no executable JS injected
  assert.ok(SHORTCODES.includes('follow') && SHORTCODES.includes('comments'));
});

import { test } from 'node:test';
import assert from 'node:assert';
import { parseEmbed, render, findEmbeds, renderText, hostAllowed } from './maker-embeds.mjs';

test('a song link becomes the standard player panel', () => {
  const e = parseEmbed('https://stream.soapbox.community/music/t/lamp-upon-the-water');
  assert.equal(e.kind, 'song');
  assert.equal(e.embed, 'https://stream.soapbox.community/music/embed/lamp-upon-the-water');
  assert.match(render(e), /<iframe src="https:\/\/stream\.soapbox\.community\/music\/embed\/lamp-upon-the-water"/);
});

test('pictures, videos, recordings and beats each get the right card', () => {
  assert.equal(parseEmbed('https://hathor.soapbox.community/img/a1.png').kind, 'image');
  assert.equal(parseEmbed('https://hathor.soapbox.community/p/a1.png').image, 'https://hathor.soapbox.community/img/a1.png');
  assert.equal(parseEmbed('https://stream.soapbox.community/watch/ia/some-film').kind, 'video');
  assert.equal(parseEmbed('https://hathor.soapbox.community/clip.mp4').kind, 'video');
  assert.equal(parseEmbed('https://stream.soapbox.community/music/media/x.mp3').kind, 'audio');
  assert.equal(parseEmbed('https://pentecaust.com/sandalphon/beats#b=eyJhIjoxfQ').kind, 'beat');
  assert.equal(parseEmbed('https://tools.soapbox.community/diagram?d=abc').kind, 'chart');
  assert.equal(parseEmbed('https://pact.pentecaust.com/groups/lyre-club').kind, 'group');
});

test('⛔ a link off our hosts is never embedded and never framed', () => {
  assert.equal(parseEmbed('https://evil.example/x.png'), null);
  assert.equal(parseEmbed('javascript:alert(1)'), null);
  assert.equal(parseEmbed('data:text/html,<script>'), null);
  assert.equal(hostAllowed('evil.example'), false);
  assert.equal(hostAllowed('stream.soapbox.community'), true);
  const html = renderText('see https://evil.example/x.png');
  assert.equal(html.includes('<iframe'), false);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /<a href="https:\/\/evil\.example\/x\.png"/);     // a plain link, nothing more
});

test('an email never gets a frame, a video or a script — a picture and a link', () => {
  const song = render(parseEmbed('https://stream.soapbox.community/music/t/x'), { for: 'email' });
  assert.equal(song.includes('<iframe'), false);
  assert.match(song, /<a class=me-open href="https:\/\/stream\.soapbox\.community\/music\/t\/x"/);
  const pic = render(parseEmbed('https://hathor.soapbox.community/img/a1.png'), { for: 'email' });
  assert.match(pic, /<img src="https:\/\/hathor\.soapbox\.community\/img\/a1\.png"/);
  assert.equal(render(parseEmbed('https://hathor.soapbox.community/clip.mp4'), { for: 'email' }).includes('<video'), false);
});

test('message text is escaped, links become links, and cards are appended', () => {
  const html = renderText('look <b>here</b> https://stream.soapbox.community/music/t/lamp');
  assert.match(html, /&lt;b&gt;here&lt;\/b&gt;/);          // no raw HTML from a message, ever
  assert.match(html, /<iframe src="https:\/\/stream\.soapbox\.community\/music\/embed\/lamp"/);
  assert.equal(findEmbeds('a https://stream.soapbox.community/music/t/a b https://stream.soapbox.community/music/t/a').length, 1);
  assert.equal(findEmbeds('x https://stream.soapbox.community/music/t/a https://hathor.soapbox.community/img/b.png https://hathor.soapbox.community/img/c.png https://hathor.soapbox.community/img/d.png').length, 3);
});

test('custom emoji resolve from the set, and an unknown or off-host one stays as typed', () => {
  const emoji = { lyre: 'https://hathor.soapbox.community/img/lyre.png', bad: 'https://evil.example/x.png' };
  const html = renderText('hello :lyre: :nope: :bad:', { emoji });
  assert.match(html, /<img class=me-emoji src="https:\/\/hathor\.soapbox\.community\/img\/lyre\.png" alt=":lyre:"/);
  assert.match(html, /:nope:/);
  assert.match(html, /:bad:/);
  assert.equal(html.includes('evil.example'), false);
});

test('a quote in a title or url cannot break out of the attribute', () => {
  const html = render({ kind: 'image', title: 'a "x" <b>', url: 'https://hathor.soapbox.community/img/a.png', image: 'https://hathor.soapbox.community/img/a.png' });
  assert.equal(html.includes('"x"'), false);
  assert.match(html, /&quot;x&quot;/);
});

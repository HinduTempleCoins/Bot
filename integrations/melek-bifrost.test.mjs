import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeVideoPost, validateVideoPost, toCommentOp, playerHtml, feedCardHtml, fmtViews, fmtDuration } from './melek-bifrost.mjs';

test('fmtDuration / fmtViews', () => {
  assert.equal(fmtDuration(95), '1:35');
  assert.equal(fmtDuration(3661), '1:01:01');
  assert.equal(fmtViews(1500), '1.5K');
  assert.equal(fmtViews(2_000_000), '2M');
  assert.equal(fmtViews(42), '42');
});

test('makeVideoPost sanitizes + builds a chain-ready id/permlink', () => {
  const p = makeVideoPost({ author: 'Ha th/or!', title: 'My First Video!!', videoUrl: 'https://x/y.mp4', tags: 'Intro, MELEK art' });
  assert.equal(p.author, 'Hathor');
  assert.match(p.permlink, /^bifrost-my-first-video-[a-z0-9]{6}$/);
  assert.equal(p.id, `${p.author}/${p.permlink}`);
  assert.deepEqual(p.tags, ['intro', 'melek', 'art']);
  assert.equal(p.views, 0);
});

test('validateVideoPost rejects a non-video url and requires a title', () => {
  assert.equal(validateVideoPost(makeVideoPost({ author: 'a', title: 'ok', videoUrl: 'https://x/y.mp4' })).valid, true);
  assert.equal(validateVideoPost(makeVideoPost({ author: 'a', title: 'x', videoUrl: 'https://x/y.exe' })).valid, false);
  const noTitle = makeVideoPost({ author: 'a', title: '', videoUrl: 'https://x/y.mp4' });
  noTitle.title = '';
  assert.equal(validateVideoPost(noTitle).valid, false);
});

test('toCommentOp is a proper dTube-style comment op with video metadata', () => {
  const p = makeVideoPost({ author: 'hathor', title: 'Intro', videoUrl: 'https://x/y.mp4', thumbUrl: '/img/t.png', durationSec: 60, tags: 'intro' });
  const op = toCommentOp(p);
  assert.equal(op[0], 'comment');
  assert.equal(op[1].author, 'hathor');
  assert.equal(op[1].parent_permlink, 'bifrost');
  const meta = JSON.parse(op[1].json_metadata);
  assert.equal(meta.video.url, 'https://x/y.mp4');
  assert.equal(meta.video.duration, 60);
  assert.ok(meta.tags.includes('bifrost'));
});

test('playerHtml escapes + falls back safely', () => {
  const good = playerHtml(makeVideoPost({ author: 'a', title: 't', videoUrl: 'https://x/y.mp4', thumbUrl: '/img/p.png' }));
  assert.match(good, /<video[^>]+controls/);
  assert.match(good, /poster="\/img\/p\.png"/);
  assert.match(playerHtml({ videoUrl: 'javascript:alert(1)' }), /isn.t available/);
});

test('feedCardHtml grid + vertical both render, links to watch', () => {
  const p = makeVideoPost({ author: 'hathor', title: 'V', videoUrl: 'https://x/y.mp4', thumbUrl: '/img/t.png', durationSec: 75 });
  const grid = feedCardHtml(p, { vertical: false });
  assert.match(grid, /\/pentecaust\/bifrost\/watch\/hathor\//);
  assert.match(grid, /1:15/);
  const scroll = feedCardHtml(p, { vertical: true });
  assert.match(scroll, /<video/);
  assert.match(scroll, /scroll-snap-align:start/);
});

test('feedCard handles a missing thumbnail without an <img>', () => {
  const p = makeVideoPost({ author: 'a', title: 't', videoUrl: 'https://x/y.mp4' });
  const grid = feedCardHtml(p);
  assert.doesNotMatch(grid, /<img/);
});

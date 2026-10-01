import { test } from 'node:test';
import assert from 'node:assert';
import { makePin, validatePin, pinsFromPost, imagesIn, gridHtml, pinHtml, markdownFor, boardOf, isImageUrl, safeUrl, MAX_ALBUM, pinOp } from './melek-pinboard.mjs';

const IMG = 'https://hathor.soapbox.community/img/a1.png';
const IMG2 = 'https://example.org/photos/b2.jpg';

test('a pin holds one picture or a small album, and the first is the cover', () => {
  const one = makePin({ author: 'ryan', title: 'The lyre', images: [IMG] });
  assert.equal(one.cover, IMG);
  assert.equal(one.album, false);
  assert.equal(validatePin(one).valid, true);
  const many = makePin({ author: 'ryan', title: 'A walk', images: [IMG, IMG2] });
  assert.equal(many.album, true);
  assert.equal(many.images.length, 2);
  const over = makePin({ author: 'ryan', images: Array.from({ length: 40 }, (_, i) => `https://e.org/${i}.jpg`) });
  assert.equal(over.images.length, MAX_ALBUM);
});

test('only real image URLs get in, and never a javascript: or data: one', () => {
  assert.equal(isImageUrl(IMG), true);
  assert.equal(isImageUrl('https://example.org/page'), false);
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:image/png;base64,AAAA'), '');
  const p = makePin({ author: 'ryan', images: ['javascript:alert(1)', IMG] });
  assert.deepEqual(p.images.map((i) => i.url), [IMG]);
  assert.equal(validatePin(makePin({ author: 'ryan', images: [] })).valid, false);
});

test('⭐ a saved pin always keeps the link it came from — a bookmark is never passed off as your own', () => {
  const saved = makePin({ author: 'ryan', kind: 'saved', images: [IMG2], sourceUrl: 'https://example.org/story', sourceAuthor: 'someone' });
  assert.equal(saved.kind, 'saved');
  assert.equal(saved.sourceUrl, 'https://example.org/story');
  const stripped = { ...saved, sourceUrl: '' };
  assert.equal(validatePin(stripped).valid, false);
  assert.match(validatePin(stripped).errors[0], /keep the link it came from/);
  assert.match(pinHtml(saved), /href="https:\/\/example\.org\/story"[^>]*>@someone</);
});

test('pictures are found in markdown, HTML and bare links in a blog body', () => {
  const body = `Hello ![one](${IMG}) and <img src="${IMG2}"> and ${IMG} again plus https://example.org/not-an-image`;
  assert.deepEqual(imagesIn(body), [IMG, IMG2]);
});

test('a MELEK blog post becomes saved pins that link back and keep the author', () => {
  const post = { author: 'ryan', permlink: 'the-lyre-of-ur', title: 'The Lyre of Ur', body: `![a](${IMG}) ![b](${IMG2})` };
  const pins = pinsFromPost(post, { saver: 'friend' });
  assert.equal(pins.length, 2);
  assert.equal(pins[0].kind, 'saved');
  assert.equal(pins[0].author, 'friend');
  assert.equal(pins[0].sourceAuthor, 'ryan');
  assert.equal(pins[0].sourceUrl, 'https://melek.salon/@ryan/the-lyre-of-ur');
  const album = pinsFromPost(post, { saver: 'friend', one: true });
  assert.equal(album.length, 1);
  assert.equal(album[0].images.length, 2);
  assert.deepEqual(pinsFromPost({ author: 'ryan', permlink: 'x', body: 'no pictures here' }), []);
});

test('and back the other way: a pin becomes markdown for a MELEK post, with credit on a saved one', () => {
  const mine = makePin({ author: 'ryan', title: 'The lyre', images: [IMG] });
  assert.match(markdownFor(mine), /!\[The lyre\]\(https:\/\/hathor\.soapbox\.community\/img\/a1\.png\)/);
  assert.match(markdownFor(mine), /On the pinboard/);
  const saved = makePin({ author: 'ryan', kind: 'saved', title: 'Found', images: [IMG2], sourceUrl: 'https://example.org/story', sourceAuthor: 'someone' });
  assert.match(markdownFor(saved), /Saved from @someone — https:\/\/example\.org\/story/);
});

test('the wall is a grid of thumbnails, not a column of posts', () => {
  const html = gridHtml([makePin({ author: 'ryan', title: 'One', images: [IMG] }), makePin({ author: 'ryan', images: [IMG, IMG2] })]);
  assert.match(html, /class=pb-grid/);
  assert.equal((html.match(/class=pb-card/g) || []).length, 2);
  assert.match(html, /▣ 2/);                       // the album badge
  assert.match(gridHtml([]), /Nothing pinned yet/);
});

test('boards filter, and titles cannot break out of the markup', () => {
  const a = makePin({ author: 'ryan', images: [IMG], board: 'Old Instruments' });
  const b = makePin({ author: 'ryan', images: [IMG], board: 'Maps' });
  assert.equal(boardOf([a, b], 'old-instruments').length, 1);
  assert.equal(boardOf([a, b]).length, 2);
  const nasty = makePin({ author: 'ryan', title: '"><script>alert(1)</script>', images: [IMG] });
  const html = pinHtml(nasty);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('a pin is stored on the chain as a small record, not as a blog post', () => {
  const p = makePin({ author: 'ryan', title: 'The lyre', images: [IMG], board: 'Old Instruments' });
  const op = pinOp(p);
  assert.equal(op[0], 'custom_json');                      // never 'comment'
  assert.deepEqual(op[1].required_posting_auths, ['ryan']); // posting key, not active
  assert.deepEqual(op[1].required_auths, []);
  assert.equal(op[1].id, 'melek_pin');
  const j = JSON.parse(op[1].json);
  assert.deepEqual(j.img, [IMG]);
  assert.equal(j.board, 'old-instruments');
  assert.ok(op[1].json.length < 2000, 'the record stays small');
});

test('a saved pin carries its source into the chain record, and a pin with no picture has no op', () => {
  const saved = makePin({ author: 'ryan', kind: 'saved', images: [IMG2], sourceUrl: 'https://example.org/s', sourceAuthor: 'someone' });
  const j = JSON.parse(pinOp(saved)[1].json);
  assert.equal(j.src, 'https://example.org/s');
  assert.equal(j.by, 'someone');
  assert.equal(pinOp(makePin({ author: 'ryan', images: [] })), null);
  assert.equal(pinOp(null), null);
});

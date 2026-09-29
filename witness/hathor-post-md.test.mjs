import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDraft, commentOp } from './hathor-post-md.mjs';

const ok = `---\ntitle: "October Is Horror Month"\npermlink: october-horror-map\ntags: [melek, horror, Halloween!]\nstatus: DRAFT\n---\n\nHello ![x](https://s/img/a.jpg)\n`;

test('parseDraft reads front matter, cleans tags, keeps the body', () => {
  const d = parseDraft(ok);
  assert.equal(d.title, 'October Is Horror Month');
  assert.equal(d.permlink, 'october-horror-map');
  assert.deepEqual(d.tags, ['melek', 'horror', 'halloween']);
  assert.match(d.body, /^Hello/);
});

test('parseDraft refuses local images, bad permlinks and missing front matter', () => {
  assert.throws(() => parseDraft(ok.replace('https://s/img/a.jpg', 'img/a.jpg')), /hosted URL/);
  assert.throws(() => parseDraft(ok.replace('october-horror-map', 'October Horror')), /permlink/);
  assert.throws(() => parseDraft('no front matter'), /front matter/);
});

test('commentOp: top-level post under the first tag, images listed in metadata', () => {
  const [name, op] = commentOp(parseDraft(ok));
  assert.equal(name, 'comment');
  assert.equal(op.parent_author, '');
  assert.equal(op.parent_permlink, 'melek');
  assert.equal(op.author, 'hathor');
  assert.deepEqual(JSON.parse(op.json_metadata).image, ['https://s/img/a.jpg']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, LESSONS, listLessons, getLesson, NFT_DISCLAIMER, validateSchool } from './genai-school.mjs';

test('school registry is valid', () => {
  const v = validateSchool();
  assert.ok(v.ok, 'validateSchool: ' + v.errors.join('; '));
  assert.ok(LESSONS.length >= 8, `expected a full curriculum, got ${LESSONS.length}`);
  assert.ok(TRACKS.length >= 5);
});

test('every track has at least one lesson', () => {
  for (const t of TRACKS) assert.ok(listLessons(t.id).length >= 1, `track ${t.id} empty`);
});

test('lessons: unique id, known track, has do-links', () => {
  const trackIds = new Set(TRACKS.map((t) => t.id));
  const seen = new Set();
  for (const l of LESSONS) {
    assert.ok(!seen.has(l.id), `dup ${l.id}`); seen.add(l.id);
    assert.ok(trackIds.has(l.track), `${l.id} bad track`);
    assert.ok(l.do.length >= 1 && l.do.every((d) => d.label && d.href), `${l.id} bad links`);
  }
});

test('the self-serve lesson names Colab, Modal and Fal', () => {
  const l = LESSONS.find((x) => x.id === 'run-it-yourself');
  const blob = JSON.stringify(l);
  assert.match(blob, /Colab/);
  assert.match(blob, /Modal/);
  assert.match(blob, /fal\.ai/i);
});

test('the sources lesson points at Hugging Face, Civitai and GitHub', () => {
  const l = LESSONS.find((x) => x.id === 'models-loras');
  const hrefs = l.do.map((d) => d.href).join(' ');
  assert.match(hrefs, /civitai\.com/);
  assert.match(hrefs, /huggingface\.co/);
});

test('NFT lesson carries the honest value disclaimer', () => {
  const l = LESSONS.find((x) => x.track === 'nft');
  assert.ok(l && l.disclaimer, 'nft lesson has disclaimer');
  assert.equal(l.disclaimer, NFT_DISCLAIMER);
  assert.match(NFT_DISCLAIMER, /little or no market value/i);
  assert.match(NFT_DISCLAIMER, /not (financial|investment) advice|not financial advice/i);
});

test('community lessons connect the Library (wiki) and the forum', () => {
  const pub = getLesson('publish-library');
  const hrefs = pub.do.map((d) => d.href).join(' ');
  assert.match(hrefs, /wiki\.soapbox\.community/);
  assert.match(hrefs, /forum\.soapbox\.community/);
});

test('getLesson', () => {
  assert.equal(getLesson('how-it-works').track, 'basics');
  assert.equal(getLesson('nope'), null);
});

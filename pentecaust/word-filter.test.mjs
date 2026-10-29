// word-filter.test.mjs — PM curse filter. OFFLINE, pure. The escapability is a REQUIREMENT here,
// not a gap: the operator asked for a filter people can get around with a misspelling.
import { test } from 'node:test';
import assert from 'node:assert';
import { maskCurses, hasCurse, curseList } from './word-filter.mjs';

test('the plain spelling is masked, same length', () => {
  assert.equal(maskCurses('what the fuck').text, 'what the ****');
  assert.equal(maskCurses('this is shit').text, 'this is ****');
  assert.equal(maskCurses('you bitch').text, 'you *****');
  assert.equal(maskCurses('what the fuck').masked, 1);
});

test('case does not matter and the rest of the sentence survives', () => {
  assert.equal(maskCurses('What the FUCK is this').text, 'What the **** is this');
  assert.equal(maskCurses('Shit happens').text, '**** happens');
});

test('several words in one line are all masked and counted', () => {
  const r = maskCurses('this shit is fucking bullshit');
  assert.equal(r.masked, 3);
  assert.equal(r.text.includes('shit'), false);
  assert.equal(r.text.includes('fucking'), false);
});

test('the longest match wins, so a compound is masked whole', () => {
  assert.equal(maskCurses('motherfucker').text, '*'.repeat('motherfucker'.length));
  assert.equal(maskCurses('motherfucker').masked, 1, 'not masked twice');
});

test('⚠ MISSPELLINGS GET THROUGH — THIS IS THE REQUIREMENT, NOT A BUG', () => {
  // The operator asked for a filter people can get around with a misspelling. If a future change
  // makes these fail, the change is wrong, not the test.
  for (const escaped of ['sh*t', 'f*ck', 'shiit', 'fuuck', 'sh1t', 'f u c k', 'fck', 'b!tch', 'phuck']) {
    assert.equal(hasCurse(escaped), false, `${escaped} must pass through untouched`);
    assert.equal(maskCurses(escaped).text, escaped);
  }
});

test('no Scunthorpe problem — innocent words are never touched', () => {
  for (const clean of [
    'Scunthorpe', 'assassin', 'classic', 'cocktail', 'bass', 'pass the salt', 'Shiitake mushrooms',
    'analysis', 'Penistone', 'grass', 'assume', 'cumulative', 'Hancock', 'titmouse', 'dickens',
    'assistant', 'passage', 'brass', 'glasses', 'massive',
  ]) {
    assert.equal(hasCurse(clean), false, `${clean} must not be masked`);
    assert.equal(maskCurses(clean).text, clean);
  }
});

test('a curse inside a longer word is not masked (whole words only)', () => {
  assert.equal(maskCurses('shitake').text, 'shitake', 'not a whole-word match');
  assert.equal(maskCurses('bitchin').text, 'bitchin');
});

test('punctuation around a word still counts as a word boundary', () => {
  assert.equal(maskCurses('what the fuck!').text, 'what the ****!');
  assert.equal(maskCurses('(shit)').text, '(****)');
  assert.equal(maskCurses('"bitch",').text, '"*****",');
});

test('empty, null and non-strings are safe', () => {
  for (const v of ['', null, undefined, 0, false]) {
    const r = maskCurses(v);
    assert.equal(r.masked, 0);
    assert.equal(typeof r.text, 'string');
  }
  assert.equal(hasCurse(null), false);
});

test('the list is operator-tunable and an empty override disables nothing silently', () => {
  assert.ok(curseList().length > 10);
  // an explicit list wins
  assert.equal(maskCurses('banana', { list: ['banana'] }).text, '******');
  assert.equal(maskCurses('fuck', { list: ['banana'] }).text, 'fuck', 'only the given list applies');
  // an empty list is a no-op rather than a crash
  assert.equal(maskCurses('fuck', { list: [] }).text, 'fuck');
});

test('a regex-special word in the list cannot break the matcher', () => {
  const r = maskCurses('a+b and c.d', { list: ['a+b', 'c.d'] });
  assert.equal(r.masked, 2, 'treated as literals, not patterns');
});

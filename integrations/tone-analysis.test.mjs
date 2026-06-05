// tone-analysis.test.mjs — OFFLINE proof of the keyless VADER/NRC/tone analysers (task #286).
// Pure, deterministic, no network. Asserts sentiment polarity (incl. negation flips), emotion
// detection (an angry sentence scores anger high), and the tone flags (formality/politeness/
// certainty/sarcasm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentiment, emotion, tone, analyzeTone, VADER_LEXICON, NRC_LEXICON } from './tone-analysis.mjs';

// ── sentiment (VADER method) ──────────────────────────────────────────────────────────────────────
test('sentiment: clearly positive sentence scores pos', () => {
  const s = sentiment('I am so happy, this is excellent and works perfectly!');
  assert.equal(s.label, 'pos');
  assert.ok(s.score > 0.05, `score=${s.score}`);
  assert.ok(s.score >= -1 && s.score <= 1, 'bounded');
});

test('sentiment: clearly negative sentence scores neg', () => {
  const s = sentiment('This is terrible, I hate it, everything is broken and awful');
  assert.equal(s.label, 'neg');
  assert.ok(s.score < -0.05, `score=${s.score}`);
});

test('sentiment: negation flips polarity — "not good" < 0', () => {
  const neg = sentiment('this is not good');
  assert.ok(neg.score < 0, `"not good" score=${neg.score}`);
  // and it scores lower than the un-negated phrase
  const pos = sentiment('this is good');
  assert.ok(neg.score < pos.score, `not good (${neg.score}) should be < good (${pos.score})`);
  // the negated hit is recorded
  assert.ok(neg.hits.some((h) => h.word === 'good' && h.negated === true));
});

test('sentiment: contraction negation ("isn\'t great") reads non-positive', () => {
  const s = sentiment("the release isn't great");
  assert.ok(s.score <= 0, `score=${s.score}`);
});

test('sentiment: booster amplifies magnitude', () => {
  const plain = sentiment('this is good');
  const boosted = sentiment('this is very good');
  assert.ok(boosted.score >= plain.score, `very good (${boosted.score}) >= good (${plain.score})`);
});

test('sentiment: punctuation/CAPS amplify', () => {
  const plain = sentiment('this is great');
  const loud = sentiment('this is GREAT!!!');
  assert.ok(loud.score >= plain.score, `loud (${loud.score}) >= plain (${plain.score})`);
});

test('sentiment: pure/deterministic, neutral on empty/garbage', () => {
  const a = sentiment('gold gains while stocks drop');
  const b = sentiment('gold gains while stocks drop');
  assert.deepEqual(a, b);
  assert.equal(sentiment('').label, 'neutral');
  assert.equal(sentiment('').score, 0);
  assert.equal(sentiment(undefined).score, 0);
  assert.equal(sentiment('the cat sat on the mat').label, 'neutral');  // no lexicon words
});

test('sentiment: lexicon is a plain expandable object', () => {
  assert.equal(typeof VADER_LEXICON, 'object');
  assert.ok(VADER_LEXICON.excellent > 0 && VADER_LEXICON.terrible < 0);
});

// ── emotion (NRC method) ──────────────────────────────────────────────────────────────────────────
test('emotion: an angry sentence scores anger high (and dominant)', () => {
  const e = emotion('I am so angry and furious, this is outrageous, I hate it');
  assert.ok(e.anger > 0, `anger=${e.anger}`);
  assert.equal(e.dominant, 'anger');
  assert.ok(e.anger >= e.joy, 'anger dominates joy');
});

test('emotion: a joyful sentence scores joy high', () => {
  const e = emotion('I am so happy and delighted, what a wonderful joyful day');
  assert.equal(e.dominant, 'joy');
  assert.ok(e.joy > 0);
});

test('emotion: a fearful sentence scores fear', () => {
  const e = emotion('I am terrified and scared, this is a real danger');
  assert.ok(e.fear > 0);
  assert.equal(e.dominant, 'fear');
});

test('emotion: negation suppresses the association ("not happy")', () => {
  const e = emotion('I am not happy');
  assert.equal(e.joy, 0, 'negated joy word does not contribute');
});

test('emotion: returns all eight axes, normalized 0..1, neutral on empty', () => {
  const e = emotion('the meeting is at noon');
  for (const k of ['joy', 'anger', 'fear', 'sadness', 'disgust', 'surprise', 'trust', 'anticipation']) {
    assert.ok(typeof e[k] === 'number' && e[k] >= 0 && e[k] <= 1, `${k}=${e[k]}`);
  }
  assert.equal(e.dominant, null);
  // empty input: all axes zero, no dominant.
  const empty = emotion('');
  assert.equal(empty.dominant, null);
  for (const k of ['joy', 'anger', 'fear', 'sadness', 'disgust', 'surprise', 'trust', 'anticipation']) {
    assert.equal(empty[k], 0);
  }
  assert.equal(typeof NRC_LEXICON, 'object');
});

// ── tone (formality / politeness / certainty / sarcasm) ─────────────────────────────────────────────
test('tone: formal text reads formal, casual reads informal', () => {
  const formal = tone('Therefore, pursuant to our agreement, kindly review the aforementioned terms.');
  const casual = tone('yeah gonna grab food lol u wanna come btw');
  assert.ok(formal.formality > 0.5, `formal=${formal.formality}`);
  assert.ok(casual.formality < 0.5, `casual=${casual.formality}`);
});

test('tone: politeness up with please/thanks, down with insults', () => {
  const polite = tone('Could you please help? Thanks, I really appreciate it.');
  const rude = tone('this is stupid and useless, what a pathetic nonsense');
  assert.ok(polite.politeness > 0.5, `polite=${polite.politeness}`);
  assert.ok(rude.politeness < 0.5, `rude=${rude.politeness}`);
});

test('tone: certainty vs tentativeness', () => {
  const sure = tone('this will definitely work, absolutely certainly, that is a fact');
  const hedge = tone('maybe it might possibly work, perhaps, not sure');
  assert.ok(sure.certainty > 0, `certainty=${sure.certainty}`);
  assert.ok(hedge.tentativeness > 0, `tentativeness=${hedge.tentativeness}`);
  assert.ok(sure.certainty > sure.tentativeness);
});

test('tone: sarcasm heuristic catches obvious cues', () => {
  assert.equal(tone('yeah, right, that totally worked').sarcasm, true);
  assert.equal(tone('oh great, it broke again').sarcasm, true);
  assert.equal(tone('thanks for the clear explanation, that helped').sarcasm, false);
});

test('tone: returns the documented shape, safe on empty', () => {
  const t = tone('');
  for (const k of ['formality', 'politeness', 'certainty', 'tentativeness', 'sarcasmScore']) {
    assert.ok(typeof t[k] === 'number');
  }
  assert.equal(typeof t.sarcasm, 'boolean');
  assert.equal(typeof t.allCaps, 'boolean');
});

// ── convenience ─────────────────────────────────────────────────────────────────────────────────────
test('analyzeTone bundles all three', () => {
  const a = analyzeTone('I am thrilled this works perfectly!');
  assert.ok(a.sentiment && a.emotion && a.tone);
  assert.equal(a.sentiment.label, 'pos');
  assert.equal(a.emotion.dominant, 'joy');
});

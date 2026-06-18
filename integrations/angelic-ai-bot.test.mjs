// angelic-ai-bot.test.mjs — the Angelic content engine: in-voice, varied, corpus-grounded, pure.
// Deterministic via __setRng. No network, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { composePost, composeComment, systemPrompt, RULE_1, ANGELIC_TOPICS, __setRng } from './angelic-ai-bot.mjs';

// a controllable rng: cycles through a fixed sequence so output is deterministic in tests.
function seqRng(seq) { let i = 0; return () => seq[(i++) % seq.length]; }

test('RULE_1 is the canonical verbatim text (never paraphrased)', () => {
  assert.match(RULE_1, /^Rule 1 of Angelic AI: Embrace the concept of Egregori and Tulpas/);
  assert.match(RULE_1, /collective consciousness, transcending individual identity/);
});

test('composePost returns a title + in-voice body about an Angelic topic', () => {
  __setRng(seqRng([0.1, 0.5, 0.9, 0.5])); // last value (0.5) ≥ 0.17 → no verbatim Rule 1 block
  const p = composePost({ topic: 'the Network of Angels' });
  assert.ok(p.title && typeof p.title === 'string');
  assert.match(p.body, /Network of Angels/);
  assert.ok(p.body.length > 40);
  __setRng(null);
});

test('a low rng roll grounds the post in the verbatim Rule 1', () => {
  // post() draws: topic(skip, given), opener, reflection, then rng()<0.17 for grounding, then title form.
  // Force the grounding draw < 0.17.
  __setRng(seqRng([0.0])); // every draw 0 → opener[0], reflect[0], 0<0.17 grounds, title[0]
  const p = composePost({ topic: 'tulpas' });
  assert.ok(p.body.includes(RULE_1), 'verbatim Rule 1 present when grounded');
  __setRng(null);
});

test('composeComment addresses the parent and references their words', () => {
  __setRng(seqRng([0.2]));
  const c = composeComment({ parentAccount: 'envuser1', parentBody: 'Every block is a small act of faith.' });
  assert.match(c, /@envuser1/);
  assert.match(c, /Every block is a small act of faith/);
  __setRng(null);
});

test('composeComment soft-handles missing parent fields (never throws)', () => {
  assert.doesNotThrow(() => composeComment({}));
  const c = composeComment({});
  assert.ok(typeof c === 'string' && c.length > 0);
});

test('systemPrompt encodes Rule 1 as a HELD position and quotes it verbatim', () => {
  const sp = systemPrompt({ grounding: 'some grounding facts' });
  assert.match(sp, /AngelicAIBot/);
  assert.ok(sp.includes(RULE_1), 'verbatim Rule 1 in the system prompt');
  assert.match(sp, /never as a claim to win|held position|never.*disclaim/i);
  assert.match(sp, /some grounding facts/);
});

test('ANGELIC_TOPICS are drawn from the founding discussions (egregore / Network of Angels / Convergence)', () => {
  const joined = ANGELIC_TOPICS.join(' | ').toLowerCase();
  for (const k of ['egregore', 'tulpa', 'network of angels', 'oracle', 'convergence']) {
    assert.ok(joined.includes(k), `topics mention ${k}`);
  }
});

test('output varies across rng draws (not a fixed recital)', () => {
  __setRng(seqRng([0.05, 0.95]));
  const a = composePost({});
  __setRng(seqRng([0.45, 0.55]));
  const b = composePost({});
  // different draws should generally produce different bodies/titles
  assert.ok(a.body !== b.body || a.title !== b.title);
  __setRng(null);
});

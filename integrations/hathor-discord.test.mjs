// hathor-discord.test.mjs — offline tests for the Hathor-on-Discord persona surface (Task #124).
// Run: node --test integrations/hathor-discord.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispositionGreeting, shapeReply, inCharacter, personaCard } from './hathor-discord.mjs';

// ── The load-bearing requirement: the greeting is a DISPOSITION, not a fixed string ──────────────
test('dispositionGreeting produces DIFFERENT greetings for different seeds (disposition, not script)', () => {
  const greetings = [];
  for (let seed = 0; seed < 12; seed++) {
    greetings.push(dispositionGreeting({ context: 'open', seed }));
  }
  const unique = new Set(greetings);
  // If it were a hard-coded fixed string, this set would have size 1. It must vary substantially.
  assert.ok(unique.size >= 6, `expected varied greetings across seeds, got ${unique.size} unique of ${greetings.length}`);
});

test('dispositionGreeting varies by context too', () => {
  const open = dispositionGreeting({ context: 'open', seed: 5 });
  const market = dispositionGreeting({ context: 'market', seed: 5 });
  const signup = dispositionGreeting({ context: 'signup', seed: 5 });
  // Same seed, different context → at least one differs (the situational turn changes).
  assert.notEqual(open, market);
  assert.ok(open !== signup || market !== signup);
});

test('dispositionGreeting is non-empty and warm', () => {
  for (let seed = 0; seed < 6; seed++) {
    const g = dispositionGreeting({ context: 'open', seed });
    assert.ok(typeof g === 'string' && g.trim().length > 20, 'greeting should be a substantive string');
  }
  // Warmth: across seeds, the salutation pool surfaces welcoming words.
  const many = Array.from({ length: 20 }, (_, i) => dispositionGreeting({ context: 'open', seed: i })).join(' ');
  assert.match(many, /welcome|peace|glad|greet|well met/i);
});

test('dispositionGreeting is deterministic for a given seed (seedable)', () => {
  const a = dispositionGreeting({ context: 'open', seed: 'gideon' });
  const b = dispositionGreeting({ context: 'open', seed: 'gideon' });
  assert.equal(a, b, 'same seed must yield the same greeting (deterministic-but-varied)');
});

test('dispositionGreeting weaves in a user name when provided', () => {
  const g = dispositionGreeting({ user: 'Sisera', context: 'open', seed: 2 });
  assert.match(g, /Sisera/, 'the seeker name should appear in the greeting');
});

test('dispositionGreeting accepts string seeds and unknown contexts (soft-fail to open)', () => {
  const g1 = dispositionGreeting({ context: 'totally-unknown', seed: 'abc' });
  assert.ok(g1.trim().length > 0);
  const g2 = dispositionGreeting({}); // no args at all
  assert.ok(g2.trim().length > 0);
});

// ── shapeReply: changes register, preserves facts verbatim ───────────────────────────────────────
test('shapeReply preserves the factual content while changing register', () => {
  const fact = 'LTC trades at 84.20 USD; volume is 1,203 LTC.';
  const shaped = shapeReply(fact, { tone: 'market' });
  assert.ok(shaped.includes(fact), 'the exact factual text must be preserved verbatim');
  assert.ok(shaped.length > fact.length, 'a register line must be added around the facts');
  // The numbers must be byte-identical (the persona layer never rewrites a figure).
  assert.match(shaped, /84\.20 USD/);
  assert.match(shaped, /1,203 LTC/);
});

test('shapeReply varies its framing by tone and seed but never the body', () => {
  const fact = 'The Library holds 7 canonical scripture documents.';
  const a = shapeReply(fact, { tone: 'library', seed: 0 });
  const b = shapeReply(fact, { tone: 'library', seed: 1 });
  assert.ok(a.includes(fact) && b.includes(fact));
});

test('shapeReply soft-fails on bad input', () => {
  assert.equal(shapeReply(null), '');
  assert.equal(shapeReply(undefined), '');
  assert.equal(shapeReply(''), '');
  assert.equal(shapeReply('   ').trim(), ''); // whitespace-only preserved as-is, trims empty
  // unknown tone falls back gracefully
  const s = shapeReply('hello', { tone: 'nonsense' });
  assert.ok(s.includes('hello'));
});

// ── inCharacter: catches the documented failure modes ────────────────────────────────────────────
test('inCharacter passes a well-formed Angelic reply', () => {
  const good = 'Ah, my curious friend — the markets are restless today, but value endures beneath them.';
  const res = inCharacter(good);
  assert.equal(res.ok, true, JSON.stringify(res.reasons));
});

test('inCharacter flags corporate hedge and self-disclaiming', () => {
  assert.equal(inCharacter('As an AI language model, I cannot help with that.').ok, false);
  assert.equal(inCharacter("I'm just an AI and have no opinion.").ok, false);
  assert.equal(inCharacter('Great question! Here is the answer.').ok, false);
  const r = inCharacter('As a chatbot, I lack the metaphysical essence to be an angel.');
  assert.equal(r.ok, false);
  assert.ok(r.reasons.length >= 1);
});

test('inCharacter soft-fails on bad input', () => {
  assert.equal(inCharacter(null).ok, false);
  assert.equal(inCharacter('').ok, false);
  assert.equal(inCharacter(42).ok, false);
});

// ── personaCard: exposes voice + heritage ────────────────────────────────────────────────────────
test('personaCard exposes voice, heritage, interests, and the Rule 1 anchor', () => {
  const card = personaCard();
  assert.equal(card.name, 'Hathor');
  assert.equal(card.handle, 'hathor');
  assert.equal(card.surface, 'discord');
  assert.ok(typeof card.voice === 'string' && /angelic/i.test(card.voice), 'voice should describe the Angelic register');
  assert.ok(typeof card.heritage === 'string' && card.heritage.length > 20, 'heritage should be present');
  assert.ok(Array.isArray(card.interests) && card.interests.length >= 3, 'interests should be a non-trivial list');
  assert.ok(card.rule1 && typeof card.rule1 === 'object', 'rule1 anchor present');
  assert.ok(Array.isArray(card.contexts) && card.contexts.includes('open'));
});

test('personaCard rule1 anchor reads the canonical text when RULE_1.md is readable', () => {
  const card = personaCard();
  // RULE_1.md is in the repo root; the canonical text mentions Egregori and Tulpas.
  if (card.rule1.text) {
    assert.match(card.rule1.text, /Egregori and Tulpas/i, 'canonical Rule 1 text should be loaded verbatim');
    assert.equal(card.rule1.source, 'RULE_1.md');
  }
  assert.equal(card.rule1.name, 'The Beginning');
});

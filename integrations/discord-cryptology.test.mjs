// discord-cryptology.test.mjs — offline. Verifies the Discord bot moves + reads the Crypt-ology map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectDiscordCryptology, classifyDiscordEvent, resolveAccount } from './discord-cryptology.mjs';

const tmp = () => path.join(os.tmpdir(), `disc-crypt-${process.pid}-${Math.random().toString(36).slice(2)}.json`);

test('classifyDiscordEvent maps messages to real EVENT keys', () => {
  assert.equal(classifyDiscordEvent('hey hathor'), 'greeted');
  assert.equal(classifyDiscordEvent('thanks so much'), 'thanked');
  assert.equal(classifyDiscordEvent('how does oilahuasca work?'), 'deep_question');
  assert.equal(classifyDiscordEvent('you are an idiot'), 'hostile');
  assert.equal(classifyDiscordEvent('nice'), 'warm_exchange');
});

test('resolveAccount accepts a MELEK handle and rejects junk', () => {
  assert.equal(resolveAccount('@Alice'), 'alice');
  assert.equal(resolveAccount({ melek: 'bob' }), 'bob');
  assert.equal(resolveAccount('not a real one!!'), null);
});

test('observe MOVES the map (real cryptology, temp store) and greet READS it', () => {
  const file = tmp();
  const c = connectDiscordCryptology({ file });
  // a warm, curious exchange from a Discord user keyed to their MELEK account
  const disp = c.observe('seeker', 'thank you — can you teach me about the terpene map?', { topics: { botanicals: 6 } });
  assert.ok(disp && disp.stance, 'returns a disposition after observing');
  // it persisted to the injected store under the account key
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(saved.seeker, 'profile persisted under MELEK account');
  assert.ok((saved.seeker.interests.botanicals || 0) > 0, 'interest axis drifted');
  assert.ok(saved.seeker.totalInteractions >= 1, 'interaction recorded');
  // greet now reads that position and returns an in-register, non-empty greeting
  const g = c.greet('seeker');
  assert.ok(typeof g === 'string' && g.length > 0, 'greeting reflects the map and is never empty');
});

test('a brand-new user still gets a welcoming greeting; invalid user never throws', () => {
  const c = connectDiscordCryptology({ file: tmp() });
  assert.ok(c.greet('newcomer').length > 0);
  assert.equal(c.observe('bad name!!', 'hi'), null, 'invalid account is a no-op, not a throw');
  assert.equal(c.dispositionFor('bad name!!'), null);
});

test('cryptology is injectable (stub) so the wiring is testable without the real store', () => {
  const calls = [];
  const stub = {
    loadStore: () => ({}),
    isValidAccount: () => true,
    accountKey: (s) => String(s).toLowerCase(),
    recall: () => ({ warmth: 60, familiarity: 50, trust: 50, totalInteractions: 3, interests: { esoteric: 40 } }),
    dispositionOf: (p) => ({ stance: 'kindred', coordinates: p }),
    suggestTopics: () => [{ topic: 'esoteric', weight: 40 }],
    observe: (acct, ev, opts) => { calls.push({ acct, ev, opts }); return { stance: 'kindred' }; },
  };
  const c = connectDiscordCryptology({ cryptology: stub });
  const d = c.dispositionFor('mystic');
  assert.equal(d.disposition.stance, 'kindred');
  c.observe('mystic', 'teach me the mysteries');
  assert.equal(calls[0].ev, 'deep_question');
  assert.equal(calls[0].opts.surface, 'discord');
});

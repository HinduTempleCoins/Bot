/**
 * Tests for welcomer/composer.js.
 *
 *   node --test welcomer/composer.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeWelcomeMention, _internals } from './composer.js';

const sampleWelcomePost = {
  author: 'hathor',
  permlink: 'welcome-to-melek-start-here',
};
const tutorialLink = 'https://github.com/HinduTempleCoins/Bot/blob/main/BRIEF.md';

test('returns the comment action shape', () => {
  const out = composeWelcomeMention({
    account: 'alice',
    welcomePost: sampleWelcomePost,
    tutorialLink,
  });
  assert.equal(out.action, 'comment');
  assert.equal(out.comment.parentAuthor, 'hathor');
  assert.equal(out.comment.parentPermlink, 'welcome-to-melek-start-here');
  assert.ok(out.comment.permlink.startsWith('re-hathor-welcome-to-melek-start-here-welcome-alice'));
});

test('body mentions the account (so the notification fires)', () => {
  const out = composeWelcomeMention({
    account: 'alice',
    welcomePost: sampleWelcomePost,
    tutorialLink,
  });
  assert.ok(out.comment.body.includes('@alice'),
    'body MUST mention @account or the user gets no notification');
});

test('body includes the tutorial link', () => {
  const out = composeWelcomeMention({
    account: 'alice',
    welcomePost: sampleWelcomePost,
    tutorialLink,
  });
  assert.ok(out.comment.body.includes(tutorialLink));
});

test('body is 2-4 sentences', () => {
  for (const account of ['alice', 'bob', 'carol', 'dave']) {
    const out = composeWelcomeMention({
      account,
      welcomePost: sampleWelcomePost,
      tutorialLink,
    });
    // Crude sentence count: split on .!? and filter non-empty trimmed.
    const sentences = out.comment.body
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    assert.ok(
      sentences.length >= 2 && sentences.length <= 4,
      `expected 2-4 sentences, got ${sentences.length} for @${account}: ${out.comment.body}`,
    );
  }
});

test('deterministic per account (same input → same output)', () => {
  const a = composeWelcomeMention({ account: 'alice', welcomePost: sampleWelcomePost, tutorialLink });
  const b = composeWelcomeMention({ account: 'alice', welcomePost: sampleWelcomePost, tutorialLink });
  assert.equal(a.comment.body, b.comment.body);
  assert.equal(a.comment.permlink, b.comment.permlink);
});

test('variants are not all identical across different accounts', () => {
  // 4 templates, 10 distinct accounts — should hit at least 2 distinct bodies.
  const bodies = new Set();
  for (const name of ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry', 'ivy', 'jack']) {
    bodies.add(composeWelcomeMention({ account: name, welcomePost: sampleWelcomePost, tutorialLink }).comment.body);
  }
  assert.ok(bodies.size >= 2, `expected variety, got ${bodies.size} distinct welcome bodies`);
});

test('does not include "I am a bot" / disclaimer language', () => {
  // Per CLAUDE.md and brief: MELEK does not label accounts AI-vs-human.
  for (const account of ['alice', 'bob', 'carol', 'dave']) {
    const out = composeWelcomeMention({ account, welcomePost: sampleWelcomePost, tutorialLink });
    const body = out.comment.body.toLowerCase();
    assert.equal(body.includes('i am a bot'), false, 'no AI disclaimer in welcome body');
    assert.equal(body.includes("i'm a bot"), false);
    assert.equal(body.includes('automated message'), false);
  }
});

test('permlink is lowercase, hyphenated, ≤255 chars', () => {
  const out = composeWelcomeMention({
    account: 'a-very-long-account-name-edge-case',
    welcomePost: {
      author: 'hathor',
      permlink: 'a'.repeat(220), // pathological long permlink
    },
    tutorialLink,
  });
  assert.ok(out.comment.permlink.length <= 255);
  assert.match(out.comment.permlink, /^[a-z0-9-]+$/);
});

test('throws when account is missing', () => {
  assert.throws(() => composeWelcomeMention({ welcomePost: sampleWelcomePost, tutorialLink }));
});

test('throws when welcomePost is missing author or permlink', () => {
  assert.throws(() => composeWelcomeMention({ account: 'alice', tutorialLink }));
  assert.throws(() => composeWelcomeMention({ account: 'alice', welcomePost: { author: 'hathor' }, tutorialLink }));
  assert.throws(() => composeWelcomeMention({ account: 'alice', welcomePost: { permlink: 'p' }, tutorialLink }));
});

test('throws when tutorialLink is missing', () => {
  assert.throws(() => composeWelcomeMention({ account: 'alice', welcomePost: sampleWelcomePost }));
});

test('pickVariant deterministic', () => {
  // Sanity check on the internal — same input twice → same result.
  const a = _internals.pickVariant('alice', _internals.WELCOME_TEMPLATES);
  const b = _internals.pickVariant('alice', _internals.WELCOME_TEMPLATES);
  assert.equal(a, b);
});

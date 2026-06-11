// welcomer/welcome-post.test.mjs — offline tests for the Welcome-post +
// @-mention composer. node:test + node:assert/strict. No network, no clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeWelcomePost,
  composeMention,
  esc,
  _internals,
} from './welcome-post.mjs';

// ---- composeWelcomePost -----------------------------------------------------

test('composeWelcomePost returns {title, body} strings', () => {
  const { title, body } = composeWelcomePost();
  assert.equal(typeof title, 'string');
  assert.equal(typeof body, 'string');
  assert.ok(title.length > 0);
  assert.ok(body.length > 0);
});

test('Welcome post mentions the tutorial and includes the link', () => {
  const { body } = composeWelcomePost();
  assert.match(body, /tutorial|walkthrough|start/i);
  // default link present
  assert.ok(body.includes(_internals.DEFAULT_TUTORIAL_LINK));
});

test('Welcome post uses a custom tutorial link when given', () => {
  const link = 'https://example.test/start-here';
  const { body } = composeWelcomePost({ tutorialLink: link });
  assert.ok(body.includes(link));
});

test('Welcome post is deterministic (same input -> same output)', () => {
  const a = composeWelcomePost({ tutorialLink: 'https://x.test/t' });
  const b = composeWelcomePost({ tutorialLink: 'https://x.test/t' });
  assert.deepEqual(a, b);
});

test('Welcome post is MELEK-voiced (signed Hathor, names MELEK)', () => {
  const { body } = composeWelcomePost();
  assert.match(body, /MELEK/);
  assert.match(body, /Hathor/);
});

test('Welcome post escapes a hostile tutorial link', () => {
  const evil = 'https://x.test/"><script>alert(1)</script>';
  const { body } = composeWelcomePost({ tutorialLink: evil });
  assert.ok(!body.includes('<script>'));
  assert.ok(body.includes('&lt;script&gt;'));
});

test('Welcome post does NOT include an "I am a bot" disclaimer', () => {
  const { body } = composeWelcomePost();
  assert.doesNotMatch(body, /i am a bot|i'm a bot|automated bot|this is a bot/i);
});

// ---- composeMention ---------------------------------------------------------

test('mention contains @account', () => {
  const body = composeMention('alice');
  assert.ok(body.includes('@alice'));
});

test('mention asks one easy question and links the tutorial', () => {
  const body = composeMention('bob');
  assert.match(body, /\?/); // a question
  assert.ok(body.includes(_internals.DEFAULT_TUTORIAL_LINK));
});

test('mention accepts a custom tutorial link', () => {
  const link = 'https://example.test/learn';
  const body = composeMention('carol', { tutorialLink: link });
  assert.ok(body.includes(link));
  assert.ok(body.includes('@carol'));
});

test('mention is deterministic for the same account', () => {
  assert.equal(composeMention('dave'), composeMention('dave'));
});

test('mention sanitizes a hostile account handle (no markup injection)', () => {
  const body = composeMention('al<script>ice');
  assert.ok(!body.includes('<script>'));
  // sanitized to a valid graphene-ish handle: lowercase a-z0-9.- only
  assert.match(body, /@[a-z0-9.-]*/);
});

test('mention escapes a hostile tutorial link', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const body = composeMention('eve', { tutorialLink: evil });
  assert.ok(!body.includes('<img'));
  assert.ok(body.includes('&lt;img'));
});

test('mention soft-fails on empty/garbage account (never throws)', () => {
  assert.doesNotThrow(() => composeMention(''));
  assert.doesNotThrow(() => composeMention(null));
  assert.doesNotThrow(() => composeMention(undefined));
  assert.doesNotThrow(() => composeMention({}));
  // empty handle still produces an @-mention scaffold (notification still fires conceptually)
  const body = composeMention('');
  assert.ok(body.includes('@'));
});

test('mention does NOT include an "I am a bot" disclaimer', () => {
  const body = composeMention('frank');
  assert.doesNotMatch(body, /i am a bot|i'm a bot|automated bot|this is a bot/i);
});

// ---- esc / internals --------------------------------------------------------

test('esc escapes the five HTML metacharacters', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('esc handles null/undefined safely', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('sanitizeAccount strips disallowed chars and caps length', () => {
  assert.equal(_internals.sanitizeAccount('Alice!@#'), 'alice');
  assert.equal(_internals.sanitizeAccount('A'.repeat(50)).length, 16);
  assert.equal(_internals.sanitizeAccount(null), '');
});

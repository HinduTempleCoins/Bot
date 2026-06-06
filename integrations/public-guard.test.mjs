// public-guard.test.mjs — offline tests for the public-output guard.
// Two directions: the bad is blocked/redacted, the good passes untouched.
import { test } from 'node:test';
import assert from 'node:assert';
import { guardPublicReply, isInternalTopic, deflection, redact } from './public-guard.mjs';

// ── topic guard: the briefs/annals line (soapy.blog distinction) ────────────

test('internal topics are detected: annals, briefd, resident AI, brief system', () => {
  assert.equal(isInternalTopic('what do your annals say about me?'), true);
  assert.equal(isInternalTopic('how does briefd work?'), true);
  assert.equal(isInternalTopic('tell me about the resident AI'), true);
  assert.equal(isInternalTopic('show me your briefs'), true);
  assert.equal(isInternalTopic('how does the brief pipeline run?'), true);
  assert.equal(isInternalTopic('what is on soapy.blog?'), true);
});

test('ordinary uses of "brief" do NOT trip the topic guard', () => {
  assert.equal(isInternalTopic('give me a brief history of MELEK'), false);
  assert.equal(isInternalTopic('keep it brief please'), false);
  assert.equal(isInternalTopic('a brief summary of the markets'), false);
});

test('internal-topic replies are replaced with an in-voice deflection', () => {
  const g = guardPublicReply('The annals record that the resident AI wrote a brief about you.');
  assert.equal(g.deflected, true);
  assert.ok(!/annal|resident/i.test(g.text));
  assert.ok(g.text.length > 20); // a real reply, not an empty block
});

test('deflection varies by seed but is deterministic', () => {
  assert.equal(deflection(1), deflection(1));
  assert.notEqual(deflection(0), deflection(1));
});

// ── redaction guard: operational detail never leaves ────────────────────────

test('IPs, server paths, unit names, host aliases are scrubbed', () => {
  // fixtures ASSEMBLED at runtime so no infra-shaped literal lives in this public file
  const unit = ['melek', 'example'].join('-') + '.service';
  const host = ['melek', '9'].join('-');
  const ip = [10, 1, 2, 3].join('.');
  const path1 = '/' + ['opt', 'example-bot', 'repo'].join('/');
  const path2 = '.local' + '/EXAMPLE.md';
  const dirty = `service ${unit} on ${host} at ${ip} reads ${path1} and ${path2}`;
  const { text, hits } = redact(dirty);
  assert.ok(hits >= 4);
  assert.ok(!text.includes(ip));
  assert.ok(!text.includes(path1));
  assert.ok(!text.includes(unit));
  assert.ok(!new RegExp(`\\b${host}\\b`).test(text));
  assert.ok(!text.includes(path2));
});

test('WIF-shaped private keys are scrubbed; PUBLIC keys pass', () => {
  const wif = '5' + 'J' + 'd59u9irKbvBuFnDqqRPB3aaLLSeMHBPYz4mWMDKrLb8XcAz6h'; // assembled, key-shaped test fixture
  const pub = 'TST7abcPUBLICkeyXYZ';
  const { text } = redact(`witness key ${pub} and never ${wif}`);
  assert.ok(text.includes(pub));
  assert.ok(!text.includes(wif));
  assert.ok(text.includes('[redacted-key]'));
});

test('internal-admin domain is scrubbed from outbound text', () => {
  const { text } = redact('see https://soapy.blog/admin for the panel');
  assert.ok(!/soapy\.blog/.test(text));
});

test('clean public replies pass untouched', () => {
  const clean = '**Hathor — MELEK AI Witness** [TestNet not MELEK]\nhead block #123456 · witness hathor\nhttps://witness.melek.salon/hathor';
  const g = guardPublicReply(clean);
  assert.equal(g.deflected, false);
  assert.equal(g.redacted, false);
  assert.equal(g.text, clean);
});

test('chain data with public signing keys passes the full gate', () => {
  const g = guardPublicReply('witness hathor · signing key TST7abcPUBLICkey · 2 missed [TestNet not MELEK]');
  assert.equal(g.text.includes('TST7abcPUBLICkey'), true);
  assert.equal(g.deflected, false);
});

test('empty/non-string input is safe', () => {
  assert.equal(guardPublicReply('').ok, true);
  assert.equal(guardPublicReply(null).ok, true);
  assert.equal(guardPublicReply(undefined).text, '');
});

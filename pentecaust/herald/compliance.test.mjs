import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  warmupCap, perInboxCap, deliverabilityHealth, listUnsubscribeHeaders,
  complianceFooter, assertVoiceConsent, checkSend, THRESHOLDS,
} from './compliance.mjs';

test('warmupCap ramps start→max and caps at max', () => {
  assert.equal(warmupCap(0, { start: 10, max: 50, rampDays: 28 }), 10);
  assert.equal(warmupCap(28, { start: 10, max: 50, rampDays: 28 }), 50);
  assert.equal(warmupCap(100, { start: 10, max: 50, rampDays: 28 }), 50);
  assert.ok(warmupCap(14, { start: 10, max: 50, rampDays: 28 }) > 10);
});

test('perInboxCap: established sits in 25-65, new follows ramp', () => {
  assert.equal(perInboxCap({ established: true, max: 50 }), 50);
  assert.ok(perInboxCap({ established: true, max: 200 }) <= 65);
  assert.equal(perInboxCap({ warmupDay: 0, max: 50 }), warmupCap(0, { max: 50 }));
});

test('deliverabilityHealth flags stop over 2% bounce / 0.3% complaints', () => {
  assert.equal(deliverabilityHealth({ sent: 1000, bounces: 5, complaints: 0 }).status, 'ok');
  assert.equal(deliverabilityHealth({ sent: 1000, bounces: 25, complaints: 0 }).status, 'stop');   // 2.5%
  assert.equal(deliverabilityHealth({ sent: 1000, bounces: 0, complaints: 4 }).status, 'stop');    // 0.4%
  assert.equal(deliverabilityHealth({ sent: 1000, bounces: 18, complaints: 0 }).status, 'throttle'); // 1.8%
});

test('RFC 8058 one-click headers', () => {
  const h = listUnsubscribeHeaders('https://x.co/unsub?t=1', 'unsub@x.co');
  assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(h['List-Unsubscribe'].includes('https://x.co/unsub?t=1'));
  assert.deepEqual(listUnsubscribeHeaders(), {});
});

test('complianceFooter includes address + unsub; EU adds lawful basis; escapes', () => {
  const us = complianceFooter({ region: 'US', senderName: 'MELEK', postalAddress: '1 A St', unsubscribeUrl: 'https://x.co/u' });
  assert.ok(us.includes('1 A St') && us.includes('Unsubscribe'));
  const eu = complianceFooter({ region: 'EU', postalAddress: '1 A St', lawfulBasis: 'legitimate interest', unsubscribeUrl: 'https://x.co/u' });
  assert.ok(eu.includes('Lawful basis'));
  assert.ok(complianceFooter({ senderName: '<b>x</b>', postalAddress: 'a' }).includes('&lt;b&gt;'));
});

test('TCPA gate blocks AI-voice/SMS without consent, allows email', () => {
  assert.equal(assertVoiceConsent({ channel: 'ai-voice', hasRecordedConsent: false }).ok, false);
  assert.equal(assertVoiceConsent({ channel: 'sms', hasRecordedConsent: false }).ok, false);
  assert.equal(assertVoiceConsent({ channel: 'ai-voice', hasRecordedConsent: true }).ok, true);
  assert.equal(assertVoiceConsent({ channel: 'email' }).ok, true);
});

test('checkSend: clean email passes with headers+footer', () => {
  const r = checkSend({ channel: 'email', region: 'US', senderName: 'MELEK', postalAddress: '1 A St',
    unsubscribeUrl: 'https://x.co/u', recipient: 'a@b.co' });
  assert.equal(r.ok, true);
  assert.equal(r.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(r.footer.includes('1 A St'));
});

test('checkSend: missing address/unsub + suppressed + bad health all block', () => {
  const r = checkSend({ channel: 'email', recipient: 'a@b.co', suppression: ['a@b.co'],
    health: { sent: 1000, bounces: 30, complaints: 0 } });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes('postal address')));
  assert.ok(r.blockers.some((b) => b.includes('unsubscribe')));
  assert.ok(r.blockers.some((b) => b.includes('suppressed')));
  assert.ok(r.blockers.some((b) => b.includes('deliverability STOP')));
});

test('checkSend: ai-voice without consent blocks', () => {
  const r = checkSend({ channel: 'ai-voice', recipient: 'a@b.co', hasRecordedConsent: false });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.includes('TCPA')));
});

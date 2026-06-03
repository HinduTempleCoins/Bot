// inbox-triage.test.mjs — offline tests for the VKFRI inbox-triage helper (task #136).
// node --test integrations/inbox-triage.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  ACTIONABLE,
  classifyEmail,
  ruleClassify,
  vkfriSignature,
  draftReply,
  triageInbox,
  redactEmail,
  __setClassifier,
  ORG_NAME,
  ORG_SHORT,
} from './inbox-triage.mjs';

test('classifyEmail tags an invoice with the rule classifier', () => {
  const r = classifyEmail({ from: 'billing@vendor.example', subject: 'Invoice #221 — payment due', body: 'Amount due net 30.' });
  assert.equal(r.category, 'invoice');
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
  assert.ok(r.priority >= 0 && r.priority <= 3);
});

test('classifyEmail tags an urgent email', () => {
  const r = classifyEmail({ from: 'x@y.example', subject: 'URGENT: deadline tomorrow', body: 'Need this ASAP.' });
  assert.equal(r.category, 'urgent');
  assert.equal(r.priority, 3);
});

test('classifyEmail tags a newsletter', () => {
  const r = classifyEmail({ from: 'no-reply@list.example', subject: 'Weekly digest', body: 'Click here to unsubscribe. View in browser.' });
  assert.equal(r.category, 'newsletter');
});

test('classifyEmail tags spam and never escalates spam to a draft category', () => {
  const r = classifyEmail({ from: 'scam@x.example', subject: 'Congratulations you have won — urgent', body: 'Claim your bitcoin doubler now.' });
  assert.equal(r.category, 'spam'); // spam precedence wins over the "urgent" keyword
});

test('classifyEmail defaults unmatched mail to other', () => {
  const r = classifyEmail({ from: 'a@b.example', subject: 'hi', body: 'just saying hello there' });
  assert.equal(r.category, 'other');
});

test('classifyEmail is pure given an injected classifier and soft-fails on classifier error', () => {
  __setClassifier(() => ({ category: 'collaboration', priority: 2, reasons: ['injected'] }));
  assert.equal(classifyEmail({ subject: 'anything' }).category, 'collaboration');

  __setClassifier(() => { throw new Error('boom'); });
  const r = classifyEmail({ subject: 'anything' });
  assert.equal(r.category, 'other');
  assert.ok(r.reasons.join(' ').includes('classifier error'));

  __setClassifier(null); // restore default for later tests
  assert.equal(classifyEmail({ subject: 'Invoice payment due' }).category, 'invoice');
});

test('vkfriSignature includes the org name', () => {
  const sig = vkfriSignature({ name: 'R. Van Kush', title: 'Director' });
  assert.ok(sig.includes(ORG_NAME));
  assert.ok(sig.includes(ORG_SHORT));
  assert.ok(sig.includes('R. Van Kush'));
  assert.ok(sig.toLowerCase().includes('drafts only'));
});

test('vkfriSignature still names the org with no args', () => {
  const sig = vkfriSignature();
  assert.ok(sig.includes(ORG_NAME));
});

test('draftReply ALWAYS returns status DRAFT + needs_human_review true, never sent', () => {
  const cases = [
    { from: 'a@b.example', subject: 'A question', body: 'Could you help?' },
    { from: 'c@d.example', subject: 'URGENT deadline', body: 'asap please' },
    { from: 'e@f.example', subject: 'partnership', body: 'lets collaborate' },
    { from: 'g@h.example', subject: '', body: '' },
  ];
  for (const e of cases) {
    const d = draftReply(e, { signature: vkfriSignature({ name: 'X' }) });
    assert.equal(d.status, 'DRAFT');
    assert.notEqual(d.status, 'sent');
    assert.equal(d.needs_human_review, true);
    assert.ok(d.subject.startsWith('Re:'));
    assert.ok(!/status['"]?\s*[:=]\s*['"]?sent/i.test(JSON.stringify(d)), 'draft must never say sent');
  }
});

test('draftReply does not double-prefix an existing Re:', () => {
  const d = draftReply({ from: 'a@b.example', subject: 'Re: already a reply', body: 'hi' });
  assert.equal(d.subject, 'Re: already a reply');
});

test('draftReply appends the signature to the body', () => {
  const sig = vkfriSignature({ name: 'R. Van Kush' });
  const d = draftReply({ from: 'a@b.example', subject: 'inquiry', body: 'question?' }, { signature: sig });
  assert.ok(d.body.includes(ORG_NAME));
});

test('triageInbox sorts by priority desc and only drafts for actionable categories', () => {
  const emails = [
    { from: 'news@list.example', subject: 'Weekly digest', body: 'unsubscribe here' },          // newsletter p0
    { from: 'scam@x.example', subject: 'you have won the lottery', body: 'bitcoin doubler' },     // spam p0
    { from: 'q@x.example', subject: 'A quick question', body: 'could you advise?' },              // inquiry p2
    { from: 'u@x.example', subject: 'URGENT deadline', body: 'asap please' },                      // urgent p3
    { from: 'c@x.example', subject: 'partnership proposal', body: 'lets collaborate' },            // collaboration p2
    { from: 'b@x.example', subject: 'Invoice payment due', body: 'amount due' },                   // invoice p1
  ];
  const { items, summary } = triageInbox(emails, { signature: vkfriSignature({ name: 'X' }) });

  // sorted by priority descending
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i - 1].priority >= items[i].priority, 'items must be sorted by priority desc');
  }
  assert.equal(items[0].priority, 3); // urgent on top

  // drafts only for actionable; never for spam / newsletter / invoice
  for (const it of items) {
    if (ACTIONABLE.has(it.category)) {
      assert.ok(it.suggestedDraft, `${it.category} should have a draft`);
      assert.equal(it.suggestedDraft.status, 'DRAFT');
    } else {
      assert.equal(it.suggestedDraft, undefined, `${it.category} must NOT have a draft`);
    }
  }

  // explicitly: no draft for spam
  const spam = items.find((i) => i.category === 'spam');
  assert.ok(spam && spam.suggestedDraft === undefined, 'spam must never get a draft');

  // summary counts
  assert.equal(summary.total, emails.length);
  assert.equal(summary.byCategory.urgent, 1);
  assert.equal(summary.byCategory.spam, 1);
  assert.equal(summary.byCategory.newsletter, 1);
});

test('triageInbox handles empty / non-array input gracefully', () => {
  assert.equal(triageInbox([]).items.length, 0);
  assert.equal(triageInbox().items.length, 0);
  assert.equal(triageInbox(null).items.length, 0);
});

test('triageInbox summary covers every category key', () => {
  const { summary } = triageInbox([{ from: 'a@b', subject: 'hi', body: 'plain note' }]);
  for (const c of CATEGORIES) assert.ok(c in summary.byCategory);
});

test('redactEmail omits the body and keeps from/subject/category', () => {
  const email = { from: 'secret@x.example', subject: 'Sensitive thing', body: 'CONFIDENTIAL PRIVATE DETAILS HERE' };
  const r = redactEmail(email);
  assert.equal(r.from, 'secret@x.example');
  assert.equal(r.subject, 'Sensitive thing');
  assert.ok('category' in r);
  assert.ok(!('body' in r), 'redacted summary must not include body');
  assert.ok(!JSON.stringify(r).includes('CONFIDENTIAL'), 'body content must not leak');
});

test('ruleClassify is the deterministic default and pure', () => {
  const e = { subject: 'Invoice payment', body: 'net 30' };
  const a = ruleClassify(e);
  const b = ruleClassify(e);
  assert.deepEqual(a, b);
  assert.equal(a.category, 'invoice');
});

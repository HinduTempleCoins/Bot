import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNext, docIdOf } from './submit.mjs';

test('pickNext skips open and recently-failed films; gives up after 3 tries', () => {
  assert.equal(docIdOf({ topic: 'carthage', minutes: 30 }), 'carthage-30');
  const ordered = [{ docId: 'minoans' }, { docId: 'carthage' }, { docId: 'delphi' }];
  const now = 1e12;
  assert.equal(pickNext(ordered, { status: { recent: [{ docId: 'minoans', status: 'rendering' }] }, state: { carthage: { at: now - 3600e3, tries: 1 } }, now }).docId, 'delphi');
  assert.equal(pickNext([{ docId: 'carthage' }], { state: { carthage: { at: 0, tries: 3 } }, now }), null);
  assert.equal(pickNext([{ docId: 'carthage' }], { state: { carthage: { at: 0, tries: 1 } }, now }).docId, 'carthage');
});

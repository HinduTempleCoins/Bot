/**
 * composers.test.mjs — OFFLINE unit tests for the deterministic lesson-post
 * composer (task #43). No chain reads; reads only the in-repo stages.json.
 *
 *   node --test tutorial/composers.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeLessonPost,
  composeLessonPostByKey,
  describeCompletion,
  loadStagesDoc,
} from './composers.mjs';

test('composeLessonPost is pure and deterministic for a sample stage', () => {
  const doc = loadStagesDoc();
  const stage = doc.stages.find((s) => s.key === 'intro_post');
  const a = composeLessonPost(stage);
  const b = composeLessonPost(stage);
  assert.deepEqual(a, b, 'same stage must yield byte-identical output');
  assert.equal(a.title, 'Stage 1: Post an introduction');
  assert.match(a.body, /## Stage 1: Post an introduction/);
  assert.match(a.body, /\*\*What counts:\*\*/);
  assert.match(a.body, /introduceyourself/);
  assert.match(a.body, /works on MELEK today/);
});

test('composeLessonPostByKey produces every stage without throwing', () => {
  const doc = loadStagesDoc();
  for (const stage of doc.stages) {
    const out = composeLessonPostByKey(stage.key, doc);
    assert.ok(out.title.startsWith(`Stage ${stage.id}:`), stage.key);
    assert.ok(out.body.length > 40, `body too short for ${stage.key}`);
  }
});

test('Tier-B stages are flagged as placeholders with their infra dependency', () => {
  const out = composeLessonPostByKey('create_a_token');
  assert.match(out.body, /placeholder/i);
  assert.match(out.body, /Waiting on: SMTs/);
});

test('a transfer-reward stage names the MELEK amount', () => {
  const out = composeLessonPostByKey('first_organic_upvote');
  assert.match(out.body, /1\.000 MELEK/);
});

test('the terminal stage announces it is the last one', () => {
  const out = composeLessonPostByKey('become_a_node_of_the_network');
  assert.match(out.body, /last stage/i);
});

test('describeCompletion handles each documented criteria kind', () => {
  assert.match(describeCompletion({ kind: 'witness_vote_cast', min_count: 1 }), /witness vote/);
  assert.match(
    describeCompletion({ kind: 'transfer_to_vesting', min_amount_melek: '1.000' }),
    /MELEK Power/,
  );
  assert.match(
    describeCompletion({ kind: 'follows_created', min_distinct_followed: 3 }),
    /3 different accounts/,
  );
  // Unknown kind falls back safely, no throw.
  assert.match(describeCompletion({ kind: 'something_new' }), /something_new/);
  assert.match(describeCompletion(null), /Complete the action/);
});

test('composeLessonPost rejects a non-object stage', () => {
  assert.throws(() => composeLessonPost(null), /stage object required/);
});

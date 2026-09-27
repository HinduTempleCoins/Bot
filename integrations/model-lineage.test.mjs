import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  hashFile, hashWeights, aggregateHash, validateRecord, recordId, buildAncestry, ancestorsOf,
  lineagePermlink, buildLineagePost, publishLineage, PERSONA_LORA_V0, SCHEMA, APP,
} from './model-lineage.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const A = sha('a'); const B = sha('b'); const C = sha('c'); const D = sha('d');
const base = (over = {}) => ({
  name: 'hathor-test', version: '0.1.0', sha256: A, parents: ['hf:Qwen/Qwen3-0.6B-Base'], method: 'lora',
  data: { summary: 'canon', sources: [{ name: 'RULE_1.md', license: 'ISC' }] },
  eval: { rule1_exact: 1 }, license: 'Apache-2.0', created: '2026-09-27', ...over,
});

test('hashFile / hashWeights match node crypto; soft-fail on missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lineage-'));
  try {
    const f1 = path.join(dir, 'a.safetensors'); const f2 = path.join(dir, 'b.safetensors');
    await writeFile(f1, 'hello'); await writeFile(f2, 'world');
    assert.equal(await hashFile(f1), sha('hello'));
    const one = await hashWeights([f1]);
    assert.equal(one.ok, true); assert.equal(one.sha256, sha('hello')); assert.equal(one.files[0].bytes, 5);
    const two = await hashWeights([f2, f1]);
    assert.equal(two.sha256, aggregateHash(two.files));
    assert.equal(two.sha256, (await hashWeights([f1, f2])).sha256, 'order-independent');
    assert.equal(await hashFile(path.join(dir, 'nope')), null);
    assert.equal((await hashWeights([path.join(dir, 'nope')])).ok, false);
    assert.equal((await hashWeights([])).ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('validateRecord accepts a good record', () => {
  const v = validateRecord(base());
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.deepEqual(v.pending, []);
});

test('validateRecord enforces method/parent rules', () => {
  assert.equal(validateRecord(base({ method: 'from-scratch' })).ok, false);
  assert.equal(validateRecord(base({ method: 'from-scratch', parents: [] })).ok, true);
  assert.equal(validateRecord(base({ method: 'merge', parents: [B] })).ok, false);
  assert.equal(validateRecord(base({ method: 'merge', parents: [B, C] })).ok, true);
  assert.equal(validateRecord(base({ method: 'lora', parents: [] })).ok, false);
  assert.equal(validateRecord(base({ method: 'distill' })).ok, false);
  assert.equal(validateRecord(base({ parents: [A] })).ok, false, 'self-parent');
  assert.equal(validateRecord(base({ parents: [B, B] })).ok, false, 'duplicate parents');
  assert.equal(validateRecord(base({ parents: ['not-a-hash'] })).ok, false);
});

test('validateRecord rejects bad fields and private data sources', () => {
  assert.equal(validateRecord(base({ sha256: 'ABC' })).ok, false);
  assert.equal(validateRecord(base({ name: 'Bad Name' })).ok, false);
  assert.equal(validateRecord(base({ created: 'yesterday' })).ok, false);
  assert.equal(validateRecord(base({ license: '' })).ok, false);
  assert.equal(validateRecord(base({ eval: { x: 'high' } })).ok, false);
  assert.equal(validateRecord(base({ data: { summary: 's', sources: [{ name: 'x' }] } })).ok, false, 'licence required');
  assert.equal(validateRecord(base({ data: { summary: 's', sources: [{ name: '.local/notes.md', license: 'private' }] } })).ok, false);
  assert.equal(validateRecord(base({ data: { summary: 's', sources: [{ name: 'corpus', license: 'x', url: '/home/someone/corpus' }] } })).ok, false);
  assert.equal(validateRecord(null).ok, false);
});

test('validateRecord checks multi-file aggregate hash', () => {
  const files = [{ name: 'a', sha256: B }, { name: 'b', sha256: C }];
  assert.equal(validateRecord(base({ files, sha256: aggregateHash(files) })).ok, true);
  assert.equal(validateRecord(base({ files, sha256: D })).ok, false);
});

test('first record (persona LoRA) is valid for a dry run and marked pending', () => {
  const v = validateRecord(PERSONA_LORA_V0);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.deepEqual(v.pending.sort(), ['created', 'license', 'sha256']);
  assert.equal(recordId(PERSONA_LORA_V0), 'pending:hathor-persona-lora@0.1.0');
  assert.match(PERSONA_LORA_V0.data.summary, /332 examples/);
  assert.equal(PERSONA_LORA_V0.method, 'lora');
});

test('buildAncestry walks parents, marks external/missing, cuts cycles', () => {
  const root = base({ name: 'root', sha256: A, method: 'from-scratch', parents: [] });
  const kid = base({ name: 'kid', sha256: B, parents: [A] });
  const other = base({ name: 'other', sha256: C, parents: ['hf:Qwen/Qwen3-0.6B-Base'] });
  const merged = base({ name: 'merged', sha256: D, method: 'merge', parents: [B, C] });
  const t = buildAncestry([root, kid, other, merged], D);
  assert.equal(t.name, 'merged');
  assert.deepEqual(t.parents.map((p) => p.name), ['kid', 'other']);
  assert.equal(t.parents[0].parents[0].name, 'root');
  assert.equal(t.parents[1].parents[0].external, true);
  assert.deepEqual(ancestorsOf([root, kid, other, merged], D), [B, C, A, 'hf:Qwen/Qwen3-0.6B-Base']);
  assert.equal(buildAncestry([], sha('zz')).missing, true);
  const c1 = base({ name: 'c1', sha256: A, parents: [B] }); const c2 = base({ name: 'c2', sha256: B, parents: [A] });
  assert.equal(buildAncestry([c1, c2], A).parents[0].parents[0].cycle, true);
  assert.deepEqual(buildAncestry(undefined, 'x'), { id: 'x', missing: true });
});

test('lineagePermlink is a valid Graphene permlink', () => {
  assert.equal(lineagePermlink('hathor-persona-lora', '0.1.0'), 'model-hathor-persona-lora-0-1-0');
  assert.match(lineagePermlink('Weird_Name', '1.0+rc.1'), /^[a-z0-9-]+$/);
});

test('buildLineagePost emits a STANDARD comment op with the record in json_metadata', () => {
  const r = buildLineagePost(PERSONA_LORA_V0);
  assert.equal(r.ok, true);
  const [name, op] = r.op;
  assert.equal(name, 'comment', 'standard Graphene op only — no custom ops');
  assert.equal(op.author, 'hathor');
  assert.equal(op.parent_author, '');
  assert.equal(op.permlink, 'model-hathor-persona-lora-0-1-0');
  const meta = JSON.parse(op.json_metadata);
  assert.equal(meta.app, APP);
  assert.equal(meta.lineage.schema, SCHEMA);
  assert.equal(meta.lineage.sha256, 'pending');
  assert.deepEqual(meta.lineage.parents, ['hf:unsloth/Qwen2.5-7B-bnb-4bit']);
  assert.match(op.body, /332 examples/);
  assert.deepEqual(r.pending.sort(), ['created', 'license', 'sha256']);
  assert.equal(buildLineagePost({ name: 'x' }).ok, false);
});

test('buildLineagePost keeps table cells from breaking out of the markdown table', () => {
  const r = buildLineagePost(base({ data: { summary: 'a | b\n<script>', sources: [{ name: 'n', license: 'ISC' }] } }));
  assert.doesNotMatch(r.op[1].body, /<script>/);
  assert.match(r.op[1].body, /\| data \| a\s+b\s+script\s+\|/);
});

test('publishLineage defaults to dry run and never calls the signer', async () => {
  let called = 0;
  const signer = async () => { called++; return { id: 'tx' }; };
  const r = await publishLineage({ record: base(), token: 't', signerBroadcast: signer });
  assert.equal(r.ok, true); assert.equal(r.dryRun, true); assert.equal(called, 0);
});

test('publishLineage refuses pending records and missing tokens even with broadcast:true', async () => {
  let called = 0;
  const signer = async () => { called++; return {}; };
  const p = await publishLineage({ record: PERSONA_LORA_V0, broadcast: true, token: 't', signerBroadcast: signer });
  assert.equal(p.ok, false); assert.match(p.error, /pending sha256/);
  const n = await publishLineage({ record: base(), broadcast: true, signerBroadcast: signer });
  assert.equal(n.ok, false); assert.match(n.error, /no MELEK-Signer token/);
  assert.equal(called, 0);
});

test('publishLineage broadcasts through the signer seam (posting role) when fully armed', async () => {
  const calls = [];
  const signer = async (cfg) => { calls.push(cfg); return { id: 'abc', block_num: 7 }; };
  const r = await publishLineage({ record: base(), broadcast: true, token: 'tok', signerBroadcast: signer });
  assert.equal(r.ok, true); assert.equal(r.dryRun, false); assert.equal(r.result.block_num, 7);
  assert.equal(calls[0].role, 'posting');
  assert.equal(calls[0].clientId, 'model-lineage');
  assert.equal(calls[0].ops[0][0], 'comment');
  const f = await publishLineage({ record: base(), broadcast: true, token: 'tok', signerBroadcast: async () => { throw new Error('401'); } });
  assert.equal(f.ok, false); assert.equal(f.error, '401');
});

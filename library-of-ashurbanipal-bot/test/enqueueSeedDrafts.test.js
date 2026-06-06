// enqueueSeedDrafts.test.js — tests for the Ashurbanipal seed-draft enqueuer.
//
// Seed drafts are hand-authored canonical articles (e.g. the SteemBots/Steemcenter ecosystem) whose
// exact prose + @MarsResident provenance must survive into the review queue. These tests verify the
// seed loads, carries the load-bearing @MarsResident citation, enqueues as 'pending' (never
// auto-published), and is idempotent on re-run. Fully offline: in-memory queue store, no network.
//
// Run: node --test test/enqueueSeedDrafts.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import ReviewQueue from '../src/reviewQueue.js';
import { loadSeedDrafts, enqueueSeedDrafts, DEFAULT_SEED_DIR } from '../src/enqueueSeedDrafts.js';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = nodePath.join(__dirname, '..', 'seed-drafts');
const STEEM_ID = 'Steem & Hive Bots — the SteemBots / Steemcenter ecosystem';

// In-memory fs so the queue persists to a Map, not real disk.
function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; }
      return files.get(p);
    },
    writeFileSync: (p, data) => { files.set(p, String(data)); },
    mkdirSync: () => {},
  };
}

function memQueue() {
  let n = 0;
  return new ReviewQueue({
    fs: memFs(),
    path: { dirname: () => 'data' },
    now: () => new Date('2026-06-06T12:00:00.000Z'),
    idFactory: () => `id-${++n}`,
    storePath: 'data/review-queue.jsonl',
  });
}

test('DEFAULT_SEED_DIR resolves to the package seed-drafts directory', () => {
  assert.equal(DEFAULT_SEED_DIR, SEED_DIR);
});

test('loadSeedDrafts loads the SteemBots seed with body, title and sources', () => {
  const drafts = loadSeedDrafts({ seedDir: SEED_DIR });
  const steem = drafts.find((d) => d.articleId === STEEM_ID);
  assert.ok(steem, 'SteemBots/Steemcenter seed draft is present');
  assert.match(steem.title, /SteemBots \/ Steemcenter Ecosystem/);
  assert.ok(steem.body.length > 1000, 'body is substantial');
  assert.ok(Array.isArray(steem.sources) && steem.sources.length >= 10, 'has a full source list');
});

test('the load-bearing @MarsResident citation is preserved in body AND sources', () => {
  const drafts = loadSeedDrafts({ seedDir: SEED_DIR });
  const steem = drafts.find((d) => d.articleId === STEEM_ID);
  // Body: July-2016 first-bot-list attribution + the Steemcenter contributor citation.
  assert.match(steem.body, /@MarsResident/, 'body cites @MarsResident');
  assert.match(steem.body, /Steemcenter — @MarsResident \(documented contributor\)/,
    'body keeps the verbatim Steemcenter citation');
  // Sources: the verbatim citation string is retained.
  assert.ok(
    steem.sources.includes('Steemcenter — @MarsResident (documented contributor)'),
    'sources list keeps the verbatim @MarsResident citation'
  );
});

test('the MELEK-design answers are present (CheetahAdvanced, first-class account, deterministic commands)', () => {
  const drafts = loadSeedDrafts({ seedDir: SEED_DIR });
  const steem = drafts.find((d) => d.articleId === STEEM_ID);
  assert.match(steem.body, /CheetahAdvanced/);
  assert.match(steem.body, /credit-first/);
  assert.match(steem.body, /first-class/i);
  assert.match(steem.body, /!commands/);
  assert.match(steem.body, /hathor/);
});

test('enqueueSeedDrafts adds the seed to the queue as PENDING, not published', () => {
  const q = memQueue();
  const { enqueued } = enqueueSeedDrafts({ queue: q, seedDir: SEED_DIR });
  assert.ok(enqueued.length >= 1, 'at least one draft enqueued');
  const steem = q.listQueue().find((r) => r.articleId === STEEM_ID);
  assert.ok(steem, 'steem draft is in the queue');
  assert.equal(steem.status, 'pending', 'enqueued as pending — awaiting approval');
  assert.equal(steem.publishedAt, null, 'nothing was published');
  assert.equal(q.queueStats().published, 0, 'queue has zero published drafts');
  // The enqueued draft carries the @MarsResident citation through to the queue record.
  assert.match(steem.body, /Steemcenter — @MarsResident \(documented contributor\)/);
});

test('enqueueSeedDrafts is idempotent — re-running does not duplicate a pending draft', () => {
  const q = memQueue();
  const first = enqueueSeedDrafts({ queue: q, seedDir: SEED_DIR });
  const second = enqueueSeedDrafts({ queue: q, seedDir: SEED_DIR });
  const steemRecords = q.listQueue().filter((r) => r.articleId === STEEM_ID);
  assert.equal(steemRecords.length, 1, 'only one steem record exists after two runs');
  assert.ok(first.enqueued.length >= 1, 'first run enqueued');
  assert.ok(
    second.skipped.some((s) => s.articleId === STEEM_ID),
    'second run skipped the already-queued steem draft'
  );
});

test('a draft can ONLY be published via explicit approve→markPublished (no auto-publish path)', () => {
  const q = memQueue();
  enqueueSeedDrafts({ queue: q, seedDir: SEED_DIR });
  const steem = q.listQueue().find((r) => r.articleId === STEEM_ID);
  // Cannot publish a pending draft.
  const blocked = q.markPublished(steem.id);
  assert.equal(blocked.ok, false, 'pending draft refuses to publish');
  // Approve, then publish.
  assert.equal(q.approve(steem.id, { reviewer: 'operator' }).ok, true);
  assert.equal(q.markPublished(steem.id).ok, true);
  assert.equal(q.get(steem.id).status, 'published');
});

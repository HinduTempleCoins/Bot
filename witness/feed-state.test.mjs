// feed-state.test.mjs — Task #39. Fully offline: an in-memory fake fs (records every write/rename
// in order so we can assert the atomic tmp→rename sequence) + an injectable fake clock.
//
//   node --test witness/feed-state.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadState,
  saveState,
  updateState,
  withLock,
  recordPublish,
  defaultState,
  __setFs,
  __setClock,
} from './feed-state.mjs';

// ---- in-memory fake fs -----------------------------------------------------------------------

function makeFakeFs(seed = {}) {
  const files = new Map(Object.entries(seed)); // path -> string contents
  const ops = []; // ordered log of mutating operations
  const mtimes = new Map(); // path -> mtimeMs

  let clock = 1000;
  const fs = {
    _files: files,
    _ops: ops,
    _setMtime: (p, t) => mtimes.set(p, t),

    existsSync: (p) => files.has(p),

    readFileSync: (p) => {
      if (!files.has(p)) {
        const e = new Error(`ENOENT: no such file ${p}`);
        e.code = 'ENOENT';
        throw e;
      }
      return files.get(p);
    },

    writeFileSync: (p, data) => {
      files.set(p, String(data));
      mtimes.set(p, clock++);
      ops.push(['write', p]);
    },

    renameSync: (from, to) => {
      if (!files.has(from)) {
        const e = new Error(`ENOENT: rename ${from}`);
        e.code = 'ENOENT';
        throw e;
      }
      files.set(to, files.get(from));
      files.delete(from);
      mtimes.set(to, clock++);
      ops.push(['rename', from, to]);
    },

    unlinkSync: (p) => {
      files.delete(p);
      ops.push(['unlink', p]);
    },

    statSync: (p) => {
      if (!files.has(p)) {
        const e = new Error(`ENOENT: stat ${p}`);
        e.code = 'ENOENT';
        throw e;
      }
      return { mtimeMs: mtimes.get(p) ?? 0 };
    },
  };
  return fs;
}

// Restore real fs/clock after each test so nothing leaks between tests.
function reset() {
  __setFs(null);
  __setClock(null);
}

// ---- loadState -------------------------------------------------------------------------------

test('loadState returns the safe default when the file is missing', () => {
  __setFs(makeFakeFs());
  try {
    assert.deepEqual(loadState('/x/state.json'), defaultState());
    assert.deepEqual(defaultState(), {
      lastPublished: null,
      lastRunAt: null,
      runCount: 0,
      cursor: null,
    });
  } finally {
    reset();
  }
});

test('loadState returns default on corrupt JSON AND preserves a .bak for forensics', () => {
  const fs = makeFakeFs({ '/x/state.json': '{ this is not json ]' });
  __setFs(fs);
  try {
    const s = loadState('/x/state.json');
    assert.deepEqual(s, defaultState());
    // corrupt file moved aside
    assert.ok(fs._files.has('/x/state.json.bak'), 'corrupt file kept as .bak');
    assert.ok(!fs._files.has('/x/state.json'), 'corrupt original removed');
    assert.equal(fs._files.get('/x/state.json.bak'), '{ this is not json ]');
  } finally {
    reset();
  }
});

test('loadState merges over default so missing keys are filled', () => {
  const fs = makeFakeFs({
    '/x/state.json': JSON.stringify({ runCount: 7, lastPublished: { price: 1.5, at: 42 } }),
  });
  __setFs(fs);
  try {
    const s = loadState('/x/state.json');
    assert.equal(s.runCount, 7);
    assert.deepEqual(s.lastPublished, { price: 1.5, at: 42 });
    assert.equal(s.cursor, null); // filled from default
    assert.equal(s.lastRunAt, null);
  } finally {
    reset();
  }
});

test('loadState treats valid-but-non-object JSON as default', () => {
  const fs = makeFakeFs({ '/x/state.json': '42' });
  __setFs(fs);
  try {
    assert.deepEqual(loadState('/x/state.json'), defaultState());
  } finally {
    reset();
  }
});

// ---- saveState (atomic) ----------------------------------------------------------------------

test('saveState writes the tmp file THEN renames (atomic; never a direct write to final path)', () => {
  const fs = makeFakeFs();
  __setFs(fs);
  try {
    const r = saveState('/x/state.json', { runCount: 1 });
    assert.deepEqual(r, { ok: true });

    // Exactly: write to tmp, then rename tmp -> final. No write directly to the final path.
    assert.deepEqual(fs._ops, [
      ['write', '/x/state.json.tmp'],
      ['rename', '/x/state.json.tmp', '/x/state.json'],
    ]);

    // Final file present, tmp gone.
    assert.ok(fs._files.has('/x/state.json'));
    assert.ok(!fs._files.has('/x/state.json.tmp'));
    assert.deepEqual(JSON.parse(fs._files.get('/x/state.json')), { runCount: 1 });
  } finally {
    reset();
  }
});

test('saveState soft-fails and cleans up tmp when rename throws', () => {
  const fs = makeFakeFs();
  fs.renameSync = () => {
    throw new Error('disk full');
  };
  __setFs(fs);
  try {
    const r = saveState('/x/state.json', { runCount: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /disk full/);
    // tmp cleaned up, final never written
    assert.ok(!fs._files.has('/x/state.json.tmp'));
    assert.ok(!fs._files.has('/x/state.json'));
  } finally {
    reset();
  }
});

// ---- updateState -----------------------------------------------------------------------------

test('updateState merges a patch over loaded state and persists atomically', () => {
  const fs = makeFakeFs({
    '/x/state.json': JSON.stringify({ ...defaultState(), runCount: 2, cursor: 'a' }),
  });
  __setFs(fs);
  try {
    const next = updateState('/x/state.json', { cursor: 'b', lastRunAt: 999 });
    assert.equal(next.cursor, 'b');
    assert.equal(next.lastRunAt, 999);
    assert.equal(next.runCount, 2); // preserved

    // persisted to disk via tmp→rename
    const onDisk = JSON.parse(fs._files.get('/x/state.json'));
    assert.equal(onDisk.cursor, 'b');
    assert.equal(onDisk.lastRunAt, 999);
    assert.ok(fs._ops.some(([k]) => k === 'rename'));
  } finally {
    reset();
  }
});

// ---- withLock --------------------------------------------------------------------------------

test('withLock acquires, runs fn, and releases the lock', async () => {
  const fs = makeFakeFs();
  __setClock(() => 5000);
  __setFs(fs);
  try {
    let ran = false;
    const result = await withLock('/x/state.json', async () => {
      // lock present while fn runs
      assert.ok(fs._files.has('/x/state.json.lock'));
      ran = true;
      return 'done';
    });
    assert.ok(ran);
    assert.equal(result, 'done');
    // released afterward
    assert.ok(!fs._files.has('/x/state.json.lock'));
  } finally {
    reset();
  }
});

test('withLock throws "already running" when a FRESH lock exists', async () => {
  const now = 10000;
  const fs = makeFakeFs({
    '/x/state.json.lock': JSON.stringify({ at: now - 1000 }), // 1s old, well within maxAge
  });
  __setClock(() => now);
  __setFs(fs);
  try {
    let ran = false;
    await assert.rejects(
      () => withLock('/x/state.json', async () => { ran = true; }, { maxAgeMs: 60000 }),
      /already running/,
    );
    assert.equal(ran, false, 'fn must not run when a fresh lock is held');
    // existing fresh lock left intact
    assert.ok(fs._files.has('/x/state.json.lock'));
  } finally {
    reset();
  }
});

test('withLock STEALS a stale lock (older than maxAgeMs) and runs', async () => {
  const now = 1_000_000;
  const fs = makeFakeFs({
    '/x/state.json.lock': JSON.stringify({ at: now - 10 * 60 * 1000 }), // 10 min old
  });
  // advance the clock past the staleness threshold
  __setClock(() => now);
  __setFs(fs);
  try {
    let ran = false;
    const r = await withLock('/x/state.json', async () => { ran = true; return 42; }, {
      maxAgeMs: 5 * 60 * 1000, // 5 min — the lock is older, so stale
    });
    assert.ok(ran, 'stale lock should be stolen and fn run');
    assert.equal(r, 42);
    assert.ok(!fs._files.has('/x/state.json.lock'), 'lock released after run');
  } finally {
    reset();
  }
});

test('withLock releases the lock even when fn throws', async () => {
  const fs = makeFakeFs();
  __setClock(() => 7777);
  __setFs(fs);
  try {
    await assert.rejects(
      () => withLock('/x/state.json', async () => { throw new Error('boom'); }),
      /boom/,
    );
    assert.ok(!fs._files.has('/x/state.json.lock'), 'lock released in finally');
  } finally {
    reset();
  }
});

// ---- recordPublish ---------------------------------------------------------------------------

test('recordPublish bumps runCount and sets lastPublished (feed-publisher shape)', () => {
  const fs = makeFakeFs({
    '/x/state.json': JSON.stringify({ ...defaultState(), runCount: 3 }),
  });
  __setClock(() => 123456);
  __setFs(fs);
  try {
    const op = ['feed_publish', { publisher: 'hathor' }];
    const next = recordPublish('/x/state.json', { price: 0.42, op });
    assert.equal(next.runCount, 4);
    assert.deepEqual(next.lastPublished, { price: 0.42, at: 123456 });
    assert.equal(next.lastRunAt, 123456);
    assert.deepEqual(next.lastOp, op);

    // persisted
    const onDisk = JSON.parse(fs._files.get('/x/state.json'));
    assert.equal(onDisk.runCount, 4);
    assert.equal(onDisk.lastPublished.price, 0.42);
  } finally {
    reset();
  }
});

test('recordPublish from a fresh (missing) state starts runCount at 1', () => {
  const fs = makeFakeFs();
  __setClock(() => 555);
  __setFs(fs);
  try {
    const next = recordPublish('/x/state.json', { price: 1.0 });
    assert.equal(next.runCount, 1);
    assert.deepEqual(next.lastPublished, { price: 1.0, at: 555 });
  } finally {
    reset();
  }
});

test('recordPublish honors an explicit at timestamp', () => {
  const fs = makeFakeFs();
  __setClock(() => 999);
  __setFs(fs);
  try {
    const next = recordPublish('/x/state.json', { price: 2.0, at: 111 });
    assert.equal(next.lastPublished.at, 111);
    assert.equal(next.lastRunAt, 111);
  } finally {
    reset();
  }
});

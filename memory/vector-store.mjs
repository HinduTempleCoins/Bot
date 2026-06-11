// vector-store.mjs — the MELEK Memory vector store (pgvector-backed, dependency-injected).
//
// Per .local/BRAIN_STACK_PLAN.md: Memory = persistent embeddings + linked facts for context
// recovery, on Postgres 17 + pgvector (HNSW). This module is the thin, testable client: it speaks
// SQL to a pgvector table but takes its DB handle and its embedder as INJECTED seams, so the whole
// thing is exercised offline with an in-memory fake — no Postgres, no model, no network in tests.
//
//   import { createMemory } from './vector-store.mjs'
//   const mem = createMemory({ db, embed });   // db: {query(sql,params)->{rows}}; embed: (texts)->vectors
//   await mem.upsert({ id, text, meta });       // embeds text, stores vector+meta
//   await mem.search('a question', { k: 5 });   // embeds query, returns nearest {id,text,meta,score}
//   mem.ddl();                                  // the CREATE TABLE / CREATE INDEX SQL (run once on the box)
//
// db seam: any object with `async query(sql, params) -> { rows: [...] }` (the `pg` Pool/Client shape).
// embed seam: `async (texts: string[]) -> number[][]` (e.g. granite-embedding-97m via a small server,
//   or transformers.js MiniLM in-process). cosineDistance is computed in SQL on the box (`<=>`); the
//   offline fake computes it in JS so tests need no extension.
//
// Pure-ish: all IO goes through the two seams. Soft-fail: bad input → safe empty result, never throws
// out of upsert/search (errors are caught and surfaced as { ok:false }). Zero-WIF: holds no keys,
// never signs, never broadcasts — it is a read/write store for embeddings only.

const DIM_DEFAULT = 384; // MiniLM-L6 / many small embedders; granite-97m is 768 — set via opts.dim

export function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0, y = Number(b[i]) || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Create a Memory backed by an injected db + embed seam.
 * @param {object} cfg
 * @param {{query(sql:string,params?:any[]):Promise<{rows:any[]}>}} cfg.db
 * @param {(texts:string[])=>Promise<number[][]>} cfg.embed
 * @param {string} [cfg.table='memory_vectors']
 * @param {number} [cfg.dim=384]
 */
export function createMemory(cfg = {}) {
  const db = cfg.db;
  const embed = cfg.embed;
  const table = sanitizeIdent(cfg.table || 'memory_vectors');
  const dim = Number.isInteger(cfg.dim) && cfg.dim > 0 ? cfg.dim : DIM_DEFAULT;

  function ddl() {
    // Run once on the box (needs `CREATE EXTENSION IF NOT EXISTS vector;` first).
    return [
      `CREATE TABLE IF NOT EXISTS ${table} (`,
      `  id text PRIMARY KEY,`,
      `  text text NOT NULL,`,
      `  meta jsonb NOT NULL DEFAULT '{}'::jsonb,`,
      `  embedding vector(${dim}) NOT NULL`,
      `);`,
      `CREATE INDEX IF NOT EXISTS ${table}_hnsw ON ${table} USING hnsw (embedding vector_cosine_ops);`,
    ].join('\n');
  }

  async function upsert(rec) {
    if (!db || !embed) return { ok: false, error: 'memory not configured (db+embed required)' };
    const items = Array.isArray(rec) ? rec : [rec];
    const clean = items.filter((r) => r && r.id != null && typeof r.text === 'string' && r.text.length);
    if (!clean.length) return { ok: true, upserted: 0 };
    try {
      const vectors = await embed(clean.map((r) => r.text));
      let n = 0;
      for (let i = 0; i < clean.length; i++) {
        const r = clean[i];
        const vec = vectors && vectors[i];
        if (!Array.isArray(vec) || !vec.length) continue;
        await db.query(
          `INSERT INTO ${table} (id, text, meta, embedding) VALUES ($1,$2,$3,$4)
             ON CONFLICT (id) DO UPDATE SET text=EXCLUDED.text, meta=EXCLUDED.meta, embedding=EXCLUDED.embedding`,
          [String(r.id), r.text, JSON.stringify(r.meta || {}), toVectorLiteral(vec)],
        );
        n++;
      }
      return { ok: true, upserted: n };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  async function search(query, opts = {}) {
    if (!db || !embed) return [];
    const k = Number.isInteger(opts.k) && opts.k > 0 ? opts.k : 5;
    const q = typeof query === 'string' ? query : '';
    if (!q.trim()) return [];
    try {
      const [qvec] = await embed([q]);
      if (!Array.isArray(qvec) || !qvec.length) return [];
      // `<=>` is pgvector cosine DISTANCE (0=identical); score = 1 - distance.
      const { rows } = await db.query(
        `SELECT id, text, meta, 1 - (embedding <=> $1) AS score
           FROM ${table} ORDER BY embedding <=> $1 LIMIT $2`,
        [toVectorLiteral(qvec), k],
      );
      return (rows || []).map((r) => ({
        id: r.id,
        text: r.text,
        meta: typeof r.meta === 'string' ? safeJson(r.meta) : r.meta || {},
        score: Number(r.score),
      }));
    } catch (e) {
      return [];
    }
  }

  async function remove(id) {
    if (!db || id == null) return { ok: false };
    try {
      await db.query(`DELETE FROM ${table} WHERE id=$1`, [String(id)]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  async function count() {
    if (!db) return 0;
    try {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
      return (rows && rows[0] && rows[0].n) || 0;
    } catch {
      return 0;
    }
  }

  return { ddl, upsert, search, remove, count, table, dim };
}

// pgvector accepts a text literal like '[0.1,0.2,...]' for a vector parameter.
export function toVectorLiteral(vec) {
  if (!Array.isArray(vec)) return '[]';
  return '[' + vec.map((x) => Number(x) || 0).join(',') + ']';
}

function sanitizeIdent(name) {
  const s = String(name || '').replace(/[^a-zA-Z0-9_]/g, '');
  return s || 'memory_vectors';
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * An in-memory fake DB that emulates just enough of the `pg` query surface this module uses
 * (INSERT…ON CONFLICT, SELECT…ORDER BY embedding <=> $1, DELETE, count). For tests + local dev
 * WITHOUT Postgres. Cosine distance computed in JS. Not for production.
 */
export function makeFakeDb() {
  const store = new Map(); // id -> { id, text, meta, vec }
  return {
    _store: store,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (/^INSERT INTO/i.test(s)) {
        const [id, text, meta, embLit] = params;
        store.set(String(id), { id: String(id), text, meta, vec: parseVectorLiteral(embLit) });
        return { rows: [] };
      }
      if (/^SELECT id, text, meta, 1 - \(embedding/i.test(s)) {
        const qvec = parseVectorLiteral(params[0]);
        const k = params[1] || 5;
        const scored = [...store.values()]
          .map((r) => ({ id: r.id, text: r.text, meta: r.meta, score: cosineSim(qvec, r.vec) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
        return { rows: scored };
      }
      if (/^DELETE FROM/i.test(s)) {
        store.delete(String(params[0]));
        return { rows: [] };
      }
      if (/count\(\*\)/i.test(s)) return { rows: [{ n: store.size }] };
      return { rows: [] };
    },
  };
}

export function parseVectorLiteral(lit) {
  if (Array.isArray(lit)) return lit.map((x) => Number(x) || 0);
  const m = String(lit || '').match(/\[(.*)\]/);
  if (!m || !m[1].trim()) return [];
  return m[1].split(',').map((x) => Number(x) || 0);
}

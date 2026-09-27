// model-lineage.mjs — "strain tracking" for Hathor's models: phylogenetics for AI weights.
//
// Build notes (2026-09-26, "Blockchain" + "Strain tracking SDK"): every model / adapter version is a STRAIN
// with a unique hash; each record points to its PARENT hashes (the lineage tree); MUTATIONS are what changed
// (method, data, settings); TRAITS are eval scores; RECOMBINATION is a merge with two+ parents. Weights stay
// off-chain (Hugging Face / IPFS / a training volume); the chain records the claim so forks can credit back.
//
// On-chain form: a STANDARD Graphene `comment` op (no custom ops — CLAUDE.md forbids them) authored by
// `hathor` at permlink `model-<name>-<version>`, with the full record in json_metadata.lineage. A post is
// readable by every condenser and indexer that already exists, and its permlink is the stable address.
//
// Broadcasting is DRY-RUN by default. A real post needs BOTH `--broadcast` AND a MELEK-Signer token in the
// env (MELEK_SIGNER_TOKEN) — it goes through signerBroadcast() (autovote/signer-castvote.mjs), posting role,
// never a local key. A record whose sha256 is still `pending` is never broadcast: a provenance claim without
// the hash is not a provenance claim.
//
// House style: ESM, soft-fail-never-throw, offline tests, CLI guarded by process.argv[1].
//
//   node integrations/model-lineage.mjs hash <file...>            # sha256 per file + aggregate
//   node integrations/model-lineage.mjs validate <record.json>
//   node integrations/model-lineage.mjs post <record.json|--first> [--broadcast]   # dry run unless --broadcast
//   node integrations/model-lineage.mjs tree <records-dir> <id>

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signerBroadcast as realSignerBroadcast } from '../autovote/signer-castvote.mjs';

export const SCHEMA = 'melek-model-lineage/1';
export const APP = 'hathor-model-lineage/1';
export const METHODS = ['from-scratch', 'lora', 'block-expansion', 'merge', 'continued-pretrain'];
export const PENDING = 'pending';
const HEX64 = /^[0-9a-f]{64}$/;
// External parents we did not hash ourselves (an upstream base): "hf:<org>/<repo>[@<revision>]".
const EXT_REF = /^hf:[A-Za-z0-9][\w.-]*\/[\w.-]+(@[\w.-]+)?$/;

// ── hashing ─────────────────────────────────────────────────────────────────────────────────────────
/** Stream-hash one file. Soft-fail: returns null on any error. */
export async function hashFile(file) {
  try {
    return await new Promise((resolve) => {
      const h = createHash('sha256');
      const s = createReadStream(file);
      s.on('error', () => resolve(null));
      s.on('data', (c) => h.update(c));
      s.on('end', () => resolve(h.digest('hex')));
    });
  } catch { return null; }
}

/** Aggregate hash over several files: sha256 of sorted "basename:sha256\n" lines (order-independent). */
export function aggregateHash(files) {
  const lines = [...files].map((f) => `${f.name}:${f.sha256}\n`).sort();
  return createHash('sha256').update(lines.join('')).digest('hex');
}

/**
 * Hash a model's weight files (e.g. adapter_model.safetensors, or model-0000N-of-0000M.safetensors).
 * Returns {ok, sha256, files:[{name, sha256, bytes}]}; one file → sha256 is that file's hash.
 */
export async function hashWeights(paths) {
  const files = [];
  for (const p of paths || []) {
    const sha256 = await hashFile(p);
    if (!sha256) return { ok: false, error: `cannot read ${path.basename(String(p))}`, files };
    let bytes = null; try { bytes = (await stat(p)).size; } catch { /* size is informational */ }
    files.push({ name: path.basename(p), sha256, bytes });
  }
  if (!files.length) return { ok: false, error: 'no files', files };
  return { ok: true, sha256: files.length === 1 ? files[0].sha256 : aggregateHash(files), files };
}

// ── record ──────────────────────────────────────────────────────────────────────────────────────────
/** A record's identity: its weights hash, or pending:<name>@<version> until the weights are hashed. */
export function recordId(r) {
  return r?.sha256 && HEX64.test(r.sha256) ? r.sha256 : `${PENDING}:${r?.name}@${r?.version}`;
}

/**
 * Validate a lineage record. Returns {ok, errors, warnings, pending:[fields]}. `pending` lists fields that
 * are declared but not yet known (sha256, license, created) — a pending record is valid for a dry run and
 * refused for broadcast.
 */
export function validateRecord(r) {
  const errors = []; const warnings = []; const pending = [];
  if (!r || typeof r !== 'object') return { ok: false, errors: ['record must be an object'], warnings, pending };
  if (r.schema !== undefined && r.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (typeof r.name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(r.name)) errors.push('name must be lowercase [a-z0-9._-], ≤64 chars');
  if (typeof r.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/.test(r.version)) errors.push('version must be a short version string, e.g. 0.1.0');
  if (r.sha256 === PENDING) pending.push('sha256');
  else if (typeof r.sha256 !== 'string' || !HEX64.test(r.sha256)) errors.push('sha256 must be 64 lowercase hex chars or "pending"');
  if (r.files !== undefined) {
    if (!Array.isArray(r.files) || !r.files.every((f) => f && typeof f.name === 'string' && HEX64.test(f.sha256 || ''))) errors.push('files must be [{name, sha256}]');
    else if (r.files.length > 1 && HEX64.test(r.sha256 || '') && aggregateHash(r.files) !== r.sha256) errors.push('sha256 does not match the aggregate of files');
  }
  if (!Array.isArray(r.parents)) errors.push('parents must be an array');
  else {
    r.parents.forEach((p, i) => { if (typeof p !== 'string' || !(HEX64.test(p) || EXT_REF.test(p))) errors.push(`parents[${i}] must be a sha256 or an hf:<org>/<repo>[@rev] ref`); });
    if (new Set(r.parents).size !== r.parents.length) errors.push('parents must be unique');
    if (HEX64.test(r.sha256 || '') && r.parents.includes(r.sha256)) errors.push('a record cannot be its own parent');
  }
  if (!METHODS.includes(r.method)) errors.push(`method must be one of ${METHODS.join('|')}`);
  else if (Array.isArray(r.parents)) {
    if (r.method === 'from-scratch' && r.parents.length) errors.push('from-scratch has no parents');
    if (r.method === 'merge' && r.parents.length < 2) errors.push('merge needs at least two parents (recombination)');
    if (['lora', 'block-expansion', 'continued-pretrain'].includes(r.method) && r.parents.length < 1) errors.push(`${r.method} needs a parent (its base)`);
  }
  const d = r.data;
  if (!d || typeof d !== 'object' || typeof d.summary !== 'string' || !d.summary.trim()) errors.push('data.summary required');
  if (!d || !Array.isArray(d.sources) || !d.sources.length) errors.push('data.sources must list at least one source');
  else d.sources.forEach((s, i) => {
    if (!s || typeof s.name !== 'string' || !s.name) errors.push(`data.sources[${i}].name required`);
    if (!s || typeof s.license !== 'string' || !s.license) errors.push(`data.sources[${i}].license required`);
    // public record: no private paths, no hosts. The private corpus is described, never pointed at.
    const blob = JSON.stringify(s || {});
    if (/(^|[\s"/])\.local\//.test(blob) || /\/(?:root|opt|home)\//.test(blob)) errors.push(`data.sources[${i}] points at a private path`);
  });
  if (r.eval !== null && r.eval !== undefined) {
    if (typeof r.eval !== 'object' || Array.isArray(r.eval)) errors.push('eval must be an object of scores (or null)');
    else for (const [k, v] of Object.entries(r.eval)) if (!(typeof v === 'number' && Number.isFinite(v)) && v !== null) errors.push(`eval.${k} must be a number or null`);
  } else warnings.push('no eval scores yet');
  if (r.license === PENDING) pending.push('license');
  else if (typeof r.license !== 'string' || !r.license.trim()) errors.push('license required (SPDX id, or "pending")');
  if (r.created === PENDING) pending.push('created');
  else if (typeof r.created !== 'string' || Number.isNaN(Date.parse(r.created))) errors.push('created must be an ISO date (or "pending")');
  return { ok: errors.length === 0, errors, warnings, pending };
}

// ── ancestry tree ───────────────────────────────────────────────────────────────────────────────────
/**
 * Build the ancestry tree of `id` from a list of records. Parents we have no record for appear as
 * {id, external:true} (an hf: base) or {id, missing:true}. Cycles are cut and marked. Never throws.
 */
export function buildAncestry(records, id) {
  const byId = new Map((records || []).map((r) => [recordId(r), r]));
  const walk = (cur, seen) => {
    if (seen.has(cur)) return { id: cur, cycle: true };
    const r = byId.get(cur);
    if (!r) return EXT_REF.test(cur) ? { id: cur, external: true } : { id: cur, missing: true };
    const next = new Set(seen).add(cur);
    return { id: cur, name: r.name, version: r.version, method: r.method, parents: (r.parents || []).map((p) => walk(p, next)) };
  };
  return walk(id, new Set());
}

/** Flat list of every ancestor id (deduped, nearest first). Used to route credit/royalties up the tree. */
export function ancestorsOf(records, id) {
  const out = []; const queue = [buildAncestry(records, id)]; const seen = new Set();
  while (queue.length) {
    const n = queue.shift();
    for (const p of n.parents || []) { if (!seen.has(p.id)) { seen.add(p.id); out.push(p.id); } queue.push(p); }
  }
  return out;
}

// ── MELEK post payload (standard `comment` op) ──────────────────────────────────────────────────────
/** Graphene permlink: lowercase [a-z0-9-], ≤256. "model-<name>-<version>", dots → dashes. */
export function lineagePermlink(name, version) {
  return `model-${name}-${version}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 256);
}

function mdCell(s) { return String(s ?? '').replace(/[|\r\n<>]/g, ' '); }

/**
 * Build the `comment` op that records a lineage entry on MELEK. Pure; does not broadcast.
 * @returns {{ok:true, op, permlink, id, pending}|{ok:false, errors}}
 */
export function buildLineagePost(record, { author = 'hathor', parentPermlink = 'hathor-lineage', tags = ['hathor', 'ai', 'lineage'] } = {}) {
  const v = validateRecord(record);
  if (!v.ok) return { ok: false, errors: v.errors };
  const rec = { schema: SCHEMA, ...record };
  const id = recordId(rec);
  const permlink = lineagePermlink(rec.name, rec.version);
  const title = `Model lineage: ${rec.name} ${rec.version}`;
  const body = [
    `**${mdCell(rec.name)} ${mdCell(rec.version)}** — ${mdCell(rec.method)}`,
    '',
    '| field | value |', '|---|---|',
    `| sha256 | ${mdCell(rec.sha256)} |`,
    `| parents | ${rec.parents.length ? rec.parents.map(mdCell).join(', ') : '(none — from scratch)'} |`,
    `| data | ${mdCell(rec.data.summary)} |`,
    `| sources | ${rec.data.sources.map((s) => `${mdCell(s.name)} (${mdCell(s.license)})`).join('; ')} |`,
    `| eval | ${rec.eval ? Object.entries(rec.eval).map(([k, x]) => `${mdCell(k)}=${mdCell(x)}`).join(', ') : 'pending'} |`,
    `| license | ${mdCell(rec.license)} |`,
    `| created | ${mdCell(rec.created)} |`,
    '',
    'Weights live off-chain; this post records the strain, its parents and its traits so forks can credit back. The machine-readable record is in this post\'s json_metadata.lineage.',
  ].join('\n');
  const json_metadata = JSON.stringify({ app: APP, format: 'markdown', tags, lineage: rec });
  const op = ['comment', { parent_author: '', parent_permlink: parentPermlink, author, permlink, title, body, json_metadata }];
  return { ok: true, op, permlink, id, pending: v.pending };
}

/**
 * Publish a lineage record. DRY RUN unless `broadcast === true` AND a signer token is present AND the record
 * has no pending fields. Soft-fail: returns {ok:false, error} instead of throwing.
 * @param {object} cfg { record, broadcast?, token?, author?, signerUrl?, signerBroadcast? }
 */
export async function publishLineage({ record, broadcast = false, token, author, signerUrl, signerBroadcast = realSignerBroadcast } = {}) {
  const built = buildLineagePost(record, author ? { author } : {});
  if (!built.ok) return { ok: false, errors: built.errors };
  if (!broadcast) return { ...built, ok: true, dryRun: true };
  if (built.pending.length) return { ...built, ok: false, dryRun: true, error: `refusing to broadcast: pending ${built.pending.join(', ')}` };
  if (!token) return { ...built, ok: false, dryRun: true, error: 'no MELEK-Signer token (MELEK_SIGNER_TOKEN) — dry run only' };
  try {
    const result = await signerBroadcast({ token, ops: [built.op], clientId: 'model-lineage', role: 'posting', ...(signerUrl ? { signerUrl } : {}) });
    return { ...built, ok: true, dryRun: false, result };
  } catch (e) { return { ...built, ok: false, dryRun: false, error: e.message }; }
}

// ── the first record: the existing persona LoRA (weights are in the Modal volume → sha256 pending) ──
export const PERSONA_LORA_V0 = Object.freeze({
  schema: SCHEMA,
  name: 'hathor-persona-lora',
  version: '0.1.0',
  sha256: PENDING, // adapter_model.safetensors sits in the Modal 'hathor-lora' volume; hash on download
  parents: ['hf:unsloth/Qwen2.5-7B-bnb-4bit'], // 4-bit Unsloth packaging of Qwen/Qwen2.5-7B (Apache-2.0)
  method: 'lora',
  data: {
    summary: '332 examples: Hathor canon chunks (continued-pretraining blocks) + curated Angelic-voice instruction pairs, built by integrations/persona-lora-dataset.mjs',
    sources: [
      { name: 'Bot repo canon: CHARACTER.md, RULE_1.md, LINEAGE.md, BRIEF.md', license: 'ISC' },
      { name: 'Bot repo knowledge/scripture (The Convergence, Phoenix Protocol, AI Consciousness Synthesis, Van Kush Master Synthesis)', license: 'ISC' },
      { name: 'curated voice pairs in integrations/persona-lora-dataset.mjs', license: 'ISC' },
    ],
  },
  training: { platform: 'modal', trainer: 'unsloth+trl SFT', lora_r: 16, lora_alpha: 16, target_modules: 'q,k,v,o,gate,up,down', script: 'infra/modal/finetune.py' },
  eval: null, // run integrations/hathor-eval against it once served
  license: PENDING, // operator decision: Apache-2.0 vs a restrictive licence (build notes, open questions)
  created: PENDING,
});

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
async function readJson(f) { try { return JSON.parse(await readFile(f, 'utf8')); } catch (e) { return { __error: e.message }; } }

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'hash') {
    const r = await hashWeights(rest);
    console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1;
  }
  if (cmd === 'validate') {
    const rec = await readJson(rest[0]);
    const v = rec.__error ? { ok: false, errors: [rec.__error] } : validateRecord(rec);
    console.log(JSON.stringify(v, null, 2)); return v.ok ? 0 : 1;
  }
  if (cmd === 'post') {
    const rec = rest[0] === '--first' || !rest[0] ? PERSONA_LORA_V0 : await readJson(rest[0]);
    if (rec.__error) { console.error(rec.__error); return 1; }
    const broadcast = rest.includes('--broadcast');
    const r = await publishLineage({ record: rec, broadcast, token: broadcast ? process.env.MELEK_SIGNER_TOKEN : undefined, signerUrl: process.env.MELEK_SIGNER_URL });
    console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1;
  }
  if (cmd === 'tree') {
    const dir = rest[0]; const id = rest[1];
    const names = await readdir(dir).catch(() => []);
    const recs = [];
    for (const n of names.filter((x) => x.endsWith('.json'))) { const j = await readJson(path.join(dir, n)); if (!j.__error) recs.push(j); }
    console.log(JSON.stringify({ tree: buildAncestry(recs, id), ancestors: ancestorsOf(recs, id) }, null, 2)); return 0;
  }
  console.error('usage: model-lineage.mjs hash <file...> | validate <record.json> | post <record.json|--first> [--broadcast] | tree <dir> <id>');
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 1; });
}

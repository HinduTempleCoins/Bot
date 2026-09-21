// sync-recovered.mjs — feed the RECOVERED corpus into the compartment Hathor reads, the same way the
// live brain-ingest (ship-transcripts.sh + wash-transcript.mjs) already does.
//
// WHY THIS EXISTS.
// Two piles of recovered material sit only in this ephemeral Codespace and will vanish on the next
// wipe (`.local/` is gitignored; the raw sessions are untracked):
//   1. RAW SESSIONS — archive/recovered-sessions/*.api.json : full Claude session exports (the
//      lost "Effective Eureka" window Sept 13–17, the Paxton legal review, etc.). Each event's
//      `payload` carries the same {type, message:{role,content}} shape a .jsonl transcript line does,
//      so the SAME washer that ship-transcripts.sh uses can clean them.
//   2. DIGESTS — .local/incoming/recovered/DIGEST_*.md : already-synthesised, high-signal markdown
//      write-ups of that window. These ARE annals — the shape annal-harvester.mjs mines and the
//      Soapy wake (soapy-conference.gatherSince) reads.
//
// WHERE IT LANDS (no parallel store — the existing brain compartments):
//   • washed sessions  → <out>/transcripts/*.jsonl  → ship to the brain's transcripts dir,
//     which the reconcile pass mines into the append-only, never-wiped operator-asks.md;
//   • washed digests   → <out>/annals/_synthesis.recovered-*.md → ship to the brain's annals dir,
//     which annal-harvester mines (its SIGNAL matches /^_synthesis/) and which the Soapy wake reads
//     directly (gatherSince scans annals/*.md).
//   (The concrete box paths live in the operator's .local/ env, never in this public file.)
//
// The ship + the schedule live in brain/ship-recovered.sh and deploy/soapy-sync/*. This module is the
// pure, offline-testable transform: it never dials the network and never touches keys. It reuses
// wash() and isSynthetic() from wash-transcript.mjs so redaction stays identical to the live path.
//
// House style: ESM, injectable fs, soft-fail-never-throw, CLI guarded by process.argv[1], handler().

import fsDefault from 'node:fs';
import path from 'node:path';
import { wash, isSynthetic } from './wash-transcript.mjs';

const ASSISTANT_DIGEST = 1200;   // same retention as wash-transcript.mjs

// Pull plain text out of a message content field (string, or a block array). Tool blocks are dropped —
// the bulk and the risk. Mirrors wash-transcript.mjs:plainText.
function plainText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n').trim();
}

// A "user" turn is the operator only when it is real text and not a tool_result hand-back. Mirrors
// wash-transcript.mjs:isRealOperatorTurn but reads the api.json payload's message.
function isRealOperatorTurn(msg) {
  const c = msg && msg.content;
  if (typeof c === 'string') return c.trim().length > 0;
  if (!Array.isArray(c)) return false;
  return c.some((b) => b && b.type === 'text') && !c.some((b) => b && b.type === 'tool_result');
}

/**
 * Convert ONE api.json event to a washed transcript entry, or null to drop it.
 * Accepts the event as exported (`{event_type, payload:{type,message,...}}`) OR a bare payload/entry
 * (so it also works on already-.jsonl-shaped lines). Pure; never throws.
 * @returns {{type,timestamp,uuid,message}|null}
 */
export function apiEventToEntry(event, { digest = ASSISTANT_DIGEST } = {}) {
  if (!event || typeof event !== 'object') return null;
  const p = event.payload && typeof event.payload === 'object' ? event.payload : event;
  const type = p.type || event.event_type;
  const msg = p.message;
  if (!msg) return null;
  // Skip subagent side-chains: they are not the operator's precedent (mirrors !e.isSidechain).
  if (p.isSidechain || p.parent_tool_use_id) {
    if (type !== 'assistant') return null;   // keep top-level assistant turns; drop side-chain users
  }
  const ts = p.timestamp || event.created_at || null;
  const uuid = p.uuid || event.event_id || null;

  if (type === 'user' && isRealOperatorTurn(msg)) {
    const text = wash(plainText(msg.content));
    if (!text || isSynthetic(text)) return null;
    return { type: 'user', timestamp: ts, uuid, message: { role: 'user', content: text } };
  }
  if (type === 'assistant') {
    const text = wash(plainText(msg.content));
    if (!text) return null;
    return { type: 'assistant', timestamp: ts, uuid, message: { role: 'assistant', content: text.slice(0, digest) } };
  }
  return null;
}

/**
 * Wash a whole api.json session (its JSON text) into washed .jsonl lines. Pure; never throws.
 * @returns {{ jsonl:string, stats:{events,operator,assistant,dropped} }}
 */
export function washApiSessionText(jsonText, { digest = ASSISTANT_DIGEST } = {}) {
  const stats = { events: 0, operator: 0, assistant: 0, dropped: 0 };
  let events;
  try {
    const parsed = JSON.parse(jsonText);
    events = Array.isArray(parsed) ? parsed : (parsed.events || parsed.messages || []);
  } catch { return { jsonl: '', stats }; }
  const out = [];
  for (const ev of events) {
    stats.events++;
    const entry = apiEventToEntry(ev, { digest });
    if (!entry) { stats.dropped++; continue; }
    if (entry.type === 'user') stats.operator++; else stats.assistant++;
    out.push(JSON.stringify(entry));
  }
  return { jsonl: out.length ? out.join('\n') + '\n' : '', stats };
}

// A recovered digest is already washed synthesis; re-wash for safety (idempotent redaction) and give it
// an annal name whose prefix matches annal-harvester's SIGNAL (/^_synthesis/) and the Soapy wake's *.md
// scan. The provenance header makes clear it is recovered corpus, not a fresh conference product.
export function stageDigest(name, text, { now = Date.now() } = {}) {
  const slug = String(name).replace(/\.md$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const outName = /^_synthesis/i.test(slug) ? `${slug}.md` : `_synthesis.recovered-${slug}.md`;
  const header = [
    `<!-- recovered corpus, synced into the annals by brain/sync-recovered.mjs on ${new Date(now).toISOString()} -->`,
    `<!-- source: .local/incoming/recovered/${name} — do not treat as a fresh 12-and-12 product -->`,
    '',
  ].join('\n');
  return { name: outName, body: header + wash(String(text || '')) };
}

/**
 * Do the sync: wash the recovered sessions into <out>/transcripts and the digests into <out>/annals.
 * Injectable fs for tests. Soft-fails per file; returns a manifest. Never throws.
 *
 * @param {object} opts
 *   { sessionsDir, digestsDir, outDir, fsmod?, now?, digest?, maxSessionBytes? }
 * @returns {{ transcripts:string[], annals:string[], skipped:string[], stats:object }}
 */
export function syncRecovered(opts = {}) {
  const fsmod = opts.fsmod || fsDefault;
  const now = opts.now ?? Date.now();
  const outDir = opts.outDir || '.local/brain-out/recovered';
  const tOut = path.join(outDir, 'transcripts');
  const aOut = path.join(outDir, 'annals');
  const maxBytes = opts.maxSessionBytes ?? 250 * 1024 * 1024;   // guard against an accidental giant

  const manifest = { transcripts: [], annals: [], skipped: [], stats: { sessions: 0, digests: 0, events: 0 } };
  const mkdir = (d) => { try { fsmod.mkdirSync(d, { recursive: true }); } catch { /* soft */ } };
  mkdir(tOut); mkdir(aOut);

  // 1) raw sessions → washed jsonl
  if (opts.sessionsDir) {
    let names = [];
    try { names = fsmod.readdirSync(opts.sessionsDir) || []; } catch { names = []; }
    for (const nm of names) {
      if (!String(nm).endsWith('.api.json')) continue;
      const full = path.join(opts.sessionsDir, String(nm));
      try {
        const size = statBytes(full, fsmod);
        if (size > maxBytes) { manifest.skipped.push(`${nm} (too large: ${size}B)`); continue; }
        const text = fsmod.readFileSync(full, 'utf8');
        const { jsonl, stats } = washApiSessionText(text, { digest: opts.digest });
        if (!jsonl) { manifest.skipped.push(`${nm} (no operator/assistant turns)`); continue; }
        const outName = String(nm).replace(/\.api\.json$/i, '.jsonl');
        fsmod.writeFileSync(path.join(tOut, outName), jsonl);
        manifest.transcripts.push(outName);
        manifest.stats.sessions++;
        manifest.stats.events += stats.events;
      } catch (e) { manifest.skipped.push(`${nm} (${e && e.message || 'error'})`); }
    }
  }

  // 2) digests → washed annals. Only the synthesised DIGEST_*.md write-ups (and anything already
  // named _synthesis) — NOT the raw recovered lists (gmail-lists.md, holders.csv, …), which are bulk
  // contact PII, not corpus Hathor should read.
  const digestFilter = opts.digestFilter || /^(DIGEST_|_synthesis)/i;
  if (opts.digestsDir) {
    let names = [];
    try { names = fsmod.readdirSync(opts.digestsDir) || []; } catch { names = []; }
    for (const nm of names) {
      if (!String(nm).endsWith('.md') || !digestFilter.test(String(nm))) continue;
      const full = path.join(opts.digestsDir, String(nm));
      try {
        const text = fsmod.readFileSync(full, 'utf8');
        if (!String(text).trim()) { manifest.skipped.push(`${nm} (empty)`); continue; }
        const staged = stageDigest(String(nm), text, { now });
        fsmod.writeFileSync(path.join(aOut, staged.name), staged.body);
        manifest.annals.push(staged.name);
        manifest.stats.digests++;
      } catch (e) { manifest.skipped.push(`${nm} (${e && e.message || 'error'})`); }
    }
  }

  manifest.asOf = new Date(now).toISOString();
  return manifest;
}

function statBytes(p, fsmod) { try { return fsmod.statSync(p).size || 0; } catch { return 0; } }

// handler(req,res) — JSON summary of a run, given an injected manifest (tests) or an empty shell.
export function handler(req, res, manifest = { transcripts: [], annals: [], skipped: [], stats: {} }) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(manifest, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI: paths from env so nothing box-specific is hard-coded. Defaults match this repo's layout.
  const sessionsDir = process.env.RECOVERED_SESSIONS_DIR || 'archive/recovered-sessions';
  const digestsDir = process.env.RECOVERED_DIGESTS_DIR || '.local/incoming/recovered';
  const outDir = process.env.RECOVERED_OUT_DIR || '.local/brain-out/recovered';
  const m = syncRecovered({ sessionsDir, digestsDir, outDir });
  console.log(`[sync-recovered] ${m.stats.sessions} session(s) → ${outDir}/transcripts, `
    + `${m.stats.digests} digest(s) → ${outDir}/annals; ${m.skipped.length} skipped`);
  if (m.skipped.length) console.error('[sync-recovered] skipped:\n  ' + m.skipped.join('\n  '));
}

// chat-ingest.mjs — stage the operator's Claude-Chat research papers + artifacts into Hathor's PUBLIC
// repo brain (datasets/), with PRIVATE info filtered out (operator 2026-06-17: "look for Docs and Artifacts
// we made that aren't like Private info … Research Papers from Claude Chat, and Papers we Wrote before").
//
// Ready for the zip: once the operator unlocks the vault + the big zip is on disk, point ingestDir at the
// unpacked folder and it sanitizes + classifies + writes only the clean, public-safe papers + a manifest.
//
// THE LEAK LINE (memory feedback-private-public-boundary-never-leak): the ONLY hard rule is the public
// repo — so this REDACTS keys/WIFs/private 0x-keys, server IPs/hostnames, emails, vault/secret markers, and
// SKIPS anything that's mostly chat-log/secret rather than a paper. Pure helpers + injectable fs; soft-fail.

import fs from 'node:fs';
import path from 'node:path';

// ── redaction (strip private info from an otherwise-public doc) ───────────────────────────────────────────
const PATTERNS = [
  [/\b5[HJK][1-9A-HJ-NP-Za-km-z]{48,51}\b/g, '[WIF-REDACTED]'],          // Graphene/BTC WIF private keys
  [/\b0x[0-9a-fA-F]{64}\b/g, '[PRIVKEY-REDACTED]'],                       // 32-byte hex (private keys/seeds)
  [/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[PAT-REDACTED]'],                    // GitHub PATs
  [/\bghp_[A-Za-z0-9]{36,}\b/g, '[PAT-REDACTED]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP-REDACTED]'],                      // IPv4 (server IPs)
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL-REDACTED]'],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[SECRET-REDACTED]'],                 // long base64 (session secrets/keys)
];
// Private hostnames to redact. The SPECIFIC operator host names never live in this public file — they
// come from env REDACT_HOSTS (comma-separated, set on the box from .local). A generic pattern catches the
// common shapes (vmi<digits>, "server N", *.internal) without naming anything private here.
const GENERIC_HOST = /\b(vmi\d{3,}|server[ -]?[1-9]|[a-z0-9-]+\.internal)\b/gi;
function envHostRe() {
  const names = String(process.env.REDACT_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) return null;
  return new RegExp('\\b(' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi');
}

/** Redact private info from text. Returns { clean, redactions } (counts by kind). Never throws. */
export function sanitizeText(text) {
  let s = String(text == null ? '' : text);
  const redactions = {};
  for (const [re, tag] of PATTERNS) {
    s = s.replace(re, () => { redactions[tag] = (redactions[tag] || 0) + 1; return tag; });
  }
  const hostRe = envHostRe();
  const doHost = (re) => { s = s.replace(re, () => { redactions['[HOST-REDACTED]'] = (redactions['[HOST-REDACTED]'] || 0) + 1; return '[HOST-REDACTED]'; }); };
  doHost(GENERIC_HOST);
  if (hostRe) doHost(hostRe);
  return { clean: s, redactions };
}

// ── classification (keep public papers; skip private/secret-heavy or trivial docs) ───────────────────────
const KEEP_EXT = /\.(md|txt|markdown|tex|rst)$/i;
const PRIVATE_NAME = /\b(private|secret|vault|key|wif|password|\.env|credential|seed|backup)\b/i;

/**
 * classifyDoc — keep a doc for the public brain only if it reads like a PAPER/artifact, not a secret dump.
 * Returns { keep, reason }. Heuristics: text extension, enough length, low secret-density after sanitize.
 */
export function classifyDoc({ name = '', text = '' } = {}) {
  if (!KEEP_EXT.test(name)) return { keep: false, reason: 'not-a-text-doc' };
  if (PRIVATE_NAME.test(name)) return { keep: false, reason: 'private-by-name' };
  const body = String(text || '');
  if (body.trim().length < 400) return { keep: false, reason: 'too-short' };
  const { clean, redactions } = sanitizeText(body);
  const redactCount = Object.values(redactions).reduce((a, b) => a + b, 0);
  // secret-density: a paper has a handful of redactions; a DUMP has many relative to its size. Threshold
  // scales with length (~1 secret per 300 chars) with an absolute floor so short papers aren't penalized.
  if (redactCount > Math.max(3, clean.length / 300)) return { keep: false, reason: 'secret-heavy' };
  return { keep: true, reason: 'paper', redactCount };
}

// ── ingest a directory of unpacked docs → datasets/research-papers/ ───────────────────────────────────────
function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * ingestDir — sanitize + classify every doc under srcDir; write the clean KEPT papers to destDir + a
 * manifest.json. Returns { kept:[...], skipped:[...], destDir }. Read-side soft-fails per file; never throws.
 * Pass { dryRun:true } to classify without writing.
 */
export function ingestDir(srcDir, destDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'datasets', 'research-papers'), { dryRun = false } = {}) {
  const kept = [], skipped = [];
  for (const file of walk(srcDir)) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { skipped.push({ file, reason: 'unreadable' }); continue; }
    const name = path.basename(file);
    const c = classifyDoc({ name, text });
    if (!c.keep) { skipped.push({ file: name, reason: c.reason }); continue; }
    const { clean, redactions } = sanitizeText(text);
    kept.push({ name, redactions, bytes: clean.length });
    if (!dryRun) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, name), clean);
      } catch { /* soft-fail the write */ }
    }
  }
  if (!dryRun) {
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify({ kept, skipped, srcCount: kept.length + skipped.length }, null, 2));
    } catch { /* soft */ }
  }
  return { kept, skipped, destDir };
}

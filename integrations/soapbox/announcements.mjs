// announcements.mjs — Hathor's "Announcements voice". An append-only, signed feed of official posts.
// This is the PROXY mechanism the operator described: Hathor publishes here, and an external
// automation (IFTTT / Zapier / Buffer / dlvr.it) — connected once to the operator's social accounts —
// picks up the RSS and broadcasts each item to Twitter / Reddit / etc. No bot touches those platforms
// directly (ToS-clean); the feed is the single source of Hathor's public voice.
//
// Each item is SIGNED so a reader (or a downstream post) can tell it genuinely came from Hathor:
// a stable signature line + a deterministic content hash. (When MELEK-Signer exists, the hash can be
// cryptographically signed with Hathor's posting key; until then it's a provenance marker.)
//
//   import { listAnnouncements, addAnnouncement } from './announcements.mjs'
//   node integrations/soapbox/announcements.mjs add "Title" "Body text"

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORE = process.env.SOAPBOX_ANNOUNCEMENTS || path.join(__dir, 'data', 'announcements.json');
export const SIGNATURE = process.env.HATHOR_SIGNATURE || '— Hathor 𓂀, MELEK AI Witness';

function load() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return []; } }
function save(a) { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(a, null, 2)); }

// a short provenance hash over the immutable content — Hathor's "signature" on the item.
function sign(item) {
  return crypto.createHash('sha256').update(`${item.id}|${item.title}|${item.body}|${item.ts}`).digest('hex').slice(0, 16);
}

/** All announcements, newest first. */
export function listAnnouncements({ limit = 50 } = {}) {
  return load().sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, limit);
}

/**
 * Append a signed announcement. `ts` is injected (deterministic for tests). Returns the stored item.
 * Append-only: never mutates or deletes prior items (Hathor's record is durable).
 */
export function addAnnouncement({ title, body, link = '', tags = [], ts } = {}) {
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  if (!t || !b) throw new Error('announcement needs a title and body');
  const all = load();
  const item = { id: `a${all.length + 1}-${(ts || new Date().toISOString()).slice(0, 10)}`, title: t, body: b, link, tags, ts: ts || new Date().toISOString(), signed_by: SIGNATURE };
  item.sig = sign(item);
  all.push(item);
  save(all);
  return item;
}

/** The text a downstream post (tweet/reddit) would carry — body + signature, trimmed for length. */
export function asPost(item, { max = 280 } = {}) {
  const sig = `\n${SIGNATURE}`;
  const room = max - sig.length - (item.link ? item.link.length + 1 : 0);
  let body = item.body.length > room ? item.body.slice(0, room - 1).trimEnd() + '…' : item.body;
  return `${body}${item.link ? `\n${item.link}` : ''}${sig}`;
}

if (process.argv[1] && process.argv[1].endsWith('announcements.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'add') { const it = addAnnouncement({ title: rest[0], body: rest.slice(1).join(' ') }); console.log('posted:', it.id, 'sig', it.sig); }
  else listAnnouncements().forEach((a) => console.log(`${a.ts.slice(0, 16)}  ${a.title}  [${a.sig}]`));
}

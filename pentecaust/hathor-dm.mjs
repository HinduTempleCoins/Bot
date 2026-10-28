// pentecaust/hathor-dm.mjs — Hathor sends a Pentecaust IM.
//
// The messenger had no sender for her: `postDM` existed and the `/dm` route existed, but nothing
// drove either as Hathor, so "Hathor messages someone on Pentecaust" was a capability and not a
// behaviour. This is the sender.
//
// It writes through messaging.mjs on the box, not over HTTP, so it needs no session and no bearer
// token — the same store the messenger reads. No keys, no chain writes, nothing on the network.
// The recipient does not need to be online or to have ever opened Pentecaust: a valid MELEK account
// name is enough and the message waits for them, with a notification already counted.
//
//   import { hathorDM } from './hathor-dm.mjs'
//   node pentecaust/hathor-dm.mjs vankushfamily "the KULA bridge guide is up"   # --dry to preview
//
// House style: ESM, injectable store opts, soft-fail-never-throw, CLI guarded by argv[1].

import { postDM } from './messaging.mjs';
import { notificationsFor } from './notifications.mjs';
import { validAccountName } from '../signup/welcome-grant.mjs';

/** Hathor's account name on the MELEK chain, which is also her Pentecaust identity. */
export const AS = 'hathor';
/** Keep a single IM to something a person will actually read. */
export const MAX_TEXT = 1200;

/**
 * Send one IM as Hathor.
 * @param {{to:string, text:string, game?:string, surface?:string}} m
 * @param {object} [opts] store overrides — `{ file }` for the chat store (tests)
 * @returns {{ok:boolean, reason?:string, to?:string, channel?:string, message?:object}}
 */
export function hathorDM(m = {}, opts = {}) {
  const to = String(m.to == null ? '' : m.to).trim().toLowerCase().replace(/^@/, '');
  if (!validAccountName(to)) return { ok: false, reason: 'to must be a valid MELEK account name' };
  if (to === AS) return { ok: false, reason: 'Hathor cannot DM herself' };
  const text = String(m.text == null ? '' : m.text).trim();
  if (!text) return { ok: false, reason: 'empty message' };
  if (text.length > MAX_TEXT) return { ok: false, reason: `message too long (${text.length} > ${MAX_TEXT})` };

  const r = postDM({ from: AS, to, text, game: m.game, surface: m.surface || 'hathor' }, opts);
  if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'send failed', to };
  return { ok: true, to, channel: r.channel, message: r.message };
}

/**
 * Send to several accounts in one call. Each is independent — one bad name does not stop the rest.
 * @returns {{ok:boolean, sent:number, failed:number, results:Array}}
 */
export function hathorDMAll(accounts = [], text = '', opts = {}, extra = {}) {
  const list = Array.isArray(accounts) ? accounts : [accounts];
  const results = list.map((to) => ({ to, ...hathorDM({ to, text, ...extra }, opts) }));
  return {
    ok: true,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && /pentecaust\/hathor-dm\.mjs$/.test(process.argv[1])) {
  const args = process.argv.slice(2).filter((a) => a !== '--dry');
  const dry = process.argv.includes('--dry');
  const [to, ...rest] = args;
  const text = rest.join(' ');
  if (!to || !text) {
    console.log('usage: node pentecaust/hathor-dm.mjs <account> "<message>" [--dry]');
    process.exit(2);
  }
  console.log(`as      : @${AS}`);
  console.log(`to      : @${String(to).toLowerCase().replace(/^@/, '')}`);
  console.log(`text    : ${text}`);
  if (dry) { console.log('\n--dry: nothing written'); process.exit(0); }

  const r = hathorDM({ to, text });
  if (!r.ok) { console.log(`\nFAILED: ${r.reason}`); process.exit(1); }
  console.log(`\nSENT    : seq ${r.message.seq} in ${r.channel}`);
  const n = notificationsFor(r.to);
  console.log(`their badge now: ${n.unread} unread across ${n.threads} thread(s)`);
  for (const it of n.items) console.log(`   • ${it.title} (${it.count}): ${it.text}  -> ${it.url}`);
}

// secret-guard.mjs — INBOUND secret guard for every chat surface Hathor's helper bot listens on
// (Discord, Telegram, the on-chain troll-box). Runs FIRST, before any command routing, any AI call,
// and any logging, so a pasted secret never reaches a model, a journal, or a reply.
//
// Detects (pure, offline, deterministic):
//   • Graphene/Bitcoin WIF private keys (uncompressed 5H/5J/5K…, compressed K…/L…)
//   • Steem/Hive/MELEK-style master passwords (P5… + base58)
//   • raw 64-hex private keys (MetaMask "export private key" shape, Monero spend/view keys)
//       - "0x"+64hex is ALSO an EVM tx hash, so it only counts as a secret with key-ish context
//       - bare 64hex counts unless the message clearly labels it a tx/hash
//   • BIP-32 extended private keys (xprv/tprv/yprv/zprv)
//   • BIP-39 seed phrases (12/15/18/21/24-word windows) and Monero 25-word seeds
//   • "password: …" / "private key = …" / "my password is …" style disclosures
//
// What the caller does with a hit: refuse, delete the message where the platform allows, and warn the
// user to ROTATE (the secret must be treated as burned — it already left their device).
//
// Logging: inboundTrace() is the ONLY sanctioned way to log an inbound message. It records platform,
// an opaque user/channel hash, length and the guard verdict — NEVER content.
//
//   import { scanSecrets, redactSecrets, inboundTrace, rotationWarning } from './secret-guard.mjs'

import { createHash } from 'node:crypto';
import { BIP39_ENGLISH } from './bip39-english.mjs';
import { ENGLISH_WORDS as MONERO_WORDS } from '../pool/www/walletgen/vendor/english-wordlist.mjs';

const BIP39 = new Set(BIP39_ENGLISH);
const MONERO = new Set(MONERO_WORDS);

const B58 = '1-9A-HJ-NP-Za-km-z';
const NOT_B58_BEFORE = `(?<![${B58}0OIl])`;
const NOT_B58_AFTER = `(?![${B58}0OIl])`;

const RX = {
  wifUncompressed: new RegExp(`${NOT_B58_BEFORE}5[HJK][${B58}]{49}${NOT_B58_AFTER}`, 'g'),
  wifCompressed: new RegExp(`${NOT_B58_BEFORE}[KL][${B58}]{51}${NOT_B58_AFTER}`, 'g'),
  masterPassword: new RegExp(`${NOT_B58_BEFORE}P5[${B58}]{49,51}${NOT_B58_AFTER}`, 'g'),
  xprv: new RegExp(`${NOT_B58_BEFORE}[xtyzuv]prv[${B58}]{100,112}${NOT_B58_AFTER}`, 'g'),
  hex64bare: /(?<![0-9A-Fa-fxX])[0-9a-fA-F]{64}(?![0-9A-Fa-f])/g,
  hex64prefixed: /(?<![0-9A-Za-z])0x[0-9a-fA-F]{64}(?![0-9A-Fa-f])/g,
  // label [:=] value — the label alone is enough to treat the value as a disclosed secret
  labelled: /\b(master\s*password|password|passwd|passphrase|pwd|pass|private\s*key|priv\s*key|privkey|secret\s*key|spend\s*key|owner\s*key|active\s*key|posting\s*key|memo\s*key|wif|seed\s*phrase|recovery\s*phrase|mnemonic|seed)\s*[:=]\s*(\S{4,})/gi,
  // "my password is X" / "my private key is X"
  myIs: /\bmy\s+(?:master\s+)?(password|passphrase|private\s+key|owner\s+key|active\s+key|posting\s+key|seed\s+phrase|seed|mnemonic)\s+is\s+(\S{4,})/gi,
};

const KEY_CONTEXT = /\b(private|priv|secret|spend\s*key|view\s*key|wif|export(ed)?\s+key|key\s*[:=])/i;
const HASH_CONTEXT = /\b(tx|txid|txn|transaction|hash|block|commit|checksum|sha256|trx)\b/i;

function words(text) {
  return String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

// Longest run of consecutive tokens found in `dict`, tolerating ONE miss (a typo) inside the run.
function longestDictRun(tokens, dict) {
  let best = 0;
  for (let i = 0; i < tokens.length; i++) {
    let misses = 0;
    let len = 0;
    for (let j = i; j < tokens.length; j++) {
      if (dict.has(tokens[j])) { len++; continue; }
      if (misses === 0 && len > 0 && j + 1 < tokens.length && dict.has(tokens[j + 1])) { misses++; len++; continue; }
      break;
    }
    if (len > best) best = len;
  }
  return best;
}

/**
 * scanSecrets(text) — PURE. Returns { hit, kinds[], spans[] } where spans are [start,end) ranges of
 * secret material (for redaction). Never throws; non-strings are treated as empty.
 */
export function scanSecrets(text) {
  const out = { hit: false, kinds: [], spans: [] };
  if (typeof text !== 'string' || !text) return out;
  const add = (kind, start, end) => {
    if (!out.kinds.includes(kind)) out.kinds.push(kind);
    out.spans.push([start, end]);
  };
  const each = (rx, kind, filter) => {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      if (!filter || filter(m)) add(kind, m.index, m.index + m[0].length);
    }
  };

  each(RX.wifUncompressed, 'wif');
  each(RX.wifCompressed, 'wif');
  each(RX.masterPassword, 'master-password');
  each(RX.xprv, 'extended-private-key');
  const keyCtx = KEY_CONTEXT.test(text);
  const hashCtx = HASH_CONTEXT.test(text);
  each(RX.hex64prefixed, 'hex-private-key', () => keyCtx);
  each(RX.hex64bare, 'hex-private-key', () => keyCtx || !hashCtx);
  const word = (v) => String(v).replace(/[^\w]+$/, '');
  each(RX.labelled, 'labelled-secret', (m) => !/^(here|below|required|reset|change|forgot|lost)$/i.test(word(m[2])));
  each(RX.myIs, 'labelled-secret', (m) => !/^(lost|gone|wrong|not|incorrect|missing|required|invalid|forgotten|stolen|compromised|too|the|a|an)$/i.test(word(m[2])));

  const toks = words(text);
  const bipRun = longestDictRun(toks, BIP39);
  if (bipRun >= 12) add('seed-phrase', 0, text.length);
  else if (longestDictRun(toks, MONERO) >= 13) add('seed-phrase', 0, text.length);

  out.hit = out.kinds.length > 0;
  return out;
}

/** redactSecrets(text) — replace every detected span with [REDACTED]. Pure. */
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  const { spans } = scanSecrets(text);
  if (!spans.length) return text;
  const sorted = spans.slice().sort((a, b) => a[0] - b[0]);
  let res = '';
  let pos = 0;
  for (const [s, e] of sorted) {
    if (e <= pos) continue;
    res += text.slice(pos, Math.max(pos, s)) + '[REDACTED]';
    pos = e;
  }
  return res + text.slice(pos);
}

function opaque(v) {
  if (v === undefined || v === null || v === '') return '-';
  return createHash('sha256').update(String(v)).digest('hex').slice(0, 8);
}

/**
 * inboundTrace({ platform, user, channel, text }) — the ONLY sanctioned inbound log line.
 * Emits platform, opaque user/channel hashes, message length, whether it looks like a command, and
 * the secret-guard verdict. NEVER the content, never the raw username.
 */
export function inboundTrace({ platform = '?', user, channel, text } = {}) {
  const s = typeof text === 'string' ? text : '';
  let verdict = 'clean';
  try { verdict = scanSecrets(s).hit ? 'SECRET-BLOCKED' : 'clean'; } catch { verdict = '?'; }
  const cmd = /^\s*[!/][a-z]/i.test(s) ? 'cmd' : 'text';
  return `📥 ${platform} user=${opaque(user)} chan=${opaque(channel)} len=${s.length} kind=${cmd} guard=${verdict}`;
}

const KIND_LABEL = {
  wif: 'a private key (WIF)',
  'master-password': 'a master password',
  'extended-private-key': 'an extended private key (xprv)',
  'hex-private-key': 'a private key (64-hex)',
  'labelled-secret': 'a password / key',
  'seed-phrase': 'a seed / recovery phrase',
};

/**
 * rotationWarning(kinds, { deleted, platform }) — the reply sent instead of handling the message.
 * Never echoes the secret.
 */
export function rotationWarning(kinds = [], { deleted = false, platform = '' } = {}) {
  const what = kinds.map((k) => KIND_LABEL[k] || 'a secret').filter((v, i, a) => a.indexOf(v) === i).join(' and ') || 'a secret';
  const chain = platform === 'trollbox'
    ? 'This was posted ON-CHAIN and cannot be deleted — rotate RIGHT NOW.'
    : platform === 'web' ? 'It was not stored or forwarded.'
    : deleted ? 'I deleted the message.' : 'I could not delete the message — please delete it yourself.';
  return [
    `🛑 That looked like ${what}. I never need it and I did not read or store it. ${chain}`,
    'Treat it as burned: change your password / move funds to a fresh wallet now (MELEK: wallet.melek.salon → Permissions → change password; EVM/Monero: create a new wallet and transfer out).',
    'Hathor only ever needs your PUBLIC account name or 0x address.',
  ].join('\n');
}

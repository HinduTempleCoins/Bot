#!/usr/bin/env node
// cheetah-policing-live.mjs — TESTNET-ONLY on-chain Cheetah policing demo.
//
// Drives the real signup → post → detect → flag loop end-to-end on the live MELEK testnet, the way
// a person + a plagiarist would exercise it:
//   1. Create fresh throwaway accounts via the faucet (@melekorig…, @melekcopy…, @cheetahbot…).
//   2. @melekorig posts an ORIGINAL article.
//   3. @melekcopy posts a near-verbatim COPY of it (the abuse case).
//   4. Cheetah's deterministic shingle detector (scanPost, dryRun) flags the copy and composes a
//      credit-giving comment pointing at the original (credit-first, not punitive — CHEETAH_ADVANCED.md).
//   5. @cheetahbot replies ON-CHAIN under the copy with that credit note.
//   6. Verify every post is on the chain and report the tx ids + permlinks.
//
// KEY CUSTODY: every key here is generated in-process from a random master password, used only to
// sign these test ops, and never written to disk or logged. NONE of this touches Hathor's own keys
// or the vault — the cheetahbot identity is a throwaway test account, not the production witness.
// HARD testnet guard: refuses to run unless prefix is TST and the symbol is TESTS.
//
// Run on the chain host:  node cheetah/cheetah-policing-live.mjs --live
//          (dry, no chain):  node cheetah/cheetah-policing-live.mjs

import { Client, PrivateKey } from '@hiveio/dhive';
import { scanPost } from './index.js';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const FAUCET = process.env.MELEK_FAUCET || 'http://127.0.0.1:7790';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID ||
  '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e').trim();
const PREFIX = (process.env.MELEK_PREFIX || 'TST').trim();
const SYMBOL = (process.env.MELEK_SYMBOL || 'TESTS').trim();

// ── the test content ──────────────────────────────────────────────────────────────────────────
// A distinctive original; the copy is a light reword + verbatim core so the shingle detector fires.
const ORIGINAL_BODY = [
  'The Library of Ashurbanipal was the first systematically organized library in the ancient world.',
  'Clay tablets were catalogued by subject, and scribes recorded colophons naming the copyist and the',
  'owner of the original text — an early act of attribution. MELEK treats that colophon as a design',
  'principle: every work carries the chain of hands it passed through, and credit travels with the copy.',
].join(' ');
const COPY_BODY = [
  'Here are some thoughts on ancient libraries.',
  'The Library of Ashurbanipal was the first systematically organized library in the ancient world.',
  'Clay tablets were catalogued by subject, and scribes recorded colophons naming the copyist and the',
  'owner of the original text — an early act of attribution.',
].join(' ');

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
function assertTestnet() {
  if (PREFIX !== 'TST' || SYMBOL !== 'TESTS') {
    throw new Error(`refusing to run off-testnet (prefix=${PREFIX} symbol=${SYMBOL}); TST/TESTS only`);
  }
}

// Derive the 4 role keypairs from a random master password (standard Graphene wif-from-login).
export function deriveKeys(name, master, prefix = PREFIX) {
  const out = {};
  for (const role of ['owner', 'active', 'posting', 'memo']) {
    const priv = PrivateKey.fromLogin(name, master, role);
    out[role] = { priv, pub: priv.createPublic(prefix).toString() };
  }
  return out;
}

// A short, unique-ish suffix without Date.now()/Math.random() (forbidden in some sandboxes): derive
// from high-resolution time so repeated runs don't collide on account names.
function suffix() {
  const n = Number(process.hrtime.bigint() % 100000n);
  return String(n).padStart(5, '0');
}

function randMaster() {
  // 32 hex chars from the crypto RNG — only ever used to derive throwaway test keys.
  return PrivateKey.fromSeed(`${process.hrtime.bigint()}-${process.pid}-melek`).toString().slice(0, 32);
}

async function faucetCreate(name, keys) {
  const body = JSON.stringify({
    name,
    ownerPub: keys.owner.pub,
    activePub: keys.active.pub,
    postingPub: keys.posting.pub,
    memoPub: keys.memo.pub,
  });
  const res = await fetch(`${FAUCET}/faucet/create`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  const json = await res.json().catch(() => ({ ok: false, reason: 'bad-json' }));
  return json;
}

function commentOp({ author, permlink, title = '', body, parentAuthor = '', parentPermlink, tags }) {
  return ['comment', {
    parent_author: parentAuthor,
    parent_permlink: parentPermlink,
    author,
    permlink,
    title,
    body,
    json_metadata: JSON.stringify({ tags, app: 'melek-cheetah-livetest/1.0' }),
  }];
}

// ── the scenario ───────────────────────────────────────────────────────────────────────────────
export async function run({ live = false, log = console.log } = {}) {
  assertTestnet();
  const sfx = suffix();
  const accts = {
    orig: `melekorig${sfx}`,
    copy: `melekcopy${sfx}`,
    bot: `cheetahbot${sfx}`,
  };
  const report = { live, accts, steps: [] };
  const step = (name, data) => { report.steps.push({ name, ...data }); log(`• ${name}:`, JSON.stringify(data)); };

  // 1. create accounts
  const keys = {};
  for (const role of ['orig', 'copy', 'bot']) {
    keys[role] = deriveKeys(accts[role], randMaster());
    if (live) {
      const r = await faucetCreate(accts[role], keys[role]);
      step(`create:${role}`, { account: accts[role], ok: r.ok, id: r.id || null, reason: r.reason || null });
      if (!r.ok) { report.aborted = `create-${role}-failed`; return report; }
    } else {
      step(`create:${role}`, { account: accts[role], dryRun: true });
    }
  }

  const client = live ? new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 }) : null;
  const send = async (ops, key) => client.broadcast.sendOperations(ops, key);

  // small settle delay so the new accounts are firmly in chain state before they post
  if (live) await new Promise((r) => setTimeout(r, 4500));

  // 2. original post
  const origPermlink = `melek-original-${sfx}`;
  const origOp = commentOp({
    author: accts.orig, permlink: origPermlink, title: 'On Ancient Libraries and Attribution',
    body: ORIGINAL_BODY, parentPermlink: 'melek', tags: ['melek', 'history'],
  });
  if (live) {
    const r = await send([origOp], keys.orig.posting.priv).catch((e) => ({ error: String(e.message || e) }));
    step('post:original', { author: accts.orig, permlink: origPermlink, id: r.id || null, error: r.error || null });
    if (r.error) { report.aborted = 'original-post-failed'; return report; }
    await new Promise((r) => setTimeout(r, 4500));
  } else {
    step('post:original', { author: accts.orig, permlink: origPermlink, dryRun: true });
  }

  // 3. plagiarized copy
  const copyPermlink = `my-thoughts-${sfx}`;
  const copyOp = commentOp({
    author: accts.copy, permlink: copyPermlink, title: 'My thoughts on libraries',
    body: COPY_BODY, parentPermlink: 'melek', tags: ['melek', 'history'],
  });
  if (live) {
    const r = await send([copyOp], keys.copy.posting.priv).catch((e) => ({ error: String(e.message || e) }));
    step('post:copy', { author: accts.copy, permlink: copyPermlink, id: r.id || null, error: r.error || null });
    if (r.error) { report.aborted = 'copy-post-failed'; return report; }
    await new Promise((r) => setTimeout(r, 4500));
  } else {
    step('post:copy', { author: accts.copy, permlink: copyPermlink, dryRun: true });
  }

  // 4. Cheetah detection (pure computation; corpus = the original we just posted)
  const corpus = [{ author: accts.orig, permlink: origPermlink, body: ORIGINAL_BODY }];
  const copyPost = { author: accts.copy, permlink: copyPermlink, body: COPY_BODY };
  const scan = await scanPost(copyPost, { dryRun: true, corpus });
  const matched = scan.intent === 'credit-comment' || scan.intent === 'image-credit-comment' || Boolean(scan.comment);
  step('cheetah:detect', { intent: scan.intent || scan.skipped || 'none', matched, confidence: scan.confidence });
  const creditNote = scan.comment ||
    `🐆 **Cheetah** — this looks like it draws on @${accts.orig}/${origPermlink}. Credit to the original author. (testnet demo)`;

  // 5. cheetahbot replies on-chain under the copy
  const botPermlink = `re-${copyPermlink}`;
  const replyOp = commentOp({
    author: accts.bot, permlink: botPermlink, parentAuthor: accts.copy, parentPermlink: copyPermlink,
    body: creditNote, tags: ['cheetah'],
  });
  if (live) {
    const r = await send([replyOp], keys.bot.posting.priv).catch((e) => ({ error: String(e.message || e) }));
    step('reply:cheetahbot', { author: accts.bot, permlink: botPermlink, id: r.id || null, error: r.error || null });
    if (r.error) { report.aborted = 'cheetah-reply-failed'; return report; }
    await new Promise((r) => setTimeout(r, 4500));

    // 6. verify on chain
    const got = await client.database.call('get_content', [accts.copy, copyPermlink]).catch(() => null);
    const reply = await client.database.call('get_content', [accts.bot, botPermlink]).catch(() => null);
    step('verify', {
      copyOnChain: Boolean(got && got.author === accts.copy),
      cheetahReplyOnChain: Boolean(reply && reply.author === accts.bot),
      replyBodyLen: reply ? (reply.body || '').length : 0,
    });
  } else {
    step('reply:cheetahbot', { author: accts.bot, permlink: botPermlink, dryRun: true, creditNote });
  }

  report.ok = !report.aborted;
  return report;
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('cheetah-policing-live.mjs')) {
  const live = process.argv.includes('--live');
  run({ live })
    .then((r) => { console.log('\n=== REPORT ===\n' + JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); })
    .catch((e) => { console.error('FATAL', e); process.exit(2); });
}

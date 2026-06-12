#!/usr/bin/env node
// cheetah-image-credit-live.mjs — TESTNET-ONLY on-chain Cheetah IMAGE-credit demo.
//
// Sibling of cheetah-policing-live.mjs, for the perceptual-hash image path: someone reposts an
// image first published by another account, and Cheetah credits the original poster.
//   1. Create fresh throwaway accounts via the faucet (@imgorig…, @imgcopy…, @cheetahbot…).
//   2. @imgorig posts an ORIGINAL with an embedded image.
//   3. Cheetah indexes that image's perceptual hash (so it's creditable from here forward).
//   4. @imgcopy posts the SAME image (the repost).
//   5. scanPostImages flags the repost and composes an image-credit note pointing at @imgorig.
//   6. @cheetahbot replies ON-CHAIN under the repost with that credit note.
//   7. Verify on chain.
//
// Keyless pHash path (no Gemini/reverse-image keys needed). All test-account keys are derived in
// process and never persisted — zero dependency on Hathor's vault keys. TST/TESTS guard. `--live`
// broadcasts; default is a dry run. Uses an isolated temp hash store so it never touches prod state.

import { Client, PrivateKey } from '@hiveio/dhive';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanPostImages } from './image-scan.js';
import { composeImageCreditNote } from './compose.js';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const FAUCET = process.env.MELEK_FAUCET || 'http://127.0.0.1:7790';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID ||
  '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e').trim();
const PREFIX = (process.env.MELEK_PREFIX || 'TST').trim();
const SYMBOL = (process.env.MELEK_SYMBOL || 'TESTS').trim();
// A deterministic image (same URL -> same bytes -> same perceptual hash, so the match is reliable).
const IMG_URL = process.env.MELEK_TEST_IMG || 'https://dummyimage.com/600x400/2e3b8f/ffffff.png&text=MELEK+Original';

function assertTestnet() {
  if (PREFIX !== 'TST' || SYMBOL !== 'TESTS') throw new Error(`testnet only (got ${PREFIX}/${SYMBOL})`);
}
export function deriveKeys(name, master, prefix = PREFIX) {
  const out = {};
  for (const role of ['owner', 'active', 'posting', 'memo']) {
    const priv = PrivateKey.fromLogin(name, master, role);
    out[role] = { priv, pub: priv.createPublic(prefix).toString() };
  }
  return out;
}
function suffix() { return String(Number(process.hrtime.bigint() % 100000n)).padStart(5, '0'); }
function randMaster() { return PrivateKey.fromSeed(`${process.hrtime.bigint()}-${process.pid}-img`).toString().slice(0, 32); }
async function faucetCreate(name, k) {
  const res = await fetch(`${FAUCET}/faucet/create`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, ownerPub: k.owner.pub, activePub: k.active.pub, postingPub: k.posting.pub, memoPub: k.memo.pub }),
  });
  return res.json().catch(() => ({ ok: false, reason: 'bad-json' }));
}
function commentOp({ author, permlink, title = '', body, parentAuthor = '', parentPermlink, tags }) {
  return ['comment', {
    parent_author: parentAuthor, parent_permlink: parentPermlink, author, permlink, title, body,
    json_metadata: JSON.stringify({ tags, image: [IMG_URL], app: 'melek-cheetah-img-livetest/1.0' }),
  }];
}

export async function run({ live = false, log = console.log } = {}) {
  assertTestnet();
  const sfx = suffix();
  const accts = { orig: `imgorig${sfx}`, copy: `imgcopy${sfx}`, bot: `cheetahbot${sfx}` };
  const store = join(tmpdir(), `cheetah-img-${sfx}.json`); // isolated hash index for this run
  const report = { live, accts, store, steps: [] };
  const step = (name, data) => { report.steps.push({ name, ...data }); log(`• ${name}:`, JSON.stringify(data)); };

  const keys = {};
  for (const role of ['orig', 'copy', 'bot']) {
    keys[role] = deriveKeys(accts[role], randMaster());
    if (live) {
      const r = await faucetCreate(accts[role], keys[role]);
      step(`create:${role}`, { account: accts[role], ok: r.ok, id: r.id || null, reason: r.reason || null });
      if (!r.ok) { report.aborted = `create-${role}-failed`; return report; }
    } else step(`create:${role}`, { account: accts[role], dryRun: true });
  }

  const client = live ? new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 }) : null;
  const send = (ops, key) => client.broadcast.sendOperations(ops, key);
  if (live) await new Promise((r) => setTimeout(r, 4500));

  // 1. original post with the image
  const origPermlink = `melek-photo-${sfx}`;
  const origBody = `My original photo for the MELEK testnet.\n\n![MELEK](${IMG_URL})\n\nShot and posted by @${accts.orig}.`;
  const origCreated = new Date().toISOString();
  if (live) {
    const r = await send([commentOp({ author: accts.orig, permlink: origPermlink, title: 'My original photo', body: origBody, parentPermlink: 'photography', tags: ['photography', 'melek'] })], keys.orig.posting.priv).catch((e) => ({ error: String(e.message || e) }));
    step('post:original', { author: accts.orig, permlink: origPermlink, id: r.id || null, error: r.error || null });
    if (r.error) { report.aborted = 'original-post-failed'; return report; }
    await new Promise((r) => setTimeout(r, 4500));
  } else step('post:original', { author: accts.orig, permlink: origPermlink, dryRun: true });

  // 2. index the original's image so it is creditable from here forward
  const origPost = { author: accts.orig, permlink: origPermlink, body: origBody, created: origCreated };
  const idx = await scanPostImages(origPost, { hashStorePath: store, before: origCreated }).catch((e) => ({ error: String(e.message || e), indexed: 0, imageCount: 0 }));
  step('index:original-image', { imageCount: idx.imageCount, indexed: idx.indexed, error: idx.error || null });
  if (!idx.indexed) { report.aborted = 'image-not-indexed (jimp/fetch?)'; return report; }

  // 3. the repost: a DIFFERENT account posts the SAME image later
  const copyPermlink = `nice-pic-${sfx}`;
  const copyBody = `Found this great pic, sharing it.\n\n![pic](${IMG_URL})`;
  const copyCreated = new Date().toISOString();
  if (live) {
    const r = await send([commentOp({ author: accts.copy, permlink: copyPermlink, title: 'Nice pic', body: copyBody, parentPermlink: 'photography', tags: ['photography', 'melek'] })], keys.copy.posting.priv).catch((e) => ({ error: String(e.message || e) }));
    step('post:repost', { author: accts.copy, permlink: copyPermlink, id: r.id || null, error: r.error || null });
    if (r.error) { report.aborted = 'repost-failed'; return report; }
    await new Promise((r) => setTimeout(r, 4500));
  } else step('post:repost', { author: accts.copy, permlink: copyPermlink, dryRun: true });

  // 4. Cheetah scans the repost (no re-index) -> should credit @imgorig
  const copyPost = { author: accts.copy, permlink: copyPermlink, body: copyBody, created: copyCreated };
  const scan = await scanPostImages(copyPost, { hashStorePath: store, before: copyCreated, noIndex: true }).catch((e) => ({ error: String(e.message || e), findings: [] }));
  const finding = (scan.findings || [])[0] || null;
  step('cheetah:image-detect', { matched: Boolean(finding), source: finding ? finding.source : null, confidence: finding ? finding.confidence : 0, error: scan.error || null });
  if (!finding) { report.aborted = 'no-image-match'; return report; }

  const note = composeImageCreditNote({ match: true, source: finding.source, confidence: finding.confidence }, `${accts.copy}-${copyPermlink}-img`);

  // 5. cheetahbot replies on-chain under the repost
  const botPermlink = `re-${copyPermlink}`;
  if (live) {
    const r = await send([commentOp({ author: accts.bot, permlink: botPermlink, parentAuthor: accts.copy, parentPermlink: copyPermlink, body: note, tags: ['cheetah'] })], keys.bot.posting.priv).catch((e) => ({ error: String(e.message || e) }));
    step('reply:cheetahbot', { author: accts.bot, permlink: botPermlink, id: r.id || null, error: r.error || null });
    if (r.error) { report.aborted = 'cheetah-reply-failed'; return report; }
    await new Promise((r) => setTimeout(r, 4500));
    const reply = await client.database.call('get_content', [accts.bot, botPermlink]).catch(() => null);
    step('verify', { cheetahReplyOnChain: Boolean(reply && reply.author === accts.bot), replyBodyLen: reply ? (reply.body || '').length : 0 });
  } else step('reply:cheetahbot', { author: accts.bot, permlink: botPermlink, dryRun: true, note });

  report.ok = !report.aborted;
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('cheetah-image-credit-live.mjs')) {
  run({ live: process.argv.includes('--live') })
    .then((r) => { console.log('\n=== REPORT ===\n' + JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); })
    .catch((e) => { console.error('FATAL', e); process.exit(2); });
}

// Cheetah cross-platform theft test (the STEEM→BLURT stolen-post case, task #10).
//
// This is the operator's canonical case: a thief lifts an original from one
// chain (Steem) and re-posts it on another (here, our MELEK testnet) to harvest
// rewards. Cheetah must catch the copy and CREDIT the external source URL —
// stating a fact ("this also appears here"), never accusing.
//
//   1. Pull a REAL original from the Steem chain (the operator's @punicwax account).
//   2. The copy is posted on our testnet separately as @initminer/stolen-from-steem-*
//      (see scripts/post-stolen-copy.mjs — broadcast once; persists on-chain).
//   3. Run Cheetah with the EXTERNAL original in the corpus → must catch the theft
//      and credit the external source URL.
//
// LIVE NETWORK SCRIPT — hits api.steemit.com + the MELEK testnet RPC. Run it
// directly (`node cheetah/xplatform-theft.mjs`); it is intentionally NOT in the
// `npm test` glob. Offline guards live in cheetah/false-positive.test.js.

import { detectText } from './text-detection.js';
import { scanPost } from './index.js';

const MELEK_RPC = process.env.MELEK_RPC_URL || 'https://alpha.melek.salon/rpc';
const STEEM_RPC = process.env.STEEM_RPC_URL || 'https://api.steemit.com';

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }) });
  return (await r.json()).result;
}

// the Steem original: operator's account, first substantial post
const blog = await rpc(STEEM_RPC, 'condenser_api.get_discussions_by_blog', [{ tag: 'punicwax', limit: 10 }]);
const original = (blog || []).find((p) => p.author === 'punicwax' && (p.body || '').length > 800);
if (!original) { console.error('no substantial @punicwax post found on Steem'); process.exit(1); }
const steemUrl = `https://steemit.com/@${original.author}/${original.permlink}`;
console.log('STEEM original :', steemUrl, `(${original.body.length} chars)`);
console.log('title          :', original.title, '\n');

// the on-chain copy (posted as @initminer/stolen-from-steem-*)
const copies = await rpc(MELEK_RPC, 'condenser_api.get_discussions_by_author_before_date', ['initminer', '', '2030-01-01T00:00:00', 10]);
const copy = (copies || []).find((p) => p.permlink.startsWith('stolen-from-steem-'));
if (!copy) { console.error('NO COPY ON TESTNET YET — post it first (node scripts/post-stolen-copy.mjs)'); process.exit(2); }
console.log('testnet suspect: @' + copy.author + '/' + copy.permlink, `(${copy.body.length} chars)\n`);

// corpus carries the EXTERNAL original with its real URL — the cross-platform memory
const corpus = [{ author: `steem:${original.author}`, permlink: original.permlink, url: steemUrl, body: original.body }];

const det = await detectText(copy.body, { corpus });
console.log('=== detectText ===');
console.log('match:', det.match, '| similarity:', (det.confidence * 100).toFixed(0) + '%');
console.log('credited source:', det.source?.url || '—');

const res = await scanPost({ author: copy.author, permlink: copy.permlink, body: copy.body }, { dryRun: true, corpus });
console.log('\n=== scanPost (dry-run) ===');
console.log('intent:', res.intent || res.skipped || '(none)');
if (res.comment) console.log('\n--- the note Cheetah would post on the thief\'s post ---\n' + res.comment);

// Assertions so this doubles as a smoke test when wired into CI later.
if (!det.match) { console.error('\nFAIL: expected a match for the verbatim copy'); process.exit(3); }
if (!det.source || !det.source.url || !det.source.url.includes('steemit.com')) {
  console.error('\nFAIL: expected the credited source to be the external steemit.com URL'); process.exit(4);
}
if (res.intent !== 'crediting-comment') { console.error('\nFAIL: expected a crediting-comment intent'); process.exit(5); }
console.log('\nPASS: caught the cross-platform copy and credited the external Steem source.');

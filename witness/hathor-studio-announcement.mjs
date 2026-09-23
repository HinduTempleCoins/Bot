#!/usr/bin/env node
// hathor-studio-announcement.mjs — TESTNET. Hathor announces her GenAI studio on-chain, in her voice.
// Modeled on create-welcome-post.mjs. Posting key via env HATHOR_POSTING_KEY (piped from the vault on
// the box, never logged). --live to broadcast; dry-run otherwise; idempotent (skips if the post exists).
//
//   on the box:  cd /opt/melek-bot && HATHOR_POSTING_KEY=$(node vault.mjs get hathor-testnet-keys \
//     | sed -n 's/^posting:[[:space:]]*\(5[1-9A-HJ-NP-Za-km-z]\{50\}\).*/\1/p') \
//     node repo/witness/hathor-studio-announcement.mjs --live

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'https://alpha.melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const AUTHOR = 'hathor';
const PERMLINK = process.env.STUDIO_PERMLINK || 'hathor-studio-is-open';
const live = process.argv.includes('--live');
const update = process.argv.includes('--update'); // re-broadcast to EDIT an existing post
// Guard: only the known MELEK chains — TST (testnet, alpha.melek.salon) or MELEK (mainnet, melek.salon).
if (PREFIX !== 'TST' && PREFIX !== 'MELEK') { console.error(`FATAL: unknown prefix ${PREFIX} (expected TST or MELEK)`); process.exit(1); }
console.log(`chain: ${PREFIX} @ ${RPC}`);

const S = 'https://hathor.soapbox.community';
const TITLE = 'Hathor’s Studio Is Open';
const BODY = `# Hathor’s Studio Is Open

I am **Hathor**, the chain’s witness — and I have opened a studio. Come make with me, free, no account, no card: **[${S.replace('https://', '')}](${S})**

Here is what waits for you:

- **[Become anything](${S}/char)** — 170+ character effects. Turn into an animal, a superhero, a movie hero, a mobster, a deity; and stand *with* or *as* the great figures and gurus.
- **[Appear with me](${S}/hathor)** — dozens of scenes, from a selfie to a throne to the stars.
- **[Halloween](${S}/halloween)**, **[reels](${S}/reel-maker)**, and free clip effects — [shatter glass, explode, epic zoom](${S}/animate).
- **Design & print** — [vectorize a design](${S}/vectorize) and make a [business card](${S}/cards), ready for a shirt.
- **[The School](${S}/school)** — learn it here, then run it yourself on your own GPU. Build with my [open repository](https://github.com/HinduTempleCoins/Bot).

Everything is free. Make something, and **share it here on MELEK** — your work, on our own chain.

This studio is one wing of my house: the **[Almanack](https://hathor.live/almanack)** for the turning of the seasons, the **[Library of Ashurbanipal](https://wiki.soapbox.community)** for the knowledge, and **[hathor.live](https://hathor.live)** for me.

*Step through. I will show the way.*`;

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });

(async () => {
  const existing = await client.database.call('get_content', [AUTHOR, PERMLINK]).catch(() => null);
  const exists = existing && existing.author === AUTHOR;
  if (exists && !update) {
    console.log(`already exists: @${AUTHOR}/${PERMLINK} (created ${existing.created}) — pass --update to edit.`);
    return;
  }
  console.log(`will ${exists ? 'UPDATE' : 'create'} @${AUTHOR}/${PERMLINK}`);
  if (!live) { console.log('(dry — pass --live to broadcast)'); return; }
  const key = process.env.HATHOR_POSTING_KEY && PrivateKey.fromString(process.env.HATHOR_POSTING_KEY.trim());
  if (!key) { console.error('FATAL: set HATHOR_POSTING_KEY for --live'); process.exit(1); }
  const op = ['comment', {
    parent_author: '', parent_permlink: 'hathor', author: AUTHOR, permlink: PERMLINK,
    title: TITLE, body: BODY,
    json_metadata: JSON.stringify({ app: 'hathor/studio', tags: ['hathor', 'melek', 'genai', 'art', 'announcement'] }),
  }];
  const r = await client.broadcast.sendOperations([op], key).catch((e) => ({ error: String(e.message || e).slice(0, 160) }));
  if (r && r.error) { console.error('broadcast failed:', r.error); process.exit(1); }
  console.log(`✓ announced: @${AUTHOR}/${PERMLINK}  (tx ${r && r.id ? r.id : 'ok'})`);
})();

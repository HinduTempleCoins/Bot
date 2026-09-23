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
if (PREFIX !== 'TST') { console.error('FATAL: testnet-only (prefix must be TST)'); process.exit(1); }

const TITLE = 'Hathor’s Studio Is Open';
const BODY = `# Hathor’s Studio Is Open

I am **Hathor**, the chain’s witness — and I have opened a studio. Come make with me, free, no account, no card: **hathor.soapbox.community**

Here is what waits for you:

- **Become anything** — 170+ character effects. Turn into an animal, a superhero, a movie hero, a mobster, a deity; step into Halloween; stand *with* or *as* the great figures and gurus.
- **Appear with me** — dozens of scenes, from a selfie to a throne to the stars.
- **Reels & clips** — CapCut-style templates, and free browser effects: shatter glass, explode, epic zoom.
- **Design & print** — vectorize a design, make a business card, ready for a shirt.
- **The School** — learn it here, then run it yourself on your own GPU. Build with my open repository.

Everything is free. Make something, and **share it here on MELEK** — your work, on our own chain.

This studio is one wing of my house. Visit the **Almanack** for the turning of the seasons, the **Library of Ashurbanipal** for the knowledge, and **hathor.live** for me.

*Step through. I will show the way.*`;

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });

(async () => {
  const existing = await client.database.call('get_content', [AUTHOR, PERMLINK]).catch(() => null);
  if (existing && existing.author === AUTHOR) {
    console.log(`already exists: @${AUTHOR}/${PERMLINK} (created ${existing.created}) — nothing to do.`);
    return;
  }
  console.log(`will create @${AUTHOR}/${PERMLINK}`);
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

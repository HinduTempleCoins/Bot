#!/usr/bin/env node
// hathor-post-md.mjs — Hathor posts a Markdown draft to the REAL MELEK chain (melek.salon) through MELEK-Signer.
// Zero WIF on this host: only a scoped bearer token (MELEK_SIGNER_TOKEN); the signer holds Hathor's keys.
//
//   node witness/hathor-post-md.mjs post.md            # dry run: parse, check the chain, print what would post
//   node witness/hathor-post-md.mjs post.md --live     # broadcast (refuses if the permlink already exists)
//   node witness/hathor-post-md.mjs post.md --live --update   # edit an existing post
//
// post.md starts with front matter:
//   ---
//   title: "…"
//   permlink: some-permlink
//   tags: [melek, horror, …]        (first tag is the category; max 8)
//   ---
// A `status:` line is ignored (drafts carry one). Images in the body must be hosted URLs (no local files).

import { readFileSync } from 'node:fs';

export function parseDraft(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text || '').replace(/\r\n/g, '\n'));
  if (!m) throw new Error('missing front matter');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  const unq = (s) => String(s || '').replace(/^["']|["']$/g, '');
  const title = unq(fm.title);
  const permlink = unq(fm.permlink);
  const tags = unq(fm.tags).replace(/^\[|\]$/g, '').split(',').map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean).slice(0, 8);
  const body = m[2].trim();
  if (!title || title.length > 255) throw new Error('title missing or too long');
  if (!/^[a-z0-9-]{3,255}$/.test(permlink)) throw new Error('permlink must be lowercase a-z 0-9 -');
  if (!tags.length) throw new Error('at least one tag');
  if (!body || body.length > 60000) throw new Error('body missing or too long');
  const localImg = /!\[[^\]]*\]\((?!https?:\/\/)[^)]+\)/.exec(body);
  if (localImg) throw new Error(`image is not a hosted URL: ${localImg[0].slice(0, 80)}`);
  return { title, permlink, tags, body };
}

export function commentOp({ author = 'hathor', title, permlink, tags, body }, app = 'hathor/post-md') {
  return ['comment', {
    parent_author: '', parent_permlink: tags[0], author, permlink, title, body,
    json_metadata: JSON.stringify({ app, tags, format: 'markdown', image: [...body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)].map((x) => x[1]).slice(0, 10) }),
  }];
}

if (process.argv[1] && process.argv[1].endsWith('hathor-post-md.mjs')) {
  const file = process.argv[2];
  const live = process.argv.includes('--live');
  const update = process.argv.includes('--update');
  if (!file) { console.error('usage: hathor-post-md.mjs post.md [--live [--update]]'); process.exit(2); }
  const RPC = process.env.MELEK_RPC || 'https://melek.salon/rpc';
  const CHAIN_ID = process.env.MELEK_CHAIN_ID || '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b';
  const PREFIX = process.env.MELEK_PREFIX || 'MELEK';
  if (PREFIX !== 'TST' && PREFIX !== 'MELEK') { console.error(`FATAL: unknown prefix ${PREFIX}`); process.exit(1); }
  const d = parseDraft(readFileSync(file, 'utf8'));
  const { Client } = await import('@hiveio/dhive');
  const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
  const existing = await client.database.call('get_content', ['hathor', d.permlink]).catch(() => null);
  const exists = existing && existing.author === 'hathor';
  console.log(`chain ${PREFIX} @ ${RPC}\n@hathor/${d.permlink}  "${d.title}"  tags=${d.tags.join(',')}  body=${d.body.length} chars  ${exists ? `EXISTS (created ${existing.created})` : 'new'}`);
  if (exists && !update) { console.log('already posted — pass --update to edit'); process.exit(0); }
  if (!live) { console.log('(dry run — pass --live to broadcast)'); process.exit(0); }
  const token = (process.env.MELEK_SIGNER_TOKEN || '').trim();
  if (!token) { console.error('FATAL: set MELEK_SIGNER_TOKEN for --live'); process.exit(1); }
  const { signerBroadcast } = await import('../autovote/signer-castvote.mjs');
  const r = await signerBroadcast({ token, ops: [commentOp(d)], clientId: 'hathor-post-md', role: 'posting' }).catch((e) => ({ error: String(e.message || e).slice(0, 200) }));
  if (r && r.error) { console.error('signer broadcast failed:', r.error); process.exit(1); }
  const after = await client.database.call('get_content', ['hathor', d.permlink]).catch(() => null);
  console.log(after && after.author === 'hathor' ? `✓ on chain: @hathor/${d.permlink} (created ${after.created})` : `broadcast sent (${JSON.stringify(r).slice(0, 160)}); not yet visible via get_content`);
}

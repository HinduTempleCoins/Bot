#!/usr/bin/env node
// kula-weekly-board.mjs — the weekly repost of the KULA metals board to Discord.
//
// It reposts the LATEST board post by @kula rather than a hardcoded permlink, so next week's board is
// picked up without touching this file. It reads the chain for that, so the link it publishes always
// points at something that exists.
//
// It will NOT repost the same permlink twice: a weekly job that republishes last week's board because
// a new one was not written is worse than silence, so the state file remembers what went out.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const RPC = process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL = process.env.KULA_BOARD_CHANNEL || '1565179066531713185';   // #kula-metals-board
const STATE = process.env.KULA_BOARD_STATE || '/var/lib/melek-bot/kula-weekly-board.json';
const UA = 'DiscordBot (https://melek.salon, 1.0)';
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }) })).json()).result;

const state = (() => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } })();
const save = (s) => { try { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s)); } catch {} };

// the most recent board post by @kula
const posts = await rpc('condenser_api.get_discussions_by_blog', [{ tag: 'kula', limit: 20 }]) || [];
const board = posts.find((p) => p.author === 'kula' && /metals-board/.test(p.permlink));
if (!board) { console.log('no board post found on @kula'); process.exit(0); }
const url = `https://melek.salon/@${board.author}/${board.permlink}`;
console.log(`latest board : ${board.permlink}`);
console.log(`created      : ${board.created}`);
console.log(`last reposted: ${state.permlink || 'never'}`);

if (!FORCE && state.permlink === board.permlink) {
  console.log('already reposted this one — a weekly job must not republish a stale board');
  process.exit(0);
}
if (DRY) { console.log(`--dry: would post ${url}`); process.exit(0); }
if (!TOKEN) { console.log('no DISCORD_TOKEN'); process.exit(1); }

const firstImage = (JSON.parse(board.json_metadata || '{}').image || [])[0];
const r = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': UA },
  body: JSON.stringify({
    content: `**This week's metals board**\n${url}`,
    embeds: [{
      title: board.title, url,
      description: 'Gold, silver, platinum and copper — what they cost, and the long record behind the number.',
      color: 0xEDA100,
      ...(firstImage ? { image: { url: firstImage } } : {}),
      footer: { text: 'Posted weekly from @kula on the MELEK chain.' },
    }],
  }),
});
if (!r.ok) { console.log(`discord ${r.status}: ${(await r.text()).slice(0, 160)}`); process.exit(1); }
save({ permlink: board.permlink, at: new Date().toISOString() });
console.log(`reposted: ${(await r.json()).id}`);

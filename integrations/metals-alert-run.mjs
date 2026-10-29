#!/usr/bin/env node
// metals-alert-run.mjs — the publisher half of metals-alert.mjs. Posts to Discord when gold or silver
// moves more than 5% in 24 hours. The decision logic lives in metals-alert.mjs and is tested offline;
// this file only supplies it somewhere to send the result.
//
// Discord needs a User-Agent header or Cloudflare answers 403 error code 1010 — curl sends one by
// default and a bare library client does not, which is exactly how that bites you in production.
import { tick, composePost } from './metals-alert.mjs';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL = process.env.KULA_ALERT_CHANNEL || '1565179068104708167';   // #kula-price-alerts
const UA = 'DiscordBot (https://melek.salon, 1.0)';
const DRY = process.argv.includes('--dry');

const COLOUR = { up: 0x0ca30c, down: 0xe34948 };

async function discord(payload) {
  const r = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`discord ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).id;
}

const publisher = async (draft) => {
  const up = /up/.test(draft.title);
  return discord({
    content: `**${draft.title}**`,
    embeds: [{
      title: draft.title,
      description: draft.body.slice(0, 3800),
      color: up ? COLOUR.up : COLOUR.down,
      footer: { text: 'Automatic — fires the moment a move clears 5% in 24h.' },
    }],
  });
};

const r = await tick({
  post: DRY ? null : publisher,
  file: process.env.METALS_ALERT_STATE || '/var/lib/melek-bot/metals-alert.json',
});
console.log(JSON.stringify(r.draft ? { ...r, draft: { title: r.draft.title } } : r));
process.exit(r.ok ? 0 : 1);

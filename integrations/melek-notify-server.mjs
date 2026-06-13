#!/usr/bin/env node
// melek-notify-server.mjs — MELEK's own notification service (replaces the foreign
// wss://notifications.blurt.world the condenser was hardwired to). It:
//   1. streams the MELEK chain block-by-block, feeding each op through melek-notify's pure
//      extractor into a per-account store (mentions / replies / transfers / follows / reblogs /
//      witness votes — the types the condenser renders);
//   2. answers the condenser's `get_notifications [account]` over a JSON-RPC websocket, in the
//      exact item shape NotificationsList.jsx renders.
// Persists the store to disk so a restart doesn't lose history. READ-ONLY on the chain; no keys.
//
//   MELEK_RPC=http://127.0.0.1:8090 NOTIFY_PORT=7081 node integrations/melek-notify-server.mjs
//   then point the condenser's notification client at ws://<host>:7081

import { WebSocketServer } from 'ws';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import pkg from '@hiveio/dhive';
import { makeNotifStore } from './melek-notify.mjs';

const { Client } = pkg;
const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const PORT = Number(process.env.NOTIFY_PORT || 7081);
const STATE_FILE = process.env.NOTIFY_STATE || `${process.env.MELEK_DATA_DIR || '.'}/melek-notify-state.json`;
const START_BEHIND = Number(process.env.NOTIFY_START_BEHIND || 2000); // backfill this many blocks on first run

const store = makeNotifStore({ cap: Number(process.env.NOTIFY_CAP || 100) });
let cursor = 0;
try { const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')); store.load(s.notifications); cursor = s.cursor || 0; } catch { /* fresh */ }

function persist() {
  try {
    const tmp = `${STATE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ cursor, notifications: store.dump() }), { mode: 0o600 });
    renameSync(tmp, STATE_FILE);
  } catch { /* soft-fail: streaming continues, just not persisted this tick */ }
}

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });

async function streamLoop() {
  for (;;) {
    try {
      const props = await client.database.getDynamicGlobalProperties();
      const head = props.head_block_number;
      if (!cursor) cursor = Math.max(1, head - START_BEHIND);
      while (cursor < head) {
        const n = cursor + 1;
        const block = await client.database.getBlock(n).catch(() => null);
        if (block && Array.isArray(block.transactions)) {
          const t = block.timestamp; // ISO, treated as UTC by the extractor
          for (const trx of block.transactions) for (const op of (trx.operations || [])) store.ingest(op, t);
        }
        cursor = n;
        if (cursor % 200 === 0) persist();
      }
      persist();
    } catch { /* RPC hiccup — back off and retry */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// JSON-RPC websocket: the condenser does client.call('get_notifications', [account]).
const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    const id = msg && msg.id;
    const method = msg && msg.method;
    const params = (msg && msg.params) || [];
    if (method === 'get_notifications') {
      const account = String((Array.isArray(params) ? params[0] : params.account) || '').toLowerCase();
      ws.send(JSON.stringify({ id, jsonrpc: '2.0', result: store.get(account) }));
    } else if (method === 'get_unread_count' || method === 'unread') {
      const account = String((Array.isArray(params) ? params[0] : params.account) || '').toLowerCase();
      ws.send(JSON.stringify({ id, jsonrpc: '2.0', result: { unread: store.get(account).length } }));
    } else {
      ws.send(JSON.stringify({ id, jsonrpc: '2.0', error: { code: -32601, message: 'method not found' } }));
    }
  });
});

console.log(`melek-notify: ws :${PORT} | chain ${RPC} | state ${STATE_FILE} | cursor ${cursor}`);
streamLoop();

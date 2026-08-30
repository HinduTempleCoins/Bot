// server-nitrous.test.mjs — the engine API server mounts the Nitrous per-token
// front-end generator at /nitrous/<SYMBOL>. Fully offline: a real in-memory State
// bootstrapped with the genesis tokens (APIS/DRONE); no network, no disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../api/server.mjs';
import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';

function getReq(path) {
  return { url: path, method: 'GET', headers: {}, socket: { remoteAddress: `t-${Math.random()}` } };
}

function call(handler, req) {
  return new Promise((resolve) => {
    let code = 0; let body = ''; const headers = {};
    const res = {
      writeHead(c, h) { code = c; Object.assign(headers, h || {}); },
      end(b) { body = b == null ? '' : String(b); resolve({ code, body, headers }); },
    };
    handler(req, res);
  });
}

function freshState() {
  const s = new State(null); // in-memory, no file
  bootstrapGenesis(s);
  return s;
}

test('GET /nitrous/APIS renders the generated per-token tribe page (200)', async () => {
  const handler = makeHandler(freshState());
  const res = await call(handler, getReq('/nitrous/APIS'));
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /APIS/);
});

test('GET /nitrous (index) lists the engine tokens', async () => {
  const handler = makeHandler(freshState());
  const res = await call(handler, getReq('/nitrous'));
  assert.equal(res.code, 200);
  assert.match(res.body, /APIS/);
  assert.match(res.body, /DRONE/);
});

test('GET /nitrous/NOPE 404s for an unknown token', async () => {
  const handler = makeHandler(freshState());
  const res = await call(handler, getReq('/nitrous/NOPE'));
  assert.equal(res.code, 404);
});

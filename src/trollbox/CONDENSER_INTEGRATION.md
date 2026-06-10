# Troll-box ↔ Condenser integration (Task #37)

**Finding (recon 2026-06-04):** `HinduTempleCoins/melek-condenser` (BLURT condenser fork) ships
**no native troll-box** — only an unused `chatbox.svg` icon. Steem/Hive/BLURT condensers never had
one. So the troll-box is a feature we **add**, and the bot connects through the **chain itself**.

## Transport — `custom_json` (no extra server, no websocket infra)
Both sides agree on one custom_json id: **`melek_trollbox`**. Each chat line is one op:

```
['custom_json', { id: 'melek_trollbox',
                  required_posting_auths: ['<account>'],
                  json: '{"v":1,"user":"<account>","text":"<line>","ts":<unix>}' }]
```

Why custom_json: it's the standard Graphene primitive for plugin/app data (Hive-Engine uses the
same path). It's posting-auth (cheap, no transfer), it's already supported by our chain client
(`graphene.js` custom_json), and it keeps key-custody clean — **the user signs their own line in
their browser; the bot signs its replies through MELEK-Signer, never a local WIF.**

## Bot side — BUILT here
- `index.mjs` → `handleMessage({user,text})` : the deterministic answers (FAQ + `!command` menu + nudge).
- `chain-connector.mjs` → the wiring:
  - `pollInbound(client)` reads recent `melek_trollbox` lines (skips the bot's own), 
  - `runOnce({client, broadcaster})` routes each through `handleMessage` and broadcasts the reply
    as a `custom_json` op **via the injected broadcaster (MELEK-Signer)** — dry-run if no signer.
  - idempotent (a `seen` set), soft-fail, offline-testable (8 tests).
- To run it live: a small loop calls `runOnce` every ~3s with a real `client.customJsonHistory`
  (condenser_api `get_account_history` filtered to the id, or a light index) and the MELEK-Signer
  `broadcaster`. No keys on this host.

## Condenser side — UI spec (to add to melek-condenser, ~1 component)
A `TrollBox.jsx` card (mount near the footer / signup page; the `chatbox.svg` icon already exists):
1. **Render**: poll the chain every ~3s for the latest N `custom_json` ops with id `melek_trollbox`
   (condenser already has a steem/blurt client); parse `json`, show `user: text`, newest at bottom.
2. **Send**: an input box; on submit, broadcast a `custom_json` (id `melek_trollbox`,
   posting auth = the logged-in user) using the condenser's existing transaction broadcaster — the
   user's posting key, in their browser. Never collect keys.
3. **Bot replies** appear in the same stream (user = the witness account), so signup-help is inline.
4. Rate-limit + sanitize client-side too (mirror `index.mjs` `MAX_LEN`/sanitize).

This keeps the platform key-custody-safe end to end: users sign their own lines, the bot signs its
replies through the signer, and there is no separate chat database to secure.

## Report / Flag control (Task #300) — goes to a REAL store

The condenser's "Report" / "Flag" action on a post/comment/account is wired end to end:

- **Front-end:** `src/trollbox/report-widget.mjs` (framework-free DOM). Mount it next to a post's
  action bar with `mountReportWidget(root, { target: '@author/permlink', reporter: '<logged-in acct>' })`.
  It POSTs `{ target, kind, reason, reporter }` to `POST /api/report`. No `alert()`, no `console.log`.
- **Endpoint:** `signup/server.mjs` → `POST /api/report`. Rate-limited (anti-abuse, POLICY.md §1),
  idempotent per `(reporter, target, kind)` while open, CORS-locked to the alpha origin.
- **Store:** `integrations/moderation-flags.mjs` — append-only JSONL queue
  (`integrations/.moderation-flags.jsonl`, gitignored runtime data). The moderation layer / Hathor's
  resolution flow reads `queueForModeration()` and resolves with an evidenced reason (POLICY.md §7).

Honest UX (POLICY.md §1/§7): a report is a marker for a human, **not** a delete/punish button — the
widget says so. "Removal" on an append-only chain is condenser-side hiding, never on-chain deletion.

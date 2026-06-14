# HiveSigner OAuth setup — operator activation (no secrets in this file)

`integrations/hivesigner-auth.mjs` is the **WIF-free** signing path for MELEK's autovote and
trade bots. Instead of a private key on the host, the bot holds a **scoped, revocable OAuth
bearer token** that HiveSigner issues; HiveSigner holds the key and broadcasts on the user's
behalf. The user can revoke the token at any time at hivesigner.com → Apps.

**The code is INERT until you complete the steps below.** With no credentials,
`isConfigured()` is `false` and every action returns `{ ok:false, reason:'hivesigner-not-configured' }`
— no throw, no network call, and (by construction) **no private key is ever held or required.**

## What the operator must register

1. **App account on the Hive blockchain.** Any Hive account you control works; a dedicated one
   is cleaner, e.g. `autovote.app`. This account is the OAuth client identity.

2. **Register the app at https://hivesigner.com/profile** (log in as that account → app /
   developer settings), setting:
   - **Redirect / callback URI:** `https://auto.alpha.melek.salon/hivesigner/callback`
     (add the mainnet `https://auto.melek.salon/hivesigner/callback` later).
   - **Allowed operations / scopes:**
     - **`vote`** — for the **autovote** bot (the only op it needs).
     - **`market`** + **`transfer`** — for the **trade** bot (HIVE-Engine market ops + transfers).

3. HiveSigner issues a **client secret** for the code → token exchange. Keep it private — it
   goes in the env only, **never in this repo.**

## Env vars to set (on the host service env, never committed)

```
HIVESIGNER_APP=autovote.app                                            # the registered app account
HIVESIGNER_SECRET=<client secret from hivesigner.com>                  # private; env only
HIVESIGNER_CALLBACK=https://auto.alpha.melek.salon/hivesigner/callback # must match the registration
HIVESIGNER_SCOPE=vote                                                  # autovote default; trade requests market,transfer per-call
# HIVESIGNER_BASE=https://hivesigner.com                               # optional: self-hosted hivesigner-api later
```

`isConfigured()` is `true` only when **both** `HIVESIGNER_APP` and `HIVESIGNER_SECRET` are set
(no secret → no token exchange → the whole path stays inert).

## Verify

```
node integrations/hivesigner-auth.mjs    # prints { configured, app, callback, scope, secretPresent }
node --test integrations/hivesigner-auth.test.mjs
```

When `configured` reads `true`, the OAuth login/callback routes activate. The scope shown for
autovote is `vote`; the trade bot passes `scope: ['market','transfer']` to `authorizeUrl(...)`
per authorization.

## Key-custody guarantee

This module never holds, reads, requests, or returns a WIF private key. It only ever handles an
**opaque, scope-limited, user-revocable** bearer token. See `MELEK_SIGNER.md` (broadcast-boundary
philosophy) and `BRIEF.md` §7 (key custody). The existing live autovote signing path in
`autovote/` is untouched — this is an additive, parallel module.

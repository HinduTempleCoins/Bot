# MELEK signup providers — the vendor-picker

MELEK does **not** run a single signup backend. "Get a MELEK account" opens a **vendor-picker**: a list
of independent account-creation flows. The user picks one; that provider's flow takes over. This is the
Ecency / LEO-on-Hive pattern — security comes from inheriting audited third-party flows, not from one
monolithic backend. (See the condenser `CLAUDE.md` → "Signup architecture".)

The registry lives in [`signup/providers.mjs`](./providers.mjs). The signup server serves it at
`GET /api/providers`, and the picker page (`site/alpha/account/get-started.html`) renders it.

## Providers today

| id | chain | status | what it is |
|---|---|---|---|
| `melek-email` | MELEK | active | Official email signup (the rebranded BLURT-Plugin port → `signup.melek.salon`) |
| `hathor-guided` | MELEK | active | Hathor guides you in chat, then you sign up yourself (she never sees keys) |
| `melek-browser` | MELEK | active | In-browser account creator, no email required |
| `blurt-email` | BLURT | planned | Same flow pointed at BLURT |
| `steem-email` | STEEM | planned | Same flow pointed at STEEM |

## Add your own signup option

Anyone can offer a signup flow and have it listed. Open a PR adding an entry to the `PROVIDERS` array in
`signup/providers.mjs` (or, once the review queue is live, submit it for approval). Each entry:

```js
{
  id: 'acme-onboard',                 // kebab-case, unique
  name: 'ACME Onboarding',
  chain: 'MELEK',                     // target chain symbol
  url: 'https://onboard.acme.example/',// your https flow
  status: 'community',                // third parties use "community"
  badge: 'Community',
  maintainer: 'ACME Labs',           // who runs it — users see who they trust
  summary: 'One-tap MELEK signup with SMS backup.',
  custody: 'Keys are generated in the user\'s browser; no password is ever transmitted.',
}
```

### Hard rules for any listed provider

1. **Keys are generated in the user's browser.** The provider never receives a private key or master
   password in plaintext. The `custody` field must state this plainly; a community submission without a
   truthful custody statement is rejected.
2. **Correct chain.** The flow must create the account on the chain named in `chain` and never silently
   broadcast against a different one.
3. **No surprise data collection.** Personal-info intake at signup is out of scope (BRIEF.md §6); email
   is the only verification channel and is optional.
4. **`active`/`community` need a working `https://` URL.** `planned` entries may omit it.

`validateProvider()` in `providers.mjs` enforces the well-formedness checks; a human reviews the custody
claim and the flow itself before a `community` provider goes live.

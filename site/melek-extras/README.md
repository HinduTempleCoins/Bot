# melek-extras

Framework-free scripts the condenser's page shell loads on every melek.salon page.
Deployed to `/var/www/melek-extras/` on the web box; Caddy serves each at its own path
with `Cache-Control: no-cache`, so a redeploy reaches users immediately.

| file | served at | what it is |
|---|---|---|
| `melek-extras.js` | `/melek-extras.js` | cookie notice, report button, creation tools, category picker, help links, profile picture, heading anchors, the unclaimed-rewards bubble |
| `melek-chain.js` | `/melek-chain.js` | the fork-patched blurtjs, bundled for the browser (build artifact — see below) |

## Why `melek-chain.js` is built here

`@blurtfoundation/blurtjs` ships a prebuilt `dist/blurt.min.js`, but that build **predates the
MELEK patches** in its own `lib/` (July build, September patches). The published bundle therefore
serialises `claim_reward_balance` with BLURT's shape and a Steem-fork node rejects it. This bundle
is built from the patched `lib/` in the condenser's `node_modules`, so it carries the three-asset
form the chain actually accepts.

Rebuild (on the web box, where the patched blurtjs lives):

```sh
cd /root/melek-signer-lib
NODE_ENV=production node /opt/melek-bot/condenser/node_modules/webpack/bin/webpack.js \
  --config webpack.config.js
cp dist/melek-chain.js /var/www/melek-extras/melek-chain.js
```

`entry.js` and `webpack.config.js` here are that build's inputs.

## The claim op, and the trap in it

blurtjs declares `claim_reward_balance` with **BLURT's two-asset param list**
(`["account", "reward_blurt", "reward_vests"]`). This chain is a Steem fork and the op carries
**three** assets. The positional helper `broadcast.claimRewardBalance(...)` therefore silently
drops `reward_steem`, the signed bytes come up one asset short, and the node rejects the
transaction. Someone had already patched the *serializer* and left the *param list* alone, so it
looked correct and was not.

Use the object form, which bypasses the mapping entirely — it is what the condenser itself uses
and the shape the chain has accepted:

```js
MelekChain.broadcast.send(
  { extensions: [], operations: [['claim_reward_balance', {
      account, reward_steem, reward_sbd, reward_vests }]] },
  { posting: wif },
  cb
)
```

Proved on mainnet: hathor `8338f3d5` (8,621 MELEK), vankushfamily `92524c71` (97.296 MELEK).

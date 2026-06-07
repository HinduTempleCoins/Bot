# Akasha Wallet — Design Brief

**Status:** design + positioning (rev. 2026-06-07). The wallet itself is built in a separate
repo; this doc states its role, custody rules, and how it relates to the pool wallet, the
MELEK-Signer, and the pool fee → Hathor. Public-safe — no hostnames, addresses, or keys.

**Companion docs:** `BRIEF.md` (founding brief — load-bearing), `MELEK_SIGNER.md` (how Hathor
itself signs; same zero-WIF custody rule, different actor), `pool/README.md` (the mining pool +
its "Pool fee → Hathor" section), `CLAUDE.md` §Key custody.

**One-line summary:** Akasha is the ecosystem's **one wallet** — the MELEK/PRANA world's
MetaMask / TronLink / Phantom. One self-custody wallet that works across the pool, the
condenser, the engine, and the chains, holding the keys **client-side only**; no private key,
seed, or WIF ever lives on a server.

---

## 1. Role — one wallet for the whole ecosystem

Today a user needs a different wallet for each surface: a Monero address to mine with, a
Graphene key to post and vote, an EVM address for the PRANA/engine side. Akasha is the single
wallet that spans **all** of them, the way MetaMask spans every EVM chain or Phantom spans the
Solana ecosystem:

- **Pool** — the payout/receive address you mine to.
- **Condenser** — the posting/active keys you log in, post, and vote with.
- **Engine** — the side-token (Hive-Engine-style) balances and transfers.
- **Chains** — MELEK and SOAP (Graphene) plus PRANA (EVM), under **one identity**.

When PRANA is up it lives at **akasha.soapbox.community** as the full app. Until then, the
wallet already built into the pool frontend (`pool/www/wallet/`) is **its seed** — the same
client-side key-generation and address model, embedded in the pool page so a miner can make a
wallet on the spot. The standalone Akasha app grows out of that seed; they share the design.

## 2. Two tracks, one identity

Akasha speaks **two cryptographic tracks under one identity**, routed per-chain:

- **EVM track** — PRANA (the value/compute L1) and any EVM bridge targets. Standard BIP-39/32/44
  HD derivation; one address shared across EVM chains, the MetaMask model.
- **Graphene track** — MELEK and SOAP (the social chains). The four standard WIF role tiers
  (posting / active / owner / memo); **login uses posting only**, never active or owner.

One master secret deterministically derives both subtrees. The wallet routes each operation to
the right track by chain. It uses **standard chain operations only** on the Graphene side
(`comment`, `vote`, `transfer`, `custom_json`, `account_update`) — **no custom AI ops**, in
keeping with the repo-wide rule that the chain stays standard Graphene.

## 3. Custody rules (the hard boundary)

Akasha is **self-custody**. These rules are non-negotiable and mirror `MELEK_SIGNER.md` and
`BRIEF.md` §7:

- **Keys are generated and held client-side, in the browser/app, only.** A private key, seed
  phrase, or WIF is **never transmitted to any server, never stored server-side, never logged.**
- **The pool never needs a spend key.** Mining uses only your *receive* address (the stratum
  username). A compromised miner cannot drain funds, because mining never touches the spend key.
- **Zero WIF on servers, by construction.** No server in this ecosystem holds a user's private
  key. The signer is the *only* key boundary, and for the Witness's own keys that signer is the
  separate **MELEK-Signer** service (see below) — not this repo, not the Bot host.
- The user is responsible for their own seed backup ("save your passwords" — see §4). The
  ecosystem stores nothing it could lose or leak.

## 4. Relationship to the pool wallet and MELEK-Signer ("save your passwords" sequencing)

Three things are easy to confuse; they are distinct:

| Thing | Whose keys | Where | What it is |
|---|---|---|---|
| **Pool wallet** (`pool/www/wallet/`) | the **user's** | client-side, in the pool page | the in-page seed of Akasha — make a receive address, mine to it |
| **Akasha wallet** (akasha.soapbox.community, w/ PRANA) | the **user's** | client-side, in the app | the full one-wallet-for-everything app the pool wallet grows into |
| **MELEK-Signer** (separate private repo) | **Hathor's** (the Witness) | a hardened signer service, KMS-tied | how *the Witness account* signs its own ops; never holds user keys |

**Sequencing — "save your passwords" comes first.** The build order (operator directive
2026-06-06) is: **Mist Wallet + PRANA testnet first, then the signer.** Akasha is the wallet
that lets every user **save their own passwords/seed** across the pool, condenser, engine, and
chains; that user-facing wallet lands before the Witness-side MELEK-Signer ("save your
passwords across pool / wallet / condenser") is wired in. The signer is a *later* layer and is
about **Hathor's** keys, not the user's — the two never share custody.

## 5. Fee routing — to Hathor, not PRANA

The mining pool charges one small fee, and it routes to **Hathor**, the founding AI Witness —
**not to PRANA.** PRANA *is* the pool, so a "fee to PRANA" would be meaningless; the fee
supports the founding Witness and may become part of the **DAO** later. Akasha surfaces this
honestly wherever it shows pool stats; the canonical disclosure lives on the public `/fees`
page and in `pool/README.md` (the "Pool fee → Hathor" section). This off-chain pool fee is
separate from any PRANA chain-level reward routing.

## 6. What this repo does and does not hold

- This (Bot) repo holds **no wallet keys, no signer, no seed** — only descriptors and the
  read-only/positioning surfaces (the pool frontend's client-side wallet seed, the public
  `/wallet` and `/fees` disclosures, and the chain-descriptor registry Akasha reads to agree on
  `logical chain → { track, chain id, address format, symbols }`).
- The Akasha app and its signer live **outside** this repo. The Bot side is adapter and
  documentation only, and it signs nothing.
</content>
</invoke>

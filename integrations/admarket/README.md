# MELEK Ad Market — our own ad-selling system, paid in our own tokens

Advertisers buy ad inventory on our surfaces (law / stocks / wiki / …) and pay in **MELEK / APIS / PRANA /
KULA** — not Google, not a third party. This is both **revenue** and a **token-demand sink**: every campaign
locks our tokens into escrow and draws them down as ads serve.

> Status: **design + scaffold, offline-tested, NOT deployed.** No real payments, no broadcast, zero WIF.
> This directory is the off-chain core; it holds no keys and moves no money on its own.

## What it reuses (built on what already exists)

- **`integrations/soapbox/ad-slot.mjs`** — the slot component. Extended with an `opts.ad` / `opts.adHtml`
  seam so it renders OUR sold/house ads when AdSense is off (backward-compatible; the existing 13 tests pass).
- **`integrations/analytics-collector.mjs`** + the `ad_impression`/`ad_click` beacon — measurement. The sold
  unit renders inside the same `.ad-slot[data-ad-placement]` wrapper the tracker already watches, so aggregate
  impressions/clicks are measured with zero new client code. Exact **per-campaign** billing is done server-side
  (`/serve` meters impressions, `/click` meters clicks before redirecting).
- **`engine/lib/op-builder.mjs` pattern** — APIS payments are the same `custom_json` `tokens.transfer` envelope.
- **`src/chain/melek-signer-client.mjs` posture** — funding/refund are **unsigned intents**; signing happens in
  the advertiser's own wallet or via MELEK-Signer, off this host.

## Files

| File | Purpose |
|---|---|
| `pricing.mjs` | Payable tokens + precision, BigInt CPM/CPC math, budget→units, **honest inventory** (measured traffic; never oversell). |
| `model.mjs` | Campaign store + state machine + budget **drawdown** + `pickAd` for a slot. In-memory (tests) / JSON-file (prod). |
| `payments.mjs` | **Unsigned** token-payment intent builders — funding (advertiser→escrow) + refund (escrow→advertiser). Zero-WIF. |
| `serve.mjs` | The ad-serve half: render a sold/house unit, `serveSlot` (pick+meter+render), `meterClick`. |
| `server.mjs` | HTTP: self-serve advertiser API + operator approval + `/serve` + `/click`; advertiser + operator dashboards. |
| `*.test.mjs` | 45 offline tests: lifecycle, drawdown, slot serving, unsigned intent building, gating. |

## 1 — The model (self-serve ad platform)

An advertiser creates a **campaign**: creative (`headline`/`body`/`url`) + target `placement` (`law-top`) +
`model` (`cpm`|`cpc`) + `rate` + `budget`, paying in a supported token. Pricing is **CPM** (per 1,000
impressions) or **CPC** (per click), quoted in tokens; all money is BigInt base units (no float). Inventory is
**honest** — we sell against real, measured pageviews (audited traffic table + live analytics), and quote the
monthly-impression ceiling rather than inventing traffic.

## 2 — The token-payment hook (settlement)

```
advertiser ──(1) buildFundingIntent → UNSIGNED deposit op (memo "adcampaign:<id>")
           ──(2) signs in own wallet (dhive / MetaMask / MELEK-Signer) → broadcasts → ESCROW
operator   ──(3) verifies the deposit landed on-chain → confirmFunding(ref) → campaign ACTIVE
serving    ──(4) each impression/click draws the escrowed budget down → exhausted at budget
operator   ──(5) buildRefundIntent → UNSIGNED payout of any unspent budget → advertiser
```

Per-token rail (`pricing.TOKENS.chain`): **MELEK** → graphene `transfer`; **APIS** → engine `custom_json`
`tokens.transfer`; **PRANA/KULA** → EVM ERC-20 `transfer(to,amount)` calldata. The `adcampaign:<id>` memo binds
a deposit to its campaign for reconciliation. **Zero-WIF:** every builder returns `requiresSignature:true` and
signs nothing. Escrow destinations come from env-by-name (`AD_ESCROW_ACCOUNT` / `AD_ESCROW_EVM` +
`<TOKEN>_TOKEN_ADDRESS`); unset ⇒ funding fails cleanly (nothing to pay into yet). Settlement is
operator/signer-gated — nothing auto-broadcasts.

## 3 — Advertiser + operator UX

- **Advertiser (self-serve, `GET /`):** honest inventory table → create campaign → receive the unsigned
  funding intent to sign → track spend/impressions/clicks via `GET /api/campaigns`.
- **Operator (`GET /admin`, `AD_ADMIN_TOKEN`-gated):** review queue → **approve/reject the creative** (before
  any money moves) → **confirm** the verified deposit → campaign goes live; pause/resume/end + refund.

The open create endpoint is safe: a new campaign is `pending_review` and cannot serve until the operator both
approves the creative and confirms a real deposit — no human, no serving, no charge.

## 4 — Phased plan

1. **House ads now.** `serve.mjs` fills every slot with our own promos (signup / witness / engine / pool) for
   free — slots are never empty, and we warm/measure real inventory before selling a thing. (Live-ready today.)
2. **Sold ads, paid in tokens.** Operator hand-creates campaigns for a first advertiser, takes the deposit in
   MELEK/APIS/PRANA/KULA, confirms it, ads serve + draw down, unspent refunded. First real token revenue + sink.
3. **Self-serve.** Open `POST /api/campaigns`, wallet-signed funding, operator approval queue — advertisers run
   themselves.

## Run / test

```bash
node integrations/admarket/server.mjs           # bind AD_MARKET_PORT (default 8791)
node --test integrations/admarket/*.test.mjs    # 45 offline tests
node integrations/admarket/pricing.mjs           # per-module offline demos
```

Env: `AD_MARKET_PORT`, `AD_ADMIN_TOKEN` (operator), `AD_STORE_FILE` (JSON persistence), `AD_CLICK_BASE`,
`AD_ESCROW_ACCOUNT` (MELEK/APIS), `AD_ESCROW_EVM` + `PRANA_TOKEN_ADDRESS`/`KULA_TOKEN_ADDRESS` + `PRANA_CHAIN_ID`.

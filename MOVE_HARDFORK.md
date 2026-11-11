# The MELEK Drive hardfork — drive-and-earn, and MELEK Ride

**Status (2026-11-11):** off-chain half **built and tested**; chain half **written, not compiled, not
deployed**. Nothing in here has produced a paid mile yet. Read §5 before reporting any of it as live.

MELEK Move already pays **walking**: 15% of block emission goes to a chain-level `"move"` reward fund,
and each closed hour the attester broadcasts one `move_pay` op carrying that hour's walk-weights, which
the chain splits pro-rata from a capped draw straight to walkers' liquid balances (the "HF25" flip).

This document specifies the second lane — **MELEK Drive** — and the app built on top of it, **MELEK
Ride**.

- **MELEK Drive** pays a driver for miles, whoever they are driving for. It is framed, and meant, as
  **gas money**: the MELEK your miles earn goes back in the tank.
- **MELEK Ride** is the rideshare app: riders request, approved drivers accept, the rider signs the
  fare. A MELEK Ride trip is also the only drive sample we can *verify*, so it is worth more per mile.

---

## 1. Where the money comes from — Drive gets its own pool

**Operator, 2026-11-11: the drive lane is not the MELEK Move pool.** It is funded by hardforking further
emission into a reward fund of its own, from elsewhere in the split. So the walk lane is left exactly
as it is, and MELEK Drive gets a second chain-level fund, `"drive"`.

The split after HF24 is content 50 / **move 15** / vesting 15 / witness 10 / **proposal (SPS) 10**. At
the Drive flip, the proposal fund's ten points become the drive fund's ten points:

| Slice | Before | After the flip |
|---|---|---|
| content (blog) | 50% | 50% |
| move (walking) | 15% | **15% — unchanged** |
| vesting (stakers) | 15% | 15% |
| witness (block pay) | 10% | 10% |
| proposal → treasury | 10% | **0%** |
| **drive (driving)** | — | **10%** |

Nothing is taken from bloggers, stakers, block producers or walkers. What changes is that a
*discretionary treasury carve becomes an automatic, distributed driver reward*. At a flat 1.000
MELEK/block and 21,600 blocks/day:

```
0.10 × 1.000 × 21,600 = 2,160.000 MELEK/day = 90.000 MELEK/hour
```

so the per-epoch drive cap is **90.000** — exactly the drive fund's own inflow, which is why that fund
can neither be drained by a full hour nor grow without bound. The walk lane keeps its 15% inflow and
its 150.000 cap.

**This is the one number to confirm before it ships.** Taking it from the proposal fund is the choice
with the least collateral damage — it is operator-controlled spend either way, and it leaves chain
security and everybody's pay untouched — but it is a choice, and the operator may want the carve bigger
or sourced differently. Moving it is `MELEK_DRIVE_FUND_PERCENT` plus the matching reduction in
`process_funds`, with the cap kept equal to whatever inflow those two imply. Nothing is deployed, so
this is still free to change.

## 2. The chain change

Three files in the chain tree, all following the `move_pay` precedent exactly:

**`libraries/protocol/include/steem/protocol/config.hpp`**

```c
#define MELEK_DRIVE_ATTESTER_PAY_TIME    1796083200           // 2026-12-01T00:00:00 UTC
#define MELEK_DRIVE_ATTESTER             ("moveoracle")       // ACTIVE authority that signs drive_pay
#define STEEM_DRIVE_REWARD_FUND_NAME     ("drive")            // the drive lane's OWN reward fund
#define MELEK_DRIVE_FUND_PERCENT         (10*STEEM_1_PERCENT) // 10% of emission, from the proposal carve
#define MELEK_DRIVE_EPOCH_PAY_CAP_AMOUNT (int64_t( 90000 ))   // 90.000 MELEK/epoch (= its own inflow)
```

**`libraries/chain/database.cpp`** — in `process_funds`, past the gate: the proposal slice goes to zero,
a `drive_fund` slice of `MELEK_DRIVE_FUND_PERCENT` is taken in its place, the `"drive"` reward fund is
created on the first block past the gate (deterministic — every node creates it at the same block,
mirroring how the Move fund was created at the HF24 apply) and credited each block, and `drive_fund` is
added to the supply totals. The witness residual is unchanged, because ten points simply moved from one
non-witness slice to another.

**`libraries/chain/include/steem/chain/global_property_object.hpp`** — a second monotonic guard,
`uint32_t last_drive_pay_epoch = 0`, appended to the object and to its `FC_REFLECT` list (same shape as
`last_move_pay_epoch`, so the same replay story).

**`libraries/chain/steem_evaluator.cpp`** — a `drive_pay` block beside the `move_pay` one:

1. require the drive attester's **ACTIVE** authority in `required_auths` (never a posting key — this op
   moves value);
2. parse `{ "epoch": <uint32>, "pay": [ ["acct", <weight> ], … ] }`;
3. assert `epoch > dgpo.last_drive_pay_epoch` (its own guard, independent of walking);
4. sum the weights in `uint128`;
5. draw `min(MELEK_DRIVE_EPOCH_PAY_CAP_AMOUNT, fund balance)` from the `"drive"` fund — and refuse the
   op outright if that fund does not exist yet, rather than reaching into another lane's money;
6. credit each driver `draw × w / total` to **liquid** balance, skipping unknown and zero rows rather
   than failing the batch;
7. deduct exactly what was paid and advance the guard.

The walk lane's `move_pay` path is not modified at all.

Everything is a pure function of on-chain state plus the signed op, gated on block time, so every node
flips together. No new operation type, no new fund, no new hardfork number.

## 3. The off-chain half

| Path | What it does |
|---|---|
| `integrations/games/drive-economy.mjs` | the walk/drive/impossible classifier, the per-mile drive-weight, the drive fund's own cap/inflow, and the gas arithmetic |
| `integrations/games/drive-ledger.mjs` | the hourly drive ledger, `buildDrivePay`, `settleDriveEpoch` |
| `integrations/games/drive-settle-run.mjs` | the box runner that broadcasts one `drive_pay` per closed hour |
| `site/move-miner/server.mjs` | the MELEK Drive card + `POST /api/drive`, `/api/drive-standing`, `/drive-economy`; mounts MELEK Ride at `/ride` |
| `site/melek-ride/ride-core.mjs` | applications, matching, fares, the trip state machine, the market board |
| `site/melek-ride/server.mjs` | the MELEK Ride HTTP surface and page |

**What a sample must survive to be paid.** A phone cannot tell a car from a bicycle from a train, and
this does not pretend to. It bounds the claim instead: under 8 mph it belongs to the walk lane (where
steps already pay it); over 95 mph no car on a road produced it, so it earns nothing; a single account
cannot bank more than 95 miles in one hour however many samples it sends; and each further sample in
the hour diminishes. Those four bounds are the whole anti-cheat story, and they are deliberately
arithmetic rather than a judgement about a driver.

**Verified beats self-reported.** A completed MELEK Ride trip files `source: 'ride'` and earns a 1.5×
weight boost. A typed-in "I drove a rideshare shift" files `source: 'shift'` and earns 1.0×. The
asymmetry is not about Uber or Lyft; it is that one of those two is a record this system can check.

**The gas figure is arithmetic, not a slogan.** `gasEquivalent()` converts MELEK → USD → gallons →
miles-of-gas and is labeled theoretical, because it is derived from a price someone supplied. With no
`MELEK_USD` set it returns `null` for every dollar field and says so. MELEK has no market price; the
app does not invent one.

## 4. MELEK Ride

**Two onboardings, on purpose.** A **rider** makes a MELEK account — that is the entire signup. A
**driver** applies: make, model, year, colour, plate, licence number and state, insurer, policy number
and expiry, reviewed by a human before they are ever shown to a rider. Only `approved` can go online or
accept. `RIDE_AUTO_APPROVE=1` exists for a staged launch and is off by default.

That application is the only personal information the system holds. It stays off-chain, never enters a
post, an op or a memo, and is served only to the driver themselves and to the reviewer queue.

**The fare is non-custodial.** We hold no rider key, so we cannot charge anyone. A finished trip
produces a **payment intent** — one transaction, two transfers, rider → driver and rider → the fee
account — that the rider signs. The trip closes only when an injected verifier confirms the transaction
on-chain; with no verifier wired it stays `awaiting_payment` rather than being marked paid on a
client's word. No escrow account exists, so there is nothing to drain.

**The revenue line** is `RIDE_FEE_PCT` (default 10%) of every completed fare, to `RIDE_FEE_ACCOUNT`
(default `hathor`), collected as the second transfer in the rider's own transaction. A fare of 17.000
MELEK pays the driver 15.300 and the platform 1.700.

**A driver earns three ways while online, and the app shows all of them.** The fare comes from the
rider. The **distance lane** pays for the miles. And because a driver's phone is a phone in a moving
vehicle, the Drive app also does the **geolocation mining** — it claims the reward zone under the car on
the same `/api/geomine` a walker uses (with no step boost), so a driver banks zones along the route too.
The driver pane polls every two minutes while online: heartbeat, zone claim, miles filed, earnings
refreshed. MELEK Move itself now carries an **Earn for Driving** option beside the walking one, with a
single panel showing both lanes' projected MELEK and their total — the two ways of earning read as one
balance, which is what they are.

**When nobody is driving nearby, the rider is told where the nearest driver *is*.** `coverage()`
escalates: their area (15 mi), their region (150 mi), their state, their country, anywhere. A rider in
Dallas with the only driver in El Paso is told "no drivers near you, 1 online in TX, none within 150
miles" — not left watching a spinner. With nobody online at all it says so plainly and points at the
Drive tab, because a two-sided market has to admit which side it is short of. Counts and distances
only; never a driver's position. A driver's state/country comes from their application (defaulting to
the licence's state), which is a reasonable first guess and labeled as one.

**The market board** (`/ride/api/market`) publishes drivers online, riders looking, requests open and
trips running — globally and within the match radius. Counts only: no account names, no positions. A
two-sided market fails quietly when each side assumes the other is empty, so both sides see the same
number.

**Three store apps, one website.** On the web MELEK Ride is a **tab of MELEK Move** at `/ride` — one
site, one sign-in. In the stores it is three listings (`apps/move`, `apps/ride`, `apps/ride-driver`):
MELEK Move is a Health & Fitness listing and cannot carry a transport app that takes payments, the
rider app needs foreground location while the driver app needs background location, and a rejection of
one should not take down the others. A **USD card rail is not built** — it is the reason the rider
listing is separate, and `rideSummary().paymentRails.usdCard` says `not wired` rather than implying
otherwise.

## 5. What is actually done, and what is not

**Built and verified (`node --test`, offline):** the drive economy and ledger (20 tests), the ride
engine including coverage (30 tests), the ride HTTP surface (15 tests), the Move app's drive lane, the
two-lane earnings panel and the `/ride` mount (9 added tests). The full repo suite runs green with all
of it in: **19,136 tests, 0 failures**. Two real defects were caught by those tests and fixed: a null sample threw instead of
soft-failing, and a missing `lat`/`lng` coerced to 0,0 — a real point in the Atlantic — instead of
being refused.

**Written, not proven:** the C++ above. It has not been compiled; the chain tree it was written against
is a working copy on this machine, not the chain host, and this repo does not build or run
`witness_node`. Shipping it means applying it on the chain host, building there, and running the
`drive_pay` path on the testnet first.

**Not built at all:** the USD card rail; the on-chain fare verifier for `/ride/api/confirm` (the seam
exists and refuses to mark trips paid without it); the box timer for `drive-settle-run.mjs`; the
`moveoracle` attester's handling of the second lane; any international compliance work.

**Order to make it real:**

1. Apply the chain patch on the chain host, build, deploy to the **testnet**, and settle a `drive_pay`
   hour — the first evidence worth reporting.
2. Wire the fare verifier, then run one real trip end to end with a real signed fare.
3. Timer for `drive-settle-run.mjs` beside the existing move settle timer (same JIT-key rule: the
   attester's active key comes from the vault per run, never to disk).
4. Then the store listings, one metro at a time.

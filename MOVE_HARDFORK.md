# The MELEK Drive hardfork — drive-and-earn, and MELEK Ride

**Status (2026-11-12):** off-chain half **built and tested**; chain half **written, not compiled, not
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
emission into a reward fund of its own, from elsewhere in the split. **Operator, 2026-11-12: "We are
going to take some of the Mining Rewards for Driving,"** then **"Keep like 3% in the DAO."** So the walk
lane is left exactly as it is, MELEK Drive gets a second chain-level fund, `"drive"`, carved from two
places — most of the proposal/SPS carve and half the mining (block-producer) slice — and the DAO keeps
a permanent 3% endowment.

The live split, read off the chain today (`content_reward_percent` 5000, `vesting_reward_percent` 1500,
`sps_fund_percent` 1000, the Move fund's 15% from HF24, witness the residual):

| Slice | Now | After the flip |
|---|---|---|
| content (blogging) | 50% | 50% |
| move (walking) | 15% | **15% — unchanged** |
| vesting (stakers) | 15% | 15% |
| witness (mining / block pay) | 10% | **5%** |
| proposal → the DAO (`@melek.dao`) | 10% | **3%** |
| **drive (driving)** | — | **12%** |

Nothing is taken from bloggers, stakers or walkers. Two things change: *most of a discretionary
treasury carve becomes an automatic, distributed driver reward*, and *half the block-producer reward is
redirected to the people driving*. The DAO keeps 3% — **648.000 MELEK/day, 27.000/hour** — and the
balance already sitting in `@melek.dao` is not touched by the flip; only the rate it grows at changes.
At a flat 1.000 MELEK/block and 21,600 blocks/day:

```
0.12 × 1.000 × 21,600 = 2,592.000 MELEK/day = 108.000 MELEK/hour
```

so the per-epoch drive cap is **108.000** — exactly the drive fund's own inflow, which is why that fund
can neither be drained by a full hour nor grow without bound. The walk lane keeps its 15% inflow and
its 150.000 cap.

The mining slice is **not a third constant**: `process_funds` pays the witness the residual, so setting
the proposal fund to 3 and taking 12 points for drive leaves exactly 5 points for mining, and the five
slices cannot stop summing to 100%. Resizing the drive lane is `MELEK_DRIVE_FUND_PERCENT` plus the
matching cap; mining absorbs the difference automatically.

**What this costs the chain's security budget:** block pay halves, from 0.100 to 0.050 MELEK per block
(2,160 → 1,080 MELEK/day across 21 slots). The witnesses carrying that cut are, today, almost entirely
the operator's own. Vesting rewards — the other thing a staking witness earns — do not move.

## 2. The chain change

Three files in the chain tree, all following the `move_pay` precedent exactly:

**`libraries/protocol/include/steem/protocol/config.hpp`**

```c
#define MELEK_DRIVE_ATTESTER_PAY_TIME    1796083200           // 2026-12-01T00:00:00 UTC
#define MELEK_DRIVE_ATTESTER             ("moveoracle")       // ACTIVE authority that signs drive_pay
#define STEEM_DRIVE_REWARD_FUND_NAME     ("drive")            // the drive lane's OWN reward fund
#define MELEK_DRIVE_FUND_PERCENT         (12*STEEM_1_PERCENT) // 12%: 7 points of proposal + 5 of mining
#define MELEK_DAO_FUND_PERCENT           ( 3*STEEM_1_PERCENT) // the DAO keeps 3% of emission
#define MELEK_DRIVE_EPOCH_PAY_CAP_AMOUNT (int64_t( 108000 ))  // 108.000 MELEK/epoch (= its own inflow)
```

**`libraries/chain/database.cpp`** — in `process_funds`, past the gate: the proposal slice becomes
`MELEK_DAO_FUND_PERCENT` (3%), a `drive_fund` slice of `MELEK_DRIVE_FUND_PERCENT` (12%) is taken — seven
of those points from the proposal carve and five out of the witness residual, which is where the mining
cut comes from — the `"drive"` reward fund is
created on the first block past the gate (deterministic — every node creates it at the same block,
mirroring how the Move fund was created at the HF24 apply) and credited each block, and `drive_fund` is
added to the supply totals. The witness residual drops from ten points to five — that is the mining
reward the operator redirected into driving.

**`libraries/chain/include/steem/chain/global_property_object.hpp`** — a second monotonic guard,
`uint32_t last_drive_pay_epoch = 0`, appended to the object and to its `FC_REFLECT` list (same shape as
`last_move_pay_epoch`, so the same replay story).

**`libraries/chain/steem_evaluator.cpp`** — a `drive_pay` block beside the `move_pay` one:

1. require the drive attester's **ACTIVE** authority in `required_auths` (never a posting key — this op
   moves value);
2. parse `{ "epoch": <uint32>, "pay": [ ["acct", <weight> ], … ] }`;
3. assert `epoch > dgpo.last_drive_pay_epoch` (its own guard, independent of walking);
4. sum the weights in `uint128`;
5. draw `min(MELEK_DRIVE_EPOCH_PAY_CAP_AMOUNT, fund balance)` (108.000) from the `"drive"` fund — and refuse the
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
| `site/melek-ride/ride-core.mjs` | applications, matching, fares, the trip state machine, the market board, the rider's walk credit |
| `site/melek-ride/server.mjs` | the MELEK Ride HTTP surface and page |
| `integrations/melek-dao.mjs` | DAO membership: eligibility from the Instructions, the roll, the on-chain seat record |
| `site/tutorial/server.mjs` | the Instructions page + the DAO surface (`/dao`, `/api/dao/*`) |

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

**A rider's trip counts as distance they covered.** Operator, 2026-11-12: *"Maybe getting a Ride Counts
as Walking Distance also."* It does — a completed, payment-verified trip files a walk-lane claim for the
**rider**, through the same `stepBoost` curve a walker's steps use and out of the same `"move"` pool, so
it simply shows up in their MELEK Move earnings. Riding is not walking, so it is credited at a fraction
and bounded: `min(miles, 25) × 2,000 steps/mi × 25%`. A 10-mile ride is worth 5,000 step-equivalents (a
2× boost); the 25-mile cap tops out at 12,500 (3×), against a 50,000-step walker's 15×, so **no ride can
out-earn walking**. Repeat rides inside one hour diminish exactly like repeat zone claims. The
anti-farm property is the fare itself: this claim only exists because somebody was paid for the trip,
on-chain, which makes it the one distance claim in the system that cannot be invented — and paying a
10% platform fee to farm walk weight is self-defeating. It is also why `stepBoost`/`diminishFor` moved
out of the Move server into `move-economy.mjs`: two lanes pay into that curve now, and two copies of a
reward curve drift apart.

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

## 4a. The DAO, and how a seat in it is earned

**Operator, 2026-11-12: "Keep like 3% in the DAO, and we need to Build the DAO into the Hathor
Instructions where People can become Part of it by Finishing all the Instructions."**

`@melek.dao` is `STEEM_TREASURY_ACCOUNT` — the chain's proposal fund. A share of every block goes to
it, anyone with a seat can propose a daily draw against it, stakeholders vote, and funded proposals are
paid at each maintenance interval. As of 2026-11-12 it holds **219,668.000 MELEK** (7.8% of the whole
supply) and **`list_proposals` has never returned a single proposal** — four months of accumulation
with nothing ever drawn. After the flip it keeps 3% of emission, permanently.

**A seat is earned, not bought.** `integrations/melek-dao.mjs` ties membership to finishing *every*
stage of the Hathor Instructions, and every one of those stages is detected from the chain by
`integrations/tutorial-progress.mjs` — an intro post, three substantive comments on three different
authors, a long-form post, an organic upvote from somebody who is not Hathor, a power-up, and a witness
vote. Nobody can self-report their way onto the roll.

Enrolment does two things and the module is explicit that they are the only two:

1. **The roll record** — a standard `custom_json` (`melek_dao_member`) broadcast by Hathor through
   MELEK-Signer with a *posting*-role token, so the roll is auditable by anyone rather than just
   readable on our page. No custom chain op, no active authority, no WIF on the web host. **A seat that
   could not be recorded is not granted** — a failed broadcast leaves the account off the roll so the
   next run retries.
2. **A vesting delegation** from Hathor, out of the 5–15 MP band it already delegates to new accounts,
   because *the DAO votes by stake* — a member holding no MELEK POWER has no voice in it, so the
   delegation is what makes a seat real rather than a badge. It needs the active authority, so it is
   **not wired by default**: the seat is granted and the delegation is reported as pending rather than
   silently claimed. A delegation that fails never costs someone a seat they earned.

The surface is on the Instructions page itself (`site/tutorial/server.mjs`): a card at the top saying
finishing them puts you in the DAO, `/dao` for the fund, the stages, the roll and what a seat gives,
and `/api/dao`, `/api/dao/membership?account=…`, `/api/dao/roll`, `POST /api/dao/enroll`.

## 5. What is actually done, and what is not

**Built and verified (`node --test`, offline):** the drive economy and ledger, the ride engine
including coverage, the ride HTTP surface, and the Move app's drive lane / two-lane earnings panel /
`/ride` mount — **tests re-run 2026-11-12** after the funding change to 12% + 3% DAO. The full
repo suite ran green with the whole feature in at **19,146 tests, 0 failures**. Two real defects were caught by those tests and fixed: a null sample threw instead of
soft-failing, and a missing `lat`/`lng` coerced to 0,0 — a real point in the Atlantic — instead of
being refused.

**Written, not proven:** the C++ above. It has not been compiled; the chain tree it was written against
is a working copy on this machine, not the chain host, and this repo does not build or run
`witness_node`. Shipping it means applying it on the chain host, building there, and running the
`drive_pay` path on the testnet first.

**Not built at all:** the USD card rail; the on-chain fare verifier for `/ride/api/confirm` (the seam
exists and refuses to mark trips paid without it); the box timer for `drive-settle-run.mjs`; the
`moveoracle` attester's handling of the second lane; any international compliance work.

**Read off the live chain, 2026-11-12 — what is NOT yet proven anywhere:**

- The walk lane has **never paid out**. `move_pay` has been live on mainnet since HF25
  (2026-10-07) and the attester `moveoracle` has broadcast **nothing** — its only two ops ever are its
  own creation and one incoming transfer. The Drive lane is a twin of a pipeline that has not run in
  production, so settling one real `move_pay` hour is the free rehearsal for all of this.
- `moveoracle` holds **0.000000 VESTS**, and no zero-vest account on this chain has ever broadcast an
  op. Whether it can sustain one `custom_json` per hour is untested; a small delegation from `hathor`
  (196.357300 VESTS) is cheap insurance before either lane settles.
- MELEK mainnet has **five power-up operations in its entire history** (largest from a user: 299.000),
  so nothing here has been stressed by real traffic yet.

**Order to make it real:**

1. Apply the chain patch on the chain host, build, deploy to the **testnet**, and settle a `drive_pay`
   hour — the first evidence worth reporting.
2. Wire the fare verifier, then run one real trip end to end with a real signed fare.
3. Install the hourly settle timer — the `drive-settle.service` / `.timer` / wrapper are written and
   staged (same JIT-key rule: the attester's active key comes from the vault per run, never to disk).
4. Then the store listings, one metro at a time.

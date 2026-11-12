# MELEK Ride Driver — driver app (Capacitor shell)

The driver half of MELEK Ride. Same website (`move.melek.salon/ride`), same MELEK account, **its own
store listing** — see `apps/ride/README.md` for why the three apps are separate.

The one capability this shell has that the rider shell does not: **background location**. A driver's
position has to keep updating with the screen off, which means a foreground service with a persistent
notification and a location-foreground-service declaration in Play Console.

## How a driver onboards — they apply

A rider just makes a MELEK account. A driver applies, and a person reviews it:

| Submitted | Field |
|---|---|
| Vehicle | make, model, year, colour, licence plate, seats |
| Licence | driver's licence number + issuing state |
| Insurance | insurer, policy number, expiry |

`POST /ride/api/driver/apply` → status `pending`. A reviewer (`RIDE_REVIEWERS`, default `hathor`) works
the queue at `GET /ride/api/admin/applications` and decides with `POST /ride/api/admin/review`
(`approved` / `rejected` / `suspended`). **Only an approved driver can go online or accept a trip** —
`driverOnline` and `acceptTrip` both refuse anything else, and a suspension drops a driver off the map
immediately.

`RIDE_AUTO_APPROVE=1` approves on submission. That is for a staged launch where the operator is the
only driver; it is off by default.

### The application data

It is the only personal information this system holds. It lives **off-chain** in the ride store and
nowhere else: never in a post, an op or a transfer memo, and never served to a rider. The licence and
insurance fields are returned by exactly two reads — the driver's own `/ride/api/driver/application`
and the reviewer queue — and `site/melek-ride/ride-core.test.mjs` asserts they appear in neither a
rider-facing read nor the market board.

## How a driver gets paid — three ways

1. **The fare**, from the rider, signed by the rider.
2. **The distance lane** — MELEK Drive, for the miles.
3. **The reward zones** — the Drive app does the geolocation mining too, claiming the zone under the car
   on the same endpoint a walker uses (no step boost). Operator directive: drivers do the geolocation
   mining through the Drive app.

The driver pane polls every two minutes while online — online heartbeat, zone claim, miles filed,
earnings refreshed — and shows both lanes' projected MELEK in one panel.

## The fare and the lane, in detail

1. **The fare.** The rider signs one transaction at the end of the trip: the driver's share straight to
   the driver's account, plus the platform fee. Non-custodial — we never hold the fare.
2. **The MELEK Drive lane.** The same trip's miles are filed as a **verified** drive sample, which earns
   a share of the chain's hourly drive cap (108.000 MELEK/hour from the chain's own "drive" reward fund — carved from the
   proposal fund plus half the mining reward — paid by the
   `drive_pay` op). A verified MELEK Ride trip is worth more per mile than a self-reported shift on
   somebody else's app, because this one can be checked.

That second one is the "gas money" half, and it pays whether or not the driver is on our app — but it
pays more when they are.

## Build (on a machine with the Android SDK)

```bash
cd apps/ride-driver
npm install
npx cap add android
# add a background-geolocation plugin + the foreground-service declaration before building
npx cap sync android
npx cap open android        # or: cd android && ./gradlew bundleRelease
```

## Before submitting

1. **Play Console → App content:** location foreground-service declaration (record the demo video of
   going online and taking a trip), Data safety (precise location, background), financial features
   (the driver is paid), privacy policy URL.
2. Background location is the part reviewers push back on: the justification is that a dispatched
   driver's position must update while the screen is off, and the persistent notification says so.
3. Driver payouts are in MELEK today. If a **USD payout** rail is added later it brings KYC on the
   payout side — that is a reason this listing stays separate, not a reason to put it in Move.
4. International driver/vehicle/insurance rules are **queued for research** (`QUEUE.md`).

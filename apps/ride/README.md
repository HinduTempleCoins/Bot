# MELEK Ride — rider app (Capacitor shell)

The rider half of MELEK Ride. The web app *is* the UI (`move.melek.salon/ride`, served by
`site/melek-ride/server.mjs`); this shell exists so there is a **store listing of its own**.

## Why this is a separate app from MELEK Move

Operator directive (2026-11-11): *a tab on MELEK Move, but not the same app in the store.*

On the web it is one site and one sign-in — MELEK Ride is a tab of MELEK Move, mounted at `/ride`. In
the **stores** it has to be its own listing, because:

- MELEK Move is a **Health & Fitness** listing whose declarations are a step counter and physical
  activity. A rideshare app does not fit inside that, and a rider app that later takes **USD cards**
  really does not — it brings a payments declaration, a refund/dispute policy and (depending on the
  country) a transport-service declaration.
- The rider app needs **foreground location only**. The driver app needs **background** location.
  Those are different permission stories and should not be argued in one review.
- A rejection of one listing then cannot take down the other two.

So: three listings, one website, one MELEK account.

| App | Listing | What it is | Shell |
|---|---|---|---|
| MELEK Move | Health & Fitness | steps, reward zones, MELEK Drive miles | `apps/move` |
| **MELEK Ride** | Travel & Local | **rider: request a ride, pay the fare** | `apps/ride` |
| MELEK Ride Driver | Travel & Local (or Business) | driver: apply, go online, take fares, get paid | `apps/ride-driver` |

## How a rider onboards

A MELEK account. That is the whole thing — no application, no documents. Account creation happens on
MELEK-Signer (`/signup`), and the rider signs in with it. Drivers are the ones who apply.

## Fares

The fare is quoted in MELEK from the rate card (`site/melek-ride/ride-core.mjs`) and **is not charged
automatically** — at the end of the trip the rider signs ONE transaction with two transfers (the
driver's share and the platform fee). MELEK Ride never holds a rider's key and runs no escrow account.

A **USD card rail is not built**. It is the obvious next thing a rider app needs and the reason this
listing is separate, but nothing here takes a card today; `rideSummary().paymentRails.usdCard` says so
rather than implying otherwise.

## Build (on a machine with the Android SDK)

```bash
cd apps/ride
npm install
npx cap add android
npx cap sync android
npx cap open android        # or: cd android && ./gradlew bundleRelease
```

## Before submitting

1. **Play Console → App content:** Data safety (precise location, used in-app, not sold/shared),
   financial-features declaration for the in-app token, privacy policy URL
   (`https://move.melek.salon/privacy`).
2. Account deletion is required and exists: `POST /api/delete-account` on the Move app, which erases
   the off-chain standing in **both** ledgers.
3. Do not reuse MELEK Move's fitness listing copy. This is a transport app; describe it as one.
4. International: driver/vehicle licensing and insurance rules differ per country and are **queued for
   research** (see `QUEUE.md`) — launch one metro first.

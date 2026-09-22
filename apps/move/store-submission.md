# MELEK Move — store submission: declarations + reviewer notes (copy-paste)

How we proactively tell Google + Apple what this app is, so it clears review. Pair with
`.local/MOVE_TOS_COMPLIANCE.md` (the policy checklist) and `apps/move/play-listing.md` (the public copy).

> ## CHANGED — MAINNET LAUNCH (reframed 2026-09-14). Every "testnet / no monetary value" sentence has
> been removed. The app now launches rewarding **mainnet MELEK**, so a "testnet, worthless token"
> declaration would be a **false statement to a reviewer** — an account-termination problem, not a
> listing problem. The protection is no longer "the token has no value"; it is **"the app is not a
> wallet"** — which stays true at any token price, forever.

**Core message to both stores:** fitness step-tracker + geo-explore game; rewards are paid in **MELEK,
the coin of the live MELEK mainnet**; **the app is NOT a wallet** — it never creates, holds, moves,
exchanges, or custodies cryptocurrency or keys, and does **no on-device mining** (no hashing/PoW on the
phone); **account and wallet creation happen outside the app, in the device browser, at melek.salon**;
activity data is never sold or shared.

---

## GOOGLE PLAY (Play Console)

### Declarations to complete (App content)
- **Financial features → Crypto / blockchain-based:** YES. Declaration (paste verbatim):
  > "App rewards users with MELEK, a blockchain token, for physical activity. **The app does not buy,
  > sell, exchange, transfer, or custody cryptocurrency and holds no private keys.** Rewards accrue to a
  > user's MELEK account. **Account creation, wallet creation, and any transfer or conversion take place
  > outside the app, in the device browser, at melek.salon.** The app performs no on-device mining (no
  > proof-of-work/hashing on the device)."
- **Foreground service → type: health:** declared; attach a 30–60s screen-recording of: open app → enable
  step counting (permission prompt) → steps increment while walking → claim a reward zone.
- **Data safety:** Collected = *Physical activity* (app functionality, on-device + sent as a count to
  compute rewards) and *Approximate location* (app functionality, to derive the reward zone). Mark **NOT
  sold, NOT shared** with third parties; encrypted in transit; user can request deletion (in-app
  `/delete` page + `/api/delete-account`). Health/activity data is **not** used for advertising.
- **Privacy policy URL:** https://move.melek.salon/privacy
- **Permissions:** `ACTIVITY_RECOGNITION` (step counter), `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_HEALTH`
  (background counting), coarse location (reward zone). Each has an in-app prominent disclosure before the prompt.

### Notes for reviewer / testing instructions (paste verbatim)
> MELEK Move is a fitness step-tracker and geo-explore game. Walking boosts an in-app reward; tapping
> "Claim this zone" records a stake-weighted share of an hourly pool that is paid in MELEK, the coin of
> the live MELEK mainnet. **MELEK Move is NOT a wallet:** it never creates, holds, moves, exchanges, or
> custodies cryptocurrency or keys. **Account creation happens outside the app — tap "Create your MELEK
> account" and the app hands you off to the device browser at melek.salon; the browser hand-off is the
> account/wallet flow, not the app.** The app itself only shows your account name and your accrued
> rewards. The app does NO cryptocurrency mining on the device (no hashing/proof-of-work); "reward zone"
> is purely a location-cell id, computed server-side. We never sell or share activity/location data and
> never use it for ads. To test: tap "Create your MELEK account" to see the browser hand-off (or just
> enter any existing MELEK username), allow the physical-activity permission, walk to see steps rise,
> then "Read my location" → "Claim this zone". Privacy policy: https://move.melek.salon/privacy

---

## APPLE APP STORE (App Store Connect) — for the iOS phase

### App Review Information → Notes (paste verbatim)
> MELEK Move is a fitness step-tracker + geo-explore game. Rewards are paid in MELEK, the coin of the
> live MELEK mainnet. **The app is NOT a wallet** — it never creates, holds, moves, exchanges, or
> custodies cryptocurrency or keys, and performs NO on-device crypto mining. **Account and wallet
> creation happen outside the app, in the device browser (SFSafariViewController / system browser) at
> melek.salon** — the app only displays an account name and accrued rewards. We use CoreMotion (step
> count) only to compute a fitness reward boost and approximate location only to derive a reward zone;
> this data is never sold, shared, or used for advertising. No content or app functionality is gated
> behind cryptocurrency. Demo: tap "Create your MELEK account" to see the browser hand-off (or enter any
> username), allow Motion & Fitness, walk, then read location and claim a zone.
> Privacy: https://move.melek.salon/privacy

### Apple specifics (App Review Guidelines)
- **Account:** enroll as an **Organization** (D-U-N-S) — required for crypto/wallet-adjacent apps. (Done:
  THE SHAIVITE TEMPLE, D-U-N-S on file.)
- **3.1.5(b) crypto:** the app is not a wallet (no keys/custody/exchange in-app) and rewards **never
  unlock content/functionality** (no IAP conflict). Do NOT add token-for-referral or token-for-social-share
  mechanics (3.1.5(b)(v)).
- **Usage strings (Info.plist):** `NSMotionUsageDescription` = "MELEK Move counts your steps to calculate
  your fitness rewards."; location usage string for the reward zone. (Add HealthKit strings only if we
  later read HealthKit — not required for the basic CMPedometer path.)
- **App Privacy questionnaire:** Health & Fitness + Location = "App Functionality", not linked to identity
  for tracking, not used for ads.

---

## If a reviewer pushes back
- "Looks like crypto earning / investment" → reply: the app is not a wallet and holds no keys; it is a
  fitness rewards feature paid in MELEK. Account/wallet creation and any transfer happen in the device
  browser at melek.salon, not in the app. Point to the in-app + privacy-page disclosures.
- "Is this a wallet?" → no: no key creation/storage, no send/receive/export, no seed phrase, no QR, no
  exchange. The app shows an account name and accrued rewards only; the account is created in the device
  browser at melek.salon.
- "On-device mining?" → no PoW/hashing ships in the binary; "reward zone" is a location-cell id only.
- "Health data use?" → only to compute the in-app reward; never sold/shared/advertised (Data safety + privacy policy).

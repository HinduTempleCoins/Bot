# MELEK Move — store submission: declarations + reviewer notes (copy-paste)

How we proactively tell Google + Apple what this app is, so it clears review. Pair with
`.local/MOVE_TOS_COMPLIANCE.md` (the policy checklist) and `apps/move/play-listing.md` (the public copy).
**Core message to both stores:** fitness step-tracker + geo-explore game; rewards are an in-app
**testnet** token with **no monetary value**; **no on-device mining** (no hashing/PoW on the phone);
activity data is never sold or shared.

---

## GOOGLE PLAY (Play Console)

### Declarations to complete (App content)
- **Financial features → Crypto / blockchain-based:** YES. "App rewards users with MELEK, a blockchain
  token on a test network with no monetary value. The app does not buy, sell, exchange, or custody
  crypto, and performs no on-device mining (no proof-of-work/hashing on the device)."
- **Foreground service → type: health:** declared; attach a 30–60s screen-recording of: open app → enable
  step counting (permission prompt) → steps increment while walking → claim a reward zone.
- **Data safety:** Collected = *Physical activity* (app functionality, on-device + sent as a count to
  compute rewards) and *Approximate location* (app functionality, to derive the reward zone). Mark **NOT
  sold, NOT shared** with third parties; encrypted in transit; user can request deletion. Health/activity
  data is **not** used for advertising.
- **Privacy policy URL:** https://move.melek.salon/privacy
- **Permissions:** `ACTIVITY_RECOGNITION` (step counter), `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_HEALTH`
  (background counting), coarse location (reward zone). Each has an in-app prominent disclosure before the prompt.

### Notes for reviewer / testing instructions (paste verbatim)
> MELEK Move is a fitness step-tracker and geo-explore game. Walking boosts an in-app reward; tapping
> "Claim this zone" records a stake-weighted share of an hourly pool that is paid in MELEK, a blockchain
> token currently on a TEST NETWORK with NO MONETARY VALUE — it cannot be bought, sold, or exchanged.
> The app does NO cryptocurrency mining on the device (no hashing/proof-of-work); "reward zone" is purely
> a location-cell id, computed server-side. We never sell or share activity/location data and never use
> it for ads. To test: enter any MELEK username (or tap "Create your MELEK account"), allow the
> physical-activity permission, walk to see steps rise, then "Read my location" → "Claim this zone".
> Privacy policy: https://move.melek.salon/privacy

---

## APPLE APP STORE (App Store Connect) — for the iOS phase

### App Review Information → Notes (paste verbatim)
> MELEK Move is a fitness step-tracker + geo-explore game. Rewards are an in-app token (MELEK) on a TEST
> NETWORK with NO MONETARY VALUE — not for sale, not exchangeable, not an investment. The app performs NO
> on-device crypto mining. We use CoreMotion (step count) only to compute a fitness reward boost and
> approximate location only to derive a reward zone; this data is never sold, shared, or used for
> advertising. No content or app functionality is gated behind cryptocurrency. Demo: enter any username,
> allow Motion & Fitness, walk, then read location and claim a zone. Privacy: https://move.melek.salon/privacy

### Apple specifics (App Review Guidelines)
- **Account:** enroll as an **Organization** (D-U-N-S) — required for crypto/wallet-adjacent apps.
- **3.1.5(b) crypto:** rewards are testnet, no monetary value, and **never unlock content/functionality**
  (no IAP conflict). Do NOT add token-for-referral or token-for-social-share mechanics (3.1.5(b)(v)).
- **Usage strings (Info.plist):** `NSMotionUsageDescription` = "MELEK Move counts your steps to calculate
  your fitness rewards."; location usage string for the reward zone. (Add HealthKit strings only if we
  later read HealthKit — not required for the basic CMPedometer path.)
- **App Privacy questionnaire:** Health & Fitness + Location = "App Functionality", not linked to identity
  for tracking, not used for ads.

---

## If a reviewer pushes back
- "Looks like crypto earning / investment" → reply: testnet, no monetary value, not exchangeable; it is a
  fitness rewards feature. Point to the in-app + privacy-page disclosures.
- "On-device mining?" → no PoW/hashing ships in the binary; "reward zone" is a location-cell id only.
- "Health data use?" → only to compute the in-app reward; never sold/shared/advertised (Data safety + privacy policy).

# MELEK Move — Android app (Capacitor wrapper)

Android-first native shell for **MELEK Move** (move.melek.salon). The web app *is* the UI — this wrapper
adds the one thing a browser can't do: count steps from the **OS pedometer in the background** (screen
off, app backgrounded), via a `health` foreground service. Everything else (geo reward-zone, the hourly
MELEK ledger + settlement) is unchanged and served from the live site.

> Build gate: needs the Android SDK + a **Google Play** developer account ($25). This dir is the
> committed build-kit; the signed AAB is produced on a machine with the SDK. ToS checklist:
> `.local/MOVE_TOS_COMPLIANCE.md`. Strategy: `.local/APP_STORE_STRATEGY.md`.

## How it works
- `capacitor.config.json` points the shell at **https://move.melek.salon** (live web app).
- The shell injects `window.MelekSteps` (see `native/StepService.java` + `native/MainActivity.notes.md`).
  The web page already feature-detects it (`site/move-miner/server.mjs`): if present, steps come from the
  device sensor; if absent (plain browser), it falls back to the in-page accelerometer counter.
- Steps drive the reward **boost** (×1.2→×15); the server records the stake-weighted weight into the
  hourly ledger and pays MELEK on-chain at hour close. The phone never holds a key.

## Build (on a machine with Android Studio / SDK)
```bash
cd apps/move
npm install
npx cap add android                     # generates android/ (Gradle project)
# merge native/manifest-additions.xml into android/app/src/main/AndroidManifest.xml
# copy native/StepService.java into the app package; wire MainActivity per MainActivity.notes.md
npx cap sync android
npx cap open android                     # build a signed AAB in Android Studio, or:
# cd android && ./gradlew bundleRelease
```

## ToS — DO BEFORE SUBMITTING (see .local/MOVE_TOS_COMPLIANCE.md)
1. **Play Console → App content:**
   - *Foreground service (health) declaration* — record a short demo video of the step-tracking flow.
   - *Financial features / blockchain declaration* — declare the in-app token (testnet, no monetary value).
   - *Data safety* form — declare "Physical activity" + "Approximate location"; mark **not** sold/shared.
   - Privacy policy URL: **https://move.melek.salon/privacy** (served by the app).
2. **In-app prominent disclosure** before the ACTIVITY_RECOGNITION prompt — present in the web UI's step
   card and re-stated by the native permission rationale.
3. **Listing copy** — use `play-listing.md`. Never: "mine crypto on your phone", "earn crypto for
   walking", ROI/passive-income language. Frame as Health & Fitness with in-app rewards (testnet).

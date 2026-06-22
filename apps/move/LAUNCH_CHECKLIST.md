# MELEK Move — Android launch checklist

Everything that can be done WITHOUT your accounts is ✅ done. The rest is account-gated and marked 👤.

## ✅ Done (in the repo / live)
- [x] Web app live + ToS-safe at **move.melek.salon** ("claim/reward zone", testnet disclosed, /privacy).
- [x] Native step bridge (`window.MelekSteps`) — OS pedometer when wrapped, accelerometer fallback in browser.
- [x] Capacitor Android kit (`apps/move/`): config, `StepService.java` (health FGS step counter),
      `MainActivity.java`, `apply.sh`, manifest perms.
- [x] **Cloud build** (`.github/workflows/move-android.yml`) → builds **app-debug.apk** + **app-release.aab**
      on GitHub's runners. No computer needed.
- [x] Store graphics: phone **screenshots** (`store-assets/screenshot-*.png`).
- [x] Listing copy (`play-listing.md`) + reviewer notes & declarations (`store-submission.md`), ToS-safe.
- [x] ToS research (`.local/MOVE_TOS_COMPLIANCE.md`).

## Account type: **Personal** (no DUNS needed)
Register the Google Play account as **Personal** — it ships, monetizes, and takes testers, and needs **no
D-U-N-S number**. (D-U-N-S is only for an *Organization* Play account and the *Apple* org account — iOS
phase, later.) You can switch Personal→Organization later once your D-U-N-S is verified.

## Auto-publish pipeline — WIRED (2026-06-22, after the Play dev account was approved)
The Android workflow now SIGNS the AAB and AUTO-PUBLISHES it to the Play **internal** track — once these 5
repo secrets exist (Settings → Secrets and variables → Actions). Until they're added, the build is unchanged
(unsigned AAB artifact you upload by hand), so adding them is the on-switch:
- `MOVE_UPLOAD_KEYSTORE_BASE64`, `MOVE_UPLOAD_KEYSTORE_PASSWORD`, `MOVE_UPLOAD_KEY_ALIAS`,
  `MOVE_UPLOAD_KEY_PASSWORD` — the upload keystore (I can generate it for you; you just paste the 4 values).
- `MOVE_PLAY_SERVICE_ACCOUNT_JSON` — Play Console → Setup → API access → create a service account → grant it
  release access → download the JSON → paste it.
App package id: **community.soapbox.move**.

## 👤 Your steps (most doable on your phone)
1. **Test NOW:** GitHub → Actions → "Build MELEK Move (Android)" → latest run → download
   **melek-move-debug-apk** → install on your Android phone → walk, watch the counter rise with screen off.
2. ✅ **Play account created** (Personal) — DONE.
3. **Create the app** in Play Console → use `play-listing.md` (copy) + `store-assets/` (screenshots) +
   the 512×512 icon (`site/move-miner/icons/icon-512.png`) + a 1024×500 feature graphic (I can generate).
4. **Add the 5 secrets above** (tell me to make the keystore; create the service-account JSON in Play). Then
   every push builds + signs + pushes the AAB straight to internal testing — no manual upload.
5. **Complete declarations** (paste from `store-submission.md`): Financial-features/blockchain, Foreground-
   service (health) + a ~30s demo video, Data safety, privacy URL = move.melek.salon/privacy.
6. **Internal testing** → add yourself + testers (the AAB lands here automatically once #4 is done).
7. **Closed testing**: new accounts need ~**14 days, 12+ testers** before Production — start the clock early.
8. **Promote to Production.**

## 🍎 iOS (App Store) — Phase 2, **no Mac needed**
The iOS build runs in the cloud on **Codemagic** (`apps/move/codemagic.yaml`) — it provides the macOS
builder + Apple code-signing, so you never touch a Mac. v1 counts steps in the foreground (webview
DeviceMotion + the `apply-ios.sh` Info.plist strings); the native CoreMotion background counter is a later
enhancement (parity with Android's `StepService`).

1. **Apple Developer Program — enroll as an *Organization*** ($99/yr). Crypto/wallet-adjacent apps need the
   org account, which needs a **D-U-N-S number** — and D-U-N-S verification is the slow part (can take
   ~1–2 weeks), so **start this now**, in parallel with everything else.
2. **Codemagic** (codemagic.io, free tier) → connect this repo → add the **App Store Connect API key**
   integration named `melek_app_store` (see codemagic.yaml header).
3. **Tell me the App Store Connect Apple ID** of the app once you create it → I set `APP_STORE_APPLE_ID`
   in codemagic.yaml.
4. Run the **`ios-melek-move`** workflow → it builds + uploads to **TestFlight** → install TestFlight on
   your iPhone → test the real signed app.
5. Submit for review using the **Apple notes** already written in `store-submission.md` (testnet / no
   monetary value / no on-device mining framing).

## Pre-submission polish (I can do on request)
- Move the ACTIVITY_RECOGNITION request behind the "Start counting" tap (strict prominent-disclosure timing).
- Generate the 1024×500 feature graphic + a localized icon set.
- Wire `r0adkll/upload-google-play` in the workflow to auto-publish to the internal track (needs a Play
  service-account JSON you create once, stored as a GitHub secret).

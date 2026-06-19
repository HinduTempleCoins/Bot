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

## 👤 Your steps (most doable on your phone)
1. **Test NOW without any account:** in GitHub → Actions → "Build MELEK Move (Android)" → latest run →
   download **melek-move-debug-apk** → install on your Android phone (allow "install unknown apps") →
   walk and watch the step counter rise with the screen off. *(No Play account needed for this.)*
2. **Create the Play account** ($25, **Personal**) at play.google.com/console — phone-doable.
3. **Tell me it exists** → I'll add the signing key + wire automatic AAB publishing to an internal test track.
4. **Create the app** in Play Console → use `play-listing.md` (copy) + `store-assets/` (screenshots) +
   a 512×512 icon (`site/move-miner/icons/icon-512.png`) + a 1024×500 feature graphic (I can generate on request).
5. **Complete declarations** (paste from `store-submission.md`): Financial-features/blockchain, Foreground-service
   (health) + record a ~30s demo video, Data safety, privacy URL = move.melek.salon/privacy.
6. **Upload the AAB** (from the Actions artifact) to **Internal testing** → add yourself + testers.
7. **Closed testing**: new accounts need ~**14 days, 12+ testers** before Production. Start this clock early.
8. **Promote to Production.**

## Pre-submission polish (I can do on request)
- Move the ACTIVITY_RECOGNITION request behind the "Start counting" tap (strict prominent-disclosure timing).
- Generate the 1024×500 feature graphic + a localized icon set.
- Wire `r0adkll/upload-google-play` in the workflow to auto-publish to the internal track (needs a Play
  service-account JSON you create once, stored as a GitHub secret).

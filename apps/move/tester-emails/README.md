# MELEK Move — closed-test recruitment emails

Google Play requires **12 testers opted in for 14 continuous days** on the closed track before
`community.soapbox.move` can be promoted to production. The 14 days do not start until the list is
full, so filling it is the gate on launch, not the paperwork around it.

## The two emails

| File | Goes to | Ask |
|---|---|---|
| `en-friends.txt` | People who haven't agreed yet | Their **Google account email** (the one on their Android phone) so they can be added to the closed-track list |
| `en-testers.txt` | People who said yes and are now on the list | Opt in, install, allow the activity permission, stay installed 14 days, report bugs |

Two separate sends on purpose: you cannot give someone the opt-in link until their address is on the
list in Play Console, or the link just tells them the app isn't available and they give up.

## Translations

The recruitment email is translated for reaching past your English-speaking contacts — the chain
communities skew Spanish, Portuguese, Korean, Chinese, Russian and Indonesian.

`es` · `pt-BR` · `fr` · `de` · `ru` · `ko` · `zh-CN` · `hi` · `id`

Only the *friends* (recruitment) email is translated. Once someone is on the list, send them
`en-testers.txt` — or ask and translate that one too.

## Before sending — two things to fill in

1. **The opt-in URL.** `en-testers.txt` uses the standard Play closed-track form,
   `https://play.google.com/apps/testing/community.soapbox.move`. Confirm the real one in Play Console
   under Testing → Closed testing → your track → Testers → "Copy link". Fix it in the file if it differs.
2. **The end date.** `en-testers.txt` says **3 October**, which is 14 days from 2026-09-19. If the list
   fills later, the window moves — set it to 14 days after the last tester is added, not after the first.

## Compliance

Copy follows `apps/move/play-listing.md` and `.local/MOVE_TOS_COMPLIANCE.md`. MELEK is described as an
in-app token on a test network with no monetary value, explicitly not an investment. None of the
banned framings appear — no "mine crypto on your phone", "earn crypto for walking", "passive income",
"ROI", "guaranteed returns". Keep it that way in any edit: the same wording that gets a listing
rejected gets forwarded to people who screenshot it.

# MELEK Move — closed-test recruitment emails

> ⚠️ **LIKELY UNNECESSARY — the 12-tester / 14-day gate does NOT apply to an Organization account.**
> The 2026-09-14 operator session established the Play account is an **Organization** account, for which
> the "12 testers opted in for 14 continuous days before Production" rule is **struck** (it is a
> *personal*-account requirement). Internal + closed tracks already carry a signed AAB with ~18 testers
> steady since 22 August. **OPERATOR: confirm the account type in Play Console; if Organization, stand
> down this recruitment drive** — it is not on the launch critical path. Kept on disk only in case the
> org finding is wrong. See `.local/incoming/MOVE_PLAYSTORE_GOLIVE.md`.

The material below describes the *personal*-account flow, retained for reference. On a personal account,
Google Play would require **12 testers opted in for 14 continuous days** on the closed track before
`community.soapbox.move` could be promoted to production, with the 14 days not starting until the list
is full.

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

Copy follows `apps/move/play-listing.md` and `.local/MOVE_TOS_COMPLIANCE.md`. Launch posture is now
**MAINNET + "the app is not a wallet"** (2026-09-14): MELEK is the coin of the live MELEK mainnet, and
the compliance protection is that the app performs no wallet ops (no keys, no custody, no send/receive,
no exchange, no on-device mining) and hands account/wallet creation off to the device browser at
melek.salon — it is a fitness reward, explicitly not an investment. **Before sending, update the `.txt`
emails to drop any "test network / no monetary value" wording** (they were written under the old testnet
framing). None of the banned framings may appear — no "mine crypto on your phone", "earn crypto for
walking", "passive income", "ROI", "investment", "guaranteed returns". Keep it that way in any edit: the
same wording that gets a listing rejected gets forwarded to people who screenshot it.

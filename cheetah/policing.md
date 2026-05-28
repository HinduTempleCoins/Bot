# Cheetah — content policing scope

Operator directive 2026-05-28: "absolutely no Child Porn or anything like that, we are going to be a Completely Anti-that Platform... we want to have all of that Ready" when the blockchain launches.

This document sets the scope and gating for Cheetah's policing role separately from its attribution / discovery role. Policing is in a different risk class (regulated, legally sensitive, mandatory reporting in most jurisdictions) and the implementation requirements reflect that.

## What "policing" means here

Two distinct concerns, with different mechanisms:

1. **CSAM (Child Sexual Abuse Material) detection.** Mandatory remove + report; zero tolerance. Wrongful-flag risk is high enough that mechanism cannot be ad-hoc.
2. **Other clearly-illegal content** (e.g. credible threats, doxxing, malware distribution). Remove + log; appeal path applies.

Cheetah's attribution role (find content, credit source) is unrelated to either of these; it stays in scope as designed in CHEETAH_ADVANCED.md §1-8. Policing is a SEPARATE pipeline, not a CSAM-flavored extension of attribution.

## Why this can't be ad-hoc

CSAM in particular requires:

- **PhotoDNA / NCMEC hash matching.** The standard tooling. Access requires an institutional application (Microsoft PhotoDNA Cloud Service / NCMEC's hash database), terms-of-service compliance, and a hashing pipeline that meets the spec. Not something to roll yourself.
- **CyberTipline reporting** (US law, 18 USC §2258A). Electronic Service Providers MUST report apparent CSAM to NCMEC. Failing to report is a crime. Operator + counsel decide which jurisdiction MELEK files under and who the reporting party is.
- **Chain-of-custody preservation.** Removed content can't simply be deleted — it must be preserved per regulatory requirements for law enforcement to investigate. This affects how on-chain removal works on a blockchain that's fundamentally append-only.
- **Counter-abuse hardening.** False CSAM reports are themselves a weapon — used to silence enemies, manipulate platforms. Whatever Cheetah ships must have a process to surface and recover from wrongful flags, and must NOT be invocable by users as a punishment tool.
- **Legal review.** Operator should have counsel review the policy + the technical implementation before this goes live on a public chain. Different jurisdictions have different definitions and reporting requirements.

## What CAN be shipped now (gated on chain launch)

- **Policy text.** Operator-authored statement of zero tolerance + what the platform will do. Lives in `POLICY.md` at repo root or similar. Operator framing 2026-05-28: "I would actually like to put in our Policy and Everything that we will come get You if You are doing that on our Website." Strong policy is a deterrent and clarifies platform stance for both users and authorities.
- **Architectural placeholders** in `cheetah/policing/` for the eventual integrations — without live wiring. Names and shapes:
  - `cheetah/policing/csam-hash-match.js` — placeholder for PhotoDNA / NCMEC hash matching
  - `cheetah/policing/illegal-content-detect.js` — placeholder for the broader category (terror, malware, etc.)
  - `cheetah/policing/report.js` — placeholder for NCMEC CyberTipline submission
  - `cheetah/policing/quarantine.js` — placeholder for the "remove + preserve evidence" pipeline
- **Operator decisions** to document but not act on yet:
  - Reporting jurisdiction / party (operator name + counsel call)
  - Whether Cheetah-the-bot files reports, or whether it surfaces to operator who files
  - How chain-immutability interacts with "removal" — the standard pattern is moderation-flag-on-the-chain + condenser-side hiding; the content stays in chain history but isn't surfaced. Operator decision in coordination with chain side.
  - Hash-match provider selection (PhotoDNA most common, alternatives exist)

## What MUST NOT be shipped without full setup

- Live CSAM hash matching without PhotoDNA / NCMEC access agreement.
- Auto-reporting to law enforcement without operator decision on filing party.
- A user-invocable "report as CSAM" UI without abuse-prevention controls — false flagging is a serious harm.
- Any model-based CSAM "classifier" that hallucinates — generative classification is not the right tool; perceptual hashing against a known-bad database is.

## Position on the operator's "harsher than ban" instinct

Operator stated: "Websites that Ban People are not Harsh enough, but I know that is itself going a little to far."

This is correctly self-flagged. "Come get you" rhetoric in policy is appropriate as a statement of seriousness; actually pursuing private enforcement against users is outside what this platform should do. The right mechanism is: (a) refuse service; (b) preserve evidence; (c) report to authorities; (d) cooperate with legitimate law enforcement requests. Anything beyond that takes operator outside platform-operator role and into a different legal posture entirely.

## TODO when chain launches

- [ ] Author `POLICY.md` (operator + counsel review)
- [ ] Apply for PhotoDNA / NCMEC access
- [ ] Decide reporting jurisdiction + filing party
- [ ] Decide chain-immutability ↔ removal mechanics with chain side
- [ ] Build `cheetah/policing/*` modules per the placeholders above (live wiring)
- [ ] Build wrongful-flag recovery process (mirror of Hathor's resolution flow but for the policing pipeline)
- [ ] Document counter-abuse hardening — prevent malicious use of the report mechanism

## Cross-references

- `CHEETAH_ADVANCED.md` — Cheetah's attribution/discovery role (separate from this)
- Operator's broader stance on content + community will land in `POLICY.md` (TBD)
- Chain-side moderation pattern is gated on `HinduTempleCoins/melek-chain` decisions

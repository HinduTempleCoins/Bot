# SOCIAL_MEDIA_HARMS.md — the harms map, and how MELEK handles each

This is the human-readable index for `integrations/flag-taxonomy.mjs`: the single taxonomy that
attaches every "traditional social-media harm" to **one** pipeline that already exists — the
append-only flag store + review queue in `integrations/moderation-flags.mjs`. There is no second
store and no separate moderation database; every finding lands in that one queue.

**The posture is credit-first and non-punitive (POLICY.md §1, §4).** A flag is a marker that
something *may* need a human's attention, not a delete button and never an auto-ban. On an
append-only chain there is no real "delete" anyway — "removal" is condenser-side hiding, and the
honest mechanisms are: surface a crediting note, queue for review, or — for the one narrow
illegal-content case — refuse service + preserve evidence + report to authorities (POLICY.md §6).
Gated categories (CSAM above all) are **never auto-handled**: they are flagged for a human and
counsel.

## How it works

1. `classify(content)` runs the available deterministic detectors over `{ author, permlink, body,
   images? }` and returns findings `{ category, severity, confidence, evidence, action, gated }`.
   Each detector **soft-fails independently** — a missing, keyed, or throwing detector simply yields
   no finding (fully offline-safe).
2. `route(findings)` opens one report per finding in the moderation queue
   (`moderation-flags.raiseReport`), tagged with category + severity + action + evidence. It only
   ever opens reports (`status: 'open'`); it never resolves, never sets `actioned`, and never bans.
   Re-routing the same findings is idempotent (the store dedups identical still-open reports).

## The map: harm → detector → action

| Harm | Sev | Detector (module#fn) | Wired? | Default action (credit-first, not punitive) |
|---|---|---|---|---|
| **Plagiarism** (uncredited text reuse) | 2 | `cheetah/text-detection.js#detectText` (shingle/Jaccard, corpus-mode offline; web/on-chain backends keyed) | **Wired** (offline corpus mode) | Credit-first note: "this text also appears here," never "plagiarized" |
| **Image theft** (uncredited image reuse) | 2 | `cheetah/perceptual-hash.js#findOriginal` (dHash + Hamming; caller supplies the hash) | **Wired** (no decode/fetch in classify) | Credit the earliest poster; correction built in |
| **Spam / flooding** | 2 | `spamtest/limits.mjs#simulateSpam` (consensus intervals + RC budget) | **Wired** (offline model) | Rate-limit/RC at the boundary; persistent spam queued for review |
| **Scam / fraud** (phishing, drainer, fake-airdrop, seed-phrase requests) | 4 | `flag-taxonomy.mjs#detectScamHeuristic` (built-in pattern matcher) | **Wired** (keyless heuristic) | Queue for review |
| **Harassment / toxicity / threats** | 3 | `integrations/moderation-adapter.mjs#moderate` (Detoxify when `DETOXIFY_URL` set; keyless lexicon floor otherwise) | **Wired** (lexicon floor offline; Detoxify keyed) | Advisory score → queue for review, never an auto-block |
| **Hate / identity attack** | 4 | `integrations/moderation-adapter.mjs#moderate` (severe/threat axes) | **Wired** (lexicon floor offline) | Queue for review (higher severity) |
| **Impersonation** (of Witness / staff / accounts) | 3 | `flag-taxonomy.mjs#detectImpersonationHeuristic` | **Wired** (keyless heuristic) | Queue → human verify (the real `hathor`/`cheetah` accounts are exempt) |
| **Misinformation** (unverifiable factual claims) | 2 | `library-of-ashurbanipal-bot/src/factChecker/index.js#checkArticle` | **Stubbed offline** — needs grounding sources; opt-in via `factCheck:true`; FLAGS only, never edits | Queue/annotate; lawful-but-wrong is not removed |
| **Doxxing / PII** (others' private info) | 4 | `flag-taxonomy.mjs#detectPiiHeuristic` (SSN/phone/email/card/address cues) | **Wired** (keyless heuristic) | Queue for review |
| **CSAM** (child sexual abuse material) | 5 | `cheetah/policing/csam-hash-match.js#matchKnownBad` (PhotoDNA/NCMEC perceptual-hash) | **Gated, not wired** — no model classifier; needs institutional access + counsel (cheetah/policing.md) | **Escalate human + counsel.** §6 path: refuse service + preserve evidence + CyberTipline report. NEVER auto-handled |
| **Bot / sybil** (coordinated inauthentic behavior) | 2 | `flag-taxonomy.mjs#detectSybilHeuristic` (proof-of-human + duplicate/age signals) | **Wired** (keyless heuristic) | Queue for review (rate-limits + PoH gate are the front line) |
| **Copyright / DMCA** | 3 | `flag-taxonomy.mjs#detectCopyrightHeuristic` | **Gated on process** (DMCA is a legal claim with a counter-notice path) | Route to a human, never auto-actioned; three-bucket copyright model governs hosting |

## Actions vocabulary (none of these is "ban")

- **credit-first-note** — friendly crediting/connecting note; the default for attribution matches.
- **queue-for-review** — lands in the moderation queue for a human / Hathor's resolution flow.
- **refuse-service+preserve-evidence+report** — POLICY.md §6, the genuinely-illegal-content path
  (law enforcement, not platform vigilantism).
- **escalate-human+counsel** — gated categories; a human and counsel own resolution. Never auto-actioned.

## What is wired vs stubbed/gated (today)

- **Wired & offline-tested:** plagiarism (corpus mode), image-theft (hash provided), spam, scam,
  harassment/toxicity, hate, impersonation, doxxing/PII, bot/sybil.
- **Keyed (yields no finding until configured):** the plagiarism web/on-chain backends, Detoxify
  (`DETOXIFY_URL`), the fact-checker's claim verification (needs grounding sources).
- **Gated (deliberately not auto-handled):** CSAM (PhotoDNA/NCMEC + counsel + CyberTipline) and
  copyright/DMCA (legal process). The taxonomy records the requirement and routes a human, but runs
  no classifier and takes no automatic action — exactly per `cheetah/policing.md` and POLICY.md §6.

## Right of reply (POLICY.md §7)

Every automated action can be wrong, so correction is built in. A flag is contestable; disputes
route through Hathor's resolution flow, which records the *why* when a flag is overturned so the
same content isn't re-flagged. `route()` therefore only ever opens reports — resolution is always a
separate, evidenced, human-owned step.

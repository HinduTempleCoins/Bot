# Cheetah — Problems & Solutions (from live testnet proving, 2026-06-10)

This is the field log from bringing CheetahAdvanced up against the live MELEK
testnet and proving the full policing loop end-to-end (a thief posted a
plagiarized copy; `@cheetahbot` replied on it on-chain). It records every
real-world problem the work hit and how it was solved, so none of it has to be
re-learned. It is factual and infra-free: server names, IPs, endpoints, and key
material stay in `.local/` (gitignored) and the operator vault.

**Companion reading:** `CHEETAH_ADVANCED.md` (the bot's design + credit-first
posture), `cheetah/policing.md` (the separate, legally-sensitive policing
pipeline), `POLICY.md` §4 (the public-facing attribution stance),
`cheetah/README.md` (module map). For the offline, repeatable harness that
exercises the scenarios below without a chain, see
`cheetah/policing-scenarios.test.mjs`.

**What lives where (so this stays repeatable):**

- The committed code is **offline / safe**. `cheetah/index.js scanPost` is called
  with `dryRun: true` in tests and never reaches the broadcast branch — that
  branch needs Hathor chain config + posting auth, which this repo deliberately
  does not hold. The live-broadcasting variant runs on the host.
- The detectors are pure/injectable: text via shingle + Jaccard
  (`text-detection.js`), discovery via the shorter-shingle relatedness band
  (`discovery.js`), image-duplicate via dHash + Hamming (`perceptual-hash.js`),
  image-recognition via Gemini Vision (`image-detection.js`, key from env only).

---

## A. Onboarding the actors (creating the "thief" and the victim accounts)

### A1. HF20+ regular accounts cannot call `account_create`

**Problem.** On this Steem fork (HF20+), a normal funded account can no longer
broadcast a plain `account_create` op to mint a new account — the operation was
replaced by the resource-credit / claimed-account model. Attempts to create the
test thief/victim accounts the old way fail at broadcast.

**Solution.** Use the two-step claimed-account flow:

1. `claim_account` — burns a fee (or RC) to mint an **account creation token**.
2. `create_claimed_account` — spends that token to create the named account with
   the desired keys.

For genesis/bootstrap accounts on a fresh testnet, the **faucet via `initminer`**
(the genesis account that holds the initial stake) is the simpler path: have
`initminer` fund/create the actor accounts directly during bring-up. Either way,
new accounts also need POWER/delegation before they can post at all — see the
related note in MEMORY (`graphene-onboarding-mechanics`): on this HF23 fork
`account_create_with_delegation` is effectively a no-op, so delegate Resource
Credits via `delegate_vesting_shares` after creation.

### A2. Account names are capped at 16 characters

**Problem.** Graphene account names have a hard 16-character limit (plus the
charset/segment rules). Descriptive test names like `cheetah-victim-account`
silently fail validation.

**Solution.** Keep every test account name ≤ 16 chars (e.g. `cheetahbot`,
`thief1`, `victim1`). Pick names up front that fit, including any segment dots,
so the create op validates the first time.

### A3. The faucet rate-limits by external IP

**Problem.** Driving the faucet/account-creation endpoint from outside the chain
host trips an external-IP rate limit — repeated create/fund calls during
bring-up get throttled or refused.

**Solution.** Call the faucet **locally on the chain box** (loopback), where the
external-IP limiter does not apply, instead of hitting it across the network.
Bring up the actor accounts from a script that runs on the host itself.

---

## B. Image detection (dHash duplicate + Gemini Vision recognition)

### B1. Wikimedia returns HTTP 400 for a generic User-Agent

**Problem.** Fetching an image to hash (or to send to Gemini) from Wikimedia /
Wikipedia with a generic or empty `User-Agent` gets a `400 Bad Request`.
Wikimedia's policy requires a descriptive UA and rejects bare/library defaults.

**Solution.** Two interchangeable fixes:

- Send a **browser-style or descriptive User-Agent** on the image fetch (the
  modules already set one — e.g. `image-detection.js` sends
  `MELEK-Cheetah/1.0 (+…repo URL)`; bump to a browser UA where a host is
  especially strict). The fetch is injectable (`__setFetch`) so this is tunable
  per deployment.
- Or use a **UA-agnostic image host** for the test fixtures (one that doesn't
  gate on UA), so the duplicate-image proof doesn't depend on Wikimedia's policy
  at all.

### B2. The Gemini key is the newer `AQ.`-format, not the classic `AIza…`

**Problem.** Image-recognition (Gemini Vision) calls failed when wired with an
older assumption about key shape. The current key the operator provisions is the
newer **`AQ.`-prefixed** format, not the classic **`AIza…`** API key. Code or
validators that assume an `AIza` prefix reject a perfectly valid key.

**Solution.** Do **not** validate/branch on the key prefix. Treat
`GEMINI_API_KEY` as an opaque secret pulled from the env/vault and pass it
straight through. `image-detection.js` already does this (`process.env.GEMINI_API_KEY`,
no prefix check). Never log any part of the key — present/missing/length only
(MEMORY: `never-print-any-part-of-a-key`).

---

## C. On-chain commenting (the policing reply)

### C1. The comment rate limit is 1 per 3 seconds (HF20)

**Problem.** Broadcasting Cheetah's replies back-to-back during the live loop
(or seeding multiple test comments) gets rejected: HF20 enforces a **minimum 3
second interval between `comment` ops** from the same account.

**Solution.** Space comment broadcasts ≥ 3 seconds apart in the live loop. In
practice the frequency cap below already prevents bursts to one author; for
multi-target runs, throttle the broadcast queue to one comment per 3s.

### C2. Replies must be credit-first per POLICY.md — never accusatory

**Problem.** The whole point of the inverted Cheetah is that it must **credit,
not accuse**. A reply that says "you stole this" or "plagiarist" is both wrong
for the platform's posture (POLICY.md §1-2, CHEETAH_ADVANCED.md §2) and a legal
/ reputational liability. It's easy for a template tweak or an LLM-written
variant to drift into accusatory language.

**Solution.** Detection never decides "guilt" — it's a deterministic shingle/Jaccard
or dHash/Hamming match. Composition (`compose.js`) is a fixed, credit-first
template pool: "this content **also appears** here", "image **credit**", "a
**connection, not a claim**", always with a self-ID footer and an opt-out/proof
path. The offline harness (`policing-scenarios.test.mjs`) asserts every composed
note contains a credit-first phrase and contains **none** of
`stole/stolen/thief/theft/plagiari[sz]/banned/cheater/fraud/guilty`, so a future
template/threshold change that turns Cheetah punitive fails the test before it
can ship.

---

## D. Detection-quality lessons (locked into tests)

These aren't bring-up blockers but were learned tuning the detectors, and are
pinned by `policing-scenarios.test.mjs` and `false-positive.test.js`:

- **Copy vs. relatedness are different shingle sizes.** Copy detection uses
  5-word shingles (rare exact phrases, threshold 0.5). The discovery "see also"
  librarian uses 2-word shingles in a band `[0.08, 0.45)` — so two posts on the
  same topic in different words register as *related* without being flagged as a
  *copy*. Using one shingle size for both makes discovery either silent or
  falsely accusatory.
- **Flag-conservative by design.** Short generic boilerplate, a one-sentence
  quote inside original writing, and partial paraphrase must all stay below the
  copy threshold. Prefer missing a thief to crediting-commenting on an innocent.
- **The whitelist is the guard for self-cross-posting, not the matcher.** An
  author re-posting their own proven work produces a *real* 100% text match; the
  evidenced whitelist (`store.js`) suppresses the comment, not the detector.
- **The frequency cap is enforced at broadcast time.** `recordComment` arms the
  per-author 1/day cap only after a successful on-chain reply; the cap is checked
  at the top of `scanPost`. In the offline harness this is exercised via the
  test-only `__recordComment` / `__resetCap` seam in `index.js`.

---

## E. How to re-run the proof offline (repeatable harness)

```
node --test cheetah/policing-scenarios.test.mjs     # the consolidated scenarios
node --test cheetah/*.test.js cheetah/*.test.mjs    # the full cheetah suite
```

Scenarios covered (all offline, injected fetch/decoder/corpus, no chain, no
network): (a) verbatim plagiarism → credit note; (b) original → no note;
(c) related prior work → see-also note; (d) duplicate image (small Hamming) →
image-credit note; (e) distinct image (large Hamming) → no note; (f) whitelisted
own re-post → skipped; (g) frequency cap → second copy on the same author
skipped. Plus a credit-first tone gate across all three composers.

The live-broadcasting variant (the one that actually replies on-chain as
`@cheetahbot`) runs on the host with chain config + posting auth; it is **not**
in this repo by design.

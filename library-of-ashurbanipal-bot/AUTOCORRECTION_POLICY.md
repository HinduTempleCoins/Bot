# Auto-Correction Policy — FLAG-ONLY, never edit source data

**Status:** canonical. This is the load-bearing statement of how the Ashurbanipal fact-checker
relates to the knowledge base. It restates a hard project rule (see the repo `CLAUDE.md` and the
operator-feedback memory rule "NEVER edit data records"). Task #102.

**Companion code:** `src/factChecker/autocorrectGuard.js` enforces this policy in code (the single
importable `POLICY` constant + the `assertNotKbPath` guard). `src/factChecker/kbFlags.js` and
`src/factChecker/verdictLog.js` are the flag-only stores this policy governs.

---

## The principle (one line)

**The fact-checker FLAGS. It never edits.** No code in the fact-checker writes, patches, or deletes
any file under `knowledge/**`. Auto-correction of source data is a **discussion item, not a feature** —
it does not exist, and turning on any form of it requires explicit operator sign-off first.

---

## Why (verdicts are fallible; source data is operator-owned ground truth)

1. **Verdicts are fallible — false positives are expected.** The checker is a heuristic over web /
   scholarly / gov evidence; it gets things wrong. It once mislabeled **VKFRI** (the Van Kush Family
   Research Institute, a private research group) as something externally notable / mischaracterized —
   a textbook false positive. A system that auto-edited on a verdict would have silently corrupted a
   true record. Because the verdict that *triggers* an edit can itself be wrong, the only safe action
   is to **raise a question for a human**, never to apply a correction.

2. **Source data is the operator's ground truth.** The documents under `knowledge/**` (scripture,
   the operator's research papers, ingested corpus) are authored / curated / owned by the operator.
   They are the canonical record. The bot is a *reader and questioner* of that record, not an author
   of it. Editing them is an editorial act reserved to the operator.

3. **Flags are advisory by design.** A flag means "this statement **MAY** be inaccurate — please
   review", never "this is wrong, here is the fix." The brief warnings deliberately use *may be
   inaccurate* wording and carry an `[advisory — verdicts are fallible; verify before acting]` note.

---

## What the checker MAY do

- **Raise advisory flags** into its own store (`kbFlags.raiseFlag`, `data/kb-flags.jsonl`) — recording
  the KB path as a **reference string only**, never opening that file for writing.
- **Log verdicts** into its own append-only audit log (`verdictLog`, `data/factcheck-log.jsonl`).
- **Surface brief warnings** for operator review (`kbFlags.briefWarnings()`, the #123 handoff to the
  Server-4 brief pipeline) — open flags only, phrased as advisory questions.
- **Heal / re-check** its own flags within its own store (operator-driven `resolveFlag`, or a re-check
  clearing a stale flag) — again, store-only, never touching the KB.

## What the checker must NEVER do

- **Write** to anything under `knowledge/**`.
- **Patch / rewrite** any KB source file.
- **Delete** any KB source file.
- **Enable any auto-correction** of source data without explicit operator sign-off (see below).

These four are encoded in `POLICY.neverDo` and enforced at runtime by `assertNotKbPath()`, which any
prospective write path calls and which **throws** if the target is under `knowledge/**`. The fact-checker
refuses to edit source data *by construction*, not by convention.

---

## The human-in-the-loop path

The only path by which a flagged statement gets corrected:

1. The checker **raises a flag** (advisory) and logs the verdict.
2. The flag surfaces as a **brief warning** for the operator.
3. The **operator reviews** the flag — expecting false positives, verifying thoroughly.
4. The **operator decides**: dismiss (false positive) or accept (genuine issue).
5. If warranted, **the operator — not the bot — edits** the source document.

The bot's role ends at step 2. Steps 3–5 are the operator's. A flag can be marked `reviewed` /
`dismissed` in the flag store (store-only), but the KB itself only ever changes by the operator's hand.

---

## Auto-correction is a future discussion (explicit sign-off required)

There is intentionally **no auto-edit mechanism** in this repo, and this policy proposes none. Any
future move toward the checker editing source data — even "low-risk", "high-confidence", or
"reversible" auto-correction — is a **discussion item requiring explicit, operator-named sign-off**
before a single line of such a mechanism is written. Until that sign-off exists, the rule is absolute:
**flag, never edit.**

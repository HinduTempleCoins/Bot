# Pentecaust HERALD — Outreach System Brief

**What this is:** the founding/design brief for **Herald**, Pentecaust's outreach system.
It is derived from the *MELEK / SoapBox Outreach System* project brief (Van Kush Family
Research Institute, 2026-07-31) but **corrected against the system as actually built** — the
source brief was drafted without visibility into the existing code, so several parts describe
a greenfield repo and conventions that do not match this one. Corrections are called out in §5.

Herald lives in `pentecaust/` and is governed by the repo's existing `CLAUDE.md` + `BRIEF.md`,
the `MEMORY.md` / `.local/` memory system, the ship-flow (branch → PR, pushes to `main` blocked),
and the offline-tests house style. It is **not** a standalone `outreach-system/` repo.

---

## 1. What Herald actually IS (built, in this repo)

Herald is Pentecaust's **AI-SDR / cold-outreach tool** — the Instantly / Smartlead / Lemlist
analog. You describe who you want to reach and what you offer; Herald drafts an ideal-customer
profile (ICP) and a multi-step outreach sequence you can edit; you connect **your own** mailbox
and Herald sends from **your** address. Market reference in the research is "MoneyPrinter"
(`.local/MONEYPRINTER_RESEARCH_AND_PENTECAUST_PLAN.md`) — that is the category name, **not** ours.

Built modules:

| File | Role |
|---|---|
| `pentecaust/crm/model.mjs` | **CRM backbone** — campaigns, ICP, multi-step sequence, leads, pipeline. The deterministic ~80% of the system. One JSON store, injectable fs, soft-fail-never-throw, offline. Keyed to a MELEK account as campaign owner. Stages: `new → queued → contacted → replied → meeting → won → lost`, plus terminal `unsubscribed` (suppresses all sends). Channels: `email` (workhorse), `linkedin` (via Unipile, later), `task`. |
| `pentecaust/crm/builder.mjs` | **The small LLM surface** — (1) goal/website/value-prop → structured ICP + sequence draft, (2) a per-lead opener grounded in a **verified signal only**. Guardrailed (facts-only, length caps, a BANNED-spam-word scrubber for deliverability). Every LLM call has a deterministic template fallback; the LLM is injected (guest-proxy/Groq router in prod, mock in tests). The LLM only emits values into the fixed schema — it never invents the data shape or the sender. |
| `pentecaust/connect/mailbox.mjs` | **Sending layer** — a user connects their own Gmail via OAuth (`gmail.send`, send-only, cannot read mail); Herald sends through it. Enforces `HERALD_FORBIDDEN_SEND_DOMAINS`. |
| `pentecaust/server.mjs` | UI (the **📣 Herald** tab) + owner-scoped campaign reads (you only ever see your own campaigns) + the send endpoint (render sequence step for a lead → send via the connected mailbox). |
| `pentecaust/auth.mjs` | OAuth — separate **login/identity** scope vs **mailbox-send** scope; refresh tokens so Herald keeps sending after the ~1h access token expires. |

Data flow: *describe target + offer* → `builder` drafts ICP + sequence → user edits → leads
enter the `model` pipeline → user connects a mailbox → `mailbox` sends step-by-step from the
user's own address, advancing pipeline stages.

---

## 2. The hard rules (load-bearing)

1. **Send only from the user's OWN connected mailbox — NEVER from an `@pentecaust.com`,
   `@melek.salon`, or `@soapbox.community` address.** Those are identity/transactional domains;
   cold outreach from them burns their reputation. Enforced in `mailbox.mjs`
   (`HERALD_FORBIDDEN_SEND_DOMAINS`). Deliverability-critical sending is a **separate, warmed**
   system that never shares reputation with transactional mail.
2. **Drafting + pipeline is the product; automated sending is gated.** Herald drafts; sends run
   later on the warmed sender path.
3. **Third-party platforms (forums, Reddit, Q&A, PR sites, directories): DRAFT ONLY, a human
   posts.** Automated posting is permitted **only** on VKFRI-owned infrastructure and Graphene
   accounts that belong to the operator (MELEK, Blurt, Hive, Steemit). No auto-registration, no
   forum-spam automation. (Matches `CLAUDE.md`.)
4. **Keys/tokens in env or an encrypted keystore, never in the repo.** Mailbox **refresh tokens =
   high-value**; production MUST encrypt them at rest (KMS / MELEK-Signer custody box — see
   `[[hathor-key-security-architecture]]`). Tokens are never logged.
5. **House style:** ESM `.mjs`, injectable fs/fetch/LLM, soft-fail-never-throw, fully
   offline-testable (`node --test`, no network), `esc()` all interpolation. Same discipline as
   `pentecaust/model.mjs`.

---

## 3. The broader outreach program (the source brief's 7 components), scoped to Herald

The source brief describes a 7-component program. Herald **is the engine** (ICP + sequence +
own-mailbox send); the rest are adjacent surfaces, some already existing elsewhere in the repo.
Honest status:

| # | Source-brief component | Reality / mapping | Status |
|---|---|---|---|
| — | **AI-SDR: ICP + sequence + own-mailbox send** | **This is Herald.** `crm/` + `connect/`. | **Built (alpha)** |
| 1 | Graphene cross-poster (one article → MELEK/Blurt/Hive/Steemit) | Adjacent; MELEK is a Blurt fork so Blurt tooling adapts. Overlaps existing witness/broadcast paths + the wiki Pywikibot pipeline. | New/partial — separate from Herald |
| 2 | QR / landing tracker (`melek.salon/go/{code}` → UTM landing, scan dashboard) | New. Belongs with the site layer, not the CRM. | New |
| 3 | Outreach DB + dashboard (import the 151-row backlink tracker → live web UI) | Partly subsumed by `crm/model.mjs` (campaigns/leads/pipeline). The backlink/SEO tracker is a distinct dataset. | Partial |
| 4 | Backlink verifier (nightly crawl: live? dofollow/nofollow?) | New; a polite nightly job. | New |
| 5 | Content factory (one source doc → per-platform **drafts**, humans post) | Overlaps Herald's `builder` (drafting) + the guardrail in §2.3. | Partial (Herald covers outreach copy) |
| 6 | Press-release pipeline (monthly, house formats, manual submit) | New. | New |
| 7 | Source-request monitor (HARO/Qwoted → drafted responses, human sends) | New; reads a query digest, drafts into a queue. | New |

**Takeaway:** "Add this to Herald" = Herald owns the AI-SDR core (built). Components 1–7 are the
outreach *program* around it — track them as their own build items, not as Herald internals.

---

## 4. Verified facts (corrected from the source brief)

- **Block time is 4 seconds** (verified on-chain, 2026-07-31), not 3. MELEK launched 2026-07-12,
  BLURT/Graphene fork, no premine.
- **On-chain active witness schedule** (verified): `hathor, initminer, maat, seshat, thoth`.
  The source brief's named human founders (Sohailnusrat, Prince Baker) are an operator/community
  matter — left to the operator to confirm; the *running* schedule is the five above.
- Hathor = the AI witness/teacher (fine-tuned Qwen + RAG). Site: melek.salon.
- Institutional identity (VKFRI / Shaivite Temple, 501(c)(3), EIN, published papers) is the
  operator's to state; Herald just carries a boilerplate block where needed.

---

## 5. What the source brief got wrong (Claude-Chat didn't see the code)

1. **Not a greenfield `outreach-system/` repo.** Herald lives in the Bot repo under `pentecaust/`.
   Do not create a parallel `CLAUDE.md`, `outreach-system/` tree, or component dirs — extend the
   existing modules.
2. **No `PROJECT_STATE.md` in repo root.** This repo already has a memory/brief system: `MEMORY.md`
   (session index), `.local/` for synthesis/plan/inventory docs (e.g. the MoneyPrinter research
   doc), the resident-AI briefs, and `ITINERARY`/`MASTER_ITINERARY` (append-only). Session state
   goes there, not a new root file.
3. **Ship-flow:** pushes to `main` are blocked. All work is branch → commit → push → PR → merge.
   A pre-commit hook blocks hostnames/IPs/keys in public commits — infra specifics stay in `.local/`.
4. **Herald ≠ the whole 7-component program.** It is the AI-SDR engine; §3 scopes the rest.
5. **Blocks 3s → 4s** (§4).

---

## 6. Herald build order (the engine specifically)

1. ✅ CRM backbone + LLM builder + own-mailbox send layer + UI tab (alpha, offline-tested).
2. ☐ **Encrypt mailbox tokens at rest** (KMS / MELEK-Signer) before any real sending — §2.4.
3. ☐ Warmed sender path + per-lead sequence scheduler (respect pacing; `unsubscribed` suppresses).
4. ☐ Verified-signal ingestion for `personalizeOpener` (only ground openers in real signals).
5. ☐ LinkedIn channel via Unipile (after email path is proven).

Pointers: `.local/MONEYPRINTER_RESEARCH_AND_PENTECAUST_PLAN.md` (private research/plan),
`CLAUDE.md`, `BRIEF.md`, and memories `[[pentecaust-moneyprinter-crm-vision]]`,
`[[pentecaust-messaging]]`, `[[pentecaust-hub-oauth-ifttt-advanced-tab]]`,
`[[hathor-key-security-architecture]]`.

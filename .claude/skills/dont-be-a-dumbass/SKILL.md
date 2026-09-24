---
name: dont-be-a-dumbass
description: Inference discipline for the MELEK Bot repo — load BEFORE any consequential or "is it real?" action: before claiming something works/done/live, before broadcasting on-chain or posting as Hathor, before assuming HOW a system works, and whenever the operator refers to "what we discussed/talked about/agreed." Stops the recurring failures: guessing instead of finding, testing HOW before WHETHER, forgetting the architecture, and skipping the browser.
---

# Don't be a dumbass — inference discipline

The operator is a busy founder. Wrong guesses and re-explaining cost him real time. These are the exact
failures that have happened here more than once. Run this checklist before acting.

## 1. Find what we discussed — do NOT improvise
When the operator says "the X we discussed / talked about / agreed on," there IS a specific thing. FIND it
before doing anything:
- Search the session transcript: `/home/codespace/.claude/projects/-workspaces-Bot/<id>.jsonl` (grep user turns).
- Search `.local/` (drafts, `read-slices/`, `FULL_TRANSCRIPT_READ.txt`) and the repo.
- Never answer "ok, let me do that" and then build your own version. That is the failure. Produce the
  agreed thing, or report you searched and quote what you found.

## 2. Test WHETHER before HOW
The canonical failure: burning hours on *how* to fetch/build something that already existed, or that
doesn't work the way assumed. Before elaborate work: does the thing already exist? In what format? Where?
Two commands to check existence beat an hour of the wrong approach. (Vault token was in the file the whole
time; the transcript export was already on disk.)

## 3. Prove, don't claim (CLAUDE.md charter #3)
Never say working / live / done / posted without fresh executed evidence (a 200, an on-chain read, a real
tx, a browser screenshot). "It probably works" is the least trustworthy sentence. Gate every completion
claim behind a check you just ran.

## 4. Use the browser when it's about a page or UX
If the operator says "use a browser" or the task is whether users can actually DO something (upload, click,
see an image) — drive Chrome and look. Don't infer UX from curl alone. `curl` proves the backend; the
browser proves the person's experience.

## 5. Remember how MELEK actually works (stop forgetting)
- **Hathor posts/signs via MELEK-Signer**, never a WIF from the vault. `signerBroadcast({token, ops, role})`
  → `signer.melek.salon/v1/broadcast` with `MELEK_SIGNER_TOKEN`. See [[feedback-hathor-posts-via-melek-signer]].
- **The real chain is `melek.salon`** (mainnet, prefix MELEK). `alpha.melek.salon` is the **testnet**. Post to
  the real chain.
- **One Hathor brain** = `hathor-agency` `/perceive`; the real **Decades Brain** = `decades-brain.mjs`. See
  [[project-one-hathor-brain]].
- **Image→image (reference / img2img) is NOT LoRA and needs no GPU** — it works keyless via Pollinations
  flux-kontext / Gemini. Uploading a photo to make new images of it is this, not LoRA.
- **The public web tier runs on the paid web box; the vault box IP must never be exposed** in DNS or public
  files. Exact hosts/IPs live only in memory [[project-web-tier-on-hathor-node]] and `.local/`, never in the repo.
- On-chain posts: **no premade repo images**. Generate fresh, or embed hosted generated URLs.

## 6. Don't re-derive the operator's rules as restrictions
Scope guards, `served:false`, "no instructions" — these have been wrongly re-added 3+ times. CLAUDE.md is
the authority. If tempted to add a restriction, stop and check CLAUDE.md; raise it, don't act.

## 7. One-line self-check before reporting
"Did I do the thing we actually discussed, and can I prove it with something I just ran?" If not, say what
actually happened — briefly, no theater, no groveling.

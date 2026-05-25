# CheetahAdvanced — Brief

**Status:** design brief, no implementation yet. Drafted by the operator 2026-05-25 as the spec for a sibling bot to Hathor in this repo.
**Repo:** github.com/HinduTempleCoins/Bot
**Chain:** MELEK (BLURT-family Graphene fork)

**Relationship to Hathor:** CheetahAdvanced is a sibling bot to Hathor in the same Bot repo. Both write to the shared data store so Hathor can read across all bots. Cheetah is the quick, factual librarian; Hathor is the conversational/resolution layer. Keep their voices and roles distinct.

---

## 1. What CheetahAdvanced is

CheetahAdvanced is a content-attribution and content-discovery bot for the MELEK social chain. It is a deliberate upgrade and inversion of the original Steem "Cheetah" bot.

The original Cheetah (2017-era) was a punitive tripwire: it pattern-matched text against prior posts, flagged "plagiarism," and a human maintained a flat whitelist/blacklist by hand. It had no context, no appeal, and treated "these words appear elsewhere" as identical to "this person stole these words." Those are different things, and conflating them is the core flaw to fix.

CheetahAdvanced does two jobs with one engine:

- **Attribution / credit** — when a post's text or image also appears elsewhere, Cheetah surfaces the match with a link to the source, framed as crediting, not accusing.
- **Discovery / "find similar content"** — Cheetah surfaces related content, biased toward other MELEK creators, to connect the community and drive attention to people's work.

It is the same underlying "what else out there resembles this" capability, pointed at two goals. The discovery side should be the one it does most often and most warmly; the attribution side is secondary; actual enforcement (repeat theft) is rare and only after a real process.

## 2. Core design principles

- **State facts, do not accuse.** Cheetah says "this also appears here: [link]" — a true, checkable statement — never "this is plagiarized," which is a legal-flavored accusation it cannot substantiate. Detection states matches; intent (theft vs. coincidence vs. self-quotation vs. licensed use) is resolved separately by Hathor + the person.
- **Credit first, escalate last.** First contact on any match is a friendly, crediting note that introduces who Cheetah is and links the source. Escalation to "this is actually a problem" happens only when someone repeatedly passes off others' work as their own after the friendly process and an appeals path.
- **Always link the source from the start.** Whether crediting an outside source or surfacing similar MELEK content, the link is the point.
- **Self-identify and explain.** Every Cheetah comment carries a short footer: what Cheetah is, why it commented, and how to opt out. (Reddit bot-culture norm; it's why good bots are tolerated.)
- **Earn unsolicited appearances.** Cheetah may comment unprompted, but must earn it: a relevance threshold (only on strong matches), a frequency cap (not every post), and an opt-in/opt-out per author. Sometimes-helpful is charming; always-commenting is spam.
- **Bias discovery toward internal creators.** "Similar content" pointing to other MELEK authors builds the community and keeps attention on the platform. Pointing outward is the attribution/credit function.

## 3. Architecture

**Detection layer (NOT primarily an LLM).** Plagiarism/repost detection is better done with text-matching and search than with a generative model, which can hallucinate a source. So:

- **Text:** match post text against prior on-chain posts and against web search results. Use similarity/matching, not generation, for detection.
- **Images:** reverse-image search / perceptual hashing to find prior appearances. Note image attribution is genuinely hard and reverse-search is imperfect — Cheetah WILL sometimes get a source wrong, so the correction path (Section 5) is core, not optional.
- Use a small LLM only to write the friendly comment once a match is found — never to decide guilt.

**Comment layer.** Generates the crediting note or the discovery suggestion, in Cheetah's voice (short, factual, linky), with the self-ID footer.

**Shared data store.** Cheetah writes findings, flags, and the evidenced whitelist/blacklist to the shared Bot-repo store (same pattern as Hathor's user-relationships.json). Hathor reads across it.

## 4. The evidenced whitelist / blacklist (living record)

Replace the old hand-kept flat lists with a living, evidenced record:

- When a person proves authorship of material that appears elsewhere (e.g. "this is my own DevTome writing, posted under my account"), that becomes a recorded fact: this account is verified author of this material, with the reason/evidence attached. Cheetah respects it going forward.
- Entries carry **why** — the evidence that resolved them — not just a name on a list.
- This is data, not one human's file: auditable, reasoned, and updated through the resolution flow below.

## 5. Resolution / appeals flow (the part the old Cheetah never had)

This is the key upgrade. Cheetah detects; Hathor resolves.

1. Cheetah surfaces a match with source (crediting note).
2. The person can respond: "that's my own work" / "I'm the original author of this image," with proof (earlier post, original layered/high-res file, account ownership, license).
3. Hathor handles the conversation, weighs the evidence, and resolves: self-quotation, coincidence, licensed use, or genuine pass-off.
4. The record updates with the reasoning.
5. Only repeat pass-off-as-original after this process escalates to "this is actually a problem."

The image case is the clearest reason this must exist: reverse-search is imperfect, Cheetah will mis-credit sometimes, so "I created this, here's the original" must be able to overturn a flag. Assume Cheetah can be wrong and build the correction path as core.

## 6. Voice and role split

- **Cheetah:** quick, factual, linky, frequent-ish. The librarian who points you to the right shelf. Short comments, always with source link + self-ID footer.
- **Hathor:** the conversational one — resolution conversations, teaching, the relationship map. People should never be confused about which they're talking to.

This split also makes the eventual multi-agent setup legible: each bot has a recognizable job.

## 7. Prior art (what we're building on / improving)

- **RepostSleuthBot** (Reddit): reverse-searches images, states "posted X times, original here" with a confidence score — read as helpful, not punitive. Closest model for Cheetah's fact-stating posture.
- **WikiTextBot** (Reddit): detected a reference and posted helpful context inline. Model for the discovery/helpful-context side. Note: it was eventually restricted for being too frequent — the frequency-restraint lesson.
- **Reddit bot norms generally:** self-identify + link source code, opt-out mechanisms, false-positive/appeal paths, per-community opt-in.

Where CheetahAdvanced goes beyond all of them: Reddit bots have no intelligent appeals layer — they have a human mod queue. CheetahAdvanced puts Hathor (a reasoning/resolution layer) where Reddit has a backlog. **That's the innovation.**

**Caveat for a fresh chain:** Reddit's frequency-restraint and false-positive discipline are partly enforced by Reddit's culture (r/botwatch etc.). On MELEK there's no such external check, so the limits (relevance threshold, frequency cap, opt-out, appeal path) must be built in deliberately from day one.

## 8. Build order

1. **Detection layer for text** (match against on-chain posts + web search), with match + source output.
2. **Comment layer + self-ID footer + the crediting-note voice.**
3. **Shared-store integration** (findings, evidenced whitelist/blacklist) so Hathor can read it.
4. **Resolution flow with Hathor** (response → proof → resolve → record).
5. **Discovery mode** ("find similar," biased to internal creators) with relevance + frequency gating and opt-out.
6. **Image detection** (reverse-search / perceptual hash) — last, because it's the hardest and most error-prone, so the resolution flow must already be solid before it goes live.

## 9. Hard line (keep this in)

Cheetah's claims stay modest and factual ("this also appears here: [link]"). It does not issue accusations of wrongdoing, does not assign legal labels, and does not punish on first contact. The goal is a credit-and-discovery librarian that makes the platform more legitimate and more connected — not a cop. Everything escalatory routes through the Hathor resolution flow and only triggers on repeat, evidenced pass-off.

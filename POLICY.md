# POLICY.md — MELEK / SoapBox moderation and acceptable-use policy

**Status: DRAFT.** This document is not in force. It is a working draft pending review by the operator and by legal counsel before the MELEK chain launches. Nothing here is a binding commitment until that review is complete and a launch version is published. Where this draft describes a mechanism gated on tooling or counsel (notably the illegal-content escalation path in §6), that mechanism is **not yet built and not yet operating**; the policy text exists ahead of the machinery so the platform's stance is on record.

**Scope.** This covers what is and is not acceptable on the MELEK social chain and the SoapBox surfaces that read from it, how content is surfaced and filtered, what rights a person has when an automated system gets something wrong, how data and privacy are handled, and the one narrow case — genuinely illegal content — where the platform stops being a neutral host and involves law enforcement. It is operational, not aspirational, and is meant to be read cold by a future operator or forker.

**Companion docs.** Read with `SECURITY.md` (threat model, key custody), `CHEETAH_ADVANCED.md` (the attribution/discovery bot), `cheetah/policing.md` (the policing-pipeline scope and gating), and `BRIEF.md` (the founding brief). Where this document and `cheetah/policing.md` overlap, `cheetah/policing.md` holds the technical gating detail; this document holds the public-facing statement.

---

## 1. What this platform is, and what that means for moderation

MELEK is a public Graphene-family blockchain. Content posted to it is, by the nature of the chain, append-only and distributed. SoapBox and the condenser are reading/presentation layers on top of that chain. This shapes everything below: "removal" on a blockchain is not deletion. The honest mechanism is moderation flags plus condenser-side hiding — the content stays in chain history but is not surfaced by the platform's own surfaces. We say so plainly rather than implying a delete button that does not exist.

The platform's posture is **minimal, honest moderation**:

- We surface real content and filter noise. We do not editorialize away lawful speech we disagree with.
- We credit sources rather than accuse people of theft.
- We act decisively on one category — genuinely illegal content — and there the mechanism is law enforcement, not platform vigilantism.

We are not interested in enforcement theater. We do not run a "ban" system designed to look tough. A ban on a public chain is largely cosmetic anyway: anyone can make another account. So we do not lean on it as our headline mechanism, and we do not pretend it does more than it does.

## 2. Acceptable use

You may use MELEK and SoapBox to publish, discuss, curate, and connect. In return:

- **Post your own work, or credit what isn't.** Reusing others' words or images is fine when attributed; passing them off as your own is not. The attribution bot (Cheetah) helps with this — see §4. Attribution is a courtesy-and-credit norm, not a tripwire.
- **Don't post genuinely illegal content.** This is the hard line. It is covered in §6 and is the one area where the platform's response goes beyond hiding content.
- **Don't weaponize the platform's own tooling.** False reports, mass-flagging to silence someone, and abuse of the attribution or reporting systems are themselves violations. The report mechanisms are not punishment buttons (see §6 on counter-abuse).
- **Don't impersonate, phish, or run drainers.** Impersonating the Witness, other accounts, or platform staff; posting phishing links or fake-airdrop/curation scams; or distributing malware are all out of bounds. (`SECURITY.md` §3 documents why these are the live threats here.)
- **Respect the no-personal-data posture.** Don't post other people's private information (doxxing). The platform itself minimizes what it collects (§5); users should extend the same restraint to each other.

This is not an exhaustive list of bad acts. It is the set of things the platform will actually act on. Lawful-but-disagreeable content is not on it.

## 3. The Clarity score is an honest filter, not censorship

SoapBox ranks and surfaces content using a Clarity-style score. Its job is to **surface real, substantive content and push down noise** — spam, low-effort filler, manipulation, and obvious junk. That is editorial curation of presentation, the same thing every aggregator does, and it is distinct from moderation.

What this is not:

- It is **not** a content-viewpoint filter. The score is about signal vs. noise, not agreement vs. disagreement.
- It is **not** a removal mechanism. A low score means content is surfaced less prominently, not hidden, flagged, or deleted. The content remains on-chain and reachable.
- It is **not** secret in its intent. The scoring exists to make the firehose readable, and we describe it as such rather than presenting a ranked feed as if it were neutral.

A person who believes the score has mis-ranked their content can say so; the same right-of-reply that applies to attribution and moderation (see §4 and §7) covers ranking disputes.

## 4. Attribution is credit-first, not punitive

The platform runs an attribution and discovery bot (Cheetah; see `CHEETAH_ADVANCED.md`). Its default and most common behavior is to **credit and connect** — "this also appears here: [link]," and "you might like this related work by another MELEK creator."

Principles, restated from the Cheetah brief because they are user-facing policy:

- **It states checkable facts; it does not accuse.** "This text also appears here" is a true statement. "This is plagiarized" is a legal-flavored accusation the bot cannot substantiate, and it does not make it.
- **Credit first, escalate last.** First contact on any match is a friendly, crediting note. Escalation to "this is actually a problem" only happens after a real, repeated pattern of passing off others' work — and only through the resolution flow below.
- **Detection can be wrong, so correction is built in.** Image attribution especially is imperfect. "I created this, here's the original" can and does overturn a flag. The resolution path is core, not a courtesy.
- **The bots stay in their lanes.** Cheetah states matches; Hathor handles the resolution conversation and updates the evidenced record with the reasoning. People should always know which they're talking to.

The attribution record is evidenced data — entries carry the *why* that resolved them — not one moderator's private list.

## 5. Data and privacy posture

The platform collects as little as it can:

- **Signup asks for mechanics only** — a username, what keys do, save your backups — and email for verification. It does not ask your name, purpose, history, or intentions. There is no personal-information intake at signup. (`SECURITY.md` §3d; `BRIEF.md` §6.)
- **Email verification only.** No SMS / phone numbers. Verification goes through a transactional email provider.
- **Private keys are never seen by the platform.** Keys are generated client-side in your browser and never transit the Witness's server. The platform never asks for, receives, or stores a user's private key. This boundary is absolute. (`SECURITY.md` §3d.)
- **On-chain content is public and permanent by design.** Anything you post to the chain is public and cannot be truly deleted by anyone, including the platform. Treat the chain as a permanent public record.
- **Off-chain relationship data** (the Crypt-ology per-person map, when built) is operator-held and used to serve the person, not sold or used to train third-party models. The point of native tooling is that it is the operator's instrument, not a rented service that monetizes user data.

## 6. Genuinely illegal content: refuse service, preserve evidence, report — not vigilantism

This is the one place the platform's response goes beyond hiding content. It applies to genuinely illegal material — first and foremost child sexual abuse material (CSAM), and also other clearly-illegal content such as credible threats of violence or malware distribution.

**The platform's stance is zero tolerance, and the mechanism is law enforcement — not private enforcement.**

When genuinely illegal content is identified, the platform's response is:

1. **Refuse service.** Stop surfacing the content; flag it; cut off the account's access to platform surfaces.
2. **Preserve evidence.** The content and associated records are preserved for law enforcement, per legal requirements — not quietly destroyed. On an append-only chain this interacts with immutability in a specific way (the content remains in chain history; presentation is what gets cut), worked out with the chain side.
3. **Report to the proper authorities.** For CSAM in particular, this means reporting to the appropriate body (in the US, the NCMEC CyberTipline; obligations under 18 U.S.C. §2258A) and cooperating with legitimate law enforcement requests.

**What the platform does NOT do:** pursue, harass, threaten, or take private enforcement action against users. The operator's instinct that "banning is not harsh enough" is acknowledged and deliberately bounded here: the seriousness is real, but the correct channel for genuinely illegal acts is the authorities, not the platform acting as investigator, judge, or enforcer. Going beyond refuse/preserve/report would put the operator outside the platform-operator role and into a different and worse legal posture. We will say plainly, in policy, that we cooperate fully with law enforcement against this material — and we will leave the enforcing to them.

**This mechanism is gated and not yet live.** It cannot be ad-hoc, and it is not operating today. Specifically, before it goes into force:

- **Proper detection tooling must be in place.** CSAM detection is done by perceptual-hash matching against a known-bad database (PhotoDNA / NCMEC), not by a generative model that can hallucinate a source. That requires an institutional access agreement and a compliant pipeline. We do not run a model-based CSAM "classifier."
- **The reporting party and jurisdiction must be decided** by the operator with counsel.
- **Counsel must review** the policy and the technical implementation before it goes live on a public chain. Definitions and reporting obligations vary by jurisdiction.
- **Counter-abuse controls must be built first.** False illegal-content reports are themselves a weapon used to silence people. The report path must not be a user-invocable punishment button, and there must be a process to surface and recover from wrongful flags.

Until all of the above is in place, this section describes intent and stance, not an operating system. See `cheetah/policing.md` for the technical gating and the build TODO.

## 7. Your rights when an automated system gets it wrong

Automated systems here — attribution matching, Clarity ranking, and (when live) the policing pipeline — can and will sometimes be wrong. This is assumed, not denied. So:

- **Right of reply.** You can contest any automated action against your content — an attribution flag, a low ranking, a moderation hide. You say what's wrong and, where relevant, show evidence (an earlier post, an original file, account ownership, a license).
- **A reasoning layer, not a backlog.** Disputes route through Hathor's resolution flow, which weighs the evidence and resolves with a recorded reason — rather than vanishing into a moderation queue.
- **Corrections are recorded with their reasoning.** When a flag is overturned, the evidenced record updates with *why*, so the same content isn't re-flagged later.
- **Proportionality.** First contact is never punitive. Escalation happens only on a real, repeated, evidenced pattern after the process has run — not on a single automated match.
- **Caveat on the policing path.** Wrongful-flag recovery for the genuinely-illegal-content pipeline (§6) is part of what must be built before that pipeline goes live; it is named here so the requirement is on record.

## 8. Changes to this policy

This is a DRAFT. The first in-force version will be published after operator and counsel review, ahead of chain launch. Subsequent changes will be noted with a date and a short description of what changed, so the policy's history is legible. Forkers running an alternative witness should port this document forward, keep the refuse/preserve/report posture and the credit-first stance, and update the contact and jurisdiction details to their own.

## 9. Contact

Policy questions and reports of content issues go to the operator (`mahatmajapa@gmail.com` for the founding operator; forkers update this line). Security vulnerabilities follow `SECURITY.md` §6d — reported privately, never as public issues.

---

*DRAFT — pending operator and legal-counsel review before MELEK chain launch. Not in force.*

# Safety — child protection, stated plainly

This is a public policy document. It is written to be read by the people it is about.

---

## 1. The statement

Most platforms tell you that posting child sexual abuse material "may result in account termination."
That sentence is written by lawyers to limit liability, and everyone who has ever gone looking for
children online has read it and correctly understood that it costs them nothing.

Ours says something different.

**If you are here to find children, you are not safe from being found.**

Not because we will hurt you — we will not, and we will not tolerate anyone here doing so either. You
are not safe from being **identified**, because this system is built in a way that makes what you do
visible, durable, and reportable, and because we will hand it over.

The rest of this document is the specifics, so that the sentence above is verifiable rather than
posturing.

## 2. Siring, and why grooming needs the same two things

Our reputation system, Karma, runs on **siring**: an account with standing lends its weight to bring
forward an account that has none. The one who sires and the one sired are in the same **line**
afterward, and your standing is not what you did — it is what your line became. You are scored on how
far the people you stood for went after you stood for them.

Now the uncomfortable part, which we would rather state than have someone else notice.

**Grooming requires two things: privacy, and a person who needs something.**

**Siring requires exactly the same two things.** An adult with standing, and a young or isolated
person who has none. That is not a coincidence and it is not a flaw in the metaphor — it is why this
policy is architectural instead of decorative. The good version and the predatory version begin from
identical raw material. Sustained attention to someone who needs it is either the most valuable thing
on this platform or the most dangerous, and the words for it are the same words.

Two things separate them, and both are built into the mathematics rather than into a promise.

**One: it only counts in public.** A line that cannot be seen does not score. Standing here comes
from a record — who you stood for, and what became of them — and that record is public by
construction. There is no private siring, no quiet mentorship that converts into anything you can
hold, and no way to accumulate standing through attention nobody can see. Grooming depends on
privacy between the adult and the target. Here, privacy is precisely what makes the act worthless.

**Two: it only pays until they no longer need you.** Karma's neediness weighting pays most for
lifting someone who has nothing and pays steadily less as that account grows, decaying to a floor
once they are established. Lifting the same person again and again is worth less every round. The
system pays you to make somebody independent and then to go find a different person who needs it.

That second property matters more than it looks. Sustained, escalating, exclusive attention to one
isolated newcomer is the core grooming pattern, and it is the exact behaviour the scoring punishes.
You cannot farm one person here. Fixation is unprofitable by design.

If you know the word *siring* from vampire fiction, note that ours runs backwards. A vampire's line
stays bound and stays weaker, and the one who made them keeps the advantage. Ours is scored so that
the more independent someone becomes, the less another lift from you is worth. You are rewarded for
making them not need you.

**We never introduce a person to a person.** Karma ranks *content* to curate. It does not and will
not suggest a user to another user, recommend someone to mentor, or pair a newcomer with an
established account. Automated matching of a stranger to an isolated new account is the single
mechanic that would make this system useful to a predator, and it does not exist here.

**Reputation does not buy discretion.** High standing earns curation and consideration. It does not
earn privacy, exemption from review, or the benefit of the doubt in a report. There is no rank here
that makes you harder to investigate, and a long line does not make an allegation less credible.

## 3. What happens when it is found

**Reports go to NCMEC.** As a United States provider we are required by **18 U.S.C. § 2258A** to
report apparent child sexual abuse material to the National Center for Missing and Exploited
Children's CyberTipline. We treat that as a floor, not a ceiling. The statute does not oblige a
provider to go looking (§ 2258A(f)); it obliges us to report what we find, and we do.

**Evidence is preserved, not scrubbed.** Our moderation pipeline (`integrations/flag-pipe.mjs`) is
**append-only**. A flag cannot be deleted, and resolving one records who resolved it and why. CSAM
flags are additionally **gated**: the imagery is never rendered to a reviewer, never surfaced in the
admin queue, and is escalated off-pipe to counsel and NCMEC. Reviewers do not view the material, and
the material does not disappear.

**Deleting your account does not delete the record.** The append-only log and the public lineage
graph are not yours to erase.

**We cooperate with law enforcement**, and we will not treat a criminal investigation into this as a
privacy dispute with our user.

## 4. What we will not do

This document is not an invitation to anyone.

**We do not encourage or tolerate vigilantism.** Do not threaten, dox, stalk, entrap, or organise
against anyone on this basis. If you do, you will be removed, and you will have damaged a real
investigation while you were at it. Accusations made publicly to punish rather than reported to be
investigated help the accused far more than they help any child.

**We do not run a registry**, publish accusation lists, or invite users to compile them. An
allegation is not an adjudication, and a platform that treats it as one is a weapon that will
eventually be pointed at someone innocent.

**Report it to us and to NCMEC** — [report.cybertip.org](https://report.cybertip.org) — and let it be
handled by people who can actually act on it.

## 5. Scope, and honesty about limits

We are a small operation. We do not claim to detect everything, we do not run proactive scanning of
private content, and we will not pretend that publishing a policy makes children safe. What we claim
is narrower and true: the way this system is built makes the relevant behaviour visible rather than
private, the incentives push against the pattern rather than enabling it, there is no feature here
that will introduce you to a child, and what we find goes to the people whose job it is.

If you believe a child is in immediate danger, contact your local emergency services first.

---

*Related: `SECURITY.md` (systems and key custody), `integrations/flag-pipe.mjs` (the moderation
spine), `.local/KARMA_BENEFIT_SOCIETY_DESIGN.md` (the standing model and its bright lines).*

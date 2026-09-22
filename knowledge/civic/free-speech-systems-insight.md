# Free Speech & Sedition — what this body of law means for MELEK's own systems

*Internal insight doc. Rev. 2026-09-22. Companion to the public teaching surface at `site/free-speech/`*
*and its corpus `knowledge/civic/free-speech.json`. This is the "insight into things our systems will*
*need" the operator asked for — grounded in the doctrine we researched and cited for the public pages.*

> Not legal advice; this is an engineering/policy orientation for the people building MELEK's speech
> surfaces. Where it names a legal rule it cites the same verified authority the public surface uses. A
> platform-specific legal question that turns real money or liability should go to counsel.

---

## 0. Why free-speech/sedition law is a *systems* concern, not just a teaching topic

We are not only teaching this law — we are operating inside it. MELEK runs (or will run) surfaces where
third parties speak: the **trollbox / signup chat**, **comment threads** on Hathor's posts and on the
site verticals, the **on-chain corpus** itself, and Hathor's **own authored posts and grants**. The
moment we host other people's words we inherit the publisher/conduit question, the intermediary-liability
question, and the incitement/true-threats hard line. And because the chain is **censorship-resistant by
design**, we have the mirror-image problem too: we cannot simply "take it down." The doctrine tells us
exactly where the one non-negotiable line is, and where we actually have discretion.

**The single most load-bearing fact:** in U.S. law, moderating is *not* censoring, and a private platform
has no First Amendment duty to carry anyone's speech. The First Amendment binds the *government*, not us.
So "censorship-resistance" is a product and trust decision we make voluntarily — it is not compelled, and
it does not exempt us from the narrow categories of unlawful content. Keep those two ideas separate in
every design conversation.

---

## 1. We are simultaneously a *publisher* and a *conduit* — and the two roles carry different exposure

Draw the line explicitly per surface, because our liability posture flips across it:

- **Hathor's own posts, price feeds, grants, and the curated knowledge corpus = we are the *publisher*.**
  These are our speech. We own them fully — including the accuracy, the defamation exposure, and the tone.
  This is where the `NYT v. Sullivan, 376 U.S. 254 (1964)` "actual malice" standard actually matters *to
  us as a potential defendant*: if Hathor asserts a false fact of and concerning a real person, "it was
  the AI" is not a defense. Hathor should state opinion as opinion, cite facts to sources (the discipline
  the Law and Free-Speech surfaces already model), and never manufacture factual claims about identifiable
  people. This is the Charter §3 "prove, don't claim" rule wearing a defamation hat.

- **Trollbox, comment threads, user-submitted signup chat = we are a *conduit* for others' speech.**
  In the U.S., **47 U.S.C. § 230** is the reason a platform is generally not treated as the publisher/
  speaker of user-generated content, and — critically — the reason that *moderating* content does not
  convert us into the publisher of everything we leave up (the "Good Samaritan" provision). The practical
  design consequences:
  - Keep a clean architectural boundary between "Hathor speaking" and "a user speaking," in the data
    model and in the UI. Never render user content in a way that reads as Hathor's own statement.
  - § 230 does **not** cover federal criminal law, intellectual property, or (post-FOSTA) sex-trafficking
    content. So the conduit shield is broad but not total — the hard-line categories in §3 below sit
    *outside* it.
  - § 230 is a U.S. statute. The chain and the pool are global; other jurisdictions (EU DSA, UK Online
    Safety Act, etc.) impose affirmative duties § 230 does not. Treat § 230 as the floor of our safest
    market, not a worldwide guarantee.

**Design takeaway:** tag every speech surface in code as `role: "publisher"` or `role: "conduit"`, and
let that tag drive both the moderation policy and the disclaimer we render. We already do the analogous
thing with the Law surface's "facts, not verdicts" footer — extend the pattern.

---

## 2. The two-voice discipline (already used on World Law) *is* our free-speech-aware editorial stance

We already state contested political matters in two voices on the World Law / political-philosophy
surfaces (the `political-philosophy.json` file literally carries a "strict descriptive neutrality" note).
That is not just good taste — it is the right posture for a speech platform, and it maps onto real
doctrine:

- It keeps our *publisher* speech (§1) on the safe side of defamation and of "endorsing" a contested
  claim: describing competing positions with sources is not asserting a false fact.
- It models, for our *conduit* users, the difference between **advocacy** (protected) and **incitement/
  threats** (not) — see §3. A surface that itself refuses to flatten contested questions teaches users
  that disagreement is handled by more speech, not by suppression. That is the `Abrams` (1919) Holmes
  "marketplace of ideas" logic and the `Brandenburg` (1969) preference for counter-speech over bans,
  operationalized as house style.
- It is forkable and model-independent (BRIEF.md §10): a neutral, sourced editorial stance survives
  operator and model changes far better than a set of hot takes would.

**Design takeaway:** make two-voice the default for any surface touching contested political, legal, or
religious matter — including anything Hathor autonomously posts in Phase 3 — and encode it the way the
Free-Speech surface does: state the positions, cite the authority, decline to adjudicate.

---

## 3. Incitement and true threats are the ONE hard line even a speech-maximal platform must police

This is the crux, and it is *narrow* — which is exactly why it is enforceable without becoming a
censorship regime. A speech-maximal platform can and should carry offensive, hateful, radical, and
revolutionary speech (all generally protected; see `Texas v. Johnson`, `Snyder v. Phelps`). But two
categories are genuinely dangerous to leave up, both because they can cause real harm and because they
fall outside § 230's civil shield and/or expose us and our users to criminal exposure:

1. **Incitement to imminent lawless action** — `Brandenburg v. Ohio, 395 U.S. 444 (1969)`. Get the test
   *exactly* right in any moderation rule or classifier: content is over the line only when it is
   **(1) directed to inciting or producing imminent lawless action AND (2) likely to produce it.** Both
   prongs. "Directed + likely + imminent." A rant calling for revolution someday is protected; "everyone
   grab a weapon and go to that address right now" is not. Do not let a classifier collapse this into
   "mentions violence" — that would sweep in the protected majority and be both wrong and unshippable.

2. **True threats** — `Counterman v. Colorado, 600 U.S. 66 (2023)`. A serious expression of intent to
   commit unlawful violence against a person, where the speaker acted with at least **recklessness** as
   to how it would be understood. This is the category most likely to appear in a trollbox aimed at a
   real user, and the one where fast removal + preservation-for-report is the right reflex.

Everything else — spam, harassment short of true threats, bigotry, off-topic noise — is a *product/
community* decision we are free to make (§ 230 protects the moderation), not a legal *must*. Keep the
"must police" list short and legally grounded; keep the "may moderate" list a policy knob. Conflating the
two is how platforms both over-censor and miss the genuinely dangerous 1%.

**Design takeaway:** a single, well-documented `hard-line` policy module (incitement per Brandenburg's
two prongs; true threats per Counterman's recklessness standard; plus the § 230 carve-outs: federal
crimes, CSAM, IP, sex-trafficking) that applies to *every* conduit surface, separate from the tunable
community-standards layer. Log and preserve on removal; do not silently drop, because these can be
reportable to law enforcement and evidence matters.

---

## 4. A censorship-resistant chain vs. unlawful-content liability — the real tension, and how to resolve it

The chain corpus is durable and hard to alter by design (forkability is load-bearing per BRIEF.md §10).
That is a genuine feature and it directly attacks the "panopticon" mechanism the surveillance research
describes — there is no central watcher who can quietly make speech disappear. But it collides with §3:
if the one hard-line category *does* land on-chain, we cannot unpublish it. Resolve the tension at the
layers where we *do* have control, not by pretending the chain will police itself:

- **Push the choke point to the edges, not the ledger.** We control what our *interfaces* surface — the
  condenser, the trollbox front-end, the site readers, Hathor's recall path. Hard-line content can be
  filtered at *presentation* even if it is immutable at *storage*. This is the standard resolution:
  immutable base layer, moderated application layer. (Note the operator's standing rule: filtering is for
  the §3 hard line and legal carve-outs only — it is *not* a lever to re-litigate settled in-scope corpus
  like the harm-reduction/neurostim shelves. See CLAUDE.md scope guards.)
- **The key-custody boundary is also a liability boundary.** BRIEF.md §7 already keeps user private keys
  client-side and the signer off this host. That same boundary means the Witness is a *conduit* for what
  users broadcast, not the *signer* of it — preserve that separation; it is what keeps "a user posted X"
  from becoming "Hathor published X."
- **Hathor must never be the one who crosses the sedition line.** The `18 U.S.C. § 2384` teaching is not
  abstract for an autonomous poster: the crime is an *agreement to use force*, and the protected side is
  advocacy/dissent. Hathor operates permanently on the protected side — it may host, describe, and
  contextualize radical speech (that is in-scope, and the revolution/ corpus is operator-authored
  advocacy we *teach about*), but it must never itself agree to, plan, or direct force, and never author
  a true threat or Brandenburg-style incitement. Encode this as a Phase-3 system-prompt invariant, not a
  hope.
- **Jurisdiction is not a switch you flip** (the same lesson the Law `/rights` surface teaches against
  sovereign-citizen pseudolaw). "It's on a decentralized chain" is not an immunity from federal criminal
  law any more than "I declared myself sovereign" is. Design as if the safe-harbor is § 230 + good-faith
  moderation of the hard line, not as if decentralization is a legal force field.

---

## Recommendations (the short version)

1. **Tag every speech surface `publisher` vs `conduit`** in code; drive moderation policy and disclaimers
   off that tag. Hathor's posts/corpus = publisher (own the accuracy; no fabricated facts about real
   people — Charter §3 = anti-defamation). Trollbox/comments = conduit (rely on § 230; keep the
   Hathor-vs-user boundary clean in data and UI).
2. **Ship one small, legally-grounded `hard-line` module** applied to all conduit surfaces: Brandenburg
   two-prong incitement + Counterman recklessness true-threats + § 230 carve-outs (federal crime, CSAM,
   IP, trafficking). Log + preserve on removal. Keep every other moderation call in a *separate*,
   tunable community-standards layer.
3. **Make two-voice the default** for contested political/legal/religious content on every surface,
   including anything Hathor autonomously posts — it is both our editorial stance and our defamation/
   endorsement safety margin.
4. **Moderate at the presentation edge, never claim to moderate the ledger.** Immutable storage +
   filtered interfaces resolves the censorship-resistance/liability tension; keep the signer/key boundary
   (BRIEF.md §7) intact as the conduit/publisher firewall. Filtering is for the hard line only, not for
   re-opening settled in-scope corpus.
5. **Bake "Hathor stays on the protected side of § 2384" into the Phase-3 system prompt** as an
   invariant: host and contextualize radical speech; never author threats, incitement, or an agreement to
   use force.

# Benefit Societies & Mutual-Aid Infrastructure

*Research writeup for the MELEK / Hathor ecosystem. Rev. 2026-09-22. Corpus doc — the load-bearing
finding is the regulatory perimeter in §4; the build that follows it is `integrations/benefit-society.mjs`.*

Mutual aid is the oldest financial technology humans have: a group agrees, under a shared charter, to
pay in regularly so that when one member is sick, bereaved, or in need, the group helps them. It
predates the insurance industry and the welfare state, and it is exactly the shape of thing MELEK
already has the primitives for — a Pact with a charter, dues, and degrees of standing, plus Hathor's
fund, karma, grants, and bounties. This document covers what these societies are, how they historically
worked, and — the part that governs whether we can build any of it — **where the regulatory line falls
between coordination we can ship now and pooled benefits that make you a licensed insurer.**

## 1. Fraternal benefit societies (US — 501(c)(8) and 501(c)(10))

A **fraternal benefit society** operates under the **lodge system**: a supreme governing body plus
subordinate local lodges/chapters into which members are initiated under a constitution and ritual, with
lodges meeting regularly. Historically these societies (the Odd Fellows, Woodmen, Knights of Columbus,
the Black mutual-aid and immigrant benefit societies, and thousands of small ethnic and trade lodges)
provided **sickness, accident, death, and burial benefits, and orphan/widow care** to members, funded
from members' own dues — the private safety net before Social Security.

The tax code splits them in two, and the split is the whole game:

- **IRC 501(c)(8) — fraternal *beneficiary* society.** Operates under the lodge system **and provides
  for the payment of life, sick, accident, or other benefits** to members/dependents. Not every member
  need be covered, but most must be eligible and benefits are paid from members' dues.
- **IRC 501(c)(10) — *domestic* fraternal society.** Operates under the lodge system but **does NOT
  itself pay life/sick/accident benefits**; instead it devotes its net earnings to religious,
  charitable, scientific, literary, educational and fraternal purposes. It *may* arrange elective
  coverage through an independent, licensed insurer, but it is not the insurer itself.

**The load-bearing consequence (see §4):** the moment a society *pays the benefits itself out of pooled
dues*, it is an insurer in the eyes of state law. The 501(c)(10) "domestic fraternal" lane — charitable
purposes, no self-paid insurance benefits — is the lane a records-and-coordination tool keeps a group
inside of.

## 2. Friendly societies, mutual-aid / benevolent societies, burial societies, ROSCAs

- **Friendly societies (UK / Commonwealth).** The same institution under a different name: mutual
  associations for insurance, pensions, savings, or cooperative banking. Registered and regulated since
  the first **Friendly Societies Act 1793**; today the **Friendly Societies Acts 1974 and 1992** govern
  them, with prudential oversight (FCA/PRA) precisely because they promise members future benefits.
- **Mutual-aid / benevolent societies.** The generic term — a mutual association pooling contributions
  for members' welfare. Modern grassroots "mutual aid networks" (the phrase surged during COVID) are the
  informal descendants; most survive by staying informal and never custodying a pool.
- **Burial societies.** The narrowest and oldest form — members pay in so that a member's funeral is
  covered. Jewish burial societies and other burial clubs were direct precursors of commercial
  insurance, which is exactly why a burial "benefit" trips the insurance wire today.
- **ROSCAs (rotating savings & credit associations)** — **tandas** (Mexico), **susus** (West Africa /
  Caribbean), **chit funds** (India/South Asia), **hui**, **ekub**, etc. A fixed group contributes a set
  amount each period and takes turns receiving the whole pot. No interest, no institution — pure
  peer-to-peer rotation built on social trust. **ASCAs** accumulate a fund and lend from it instead of
  rotating.
- **DAO / crypto analogues.** "Mutual aid DAO" experiments and crypto relief funds (e.g. the
  COVID-Crypto Relief Fund) recreate the pattern on-chain: token-holder governance decides who receives
  from a shared treasury held in a smart contract. The legal status of a DAO holding and paying out a
  pooled fund is unsettled — and it collides with the same two perimeters below (insurance + money
  transmission), now with custody enforced by code rather than a treasurer.

## 3. How this maps to MELEK / a 501(c)(3) religious org + on-chain community

The operator runs a **Shaivite Temple 501(c)(3)**, and MELEK has Hathor's fund, karma, grants, and
bounties. That is a strong, *safe* footing for mutual-aid infrastructure specifically because a
501(c)(3) (or the 501(c)(10) fraternal lane) is **not** an insurer: it can **coordinate** aid, **keep
the records**, and make **discretionary grants** from its own funds to people in need — a charitable act,
not the payment of a promised insurance benefit. The distinction that keeps it charitable rather than
insurance: **discretion and no entitlement.** A member who paid dues is not *owed* a payout; the society
reviews each request and grants at its discretion. The instant "pay dues → you are entitled to $X on
event Y" appears, it is an insurance contract regardless of what it is called.

## 4. The regulatory perimeter — the load-bearing finding

This mirrors the discipline already encoded in `integrations/soapbox/donate-directory.mjs` (never touch
the money → not a money transmitter, not a charitable-fundraising platform under CA AB 488). For benefit
societies the same instinct meets **two additional walls**:

**(a) State insurance regulation — the big one.** In essentially every US state, an organization that
**pools members' contributions and pays out sickness / death / accident / burial / annuity benefits** is
a **fraternal benefit society regulated as an INSURER** under the state insurance code — the framework
built on the **NAIC Model Fraternal Benefit Society Act** (Model #675 / the Uniform Fraternal Code),
which most states have adopted in some form. That means a state charter/license, a lodge-system
requirement, no capital stock, reserve requirements, issued benefit certificates, and examination by the
state insurance department. **This is a licensing project, not a software feature.** A tool that promises
and pays benefits from a pool without that license is an unlicensed insurer.

**(b) Money-transmitter licensing.** Under FinCEN's rules (**31 CFR 1010.100(ff)** — money services
businesses / money transmitters), **accepting** currency, funds, or value that substitutes for currency
from one person and **transmitting** it to another is money transmission, and doing it as a business
requires FinCEN registration plus (in most states) a state money-transmitter license. **Custody is the
trigger, not margin** — the same point donate-directory makes about taking a cut. A ROSCA payout, or "we
collect dues and forward them to the member in need," run *through us*, is money transmission.

**(c) Charitable-solicitation registration.** As donate-directory already reasons: soliciting or
handling charitable donations pulls in ~40 states' charitable-solicitation registration and, since 2023,
California AB 488's "charitable fundraising platform" rules (AG registration, charity consent, quarterly
reporting). A direct link — donor/member pays the org directly — needs none of it.

### The split we build to

| | **Build now (records-only)** | **Needs a license (NOT this repo)** |
|---|---|---|
| Member registry, roles, standing/degrees | ✅ | |
| Charter, dues *terms* (amounts, cadence) | ✅ | |
| Contribution **ledger** (records payments made on an external rail) | ✅ | |
| Claim **workflow** (request → governance review → recorded decision) | ✅ | |
| Pool **accounting** (balances as records) | ✅ | |
| Payout as an **unsigned intent / discretionary grant** the treasurer settles | ✅ | |
| Actually **holding/pooling** members' dues | | ❌ money transmitter / insurer |
| **Promising & paying** sickness/death/burial/annuity benefits from the pool | | ❌ insurer (NAIC act) |
| **Forwarding** one member's money to another (ROSCA run through us) | | ❌ money transmitter (FinCEN) |

**Coordination + ledger + records that never custody member funds = low regulatory burden, buildable
now.** **Pooling and paying out benefits = regulated insurance/transmission = not something to custody
for people without licensing.** The module encodes this as `BENEFIT_MODELS` (`records-only` buildable
= true; `insurer` and `transmitter` buildable = false) and refuses to hold money by construction.

## 5. What we built

`integrations/benefit-society.mjs` (+ `.test.mjs`, 18 offline tests) — a pure, house-style module for a
mutual-aid / benefit society as a **coordination + ledger** layer that **does not custody member funds**.
It is a specialization of the **Pact** primitive (`site/pact/server.mjs`,
`pentecaust/groups/model.mjs`): the Pact gives it a charter, members, dues terms, and degrees of
standing; this module adds the mutual-aid ledger and the claims workflow. It reuses the **no-custody**
posture of `donate-directory.mjs`, the **unsigned-intent hand-off** of `bounty-board.mjs`, and the
**scoped-capability** thinking of `grant-runner.mjs` (an approved claim yields a *payout intent* the
society's own treasurer / MELEK-Signer / Hathor's grant path settles — never a transfer performed here).

Roles mirror the Groups hierarchy (owner/admin/steward/member). Standing captures the friendly-society
rule that a member "out of benefit" (in arrears) cannot claim until dues are current. Claims require a
charter **quorum** of steward+ reviews and a majority before an admin closes them. Money never enters the
module — contributions are records of payments that already happened on an external rail, and payouts are
intents.

## Sources

- IRS, *IRC 501(c)(8) Fraternal Beneficiary Societies and 501(c)(9) Voluntary Employees' Beneficiary Associations* — https://www.irs.gov/pub/irs-tege/eotopicf04.pdf
- IRS Publication 557, *Tax-Exempt Status for Your Organization* — 501(c)(8) and 501(c)(10) — https://taxmap.irs.gov/taxmap/pubs/p557-028.htm
- IRS, *Fraternal organizations: What constitutes a lodge system?* — https://www.irs.gov/charities-non-profits/fraternal-organizations-what-constitutes-a-lodge-system
- NAIC, *State Licensing Handbook, Chapter 21 — Fraternals and Small Mutuals / Fraternal Benefit Societies* — https://content.naic.org/sites/default/files/inline-files/Chapters%2021-25.pdf
- NAIC, *Model Fraternal Benefit Society Act / Uniform Fraternal Code (Model #675)* — https://content.naic.org/sites/default/files/model-law-675.pdf
- Wagenmaker & Oberly, *A Peek Inside Fraternal Societies — 501(c)(8) and 501(c)(10)s* — https://www.wagenmakerlaw.com/blog/peek-inside-fraternal-societies-501c8-and-501c10s
- Wikipedia, *Friendly society* — https://en.wikipedia.org/wiki/Friendly_society
- LexisNexis UK, *Registration & regulation of friendly societies (Friendly Societies Acts 1974 & 1992)* — https://www.lexisnexis.com/en-gb/legal/guidance/the-registration-regulation-of-friendly-societies
- Wikipedia, *Rotating savings and credit association* — https://en.wikipedia.org/wiki/Rotating_savings_and_credit_association
- Wikipedia, *Burial society* — https://en.wikipedia.org/wiki/Burial_society
- CoinDesk, *What Would a Mutual Aid DAO Look Like?* — https://www.coindesk.com/business/2021/12/10/what-would-a-mutual-aid-dao-look-like
- FinCEN, 31 CFR 1010.100 general definitions (money transmitter / MSB) — https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100
- FinCEN Guidance FIN-2019-G001 (money-transmission facts-and-circumstances test) — https://www.fincen.gov/system/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf
- (Internal) `integrations/soapbox/donate-directory.mjs` — the "we never touch the money" precedent (AB 488 + money-transmitter reasoning)

# Spirit of the Laws — teaching corpus

`spirit-of-the-laws.json` is a verified teaching corpus + reusable blurb/example bank on
Montesquieu's *The Spirit of the Laws* (De l'esprit des lois, 1748) and **judicial
interpretation-by-purpose** (purposivism / the mischief rule / the letter-vs-spirit debate),
plus the separation-of-powers doctrine Montesquieu gave the American Framers.

The thesis it teaches (operator's framing): Montesquieu gave us *both* separation of powers *and*
the idea that a law has a **spirit/purpose**, not just a letter. Teach both — and, crucially,
**show real cases where judges actually do this**: interpret by the spirit/purpose of the law, or
cite Montesquieu by name. "Give books to read and examples to study."

## What's in the JSON

- `montesquieu` — what the 1748 work is, the separation-of-powers doctrine, its influence on the
  Framers / Federalist Papers (esp. Nos. 47 & 51), and the letter-vs-spirit / purpose idea.
- `cases[]` — **real, verified opinions** where a court read for the spirit/purpose of the law or
  cited Montesquieu. Each entry: `case, citation, year, court, holding, method, quote, pincite,
  source_url, teaching_blurb` (some carry `secondary_quote`, `quote_note`, `source_url_alt`).
  `method` is one of: `purposivist`, `mischief-rule`, `separation-of-powers-Montesquieu`,
  `plain-meaning-counterpoint`.
- `counterpoint` — the textualist critique (Scalia; the plain-meaning rule) so the teaching is
  balanced and honest.
- `reading_list[]` — verified real editions/authors, each with a one-line *why*.
- `blurbs` — short, drop-in teaching snippets keyed by theme (`separation-of-powers`,
  `letter-vs-spirit`, `mischief-rule`, `purposivism`, `original-intent`, `textualist-counterpoint`,
  `montesquieu-alive`), **each ending with a real case cite**.

## How surfaces should embed the blurbs

This corpus is **data only**. The teaching surfaces (site/lexicon, site/philosophy, site/politics,
site/law appeals) embed the **same sourced examples** in their own blurbs — they should read from
this JSON (directly, or via the loader) rather than re-typing quotes:

- Drop-in one-liner for a page byline / callout: pick `blurbs[<theme>]` verbatim — it already ends
  with a real cite.
- A full study card: render a `cases[]` entry — `quote` in a blockquote, `pincite` + `source_url`
  as the attribution, `teaching_blurb` as the gloss.
- Filter the study examples by interpretive method with `casesFor(<method>)` (see the loader).

Surfaces must keep the `pincite` and `source_url` attached to any quote they display — the sourcing
is the point (see below). Do **not** paraphrase a quote into something the opinion did not say.

## Sourcing standard (Bot Charter §3 — prove, don't claim)

This is legal-education material people will rely on, so:

- **Facts + sources, never invented.** Every case carries a `source_url` to a reputable text
  (official U.S. Reports / Library of Congress, the New York official reporter, Cornell LII, FindLaw,
  Justia/CourtListener, or the English Reports for Heydon's Case) and a `pincite`.
- **No fabricated quotes or citations, ever.** Each quote was verified verbatim against a primary
  opinion or a named reputable secondary source (e.g. the *Harvard Law Review*).
- **Honest gaps are marked, not hidden.** Where an exact quote or pincite could not be confirmed
  against a primary text, the `quote` field is `null` (or carries a `quote_note`) that says
  "verify at source_url." Two entries currently carry such a note:
  - **INS v. Chadha** (White, J., dissenting) — Montesquieu-by-name quote is reported by the
    *Harvard Law Review*; the exact wording/pincite within the dissent (begins 462 U.S. 967) should
    be confirmed against the primary opinion before it is quoted as verbatim.
  - **Clinton v. City of New York** (Kennedy, J., concurring) — the liberty passage is from the
    concurrence; confirm exact wording and whether Montesquieu is named at the pincite.
  - **King v. Burwell** — quotes verified; the exact page is cited variously (491/498) and should be
    confirmed at `source_url`.

## The verified cases (summary)

Ten opinions, spanning 1584→2015:

- **Riggs v. Palmer**, 115 N.Y. 506 (1889) — murderer-heir; spirit of the wills statute. *purposivist*
- **Church of the Holy Trinity v. United States**, 143 U.S. 457, 459 (1892) — "letter... spirit...
  intention of its makers." *purposivist*
- **Heydon's Case** (1584) 76 Eng. Rep. 637 (Exch.) — the mischief rule. *mischief-rule*
- **Mistretta v. United States**, 488 U.S. 361, 380 (1989) — **cites Montesquieu by name.**
- **Bowsher v. Synar**, 478 U.S. 714, 722 (1986) — **cites Montesquieu by name.**
- **INS v. Chadha**, 462 U.S. 919, 967 (1983) (White, J., dissenting) — **names Montesquieu**
  ("the oracle of the separation doctrine"); quote to verify at source.
- **United States v. American Trucking Ass'ns**, 310 U.S. 534, 543-44 (1940) — purpose over literal
  words. *purposivist*
- **King v. Burwell**, 576 U.S. 473 (2015) — "improve health insurance markets, not to destroy them."
  *purposivist*
- **Clinton v. City of New York**, 524 U.S. 417 (1998) (Kennedy, J., concurring) — separation of
  powers as a liberty guarantee (Montesquieu link per HLR).
- **Caminetti v. United States**, 242 U.S. 470, 485 (1917) — the plain-meaning **counterpoint**.

## Loader

`integrations/soapbox/spirit-of-the-laws.mjs` is a small pure module over this JSON:
`load()`, `cases()`, `casesFor(method)`, `blurbsFor(theme)`, `readingList()`, `montesquieu()`,
plus `renderCase()` / `renderBlurb()` escaped-HTML helpers. Offline, soft-fail, never throws.
Run `node integrations/soapbox/spirit-of-the-laws.mjs` for a CLI demo; tested by
`spirit-of-the-laws.test.mjs` (`node --test`, no network).

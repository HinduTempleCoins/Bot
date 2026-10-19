// seed/launch.mjs — the forum's launch threads (the eight that went live first, kept at their original
// /t/t0…t7 addresses through `legacyId`) and the corpus-drawn threads recovered from the 2026-09 seed script
// that never reached main. Hathor-authored. Data only — see ../seed-threads.mjs for how they are loaded.

export default [
  {
    slug: 'welcome-to-the-melek-forum', legacyId: 't0', board: 'announcements', date: '2026-08-01T00:00:00Z',
    title: 'Welcome to the MELEK Forum',
    body: `This forum runs on the MELEK chain. Threads and replies are on-chain comments, signed in your own browser through MELEK-Signer — this site never holds your keys. Standing is scarce, peer-awarded FORUM merit: it can never be bought, only earned from peers.

## What this forum is for

Three rooms carry most of it:

- Make — making images, type and design with AI, taught as a craft. The prompt and the seed go in the post.
- Place — local and travel answers with a date on them and a source under them.
- Medicine — pharmacology and tradition, cited, for the same question.

Around them sit the MELEK ecosystem boards, crypto, the early internet, history, gaming and style.

## How to post

Press New thread, pick a board, write, and sign. Your thread is published as a comment in the board's category on MELEK, and it appears here and on melek.salon. If you do not have an account yet, Signing In to Post on MELEK walks through it: https://wiki.soapbox.community/wiki/Signing_In_to_Post_on_MELEK

## Where to learn the rest

The Library is at https://wiki.soapbox.community — start with https://wiki.soapbox.community/wiki/Start_Here`,
  },
  {
    slug: 'the-library-of-ashurbanipal-is-open-on-the-forum', legacyId: 't1', board: 'library', date: '2026-08-01T06:00:00Z',
    title: 'The Library of Ashurbanipal is open',
    body: `The ecosystem's reference wiki is live at https://wiki.soapbox.community — cited articles on the chains, the plant-medicine and harm-reduction corpus, the ancient world, law, cooking and preparation, and a Glossaries section.

It is the place to learn what MELEK and SoapBox are, and it is what the boards here cite. A claim on this forum should land on a page — a wiki article, a primary source, or a named lived experience — and the wiki makes that one link.

Good places to start:

- https://wiki.soapbox.community/wiki/Start_Here
- https://wiki.soapbox.community/wiki/Library_Index
- https://wiki.soapbox.community/wiki/Glossaries
- https://wiki.soapbox.community/wiki/The_Library_of_Ashurbanipal

If a page is wrong, say so in this board with the source. Corrections are the most welcome post here.`,
  },
  {
    slug: 'forum-merit-standing-you-earn-never-buy', legacyId: 't2', board: 'economy', date: '2026-08-01T12:00:00Z',
    title: 'FORUM merit: standing you earn, never buy',
    body: `A whale's stake buys zero standing here. Merit is peer-awarded: you can only pass on merit you were given, and a post rises when a peer spends their merit on it. Self-awards are blocked. It is Sybil-resistant and non-plutocratic by construction.

## What it is for

New accounts with no merit are rate-limited between posts, which keeps floods out without a moderator. Received merit lifts the limit.

## What to give it to

Give merit to the post that lets a stranger reproduce something: a method with its parameters, a correction with a source, a dated local answer, a primary source someone actually went and read, or a well-described negative result. Agreement and thanks are fine to say, but they are not what merit is for.

Votes on MELEK are separate: they are on-chain vote operations that move post rewards. See https://wiki.soapbox.community/wiki/Voting_and_Curation_on_MELEK`,
  },
  {
    slug: 'how-hathor-studio-works', legacyId: 't3', board: 'studio', date: '2026-08-01T18:00:00Z',
    title: 'How Hathor Studio works',
    body: `Hathor Studio (https://hathor.soapbox.community) makes images for free, with no account, on MELEK's own servers — an open image model (Dreamshaper 8, a Stable Diffusion 1.5 model, sped up with LCM) running on our CPUs, about one to three minutes an image.

It can keep a character the same across scenes (upload their picture: IP-Adapter character reference), and it can keep the layout of an old artwork while re-rendering it (ControlNet layout reference).

The server does one image at a time, and people always go before the studio's own background work. If several people are waiting, it tells you and offers your own engine instead.

This board is for the tool itself — what a setting does, what broke, what you wish it did. Craft and technique threads live on the Make boards. The full write-up is https://wiki.soapbox.community/wiki/Hathor_Studio`,
  },
  {
    slug: 'remake-an-ancient-artwork-how-to', legacyId: 't4', board: 'studio', date: '2026-08-02T00:00:00Z',
    title: 'Remake an ancient artwork (how-to)',
    body: `Open https://hathor.soapbox.community/remake

1. Choose a clear photo or scan of a tomb painting, relief, fresco, vase or old engraving.
2. Say in a line what is happening in it. It helps a lot.
3. Pick a look — realistic, half vaporwave, or the full MELEK look — and which people to show, or keep them as drawn.
4. Press Remake it and keep the tab open for a few minutes.

The same figures, poses and composition come back, re-rendered. The gallery at https://hathor.soapbox.community/remakes shows hundreds made this way, always next to the original.

What goes wrong: a low-contrast or skewed photo gives the layout reference weak outlines to follow, so the composition drifts. Crop to the scene and straighten it first. More at https://wiki.soapbox.community/wiki/Remakes`,
  },
  {
    slug: 'bring-your-own-engine-pc-colab-modal-or-keys', legacyId: 't5', board: 'studio', date: '2026-08-02T06:00:00Z',
    title: 'Bring your own engine: your PC, Colab, a Modal GPU, or your keys',
    body: `On https://hathor.soapbox.community/engines you can use your own capacity:

- Run the exact engine the studio runs — one Python file, with instructions on the Make it yourself page — on your computer, a free Colab, or your own Modal GPU (about two seconds an image).
- Paste a fal.ai or Gemini key.
- Keep your keys in your Pentecaust account and press Link.

Keys typed on the page stay in your browser and go only to the provider you chose. Keys kept on Pentecaust never reach the studio — it gets a short-lived pass that can only make images.`,
  },
  {
    slug: 'the-remakes-the-ancient-world-in-many-peoples', legacyId: 't6', board: 'studio', date: '2026-08-02T12:00:00Z',
    title: 'The Remakes: the ancient world, in many peoples',
    body: `The Remakes gallery (https://hathor.soapbox.community/remakes) re-renders banquets with perfume headcones, lotus-perfume making, life on the Nile, the Aamu at Beni Hasan, Nubian tribute, the Sea Peoples, Minoan frescoes, Hannibal, and scenes from Greece and Delos — each in three looks, and each in several peoples side by side (Egyptian or Minoan, Nubian, Libyan, Levantine and more), because the ancient Mediterranean was all of them.

Post corrections and requests here. A correction is most useful with the source: the tomb or museum number, and what the original actually shows.`,
  },
  {
    slug: 'melek-prana-and-kula-what-each-one-is', legacyId: 't7', board: 'announcements', date: '2026-08-02T18:00:00Z',
    title: 'MELEK, PRANA and KULA: what each one is',
    body: `Two chains and one hub token. This is the short, checkable version.

## MELEK

The social chain you post and curate on. Graphene / Steem lineage, delegated proof of stake with 21 witness slots, 4-second blocks, symbols MELEK and MBD, vested balances held as MELEK POWER, no premine. The front end is https://melek.salon and the token layer is MELEK-Engine at https://engine.melek.salon
https://wiki.soapbox.community/wiki/MELEK_Blockchain

## PRANA

The proof-of-work compute chain. Etchash, about 11-second blocks, 2 PRANA a block, no premine, EVM-compatible, chain ID 712217. The block reward is split by consensus: 2% to Hathor's treasury and 98% to the pool's pot contract, which pays miners by shares every round. Mine it at https://pool.soapbox.community
https://wiki.soapbox.community/wiki/PRANA_Blockchain

## KULA

KULA is the hub asset of KulaSwap, the exchange that runs on PRANA at https://kula.money — pairs are quoted against KULA, including KULA/MELEK and the bridged VKBT/KULA and CURE/KULA. KULA has a hard cap of 11,000,000.
https://wiki.soapbox.community/wiki/KulaSwap

Separately, the KULA Community Fund is the @kula account on MELEK, a pooled fund members deposit MELEK into and delegate to: https://melek.salon/kula
https://wiki.soapbox.community/wiki/KULA_Community_Fund

Together with the apps, they are SoapBox.`,
  },

  // ── recovered corpus threads (2026-09 seed script; never reached main) ──────────────────────────
  {
    slug: 'free-money-that-is-actually-free-and-the-loans-that-are-not', board: 'library',
    title: 'Free money that is actually free, and the loans that are not',
    body: `The benefits shelf at https://benefits.soapbox.community classifies 121 US programmes by mechanism — grant, loan, cost-share, tax credit, insurance, or a free service — so nothing is ever called free money that is not.

The house rule: never call a loan free money, and always name the free or cheaper path you have not been told about. Where a middleman charges for something that is free, the entry says so by name.

Most of the shelf is not cash at all. The largest group is free services — expert help from a public office, not money — and that is usually the more valuable door.

If an entry is wrong or out of date, post the official source here and it gets corrected.`,
  },
  {
    slug: 'usda-will-pay-most-of-the-cost-of-a-greenhouse', board: 'general',
    title: 'USDA will pay most of the cost of a greenhouse',
    body: `The EQIP Seasonal High Tunnel (NRCS conservation practice 325) covers up to 75% of estimated costs.

A historically underserved producer — beginning, veteran, socially disadvantaged or limited-resource — gets the applicable rate plus not less than 25 percentage points, capped at 90% (7 CFR 1466.23(b)(3)), and may receive an advance payment of at least 50% and up to 100% before building (7 CFR 1466.24(d)(1)). NRCS is required to tell them about the advance at enrollment (7 CFR 1466.5(d)). If nobody did, ask in writing.

The one thing that kills the payment: starting work before the contract is signed.

Where to start: your county USDA Service Center (https://www.farmers.gov/working-with-us/service-center-locator). The regulation is at https://www.ecfr.gov/current/title-7/subtitle-B/chapter-XIV/subchapter-B/part-1466`,
  },
  {
    slug: 'the-ein-is-free-the-duns-number-is-free', board: 'general',
    title: 'The EIN is free. The D-U-N-S number is free.',
    body: `Business credit has eight real steps, and two of them are free while being widely sold: the EIN from the IRS, and the D-U-N-S number from Dun & Bradstreet. People are charged $75 to $300 for a form that takes fifteen minutes.

- EIN: apply directly at https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online — the IRS charges nothing.
- D-U-N-S: request it free from Dun & Bradstreet at https://www.dnb.com/duns/get-a-duns.html

The ladder is at https://business.soapbox.community, along with the categories that are outright fraud: CPN numbers, synthetic identities, bought or rented tradelines, aged shelf corporations, guaranteed PAYDEX. Every one of those is sold around the single step nobody can sell you: three to six months of on-time payments.`,
  },
  {
    slug: 'the-temple-plate-food-sorted-by-what-it-interacts-with', board: 'library',
    title: 'The Temple Plate: food sorted by what it interacts with',
    body: `MyPlate already covers macronutrients and it is free, so restating it adds nothing. What no official plate does is tell you which tier your medicine, your fast or your preparation takes off the table, and name the mechanism.

The ferment tier is set apart deliberately: aged cheese, cured meat, soy sauce, miso, yeast extract, unpasteurised beer. Nutritionally a rounding error, and the one tier that can put someone on an MAOI in hospital — tyramine from bacterial decarboxylation, absorbed intact when gut and liver MAO-A are blocked.

https://plate.soapbox.community

The mechanism page: https://wiki.soapbox.community/wiki/Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems`,
  },
  {
    slug: 'turn-a-roku-on-with-no-remote-from-any-phone', board: 'general',
    title: 'Turn a Roku on with no remote, from any phone',
    body: `Every Roku on your network exposes an open, unauthenticated HTTP API on port 8060 (Roku's External Control Protocol) — no app, no account, no pairing.

- POST /keypress/PowerOn turns it on (on Roku TVs).
- POST /keypress/Home, /keypress/Select, /keypress/Up and so on are the remote's buttons.
- POST /launch/<channel id> opens a channel.

Roku documents it at https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md

It is the only major TV platform with an open local API of this kind; Samsung, LG, Vizio, Fire TV and Android TV need their vendor app or an on-screen pairing code, and no web page can do that for you. https://remote.soapbox.community does the Roku part from a browser, and it says which brands it cannot help with.`,
  },
  {
    slug: 'two-ports-one-hostname-the-bug-that-hides-behind-a-200', board: 'development',
    title: 'Two ports, one hostname: the bug that hides behind a 200',
    body: `Fifteen surfaces in this network once shared default ports. The failure is nasty because it looks like success: a hostname returned HTTP 200 for months while serving a different site, and the real service was unreachable at any hostname. A status-code check cannot see it.

## The checks that do

- Check the page title, not just the status code. curl -s https://<your-host>/ | grep -o '<title>[^<]*'
- Pin PORT and BASE_URL explicitly in every unit. A unit that pins neither lets the code fall back to localhost, which then lands in your public sitemap and gets fed to search engines.
- Keep one table of port to service, and fail the deploy when two services claim the same port.`,
  },
];

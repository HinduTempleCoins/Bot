# Library of Ashurbanipal — Status

*A plain-English picture of where the librarian bot stands. No technical knowledge needed.*

## What it is

The Library of Ashurbanipal is your **librarian bot** — the studious sibling to Hathor. It does two
jobs. First, it **writes encyclopedia-style articles** by reading across your collection of source
documents and weaving them together into a single clear entry (it never just copies one document).
Second, it acts as a **fact-checker**: it reads back the claims in those articles, checks them against
the outside world, and raises a flag when something looks off. It is named for the ancient library at
Nineveh, where a fire baked the clay tablets and preserved them.

A key thing to hold onto: the librarian is cautious by design. It **drafts and points** — it does not
overwrite your documents, and it does not publish anything to the world without you saying yes first.

## What works today

These are finished and tested. Most are "ready and waiting" — fully built, but they only become useful
once the outside pieces below are switched on.

- **Drafts wiki articles grounded in your sources.** It writes a real article by blending what several
  of your documents say, and every finished article lists exactly which sources it leaned on.
- **Marks thin spots honestly.** If a part of an article rests on weak evidence, it quietly flags that
  section so you know what to trust and what to double-check.
- **Fact-checks claims and flags problems — without touching your data.** When a claim looks wrong, it
  raises a flag for your review. It never edits, rewrites, or deletes any of your source documents.
- **Keeps a permanent, unerasable record.** Every claim it checked and every verdict it reached is
  logged for good, so you can always see how it got there and trust nothing was quietly changed.
- **Holds drafts for your approval.** Finished drafts sit in a review pile. You approve or reject each
  one. Nothing moves out of that pile on its own.
- **Turns article text into safe web pages.** It converts the raw article into a clean page and strips
  out anything that could be used to attack a reader.
- **Fills in missing linked pages.** When an article points to a topic that has no page yet, it makes a
  small placeholder so there are no dead ends — and notes which article asked for it.
- **Updates only what changed.** On a later run it spots which documents are new or edited and rewrites
  only the affected articles, instead of redoing the whole library.

## What's not live yet (waiting on you)

These are the outside pieces. The bot is ready for them; they just need to be set up or connected.

- **A real wiki to publish into.** Right now the bot writes drafts but has nowhere public to put the
  approved ones. Waiting on a live wiki website to be stood up.
- **A connection to live market and blockchain data.** The fact-checker could cross-check claims
  against the live coin-market and chain feeds once those are wired in.
- **Discord and Telegram surfaces.** So you (and others) can reach the librarian through chat. Not
  wired up yet.

## The safety promises

- **It never edits your source data.** When it disagrees with something, it raises a flag for you to
  look at — it does not change the document. (Flags can be wrong; treat them as questions, not corrections.)
- **It never publishes without your approval.** Drafts wait for your yes. There is no path that puts
  anything public on its own.
- **It never asks for or stores keys.** It holds no passwords or private keys of yours.

## A few terms

- **Wiki** — an encyclopedia-style website made of linked articles (think Wikipedia).
- **Draft** — an article the bot has written but that has not yet been approved or published.
- **Flag** — a note from the bot that a claim *might* be wrong, saved for you to review. Not a change
  to anything; a question for a human.

---

*This page can be regenerated automatically from the bot's actual state — run `node src/status.js` to
print the current at-a-glance version.*

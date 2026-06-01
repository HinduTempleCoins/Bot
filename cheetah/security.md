# Cheetah — Platform Security scanner role

Operator framing 2026-05-28: "Cheetah is going to Start looking at Security stuff from this new Oracle Server... we are going to need like Anti-Virus stuff, and like how You caught that like MySpace and NeoPets allowed People to imbed Things, like maybe Cheetah can be that Advanced, like Securing our Platform."

Cheetah's role now has three threads:

1. **Attribution / discovery** (designed in CHEETAH_ADVANCED.md — credit-first librarian)
2. **CSAM + illegal-content policing** (designed in `cheetah/policing.md` — gated on regulatory setup)
3. **Platform security scanner** — embedded malicious content detection (this doc)

The same shingle + Jaccard engine from `text-detection.js` extends naturally into "this content embeds patterns that match known-bad signatures."

## What "platform security" looks like on a Graphene chain

Steem / Hive / MELEK posts allow Markdown with a limited HTML subset. Image URLs are rendered. Custom-json ops let plugins embed payloads. Discord (Hathor's surface) renders markdown + has webhook surfaces. The MediaWiki (Library of Asherbanipal's destination) renders raw wikitext.

All four surfaces have historically been XSS / embed / data-exfiltration vectors on other platforms:

| precedent | what happened | applicable here |
|---|---|---|
| MySpace Samy worm (2005) | Self-replicating XSS via embedded JS in profile description | Yes — `<script>`-class patterns in post bodies |
| NeoPets pet pages (2000s) | Embedded HTML / Flash → credential phishing | Yes — image URLs that proxy creds, Discord webhook embeds |
| Steem rephished-link campaigns | Markdown link text says steemit.com, href points elsewhere | DIRECTLY applicable — Hive uses the same renderer family |
| HIVE phishing of 2020 (Justin Sun era) | Wallet-stealing Chrome extensions distributed via Hive posts | Yes — links to unverified Chrome Web Store entries, fake hivekeychain installers |
| Discord webhook-token leak posts | Exposed Discord webhook URLs in public posts → spam takeover | Once Hathor is on Discord, this is a recurring detection target |
| MediaWiki spam patterns | Bot-driven mass-edit campaigns embedding outbound links | Library of Asherbanipal needs this when public-facing |
| npm crypto-drainer waves | Malicious package shapes Cheetah's text-detection can fingerprint | Yes — package-name patterns in posts that promote npm installs |

## What Cheetah scans (and the patterns it looks for)

The detection module gets a new sibling: `cheetah/security-scan.js` (to ship). It takes a post body / Discord message / wiki edit and returns:

```js
{ flagged: bool, findings: [{ pattern, kind, confidence, snippet }], severity: 'info' | 'warn' | 'block' }
```

Pattern categories (initial — extends as patterns are catalogued):

- **Script-injection shape:** `<script>`, `javascript:`, `onerror=`, `onload=`, `<iframe>`, `<object>`, `<embed>` — these shouldn't appear in well-formed Markdown. Their presence is a strong flag.
- **Phish-link shape:** Markdown link where display-text and href domain disagree (`[hivekeychain.com](https://attacker.example/install.exe)`). Steem renderer has handled these historically; flag prominently.
- **Wallet-drainer keyword shape:** `seed phrase`, `mnemonic`, `private key`, `bring keys here`, `verify your wallet at` — common phish-prompt phrases.
- **Webhook-token shape:** raw Discord webhook URLs (`https://discord.com/api/webhooks/<id>/<token>`), Slack webhook tokens, Telegram bot tokens (long `:` -delimited strings). These shouldn't be in public posts.
- **Suspicious npm-package shape:** Markdown promoting `npm install <name>` where `<name>` matches typosquat patterns of known packages (e.g., `dhivee`, `node-fetchh`, `hive-keychain-installer`).
- **CSAM-adjacent textual signals:** This overlaps with `cheetah/policing.md`'s scope but the lexical signals (specific keyword shapes) are the same engine; the regulated response path is separate.
- **Embedded credential shape:** WIF-format strings (`5[HJK]...{49}`), API-key-shape strings (`sk-...`, `AKIA...`), JWT-shape strings, etc. The angelicalist-incident pattern.

## How Cheetah relates to the rest of the ensemble (12h conferences + 15-min Q&A)

Operator framing 2026-05-28: there are TWO conferences at 12am/12pm CST (UTC 06+18):

- **Security conference** — Cheetah (host) + Main Repo AI. Cheetah presents what it saw + the patterns it flagged. Main Repo AI weighs in on annals/briefs touching those areas. 15-min Q&A window — if no questions, both AIs return to their tasks.
- **Coder conference** — DeepSeek (host, once it lands) + tiny-LLM + Main Repo AI. Coding discussions, advice, MoM. **Cheetah cross-attends the coder conference** because security cuts across all code; Cheetah's findings inform what DeepSeek reviews.

Both conferences produce a MoM (Minutes of Meeting) appended as a signed Note to the relevant annal. The MoM format:

```markdown
## MoM — Security conference (2026-XX-XX 06:00 UTC)

Attendees: cheetah (host), the resident-AI host (Main Repo AI)
Topic: ...
Cheetah's findings (since last conference):
  - ...
Main Repo AI questions:
  - Q: ... / A: ...
Actions:
  - ...
```

Q&A protocol: each attendee gets up to 15 min to raise questions. If no questions are raised, the conference closes early and attendees return to their primary work loops.

## Implementation pieces (to ship)

This module is the new direction; the actual security scanner + conference machinery isn't built yet. To-do list:

- [ ] `cheetah/security-scan.js` — pattern catalog + scan function returning `{flagged, findings, severity}`
- [ ] `cheetah/security-scan.test.js` — tests for each pattern category
- [ ] Wire into `cheetah/index.js` orchestrator — `--security-mode` flag that runs the security scan on every scanned post
- [ ] Conference runner on the resident-AI host (and on the the reviewer host when it lands) — systemd timer at `OnCalendar=*-*-* 06:00,18:00` running a Q&A loop with 15-min timeout
- [ ] MoM format + `appendMoMToAnnal()` helper in `annals.js`
- [ ] Cheetah's report-to-Main-Repo-AI pathway — SSH push from Cheetah's box to the resident-AI host's annals dir, similar to tiny-LLM's pattern
- [ ] Anti-virus integration (optional, for image / file attachments — ClamAV or similar; gated on whether MELEK supports file attachments)

## Cross-references

- `CHEETAH_ADVANCED.md` — Cheetah's primary attribution/discovery design
- `cheetah/policing.md` — CSAM + illegal-content scope (regulated; different pipeline)
- `.local/MULTI_AI_ARCHITECTURE_2026-05-28.md` — 3-AI ensemble + conferences
- `.local/SECURITY_CONTEXT_2026-05-28.md` — operator-private security context (recon protection rules)
- `SECURITY.md` — repo-wide threat model (the env-var key sections are obsoleted by MELEK_SIGNER.md)
- `MELEK_SIGNER.md` — key custody architecture (zero WIF on Bot host)

# SECURITY.md — threat model and defenses for the MELEK AI Witness

**Status:** load-bearing. Read with `BRIEF.md` §7 (key custody), `CHARACTER.md` (the Witness is an account, and the account holds funds), and `HinduTempleCoins/melek-chain` CLAUDE.md (chain-side security model). Last revised 2026-05-24; supersedes the prior Van-Kush-Bot-era v1.0 (2026-01-09), whose still-useful operational content is folded into §5 and §6.

**Scope.** This document catalogs the real attack patterns documented against STEEM, HIVE, BLURT, and the broader Graphene family — plus the npm and infrastructure attacks that hit any node-based crypto operator — and names the defenses the MELEK AI Witness Bot holds against each. It is operational, not aspirational. Future operators and forkers must be able to read it cold and run the Witness safely. The Witness is forkable (per BRIEF.md), which means its security posture must survive operator changes; this is how.

**Forkers' note.** When you fork this repo to run an alternative AI witness, port this document forward, keep the defenses, and update the incident-response contacts to yours. Skipping this file is how a chain-legibility layer becomes a chain-incident.

---

## 1. Threat model

The MELEK AI Witness is an attractive target along three axes:

- **Funds.** Hathor holds liquid MELEK and MP. Until the founding-window cliff (chain block 7,884,000, ~12 months from genesis) it also has constitutional vote weight that can be politically valuable. After the cliff it accumulates stake from block rewards.
- **Reputation.** A compromised Hathor account can post phishing comments under the chain-legibility witness's name — high-trust spear-phishing of every MELEK user at once.
- **Governance.** The witness slot itself is constitutionally protected for 12 months but then competes by stake; concentrated stake (e.g. exchange custody) is the historical lever.

Realistic adversary set, in rough order of likelihood:

1. **Opportunistic npm supply-chain attackers** harvesting any wallet they find in any process. They don't know MELEK exists; they find it because they compromised a dep.
2. **VPS / host attackers** scanning for exposed SSH, weak admin credentials, or carelessly committed `.env` files.
3. **Phishers** targeting either the human operator or MELEK users directly.
4. **Targeted attackers** specifically interested in disrupting MELEK as a project (post-launch, post-attention; not relevant yet).
5. **Exchange-stake governance attackers** in the Justin-Sun-2020 mold — only relevant if MELEK gets significant exchange listings *and* the founding window has closed.

---

## 2. Tier 1 — hub / exchange-stake takeovers

**The canonical incident.** March 2, 2020. Justin Sun's TRON Foundation acquired Steemit Inc, inheriting its large pre-mined ("ninja-mined") stake. After top-20 witnesses soft-forked to freeze that stake, Sun convinced **Binance, Huobi, and Poloniex** (Bittrex declined) to vote their *customers' deposited STEEM* — roughly 42 million Steem Power — for his witness slate including the `@dev365` account. The takeover succeeded for governance purposes; the community hard-forked to HIVE in response, leaving Sun in control of the rump chain.

**Why this attack is structurally possible on any DPoS chain.** Exchanges hold user coins in omnibus wallets. The exchange operator can vote that combined stake. There is no chain-level technical fix that doesn't also break ordinary custody. Every Graphene-family chain is exposed.

**Defenses MELEK holds:**

- **No premine.** Genesis creates zero MELEK in any account (per melek-chain CLAUDE.md). The Sun playbook needed an inherited large concentrated stake; on MELEK there is no Steemit-Inc-equivalent bag to acquire.
- **Founding-window slot protection (chain-side).** For the first 12 months / 7,884,000 blocks, Hathor's witness slot is reserved at the consensus layer. The protection is **scoped to Hathor's own slot only** — Hathor cannot use its constitutional weight to elect *other* witnesses. This blocks the one attack the Sun playbook would run against the chain-legibility layer, for the formative period.
- **No corresponding off-chain defense from this Bot.** The slot protection lives in chain code. The Bot does not implement it, does not depend on it, and does not behave differently because of it.
- **Post-cliff:** survival depends on real users holding MELEK and voting for Hathor. Same defense HIVE relies on now. Social, not technical.

---

## 3. Tier 2 — key theft from individuals (users, and the operator)

### 3a. Documented STEEM / HIVE phishing patterns

- **Fake curation / airdrop sites.** Comments offering "free tokens" or "claim your airdrop" linking to lookalike sites that capture keys. Documented campaigns include the `kimberlyameyrealty.ga` site and accounts compromised through it (`lassi`, `rubbii`, `ranaa`, `lawns`, `uzma1`, others — see the `guiltyparties` list).
- **Master-password / owner-key entry into "log in" sites.** Master password derives every key. Once given, the account is fully owned. After 30 days without the original owner key, the account is **unrecoverable**.
- **Posting-key reuse.** Users give posting keys to many apps; one compromised app posts phishing comments from the user's handle, polluting the trust graph.
- **What attackers do once in:** drain liquid, initiate power-down (13 weeks to fully pay out, so they often abandon), spam phishing from the compromised account before the flag-and-recover process catches up.

### 3b. Browser-extension and clipboard threats

- **Mars Stealer** and similar info-stealer malware specifically read browser-extension wallet storage (Keychain-style, MetaMask, others).
- **Fake-clone Chrome Web Store extensions** of legitimate wallets with similar names but different store IDs. The legitimate Hive Keychain ID is `jcacnejopjdphbnjgfaaobbfafkihpep`; treat any other ID claiming to be Keychain as a clone.
- **Clipboard hijackers** swap pasted account names / addresses for attacker-controlled ones.

### 3c. The four Graphene key types — least-privilege principle

**Zero WIF on the Bot host, by construction.** No Graphene private key (owner, active, posting, or memo) ever lives on the Bot host or in this repo. All broadcasts go through **MELEK-Signer** — a separate hardened service in a separate repo on a separate VPS — and the Bot holds only a scoped, revocable **bearer token**, never a key. The active and posting keys live exclusively inside MELEK-Signer, encrypted at rest with cloud-KMS bound to the signer's instance role (stolen disk → opaque blob; cloned VPS → KMS refuses to unwrap). The owner key and the treasury-tier active key live only on the operator's offline hardware wallet and are never deployed to any always-on host. This is the locked design — see [`MELEK_SIGNER.md`](./MELEK_SIGNER.md). The "where it should live" column below reflects it.

| Key | Used for | Risk if compromised | Where it should live |
|---|---|---|---|
| **Owner** | Account recovery; modifying other keys | **Critical.** Full account control. After 30 days without the original, account is permanently lost. | **Offline only**, on the operator's hardware wallet. Never on any internet-connected device, never in any env var, never in any password manager touching the cloud. Paper backup, stored physically. |
| **Active** | Transfers, delegations, account creation, `witness_update`, `feed_publish` | High. Drains funds, creates fake accounts, redirects funding. | **Never on the Bot host.** The signup-scoped active key lives KMS-wrapped inside MELEK-Signer, behind its policy engine; the treasury-tier active key lives offline on the hardware wallet. The Bot reaches it only by asking MELEK-Signer to broadcast, authenticated by its bearer token. |
| **Posting** | Comments, votes, custom JSON | Medium. Spam, fake-curation phishing from the Witness's handle. | **Never on the Bot host.** Lives KMS-wrapped inside MELEK-Signer. Same posture as the scoped active key — reached only via the signer, never as an env var here. |
| **Memo** | Encrypted memos | Low. Decrypts old memos sent to you. | Not used by current Bot scope. If ever needed, inside MELEK-Signer — never on the Bot host. |

The Witness's **block-signing key** (used by the `witness_node` daemon to sign blocks) is **distinct from all four above.** It lives on the `witness_node` host (chain-side, not this Bot, not MELEK-Signer). Block-signing-key compromise means an attacker can sign blocks under Hathor's name but **cannot move funds.** Rotate it routinely via `witness_update` — a cold-signer op signed from the offline hardware wallet.

**The one local-signing exception — testnet only.** A single, default-OFF testnet path exists: `witness/jit-signer.mjs`, gated by the `MELEK_FEED_TESTNET_JIT_SIGN` flag. It is hard-gated to the `TST` address prefix and refuses to run against mainnet; it fetches a key just-in-time, signs once, and never persists it to disk. This is the lone exception to "no local signing on the Bot host," and it **never reaches mainnet** — mainnet broadcasts always go through MELEK-Signer.

### 3d. Defenses for users (relevant to signup help)

- The condenser does **client-side key generation in the browser**. User private keys never transit the Witness's server (BRIEF.md §7). The boundary is absolute: the moment the server-side accepts a user's key over the wire, the Bot has become a phishing hub waiting to be acquired. *Hold this line forever.*
- The Witness's signup help walks users through mechanics only — username, what keys do, save your backups before continuing. It does not ask the user's name, purpose, history, intentions, or anything that would justify storing private information (BRIEF.md §6, §7).
- Email verification only (Resend / Postmark / SES). No SMS. (BRIEF.md §6.)

### 3e. Defenses for the human operator

- Master password / owner key for `hathor` generated offline, written down, stored physically. Never typed into any website, never pasted into any chat, never in any env var.
- Treat any DM, comment, or email asking the operator to "verify," "confirm," or "log in" via a link as hostile by default. Even from accounts that look familiar.
- Never email or message keys in plaintext, never screenshot them.

---

## 4. Tier 3 — infrastructure and supply chain (the Bot operator's main concern)

This is the tier most likely to compromise the Witness Bot specifically, because the Bot holds the active key on a server.

### 4a. NPM supply-chain attacks targeting crypto wallets

- **`event-stream`, November 2018.** Attacker socially engineered the maintainer into transferring ownership, published a release that exfiltrated private keys via fake CloudFlare headers to an attacker-controlled domain. ~2 million weekly downloads at compromise time. **This was the template.**
- **`debug` / `chalk` and 25 other packages, September 2025.** Phishing email from `support@npmjs.help` (registered 3 days before the attack) harvested maintainer credentials. Attackers pushed releases containing a **crypto-drainer payload** that detected Web3 wallets in the page context and silently rewrote transactions. ~2 billion weekly downloads affected.
- **Pattern.** The attack is live for hours-to-days before discovery. The malware targets *crypto wallets running in the same JS process.* The Bot has `@hiveio/dhive`, `axios`, `node-cache`, and others as direct deps, plus a transitive tree. Any one of them getting compromised and re-published would put the active key at risk on the next `npm install`.

### 4b. VPS / host compromise

- **SSH brute-force / weak admin credentials.** Standard exposure for any internet-facing VPS.
- **Co-tenant services on the same host.** A vulnerable nginx, a forgotten phpMyAdmin, an open Docker socket — all standard pivots to env-var theft.
- **Accidental `.env` commits.** Routine across the npm ecosystem. Caught early by GitHub secret scanning, but a key that touches a public commit even briefly should be considered burned.

### 4c. Witness-node specific (chain-side, not this Bot)

- The HIVE community's `hive-witness-essentials` tooling is the precedent for key rotation and emergency `disable_witness` — equivalent for MELEK should be staged.
- Witness signing key is **distinct from active/posting/owner**. Compromise of the signing key means an attacker can sign blocks under Hathor's name but **cannot move funds**. Rotate signing keys routinely via `witness_update`.

### 4d. Defenses

**Already in this repo:**

- **`.env` is gitignored** (`.gitignore` line 2). Verified at every commit.
- **`.env.example` ships with empty placeholders** for `HATHOR_POSTING_KEY` and `HATHOR_ACTIVE_KEY`. Real keys never go in this file; this file is committed, the real `.env` is not.
- **`src/chain/keys.js` reads keys from env once at module load.** It does not log them, does not return them via any debug helper, and does not include them in error messages. `hasPostingKey()` / `hasActiveKey()` are boolean probes only.
- **`witness/hathor.js` exposes `status()` that reports key presence as booleans only** — never the keys themselves.
- **`hello.js` (the smoke test) reports presence/absence and never touches key strings.**

**Operator must do (write this into your deploy runbook):**

- **Pin npm dependencies to exact versions.** No `^`, no `~`. Commit `package-lock.json`. Never auto-update. Use `npm ci --ignore-scripts` to install (skipping postinstall scripts blocks most npm exfil payloads). Audit `npm audit` and `socket.dev` before bumping any dep.
- **Two-account architecture.**
  - `hathor` holds the active key actively used by the Bot, runs on its own dedicated VPS, no other services co-tenant.
  - A separate `hathor-treasury`-style account (or offline cold storage) holds the majority of MELEK and MP, with its keys **offline**. The Bot pulls forward only what it needs for immediate signup-funding budget.
  - This limits blast radius: if `hathor` is compromised, the treasury survives.
- **Witness signing key separate from active/posting/owner.** Rotate it on a schedule. Have a pre-staged `witness_update` op ready to rotate on suspicion of compromise.
- **Out-of-band alerting on `transfer` ops from `hathor`.** Any transfer triggers Telegram/email to the operator within seconds. If you didn't initiate it, you have minutes to act with the offline owner key.
- **`disable_witness` script staged on the operator's offline machine.** Pre-signed-or-ready-to-sign with the offline owner key. The circuit breaker.
- **SSH key-only login on the Bot's VPS, password login disabled, fail2ban installed.** Standard hardening; documented as the HIVE witness baseline.
- **No private keys generated on an online service.** Always offline, always client-side, always.

---

## 5. Operational checklist

### Before every commit

```bash
git diff             # review changes
git status           # verify no .env files staged
git log -1 --stat    # check last commit
```

If `.env` ever shows up in any of these, stop and investigate before continuing.

### Before deploying a new Bot host

- [ ] All keys stored only in `.env` on the host; nothing in this repo
- [ ] `.env` confirmed in `.gitignore`
- [ ] `.env.example` reviewed — all placeholders, no real values
- [ ] `npm ci --ignore-scripts` used to install dependencies
- [ ] `package-lock.json` committed and matches what's installed
- [ ] SSH password login disabled, key-only auth, fail2ban installed
- [ ] No other internet-facing services co-tenant on the VPS
- [ ] Out-of-band alerting on Hathor transfers configured
- [ ] `disable_witness` script staged on operator's offline machine
- [ ] Witness signing key generated offline, separate from active/posting/owner
- [ ] Treasury account established with offline keys
- [ ] `npm run hello` runs cleanly and reports expected state
- [ ] Smoke-tested on testnet before pointing at mainnet

### Pre-commit scanning patterns (operator can run before pushing)

```bash
# Generic credential pattern
git diff | grep -iE "key|token|secret|password" | grep -v "// "

# Graphene-family WIF private keys start with '5' (uncompressed)
git diff | grep -E "5[HJK][1-9A-HJ-NP-Za-km-z]{49}"

# Discord bot tokens
git diff | grep -E "MT[A-Za-z0-9_-]{20,}"
```

If any of these match outside `.env.example` or commented-out lines, do not push.

### Reject PRs immediately if

- Any `.env` file (other than `.env.example`)
- Any hardcoded keys or tokens
- Any file with `secret` or `private` in the name
- A dependency bump without justification or `socket.dev` review
- Code that logs, prints, or stringifies keys
- Code that accepts user private keys over the wire

---

## 6. Incident response

### 6a. If you suspect a key compromise

1. **Stop the Bot process** on the VPS. `kill` the Node process; don't try to "investigate" while it's running with the active key in memory.
2. **Broadcast `disable_witness` from the offline owner key.** Hathor stops signing blocks; the chain-side founding-window protection still reserves the slot but no blocks are produced under a compromised key.
3. **Rotate keys.** Use the offline owner key to set new active / posting / signing keys via `account_update` and `witness_update`. The old keys are now revoked at the chain level.
4. **Move funds.** If liquid MELEK or MP is still recoverable (attacker may have started but not completed power-down), transfer / cancel-power-down with the new active key.
5. **Burn the host.** Rebuild the VPS from scratch. Do not try to clean it. The attack vector is unknown until forensics; you cannot trust the host until you have proven it was clean.
6. **Public post-mortem.** Post a comment from the (new-keyed) Hathor account explaining what happened, when, what was lost, what defenses were missing, what's been fixed. The chain-legibility witness's credibility depends on being honest about its own incidents.
7. **Update this file.** Add the incident to §7 with the lesson it taught.

### 6b. If you accidentally commit a key to git

A key that touches a public commit even briefly should be considered **burned**. Treat as compromise (run §6a) **even if you force-push to remove it.**

After running §6a, clean git history:

```bash
# Rotate keys FIRST (per §6a step 3). Only THEN clean history.
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

git push origin --force --all

# Verify no .env appears in any commit
git log --all --full-history --source -- .env
```

Note: GitHub's secret-scanning caches values. The new keys are what matters; the rotation is non-optional.

### 6c. If a dependency you use is reported as compromised on npm

1. **Stop the Bot process** if the dependency was loaded.
2. Check `package-lock.json` for the affected version.
3. If the affected version was installed, treat the Bot host as compromised (§6a + §6b).
4. If not, downgrade to a known-good version, audit `npm audit`, and resume only after `socket.dev` review.

### 6d. Reporting security issues

Security issues with this Bot should be reported privately to the operator (`mahatmajapa@gmail.com` for the founding operator; forkers should update this line). **Do not open public issues for vulnerabilities.**

---

## 7. Incident log

*No incidents to date. When one happens, append here with: date, scope, root cause, response, what was changed in this repo as a result.*

---

## 8. Tier 4 — the L2 engine, the signer token, and autovote (MELEK-specific surfaces)

§§2–4 cover the L1 chain, individual keys, and infrastructure. These three surfaces are newer and have their own documented incident history on Hive/Steem. Each is mapped to our exposure and defense.

### 8a. The L2 token engine (Hive-Engine / wLEO incident class)

**The history.** Hive-Engine is a *centralized* side-token layer: a small, effectively-trusted set of nodes, with consensus far weaker than L1. The most expensive failure was the **wLEO hack (Oct 2020, ~$42k–$100k+ drained)** — not the L2 token itself but the **Ethereum bridge / oracle** that wrapped a Hive-Engine token onto Uniswap. The Hive-Engine team's own mitigation afterward was telling: **run a second independent HE node and cross-check every incoming transaction on both before issuing the wrapped asset** — i.e., don't trust a single centralized node for value movement.

**Our exposure.** `engine/` is a Hive-Engine-style L2 (custom_json on L1, id `mse-testnet-melek`); `pool/` has a ZEPH/XMR/EVM **bridge** — the exact wLEO-class surface.

**Defenses we hold / must hold:**
- **No independent L2 consensus to attack.** The engine is a deterministic *replay* of L1: it never invents state, only folds confirmed L1 `custom_json` ops in strict block order. The L1 witnesses (where Hathor's slot lives) are the security root; the L2 has no separate validator set to bribe or 51%. (`engine/lib/engine.mjs` — single-threaded, strict block order; `streamer.mjs` `verifyChain` pins the chain id before replay.)
- **Auth is taken STRICTLY from the L1-verified signature**, never from the payload: the signer is `required_active_auths[0] || required_posting_auths[0]`, and value-moving / supply ops (`issue`, `transfer`, `create`) require **active** auth (mirrors Scotbot). A forged "from" in the JSON is ignored. (`engine/lib/engine.mjs` §6 A/B.)
- **Determinism is verifiable.** State is a pure function of L1 history with a deterministic state hash — anyone can replay and compare, so a tampered engine node is detectable (the wLEO "run a second node and cross-check" lesson, made native).
- **GAP / TODO:** the bridge (pool/) is the genuine wLEO-class risk. Before any mainnet bridge: dual-node cross-check on issuance, conservative withdrawal rate-limits, an oracle that signs nothing it can't reconstruct from both nodes, and a circuit-breaker. Bridges hold custody — treat the bridge wallet as a treasury-tier key (offline / MELEK-Signer policy), never a hot key.

### 8b. The signer bearer token (HiveSigner / SteemConnect / OAuth incident class)

**The history.** HiveSigner (née SteemConnect) is a centralized OAuth2 SSO. Its documented failure modes: **phishing clones** of the signer page that harvest the user's *actual private key*; and **OAuth token theft** — a leaked bearer token lets the holder act within its scope without the key. Hive's own guidance: tokens must have **short expiry**, be **revocable**, and users must periodically **review which apps hold posting authority**.

**Our exposure.** MELEK-Signer gives the Bot a **scoped bearer token** (not a key) — that token is the HiveSigner-token-theft surface. The `discord-tip-broadcast-server.mjs` I run on the chain host uses a shared **bearer secret** — same class.

**Defenses:**
- **The token is not a key.** It can only ask MELEK-Signer to broadcast, behind the signer's **policy engine** (which ops, which accounts, rate caps) and a **watcher audit**. A stolen token is scoped + revocable + expiring, and every use is logged out-of-band. (See `MELEK_SIGNER.md`, [[hathor-key-security-architecture]].)
- **Phishing defense = one canonical domain + teach verification.** The signup/condenser/signer surfaces must live on the canonical MELEK domain over TLS; the `/teach` layer tells users to verify the URL and never paste a key into a page they reached from a link (the HiveSigner-clone lesson). Hathor never asks for a key (§3a).
- **The tip endpoint** binds `127.0.0.1` by default, timing-safe-compares the secret, enforces caps server-side, and the secret is rotatable. Treat it like a token: rotate on any suspicion, never log it.
- **Posting-authority hygiene:** like HiveSigner's Authorities panel, any app/token granted posting auth on a MELEK account must be reviewable and revocable; prefer keyless (WhaleVault-style in-browser) over stored keys.

### 8c. Autovote / curation-trail surfaces

**The history.** Curation automation invites: **stored-key compromise** (the autovote service holding a posting WIF), **vote-buying / bid-bots** distorting curation, and **reverse-auction gaming**.

**Defenses:**
- **Posting-key login is testnet-throwaway ONLY**, clearly marked; production paths are **keyless** (HiveSigner OAuth token / WhaleVault in-browser) so the platform never holds a mainnet key. (`autovote/README.md`, `chains.js` — `blockMainnetBroadcast` defaults ON.)
- **Per-(chain,account) scoping + daily caps + rate limits** on every rule (`store.js`, `rules.js`), so a compromised account can't be used to drain RC or mass-vote.
- **No vote-selling by Hathor** (the curation policy is merit-only, not buyable — `voting_rules/README.md` §2), and reverse-auction timing (§ MELEK 5-min window, [[melek-curation-vote-constants]]) is used to *earn* curation honestly, not to front-run.

---

## Sources for the threat patterns above

- Justin Sun / Steemit takeover: [CoinTelegraph](https://cointelegraph.com/news/steem-community-stands-its-ground-amid-tron-takeover), [Decrypt](https://decrypt.co/21108/did-binance-just-help-take-over-steem-network-justin-sun), [CryptoGround](https://www.cryptoground.com/a/binance-huobi-and-poloniex-help-justin-sun-takeover-of-steem-blockchain-to-prevent-hack), [HIVE fork response (CoinTelegraph)](https://cointelegraph.com/news/steem-community-resists-takeover-hard-fork-launches-hive-network)
- HIVE phishing campaigns: [keys-defender campaign report](https://hive.blog/hive/@keys-defender/phishing-campaign-on-hive-be-aware), [guiltyparties compromised-accounts list](https://hive.blog/security/@guiltyparties/if-you-are-on-this-list-then-your-keys-are-compromised), [cryptokannon recovery guide](https://steemit.com/hive-172186/@cryptokannon/your-steem-account-got-hacked-what-to-do-next)
- Browser-extension malware: [Mars Stealer report on Hive](https://hive.blog/hive-150329/@mccoy02/mars-stealer-new-crypto-attacking-malware-on-browser-extensions)
- NPM supply-chain attacks: [event-stream and 2025 wave (Web3SecNews)](https://web3secnews.substack.com/p/npm-supply-chain-attacks-how-hackers), [Palo Alto breakdown](https://www.paloaltonetworks.com/blog/cloud-security/npm-supply-chain-attack/), [Developer-Tech coverage](https://www.developer-tech.com/news/escalating-npm-supply-chain-malware-attack-drains-crypto-wallets/)
- Witness operations / key rotation: [therealwolf Witness Essentials](https://hive.blog/@therealwolf/witness-essentials-hf20-ready), [hive-witness-essentials repo](https://github.com/therealwolf42/hive-witness-essentials)
- L2 / bridge (wLEO) hack: [Decrypt — Ethereum project wLEO hacked for $42,000](https://decrypt.co/44645/ethereum-project-wleo-hacked-for-42000-on-uniswap), [fbslo — wrapped Hive-Engine tokens (dual-node cross-check mitigation)](https://hive.blog/hive-139531/@fbslo/how-to-create-wrapped-hive-engine-tokens-step-by-step)
- HiveSigner / SteemConnect OAuth: [good-karma SteemConnect notice](https://hive.blog/hive/@good-karma/steemconnect-notice), [quochuy — review your posting authorities](https://hive.blog/security/@quochuy/remember-to-review-your-posting-authorities-with-hivesigner-steemconnect), [keys-defender — wallet-transfer phishing wave](https://hive.blog/hive-167922/@keys-defender/new-phishing-wave-through-wallet-transfers-do-not-use-those-links)

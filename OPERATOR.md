# OPERATOR.md — running the MELEK AI Witness

**Status:** operational runbook. Read with [`BRIEF.md`](./BRIEF.md) §7 (key custody), [`SECURITY.md`](./SECURITY.md) (threat model + incident response), and [`README.md`](./README.md) (orientation). This document is the *how* to SECURITY.md's *why*. Last revised 2026-05-24.

**Audience:** the human operating the Witness's host. The founding operator is `mahatmajapa@gmail.com`; forkers should update §0 with their own contact and adapt the rest as needed.

---

## 0. Forker's note

If you are forking this repo to run an alternative AI witness on MELEK:

- Pick a different account name — `hathor` belongs to the founding Witness.
- Update [`SECURITY.md`](./SECURITY.md) §6d with your security contact.
- Update [`README.md`](./README.md)'s "Contact" line.
- Decide what you want your Witness to emphasize. Inherit what you like from `CHARACTER.md`, `RULE_1.md`, and the scripture corpus; replace what you don't. The Witness is forkable; what makes a fork meaningful is having something to add or a different reading to offer.
- Keep [`SECURITY.md`](./SECURITY.md) load-bearing. The threat model applies to every Witness; defenses do not get to be optional just because your account name is different.

The rest of this document assumes you are the founding operator. Forkers translate as needed.

---

## 1. Prerequisites

Before you touch any infrastructure:

- A computer that has never been used for anything online — an old laptop, a Raspberry Pi never connected to the network, anything you can keep physically isolated. This is your **offline key machine**. It exists to generate and hold the owner key.
- A dedicated VPS for the Witness. The cheapest tier from any reputable provider is fine for Phase 1 (no LLM, just chain ops). Do not co-tenant other services on this host.
- A separate VPS (or hosting) for `melek-chain`'s `witness_node` daemon — the block-signing daemon. The Bot in this repo does **not** run `witness_node`. They are different processes on (preferably) different hosts.
- A password manager you trust for non-key secrets (.env values that aren't keys). Owner keys never go in a password manager that touches the cloud.
- An offline backup destination — a flash drive or paper — for the owner key. Two copies, two physical locations.

---

## 2. Generating the keys

**On the offline machine, never touching the network during this step:**

1. Generate the four account keys for `hathor` (owner, active, posting, memo) using `melek-chain`'s `cli_wallet` or the offline key derivation in `src/chain/keys.js` ancestry. Owner is derived from a master password / passphrase; the other three are derived from it but stored independently.
2. Write the owner key on paper. Two copies. Different physical locations.
3. Copy the active and posting keys to the Witness's `.env` only via offline transfer (USB) — never paste into a chat, never type into a website.
4. Generate the **block-signing key** separately, *not* derived from the owner key. This is the key the `witness_node` daemon uses. It lives on the `witness_node` host, not on the Bot's host.
5. Verify on the offline machine: the active key cannot vote `witness_update` against the owner key without the owner key signing. The block-signing key cannot transfer funds. Each key has exactly the privilege it needs and nothing more.

Bring the offline machine back online **only after the owner key is off it and stored physically.** Or better, keep that machine offline forever.

---

## 3. VPS hardening (Bot host)

On the Bot's VPS, before installing anything:

```bash
# 1. Disable password SSH, enforce key-only
sudo sed -i 's/#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl reload ssh

# 2. fail2ban
sudo apt-get update && sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban

# 3. Firewall — only SSH from your IPs + nothing else inbound
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <your-ip> to any port 22
sudo ufw enable

# 4. Unattended security upgrades
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# 5. Create a non-root user that runs the Bot, with no sudo
sudo adduser --disabled-password --gecos "" hathor
```

Verify: SSH only with key, only from known IPs, only as a known user. Nothing else exposed.

---

## 4. Installing the Bot

As the `hathor` user (not root):

```bash
cd /home/hathor
git clone https://github.com/HinduTempleCoins/Bot.git
cd Bot

# IMPORTANT: --ignore-scripts blocks the most common npm exfil payloads
npm ci --ignore-scripts

# Verify before going further
npm run hello
```

Expected output of `npm run hello` at this stage: account `hathor`, network `testnet`, all key/config slots reporting `no`, "missing env vars" list including `MELEK_RPC_URL`, `MELEK_CHAIN_ID`, `MELEK_ADDRESS_PREFIX`. Clean exit, no errors.

If the install fails or the smoke test errors out, **stop and investigate before configuring `.env`.** The host is supposed to be clean before any keys touch it.

---

## 5. Configuring `.env`

```bash
cp .env.example .env
chmod 600 .env  # readable only by the hathor user
```

Open `.env` and fill in only the MELEK section:

```
HATHOR_ACCOUNT=hathor
HATHOR_POSTING_KEY=<paste from offline transfer; remove from clipboard immediately>
HATHOR_ACTIVE_KEY=<paste from offline transfer; remove from clipboard immediately>
MELEK_NETWORK=testnet
MELEK_RPC_URL=<from melek-chain operator>
MELEK_CHAIN_ID=<from melek-chain config.hpp>
MELEK_ADDRESS_PREFIX=<from melek-chain config.hpp>
```

After saving:

- Confirm `.env` is **not** tracked by git: `git status` should show no `.env`. If it does, you have a bug somewhere in `.gitignore` — fix that *first*.
- Confirm permissions: `ls -la .env` should show `-rw-------` (600), owned by `hathor`.
- Verify the keys load: `npm run hello` should now report `posting key loaded: yes`, `active key loaded: yes`, `ready to connect: yes`. **If it prints the keys themselves anywhere, stop — there is a bug; do not run further until it's fixed.**
- Probe the chain: the smoke test should now also report a head block. If the account `hathor` doesn't exist on chain yet, it'll say "not found" — that's expected; you create the account in §6.

---

## 6. Creating the on-chain account

This is the one step that requires bootstrap from outside this Bot — the `hathor` account doesn't exist yet, so the Bot has no account to operate from. Either:

- A founding witness creates `hathor` using `account_create_with_delegation` from their own account (cli_wallet on the `witness_node` host can do this), funding it with the active/posting/memo public keys you generated in §2 and enough MP to begin operating.
- Or genesis includes `hathor` (per `melek-chain`'s genesis configuration; see its `genesis.json`).

Once the account exists on chain, run `npm run hello` again. You should see `on-chain account: found (created ...)`.

---

## 7. Registering as a witness

The `witness_update` op is signed by Hathor's active key (already in `.env` from §5). Use the bundled helper:

```bash
# Fill in the registration-specific env vars in .env first:
#   HATHOR_WITNESS_URL          (public URL — typically the intro post)
#   HATHOR_BLOCK_SIGNING_PUBKEY (the public key matching the signing key on the witness_node host, §2)
#   HATHOR_ACCOUNT_CREATION_FEE (default "0.000 MELEK")
#   HATHOR_MAXIMUM_BLOCK_SIZE   (default 131072)

# Preview, no broadcast:
node witness/register.js --dry-run

# Broadcast for real:
node witness/register.js --yes
```

After the broadcast, `npm run hello` reports `witness record: found`. The `witness_node` daemon (separate host) should be running and will start signing blocks when the witness schedule picks it.

To **update** the witness record later (rotate signing key, change URL, adjust props), edit the env vars and re-run `node witness/register.js --yes`. Same op, same key, just a new value.

---

## 8. Publishing the intro post

The intro post body lives in [`witness/intro-post.md`](./witness/intro-post.md). The publish helper reads it, strips the frontmatter, and broadcasts as a `comment` op signed by `HATHOR_POSTING_KEY`.

Dry-run first to verify the body and that keys/config are loaded:

```bash
node witness/publish-intro.js --dry-run
```

The dry-run prints the post body that would be broadcast and exits without sending anything. Read the body once; if it still reads true, broadcast:

```bash
node witness/publish-intro.js
```

After broadcasting, the post is on-chain. Verify by viewing on the condenser, or by re-running `hello.js` if you extend it to read the latest post. This is a one-shot — don't re-run after success; the permlink `introducing-hathor-on-melek` is reserved for the founding introduction.

---

## 9. Ongoing operation

**Daily / cron:**

- `witness_node` runs continuously on its own host; that's the chain daemon's job, not this Bot's.
- The Bot's recurring work in Phase 1 is the **price feed** — `feed_publish` op at the cadence MELEK convention sets (every hour is typical). Run `node witness/feed-publisher.js --cron` under systemd or pm2 to publish on the `FEED_CRON` schedule. Verify the rate first with `--dry-run`; publish-once with `--once`. (MELEK has no internal stablecoin — the feed is informational only, per `melek-chain` CLAUDE.md.)
- The **emergency circuit breaker** is `node witness/disable.js --yes` (always preview with `--dry-run` first). Use it when the host is suspicious-but-key-still-yours; for compromised-active-key scenarios, go offline instead (see §10).

**Weekly:**

- Check `npm audit` and `socket.dev` for any deps with new advisories.
- Verify `package-lock.json` hasn't been touched by anyone else.
- Verify out-of-band alerting still triggers (test the alert path).

**Monthly:**

- Verify the offline key machine and paper owner-key backups are still physically secure and readable.
- Verify the `disable_witness` script is staged and signs cleanly on the offline machine (dry-run, don't broadcast).

**Quarterly:**

- Rotate the block-signing key via `witness_update` from the active key. Generate the new signing key on the `witness_node` host. Update the witness record. Old key becomes invalid at the chain level.

**Annual:**

- Consider whether the active and posting keys should be rotated. Rotation is cheap (`account_update` op signed by owner key on the offline machine). Rotate at least once per year as a habit; rotate immediately on any suspicion of compromise.

---

## 10. Incident response

See [`SECURITY.md`](./SECURITY.md) §6 for the full procedure. The summary, for muscle memory:

1. **`kill` the Bot process** on the VPS. Do not "investigate" while it runs.
2. **Broadcast `disable_witness`** from the offline owner key. Hathor stops signing blocks.
3. **Rotate all four account keys** with `account_update` signed by the offline owner key.
4. **Move funds** to a new treasury account using the new active key.
5. **Burn the host.** Rebuild from scratch on a new VPS. Re-do §3–§7. Do not trust the old host even if you "think" it's clean.
6. **Public post-mortem** from the (new-keyed) Hathor account explaining what happened, what was lost, what's been fixed.
7. **Append to [`SECURITY.md`](./SECURITY.md) §7 (incident log)** with the lesson.

Keep the `disable_witness` payload pre-signed (or staged-and-ready-to-sign) on the offline machine. The window between detecting compromise and the attacker draining funds is measured in minutes.

---

## 11. Two-account architecture (recommended once funded)

To minimize blast radius:

- **`hathor`** holds only the active key actively used by this Bot. Funded with what the Bot needs for short-term signup-funding budget (e.g. one week's expected new-account delegations).
- **`hathor-treasury`** (or any name) holds the bulk of MELEK and MP. Its active and owner keys are *offline*. Funds flow `hathor-treasury → hathor` periodically, signed manually from the offline machine.
- If `hathor` is compromised, the treasury is unaffected. The attacker gets one budget cycle at most.

Set this up as soon as you have material funds. Document the periodic refill procedure when you do, and append it here.

---

## 12. Phase transitions

This runbook covers **Phase 1**. As the Bot advances to Phase 2 (deterministic command menu) and Phase 3 (conversational Witness), this document gets new sections for those phases — command-menu deployment, model selection and update cadence, the system prompt assembly, the karma and Crypt-ology stores. Expand `OPERATOR.md` rather than fragmenting deployment knowledge across multiple files; future operators read one runbook.

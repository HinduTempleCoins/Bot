# Cheetah deployment runbook — Oracle box

Operator framing 2026-05-28: "I have an Oracle Server, and I need to know what I need to do to get Everything done to get Cheetah on there."

This document is the deployment runbook. Two ways to use it:

- **Operator runs it manually** on the Oracle box (Codespace doesn't have SSH there yet)
- **Operator shares SSH access** with the Codespace, and Claude Code runs it (faster, idempotent)

## What we're deploying

The Cheetah module from `cheetah/` in this repo:

- `text-detection.js` — shingle + Jaccard similarity engine (Phase 2 deterministic, no LLM)
- `compose.js` — comment templates with self-ID footer (deterministic variant selection)
- `store.js` — evidenced whitelist/blacklist + findings log (JSON-backed)
- `config.js` — env-driven knobs

This is build order steps 1-3 from `CHEETAH_ADVANCED.md`. Live wiring to MELEK chain (step 1 chain-query side) is gated on the chain being up; for now Cheetah runs in `--dry-run` mode + `--scan-fixtures` mode, where it processes fixture posts to verify the detection pipeline works.

## Prerequisites

- Oracle box reachable from somewhere (Codespace or operator's laptop) over SSH
- Node 20+ installed (most fresh Oracle Cloud images ship with old Node; needs upgrade)
- Git (to clone the Bot repo)
- A working directory with ~500MB free for the repo + datasets clone
- (later) MELEK chain RPC URL — when chain launches

## Step 1 — initial box hardening (same standard as resident-AI-host)

```bash
# On the Oracle box, as root or sudo:
apt-get update && apt-get -y dist-upgrade   # Ubuntu; for Oracle Linux use dnf
# OR for AlmaLinux/Oracle Linux/RHEL:
dnf upgrade -y

# Firewall: SSH only
ufw allow OpenSSH && ufw --force enable   # Ubuntu
# OR for RHEL family:
dnf install -y firewalld && systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh && firewall-cmd --reload

# Unattended security upgrades
# Ubuntu:
apt-get -y install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades

# Swap (Oracle micro is often 1GB — add 2GB swap)
[ -f /swapfile ] || ( dd if=/dev/zero of=/swapfile bs=1M count=2048 && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo "/swapfile none swap sw 0 0" >> /etc/fstab )

# Key-only SSH (after operator confirms they have working key access)
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload sshd
```

## Step 2 — Node 20 install

```bash
# Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# RHEL/AlmaLinux/Oracle Linux:
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

node --version    # expect v20.x
```

## Step 3 — clone the Bot repo (Cheetah needs the wider module set)

```bash
# Pick a stable path — same convention as resident-AI-host
mkdir -p <APP_DIR> && cd <APP_DIR>
git clone https://github.com/HinduTempleCoins/Bot.git repo
cd repo
npm install --ignore-scripts     # --ignore-scripts is the security hardening default
npm test                          # confirms welcomer/, tutorial/, watcher/, cheetah/ tests pass
```

## Step 4 — Cheetah config

Create `<ETC_DIR>/cheetah.env`:

```bash
mkdir -p <ETC_DIR>
cat > <ETC_DIR>/cheetah.env <<'EOF'
# Cheetah account on MELEK (created later once chain is live)
CHEETAH_ACCOUNT=cheetah

# Similarity threshold for findings (0..1). Higher = more conservative.
CHEETAH_SIMILARITY_THRESHOLD=0.5

# Frequency cap per author per 24h (bot-culture norm: not every post).
CHEETAH_FREQ_CAP=1

# Where the evidenced store lives.
CHEETAH_STORE=<DATA_DIR>/cheetah-store.json

# Self-ID footer link.
CHEETAH_SELF_ID_URL=https://github.com/HinduTempleCoins/Bot/blob/main/cheetah/README.md

# Web search backend — pick one once operator decides:
#   "none"       — on-chain detection only (default while chain is dev)
#   "google"     — also set GOOGLE_CSE_KEY + GOOGLE_CSE_CX
#   "serper"     — also set SERPER_API_KEY
#   "duckduckgo" — scrape-based, no key but ToS-tight
CHEETAH_WEB_SEARCH=none

# Chain RPC (fill in when MELEK testnet exposes one):
# MELEK_RPC_URL=
# MELEK_CHAIN_ID=
# MELEK_ADDRESS_PREFIX=
EOF

chmod 640 <ETC_DIR>/cheetah.env
mkdir -p <DATA_DIR>
```

## Step 5 — verify the pipeline (no chain yet, fixture mode)

```bash
cd <APP_DIR>/repo
# Load Cheetah config + run the existing tests (will be expanded once
# cheetah/index.js + a fixtures harness lands):
set -a; source <ETC_DIR>/cheetah.env; set +a
node --test cheetah/*.test.js
```

(`cheetah/index.js` CLI + fixture harness is the next ship; until then the modules are importable and unit-testable but don't run as a long-lived service.)

## Step 6 — when chain RPC values exist (after melek-chain launches)

```bash
# Edit <ETC_DIR>/cheetah.env to fill MELEK_RPC_URL, MELEK_CHAIN_ID, MELEK_ADDRESS_PREFIX

# Once cheetah/index.js ships with --cron mode, install the systemd unit:
cat > /etc/systemd/system/cheetah.service <<'EOF'
[Unit]
Description=CheetahAdvanced — content-attribution + discovery librarian
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=<APP_DIR>/repo
EnvironmentFile=<ETC_DIR>/cheetah.env
ExecStart=/usr/bin/node cheetah/index.js --cron
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/melek-cheetah.log
StandardError=append:/var/log/melek-cheetah.log

NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=<DATA_DIR> /var/log
EOF

systemctl daemon-reload && systemctl enable --now cheetah.service
systemctl status cheetah.service
```

## Step 7 — give the resident AI (resident-AI-host) read access to Cheetah's store

The shared-store integration from CHEETAH_ADVANCED.md §3: Hathor reads what Cheetah writes. Once the Oracle box is up:

```bash
# On the Oracle box: install resident-AI-host's SSH pubkey so resident-AI-host can read
# <DATA_DIR>/cheetah-store.json:
mkdir -p /root/.ssh && chmod 700 /root/.ssh
# Append resident-AI-host's pubkey to /root/.ssh/authorized_keys with from="<resident-AI-host IP>"
```

(The exact pubkey + from= clause comes from `resident-AI-host:/root/.ssh/melek_a_to_oracle.pub` — generate that key on resident-AI-host first if it doesn't exist.)

Then on resident-AI-host, add a periodic rsync of the cheetah store into the resident AI's data dir so Hathor's brief generator sees it:

```bash
# crontab on resident-AI-host, every 5 min:
*/5 * * * * rsync -a oracle:<DATA_DIR>/cheetah-store.json <DATA_DIR>/cheetah-store.json 2>/dev/null
```

## Step 8 — when operator shares SSH access with the Codespace

If operator adds the Oracle box to the Codespace's SSH config:

```
Host melek-oracle
  HostName <oracle-ip>
  User <user>
  IdentityFile ~/.ssh/melek_oracle
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  ServerAliveInterval 30
```

Claude Code can then run steps 1-7 from the Codespace with `ssh melek-oracle ...` directly.

## What's NOT in this runbook (deferred)

- `cheetah/index.js` orchestrator + fixture harness — next ship in Bot repo
- Live chain-query backend in `text-detection.js` — gates on `MELEK_RPC_URL`
- Web search backend implementation — gates on operator's backend choice
- Hathor's resolution flow (Phase 3 work, gates on conversational layer)
- Image detection (build order step 6 — last because hardest)
- CSAM + illegal-content policing pipeline — see `cheetah/policing.md`, gates on PhotoDNA / NCMEC access + counsel review

## Cross-references

- `cheetah/README.md` — module overview + design constraints
- `CHEETAH_ADVANCED.md` — the full design brief (build order, voice, prior art)
- `.local/CURRENT_PRIORITIES_2026-05-28.md` — why this is the current focus
- `.local/ARCHITECTURE_OVERVIEW_2026-05-28.md` — where Cheetah fits in the larger architecture

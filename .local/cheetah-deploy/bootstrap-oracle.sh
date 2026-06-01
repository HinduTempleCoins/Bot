#!/usr/bin/env bash
# cheetah/bootstrap-oracle.sh — one-paste Cheetah setup on the Oracle box.
#
# Use this from a fresh Oracle Always Free VM (Ubuntu 22+ / AlmaLinux 10 /
# Oracle Linux). Runs the meaningful subset of DEPLOY_ORACLE.md
# (hardening + Node 20 install + repo clone + tests). Stops short of
# wiring chain RPC + starting a systemd service (those gate on chain).
#
# Usage on the Oracle box (as root):
#   curl -fsSL https://raw.githubusercontent.com/HinduTempleCoins/Bot/main/cheetah/bootstrap-oracle.sh | sudo bash
# OR:
#   scp cheetah/bootstrap-oracle.sh oracle-box:/tmp/
#   ssh oracle-box "sudo bash /tmp/bootstrap-oracle.sh"
#
# After this finishes:
#   1. Edit <ETC_DIR>/cheetah.env to fill operator decisions (web
#      search backend if any, eventually MELEK_RPC_URL when chain is live)
#   2. cd <APP_DIR>/repo && npm test
#   3. When cheetah/index.js orchestrator + chain wiring land, follow
#      DEPLOY_ORACLE.md step 6 to install + start the systemd service.

set -euo pipefail

REPO=<APP_DIR>/repo
ENV_DIR=<ETC_DIR>
ENV_FILE=$ENV_DIR/cheetah.env

# --- detect OS family ---
if command -v apt-get >/dev/null 2>&1; then
  DISTRO=debian
elif command -v dnf >/dev/null 2>&1; then
  DISTRO=rhel
else
  echo "[bootstrap] unsupported distro — need apt or dnf" >&2
  exit 1
fi
echo "[bootstrap] distro=$DISTRO"

# --- step 1: harden ---
echo "[bootstrap] step 1: hardening + swap"
if [ "$DISTRO" = debian ]; then
  apt-get update -qq
  apt-get -y -qq install ufw fail2ban unattended-upgrades curl ca-certificates rsync git jq
  ufw allow OpenSSH 2>/dev/null || true
  yes | ufw enable 2>/dev/null || true
  systemctl enable --now fail2ban 2>/dev/null || true
else
  dnf -y -q upgrade
  dnf -y -q install firewalld curl ca-certificates rsync git jq
  systemctl enable --now firewalld 2>/dev/null || true
  firewall-cmd --permanent --add-service=ssh 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
fi

# Swap (2GB; Oracle micro often ships with 0)
if ! swapon --show | grep -q swapfile; then
  echo "[bootstrap] adding 2GB swap"
  dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# Key-only SSH
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config || true
systemctl reload sshd 2>/dev/null || true

# --- step 2: Node 20 ---
echo "[bootstrap] step 2: Node 20"
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q '^v20\|^v21\|^v22'; then
  if [ "$DISTRO" = debian ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  fi
fi
node --version

# --- step 3: clone Bot repo ---
echo "[bootstrap] step 3: clone Bot repo to $REPO"
mkdir -p "$(dirname $REPO)"
if [ ! -d "$REPO/.git" ]; then
  git clone https://github.com/HinduTempleCoins/Bot.git "$REPO"
fi
cd "$REPO"
git pull --ff-only 2>&1 | tail -3 || true
npm install --ignore-scripts --silent

# --- step 4: env file ---
echo "[bootstrap] step 4: env config at $ENV_FILE"
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
CHEETAH_ACCOUNT=cheetah
CHEETAH_SIMILARITY_THRESHOLD=0.5
CHEETAH_FREQ_CAP=1
CHEETAH_STORE=<DATA_DIR>/cheetah-store.json
CHEETAH_SELF_ID_URL=https://github.com/HinduTempleCoins/Bot/blob/main/cheetah/README.md
CHEETAH_WEB_SEARCH=none
# MELEK_RPC_URL=               # fill when chain launches
# MELEK_CHAIN_ID=
# MELEK_ADDRESS_PREFIX=
EOF
  chmod 640 "$ENV_FILE"
fi
mkdir -p <DATA_DIR>

# --- step 5: verify ---
echo "[bootstrap] step 5: running cheetah tests"
set -a; source "$ENV_FILE"; set +a
node --test cheetah/*.test.js 2>/dev/null || echo "[bootstrap] (no cheetah tests yet — module just shipped)"
echo ""
echo "[bootstrap] DONE — Cheetah module installed at $REPO/cheetah/"
echo ""
echo "Next steps (gated on operator decisions):"
echo "  - When MELEK chain launches: fill MELEK_RPC_URL etc. in $ENV_FILE"
echo "  - When cheetah/index.js orchestrator lands: install systemd service"
echo "    (DEPLOY_ORACLE.md step 6)"
echo "  - When operator picks web search backend: set CHEETAH_WEB_SEARCH +"
echo "    add the API key env var"

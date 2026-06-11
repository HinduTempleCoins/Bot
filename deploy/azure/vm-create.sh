#!/usr/bin/env bash
# vm-create.sh — az-CLI alternative to main.bicep. Creates ONE 4 vCPU / 16 GB
# Linux VM for the MELEK TESTNET node + Cheetah/Hathor tests + brain/Memory
# server. Same shape as the Bicep; pick whichever you prefer.
#
# NOTE — NO CRYPTO MINING ON AZURE. Azure's Acceptable Use Policy forbids
# cryptocurrency mining. This VM runs a non-mining testnet witness, the test
# harness, and Postgres/pgvector. Mining stays on the dedicated mining box.
#
# Every value is an ENV placeholder — no real names/IPs/keys live in this file.
# Set them in your shell (or source a .local/ env file) before running:
#
#   export RESOURCE_GROUP=melek-rg
#   export LOCATION=eastus
#   export VM_NAME=melek-node
#   export ADMIN_USER=melek
#   export SSH_PUBKEY_FILE="$HOME/.ssh/melek_node.pub"   # PUBLIC key only
#   export SSH_SOURCE_CIDR=203.0.113.4/32                # YOUR ip — never commit it
#   export VM_SIZE=Standard_B4as_v2                      # or Standard_D4ps_v5 (ARM)
#   export OS_DISK_GB=128
#   bash deploy/azure/vm-create.sh
#
set -euo pipefail

# ── required / defaulted env ────────────────────────────────────────────────
RESOURCE_GROUP="${RESOURCE_GROUP:?set RESOURCE_GROUP}"
LOCATION="${LOCATION:-eastus}"
VM_NAME="${VM_NAME:-melek-node}"
ADMIN_USER="${ADMIN_USER:-melek}"
SSH_PUBKEY_FILE="${SSH_PUBKEY_FILE:?set SSH_PUBKEY_FILE to your PUBLIC key path}"
SSH_SOURCE_CIDR="${SSH_SOURCE_CIDR:-0.0.0.0/32}"   # placeholder — REPLACE with your /32
VM_SIZE="${VM_SIZE:-Standard_B4as_v2}"             # 4 vCPU / 16 GB burstable; ARM alt: Standard_D4ps_v5
OS_DISK_GB="${OS_DISK_GB:-128}"
IMAGE="${IMAGE:-Canonical:ubuntu-24_04-lts:server:latest}"
CLOUD_INIT="${CLOUD_INIT:-$(dirname "$0")/cloud-init.yaml}"
P2P_PORT="${P2P_PORT:-2001}"

echo "[vm-create] resource group: $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "[vm-create] creating VM $VM_NAME ($VM_SIZE) — NO MINING (Azure AUP)"
az vm create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --image "$IMAGE" \
  --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --ssh-key-values "$SSH_PUBKEY_FILE" \
  --os-disk-size-gb "$OS_DISK_GB" \
  --storage-sku StandardSSD_LRS \
  --public-ip-sku Standard \
  --custom-data "$CLOUD_INIT" \
  --tags project=MELEK role=testnet-node-and-brain mining=forbidden-azure-aup \
  --output table

# SSH only from the operator's address; testnet P2P open to peer.
echo "[vm-create] locking SSH to $SSH_SOURCE_CIDR, opening testnet P2P $P2P_PORT"
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" \
  --port 22 --priority 100 --output none
az network nsg rule create \
  --resource-group "$RESOURCE_GROUP" \
  --nsg-name "${VM_NAME}NSG" \
  --name allow-ssh-operator \
  --priority 101 \
  --access Allow --direction Inbound --protocol Tcp \
  --source-address-prefixes "$SSH_SOURCE_CIDR" \
  --destination-port-ranges 22 --output none || true
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" \
  --port "$P2P_PORT" --priority 110 --output none

echo "[vm-create] done. RPC/Postgres/brain stay bound to localhost on the VM."
echo "[vm-create] ssh ${ADMIN_USER}@\$(az vm show -d -g $RESOURCE_GROUP -n $VM_NAME --query publicIps -o tsv)"

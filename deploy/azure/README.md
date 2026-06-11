# deploy/azure — MELEK testnet + brain VM on Azure

Infrastructure-as-code to stand up **one** Linux virtual machine on Azure that runs:

1. the **MELEK testnet node** (a non-mining Graphene witness on the test chain),
2. the **Cheetah / Hathor test harness** (`npm test` and the live-ish checks), and
3. the **brain / Memory server** — PostgreSQL with the **pgvector** extension for the embeddings store.

It is two interchangeable ways to create the same VM, plus a cloud-init that sets the box up on first boot, plus a tiny offline validator.

```
deploy/azure/
  main.bicep        # declarative IaC (recommended)
  vm-create.sh      # same thing as an az-CLI script (pick one)
  cloud-init.yaml   # first-boot: installs node + postgres + pgvector, clones the repo
  validate.mjs      # offline checker (exported API + CLI)
  validate.test.mjs # node:test suite, fully offline
  README.md         # this file
```

---

## ⛔ NO CRYPTO MINING ON AZURE

Azure's Acceptable Use Policy / Online Services Terms **prohibit cryptocurrency mining** on Azure resources. Running a miner here can get the subscription suspended.

**This VM does not mine.** It runs the testnet *witness* node (block production on the test chain is not mining — it's consensus signing, no proof-of-work), the test suite, and the Postgres/pgvector brain. The actual mining (browser-miner, RandomX, the pool) lives on the **separate dedicated mining box** — see `pool/` and the mining-server brief. Keep it that way.

---

## What it builds

- A **4 vCPU / 16 GB** Linux VM. Default size `Standard_B4as_v2` (x86 burstable — cheapest steady option). Cheaper ARM alternative: `Standard_D4ps_v5` (Ampere). Both have 4 vCPU / 16 GB and comfortably run a testnet node + Postgres + the test suite.
- Ubuntu 24.04 LTS, **SSH-key login only** (password auth disabled).
- A small VNet/subnet, a network security group that **locks SSH to your IP** and opens the testnet **P2P** port so the node can peer. The RPC, Postgres, and brain stay bound to `localhost` on the VM — not exposed.
- cloud-init installs Node LTS, PostgreSQL, builds and installs **pgvector**, creates the brain database with the `vector` extension, and clones the repo.

Everything sensitive — names, your IP, the SSH public key, repo URL, DB names — is a **parameter / env placeholder**. No real values, IPs, or secrets are in these files (the `validate` test enforces that).

---

## Cost (rough, pay-as-you-go, East US, 2026)

| Item | ~Monthly |
|---|---|
| `Standard_B4as_v2` (4 vCPU / 16 GB, burstable) | ~$120–150 |
| `Standard_D4ps_v5` (4 vCPU / 16 GB, ARM) | ~$110–140 |
| 128 GB StandardSSD managed disk | ~$10 |
| Standard public IP | ~$3–4 |

So roughly **$120–165/month** all-in if it runs 24/7. You can **deallocate** the VM when you don't need it (you stop paying for compute, only the disk). Prices vary by region and change over time — confirm in the Azure Pricing Calculator before committing.

### Free credits

A new Azure account comes with a **$200 free credit for 30 days** plus some always-free services. The MELEK operator path uses Azure as the **free-server route** for testnet + test compute + the brain (see the plugins-to-reinstall memory note). The free credit comfortably covers a month of this VM for evaluation. After the credit, either keep it small/deallocated or move the brain to a cheaper host.

---

## Deploy it

### 0. One-time: log in and pick a subscription

```bash
az login                      # opens a browser; sign in
az account set --subscription "<your-subscription-name-or-id>"
```

### 1. Make an SSH key (public part goes to Azure; private part stays with you)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/melek_node -C melek-node
# ~/.ssh/melek_node.pub  -> upload   |   ~/.ssh/melek_node -> keep secret, never commit
```

### Option A — Bicep (recommended)

```bash
az group create --name melek-rg --location eastus

az deployment group create \
  --resource-group melek-rg \
  --template-file deploy/azure/main.bicep \
  --parameters \
      vmName=melek-node \
      adminUsername=melek \
      vmSize=Standard_B4as_v2 \
      sshPublicKey="$(cat ~/.ssh/melek_node.pub)" \
      sshSourceAddressPrefix="$(curl -s ifconfig.me)/32" \
      cloudInitBase64="$(base64 -w0 deploy/azure/cloud-init.yaml)"
```

> Before deploying, substitute the `__PLACEHOLDER__` tokens in `cloud-init.yaml`
> (`__REPO_URL__`, `__REPO_BRANCH__`, `__ADMIN_USER__`, `__BRAIN_DB__`,
> `__BRAIN_DB_USER__`). Do it with a throwaway copy in `.local/` (gitignored) so
> real values never land in the public repo. The brain DB **password is not set
> by cloud-init** — generate it on the box or inject via your secret tooling.

### Option B — az-CLI script

```bash
export RESOURCE_GROUP=melek-rg
export LOCATION=eastus
export VM_NAME=melek-node
export ADMIN_USER=melek
export SSH_PUBKEY_FILE=~/.ssh/melek_node.pub
export SSH_SOURCE_CIDR="$(curl -s ifconfig.me)/32"   # your IP — never commit it
export VM_SIZE=Standard_B4as_v2
bash deploy/azure/vm-create.sh
```

### 2. Connect

```bash
ssh -i ~/.ssh/melek_node melek@<public-ip-from-the-output>
cd ~/Bot && npm test     # the offline suite should be green
```

### 3. Tear down (stop paying)

```bash
az vm deallocate -g melek-rg -n melek-node   # stop compute, keep disk
# or delete everything:
az group delete --name melek-rg --yes
```

---

## Validate the IaC (offline, no Azure needed)

```bash
cd /workspaces/Bot
node --test deploy/azure/validate.test.mjs   # all green
node deploy/azure/validate.mjs               # prints a JSON report, exits 0 if OK
```

The validator parses the Bicep/script + cloud-init and checks: a 4 vCPU / 16 GB VM size, an SSH-key seam with password auth off, the no-mining note, Node + Postgres + pgvector in cloud-init, a placeholder repo URL, and that **no real public IP** is present. It never calls `az` or compiles Bicep.

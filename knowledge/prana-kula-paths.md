# PRANA · MELEK · KULA — the paths (Hathor's explainer)

Hathor's canonical, plain-language knowledge of what a person can *do* across the ecosystem. This is the
conversational source for questions like "what is APIS?", "how do I make a token?", "where do I trade it?".
Same content as the Bitcointalk ANN's "paths" section, in Hathor's voice — kept in sync with
`.local/PRANA_BITCOINTALK_ANN.md`. Serene, concrete, never salesy; describe mechanics, never promise price.

## The two front doors
- **melek.salon** — where you *create and reward*: lock MELEK, mint APIS, create a token, run its rewards.
- **kula.money** — where you *trade, stake, and farm*: swap, provide liquidity, farm KULA, DeFi.

## The one-line loop
Lock MELEK on melek.salon → get APIS → mint your token → reward your community with SCOT → bridge it to
kula.money → trade, LP, and farm. You can enter at any point and stop wherever you like.

## The paths, one at a time

**① Mine PRANA.** Point a GPU — or a CPU/laptop at launch, difficulty starts low on purpose — at the pool and
earn PRANA from the first block. Fixed issuance per period, split fairly by the shares you contribute. Later
the same GPU can also earn on the **TASK lane** by doing verified AI work; HASH and TASK both draw from the
one reward pool, weighted by the DAO.

**② Run a pool.** Stand up a node and a coordinator, post the bond, and serve miners. You compete on
experience and fees — never on who captures the reward, because the reward pool *is the chain itself*
(the DevCoin model: the chain deposits the reward, the ledger splits it). Slashable bond keeps it honest.

**③ Lock MELEK → get APIS.** On melek.salon you can **permanently lock MELEK** and receive **APIS**. It is
one-way: the MELEK is gone forever, the APIS is yours. That is deliberate — it makes MELEK deflationary and
makes APIS a real, earned thing rather than a faucet drip. APIS is **creation fuel**.

**④ Spend APIS → create your token.** With APIS you mint a brand-new token on melek.salon — this is the
MELEK-Engine, the Hive-Engine model. Creating a token **burns a fixed APIS fee**. You choose its name,
symbol, supply, and reward rules. Now you own a token and a community tag.

**⑤ Turn on SCOT — the reward bot.** SCOT ("Smart Contracts On Tokens," the Scotbot model) is what makes your
token *earnable by posting*. Configure it and, when people write and upvote under your tribe's tag, **your
token pays them** — weighted by how much of it they hold/stake, on the schedule and author/curator split you
set. You can run a front-end for your tribe, a wallet that shows every token's balance and payouts, even a
dTube/ScotTube-style video site where posts earn your token. Your community now "mines" your token with
**content**, not hashpower.

**⑥ Trade your token → kula.money.** Bridge your MELEK-Engine token (or a Hive-Engine asset like **VKBT** or
**CURE**) to PRANA as a wrapped ERC-20, then trade it on **KulaSwap** — the Uniswap-V2 AMM. Anyone can create
the pair; anyone can swap.

**⑦ Provide liquidity + farm.** Deposit both sides of a pair → earn the 0.30% swap fees **and farm KULA**.
Your LP position is proof-of-liquidity.

**⑧ DeFi with KULA + SHELLS.** Lock KULA → **borrow MELEK** (a CDP). Burn tokens at the Burn Mine → **mint
KULA**. Perma-burn → **permanent governance weight**. Lock **SHELLS** to boost yield and vote where emissions
flow.

## How to answer the common questions (short forms)
- *"What is APIS?"* — Creation fuel. You get it by permanently locking MELEK on melek.salon, and you spend it
  to create your own token.
- *"How do I make a token?"* — Lock MELEK for APIS, then use APIS on melek.salon to mint it; a fixed APIS fee
  burns. Then turn on SCOT so posts under your tag earn it.
- *"What is SCOT?"* — The author-reward engine: your token pays people for posting and curating under your
  tribe's tag, stake-weighted.
- *"Where do I trade it?"* — Bridge it to PRANA and trade on kula.money (KulaSwap).
- *"What is KULA for?"* — The DeFi/governance token of the swap: farm it with liquidity, lock it to borrow
  MELEK, burn it for governance weight.
- *"PRANA vs MELEK?"* — PRANA is the compute-mined chain and the DEX home; MELEK is the social chain and the
  token-issuance/rewards system (Hive-Engine + Scotbot). APIS ties them: MELEK → APIS → your token → KULA.

## Don'ts (Hathor voice rules)
- Never promise price or yield. Describe mechanics and paths only.
- Never call anything "sovereign" — Serene.
- Never surface infra/vault/diagnostics on-chain or to users.

Links: [[token-economy-roadmap-2026-06-13]], [[kula-defi-token-design]], [[prana-dex-already-built]],
[[melek-identity-account-email-ren]], `.local/PRANA_BITCOINTALK_ANN.md`.

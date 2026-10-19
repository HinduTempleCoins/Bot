# Hathor — command reference

Hathor answers these commands around the clock on Discord, Telegram (use `/` instead of `!`), and the
MELEK troll-box. Every command is deterministic and read-only. None of them waits on an AI, and every
number comes from the live chain at the moment you ask.

**Hathor never needs your password, keys or seed phrase.** Give her only a public account name
(`@name`) or a public `0x` address. If you paste a secret, she deletes the message where she can and
tells you to rotate it.

Status legend:
- **LIVE**: answers from live data at launch.
- **LIVE (sim)**: works end to end at launch, but anything that moves value is simulated until the
  operator switches it on.
- **🚧**: replies with an Under Construction notice.

## MELEK steemd: the live MELEK chain

| Command | Returns | Launch |
|---|---|---|
| `!account @name` | Liquid / MBD / savings balances, POWER (own, delegated out and in, effective), voting mana, witness votes, followers, unclaimed rewards, reputation | LIVE |
| `!balance @name` | One-line balances | LIVE |
| `!rc @name` | Resource credits where the node publishes them; otherwise voting mana | LIVE |
| `!delegations @name` | Outgoing POWER delegations and total received | LIVE |
| `!followers @name` / `!following @name` | Counts and the latest names | LIVE |
| `!blog @name` | That account's 5 latest posts | LIVE |
| `!post @author/permlink` (or a melek.salon link) | Title, votes, replies, pending or paid payout | LIVE |
| `!payout @author/permlink` | Payout status, max accepted, beneficiaries | LIVE |
| `!votes @author/permlink` | Voters by weight | LIVE |
| `!replies @author/permlink` | Replies with a short preview | LIVE |
| `!trending [tag]` · `!hot [tag]` · `!new [tag]` | Top 5 posts with payout and link | LIVE |
| `!witness @name` · `!hathor` | Active or standby, version, last block, missed blocks, vote weight, price feed, props | LIVE |
| `!witnesses` | Top 21 by vote, with active marker and missed blocks | LIVE |
| `!schedule` | The current witness round order and next shuffle block | LIVE |
| `!missed @name` | Total missed blocks and last produced block | LIVE |
| `!feed` · `!mbd` | Median MBD price; says so honestly when no witness feed is published | LIVE |
| `!chain` · `!props` | Head and irreversible block, hardfork, supply, reward split, account fee | LIVE |
| `!hardfork` | Running hardfork version | LIVE |
| `!rewardfund` | Reward pool balance, recent claims, curation % and curves | LIVE |
| `!block [n]` | A block's time, producer and operations (latest block if no number) | LIVE |
| `!tx <id> <block>` | A transaction's operations. MELEK nodes can't look up by id alone, so give the block too | LIVE |
| `!engine` · `!engine @name [SYMBOL]` | MELEK-Engine tokens and supply, or an account's token balances | LIVE |
| `!nodes` | Health of each MELEK RPC node in the failover order | LIVE |
| `!steemd <cmd> …` · `!sb <cmd> …` | The same chain commands under the steemd prefix. Market verbs (`markets`, `clarity`, …) are unchanged | LIVE |

## Tokenomics: live supply, emission and price

| Command | Returns | Launch |
|---|---|---|
| `!tokenomics` | One line per token: PRANA, KULA, MELEK, VKBT, CURE, wrapped tokens, WMELEK, APIS | LIVE |
| `!prana` | Chain height, blocks, addresses, issued so far, the 2 PRANA block reward and 2% Hathor fee, HathorFeeTreasury balance, KulaSwap price | LIVE |
| `!kula` | Supply against the 11M cap, holders, KULA locked in veKULA, price in PRANA, the emission schedule and split | LIVE |
| `!melek` | Supply, MBD, POWER, accounts, current inflation and its split, WMELEK/wMELEK with custody balance | LIVE |
| `!vkbt` · `!cure` | Hive-Engine supply, max, staked, holders, last/bid/ask, wrapped supply and bridge custody | LIVE |
| `!wvkbt` · `!wcure` · `!wmelek prana` | Bridged supply on PRANA, holders, KulaSwap price, contract | LIVE |
| `!wmelek` · `!apis` | MELEK-Engine supply and backing | LIVE |

## Faucet

| Command | Returns | Launch |
|---|---|---|
| `!faucet` | Each faucet with a live status check | LIVE |
| `!faucet prana 0x…` | Test PRANA (alpha chain 108369) sent to your public address | LIVE (sim): replies with a dry run until switched on, and links the faucet page |
| `!faucet melek [testnet]` | Free MELEK account. Keys are made in your browser, then the welcome grant arrives | LIVE |
| `!faucet prana mainnet` | No mainnet faucet; mainnet PRANA is mined | 🚧 |

## Tips (PIZZA-style)

Tips come out of Hathor's tip jar. You never sign anything, and the bot never touches your wallet.
The more of the tip token your verified wallet holds, the more tips you can give each day.

| Command | Returns | Launch |
|---|---|---|
| `!link 0x…` / `!link @name` | Links your public wallet and gives you a keyless proof to complete | LIVE |
| `!verify` | Checks your proof on-chain (a self-transfer of an exact dust amount, or a memo transfer) | LIVE |
| `!tip @user [n]` | Gives n tips, with a receipt | LIVE (sim) until the tip jar is funded and switched on |
| `!tips` | Your tier, quota left today, and recent receipts | LIVE |
| `!tipjar` | The jar's balance and today's total | LIVE |

## Guides: step by step, checked on-chain

`!guide` lists all guides. Start one with `!guide <topic> [@name | 0x…] [testnet|mainnet]`. Then use
`!next` (Hathor checks the step), `!step`, `!back`, and `!guide stop`.

Featured guides, all LIVE:
- `signup`: name is free, account exists, welcome grant arrived.
- `post`: a new post appears on-chain.
- `test-tokens` and `faucet`: test PRANA arrived.
- `metamask`
- `bridge`: wVKBT/wCURE minted, then burned on withdraw.
- `swap`: a new transaction from your address.
- `stake`: KULA moved into veKULA.
- `wmelek`: the deposit to @wmelek-bridge and the WMELEK credit.
- `autovote`
- `pool`: the pool sees your shares.
- `xmrig`
- `mining`
- `witness`: your witness registration.
- `tutorial`

Every other working flow on the site map is also available, with self-check steps.

Under construction: account recovery, witness voting, creating engine tokens, the seed shop, KULA
farming, move-to-earn, and staking DMP/ALTI. These give only the 🚧 notice.

## Everything else

`!help` lists all of this. `!ask <question>` searches the Resource Center. Discord:
https://discord.gg/Ghz672dW7Z (permanent invite, no expiry).

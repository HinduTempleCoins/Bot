# MELEK Testnet — LIVE QUEUE (2026-06-10)

Plain status. ✅ verified live · ▶ in progress · ☐ to do · — needs you.

## TESTNET — what's actually live right now (verified by HTTP this session)
- ✅ Chain producing — block ~115,953, advancing ~3s, hathor confirming (55 missed all-time).
- ✅ Condenser up + pointed at the testnet — alpha.melek.salon `/rpc` returns live testnet data (chain id 18dcf0…, prefix TST).
- ✅ Signup works e2e — real accounts created on-chain through the page (browser keygen, no operator keys).
- ✅ Login bug fixed (Jun 8) — dead failover endpoint that hung the spinner; now points at the real RPC.  ▶ re-verifying with a real browser this session.
- ✅ Welcome post on chain + renders — `/welcome/@hathor/welcome-to-melek-20260610` (ipsum dummy text, 5 welcome-replies). **Gap: not surfaced where you land — fixing.**
- ✅ Auto-welcomer live — every new account gets POWER + 5–15 TESTS + a ping on the Welcome post (5-min timer).
- ✅ Price feed restored — publishing hourly again.
- ✅ Cheetah test page live — `/cheetah/` scanned 14:52 today. **Gap: results not shown clearly — fixing.**

## ▶ The real gaps (surfacing + the last live pieces)
- ☐ Surface the Welcome post + Cheetah results on the landing page (you couldn't find them = my miss).
- ☐ TrollBox reply loop live — Hathor answers `!help`/`!signup` in the chat box in real time (JIT-key, like the welcomer).
- ☐ Tutorial UI page deployed at /tutorial (API exists; no page yet).
- ☐ Login re-verified in a real browser (running now, screenshot incoming).

## ☐ Backlog — buildable now (the agent wave targets these)
#176 standing self-fix loop · #259/#269 PRANA tooling around the chain · #261 payments/checkout · #262 codespace sibling-repos hub · #264 condenser on the spare ARM box · #265 Cheetah live-chain loop in the VM · #281 auto-fill blank site fields · #284 fetched-then-discarded data audit · #296 full new-user stitch · #308 welcome landing page.

## — Needs you (decisions)
- Tiny-LLM model per box · angelicalist go-live · Server-1 reboot vs move to melek-5 · #302 account-recovery policy · #251–253 OAuth app registration · #184 free gov API keys.

## 🔒 Gated (order you set 2026-06-10)
PRANA token tools → testnet fully working → other → HiveSigner clone. MELEK-Signer = Phase-0 parallel (JIT-vault bridges until then). Then mainnet → PRANA.

# Contributing to the MELEK AI Witness (Bot repo)

This repo is the off-chain operator software + character + knowledge corpus for **Hathor**, a founding witness on the MELEK chain. Read `BRIEF.md` (the founding brief) and `CLAUDE.md` (orientation) before contributing.

## Ground rules

- **Private-by-default.** This is a public repo, but the project is private-first. Operator-specific things — credentials, integrations to the operator's accounts (registrar/DNS/exchange), vault tooling, server/infra details, the Telegram bridge, the brain internals — **never go in the repo**. They live in `.local/` (gitignored) or the vault. A git pre-commit/pre-push hook blocks the obvious cases; don't `--no-verify` around it.
- **No secrets, ever.** No WIF private keys, API tokens, IPs, host aliases, or `/var|/etc/...` infra paths in tracked files. Broadcasting goes through MELEK-Signer with a scoped token — never a local key (`SECURITY.md`, `MELEK_SIGNER.md`).
- **Read before you replace.** Don't delete or rewrite a file to "fix" it without reading what's there. Bring improvements in; don't remove working tech.
- **Append-only where it's marked.** `ITINERARY.md`, `MASTER_ITINERARY.md`, and the annals/briefs are append-only — add, never overwrite.

## Code style

- Match the surrounding code's idiom, comment density, and naming. The integrations layer (`integrations/`) is terse, read-only, keyless ES modules — follow that shape.
- Read-only by default. Anything that could spend, trade, broadcast, or mutate remote state is gated (dry-run default, explicit `--yes`, or deferred to MELEK-Signer).
- Tests: `node --test`. Add tests for pure logic (see `integrations/*.test.js`). Run `npm test` and `npm run preflight` before a PR.

## Submitting a PR

1. Branch from `main`. Keep PRs focused.
2. Run `npm test` + `npm run preflight` (preflight scans for leaked secrets and unpinned deps).
3. Describe the change in plain English first (the operator is not a programmer — lead with the real-world effect, not file paths).
4. No proprietary/operator-specific content in the diff.

## Security disclosure

Found a leaked secret or a vulnerability? **Do not open a public issue.** Email the operator (see `README`/`CONTACT`). Key-leak incidents are treated as emergencies — the angelicalist key leak is why the zero-WIF rule and the commit guard exist.

## What lives where

- `integrations/` — read-only market/chain intelligence (public, keyless).
- `tools/` — repo-side helpers (graders, rankers — public, no secrets).
- `knowledge/scripture/` — the canonical corpus (verbatim operator documents).
- `witness/`, `signup/`, `tutorial/`, `commands/` — the phased build.
- `.local/` — **private**, gitignored. Infra, credentials-adjacent tooling, synthesis maps.

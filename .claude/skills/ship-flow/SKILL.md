---
name: ship-flow
description: Ship a change in the MELEK Bot repo. Use whenever committing, pushing, opening a PR, or merging — pushes to main are blocked, so all work goes branch → commit → push → PR → merge. Covers the pre-commit hook (no hostnames/IPs/keys in public commits) and the worktree --delete-branch gotcha.
---

# Ship flow

Pushes to `main` are blocked by the harness. Never `git commit`/`push` on `main`.

## Steps
1. Branch off main: `git checkout -b <short-kebab-name>`.
2. Make changes. Keep anything secret out of the diff (see Pre-commit hook).
3. Stage + commit. End the commit message with exactly:
   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```
4. `git push -u origin <branch>`
5. `gh pr create --fill` (or `--title`/`--body`). End PR bodies with:
   ```
   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```
6. `gh pr merge <num> --merge --delete-branch`
7. `git checkout main && git pull`

## Pre-commit hook constraints
A pre-commit hook blocks public commits that contain server paths, hostnames, IPs, or key material (also enforced by gitleaks). If a commit is rejected:
- Move the offending content into `.local/` (gitignored) — never weaken the hook to pass.
- `.env`, `.local/`, runtime `*.state.json`, `*.jsonl`, `data/`, `infra/` are already ignored.
- Reference private hosts/keys by role ("the chain host", "the operator vault"), never by name/IP.

## Worktree gotcha
`--delete-branch` FAILS (or detaches HEAD badly) if the branch is checked out in a git worktree. When working inside `.claude/worktrees/...`:
- Do NOT pass `--delete-branch` while that branch is the worktree's checkout.
- Either merge without `--delete-branch` and delete the branch after the worktree is gone, or run the merge from a clone where the branch is not checked out.
- Check first: `git worktree list`.

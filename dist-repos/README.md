# dist-repos — distributable packages (prepared for publishing as standalone repos)

Each subfolder is a self-contained package meant to live in its OWN public repo so third parties can adopt
MELEK pieces. Canonical source stays in the monorepo (`integrations/`); these are shippable snapshots.

The Codespace token cannot create repos (`Resource not accessible by integration`), so publishing needs a
PAT with `repo` scope (or create the repo in the GitHub UI), then:

```bash
# 1. create the repo (UI, or with a repo-scoped PAT):
gh repo create HinduTempleCoins/login-with-melek --public \
  --description "Add \"Login with MELEK\" to any website — self-owned on-chain identity, standard OIDC, minimal permission."

# 2. push the package contents:
cd dist-repos/login-with-melek
git init -b main && git add . && git commit -m "Login with MELEK v0.1.0"
git remote add origin https://github.com/HinduTempleCoins/login-with-melek.git
git push -u origin main
```

## Prepared
- **login-with-melek/** — the embeddable button SDK + standard OIDC provider + multi-provider session +
  permission tiers (funds hard-off). Self-contained, all modules load standalone. READY.

## Planned (next)
- **melek-widgets/** — the Soapy widget suite (chat, translate, follow, comments, login) one-tag loader.
- **hathor-discord-bot/** — Hathor as a Discord bot (chat + `!vote` callable + delegation invites).
- **soulava-delegation/** — the delegation-program + vote-command + SOULAVA token (once the name is locked).

# Legacy trade-bot fleet (archived for provenance)

These ~29 January-era `.cjs`/`.js` files were the first-generation Van Kush / Hive trade-bot fleet.
They are **archived, not deleted**, so the history and the strategy ideas stay readable. They are
**superseded and unsafe to run** for two reasons:

1. **Local-WIF execution.** They sign locally with a hard-read private key — the exact posture the
   current repo forbids (zero-WIF-on-host). The current system instead keeps execution gated and
   MELEK-Signer-only; the repo-side strategy/scanner code is pure and key-free.
2. **Superseded.** Every useful idea here was rebuilt, tested, and made safe in `integrations/`:
   - strategy brain → `integrations/trade-strategies.mjs` (pure, dryRun:true/signer:null registry)
   - arb scanning → `integrations/arb-scanner.mjs`, `cross-venue-arb.mjs`, `cex-arb.mjs`,
     `chains/crosschain-arb.mjs`, unified by `integrations/arb-facade.mjs`
   - market-making / walls / price support → `integrations/price-nudge.mjs`, `wall-bot.mjs`
   - config → `integrations/trade-config.mjs`
   - the live (gated) execution path → `integrations/angelicalist/{trader,execute,loop}.mjs`

Nothing in `integrations/` or any live service imports these files (verified by grep before the move;
only the `site/admin/repo-manifest.json` catalog and each other referenced them). Kept here for the
record only — do not wire them back in.

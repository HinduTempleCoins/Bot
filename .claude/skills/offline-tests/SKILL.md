---
name: offline-tests
description: Write and run tests / HTTP modules in the MELEK Bot repo to house style. Use when adding a .mjs module, a handler, or a *.test.mjs, or running npm test. Enforces node --test, fully offline (injectable fetch, no network), soft-fail-never-throw, esc() interpolation, and the handler/CLI export shape.
---

# Offline tests + module house style

`npm test` runs `node --test` across all module dirs. Every test MUST pass offline — no network, ever.

## Test rules
- Use the built-in test runner: `import { test } from 'node:test'` + `node:assert`.
- Never hit the network. Inject fetch via the module's `__setFetch()` hook with a fake; assert on the fake's calls. If a module fetches, it MUST export `__setFetch`.
- Soft-fail, never throw: readers/handlers return a safe empty/`{ ok:false }` shape on any error — they do not throw to the caller. Test the failure path returns the safe shape (do NOT assert it throws).
- Tests live next to code as `<name>.test.mjs`.

## Module house style
- ESM `.mjs` only.
- `esc()` ALL interpolation into HTML/output — no raw template values.
- Export `handler(req, res)` for HTTP modules so tests can call it directly without a live server.
- Guard CLI entry with `if (process.argv[1] === fileURLToPath(import.meta.url))` so importing the module for tests has no side effects.
- Read config from env: `PORT`, `BASE_URL` (with sane defaults).

## Run
- `npm test` — full suite.
- `node --test path/to/dir/` — one dir while iterating.
- `npm run hello` — Phase-1 smoke against the live testnet RPC (network; not part of the offline suite).

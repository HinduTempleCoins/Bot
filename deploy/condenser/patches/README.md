# Condenser build patches

Empty by design. The condenser (`HinduTempleCoins/melek-condenser`) **built clean** with
Node 22 + `npm ci` + `NODE_OPTIONS=--openssl-legacy-provider` (see `../RUNBOOK.md` §0) —
no source changes were required.

If a future build on the box needs a code fix, store it here as a `.patch` and
`git apply` it on the box during the build step. **Never commit the fix into the condenser
repo** — these patches keep the condenser repo pristine and the change auditable from the
Bot repo.

```sh
# create:  (in the condenser checkout, after editing)
git diff > <BOT_REPO>/deploy/condenser/patches/0001-short-description.patch
# apply on the box:
cd <INSTALL_DIR> && git apply <BOT_REPO>/deploy/condenser/patches/0001-short-description.patch
```

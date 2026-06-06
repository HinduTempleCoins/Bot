# Hierophant — deploy runbook (hierophant.soapbox.community)

The Hierophant is the Temple's library of sacred texts — a zero-dependency Node HTTP service in the
SoapBox house style (mirrors `site/politics/`). It serves a catalog that **links out** to
Sacred-Texts / Gutenberg / Theoi / Archive.org (it never hosts full primary text), a cross-tradition
gods-and-things encyclopedia, and an "Ask the Hierophant" oracle over the Temple's own corpus.

**Everything below is a TEMPLATE.** `__DOMAIN__`, the host, the user and the unit name are placeholders —
fill them in at deploy time on the box itself. Nothing here should be committed with real host/service
values (the pre-commit hook blocks hostnames/keys in public commits — keep specifics in `.local/`).

---

## What runs

- **Entry point:** `site/hierophant/server.mjs`
- **Port:** `PORT` env (default `8124`)
- **Public base:** `BASE_URL=https://__DOMAIN__`
- **Data:** `integrations/hierophant-catalog.mjs` (the texts) + `integrations/hierophant-entities.mjs`
  (the figures). Pure data, no network, no keys.
- **Ask the Hierophant:** lazily imports `integrations/library-rag.mjs` → `askLibrary()`, which retrieves
  from the Library wiki (`WIKI_SITE`) and, if an LLM provider key is present, grounds an answer on it.
  With no key it degrades to returning the retrieved passages. **No key is required for the site to run** —
  `/ask` soft-fails to an honest "the corpus doesn't cover that" state.

### Environment (set on the host, not here)

| Var | Purpose | Default |
|---|---|---|
| `PORT` | listen port | `8124` |
| `HOST` | bind address | `127.0.0.1` |
| `BASE_URL` | public origin (canonical/sitemap) | `http://localhost:$PORT` |
| `WIKI_SITE` | Library wiki the RAG retrieves from | `https://wiki.soapbox.community` |
| `SOAPBOX_SITE` / `SEARCH_SITE` | cross-site footer links | data/search defaults |
| *(optional)* an LLM provider key | upgrades `/ask` from passages to a grounded answer (read by `llm-router`) | unset → degraded |

---

## Operator-present steps

1. **Pull + smoke-test offline (any host):**
   ```
   npm test            # full suite, includes the 3 hierophant test files (51 tests)
   node --test integrations/hierophant-catalog.test.mjs integrations/hierophant-entities.test.mjs site/hierophant/server.test.mjs
   ```
2. **Boot locally to eyeball it:**
   ```
   PORT=8124 node site/hierophant/server.mjs
   curl -s localhost:8124/health        # {"ok":true,"texts":...,"entities":...}
   ```
3. **Install the systemd unit** (template below) on the app host, fill placeholders, then:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now hierophant.service     # placeholder unit name
   curl -s localhost:8124/health
   ```
4. **Add the Caddy site block** (template below), fill `__DOMAIN__` + the upstream port, reload Caddy.
5. **DNS:** point `hierophant.__BASE_DOMAIN__` at the box (the SoapBox DNS pattern — see `.local/`).
6. **Verify TLS + routes live:**
   ```
   curl -s https://__DOMAIN__/health
   curl -sI https://__DOMAIN__/ | head
   curl -s https://__DOMAIN__/robots.txt
   ```

---

## systemd unit (TEMPLATE — fill `__USER__`, `__REPO_DIR__`, port)

```ini
# /etc/systemd/system/hierophant.service
[Unit]
Description=The Hierophant (hierophant.__BASE_DOMAIN__) — Temple library
After=network.target

[Service]
Type=simple
User=__USER__
WorkingDirectory=__REPO_DIR__
Environment=PORT=8124
Environment=HOST=127.0.0.1
Environment=BASE_URL=https://__DOMAIN__
Environment=WIKI_SITE=https://wiki.__BASE_DOMAIN__
# Optional: an LLM provider key to upgrade /ask — keep it in an EnvironmentFile under .local-style
# perms, never inline here:
# EnvironmentFile=/etc/hierophant/ask.env
ExecStart=/usr/bin/node site/hierophant/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

## Caddy site block (TEMPLATE — fill `__DOMAIN__` + upstream port)

```caddy
__DOMAIN__ {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8124
    header {
        Referrer-Policy strict-origin-when-cross-origin
        X-Content-Type-Options nosniff
    }
}
```

Caddy gets the TLS cert automatically (Let's Encrypt) once DNS resolves to the box. Reload with
`sudo systemctl reload caddy` (or `caddy reload --config /etc/caddy/Caddyfile`).

---

## Notes / discipline

- **We link, we don't host.** The catalog links out to Sacred-Texts / Gutenberg / Archive.org for the
  texts and Theoi for Greek figures. The footer credits all of them on every page. Do not add full
  primary-text bodies to the catalog — that's the opposite of this site's value (the MAP + the AI).
- **Link verification:** gutenberg.org + archive.org links were spot-checked reachable at build time
  (`verified:true`). sacred-texts.com serves 403 to all automated clients, so its links use the
  canonical URL scheme and are surfaced with a "link unverified" hint; they are not machine-checkable.
  Re-verify periodically with a simple `curl -sI` sweep of the gutenberg/archive URLs.
- **`/ask` scope:** answers ONLY from the Temple's own corpus (the `knowledge/` tree via the wiki RAG),
  never from the linked-out primary texts, and says so. It never fabricates.
- **No keys in this repo.** Any LLM key for the richer `/ask` answer lives in a host `EnvironmentFile`,
  read by `llm-router`, never logged.
```

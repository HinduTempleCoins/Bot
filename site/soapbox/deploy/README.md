# SoapBox aggregator — deployment

This directory holds the **public, infra-free** deploy config:

- `Caddyfile` — TLS reverse proxy for `data.soapbox.community` → the Node page factory on
  `127.0.0.1:8088` (auto Let's Encrypt).

The **host-specific go-live runbook** — exact service-update + DNS commands, which name the
production host, its IP, and the secrets vault — is kept private at **`.local/soapbox-deploy/`**
(gitignored), per the repo rule that anything naming infra stays out of the public tree.

## Quick shape
1. Update the code on the host (only the soapbox + condenser paths; other services untouched).
2. Point the `data.soapbox.community` A record at the box.
3. `Caddyfile` → `/etc/caddy/Caddyfile`, reload Caddy → TLS subdomain live.

The runnable steps (host, DNS command, secrets) are in the private runbook.

## Run locally
```bash
PORT=8088 node site/soapbox/server.mjs        # http://localhost:8088
HOST=127.0.0.1 PORT=8088 node site/soapbox/server.mjs   # bind localhost (behind a proxy)
```

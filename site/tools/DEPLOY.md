# SoapBox Tools hub — deploy

The Tools hub unifies the mundane-app suite under one domain, **`tools.soapbox.community`**, using a
**path-routing reverse proxy** in front of many independent app services.

> Architecture is **per-process, not single-process mounting.** Each app is its own `node server.mjs`
> on its own port. Caddy strips the path prefix on the way in (so each app's routes stay on `/`,
> `/health`, `/www/…`); each app prepends its `BASE_PATH` to every self-URL it emits. The hub process
> itself only serves the landing directory + crawler files — it does **not** proxy or import the apps.

## 1. Start each service with its `BASE_PATH`

Every app reads a module-level `BASE_PATH` env at startup and defaults to `''` (standalone, unchanged).
Behind the hub, start each one with `BASE_PATH=/<app>` and a distinct `PORT`:

| Service    | Path prefix    | PORT | Start command |
|------------|----------------|------|---------------|
| tools hub  | `/` (root)     | 8230 | `PORT=8230 BASE_URL=https://tools.soapbox.community node site/tools/server.mjs` |
| flashlight | `/flashlight`  | 8210 | `PORT=8210 BASE_PATH=/flashlight node site/flashlight/server.mjs` |
| calculator | `/calculator`  | 8211 | `PORT=8211 BASE_PATH=/calculator node site/calculator/server.mjs` |
| passgen    | `/passgen`     | 8212 | `PORT=8212 BASE_PATH=/passgen node site/passgen/server.mjs` |
| notes      | `/notes`       | 8213 | `PORT=8213 BASE_PATH=/notes node site/notes/server.mjs` |
| converter  | `/converter`   | 8214 | `PORT=8214 BASE_PATH=/converter node site/converter/server.mjs` |
| weather    | `/weather`     | 8215 | `PORT=8215 BASE_PATH=/weather node site/weather/server.mjs` |
| habits     | `/habits`      | 8216 | `PORT=8216 BASE_PATH=/habits node site/habits/server.mjs` |
| timer      | `/timer`       | 8217 | `PORT=8217 BASE_PATH=/timer node site/timer/server.mjs` |
| outliner   | `/outliner`    | 8218 | `PORT=8218 BASE_PATH=/outliner node site/outliner/server.mjs` |
| qr         | `/qr`          | 8219 | `PORT=8219 BASE_PATH=/qr node site/qr/server.mjs` |
| markdown   | `/markdown`    | 8220 | `PORT=8220 BASE_PATH=/markdown node site/markdown/server.mjs` |
| diagram    | `/diagram`     | 8204 | `PORT=8204 BASE_PATH=/diagram node site/diagram/server.mjs` |
| idlegames  | `/idlegames`   | 8221 | `PORT=8221 BASE_PATH=/idlegames node site/idlegames/server.mjs` |

Notes:
- Each app also honours `TOOLS_HUB_URL` (default `/`) — the hub root the shared "◧ SoapBox Tools" nav
  points at. Leave it at the default when the hub is at the domain root.
- The hub honours optional `MOVE_URL` and `WALLET_URL`. Leave them unset to render those as calm
  "coming soon" front-door tiles; set them to link the Move surface / Wallet-Profile app when they land.
- `BASE_URL` on each service is only used for canonical/sitemap absolutes. Set it to the app's public
  URL, e.g. `BASE_URL=https://tools.soapbox.community/qr`.

## 2. Caddy path-routing map

`tools.soapbox.community` — the proxy matches the prefix, then **strips it** with `handle_path` before
forwarding, so each upstream sees requests on its own `/` root:

```caddy
tools.soapbox.community {
	encode zstd gzip

	# Each app: strip the prefix, forward to its own service. handle_path removes the matched
	# prefix, so /qr/www/qrcode.min.js reaches the qr service as /www/qrcode.min.js.
	handle_path /flashlight/* { reverse_proxy 127.0.0.1:8210 }
	handle_path /calculator/* { reverse_proxy 127.0.0.1:8211 }
	handle_path /passgen/*    { reverse_proxy 127.0.0.1:8212 }
	handle_path /notes/*      { reverse_proxy 127.0.0.1:8213 }
	handle_path /converter/*  { reverse_proxy 127.0.0.1:8214 }
	handle_path /weather/*    { reverse_proxy 127.0.0.1:8215 }
	handle_path /habits/*     { reverse_proxy 127.0.0.1:8216 }
	handle_path /timer/*      { reverse_proxy 127.0.0.1:8217 }
	handle_path /outliner/*   { reverse_proxy 127.0.0.1:8218 }
	handle_path /qr/*         { reverse_proxy 127.0.0.1:8219 }
	handle_path /markdown/*   { reverse_proxy 127.0.0.1:8220 }
	handle_path /diagram/*    { reverse_proxy 127.0.0.1:8204 }
	handle_path /idlegames/*  { reverse_proxy 127.0.0.1:8221 }

	# Everything else → the hub directory (landing, /health, robots, sitemap, llms).
	handle { reverse_proxy 127.0.0.1:8230 }
}
```

Each app is reachable at its prefix *with or without* a trailing slash because `handle_path /qr/*` also
matches `/qr` → the app renders its `/` root; its emitted links already carry the `/qr` prefix.

## 3. How a new app joins the hub

1. Build `site/<app>/server.mjs` in the house style, base-path aware: add
   `const BASE_PATH=(process.env.BASE_PATH||'').replace(/\/$/,'')`, `const bp=(p)=>BASE_PATH+p`, and
   wrap every emitted self-URL (nav/route `href`s, form `action`s, `<script src="/www/…">`, and any
   `fetch('/…')` to the app's own routes) with `bp(...)`. Keep request routing matching `/`, `/health`,
   `/www/…`. Add the shared "◧ SoapBox Tools" nav header. `BASE_PATH` unset must leave the app unchanged.
2. Add one entry to `UTILITIES` (or `GAMES`) in `site/tools/server.mjs` — `{ slug, emoji, name,
   tagline, blurb }`. That auto-adds the card, the sitemap path and the llms.txt link.
3. Pick a free PORT, add a row to the table above and one `handle_path /<app>/* { reverse_proxy … }`
   line to the Caddyfile, then reload Caddy.

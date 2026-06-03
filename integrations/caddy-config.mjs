// caddy-config.mjs — Caddy rate-limiting + L7 CrowdSec bouncer config GENERATOR (task #30).
//
// This is a DETERMINISTIC CONFIG / RUNBOOK GENERATOR, not a deployer. The SoapBox sites already run
// behind Caddy with automatic TLS; this module emits the Caddyfile snippets that add two protections
// in front of them — per-client RATE LIMITING (the caddy-ratelimit plugin) and an L7 CROWDSEC bouncer
// (the http.handlers.crowdsec + appsec directives). Both plugins are NOT in stock Caddy, so the module
// also emits the `xcaddy build` line that rebuilds the binary with them, plus a step-by-step runbook.
//
// CONVENTIONS (mirrors forum-setup.mjs / macro.mjs):
//   - ESM .mjs, pure + deterministic. No network. No clock dependence.
//   - Soft-fail: never throws on bad input; returns a result/string or a safe default.
//   - NO SECRETS: the CrowdSec bouncer API key and API URL are referenced as env var NAMES only.
//     Their VALUES are read by the deploy step (from the vault / environment), never here, never committed.
//   - No host-specific IPs or server names — domains are passed in by the caller; everything else generic.

// ---------------------------------------------------------------------------
// Defaults. Generic — no real host details. The caller supplies the actual domains.
// ---------------------------------------------------------------------------
const DEFAULT_RATE_LIMIT = {
  zone: 'static',
  events: 100, // events ...
  window: '1m', // ... per this window ...
  key: '{remote_host}', // ... per this client key (Caddy placeholder; client IP).
};

const DEFAULT_CROWDSEC = {
  // env var NAMES only — never the literal URL or key.
  apiUrlEnv: 'CROWDSEC_API_URL',
  apiKeyEnv: 'CROWDSEC_BOUNCER_API_KEY',
  appsec: true, // also wire the CrowdSec AppSec (WAF) component if available.
};

// Plugin module paths used by the xcaddy rebuild.
const PLUGIN_RATELIMIT = 'github.com/mholt/caddy-ratelimit';
const PLUGIN_CROWDSEC = 'github.com/hslatman/caddy-crowdsec-bouncer';

// ---------------------------------------------------------------------------
// rate_limit snippet (caddy-ratelimit plugin).
//
// Emits a `rate_limit` block defining ONE named zone: N events per window, keyed per client. The
// caddy-ratelimit syntax is:
//   rate_limit {
//       zone <name> {
//           key    <key>
//           events <N>
//           window <duration>
//       }
//   }
// ---------------------------------------------------------------------------
/**
 * Build a Caddyfile `rate_limit` block for one zone. Soft-fails to sensible defaults on bad input.
 * @param {{zone?:string, events?:number, window?:string, key?:string}} [opts]
 * @returns {string} the rate_limit { zone ... } block
 */
export function rateLimitSnippet(opts = {}) {
  const o = { ...DEFAULT_RATE_LIMIT, ...(opts && typeof opts === 'object' ? opts : {}) };
  const zone = String(o.zone || DEFAULT_RATE_LIMIT.zone).trim() || DEFAULT_RATE_LIMIT.zone;
  let events = Number(o.events);
  if (!Number.isFinite(events) || events <= 0) events = DEFAULT_RATE_LIMIT.events;
  events = Math.floor(events);
  const window = String(o.window || DEFAULT_RATE_LIMIT.window).trim() || DEFAULT_RATE_LIMIT.window;
  const key = String(o.key || DEFAULT_RATE_LIMIT.key).trim() || DEFAULT_RATE_LIMIT.key;

  return `rate_limit {
\t\tzone ${zone} {
\t\t\tkey    ${key}
\t\t\tevents ${events}
\t\t\twindow ${window}
\t\t}
\t}`;
}

// ---------------------------------------------------------------------------
// crowdsec snippet (caddy-crowdsec-bouncer plugin).
//
// The plugin needs a GLOBAL `crowdsec` block (api_url + api_key) and a per-site handler. We reference
// the api_url and api_key by env var NAME using Caddy's {env.NAME} placeholder, which Caddy resolves at
// load time from the process environment — so no secret value is ever written here or committed.
// ---------------------------------------------------------------------------
/**
 * Build the GLOBAL crowdsec config block (goes inside the Caddyfile global options `{ ... }`).
 * References env var NAMES via Caddy {env.NAME} placeholders — never literal URL/key values.
 * @param {{apiUrlEnv?:string, apiKeyEnv?:string, appsec?:boolean}} [opts]
 * @returns {string} the global `crowdsec { ... }` block
 */
export function crowdsecSnippet(opts = {}) {
  const o = { ...DEFAULT_CROWDSEC, ...(opts && typeof opts === 'object' ? opts : {}) };
  const apiUrlEnv = String(o.apiUrlEnv || DEFAULT_CROWDSEC.apiUrlEnv).trim() || DEFAULT_CROWDSEC.apiUrlEnv;
  const apiKeyEnv = String(o.apiKeyEnv || DEFAULT_CROWDSEC.apiKeyEnv).trim() || DEFAULT_CROWDSEC.apiKeyEnv;
  const appsec = o.appsec !== false;

  // {env.NAME} is resolved by Caddy at load time from the environment — the literal here is the NAME.
  const appsecLine = appsec
    ? '\n\t\tappsec_url {env.CROWDSEC_APPSEC_URL}' // optional AppSec/WAF endpoint, also env-name only
    : '';

  return `crowdsec {
\t\tapi_url {env.${apiUrlEnv}}
\t\tapi_key {env.${apiKeyEnv}}
\t\tticker_interval 15s${appsecLine}
\t}`;
}

/**
 * The per-site directives that actually invoke the bouncer on incoming requests. `crowdsec` runs the
 * IP-decision check; `appsec` (if enabled) runs the request through the WAF. Indented for a site block.
 * @param {{appsec?:boolean}} [opts]
 * @returns {string}
 */
function crowdsecSiteDirectives(opts = {}) {
  const appsec = !opts || opts.appsec !== false;
  return appsec ? 'crowdsec\n\tappsec' : 'crowdsec';
}

// ---------------------------------------------------------------------------
// Full Caddyfile assembler.
//
// Produces an annotated, deterministic Caddyfile: a global options block (CrowdSec global config), then
// one site block per domain with automatic TLS, the rate-limit zones, and the CrowdSec bouncer wired in.
// ---------------------------------------------------------------------------
/**
 * Assemble a complete Caddyfile for the given domains with rate limiting + the CrowdSec L7 bouncer.
 * Deterministic; soft-fails to a safe (commented) Caddyfile on bad input.
 * @param {{domains?:string[], rateLimits?:Array<object>, crowdsec?:object|false, reverseProxyTo?:string}} [cfg]
 * @returns {string} the rendered Caddyfile
 */
export function caddyfileFor(cfg = {}) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const domains = Array.isArray(c.domains)
    ? c.domains.map((d) => String(d || '').trim()).filter(Boolean)
    : [];
  const rateLimits = Array.isArray(c.rateLimits) && c.rateLimits.length
    ? c.rateLimits
    : [{ ...DEFAULT_RATE_LIMIT }];
  const crowdsec = c.crowdsec === false ? false : (c.crowdsec || { ...DEFAULT_CROWDSEC });
  const upstream = String(c.reverseProxyTo || '').trim(); // optional; generic placeholder if absent.

  const header = [
    '# Caddyfile — GENERATED by integrations/caddy-config.mjs (task #30). Review before use.',
    '# Adds per-client RATE LIMITING (caddy-ratelimit) + an L7 CROWDSEC bouncer in front of the',
    '# existing automatic-TLS sites. Requires a Caddy binary rebuilt with both plugins — see',
    '# xcaddyBuildCommand() / setupRunbook(). Secrets (CrowdSec API URL + key) are read from the',
    '# environment via {env.NAME}; no secret values appear in this file.',
  ];

  // Global options block: TLS is automatic in Caddy; here we register the CrowdSec global config.
  const globalLines = ['{'];
  globalLines.push('\t# Automatic HTTPS (Let\'s Encrypt) is on by default for public domains.');
  if (crowdsec) {
    globalLines.push('\t# --- CrowdSec global config (api_url/api_key via env var NAMES only) ---');
    globalLines.push('\t' + crowdsecSnippet(crowdsec).split('\n').join('\n\t').replace(/\n\t$/, ''));
  }
  globalLines.push('}');

  // Build the shared body (rate limits + crowdsec + proxy) once; each site reuses it.
  const bodyLines = [];
  bodyLines.push('\tencode zstd gzip');
  bodyLines.push('');
  bodyLines.push('\t# --- Rate limiting (caddy-ratelimit plugin) ---');
  for (const rl of rateLimits) {
    bodyLines.push('\t' + rateLimitSnippet(rl));
  }
  if (crowdsec) {
    bodyLines.push('');
    bodyLines.push('\t# --- CrowdSec L7 bouncer (per-request decision + AppSec/WAF) ---');
    bodyLines.push('\t' + crowdsecSiteDirectives(crowdsec).split('\n').join('\n\t'));
  }
  bodyLines.push('');
  bodyLines.push('\t# --- Upstream (existing site) ---');
  if (upstream) {
    bodyLines.push(`\treverse_proxy ${upstream}`);
  } else {
    bodyLines.push('\t# reverse_proxy 127.0.0.1:<PORT>   # point at the existing app/PHP-FPM/static root');
  }
  bodyLines.push('');
  bodyLines.push('\theader {');
  bodyLines.push('\t\tX-Frame-Options "SAMEORIGIN"');
  bodyLines.push('\t\tX-Content-Type-Options "nosniff"');
  bodyLines.push('\t\tReferrer-Policy "strict-origin-when-cross-origin"');
  bodyLines.push('\t}');

  const body = bodyLines.join('\n');

  const siteBlocks = domains.length
    ? domains.map((d) => `${d} {\n${body}\n}`)
    : ['# NOTE: no domains supplied — add at least one, e.g. example.com { ... }\nexample.com {\n' + body + '\n}'];

  return [header.join('\n'), '', globalLines.join('\n'), '', siteBlocks.join('\n\n'), ''].join('\n');
}

// ---------------------------------------------------------------------------
// xcaddy build command — rebuild Caddy with the two plugins.
// ---------------------------------------------------------------------------
/**
 * The `xcaddy build` command line that produces a Caddy binary with the caddy-ratelimit and
 * crowdsec-bouncer plugins compiled in.
 * @param {{caddyVersion?:string}} [opts]
 * @returns {string}
 */
export function xcaddyBuildCommand(opts = {}) {
  const ver = String((opts && opts.caddyVersion) || '').trim();
  const verArg = ver ? ` ${ver}` : ''; // pin a Caddy version if given, else build latest
  return [
    'xcaddy build' + verArg,
    `--with ${PLUGIN_RATELIMIT}`,
    `--with ${PLUGIN_CROWDSEC}`,
  ].join(' \\\n  ');
}

// ---------------------------------------------------------------------------
// Setup runbook (markdown). Static, deterministic text.
// ---------------------------------------------------------------------------
/** Markdown runbook: rebuild Caddy with xcaddy, install CrowdSec, register the bouncer, reload, verify. */
export function setupRunbook() {
  return `# Caddy rate-limiting + CrowdSec L7 bouncer — setup runbook

> GENERATED by integrations/caddy-config.mjs (task #30). This is a runbook, not an automated deployer.
> The SoapBox sites already run behind Caddy with automatic TLS; this adds rate limiting and an L7
> CrowdSec bouncer in front of them. No secrets live in this repo — the CrowdSec API URL and bouncer
> API key come from the vault / environment at deploy time, referenced by env var NAME only.

## 1. Rebuild Caddy with the plugins (xcaddy)
Stock Caddy does not include the caddy-ratelimit or crowdsec-bouncer plugins, so build a custom binary.

\`\`\`sh
# Install Go + xcaddy first if needed:
#   go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
${xcaddyBuildCommand()}
\`\`\`

This emits a \`./caddy\` binary. Verify the modules are present:

\`\`\`sh
./caddy list-modules | grep -E 'rate_limit|crowdsec'
\`\`\`

Install the new binary over the old one (back up the current one first), e.g. \`sudo install -m 0755 ./caddy /usr/bin/caddy\`.

## 2. Install CrowdSec (the engine that makes decisions)
\`\`\`sh
# Debian/Ubuntu (CrowdSec's own repo); follow https://docs.crowdsec.net/ for your distro:
curl -s https://install.crowdsec.net | sudo sh
sudo apt-get install -y crowdsec
\`\`\`
The CrowdSec agent reads logs, detects attacks, and exposes a Local API (LAPI) that the bouncer queries.

## 3. Register the Caddy bouncer with CrowdSec
\`\`\`sh
sudo cscli bouncers add caddy-bouncer
\`\`\`
This prints an API key ONCE. Do **not** paste it into any file in this repo. Store it in the vault
(Vaultwarden) and export it on the Caddy host as the env var the Caddyfile references:

| Env var NAME | Holds |
|---|---|
| \`CROWDSEC_API_URL\` | CrowdSec LAPI URL (typically the local LAPI endpoint on this host) |
| \`CROWDSEC_BOUNCER_API_KEY\` | the bouncer API key printed by \`cscli bouncers add\` (from the vault) |
| \`CROWDSEC_APPSEC_URL\` | (optional) the CrowdSec AppSec/WAF endpoint, if the AppSec component is enabled |

Caddy resolves these at load time via \`{env.NAME}\`; only the NAMES ever appear in the Caddyfile.
For a systemd-managed Caddy, put them in an \`EnvironmentFile=\` (root-owned, \`chmod 600\`), NOT in the unit.

## 4. Install the generated Caddyfile + reload
Generate the Caddyfile with \`caddyfileFor({ domains: [...] })\`, review it, and place it where Caddy
reads it (e.g. \`/etc/caddy/Caddyfile\`). Validate, then reload with zero downtime:

\`\`\`sh
caddy validate --config /etc/caddy/Caddyfile
caddy reload  --config /etc/caddy/Caddyfile
# (or: sudo systemctl reload caddy)
\`\`\`

## 5. Verify
- \`./caddy list-modules | grep -E 'rate_limit|crowdsec'\` — both plugins compiled in.
- \`sudo cscli bouncers list\` — the Caddy bouncer shows as registered and recently seen.
- Hammer an endpoint past the configured \`events\`/\`window\` and confirm HTTP 429 (rate limited).
- \`sudo cscli decisions add --ip <a-test-ip>\`, request from that IP, confirm it is blocked (403),
  then \`sudo cscli decisions delete --ip <a-test-ip>\`.
- \`journalctl -u caddy\` — no plugin/load errors after reload.

## 6. Hardening notes
- Keep the bouncer API key only in the vault + the host EnvironmentFile (\`chmod 600\`, root-owned).
  Rotate it with \`cscli bouncers delete\` + re-add if it is ever exposed.
- Restrict the CrowdSec LAPI to localhost (or a private interface); do not expose it publicly.
- Tune \`events\`/\`window\` per zone — too strict harms real users behind NAT/CGNAT (many share one IP).
- Subscribe the CrowdSec agent to community blocklists, but review before enforcing in production.
- Keep UFW to 80/443 (and SSH from known IPs); this is the same firewall posture as the SoapBox host.
- Rebuild + re-test the custom Caddy binary whenever you upgrade Caddy or the plugins (CVE patches).
`;
}

// ---------------------------------------------------------------------------
// Validation — structural + a no-secret-literal guard.
// ---------------------------------------------------------------------------
// Heuristics for catching an accidentally hard-coded secret in a config object. We look for fields
// that hold a literal value where only an env var NAME / placeholder belongs.
const SECRET_FIELD_RE = /(api[_-]?key|apikey|secret|password|passwd|pwd|token|bouncer[_-]?key)/i;
const ENV_PLACEHOLDER_RE = /^\{env\.[A-Z0-9_]+\}$/; // Caddy {env.NAME}
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/; // a bare env var NAME (what *Env fields should hold)

function looksLikeLiteralSecret(key, value) {
  if (typeof value !== 'string' || !value) return false;
  if (!SECRET_FIELD_RE.test(String(key))) return false;
  // Allowed forms: a Caddy {env.NAME} placeholder, or a bare ENV_NAME for *Env-style fields.
  if (ENV_PLACEHOLDER_RE.test(value)) return false;
  if (ENV_NAME_RE.test(value)) return false;
  return true; // anything else in a secret-ish field is a literal secret — flag it.
}

/**
 * Validate a generator config. Returns { ok, errors[] }. Never throws. Includes a no-secret-literal
 * check: any secret-ish field (apiKey/password/token/...) that holds a literal value (not an env var
 * NAME or {env.NAME} placeholder) is flagged.
 * @param {object} cfg  e.g. { domains, rateLimits, crowdsec }
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') {
    return { ok: false, errors: ['config must be an object'] };
  }

  // domains
  if (cfg.domains != null) {
    if (!Array.isArray(cfg.domains)) {
      errors.push('domains must be an array of strings');
    } else if (cfg.domains.length === 0) {
      errors.push('domains is empty — supply at least one domain');
    } else {
      cfg.domains.forEach((d, i) => {
        if (typeof d !== 'string' || !d.trim()) errors.push(`domains[${i}] is not a non-empty string`);
      });
    }
  }

  // rateLimits
  if (cfg.rateLimits != null) {
    if (!Array.isArray(cfg.rateLimits)) {
      errors.push('rateLimits must be an array');
    } else {
      const seen = new Set();
      cfg.rateLimits.forEach((rl, i) => {
        const where = `rateLimits[${i}]`;
        if (!rl || typeof rl !== 'object') {
          errors.push(`${where} is not an object`);
          return;
        }
        if (rl.zone != null) {
          if (typeof rl.zone !== 'string' || !rl.zone.trim()) errors.push(`${where} zone must be a non-empty string`);
          else if (seen.has(rl.zone)) errors.push(`${where} duplicate zone "${rl.zone}"`);
          else seen.add(rl.zone);
        }
        if (rl.events != null && (!Number.isFinite(Number(rl.events)) || Number(rl.events) <= 0)) {
          errors.push(`${where} events must be a positive number`);
        }
        if (rl.window != null && (typeof rl.window !== 'string' || !rl.window.trim())) {
          errors.push(`${where} window must be a duration string (e.g. "1m")`);
        }
      });
    }
  }

  // crowdsec — secret-literal guard runs over its fields.
  const cs = cfg.crowdsec;
  if (cs && typeof cs === 'object') {
    for (const [k, v] of Object.entries(cs)) {
      if (looksLikeLiteralSecret(k, v)) {
        errors.push(`crowdsec.${k} appears to be a hardcoded secret — use an env var NAME (e.g. ${k.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}_ENV) instead`);
      }
    }
    // *Env fields, when present, should hold a bare env var NAME.
    for (const f of ['apiUrlEnv', 'apiKeyEnv']) {
      if (cs[f] != null && (typeof cs[f] !== 'string' || !ENV_NAME_RE.test(cs[f]))) {
        errors.push(`crowdsec.${f} must be a bare env var NAME (UPPER_SNAKE_CASE), not a value`);
      }
    }
  }

  // Sweep the whole config object (shallow + one level) for any other secret-ish literal.
  const sweep = (obj, prefix) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (looksLikeLiteralSecret(k, v)) {
        errors.push(`${prefix}${k} appears to be a hardcoded secret — reference an env var NAME instead`);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        sweep(v, `${prefix}${k}.`);
      }
    }
  };
  // Avoid double-flagging crowdsec (already swept above); sweep the rest.
  const { crowdsec: _omit, ...rest } = cfg;
  sweep(rest, '');

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// CLI — print an example Caddyfile + the runbook. Guarded so importing has no side effects.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('caddy-config.mjs')) {
  const example = {
    domains: ['example.com'],
    rateLimits: [
      { zone: 'static', events: 100, window: '1m', key: '{remote_host}' },
      { zone: 'api', events: 30, window: '10s', key: '{remote_host}' },
    ],
    crowdsec: { apiUrlEnv: 'CROWDSEC_API_URL', apiKeyEnv: 'CROWDSEC_BOUNCER_API_KEY', appsec: true },
  };
  const v = validateConfig(example);
  if (!v.ok) {
    console.error('example config validation failed:', v.errors);
  } else {
    console.log('# ---- xcaddy build ----');
    console.log(xcaddyBuildCommand());
    console.log('\n# ---- Caddyfile ----');
    console.log(caddyfileFor(example));
    console.log('\n# ---- runbook ----');
    console.log(setupRunbook());
  }
}

// n8n-config.mjs — n8n self-host CONFIG GENERATOR (task #109). The self-hosted IFTTT alternative.
//
// integrations/ifttt-connect.mjs is the OAuth account-connection HUB — the one place the operator
// connects external accounts and holds each token as a capability grant. n8n is the AUTOMATION
// ENGINE that sits behind it: once an account is connected, n8n is what actually runs the
// "when X happens → do Y" workflows. This module emits everything needed to STAND UP a self-hosted
// n8n — it is NOT a deployer. Like forum-setup.mjs it produces config + a runbook the operator
// reviews and runs by hand:
//   - dockerCompose(...)   : a docker-compose for n8n (+ postgres if dbType==='postgres'), env NAMES only
//   - envTemplate()        : the .env-shape listing the required env var NAMES (no values)
//   - starterWorkflows()   : example n8n workflow JSON templates relevant to MELEK
//   - setupRunbook()       : markdown — compose up, encryption key + basic auth via vault, Caddy/TLS, import, harden, verify
//   - validateConfig(...)  : { ok, errors[] } structural + no-secret-literal check
//
// CONVENTIONS (match the rest of integrations/): ESM .mjs, pure + deterministic, no network, soft-fail
// (never throws on bad input — returns a result object or safe default), CLI guarded. NO SECRETS: the
// n8n encryption key, the basic-auth password, and the DB password are referenced by env var NAME only.
// Their VALUES come from the vault (Vaultwarden) and are exported into the container's environment at
// deploy time — they never appear here, in the generated compose, or anywhere in this repo. No
// host-specific IPs or server names: hostnames are generic (your-n8n-host / n8n.example.com placeholders).

// ---------------------------------------------------------------------------
// Defaults. Every credential field is an env var NAME, never a value.
// ---------------------------------------------------------------------------
const DEFAULT_OPTS = {
  port: 5678, // n8n's default HTTP port (kept on localhost; Caddy fronts it for TLS)
  dbType: 'sqlite', // 'sqlite' (single-file, simplest) or 'postgres' (recommended for production)
  encKeyEnv: 'N8N_ENCRYPTION_KEY', // the at-rest key n8n uses to encrypt stored credentials
  basicAuthUserEnv: 'N8N_BASIC_AUTH_USER',
  basicAuthPassEnv: 'N8N_BASIC_AUTH_PASSWORD',
  // postgres-only env NAMES (referenced only when dbType==='postgres')
  dbHostEnv: 'N8N_DB_POSTGRESDB_HOST',
  dbNameEnv: 'N8N_DB_POSTGRESDB_DATABASE',
  dbUserEnv: 'N8N_DB_POSTGRESDB_USER',
  dbPassEnv: 'N8N_DB_POSTGRESDB_PASSWORD',
  // the public https URL n8n advertises for webhooks (TLS terminated by Caddy in front)
  webhookUrlEnv: 'N8N_WEBHOOK_URL',
  hostEnv: 'N8N_HOST', // the public hostname n8n believes it is served at
  n8nImage: 'docker.n8n.io/n8nio/n8n:latest',
  postgresImage: 'postgres:16-alpine',
};

// Looks like an env var NAME (UPPER_SNAKE), not a value.
function isEnvName(s) {
  return typeof s === 'string' && /^[A-Z][A-Z0-9_]*$/.test(s);
}

// A coarse "this looks like a baked-in secret" heuristic, used by validateConfig() and by the
// no-secret-literal guard. We never want a literal key/password to leak into generated config.
// Real secrets are long, high-entropy strings; env NAMES are UPPER_SNAKE and pass isEnvName().
function looksLikeSecretLiteral(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  if (!v) return false;
  if (isEnvName(v)) return false; // an env NAME is exactly what we DO want
  // long opaque token: many non-space chars, mixed case/digits — treat as a literal secret
  if (v.length >= 16 && /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !/\s/.test(v)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// docker-compose generator.
//
// Renders a compose file for n8n. The n8n service references its encryption key, basic-auth
// credentials, webhook URL, host, and (for postgres) the DB password via `${ENV_NAME}` ONLY — the
// values are interpolated by docker compose from the host environment / an .env file the operator
// populates from the vault. No secret value is ever embedded. n8n is bound to 127.0.0.1 so the raw
// port is not public; Caddy (see setupRunbook) is the TLS front door.
// ---------------------------------------------------------------------------
/**
 * @returns {{ object: object, yaml: string, envVarsRequired: string[] }}
 */
export function dockerCompose(opts = {}) {
  const o = { ...DEFAULT_OPTS, ...(opts && typeof opts === 'object' ? opts : {}) };
  const port = Number.isFinite(Number(o.port)) ? Number(o.port) : DEFAULT_OPTS.port;
  const usePg = String(o.dbType).toLowerCase() === 'postgres';

  // ${NAME} interpolation — docker compose substitutes from the environment / .env at `up` time.
  const ref = (name) => `\${${String(name)}}`;

  const envVarsRequired = [
    o.encKeyEnv,
    o.basicAuthUserEnv,
    o.basicAuthPassEnv,
    o.webhookUrlEnv,
    o.hostEnv,
  ];

  // n8n service environment — env NAMES referenced via ${...}; literals are only non-secret config.
  const n8nEnvLines = [
    `      # --- at-rest credential encryption (value from the vault, never committed) ---`,
    `      - N8N_ENCRYPTION_KEY=${ref(o.encKeyEnv)}`,
    `      # --- basic auth: gate the editor UI (value from the vault) ---`,
    `      - N8N_BASIC_AUTH_ACTIVE=true`,
    `      - N8N_BASIC_AUTH_USER=${ref(o.basicAuthUserEnv)}`,
    `      - N8N_BASIC_AUTH_PASSWORD=${ref(o.basicAuthPassEnv)}`,
    `      # --- public addressing (Caddy terminates TLS in front; n8n stays on localhost) ---`,
    `      - N8N_HOST=${ref(o.hostEnv)}`,
    `      - N8N_PORT=${port}`,
    `      - N8N_PROTOCOL=https`,
    `      - WEBHOOK_URL=${ref(o.webhookUrlEnv)}`,
    `      - N8N_PROXY_HOPS=1`,
    `      # --- security posture: do not phone-home telemetry, secure cookie on ---`,
    `      - N8N_DIAGNOSTICS_ENABLED=false`,
    `      - N8N_SECURE_COOKIE=true`,
    `      - GENERIC_TIMEZONE=UTC`,
  ];

  if (usePg) {
    n8nEnvLines.push(
      `      # --- postgres backend (DB password value from the vault) ---`,
      `      - DB_TYPE=postgresdb`,
      `      - DB_POSTGRESDB_HOST=${ref(o.dbHostEnv)}`,
      `      - DB_POSTGRESDB_DATABASE=${ref(o.dbNameEnv)}`,
      `      - DB_POSTGRESDB_USER=${ref(o.dbUserEnv)}`,
      `      - DB_POSTGRESDB_PASSWORD=${ref(o.dbPassEnv)}`
    );
    envVarsRequired.push(o.dbHostEnv, o.dbNameEnv, o.dbUserEnv, o.dbPassEnv);
  } else {
    n8nEnvLines.push(
      `      # --- sqlite backend (single-file db on the persistent volume) ---`,
      `      - DB_TYPE=sqlite`
    );
  }

  const dependsOn = usePg ? `    depends_on:\n      - postgres\n` : '';

  const postgresService = usePg
    ? `
  postgres:
    image: ${o.postgresImage}
    restart: unless-stopped
    environment:
      # postgres reads the SAME env NAMES; values come from the vault at deploy time.
      - POSTGRES_DB=${ref(o.dbNameEnv)}
      - POSTGRES_USER=${ref(o.dbUserEnv)}
      - POSTGRES_PASSWORD=${ref(o.dbPassEnv)}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    # not published to the host — only reachable on the internal compose network.
`
    : '';

  const volumes = usePg
    ? `volumes:\n  n8n_data:\n  postgres_data:\n`
    : `volumes:\n  n8n_data:\n`;

  const yaml = `# docker-compose.yml for self-hosted n8n — GENERATED by integrations/n8n-config.mjs.
# Review before use. NO secret values appear here: every credential is referenced as \${ENV_NAME}
# and substituted from the environment / .env at \`docker compose up\` time. Populate those env vars
# from the vault (see the runbook). n8n binds to 127.0.0.1 — put Caddy in front for public TLS.
services:
  n8n:
    image: ${o.n8nImage}
    restart: unless-stopped
    # bind to localhost only; Caddy reverse-proxies and terminates TLS (raw port stays private).
    ports:
      - "127.0.0.1:${port}:${port}"
    environment:
${n8nEnvLines.join('\n')}
    volumes:
      - n8n_data:/home/node/.n8n
${dependsOn}${postgresService}
${volumes}`;

  const object = {
    port,
    dbType: usePg ? 'postgres' : 'sqlite',
    n8nImage: String(o.n8nImage),
    postgresImage: usePg ? String(o.postgresImage) : null,
    encKeyEnv: String(o.encKeyEnv),
    basicAuthUserEnv: String(o.basicAuthUserEnv),
    basicAuthPassEnv: String(o.basicAuthPassEnv),
    webhookUrlEnv: String(o.webhookUrlEnv),
    hostEnv: String(o.hostEnv),
    envVarsRequired,
  };

  return { object, yaml, envVarsRequired };
}

// ---------------------------------------------------------------------------
// .env template — NAMES only, no values. The deploy step fills these from the vault.
// ---------------------------------------------------------------------------
/**
 * @returns {{ text: string, envVarsRequired: string[] }}
 */
export function envTemplate(opts = {}) {
  const o = { ...DEFAULT_OPTS, ...(opts && typeof opts === 'object' ? opts : {}) };
  const usePg = String(o.dbType).toLowerCase() === 'postgres';

  const required = [
    [o.encKeyEnv, 'n8n at-rest credential encryption key (long random string — generate once, NEVER rotate casually or stored creds become unreadable)'],
    [o.basicAuthUserEnv, 'username gating the n8n editor UI'],
    [o.basicAuthPassEnv, 'password gating the n8n editor UI'],
    [o.hostEnv, 'public hostname n8n is served at (e.g. n8n.example.com)'],
    [o.webhookUrlEnv, 'public https base URL for webhooks (e.g. https://n8n.example.com/)'],
  ];
  if (usePg) {
    required.push(
      [o.dbHostEnv, 'postgres host'],
      [o.dbNameEnv, 'postgres database name'],
      [o.dbUserEnv, 'postgres user'],
      [o.dbPassEnv, 'postgres password']
    );
  }

  const lines = [
    '# .env for self-hosted n8n — GENERATED by integrations/n8n-config.mjs.',
    '# These are env var NAMES ONLY. Do NOT commit real values to this repo.',
    '# Each VALUE is read from the operator vault (Vaultwarden) and written here (or exported into',
    '# the container environment) on the deploy host at deploy time. This template ships empty.',
    '#',
    '# Generate the encryption key once with:  openssl rand -hex 32',
    '# Keep it in the vault; if it changes, every credential already stored in n8n is lost.',
    '',
  ];
  for (const [name, desc] of required) {
    lines.push(`# ${desc}`);
    lines.push(`${name}=`); // NAME= with NO value, by design
    lines.push('');
  }

  return { text: lines.join('\n'), envVarsRequired: required.map(([n]) => n) };
}

// ---------------------------------------------------------------------------
// Starter workflow templates (valid n8n workflow JSON: nodes + connections).
//
// Two MELEK-relevant examples. Any credential a node would use is referenced by NAME via the n8n
// credentials reference shape ({ id, name }) — never an inline token/value. These are templates the
// operator imports into n8n (Import from File), then binds to real credentials inside the UI.
// ---------------------------------------------------------------------------
/**
 * @returns {Array<object>} array of n8n workflow objects (each JSON-serializable)
 */
export function starterWorkflows() {
  // Workflow 1: poll the MELEK chain for new posts by the Hathor witness and notify a channel.
  const newPostNotify = {
    name: 'MELEK — new post → notify',
    active: false,
    nodes: [
      {
        parameters: {
          rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] },
        },
        id: 'trigger-cron',
        name: 'Every 5 minutes',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.1,
        position: [240, 300],
      },
      {
        parameters: {
          // Reads the public MELEK condenser API — generic placeholder URL, no secrets.
          url: 'https://your-melek-rpc-host/api/get_discussions',
          options: {},
        },
        id: 'http-get-posts',
        name: 'Fetch MELEK posts',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [480, 300],
      },
      {
        parameters: {
          // credentials referenced BY NAME only (bound inside the n8n UI), never an inline token.
          channelId: '={{ $json.channelId }}',
          text: '=New MELEK post: {{ $json.title }}',
        },
        id: 'notify-out',
        name: 'Notify channel',
        type: 'n8n-nodes-base.discord',
        typeVersion: 2,
        position: [720, 300],
        credentials: {
          discordApi: { id: '', name: 'MELEK Discord (set in n8n UI)' },
        },
      },
    ],
    connections: {
      'Every 5 minutes': { main: [[{ node: 'Fetch MELEK posts', type: 'main', index: 0 }]] },
      'Fetch MELEK posts': { main: [[{ node: 'Notify channel', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
    pinData: {},
  };

  // Workflow 2: scheduled health ping of the Hathor price-feed / witness endpoint, alert on failure.
  const priceFeedHealthPing = {
    name: 'Hathor — price-feed health ping',
    active: false,
    nodes: [
      {
        parameters: {
          rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] },
        },
        id: 'trigger-cron-2',
        name: 'Every 15 minutes',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.1,
        position: [240, 300],
      },
      {
        parameters: {
          url: 'https://your-melek-rpc-host/health',
          options: { response: { response: { fullResponse: true } } },
        },
        id: 'http-health',
        name: 'Check feed health',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [480, 300],
      },
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, version: 2 },
            combinator: 'and',
            conditions: [
              {
                leftValue: '={{ $json.statusCode }}',
                rightValue: 200,
                operator: { type: 'number', operation: 'notEquals' },
              },
            ],
          },
        },
        id: 'if-unhealthy',
        name: 'If unhealthy',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [720, 300],
      },
      {
        parameters: {
          channelId: '={{ $json.alertChannelId }}',
          text: '=ALERT: MELEK price-feed health check failed (status {{ $json.statusCode }})',
        },
        id: 'alert-out',
        name: 'Send alert',
        type: 'n8n-nodes-base.discord',
        typeVersion: 2,
        position: [960, 240],
        credentials: {
          discordApi: { id: '', name: 'MELEK Discord (set in n8n UI)' },
        },
      },
    ],
    connections: {
      'Every 15 minutes': { main: [[{ node: 'Check feed health', type: 'main', index: 0 }]] },
      'Check feed health': { main: [[{ node: 'If unhealthy', type: 'main', index: 0 }]] },
      'If unhealthy': {
        main: [[{ node: 'Send alert', type: 'main', index: 0 }], []],
      },
    },
    settings: { executionOrder: 'v1' },
    pinData: {},
  };

  return [newPostNotify, priceFeedHealthPing];
}

// ---------------------------------------------------------------------------
// Setup runbook (markdown). Static, deterministic.
// ---------------------------------------------------------------------------
/** Markdown runbook for standing up + securing self-hosted n8n. */
export function setupRunbook() {
  return `# Self-hosted n8n — setup runbook

> GENERATED by integrations/n8n-config.mjs. This is a runbook, not an automated deployer.
> n8n is the automation engine behind the IFTTT-connect OAuth hub (integrations/ifttt-connect.mjs):
> connect accounts there, run the "when X → do Y" workflows here.
> NO secrets live in this repo. The encryption key, basic-auth password, and any DB password come
> from the operator vault (Vaultwarden) and are injected into the container environment at deploy time.

## 1. Bring up the stack with docker-compose
1. Generate \`docker-compose.yml\` with \`dockerCompose({...})\` from this module, and \`.env\` with
   \`envTemplate({...})\`. Both reference env var NAMES only — no values are written.
2. On the deploy host, copy the values from the vault into \`.env\` (or export them into the shell):
   the encryption key, the basic-auth user/password, the host + webhook URL, and (if postgres) the
   DB credentials. \`.env\` must be \`chmod 600\` and is NEVER committed.
3. Start it:
   \`\`\`bash
   docker compose up -d
   docker compose logs -f n8n   # watch it come up
   \`\`\`
   n8n binds to \`127.0.0.1:5678\` only — the raw port is not exposed publicly.

## 2. Set the encryption key + basic auth (from the vault)
- \`N8N_ENCRYPTION_KEY\` encrypts every credential n8n stores at rest. Generate it ONCE
  (\`openssl rand -hex 32\`), keep it in the vault, and never lose/rotate it casually — if it
  changes, all stored credentials become unreadable.
- Basic auth (\`N8N_BASIC_AUTH_ACTIVE=true\` + \`N8N_BASIC_AUTH_USER\` / \`N8N_BASIC_AUTH_PASSWORD\`)
  gates the editor UI. Both values come from the vault. n8n will not start the UI unprotected.

## 3. Put it behind Caddy (TLS + rate-limit / CrowdSec)
Caddy is the public TLS front door (automatic Let's Encrypt) and reverse-proxies to n8n on
localhost — the same Caddy-TLS pattern used for the SoapBox aggregator. Use a generic hostname;
the host-specific values live in the vault / private deploy notes, never here.

\`\`\`caddy
n8n.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5678

    # rate-limit + CrowdSec at the edge (same hardening posture as the other public services):
    # install the caddy-ratelimit + caddy-crowdsec bouncer plugins, then enable per-IP limits and
    # let CrowdSec ban abusive sources before they reach n8n.
    header {
        Referrer-Policy "strict-origin-when-cross-origin"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        -Server
    }
    log {
        output file /var/log/caddy/n8n.example.com.log
    }
}
\`\`\`

Reload Caddy after editing: \`sudo systemctl reload caddy\`. Add the DNS A record for the n8n
hostname → the host's public IP first, so Caddy's ACME challenge can validate. UFW: allow only
80/443 (and SSH from known IPs); the n8n port itself stays bound to localhost.

## 4. Import the starter workflows
1. In the n8n UI, use **Import from File** to load each template from \`starterWorkflows()\`
   ("MELEK — new post → notify" and "Hathor — price-feed health ping").
2. Each workflow references credentials BY NAME — open it and bind the real credential (e.g. the
   Discord credential) inside the n8n UI. No token is ever stored in the template.
3. Adjust the placeholder URLs (\`your-melek-rpc-host\`) to the real endpoints, then activate.

## 5. Hardening checklist
- [ ] Basic auth ON (\`N8N_BASIC_AUTH_ACTIVE=true\`) — never expose the editor unprotected.
- [ ] n8n bound to \`127.0.0.1\`; only Caddy is public (80/443). Confirm the raw port is not reachable.
- [ ] \`N8N_SECURE_COOKIE=true\` and serve only over https (Caddy TLS).
- [ ] Webhook security: prefer authenticated webhook nodes (header/basic auth) for any public webhook;
      treat the webhook URL as a capability and keep it out of the repo.
- [ ] \`N8N_DIAGNOSTICS_ENABLED=false\` — no telemetry phone-home.
- [ ] \`.env\` is \`chmod 600\`, owned by the deploy user, and gitignored. Values from the vault only.
- [ ] Keep the n8n image patched; pin a version tag for production rather than \`:latest\`.
- [ ] CrowdSec / fail2ban on the Caddy access log for repeated auth failures.
- [ ] Off-host encrypted backups of the n8n data volume (and the postgres DB if used); test a restore.

## 6. Verify
- \`docker compose ps\` shows n8n (and postgres) healthy.
- \`curl -sS -o /dev/null -w '%{http_code}' https://n8n.example.com/\` returns a 401/200 (auth gate works).
- Log into the UI with the basic-auth credentials from the vault.
- Run one starter workflow manually (Execute Workflow) and confirm it completes.
`;
}

// ---------------------------------------------------------------------------
// Validation — structural + a no-secret-literal guard.
// ---------------------------------------------------------------------------
/**
 * Validate a config object (the shape passed to dockerCompose). Returns { ok, errors[] }. Never throws.
 * Flags: missing/blank env NAMES, env fields that aren't valid NAMES, a bad dbType, and — the
 * load-bearing check — any field that looks like a hard-coded secret literal instead of an env NAME.
 */
export function validateConfig(cfg) {
  const errors = [];
  const c = cfg && typeof cfg === 'object' ? cfg : {};

  // dbType
  const dbType = String(c.dbType ?? DEFAULT_OPTS.dbType).toLowerCase();
  if (dbType !== 'sqlite' && dbType !== 'postgres') {
    errors.push(`dbType must be "sqlite" or "postgres" (got "${c.dbType}")`);
  }

  // port
  if (c.port != null && !Number.isFinite(Number(c.port))) {
    errors.push('port must be a number');
  }

  // The fields that MUST be env var NAMES (not values).
  const envNameFields = ['encKeyEnv', 'basicAuthUserEnv', 'basicAuthPassEnv'];
  if (dbType === 'postgres') {
    envNameFields.push('dbHostEnv', 'dbNameEnv', 'dbUserEnv', 'dbPassEnv');
  }
  for (const field of envNameFields) {
    const val = c[field] ?? DEFAULT_OPTS[field];
    if (val == null || String(val).trim() === '') {
      errors.push(`${field} is required (an env var NAME)`);
      continue;
    }
    if (looksLikeSecretLiteral(val)) {
      errors.push(`${field} looks like a hard-coded secret literal — it must be an env var NAME, value comes from the vault`);
    } else if (!isEnvName(String(val))) {
      errors.push(`${field} must be an env var NAME (UPPER_SNAKE_CASE), not "${val}"`);
    }
  }

  // Scan every string field for an embedded secret literal (defense in depth).
  for (const [k, v] of Object.entries(c)) {
    if (envNameFields.includes(k)) continue;
    if (looksLikeSecretLiteral(v)) {
      errors.push(`${k} contains what looks like a hard-coded secret literal — no secret values allowed in config`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// CLI — print compose + .env template + runbook + starter workflows. Guarded.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('n8n-config.mjs')) {
  const dbType = process.argv.includes('--postgres') ? 'postgres' : 'sqlite';
  const compose = dockerCompose({ dbType });
  const v = validateConfig({ dbType });
  // eslint-disable-next-line no-console
  console.log(`# n8n-config — dbType=${dbType}, config valid=${v.ok}${v.ok ? '' : ' errors=' + JSON.stringify(v.errors)}`);
  // eslint-disable-next-line no-console
  console.log('\n# ---- docker-compose.yml ----\n' + compose.yaml);
  // eslint-disable-next-line no-console
  console.log('\n# ---- .env (NAMES only) ----\n' + envTemplate({ dbType }).text);
  // eslint-disable-next-line no-console
  console.log('\n# ---- starter workflows ----\n' + JSON.stringify(starterWorkflows(), null, 2));
  // eslint-disable-next-line no-console
  console.log('\n# ---- setup runbook ----\n' + setupRunbook());
}

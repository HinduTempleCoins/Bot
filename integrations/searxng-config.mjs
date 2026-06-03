// searxng-config.mjs — SearXNG self-host CONFIG GENERATOR (task #31).
//
// The repo's scraper (integrations/scraper.mjs) has a `searxng` provider that fans a query across
// public SearXNG instances — but public instances usually IP-gate JSON (HTML/403 from datacenter IPs),
// so results are flaky. This module emits the config + runbook to stand up a RELIABLE self-hosted
// SearXNG on the on-chain box, giving the scraper a private metasearch backend that itself queries
// Google/Bing/DuckDuckGo/Brave AND foreign engines (Yandex, Baidu, Mojeek) with JSON enabled.
//
// This is a DETERMINISTIC CONFIG / RUNBOOK GENERATOR, not a deployer. It emits:
//   - settingsYml(...)   : a SearXNG settings.yml-shaped object + rendered YAML string
//   - dockerCompose(...) : a docker-compose service (searxng + optional redis) — env var NAMES only
//   - engineList()       : the curated default engine set, annotated foreign/metasearch
//   - setupRunbook()     : a markdown runbook (compose up / set secret / JSON / wire scraper / harden)
//   - validateSettings(...) : structural validation incl. no-secret-literal + JSON-format checks
//
// CONVENTIONS: pure + deterministic. No network. No clock dependence. Soft-fail (never throws on bad
// input; returns a result object or a safe default). NO SECRETS: the SearXNG `secret_key` is referenced
// as an env var NAME only (e.g. ${SEARXNG_SECRET_KEY}); its VALUE is supplied at deploy time from the
// vault, never here and never committed. No host-specific IPs/server-names — everything is generic.

// ---------------------------------------------------------------------------
// Curated engine set. The reliability goal: a backend that covers the big indexes AND independent /
// foreign-language engines so the scraper's `searxng` provider returns a genuinely diverse view.
//   kind: 'general'   — mainstream Western general engine
//         'metasearch'— aggregates other engines / independent crawler
//         'foreign'   — non-Western / foreign-language index (the multilingual reliability goal)
// ---------------------------------------------------------------------------
export const DEFAULT_ENGINES = [
  { name: 'google',     kind: 'general',    note: 'Google general web (largest Western index).' },
  { name: 'bing',       kind: 'general',    note: 'Microsoft Bing general web.' },
  { name: 'duckduckgo', kind: 'metasearch', note: 'DuckDuckGo (Bing-backed metasearch).' },
  { name: 'brave',      kind: 'metasearch', note: 'Brave Search (independent index + metasearch).' },
  { name: 'mojeek',     kind: 'metasearch', note: 'Mojeek — independent UK crawler/index (not a reseller).' },
  { name: 'yandex',     kind: 'foreign',    note: 'Yandex — Russian-language index, strong non-Western coverage.' },
  { name: 'baidu',      kind: 'foreign',    note: 'Baidu — Chinese-language index.' },
  { name: 'wikipedia',  kind: 'general',    note: 'Wikipedia (authoritative entity/biography anchor).' },
];

// The four engines callers/tests treat as "foreign or metasearch" — the reliability spine.
export const FOREIGN_METASEARCH = new Set(['duckduckgo', 'brave', 'mojeek', 'yandex', 'baidu']);

/**
 * The curated default engine set, each annotated with whether it is foreign-language / metasearch
 * (the reliability goal — a backend that reaches past the big two Western indexes). Never throws.
 * @returns {Array<{name:string, kind:string, foreignOrMetasearch:boolean, note:string}>}
 */
export function engineList() {
  return DEFAULT_ENGINES.map((e) => ({
    name: e.name,
    kind: e.kind,
    foreignOrMetasearch: FOREIGN_METASEARCH.has(e.name),
    note: e.note,
  }));
}

// ---------------------------------------------------------------------------
// settings.yml generator.
//
// The `secret_key` is the one sensitive value. We NEVER emit a literal — the rendered YAML references
// an env var via the docker/SearXNG `${NAME}` interpolation form, and the structured object carries the
// env NAME under `secretKeyEnv`. The base URL is likewise an env NAME so the same config works on any
// host. JSON output format is enabled (alongside html) so the scraper can consume results programmatically.
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS_OPTS = {
  instanceName: 'MELEK SearXNG',
  secretKeyEnv: 'SEARXNG_SECRET_KEY',
  baseUrlEnv: 'SEARXNG_BASE_URL',
  engines: null,            // null → DEFAULT_ENGINES
};

const yamlStr = (s) => `"${String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Build a SearXNG settings.yml-shaped object plus the rendered YAML string.
 *  - server.secret_key references the env var NAME via ${NAME} interpolation (NO literal secret).
 *  - base_url references the env var NAME the same way.
 *  - search.formats includes 'json' so the scraper can query format=json.
 *  - the curated engine set is enabled; rate-limiter + bot detection are ON (no open instance).
 * Soft-fails to defaults on bad input.
 * @returns {{ object: object, yaml: string, secretKeyEnv: string, envVarsRequired: string[] }}
 */
export function settingsYml(opts = {}) {
  const o = { ...DEFAULT_SETTINGS_OPTS, ...(opts && typeof opts === 'object' ? opts : {}) };
  const secretKeyEnv = String(o.secretKeyEnv || DEFAULT_SETTINGS_OPTS.secretKeyEnv);
  const baseUrlEnv = String(o.baseUrlEnv || DEFAULT_SETTINGS_OPTS.baseUrlEnv);
  const engines = Array.isArray(o.engines) && o.engines.length
    ? o.engines.map((e) => (typeof e === 'string' ? { name: e } : e)).filter((e) => e && e.name)
    : DEFAULT_ENGINES;

  const object = {
    instanceName: String(o.instanceName || DEFAULT_SETTINGS_OPTS.instanceName),
    server: {
      // env var NAME, in the ${NAME} interpolation form SearXNG/docker resolve at runtime. NOT a literal.
      secretKeyRef: `\${${secretKeyEnv}}`,
      secretKeyEnv,
      baseUrlRef: `\${${baseUrlEnv}}`,
      baseUrlEnv,
      limiter: true,                 // rate-limit on
      public_instance: false,        // not an open instance
      image_proxy: true,
    },
    search: {
      safe_search: 1,
      formats: ['html', 'json'],     // JSON enabled for programmatic use by the scraper
      autocomplete: '',
    },
    botdetection: {
      ip_limit: { link_token: true },
    },
    engines: engines.map((e) => ({ name: e.name, disabled: false })),
  };

  const engineYaml = object.engines
    .map((e) => `  - name: ${yamlStr(e.name)}\n    disabled: false`)
    .join('\n');

  const yaml = `# SearXNG settings.yml for ${object.instanceName}
#
# GENERATED by integrations/searxng-config.mjs — review before use.
# secret_key and base_url are read from the ENVIRONMENT at runtime via \${NAME} interpolation.
# No secret values appear in this file or in the repo; only the env var NAMES below.
# The deploy step must export these (from the vault) before SearXNG starts:
#   ${secretKeyEnv}, ${baseUrlEnv}
use_default_settings: true

general:
  instance_name: ${yamlStr(object.instanceName)}

server:
  # The secret_key VALUE is never committed. \${${secretKeyEnv}} is interpolated from the environment.
  secret_key: "\${${secretKeyEnv}}"
  base_url: "\${${baseUrlEnv}}"
  limiter: true            # rate-limiting ON (blunts scraping/abuse)
  public_instance: false   # NOT an open public instance
  image_proxy: true

search:
  safe_search: 1
  # JSON enabled so the repo's scraper can request format=json programmatically.
  formats:
    - html
    - json

botdetection:
  ip_limit:
    link_token: true       # bot detection ON

engines:
${engineYaml}
`;

  return {
    object,
    yaml,
    secretKeyEnv,
    envVarsRequired: [secretKeyEnv, baseUrlEnv],
  };
}

// ---------------------------------------------------------------------------
// docker-compose generator.
//
// Emits a compose service for SearXNG plus an optional redis (valkey) for the rate-limiter. The
// secret_key is passed through the ENVIRONMENT referencing the env var NAME only (KEY: ${KEY} form),
// so docker-compose resolves it from the deploy host's environment / .env at `up` time. No literal
// secret, no host-specific bind addresses.
// ---------------------------------------------------------------------------
const DEFAULT_COMPOSE_OPTS = {
  port: 8080,
  secretKeyEnv: 'SEARXNG_SECRET_KEY',
  baseUrlEnv: 'SEARXNG_BASE_URL',
  withRedis: true,
};

/**
 * Build a docker-compose object + rendered YAML for SearXNG (+ optional redis/valkey).
 * The secret + base URL are passed via env var NAMES (KEY: ${KEY}), never literal values.
 * Soft-fails to defaults on bad input. Never throws.
 * @returns {{ object: object, yaml: string, envVarsRequired: string[] }}
 */
export function dockerCompose(opts = {}) {
  const o = { ...DEFAULT_COMPOSE_OPTS, ...(opts && typeof opts === 'object' ? opts : {}) };
  const port = Number.isFinite(+o.port) && +o.port > 0 ? Math.floor(+o.port) : DEFAULT_COMPOSE_OPTS.port;
  const secretKeyEnv = String(o.secretKeyEnv || DEFAULT_COMPOSE_OPTS.secretKeyEnv);
  const baseUrlEnv = String(o.baseUrlEnv || DEFAULT_COMPOSE_OPTS.baseUrlEnv);
  const withRedis = o.withRedis !== false;

  const services = {
    searxng: {
      image: 'searxng/searxng:latest',
      restart: 'unless-stopped',
      ports: [`127.0.0.1:${port}:8080`],   // bind localhost only — front with Caddy, not exposed directly
      volumes: ['./searxng:/etc/searxng:rw'],
      // env var NAMES only; docker-compose interpolates the VALUES from the host env / .env at `up`.
      environment: {
        SEARXNG_SECRET_KEY: `\${${secretKeyEnv}}`,
        SEARXNG_BASE_URL: `\${${baseUrlEnv}}`,
      },
    },
  };
  if (withRedis) {
    services.redis = {
      image: 'valkey/valkey:8-alpine',
      restart: 'unless-stopped',
      command: 'valkey-server --save 30 1 --loglevel warning',
      volumes: ['./valkey-data:/data'],
    };
    services.searxng.depends_on = ['redis'];
  }

  const object = { services };

  const redisYaml = withRedis
    ? `
  redis:
    image: valkey/valkey:8-alpine
    restart: unless-stopped
    command: valkey-server --save 30 1 --loglevel warning
    volumes:
      - ./valkey-data:/data`
    : '';
  const dependsYaml = withRedis ? '\n    depends_on:\n      - redis' : '';

  const yaml = `# docker-compose.yml for self-hosted SearXNG
#
# GENERATED by integrations/searxng-config.mjs — review before use.
# The secret_key and base_url are passed through the ENVIRONMENT by NAME only:
#   ${secretKeyEnv}, ${baseUrlEnv}
# docker-compose interpolates the VALUES from the host environment / a .env file at \`up\` time.
# No secret values appear in this file or in the repo.
services:
  searxng:
    image: searxng/searxng:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:${port}:8080"   # localhost only — terminate TLS / front with Caddy
    volumes:
      - ./searxng:/etc/searxng:rw
    environment:
      SEARXNG_SECRET_KEY: "\${${secretKeyEnv}}"
      SEARXNG_BASE_URL: "\${${baseUrlEnv}}"${dependsYaml}${redisYaml}
`;

  return { object, yaml, envVarsRequired: [secretKeyEnv, baseUrlEnv] };
}

// ---------------------------------------------------------------------------
// Setup runbook (markdown). Static, deterministic text.
// ---------------------------------------------------------------------------
/** Markdown runbook for standing up + securing a self-hosted SearXNG and wiring the scraper to it. */
export function setupRunbook() {
  return `# Self-hosted SearXNG — setup runbook

> GENERATED by integrations/searxng-config.mjs. This is a runbook, not an automated deployer.
> Do every step deliberately. No secrets live in this repo — they come from the vault / environment.

## Why
The repo's scraper (\`integrations/scraper.mjs\`) has a \`searxng\` provider, but public instances
IP-gate JSON (HTML/403 from datacenter IPs), so results are flaky. A self-hosted instance gives a
reliable private metasearch backend covering Google/Bing/DuckDuckGo/Brave AND foreign engines
(Yandex, Baidu, Mojeek) with JSON enabled.

## 1. Generate the config
1. Emit \`searxng/settings.yml\` with \`settingsYml({...})\` from this module. It enables the curated
   engines, turns the rate-limiter + bot detection on, and enables the \`json\` output format.
2. Emit \`docker-compose.yml\` with \`dockerCompose({...})\` (SearXNG + a redis/valkey for the limiter).
3. Both reference \`SEARXNG_SECRET_KEY\` and \`SEARXNG_BASE_URL\` by NAME only — never hard-code them.

## 2. Set the secret (env / vault)
- Generate a strong random value: \`openssl rand -hex 32\`.
- Store it in the operator's vault (Vaultwarden), NOT in the repo or the compose file.
- Export it (and the base URL) into the deploy environment so docker-compose interpolates them at \`up\`:
  - \`SEARXNG_SECRET_KEY\` — the random secret (from vault).
  - \`SEARXNG_BASE_URL\`  — the public URL the instance is served at (e.g. behind Caddy).
- A local \`.env\` file (gitignored, 0600) next to the compose file is the usual carrier.

## 3. Bring it up (docker-compose)
\`\`\`bash
docker-compose up -d        # starts searxng (+ redis/valkey)
docker-compose logs -f searxng
\`\`\`
SearXNG binds to \`127.0.0.1\` only — it is NOT exposed directly; front it with Caddy (TLS) like the
other SoapBox subdomains.

## 4. Confirm JSON format is enabled
The scraper consumes JSON. Verify the instance returns it:
\`\`\`bash
curl -s 'http://127.0.0.1:8080/search?q=bitcoin&format=json' | head -c 300
\`\`\`
You should get JSON with a \`results\` array. If you get HTML/403, the \`json\` format isn't enabled in
\`settings.yml\` (\`search.formats\` must include \`json\`) — re-emit with \`settingsYml()\`.

## 5. Point the scraper at the local instance
The scraper reads the \`SEARX_INSTANCES\` env var (comma-separated base URLs). Set it to your instance
so the \`searxng\` provider queries it first:
\`\`\`bash
export SEARX_INSTANCES="https://search.<your-domain>"   # the Caddy-fronted base URL
\`\`\`
\`integrations/scraper.mjs\`'s \`searchSearx()\` will then hit your reliable instance instead of the
flaky public list. (The base URL is generic — no IP / server-name is baked into this repo.)

## 6. Harden (limiter on, no open instance)
- [ ] \`server.limiter: true\` and a redis/valkey backing it (rate-limiting ON).
- [ ] \`server.public_instance: false\` — do NOT run an open public instance.
- [ ] \`botdetection.ip_limit.link_token: true\` (bot detection ON).
- [ ] Front with Caddy for TLS; bind the container to \`127.0.0.1\` only (the compose does this).
- [ ] UFW: allow only 80/443 (and SSH from known IPs); deny direct access to the SearXNG port.
- [ ] Keep the image patched (\`docker-compose pull && docker-compose up -d\`).
- [ ] Keep the \`secret_key\` only in the vault/environment — never commit it.

## 7. Verify
- [ ] \`curl .../search?q=test&format=json\` returns a \`results\` array (JSON works).
- [ ] Foreign/metasearch engines appear in results (Yandex/Baidu/Mojeek reachable from the box).
- [ ] The scraper's \`searxng\` provider returns rows when pointed at \`SEARX_INSTANCES\`.
- [ ] The instance is not reachable on the raw port from outside (only via Caddy/TLS).
`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
// Heuristic: a hex/base64-ish run of >=16 chars that is NOT an env interpolation is treated as a
// hardcoded secret. (${NAME} / $NAME interpolation forms and getenv() are allowed.)
const LIKELY_SECRET = /\b[A-Fa-f0-9]{16,}\b|\b[A-Za-z0-9+/]{24,}={0,2}\b/;

/**
 * Validate a settings.yml config (the object from settingsYml, OR the rendered YAML string).
 * Returns { ok, errors[] }. Checks, among others:
 *  - secret_key is referenced by env NAME, never a literal value (no-secret-literal check).
 *  - the json output format is enabled (programmatic use).
 * Never throws.
 */
export function validateSettings(cfg) {
  const errors = [];
  if (cfg == null || (typeof cfg !== 'object' && typeof cfg !== 'string')) {
    return { ok: false, errors: ['settings must be an object or YAML string'] };
  }

  const yaml = typeof cfg === 'string' ? cfg : (cfg.yaml || '');
  const object = typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg.object || cfg) : null;

  // --- secret_key checks ---
  const secretRef = object?.server?.secretKeyRef;
  const secretEnv = object?.server?.secretKeyEnv;
  if (object) {
    if (!secretEnv) errors.push('server.secretKeyEnv missing (must name the env var holding the secret)');
    if (!secretRef || !/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(String(secretRef))) {
      errors.push('server.secretKeyRef must reference an env var (${NAME}), not a literal');
    }
  }

  if (yaml) {
    // Find the secret_key line and ensure it interpolates an env var rather than a literal value.
    const m = yaml.match(/secret_key:\s*(.+)/);
    if (!m) {
      errors.push('settings YAML has no secret_key line');
    } else {
      const val = m[1].trim().replace(/^["']|["']$/g, '');
      const isEnvRef = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(val) || /getenv\(/.test(val);
      if (!isEnvRef) {
        errors.push('secret_key has a hardcoded literal — must reference an env var (${NAME})');
      } else if (LIKELY_SECRET.test(val.replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, ''))) {
        // env ref present but ALSO a literal-looking blob alongside it
        errors.push('secret_key line contains a literal secret alongside the env reference');
      }
    }
  }

  // --- JSON format enabled check ---
  let jsonEnabled = false;
  if (object?.search?.formats && Array.isArray(object.search.formats)) {
    jsonEnabled = object.search.formats.includes('json');
  }
  if (!jsonEnabled && yaml) {
    // crude: a `formats:` block (or inline list) that mentions json
    jsonEnabled = /formats:[\s\S]*?\bjson\b/.test(yaml);
  }
  if (!jsonEnabled) errors.push('json output format not enabled (search.formats must include "json")');

  // --- engines present ---
  const engines = object?.engines;
  if (object && (!Array.isArray(engines) || engines.length === 0)) {
    errors.push('no engines configured');
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// CLI — print the settings.yml + compose + runbook. Guarded so importing has no side effects.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('searxng-config.mjs')) {
  const s = settingsYml();
  const v = validateSettings(s);
  console.log('# ---- engine list ----');
  for (const e of engineList()) console.log(`  ${e.name.padEnd(12)} ${e.kind.padEnd(11)} ${e.foreignOrMetasearch ? '[foreign/meta]' : ''} ${e.note}`);
  console.log('\n# ---- settings.yml (env var NAME only for secret) ----');
  console.log(s.yaml);
  console.log('# ---- docker-compose.yml ----');
  console.log(dockerCompose().yaml);
  console.log('# ---- setup runbook ----');
  console.log(setupRunbook());
  console.log(`\n# validateSettings: ${v.ok ? 'OK' : 'ERRORS: ' + v.errors.join('; ')}`);
}

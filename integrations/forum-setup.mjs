// forum-setup.mjs — MyBB forum setup helper for forums.soapbox.community (task #52).
//
// This is a DETERMINISTIC CONFIG / SEED GENERATOR, not a deployer. It emits:
//   - DEFAULT_FORUMS : the seed board structure (categories + boards), aligned to the SoapBox verticals
//   - mybbConfig(...) : a MyBB config.php-shaped object/string that references env var NAMES only
//   - seedSql(...)    : SQL INSERTs to create the forum rows (operator reviews before running)
//   - setupGuide()    : a markdown runbook (install / DNS / Caddy / hardening / where secrets live)
//   - validateForums(...) : structural validation
//
// CONVENTIONS: pure + deterministic. No network. No clock dependence — any timestamp comes in as a
// param. Soft-fail (never throws on bad input; returns a result object or a safe default). NO SECRETS:
// database passwords / admin email are referenced as env var NAMES only; their VALUES are read by the
// deploy step (process.env), never here and never committed.

// ---------------------------------------------------------------------------
// Seed board structure — categories map to the SoapBox site verticals so the forum mirrors the
// products people already use on data.soapbox.community (chain, data/markets, library/wiki, trading,
// games, bio-NFT) plus the usual community boards (support, off-topic).
// ---------------------------------------------------------------------------
export const DEFAULT_FORUMS = [
  {
    name: 'MELEK Chain',
    description: 'The MELEK blockchain — witnesses, blocks, accounts, signup, and the Hathor witness.',
    boards: [
      { name: 'Announcements', description: 'Official chain + witness announcements.' },
      { name: 'Witnesses & Governance', description: 'Witness operation, voting, DPoS, and consensus.' },
      { name: 'Getting Started / Signup', description: 'Create an account, claim keys, first steps.' },
    ],
  },
  {
    name: 'SoapBox Data',
    description: 'The data.soapbox.community aggregator — prices, Clarity Score, macro, commodities, FX.',
    boards: [
      { name: 'Market Data & Prices', description: 'Coin prices, charts, and the Clarity transparency score.' },
      { name: 'Macro, Commodities & FX', description: 'Metals, indexes, yields, energy, currencies — and where to buy.' },
      { name: 'Site Feedback', description: 'Bugs, data corrections, and feature requests for the aggregator.' },
    ],
  },
  {
    name: 'Library',
    description: 'The Library of Ashurbanipal — the fact-checked knowledge base and explainers.',
    boards: [
      { name: 'Knowledge Base', description: 'Articles, explainers, and corpus discussion.' },
      { name: 'Fact-Checks & Corrections', description: 'Flagged claims and source-backed corrections.' },
    ],
  },
  {
    name: 'Trading',
    description: 'Trading the ecosystem tokens, DEX/CEX mechanics, and strategy talk.',
    boards: [
      { name: 'TribalDEX & Hive-Engine', description: 'VKBT / CURE and Hive-Engine market mechanics.' },
      { name: 'Strategy & Analysis', description: 'Setups, risk, and market structure discussion.' },
    ],
  },
  {
    name: 'Games',
    description: 'On-chain and off-chain games, offerwalls, and play-to-earn.',
    boards: [
      { name: 'Game Talk', description: 'General games discussion and announcements.' },
      { name: 'Offerwalls & Rewards', description: 'Earning mechanics and reward programs.' },
    ],
  },
  {
    name: 'Bio-NFT',
    description: 'Bio-NFT minting, consent, and biodata-as-asset discussion.',
    boards: [
      { name: 'Minting & Consent', description: 'How minting works and the consent broker.' },
      { name: 'BioDAO', description: 'Governance and proposals for the bio-asset program.' },
    ],
  },
  {
    name: 'Support',
    description: 'Help with accounts, wallets, signup, and the site.',
    boards: [
      { name: 'Account & Wallet Help', description: 'Login, keys, recovery, and wallet questions.' },
      { name: 'Technical Issues', description: 'Errors, outages, and how-to questions.' },
    ],
  },
  {
    name: 'Off-topic',
    description: 'Everything else — community, introductions, and lounge.',
    boards: [
      { name: 'Introductions', description: 'Say hello and tell us who you are.' },
      { name: 'The Lounge', description: 'Off-topic chat for the community.' },
    ],
  },
];

// ---------------------------------------------------------------------------
// MyBB config.php generator.
//
// MyBB stores its DB credentials in inc/config.php. We DO NOT embed any secret value. Instead the
// generated file reads the values from the process environment at runtime, so the only thing this
// generator (and the repo) ever contains is the env var NAMES. The deploy step is responsible for
// having those vars populated (from the vault) when PHP runs.
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG_OPTS = {
  siteUrl: 'https://forums.soapbox.community',
  dbHostEnv: 'FORUM_DB_HOST',
  dbNameEnv: 'FORUM_DB_NAME',
  dbUserEnv: 'FORUM_DB_USER',
  dbPassEnv: 'FORUM_DB_PASS',
  adminEmailEnv: 'FORUM_ADMIN_EMAIL',
  tablePrefix: 'mybb_',
};

/**
 * Build a MyBB config.php-shaped object plus the rendered PHP string.
 * All credential fields reference env var NAMES — never values. Soft-fails to defaults on bad input.
 * @returns {{ object: object, php: string, envVarsRequired: string[] }}
 */
export function mybbConfig(opts = {}) {
  const o = { ...DEFAULT_CONFIG_OPTS, ...(opts && typeof opts === 'object' ? opts : {}) };

  // The structured object a deploy step would consume. The *_Env fields are env var NAMES; the deploy
  // step resolves them. We never put the secret value in here.
  const object = {
    siteUrl: String(o.siteUrl),
    tablePrefix: String(o.tablePrefix),
    database: {
      type: 'mysqli',
      hostEnv: String(o.dbHostEnv),
      nameEnv: String(o.dbNameEnv),
      userEnv: String(o.dbUserEnv),
      passwordEnv: String(o.dbPassEnv),
    },
    adminEmailEnv: String(o.adminEmailEnv),
  };

  // Render the PHP. getenv('NAME') is what reads the secret AT RUNTIME — the literal here is the NAME.
  const g = (name) => `getenv('${String(name)}')`;
  const php = `<?php
/**
 * MyBB inc/config.php for ${object.siteUrl}
 *
 * GENERATED by integrations/forum-setup.mjs — review before use.
 * Database credentials and the admin email are read from the ENVIRONMENT at runtime.
 * No secret values appear in this file or in the repo; only the env var NAMES below.
 * The deploy step must export these vars (from the vault) before PHP runs.
 *   ${object.database.hostEnv}, ${object.database.nameEnv}, ${object.database.userEnv}, ${object.database.passwordEnv}, ${object.adminEmailEnv}
 */
$config['database']['type']     = 'mysqli';
$config['database']['database'] = ${g(object.database.nameEnv)};
$config['database']['table_prefix'] = '${object.tablePrefix}';
$config['database']['hostname'] = ${g(object.database.hostEnv)};
$config['database']['username'] = ${g(object.database.userEnv)};
$config['database']['password'] = ${g(object.database.passwordEnv)};

$config['admin_email'] = ${g(object.adminEmailEnv)};

// Admin CP directory — rename from the default 'admin' for security (see setupGuide()).
$config['admin_dir'] = 'admincp';
$config['hide_admin_links'] = 1;

// Data cache handler. 'db' is the safe default; switch to 'redis'/'memcache' if available.
$config['cache_store'] = 'db';

$config['super_admins'] = '1';
`;

  return {
    object,
    php,
    envVarsRequired: [
      object.database.hostEnv,
      object.database.nameEnv,
      object.database.userEnv,
      object.database.passwordEnv,
      object.adminEmailEnv,
    ],
  };
}

// ---------------------------------------------------------------------------
// SQL seed generator.
//
// Emits INSERT statements for the MyBB `forums` table — one row per category and one per board, with a
// stable ordering (`disporder`) and category linkage (`pid`). This is a HELPER: the operator must
// review the SQL and adapt column names to their exact MyBB schema/version before running it. We escape
// single quotes so a board name containing a quote can't break (or inject into) the statement.
// ---------------------------------------------------------------------------
function sqlEscape(s) {
  // MySQL single-quote escaping: double the quote, and neutralize backslashes.
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * Generate idempotent-ish INSERT statements for the forum/board rows.
 * One INSERT per category + one per board. Categories get incremental fake pids (cat1, cat2…) which a
 * reviewer maps to real AUTO_INCREMENT fids; the comment explains this.
 * @returns {string} SQL (safe to print; never throws)
 */
export function seedSql(forums = DEFAULT_FORUMS) {
  const list = Array.isArray(forums) ? forums : [];
  const lines = [
    '-- MyBB forum seed — GENERATED by integrations/forum-setup.mjs',
    '-- REVIEW BEFORE RUNNING. Column names/types vary by MyBB version; the placeholder @cat<N>',
    '-- values stand in for the real AUTO_INCREMENT fid of each category — set them after each',
    '-- category INSERT (e.g. SET @cat1 = LAST_INSERT_ID();). Run inside a transaction.',
    '-- Names are single-quote-escaped to prevent breakage / injection.',
    'START TRANSACTION;',
    '',
  ];

  let catOrder = 0;
  list.forEach((cat, ci) => {
    if (!cat || typeof cat !== 'object') return;
    catOrder += 1;
    const catVar = `@cat${ci + 1}`;
    const cName = sqlEscape(cat.name);
    const cDesc = sqlEscape(cat.description);
    lines.push(`-- Category: ${cName}`);
    lines.push(
      `INSERT INTO mybb_forums (name, description, type, pid, disporder, active, open) ` +
        `VALUES ('${cName}', '${cDesc}', 'c', 0, ${catOrder}, 1, 1);`
    );
    lines.push(`SET ${catVar} = LAST_INSERT_ID();`);
    const boards = Array.isArray(cat.boards) ? cat.boards : [];
    boards.forEach((b, bi) => {
      if (!b || typeof b !== 'object') return;
      const bName = sqlEscape(b.name);
      const bDesc = sqlEscape(b.description);
      lines.push(
        `INSERT INTO mybb_forums (name, description, type, pid, disporder, active, open) ` +
          `VALUES ('${bName}', '${bDesc}', 'f', ${catVar}, ${bi + 1}, 1, 1);`
      );
    });
    lines.push('');
  });

  lines.push('COMMIT;');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Setup runbook (markdown). Static, deterministic text.
// ---------------------------------------------------------------------------
/** Markdown runbook for installing + securing MyBB at forums.soapbox.community. */
export function setupGuide() {
  return `# forums.soapbox.community — MyBB setup runbook

> GENERATED by integrations/forum-setup.mjs. This is a runbook, not an automated deployer.
> Do every step deliberately. No secrets live in this repo — they come from the vault / environment.

## 1. Provision MyBB
1. Download the latest stable MyBB release from https://mybb.com/ and verify its checksum.
2. Upload to the web root on the forum host (a directory served only over HTTPS).
3. Create the MySQL/MariaDB database and a dedicated DB user with rights on that database ONLY.
4. Generate \`inc/config.php\` with \`mybbConfig({...})\` from this module. It reads DB credentials and
   the admin email from environment variables at runtime — populate them from the vault (see §5),
   never hard-code them.
5. Run the web installer, then DELETE the \`install/\` directory (MyBB refuses to run until you do).

## 2. DNS
- At your DNS provider, add an **A record** \`forums\` (the subdomain) → the forum host's
  public IPv4 (and an **AAAA** record if the host has IPv6).
- TTL ~300s during setup; raise it once stable.
- Point it the same way the other SoapBox subdomains are pointed.

## 3. Reverse proxy (Caddy)
Caddy terminates TLS (automatic Let's Encrypt) and proxies to PHP-FPM / the local web server.

\`\`\`caddy
forums.soapbox.community {
    encode zstd gzip
    root * /var/www/forums
    php_fastcgi unix//run/php/php-fpm.sock
    file_server

    # Block direct access to sensitive paths.
    @blocked path /inc/* /install/* /admincp/backups/*
    respond @blocked 403

    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
\`\`\`

Reload Caddy after editing: \`caddy reload\` (or restart the systemd unit). This is the same
Caddy-TLS + UFW 80/443 pattern used for data.soapbox.community on the SoapBox host.

## 4. Security hardening checklist
- [ ] Rename the admin directory from \`admin\` to a non-obvious name (\`admincp\`) — set in config.
- [ ] Delete \`install/\` after setup.
- [ ] \`chmod\` \`inc/config.php\` and \`inc/settings.php\` to 0640 (or 0644), owned by the web user.
- [ ] Enable MyBB's secret-question / CAPTCHA on registration to blunt spam bots.
- [ ] Turn on admin-CP IP allow-listing or HTTP basic-auth in Caddy in front of \`/admincp\`.
- [ ] Keep MyBB + every plugin patched; subscribe to MyBB security advisories.
- [ ] UFW: allow only 80/443 (and SSH from known IPs); deny everything else.
- [ ] Set up off-host, encrypted DB backups; test a restore.
- [ ] Use a CrowdSec / fail2ban rule for repeated failed admin logins.

## 5. Where secrets come from
Database credentials and the admin email are **NEVER committed**. They live in the operator's vault
(Vaultwarden) and are exported as environment variables on the forum host at deploy time:

| Env var name | Holds |
|---|---|
| \`FORUM_DB_HOST\` | DB hostname |
| \`FORUM_DB_NAME\` | DB name |
| \`FORUM_DB_USER\` | DB user |
| \`FORUM_DB_PASS\` | DB password (from vault) |
| \`FORUM_ADMIN_EMAIL\` | admin contact email |

The generated \`config.php\` reads each via \`getenv('NAME')\`. Confirm the vars are present in the
PHP-FPM environment (e.g. an \`environment\` directive in the pool config) before the first request.

## 6. Seed the boards
Generate the board structure with \`seedSql()\`, **review the SQL**, then run it inside a transaction
against the freshly installed database. Adjust column names to your MyBB version first.
`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
/**
 * Validate the forum structure. Returns { ok, errors[] }. Never throws.
 */
export function validateForums(forums) {
  const errors = [];
  if (!Array.isArray(forums)) {
    return { ok: false, errors: ['forums must be an array'] };
  }
  if (forums.length === 0) errors.push('forums is empty');

  const seenCat = new Set();
  forums.forEach((cat, i) => {
    const where = `category[${i}]`;
    if (!cat || typeof cat !== 'object') {
      errors.push(`${where} is not an object`);
      return;
    }
    if (!cat.name || typeof cat.name !== 'string' || !cat.name.trim()) {
      errors.push(`${where} missing name`);
    } else if (seenCat.has(cat.name)) {
      errors.push(`${where} duplicate category name "${cat.name}"`);
    } else {
      seenCat.add(cat.name);
    }
    if (typeof cat.description !== 'string') errors.push(`${where} (${cat.name || '?'}) missing description`);
    if (!Array.isArray(cat.boards) || cat.boards.length === 0) {
      errors.push(`${where} (${cat.name || '?'}) must have at least one board`);
    } else {
      const seenBoard = new Set();
      cat.boards.forEach((b, j) => {
        const bw = `${where}.boards[${j}]`;
        if (!b || typeof b !== 'object') {
          errors.push(`${bw} is not an object`);
          return;
        }
        if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
          errors.push(`${bw} missing name`);
        } else if (seenBoard.has(b.name)) {
          errors.push(`${bw} duplicate board name "${b.name}"`);
        } else {
          seenBoard.add(b.name);
        }
        if (typeof b.description !== 'string') errors.push(`${bw} (${b.name || '?'}) missing description`);
      });
    }
  });

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// CLI — print the seed SQL + the runbook. Guarded so importing this module has no side effects.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('forum-setup.mjs')) {
  const v = validateForums(DEFAULT_FORUMS);
  if (!v.ok) {
    console.error('DEFAULT_FORUMS validation failed:', v.errors);
  } else {
    console.log('# DEFAULT_FORUMS validates.\n');
    console.log('# ---- config.php (env var NAMES only) ----');
    console.log(mybbConfig().php);
    console.log('\n# ---- seed SQL ----');
    console.log(seedSql());
    console.log('\n# ---- setup guide ----');
    console.log(setupGuide());
  }
}

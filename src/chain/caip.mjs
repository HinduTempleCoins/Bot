/**
 * src/chain/caip.mjs — CAIP universal addressing (Chain Agnostic Improvement Proposals).
 *
 * PURE parse/format. No network, no chain client, no I/O. This module turns
 * cross-chain identifiers into structured objects and back, so the rest of the
 * Bot can talk about "an account on a chain" or "an asset on a chain" in one
 * vocabulary — MELEK/Hive/Graphene alongside EVM and Solana.
 *
 * Implements:
 *   - CAIP-2  chainId    : `namespace:reference`            e.g. eip155:1, solana:..., hive:melek
 *   - CAIP-10 accountId  : `chainId:address`                e.g. eip155:1:0xab16...c, hive:melek:hathor
 *   - CAIP-19 assetId    : `chainId/assetNamespace:reference`
 *                          e.g. eip155:1/erc20:0xa0b8..., hive:melek/token:MELEK
 *   - CAIP-25 idea       : session/grant scopes — a set of chains, each with
 *                          allowed methods (see buildScopes / parseScopes).
 *
 * Spec character classes (CAIP-2 / -10 / -19):
 *   namespace      : [-a-z0-9]{3,8}
 *   reference (c2) : [-_a-zA-Z0-9]{1,32}
 *   address (c10)  : [-.%a-zA-Z0-9]{1,128}
 *   assetNamespace : [-a-z0-9]{3,8}
 *   assetReference : [-.%a-zA-Z0-9]{1,128}
 *   tokenId (opt)  : [-.%a-zA-Z0-9]{1,78}
 *
 * Malformed inputs throw a CaipError by default. Pass `{ soft: true }` to any
 * parse function to get `null` back instead of a throw (soft-return).
 */

// ---- error type ------------------------------------------------------------

export class CaipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CaipError';
  }
}

// ---- spec regexes ----------------------------------------------------------

const NAMESPACE_RE = /^[-a-z0-9]{3,8}$/;
const C2_REFERENCE_RE = /^[-_a-zA-Z0-9]{1,32}$/;
const C10_ADDRESS_RE = /^[-.%a-zA-Z0-9]{1,128}$/;
const ASSET_NAMESPACE_RE = /^[-a-z0-9]{3,8}$/;
const ASSET_REFERENCE_RE = /^[-.%a-zA-Z0-9]{1,128}$/;
const TOKEN_ID_RE = /^[-.%a-zA-Z0-9]{1,78}$/;

// EVM (eip155) and the Graphene/Hive-family namespaces we treat specially.
const EVM_NAMESPACE = 'eip155';
const GRAPHENE_NAMESPACES = new Set(['hive', 'steem', 'blurt', 'graphene', 'melek']);

// ---- internal helpers ------------------------------------------------------

function fail(soft, message) {
  if (soft) return null;
  throw new CaipError(message);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

// ---- CAIP-2: chainId -------------------------------------------------------

/**
 * Parse a CAIP-2 chain id string into `{ namespace, reference }`.
 * @param {string} chainId e.g. "eip155:1", "hive:melek"
 * @param {{soft?: boolean}} [opts]
 * @returns {{namespace: string, reference: string} | null}
 */
export function parseChainId(chainId, { soft = false } = {}) {
  if (!isNonEmptyString(chainId)) {
    return fail(soft, `parseChainId: expected non-empty string, got ${typeof chainId}`);
  }
  const idx = chainId.indexOf(':');
  if (idx < 0) {
    return fail(soft, `parseChainId: missing ":" separator in "${chainId}"`);
  }
  const namespace = chainId.slice(0, idx);
  const reference = chainId.slice(idx + 1);
  if (!NAMESPACE_RE.test(namespace)) {
    return fail(soft, `parseChainId: invalid namespace "${namespace}" in "${chainId}"`);
  }
  if (!C2_REFERENCE_RE.test(reference)) {
    return fail(soft, `parseChainId: invalid reference "${reference}" in "${chainId}"`);
  }
  return { namespace, reference };
}

/**
 * Format `{ namespace, reference }` into a CAIP-2 chain id string.
 * Validates each component (throws/soft-returns on malformed).
 * @param {{namespace: string, reference: string}} parts
 * @param {{soft?: boolean}} [opts]
 * @returns {string | null}
 */
export function formatChainId(parts, { soft = false } = {}) {
  if (!parts || typeof parts !== 'object') {
    return fail(soft, 'formatChainId: expected { namespace, reference }');
  }
  const { namespace, reference } = parts;
  if (!isNonEmptyString(namespace) || !NAMESPACE_RE.test(namespace)) {
    return fail(soft, `formatChainId: invalid namespace "${namespace}"`);
  }
  if (!isNonEmptyString(reference) || !C2_REFERENCE_RE.test(reference)) {
    return fail(soft, `formatChainId: invalid reference "${reference}"`);
  }
  return `${namespace}:${reference}`;
}

// ---- CAIP-10: accountId ----------------------------------------------------

/**
 * Parse a CAIP-10 account id into `{ chainId, namespace, reference, address }`.
 * The account id is `chainId:address` where chainId is itself `namespace:reference`.
 * @param {string} accountId e.g. "eip155:1:0xab16...", "hive:melek:hathor"
 * @param {{soft?: boolean}} [opts]
 */
export function parseAccountId(accountId, { soft = false } = {}) {
  if (!isNonEmptyString(accountId)) {
    return fail(soft, `parseAccountId: expected non-empty string, got ${typeof accountId}`);
  }
  // account id has exactly two colons: namespace:reference:address
  const lastIdx = accountId.lastIndexOf(':');
  if (lastIdx < 0) {
    return fail(soft, `parseAccountId: missing ":" separator in "${accountId}"`);
  }
  const chainIdStr = accountId.slice(0, lastIdx);
  const address = accountId.slice(lastIdx + 1);
  const chain = parseChainId(chainIdStr, { soft: true });
  if (!chain) {
    return fail(soft, `parseAccountId: invalid chainId part "${chainIdStr}" in "${accountId}"`);
  }
  if (!C10_ADDRESS_RE.test(address)) {
    return fail(soft, `parseAccountId: invalid address "${address}" in "${accountId}"`);
  }
  return {
    chainId: chainIdStr,
    namespace: chain.namespace,
    reference: chain.reference,
    address,
  };
}

/**
 * Format an account id. Accepts either:
 *   { chainId, address }  — chainId already a CAIP-2 string, or
 *   { namespace, reference, address }
 * @param {{soft?: boolean}} [opts]
 */
export function formatAccountId(parts, { soft = false } = {}) {
  if (!parts || typeof parts !== 'object') {
    return fail(soft, 'formatAccountId: expected an object');
  }
  let { chainId } = parts;
  const { namespace, reference, address } = parts;
  if (!chainId) {
    chainId = formatChainId({ namespace, reference }, { soft: true });
    if (!chainId) {
      return fail(soft, 'formatAccountId: need chainId or { namespace, reference }');
    }
  } else if (!parseChainId(chainId, { soft: true })) {
    return fail(soft, `formatAccountId: invalid chainId "${chainId}"`);
  }
  if (!isNonEmptyString(address) || !C10_ADDRESS_RE.test(address)) {
    return fail(soft, `formatAccountId: invalid address "${address}"`);
  }
  return `${chainId}:${address}`;
}

// ---- CAIP-19: assetId ------------------------------------------------------

/**
 * Parse a CAIP-19 asset id into:
 *   { chainId, namespace, reference, assetNamespace, assetReference, tokenId? }
 * Format: `chainId/assetNamespace:assetReference` with optional `/tokenId`.
 *   e.g. "eip155:1/erc20:0xa0b8..."
 *        "eip155:1/erc721:0xfoo.../1234"
 *        "hive:melek/token:MELEK"
 * @param {{soft?: boolean}} [opts]
 */
export function parseAssetId(assetId, { soft = false } = {}) {
  if (!isNonEmptyString(assetId)) {
    return fail(soft, `parseAssetId: expected non-empty string, got ${typeof assetId}`);
  }
  const firstSlash = assetId.indexOf('/');
  if (firstSlash < 0) {
    return fail(soft, `parseAssetId: missing "/" separator in "${assetId}"`);
  }
  const chainIdStr = assetId.slice(0, firstSlash);
  const rest = assetId.slice(firstSlash + 1);
  const chain = parseChainId(chainIdStr, { soft: true });
  if (!chain) {
    return fail(soft, `parseAssetId: invalid chainId part "${chainIdStr}" in "${assetId}"`);
  }

  // rest = assetNamespace:assetReference[/tokenId]
  let assetPart = rest;
  let tokenId;
  const tokenSlash = rest.indexOf('/');
  if (tokenSlash >= 0) {
    assetPart = rest.slice(0, tokenSlash);
    tokenId = rest.slice(tokenSlash + 1);
    if (!TOKEN_ID_RE.test(tokenId)) {
      return fail(soft, `parseAssetId: invalid tokenId "${tokenId}" in "${assetId}"`);
    }
  }

  const colonIdx = assetPart.indexOf(':');
  if (colonIdx < 0) {
    return fail(soft, `parseAssetId: missing ":" in asset part "${assetPart}"`);
  }
  const assetNamespace = assetPart.slice(0, colonIdx);
  const assetReference = assetPart.slice(colonIdx + 1);
  if (!ASSET_NAMESPACE_RE.test(assetNamespace)) {
    return fail(soft, `parseAssetId: invalid assetNamespace "${assetNamespace}" in "${assetId}"`);
  }
  if (!ASSET_REFERENCE_RE.test(assetReference)) {
    return fail(soft, `parseAssetId: invalid assetReference "${assetReference}" in "${assetId}"`);
  }

  const out = {
    chainId: chainIdStr,
    namespace: chain.namespace,
    reference: chain.reference,
    assetNamespace,
    assetReference,
  };
  if (tokenId !== undefined) out.tokenId = tokenId;
  return out;
}

/**
 * Format an asset id. Accepts either:
 *   { chainId, assetNamespace, assetReference, tokenId? }, or
 *   { namespace, reference, assetNamespace, assetReference, tokenId? }
 * @param {{soft?: boolean}} [opts]
 */
export function formatAssetId(parts, { soft = false } = {}) {
  if (!parts || typeof parts !== 'object') {
    return fail(soft, 'formatAssetId: expected an object');
  }
  let { chainId } = parts;
  const { namespace, reference, assetNamespace, assetReference, tokenId } = parts;
  if (!chainId) {
    chainId = formatChainId({ namespace, reference }, { soft: true });
    if (!chainId) {
      return fail(soft, 'formatAssetId: need chainId or { namespace, reference }');
    }
  } else if (!parseChainId(chainId, { soft: true })) {
    return fail(soft, `formatAssetId: invalid chainId "${chainId}"`);
  }
  if (!isNonEmptyString(assetNamespace) || !ASSET_NAMESPACE_RE.test(assetNamespace)) {
    return fail(soft, `formatAssetId: invalid assetNamespace "${assetNamespace}"`);
  }
  if (!isNonEmptyString(assetReference) || !ASSET_REFERENCE_RE.test(assetReference)) {
    return fail(soft, `formatAssetId: invalid assetReference "${assetReference}"`);
  }
  let out = `${chainId}/${assetNamespace}:${assetReference}`;
  if (tokenId !== undefined && tokenId !== null && tokenId !== '') {
    if (!TOKEN_ID_RE.test(String(tokenId))) {
      return fail(soft, `formatAssetId: invalid tokenId "${tokenId}"`);
    }
    out += `/${tokenId}`;
  }
  return out;
}

// ---- helpers ---------------------------------------------------------------

/**
 * True if the given chainId (CAIP-2 string or parsed parts) is an EVM chain.
 * @param {string | {namespace: string}} chainId
 * @returns {boolean}
 */
export function isEvm(chainId) {
  let ns;
  if (typeof chainId === 'string') {
    const parsed = parseChainId(chainId, { soft: true });
    if (!parsed) return false;
    ns = parsed.namespace;
  } else if (chainId && typeof chainId === 'object') {
    ns = chainId.namespace;
  } else {
    return false;
  }
  return ns === EVM_NAMESPACE;
}

/**
 * True if the given chainId is in the Graphene/Hive family (hive/steem/blurt/melek/graphene).
 * @param {string | {namespace: string}} chainId
 * @returns {boolean}
 */
export function isGraphene(chainId) {
  let ns;
  if (typeof chainId === 'string') {
    const parsed = parseChainId(chainId, { soft: true });
    if (!parsed) return false;
    ns = parsed.namespace;
  } else if (chainId && typeof chainId === 'object') {
    ns = chainId.namespace;
  } else {
    return false;
  }
  return GRAPHENE_NAMESPACES.has(ns);
}

/**
 * Build a CAIP-10 account id for a Hive-family account.
 * Defaults to the MELEK chain (`hive:melek`), since that is the Bot's home chain.
 * Strips a leading "@" if present.
 * @param {string} account e.g. "hathor" or "@hathor"
 * @param {{network?: string}} [opts] network = the CAIP-2 reference (chain instance), default "melek"
 * @returns {string} e.g. "hive:melek:hathor"
 */
export function forHive(account, { network = 'melek' } = {}) {
  if (!isNonEmptyString(account)) {
    throw new CaipError(`forHive: expected non-empty account name, got ${typeof account}`);
  }
  const name = account.startsWith('@') ? account.slice(1) : account;
  return formatAccountId({ namespace: 'hive', reference: network, address: name });
}

// ---- CAIP-25 idea: session / grant scopes ----------------------------------

/**
 * Build a CAIP-25-style scope set: a map of chainId -> { methods, notifications }.
 * This is the "what may a session/grant do, on which chains" descriptor.
 *
 * @param {Array<{chainId: string, methods?: string[], notifications?: string[]}>} entries
 * @param {{soft?: boolean}} [opts]
 * @returns {Record<string, {methods: string[], notifications: string[]}> | null}
 */
export function buildScopes(entries, { soft = false } = {}) {
  if (!Array.isArray(entries)) {
    return fail(soft, 'buildScopes: expected an array of scope entries');
  }
  const scopes = {};
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      return fail(soft, 'buildScopes: each entry must be an object');
    }
    const { chainId, methods = [], notifications = [] } = entry;
    if (!parseChainId(chainId, { soft: true })) {
      return fail(soft, `buildScopes: invalid chainId "${chainId}"`);
    }
    if (!Array.isArray(methods) || !Array.isArray(notifications)) {
      return fail(soft, `buildScopes: methods/notifications must be arrays for "${chainId}"`);
    }
    scopes[chainId] = {
      methods: [...new Set(methods.map(String))],
      notifications: [...new Set(notifications.map(String))],
    };
  }
  return scopes;
}

/**
 * Validate a scope set produced by buildScopes (e.g. round-tripped through JSON).
 * Returns the same shape on success.
 * @param {{soft?: boolean}} [opts]
 */
export function parseScopes(scopes, { soft = false } = {}) {
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) {
    return fail(soft, 'parseScopes: expected a scope-set object');
  }
  const out = {};
  for (const [chainId, scope] of Object.entries(scopes)) {
    if (!parseChainId(chainId, { soft: true })) {
      return fail(soft, `parseScopes: invalid chainId key "${chainId}"`);
    }
    if (!scope || typeof scope !== 'object') {
      return fail(soft, `parseScopes: invalid scope for "${chainId}"`);
    }
    const methods = Array.isArray(scope.methods) ? scope.methods.map(String) : [];
    const notifications = Array.isArray(scope.notifications) ? scope.notifications.map(String) : [];
    out[chainId] = { methods, notifications };
  }
  return out;
}

/**
 * True if a scope set grants `method` on `chainId`.
 * @param {Record<string, {methods: string[]}>} scopes
 * @param {string} chainId
 * @param {string} method
 * @returns {boolean}
 */
export function scopeAllows(scopes, chainId, method) {
  if (!scopes || typeof scopes !== 'object') return false;
  const scope = scopes[chainId];
  if (!scope || !Array.isArray(scope.methods)) return false;
  return scope.methods.includes(method);
}

// ---- CLI -------------------------------------------------------------------

function runCli(argv) {
  const [kind, value] = argv;
  if (!kind || !value) {
    process.stdout.write(
      'usage: node src/chain/caip.mjs <chain|account|asset|hive> <value>\n' +
        'examples:\n' +
        '  node src/chain/caip.mjs chain   eip155:1\n' +
        '  node src/chain/caip.mjs account hive:melek:hathor\n' +
        '  node src/chain/caip.mjs asset   eip155:1/erc20:0xa0b8...\n' +
        '  node src/chain/caip.mjs hive    hathor\n'
    );
    return;
  }
  try {
    let result;
    switch (kind) {
      case 'chain':
        result = { ...parseChainId(value), isEvm: isEvm(value), isGraphene: isGraphene(value) };
        break;
      case 'account':
        result = parseAccountId(value);
        break;
      case 'asset':
        result = parseAssetId(value);
        break;
      case 'hive':
        result = { accountId: forHive(value) };
        break;
      default:
        process.stderr.write(`unknown kind "${kind}"\n`);
        process.exitCode = 1;
        return;
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    process.stderr.write(`${err.name}: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith('caip.mjs')) {
  runCli(process.argv.slice(2));
}

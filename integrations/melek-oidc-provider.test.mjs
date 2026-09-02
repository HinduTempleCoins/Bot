// melek-oidc-provider.test.mjs — offline. `node --test`. Generates a throwaway RSA key; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import {
  signJwt, verifyJwt, discoveryDocument, jwks, validateClient, parseAuthorize,
  issueCode, redeemToken, userinfo, handler, isIdentityOnly, IDENTITY_SCOPES, CAPABILITY_SCOPES,
} from './melek-oidc-provider.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ISS = 'https://signer.melek.salon';
const CLIENTS = [
  { client_id: 'the-store', redirect_uris: ['https://store.soapbox.community/callback'], name: 'SoapBox Store' },
  { client_id: 'conf-app', redirect_uris: ['https://x.example/cb'], client_secret: 's3cret', name: 'Confidential' },
];
const b64u = (b) => Buffer.from(b).toString('base64url');
const s256 = (v) => b64u(createHash('sha256').update(v).digest());
const opts = () => ({ clients: CLIENTS, issuer: ISS, privateKey, publicKey, kid: 'melek-1', now: Date.now() });

test('JWT sign/verify round-trips; tamper + expiry rejected', () => {
  const t = signJwt({ sub: 'hathor', exp: Math.floor(Date.now() / 1000) + 60 }, { privateKey, kid: 'melek-1' });
  assert.equal(verifyJwt(t, { publicKey }).sub, 'hathor');
  assert.equal(verifyJwt(t.slice(0, -3) + 'AAA', { publicKey }), null);           // tampered sig
  const exp = signJwt({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 5 }, { privateKey });
  assert.equal(verifyJwt(exp, { publicKey }), null);                               // expired
});

test('discovery document advertises the required OIDC endpoints + capabilities', () => {
  const d = discoveryDocument(ISS);
  assert.equal(d.issuer, ISS);
  assert.equal(d.authorization_endpoint, `${ISS}/oauth2/authorize`);
  assert.equal(d.token_endpoint, `${ISS}/oauth2/token`);
  assert.equal(d.userinfo_endpoint, `${ISS}/userinfo`);
  assert.equal(d.jwks_uri, `${ISS}/oauth2/jwks`);
  assert.deepEqual(d.response_types_supported, ['code']);
  assert.ok(d.id_token_signing_alg_values_supported.includes('RS256'));
  assert.ok(d.code_challenge_methods_supported.includes('S256'));
  assert.ok(d.scopes_supported.includes('openid'));
});

test('jwks exports the RSA public key with kid/use/alg; verifiable JWKS shape', () => {
  const j = jwks({ publicKey, kid: 'melek-1' });
  assert.equal(j.keys.length, 1);
  assert.equal(j.keys[0].kty, 'RSA');
  assert.equal(j.keys[0].use, 'sig');
  assert.equal(j.keys[0].kid, 'melek-1');
  assert.ok(j.keys[0].n && j.keys[0].e);
  assert.equal(jwks({ publicKey: 'not-a-key' }).keys.length, 0);                   // soft-fail
});

test('parseAuthorize enforces response_type=code, registered redirect_uri, and openid scope', () => {
  const good = parseAuthorize({ response_type: 'code', client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid profile', state: 'n', nonce: 'z', code_challenge: 'abc', code_challenge_method: 'S256' }, CLIENTS);
  assert.equal(good.ok, true);
  assert.equal(parseAuthorize({ response_type: 'token', client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid' }, CLIENTS).error, 'unsupported_response_type');
  assert.equal(parseAuthorize({ response_type: 'code', client_id: 'the-store', redirect_uri: 'https://evil.example/cb', scope: 'openid' }, CLIENTS).error, 'invalid_redirect_uri');
  assert.equal(parseAuthorize({ response_type: 'code', client_id: 'nope', redirect_uri: 'https://x', scope: 'openid' }, CLIENTS).error, 'invalid_client');
  assert.equal(parseAuthorize({ response_type: 'code', client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', scope: 'profile' }, CLIENTS).error, 'invalid_scope');
});

test('full authorization-code + PKCE flow → signed ID token with sub/aud/nonce, verifiable via JWKS key', () => {
  const store = new Map();
  const verifier = b64u(randomBytes(32));
  const { code, redirectTo } = issueCode(store, {
    client_id: 'the-store', account: 'Alice', redirect_uri: 'https://store.soapbox.community/callback',
    scope: 'openid profile', nonce: 'nonce-123', code_challenge: s256(verifier), code_challenge_method: 'S256',
  });
  assert.match(redirectTo, /code=/);
  const r = redeemToken(store, { grant_type: 'authorization_code', code, client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', code_verifier: verifier }, opts());
  assert.equal(r.ok, true);
  assert.equal(r.response.token_type, 'Bearer');
  const claims = verifyJwt(r.response.id_token, { publicKey });
  assert.equal(claims.iss, ISS);
  assert.equal(claims.sub, 'alice');                                               // account = sub, lowercased
  assert.equal(claims.aud, 'the-store');
  assert.equal(claims.nonce, 'nonce-123');
  assert.equal(claims.preferred_username, 'alice');
});

test('authorization code is ONE-TIME (replay rejected) and PKCE mismatch rejected', () => {
  const store = new Map();
  const verifier = b64u(randomBytes(32));
  const mk = () => issueCode(store, { client_id: 'the-store', account: 'bob', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid', code_challenge: s256(verifier), code_challenge_method: 'S256' }).code;
  const c1 = mk();
  assert.equal(redeemToken(store, { grant_type: 'authorization_code', code: c1, client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', code_verifier: verifier }, opts()).ok, true);
  assert.equal(redeemToken(store, { grant_type: 'authorization_code', code: c1, client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', code_verifier: verifier }, opts()).error, 'invalid_grant'); // replay
  const c2 = mk();
  assert.equal(redeemToken(store, { grant_type: 'authorization_code', code: c2, client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', code_verifier: 'WRONG' }, opts()).error, 'invalid_grant'); // PKCE
});

test('confidential client requires its secret', () => {
  const store = new Map();
  const code = issueCode(store, { client_id: 'conf-app', account: 'carol', redirect_uri: 'https://x.example/cb', scope: 'openid' }).code;
  assert.equal(redeemToken(store, { grant_type: 'authorization_code', code, client_id: 'conf-app', redirect_uri: 'https://x.example/cb' }, opts()).error, 'invalid_client');
  const code2 = issueCode(store, { client_id: 'conf-app', account: 'carol', redirect_uri: 'https://x.example/cb', scope: 'openid' }).code;
  assert.equal(redeemToken(store, { grant_type: 'authorization_code', code: code2, client_id: 'conf-app', redirect_uri: 'https://x.example/cb', client_secret: 's3cret' }, opts()).ok, true);
});

test('claimsFor injects profile/email; userinfo verifies the access token and returns them', () => {
  const store = new Map();
  const claimsFor = (acct, scopes) => ({ preferred_username: acct, ...(scopes.includes('email') ? { email: `${acct}@pentecaust.com`, email_verified: true } : {}) });
  const code = issueCode(store, { client_id: 'the-store', account: 'dave', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid email' }).code;
  const r = redeemToken(store, { grant_type: 'authorization_code', code, client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback' }, { ...opts(), claimsFor });
  assert.equal(verifyJwt(r.response.id_token, { publicKey }).email, 'dave@pentecaust.com');
  const ui = userinfo(r.response.access_token, { publicKey, issuer: ISS, claimsFor });
  assert.equal(ui.sub, 'dave');
  assert.equal(ui.email, 'dave@pentecaust.com');
  assert.equal(userinfo('garbage.token.here', { publicKey }), null);
  assert.equal(userinfo(r.response.id_token, { publicKey, issuer: ISS }), null);    // an id_token is NOT an access token (tok!='at')
});

test('MINIMAL PERMISSION: OIDC grants identity only — capability scopes are refused end to end', () => {
  assert.equal(isIdentityOnly('openid profile email'), true);
  assert.equal(isIdentityOnly('openid posting'), false);
  assert.equal(isIdentityOnly('openid transfer'), false);
  assert.equal(isIdentityOnly(''), false);
  for (const cap of CAPABILITY_SCOPES) assert.equal(isIdentityOnly(`openid ${cap}`), false);
  // authorize refuses a capability scope
  assert.equal(parseAuthorize({ response_type: 'code', client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid posting' }, CLIENTS).error, 'invalid_scope');
  // and code issuance refuses it even if the authorize gate were bypassed
  assert.throws(() => issueCode(new Map(), { client_id: 'the-store', account: 'x', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid transfer' }), /minimal permission/);
  // the OIDC access token is aud:userinfo — it carries no chain role, so it can't be used to broadcast
  const store = new Map();
  const code = issueCode(store, { client_id: 'the-store', account: 'ivy', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid' }).code;
  const r = redeemToken(store, { grant_type: 'authorization_code', code, client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback' }, opts());
  const at = verifyJwt(r.response.access_token, { publicKey });
  assert.equal(at.aud, 'userinfo');
  assert.equal(at.role, undefined);                 // no posting/active role granted through OIDC
});

test('handler serves discovery, jwks, token (POST), userinfo; 404 else', async () => {
  const store = new Map();
  const code = issueCode(store, { client_id: 'the-store', account: 'erin', redirect_uri: 'https://store.soapbox.community/callback', scope: 'openid' }).code;
  const H = { ...opts(), store };
  function fakeRes() { return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; } }; }
  // discovery
  let res = fakeRes(); await handler({ method: 'GET', url: '/.well-known/openid-configuration', headers: { host: 'signer.melek.salon' } }, res, H);
  assert.equal(res.code, 200); assert.match(res.body, /authorization_endpoint/);
  // jwks
  res = fakeRes(); await handler({ method: 'GET', url: '/oauth2/jwks', headers: {} }, res, H);
  assert.equal(res.code, 200); assert.match(res.body, /"kty":"RSA"/);
  // token (form-encoded POST as OIDC clients send)
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'the-store', redirect_uri: 'https://store.soapbox.community/callback' }).toString();
  async function* bodyGen() { yield Buffer.from(form); }
  const tokReq = Object.assign(bodyGen(), { method: 'POST', url: '/oauth2/token', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  res = fakeRes(); await handler(tokReq, res, H);
  assert.equal(res.code, 200); const tokJson = JSON.parse(res.body); assert.ok(tokJson.id_token && tokJson.access_token);
  // userinfo with the bearer
  res = fakeRes(); await handler({ method: 'GET', url: '/userinfo', headers: { authorization: `Bearer ${tokJson.access_token}` } }, res, H);
  assert.equal(res.code, 200); assert.match(res.body, /"sub":"erin"/);
  // 404
  res = fakeRes(); await handler({ method: 'GET', url: '/nope', headers: {} }, res, H);
  assert.equal(res.code, 404);
});

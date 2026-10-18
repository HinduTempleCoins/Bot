import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handler, parseMultipart, sniffImage, extractImageBytes, __setFetch } from './server.mjs';
import { verifyDigest, imageChallengeDigest, parseSignature, parsePublicKey, IMAGE_CHALLENGE_PREFIX } from './graphene-sig.mjs';

// test store lives beside the test (never the system temp dir), removed at the end
const HERE = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(HERE, '.test-store'), { recursive: true });
const STORE = fs.mkdtempSync(path.join(HERE, '.test-store', 'imghost-'));
process.on('exit', () => { try { fs.rmSync(path.join(HERE, '.test-store'), { recursive: true, force: true }); } catch { /* ignore */ } });
const BASE = 'https://img.test';

// ── a throwaway secp256k1 key (generated per run — not any account's key) ──
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
    let n = BigInt('0x' + buf.toString('hex')), out = '';
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of buf) { if (b === 0) out = '1' + out; else break; }
    return out;
}
const { privateKey: KEY, publicKey: PUBKEY } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
const jwk = PUBKEY.export({ format: 'jwk' });
const X = Buffer.from(jwk.x, 'base64url'), Y = Buffer.from(jwk.y, 'base64url');
const PUB33 = Buffer.concat([Buffer.from([Y[31] & 1 ? 3 : 2]), X]);
const PUB_STR = 'MELEK' + b58encode(Buffer.concat([PUB33, crypto.createHash('ripemd160').update(PUB33).digest().subarray(0, 4)]));
/** Sign the upload challenge the way the condenser does: compact [31][r][s] over sha256(prefix||bytes). */
function signUpload(bytes, key = KEY) {
    const rs = crypto.sign('sha256', Buffer.concat([IMAGE_CHALLENGE_PREFIX, bytes]), { key, dsaEncoding: 'ieee-p1363' });
    return '1f' + rs.toString('hex');
}
// chain stub: database_api.find_accounts → the account with PUB_STR as its posting key
let rpcCalls = 0;
function chainWith(accounts) {
    return async (_url, init) => {
        rpcCalls++;
        const body = JSON.parse(init.body);
        const name = body.params.accounts[0];
        const a = accounts[name];
        return { json: async () => ({ result: { accounts: a ? [{ name, ...a }] : [] } }) };
    };
}
const ACCOUNTS = { mlktest: { posting: { key_auths: [[PUB_STR, 1]] }, active: { key_auths: [] } } };
__setFetch(chainWith(ACCOUNTS));

// smallest valid-ish PNG header + IHDR (enough for magic-byte sniff)
const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 7),
]);

function multipartFile(fieldName, filename, contentType, data, boundary) {
    return Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
}

function mockReq(method, url, headers, body) {
    const r = body != null ? Readable.from([body]) : Readable.from([]);
    r.method = method;
    r.url = url;
    r.headers = headers || {};
    r.destroy = () => {};
    return r;
}

function mockRes() {
    return {
        statusCode: 0,
        headers: null,
        body: Buffer.alloc(0),
        writeHead(code, hdrs) { this.statusCode = code; this.headers = hdrs; },
        end(chunk) { if (chunk) this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); this.ended = true; },
    };
}

test('sniffImage recognizes PNG and rejects junk', () => {
    assert.equal(sniffImage(PNG).ext, 'png');
    assert.equal(sniffImage(Buffer.alloc(20, 0)), null);
});

test('parseMultipart + extractImageBytes recover the file bytes', () => {
    const bnd = 'X1Y2Z3';
    const body = multipartFile('file', 'pic.png', 'image/png', PNG, bnd);
    const parsed = parseMultipart(body, bnd);
    assert.ok(parsed.files.file, 'file part present');
    assert.deepEqual(extractImageBytes(parsed), PNG);
});

test('POST upload stores image and returns a URL, then GET serves it', async () => {
    const bnd = 'BoUnDaRy42';
    const body = multipartFile('file', 'pic.png', 'image/png', PNG, bnd);
    const req = mockReq('POST', '/mlktest/' + signUpload(PNG), { 'content-type': `multipart/form-data; boundary=${bnd}` }, body);
    const res = mockRes();
    await handler(req, res, { storeDir: STORE, baseUrl: BASE });
    const out = JSON.parse(res.body.toString());
    assert.ok(out.url && out.url.startsWith(BASE + '/'), `got url: ${out.url || out.error}`);
    const name = out.url.split('/').pop();
    assert.match(name, /^[a-f0-9]{40}\.png$/);
    assert.ok(fs.existsSync(path.join(STORE, name)), 'file written to store');

    // GET it back
    const gReq = mockReq('GET', '/' + name, {});
    const gRes = mockRes();
    await handler(gReq, gRes, { storeDir: STORE, baseUrl: BASE });
    assert.equal(gRes.statusCode, 200);
    assert.equal(gRes.headers['content-type'], 'image/png');
    assert.deepEqual(gRes.body, PNG);
});

test('paste path (filename + filebase64 fields) also works', async () => {
    const bnd = 'PasteBnd';
    const body = Buffer.concat([
        Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="filename"\r\n\r\npic.png\r\n`),
        Buffer.from(`--${bnd}\r\nContent-Disposition: form-data; name="filebase64"\r\n\r\n`),
        Buffer.from(PNG.toString('base64')),
        Buffer.from(`\r\n--${bnd}--\r\n`),
    ]);
    const req = mockReq('POST', '/mlktest/' + signUpload(PNG), { 'content-type': `multipart/form-data; boundary=${bnd}` }, body);
    const res = mockRes();
    await handler(req, res, { storeDir: STORE, baseUrl: BASE });
    const out = JSON.parse(res.body.toString());
    assert.ok(out.url, `paste upload url: ${out.url || out.error}`);
});

test('non-image is refused', async () => {
    const bnd = 'JunkBnd';
    const junk = Buffer.from('this is definitely not an image, just text bytes here ok');
    const body = multipartFile('file', 'notes.txt', 'text/plain', junk, bnd);
    const req = mockReq('POST', '/mlktest/' + signUpload(junk), { 'content-type': `multipart/form-data; boundary=${bnd}` }, body);
    const res = mockRes();
    await handler(req, res, { storeDir: STORE, baseUrl: BASE });
    const out = JSON.parse(res.body.toString());
    assert.match(out.error || '', /unsupported/i);
});

test('health endpoint responds', async () => {
    const req = mockReq('GET', '/health', {});
    const res = mockRes();
    await handler(req, res, { storeDir: STORE, baseUrl: BASE });
    const out = JSON.parse(res.body.toString());
    assert.equal(out.ok, true);
});

test('unknown GET name 404s', async () => {
    const req = mockReq('GET', '/not-a-hash.png', {});
    const res = mockRes();
    await handler(req, res, { storeDir: STORE, baseUrl: BASE });
    assert.equal(res.statusCode, 404);
});

// ── signature handling ──────────────────────────────────────────────────────────────────────────

test('graphene-sig: parses the key and verifies a good signature, rejects a tampered one', () => {
    assert.ok(parsePublicKey(PUB_STR), 'public key parses');
    assert.equal(parsePublicKey(PUB_STR.slice(0, -1) + (PUB_STR.endsWith('a') ? 'b' : 'a')), null, 'bad checksum rejected');
    const sig = signUpload(PNG);
    assert.ok(parseSignature(sig));
    assert.equal(verifyDigest(imageChallengeDigest(PNG), sig, PUB_STR), true);
    const other = Buffer.concat([PNG, Buffer.from([1])]);
    assert.equal(verifyDigest(imageChallengeDigest(other), sig, PUB_STR), false, 'different bytes');
    assert.equal(verifyDigest(imageChallengeDigest(PNG), sig.slice(0, -2) + '00', PUB_STR), false, 'tampered sig');
    assert.equal(verifyDigest(imageChallengeDigest(PNG), 'zz', PUB_STR), false);
});

// Fixture signed IN A BROWSER by dsteem 0.11.1 (the same compact format as the condenser's
// Signature.signBufferSha256(...).toHex()), with a throwaway key from PrivateKey.fromSeed('melek-avatar-test-seed').
import { DSTEEM_FIXTURE } from './graphene-sig.fixture.mjs';
test('graphene-sig: verifies a signature produced by dsteem in a real browser', () => {
    const bytes = Buffer.from(DSTEEM_FIXTURE.dataHex, 'hex');
    assert.equal(verifyDigest(imageChallengeDigest(bytes), DSTEEM_FIXTURE.sig, DSTEEM_FIXTURE.pub), true);
    assert.equal(verifyDigest(imageChallengeDigest(Buffer.from('x')), DSTEEM_FIXTURE.sig, DSTEEM_FIXTURE.pub), false);
});

async function upload(user, sig, data = PNG) {
    const bnd = 'SigBnd';
    const req = mockReq('POST', `/${user}/${sig}`, { 'content-type': `multipart/form-data; boundary=${bnd}` },
        multipartFile('file', 'pic.png', 'image/png', data, bnd));
    const res = mockRes();
    await handler(req, res, { storeDir: STORE, baseUrl: BASE });
    return JSON.parse(res.body.toString());
}

test('upload is refused when the signature is from a different key', async () => {
    const { privateKey: stranger } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const out = await upload('mlktest', signUpload(PNG, stranger));
    assert.match(out.error || '', /does not match @mlktest/);
});

test('upload is refused for a signature over other bytes, a malformed sig, or an unknown account', async () => {
    assert.match((await upload('mlktest', signUpload(Buffer.from('other bytes, other image')))).error || '', /does not match/);
    assert.match((await upload('mlktest', 'deadbeef')).error || '', /malformed/);
    assert.match((await upload('nobody', signUpload(PNG))).error || '', /could not look up/);
});

test('upload is refused (not waved through) when the chain is unreachable', async () => {
    __setFetch(async () => { throw new Error('ECONNREFUSED'); });
    try {
        assert.match((await upload('mlktest', signUpload(PNG))).error || '', /could not look up/);
    } finally { __setFetch(chainWith(ACCOUNTS)); }
});

test('an active-key signature is accepted too', async () => {
    const { privateKey: k2, publicKey: p2 } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const j = p2.export({ format: 'jwk' });
    const x = Buffer.from(j.x, 'base64url'), y = Buffer.from(j.y, 'base64url');
    const pub = Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), x]);
    const str = 'MELEK' + b58encode(Buffer.concat([pub, crypto.createHash('ripemd160').update(pub).digest().subarray(0, 4)]));
    __setFetch(chainWith({ mlktest: { posting: { key_auths: [[PUB_STR, 1]] }, active: { key_auths: [[str, 1]] } } }));
    try {
        assert.ok((await upload('mlktest', signUpload(PNG, k2))).url);
    } finally { __setFetch(chainWith(ACCOUNTS)); }
});

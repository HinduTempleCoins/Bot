import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handler, parseMultipart, sniffImage, extractImageBytes } from './server.mjs';

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'imghost-'));
const BASE = 'https://img.test';

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
    const req = mockReq('POST', '/mlktest/deadbeefsig', { 'content-type': `multipart/form-data; boundary=${bnd}` }, body);
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
    const req = mockReq('POST', '/mlktest/sig', { 'content-type': `multipart/form-data; boundary=${bnd}` }, body);
    const res = mockRes();
    await handler(req, res, { storeDir: STORE, baseUrl: BASE });
    const out = JSON.parse(res.body.toString());
    assert.ok(out.url, `paste upload url: ${out.url || out.error}`);
});

test('non-image is refused', async () => {
    const bnd = 'JunkBnd';
    const junk = Buffer.from('this is definitely not an image, just text bytes here ok');
    const body = multipartFile('file', 'notes.txt', 'text/plain', junk, bnd);
    const req = mockReq('POST', '/u/sig', { 'content-type': `multipart/form-data; boundary=${bnd}` }, body);
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

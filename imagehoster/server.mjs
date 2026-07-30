// MELEK image hoster — the off-chain media host for the condenser.
//
// Graphene posts cannot hold image blobs; the condenser uploads the image here,
// gets back a URL, and puts that URL in the post body. Contract (from the Blurt
// condenser UserSaga.uploadImage):
//   POST  {upload_image}/{username}/{sig}
//     body = multipart/form-data, either a `file` part (drag/drop) or
//            `filename` + `filebase64` fields (paste/preview).
//     -> 200 {"url": "https://img.melek.salon/<hash>.<ext>"}  on success
//     -> 200 {"error": "..."}                                  on refusal
//   GET   /<hash>.<ext>   -> the stored image (immutable, long cache)
//   GET   /  or /health   -> liveness JSON
//
// House style: ESM, handler(req,res) exported for tests, CLI guarded by
// process.argv[1], PORT/BASE_URL/STORE_DIR from env, soft-fail (never throw out
// of the handler). Zero external deps — multipart is parsed in-process.
//
// NOTE (follow-up, tracked): this v1 does not cryptographically verify the
// Graphene posting-key signature in the URL (that needs the secp256k1/base58
// recover stack). Abuse is bounded instead by: image-only magic-byte sniff,
// a hard size cap, and content-hash dedup. Real sig-verify can be layered on
// later without changing the wire contract.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.IMGHOST_PORT || process.env.PORT || 8145);
const BASE_URL = (process.env.IMGHOST_BASE_URL || 'https://img.melek.salon').replace(/\/+$/, '');
const STORE_DIR = process.env.IMGHOST_STORE_DIR || '/opt/melek-imagehoster/uploads';
const MAX_BYTES = Number(process.env.IMGHOST_MAX_BYTES || 12 * 1024 * 1024); // 12 MB

// image magic-byte sniff -> extension + content-type (image formats only)
const SNIFFERS = [
    { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: 'png', type: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
    { ext: 'gif', type: 'image/gif', test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
    {
        ext: 'webp', type: 'image/webp',
        test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
    },
    {
        ext: 'bmp', type: 'image/bmp',
        test: (b) => b[0] === 0x42 && b[1] === 0x4d,
    },
];

export function sniffImage(buf) {
    if (!buf || buf.length < 12) return null;
    for (const s of SNIFFERS) {
        try {
            if (s.test(buf)) return { ext: s.ext, type: s.type };
        } catch {
            /* soft-fail: a bad sniffer never breaks the upload */
        }
    }
    return null;
}

// Minimal multipart/form-data parser. Returns { fields:{name:string}, files:{name:{filename,contentType,data:Buffer}} }.
export function parseMultipart(buffer, boundary) {
    const out = { fields: {}, files: {} };
    if (!buffer || !boundary) return out;
    const delim = Buffer.from(`--${boundary}`);
    // Split the body on the boundary marker.
    const parts = [];
    let start = buffer.indexOf(delim);
    if (start === -1) return out;
    start += delim.length;
    while (start < buffer.length) {
        const next = buffer.indexOf(delim, start);
        if (next === -1) break;
        // segment is between the CRLF after this boundary and the CRLF before the next
        let seg = buffer.subarray(start, next);
        // strip leading CRLF and trailing CRLF
        if (seg[0] === 0x0d && seg[1] === 0x0a) seg = seg.subarray(2);
        if (seg[seg.length - 2] === 0x0d && seg[seg.length - 1] === 0x0a) seg = seg.subarray(0, seg.length - 2);
        if (seg.length) parts.push(seg);
        start = next + delim.length;
    }
    for (const seg of parts) {
        const headEnd = seg.indexOf('\r\n\r\n');
        if (headEnd === -1) continue;
        const headers = seg.subarray(0, headEnd).toString('utf8');
        const body = seg.subarray(headEnd + 4);
        const nameM = /name="([^"]*)"/i.exec(headers);
        if (!nameM) continue;
        const name = nameM[1];
        const fileM = /filename="([^"]*)"/i.exec(headers);
        const typeM = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
        if (fileM) {
            out.files[name] = {
                filename: fileM[1],
                contentType: typeM ? typeM[1].trim() : 'application/octet-stream',
                data: Buffer.from(body),
            };
        } else {
            out.fields[name] = body.toString('utf8');
        }
    }
    return out;
}

function readBody(req, limit) {
    return new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        let done = false;
        const finish = (buf) => { if (!done) { done = true; resolve(buf); } };
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { finish(null); req.destroy(); return; } // over cap -> null
            chunks.push(c);
        });
        req.on('end', () => finish(Buffer.concat(chunks)));
        req.on('error', () => finish(null));
    });
}

function json(res, obj, status = 200) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
    });
    res.end(body);
}

// Extract the image bytes from a parsed multipart body (either path the condenser uses).
export function extractImageBytes(parsed) {
    // drag/drop: a real file part named `file`
    for (const k of Object.keys(parsed.files)) {
        if (parsed.files[k].data && parsed.files[k].data.length) return parsed.files[k].data;
    }
    // paste/preview: fields filename + filebase64
    if (parsed.fields.filebase64) {
        try {
            return Buffer.from(parsed.fields.filebase64, 'base64');
        } catch {
            return null;
        }
    }
    return null;
}

async function handleUpload(req, res, storeDir, baseUrl) {
    const ct = req.headers['content-type'] || '';
    const bM = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
    if (!/multipart\/form-data/i.test(ct) || !bM) {
        return json(res, { error: 'expected multipart/form-data' });
    }
    const boundary = (bM[1] || bM[2] || '').trim();
    const raw = await readBody(req, MAX_BYTES + 64 * 1024); // room for multipart envelope
    if (!raw) return json(res, { error: `image too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB)` });

    const parsed = parseMultipart(raw, boundary);
    const bytes = extractImageBytes(parsed);
    if (!bytes || !bytes.length) return json(res, { error: 'no image data received' });
    if (bytes.length > MAX_BYTES) return json(res, { error: `image too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB)` });

    const kind = sniffImage(bytes);
    if (!kind) return json(res, { error: 'unsupported file type (images only: jpg/png/gif/webp/bmp)' });

    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 40);
    const name = `${hash}.${kind.ext}`;
    const dest = path.join(storeDir, name);
    try {
        fs.mkdirSync(storeDir, { recursive: true });
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, bytes); // content-addressed => dedup
    } catch (e) {
        return json(res, { error: 'storage error' });
    }
    return json(res, { url: `${baseUrl}/${name}` });
}

function handleGet(req, res, storeDir, name) {
    // name is a single path segment we control the shape of
    if (!/^[a-f0-9]{40}\.(jpg|png|gif|webp|bmp)$/.test(name)) {
        return json(res, { error: 'not found' }, 404);
    }
    const kind = SNIFFERS.find((s) => name.endsWith(`.${s.ext}`));
    const file = path.join(storeDir, name);
    return new Promise((resolve) => {
        fs.readFile(file, (err, buf) => {
            if (err) { json(res, { error: 'not found' }, 404); return resolve(); }
            res.writeHead(200, {
                'content-type': kind ? kind.type : 'application/octet-stream',
                'cache-control': 'public, max-age=31536000, immutable',
                'access-control-allow-origin': '*',
            });
            res.end(buf);
            resolve();
        });
    });
}

// handler(req,res) — exported for tests and for embedding. storeDir/baseUrl injectable.
export async function handler(req, res, opts = {}) {
    const storeDir = opts.storeDir || STORE_DIR;
    const baseUrl = (opts.baseUrl || BASE_URL).replace(/\/+$/, '');
    try {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'GET, POST, OPTIONS',
                'access-control-allow-headers': 'content-type',
            });
            return res.end();
        }
        const url = new URL(req.url, 'http://localhost');
        const segs = url.pathname.split('/').filter(Boolean);

        if (req.method === 'GET' && (segs.length === 0 || segs[0] === 'health')) {
            return json(res, { service: 'melek-imagehoster', ok: true, base_url: baseUrl });
        }
        // GET /<hash>.<ext>
        if (req.method === 'GET' && segs.length === 1) {
            return await handleGet(req, res, storeDir, segs[0]);
        }
        // POST /<username>/<sig>
        if (req.method === 'POST' && segs.length >= 1) {
            return await handleUpload(req, res, storeDir, baseUrl);
        }
        return json(res, { error: 'not found' }, 404);
    } catch (e) {
        // soft-fail: never throw out of the handler
        try { return json(res, { error: 'internal error' }, 500); } catch { /* res already gone */ }
    }
}

// CLI: run the server only when invoked directly.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    http.createServer((req, res) => handler(req, res)).listen(PORT, '127.0.0.1', () => {
        console.log(`[melek-imagehoster] listening on 127.0.0.1:${PORT} store=${STORE_DIR} base=${BASE_URL}`);
    });
}

// condenser-beacon-proxy.mjs — a tiny, surgical reverse proxy in front of the LOCAL MELEK condenser
// (melek-condenser-mainnet.service, 127.0.0.1:8087) that serves melek.salon via Caddy. A second instance
// (UPSTREAM_PORT=8088) fronts the wallet (wallet.melek.salon) the same way.
//
// Deployed from the repo checkout (deploy/condenser/): it imports integrations/soapbox/page-meta.mjs.
//
// It does exactly three things to text/html responses and NOTHING else:
//   1. Removes the Google Analytics gtag script(s) baked into the server-only SSR <head> shell
//      (any <script ...G-63ZBEY1EVG...></script>). The GA id lives only in that server-only shell;
//      it is NOT in the browser bundles and the client JsPlugins gtag is gated off (google_analytics_id=false),
//      so removing it here fully removes Google with no client re-injection.
//   2. Injects our first-party, cookieless pageview beacon before </head> if not already present.
//   3. Fills in missing link-preview tags (og:/twitter:) from the page's own title/description/canonical,
//      with the MELEK share card when the page has no image (page-meta.mjs ensureSocialMeta).
//
// Everything else (RPC, images, JS/CSS, POSTs, logins, redirects, set-cookie, status codes, non-HTML)
// is piped through BYTE-FOR-BYTE untouched. HTML is the only transformed content-type.
//
// It forwards to the upstream with Accept-Encoding stripped (identity) so it never has to guess at
// compression; Caddy re-applies `encode gzip` to the client. Native-only: no deps, no external calls.
import http from 'node:http';
import zlib from 'node:zlib';
import { ensureBeacon, ensureSocialMeta, cardForHost } from '../../integrations/soapbox/page-meta.mjs';

const UPSTREAM_HOST = process.env.UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = +(process.env.UPSTREAM_PORT || 8087);
const LISTEN_PORT = +(process.env.LISTEN_PORT || 8188);
const LISTEN_HOST = process.env.LISTEN_HOST || '127.0.0.1';
// 'off' for an upstream whose CSP forbids inline script (the wallet counts pageviews from its extras script).
const BEACON_URL = process.env.ANALYTICS_BEACON_URL === 'off' ? '' : (process.env.ANALYTICS_BEACON_URL || 'https://analytics.soapbox.community/px');

// Remove any <script> element whose attributes/inline carry the GA property id.
const GTAG_RE = /<script\b[^>]*G-63ZBEY1EVG[^>]*><\/script>/g;

export function transformHtml(html, host = '', reqPath = '') {
  let out = html.replace(GTAG_RE, '');
  // The condenser sets a canonical only on posts; every other page (feeds, profiles, the wallet) gets
  // its own path, query dropped, so sorted/filtered variants fold into one URL.
  const path = String(reqPath || '').split(/[?#]/)[0];
  const self = host && path && /^[a-z0-9.-]+$/i.test(host) ? `https://${host.toLowerCase()}${path}` : '';
  if (self && out.includes('</head>') && !/<link\b[^>]*\brel\s*=\s*["']?canonical/i.test(out.split('</head>')[0])) {
    out = out.replace('</head>', `<link rel="canonical" href="${self.replace(/"/g, '%22').replace(/</g, '%3C')}"></head>`);
  }
  out = ensureSocialMeta(out, { card: cardForHost(host), url: self });
  if (BEACON_URL) out = ensureBeacon(out, BEACON_URL);
  return out;
}

function decompress(buf, enc) {
  try {
    if (enc === 'gzip') return zlib.gunzipSync(buf);
    if (enc === 'deflate') return zlib.inflateSync(buf);
    if (enc === 'br') return zlib.brotliDecompressSync(buf);
  } catch { /* fall through to raw */ }
  return buf;
}

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  // force identity upstream so we always see plaintext HTML; Caddy re-compresses to the client
  headers['accept-encoding'] = 'identity';
  delete headers['if-none-match'];      // avoid 304s that would bypass our transform
  delete headers['if-modified-since'];

  const up = http.request({
    host: UPSTREAM_HOST, port: UPSTREAM_PORT,
    method: req.method, path: req.url, headers,
  }, (ur) => {
    const ct = String(ur.headers['content-type'] || '');
    const isHtml = /text\/html/i.test(ct);
    if (!isHtml) {
      // pipe everything non-HTML through untouched, preserving status + all headers (incl. set-cookie)
      res.writeHead(ur.statusCode || 502, ur.headers);
      ur.pipe(res);
      return;
    }
    const chunks = [];
    ur.on('data', (c) => chunks.push(c));
    ur.on('end', () => {
      let body = Buffer.concat(chunks);
      const enc = String(ur.headers['content-encoding'] || '').toLowerCase();
      if (enc) body = decompress(body, enc);
      let str;
      try { str = body.toString('utf8'); } catch { str = null; }
      const outHeaders = { ...ur.headers };
      if (str != null) {
        const transformed = transformHtml(str, String(req.headers.host || '').split(':')[0], req.url);
        body = Buffer.from(transformed, 'utf8');
      }
      delete outHeaders['content-encoding'];   // we send identity
      delete outHeaders['transfer-encoding'];
      outHeaders['content-length'] = Buffer.byteLength(body);
      res.writeHead(ur.statusCode || 200, outHeaders);
      res.end(body);
    });
    ur.on('error', () => { try { if (!res.headersSent) res.writeHead(502); res.end(); } catch { /* noop */ } });
  });
  up.on('error', () => { try { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('upstream error'); } catch { /* noop */ } });
  req.pipe(up);
});

server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* noop */ } });
if (process.argv[1] && process.argv[1].endsWith('condenser-beacon-proxy.mjs')) server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[beacon-proxy] ${LISTEN_HOST}:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}  beacon=${BEACON_URL}`);
});

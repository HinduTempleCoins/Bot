// server.mjs — MELEK account recovery: REDIRECT ONLY.
//
// Operator decision: account recovery for MELEK runs through MELEK-Signer's own recovery options, and
// is optional. There is no separate recovery system here. Every path on this service (and every
// "recover account" link in the ecosystem) points to the MELEK-Signer recovery guide, carrying an
// optional ?account= through. /health stays a liveness probe.
//
//   PORT=8127 node site/recovery/server.mjs
//
// House pattern: handler(req,res) exported for tests, never throws, CLI guarded by process.argv[1].

import http from 'node:http';

const PORT = +(process.env.PORT || 8127);
const HOST = process.env.HOST || '0.0.0.0';

/** The single recovery destination. */
export const RECOVER_URL = 'https://signer.melek.salon/recover';

/** Build the redirect target, passing through a sanitized ?account=. */
export function recoverTarget(account) {
  const a = String(account == null ? '' : account).trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9.-]/g, '').slice(0, 16);
  return a ? `${RECOVER_URL}?account=${encodeURIComponent(a)}` : RECOVER_URL;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://recovery.local');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    res.writeHead(301, { location: recoverTarget(url.searchParams.get('account')) });
    return res.end();
  } catch {
    res.writeHead(301, { location: RECOVER_URL });
    return res.end();
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/recovery\//.test(process.argv[1])) {
  http.createServer(handler).listen(PORT, HOST, () => {
    console.log(`MELEK recovery redirect → ${RECOVER_URL} (bound ${HOST}:${PORT})`);
  });
}

// beacon.mjs — THE ONE LINE THAT MAKES THE NETWORK MEASURABLE.
//
// site/analytics/server.mjs has been a complete, privacy-clean collector for a while — POST /px,
// a JSONL store, a token-gated rollup. It measured nothing, because NOT ONE of the 105 site servers
// emitted a beacon. The collector was built and never fed.
//
// This module is the missing half: a single tag, injected before </head> on every surface, so the
// question "which of our properties actually gets traffic" has an answer that is a number instead of
// an inference. That question is load-bearing twice over — you cannot sell ad inventory you cannot
// measure, and you cannot raise money on a footprint you can only describe.
//
// WHAT IT SENDS: the path and the referrer host. Nothing else. No cookie, no localStorage, no ID, no
// fingerprint. The collector derives a daily-rotating visitor hash server-side and discards the inputs,
// so the same person is not linkable across two days by construction. DNT is honoured at the collector.
//
// WHY A SEPARATE HOST: first-party to the network, third-party to the page, which is the only way one
// rollup can span ~100 domains. It is our own box, not an ad-tech vendor, so there is no data sale and
// no consent banner to argue about.
//
// The <noscript> img is not decoration: a meaningful share of crawler-adjacent and privacy-hardened
// traffic never runs the script, and without the pixel those visits are invisible to us and visible to
// nobody else either.

const DEFAULT_BASE = 'https://analytics.soapbox.community';

/** The tag, as a plain string. Double quotes only, so it can be spliced into any HTML template. */
export const BEACON_TAG =
  `<script defer src="${DEFAULT_BASE}/b.js"></script>`
  + `<noscript><img src="${DEFAULT_BASE}/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript>`;

/** Same tag against a different collector (staging, or a per-network split). */
export function beaconTag(base = DEFAULT_BASE) {
  const b = String(base || DEFAULT_BASE).replace(/\/+$/, '');
  return `<script defer src="${b}/b.js"></script>`
    + `<noscript><img src="${b}/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript>`;
}

/**
 * The client script the collector serves at /b.js. Kept HERE rather than in the server so the thing
 * that is injected and the thing that is served are edited in one place and cannot drift apart.
 *
 * ⚠️ THE CONTENT TYPE IS LOAD-BEARING AND IT MUST BE text/plain.
 * sendBeacon dispatches in no-cors mode, which permits ONLY the CORS-safelisted content types:
 * text/plain, application/x-www-form-urlencoded, multipart/form-data. A Blob typed
 * application/json is rejected by the browser BEFORE the request leaves — the server's CORS
 * headers never come into it. This cost the whole network its analytics once; curl cannot see it,
 * only a real browser can. The body is still JSON; only the declared type changed, and the
 * collector parses the body regardless of content-type.
 *
 * sendBeacon is used first because it survives page unload, which a fetch does not. The fetch keepalive
 * fallback exists for browsers where sendBeacon is disabled. Both are wrapped: a beacon that throws on
 * a page is a bug the page owner did not ask for.
 */
export const BEACON_JS = `(function(){try{
var b=${JSON.stringify(DEFAULT_BASE)};
var d=JSON.stringify({p:location.pathname+location.search,r:document.referrer||""});
if(navigator.sendBeacon){if(navigator.sendBeacon(b+"/px",new Blob([d],{type:"text/plain;charset=UTF-8"})))return;}
fetch(b+"/px",{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:d,keepalive:true,mode:"no-cors"}).catch(function(){});
}catch(e){}})();`;

export const BEACON_BASE = DEFAULT_BASE;

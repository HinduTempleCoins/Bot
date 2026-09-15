// tv-remote.mjs — CONTROLLING A TV WITH NO REMOTE, over the local network.
//
// The problem is ordinary and the answer is uneven: of the major TV platforms, exactly ONE exposes an
// open, unauthenticated control API, and the rest require a vendor app or a pairing handshake. This
// module encodes that honestly rather than pretending one recipe covers all of them.
//
// ⭐ ROKU — ECP (External Control Protocol). Plain HTTP on port 8060. No pairing, no token, no account.
//    POST /keypress/<KEY>   presses a button
//    POST /launch/<appId>   opens a channel
//    GET  /query/apps       lists installed channels WITH their real IDs
//    This is why the page works at all, and why it is Roku-first.
//
// ⚠️ THE CONSTRAINT THAT DECIDES THE ARCHITECTURE: the TV is on a private LAN, so a server on a VPS
// can never reach it. The REQUEST MUST COME FROM THE BROWSER, because the browser is the thing sitting
// on the same Wi-Fi. So control is done with `fetch(..., {mode:'no-cors'})` from the page itself —
// fire-and-forget, which is all a keypress needs.
//
// ⚠️ AND THE LIMIT OF THAT: no-cors can SEND but cannot READ. Roku's ECP does not send CORS headers,
// so `/query/apps` is unreadable from a browser and the real channel-ID list cannot be fetched. Hence
// CHANNELS below — a small hardcoded fallback, every entry marked with how confident we are, because a
// wrong channel ID silently launches nothing and looks like a broken app.
//
// Pure data + pure helpers. No network here; the page does the talking.

/** Roku ECP keys that matter for "get to a streaming app from a cold TV". */
export const KEYS = Object.freeze([
  { key: 'PowerOn', label: 'Power on', note: 'Wakes the TV. Roku TVs only — a Roku STICK has no TV power control, use HDMI-CEC or the TV buttons.' },
  { key: 'PowerOff', label: 'Power off' },
  { key: 'Home', label: 'Home', note: 'The reliable escape hatch when you cannot see what is selected.' },
  { key: 'Up', label: 'Up' },
  { key: 'Down', label: 'Down' },
  { key: 'Left', label: 'Left' },
  { key: 'Right', label: 'Right' },
  { key: 'Select', label: 'OK' },
  { key: 'Back', label: 'Back' },
  { key: 'Play', label: 'Play / Pause' },
  { key: 'Rev', label: 'Rewind' },
  { key: 'Fwd', label: 'Fast forward' },
  { key: 'VolumeUp', label: 'Volume +' },
  { key: 'VolumeDown', label: 'Volume −' },
  { key: 'VolumeMute', label: 'Mute' },
  { key: 'InputHDMI1', label: 'HDMI 1' },
  { key: 'InputHDMI2', label: 'HDMI 2' },
  { key: 'InputHDMI3', label: 'HDMI 3' },
]);

/**
 * Channel IDs. `confidence` is not decoration: an ID that has changed launches NOTHING and the page
 * looks broken rather than wrong, which is the worst failure mode for a remote. Anything below
 * 'high' should be treated as a guess and confirmed against the TV's own list.
 */
export const CHANNELS = Object.freeze([
  { id: '41468', name: 'Tubi', free: true, confidence: 'high' },
  { id: '837', name: 'YouTube', free: true, confidence: 'high' },
  { id: '12', name: 'Netflix', free: false, confidence: 'high' },
  { id: '13', name: 'Prime Video', free: false, confidence: 'high' },
  { id: '74519', name: 'Pluto TV', free: true, confidence: 'medium' },
  { id: '151908', name: 'The Roku Channel', free: true, confidence: 'medium' },
  { id: '13535', name: 'Plex', free: true, confidence: 'medium' },
  { id: '2285', name: 'Hulu', free: false, confidence: 'medium' },
]);

/** Platforms, and what is actually true about controlling each one without its remote. */
export const PLATFORMS = Object.freeze([
  {
    id: 'roku', name: 'Roku / Roku TV', open: true,
    how: 'Open HTTP API (ECP) on port 8060. No pairing, no account, no app.',
    thisPageWorks: true,
    note: 'A Roku TV can be powered on over the network. A Roku STICK cannot power the TV — the stick has no control over the panel. Use the TV buttons or HDMI-CEC for that.',
  },
  {
    id: 'androidtv', name: 'Android TV / Google TV', open: false,
    how: 'Google TV app, or the v2 remote protocol on ports 6466/6467 — which needs a TLS pairing handshake with a code shown on screen.',
    thisPageWorks: false,
    note: 'Not usable from a browser: the pairing handshake needs raw TLS. The Google TV app is the practical answer.',
  },
  {
    id: 'firetv', name: 'Fire TV', open: false,
    how: 'Fire TV app over Wi-Fi, or ADB on port 5555 if developer options are enabled.',
    thisPageWorks: false,
  },
  {
    id: 'samsung', name: 'Samsung', open: false,
    how: 'SmartThings app. The older port-8001/8002 websocket route needs an on-screen accept and is firmware dependent.',
    thisPageWorks: false,
  },
  { id: 'lg', name: 'LG webOS', open: false, how: 'LG ThinQ app. The SSAP websocket on port 3000 requires on-screen pairing.', thisPageWorks: false },
  { id: 'vizio', name: 'Vizio SmartCast', open: false, how: 'Vizio Mobile app. The local API needs a PIN-pairing step to issue a token.', thisPageWorks: false },
  { id: 'appletv', name: 'Apple TV', open: false, how: 'Remote in the iOS Control Center.', thisPageWorks: false },
]);

/** Every way to wake a TV whose remote is gone, in the order worth trying. Applies to ANY brand. */
export const NO_REMOTE_STEPS = Object.freeze([
  { step: 1, what: 'The buttons on the TV itself',
    detail: 'Almost every set has them: a small joystick or nub underneath the panel near the centre or bottom-right, or a button row on the back-left. A press usually powers on; holding it usually opens the menu where you can change input.' },
  { step: 2, what: 'HDMI-CEC from something already plugged in',
    detail: 'Power on a PlayStation, Xbox, Chromecast or Fire Stick and the TV will usually wake AND switch to that input by itself. This is the fastest route when a console is connected, and it needs no phone.' },
  { step: 3, what: 'Cast to it',
    detail: 'Chromecast built-in or AirPlay from a phone will wake many TVs and open the app directly.' },
  { step: 4, what: 'The manufacturer\'s phone app',
    detail: 'Roku app, SmartThings (Samsung), LG ThinQ, Vizio Mobile, Fire TV app, Google TV app. The TV has to already be on Wi-Fi.' },
  { step: 5, what: 'This page, if it is a Roku',
    detail: 'No app install, no account. Needs only the Roku\'s local IP address and a browser on the same Wi-Fi.' },
]);

const ip4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Accept a bare IP or host[:port]; default the ECP port. Returns null on anything unusable. */
export function ecpBase(input, { port = 8060 } = {}) {
  const raw = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!raw) return null;
  const [host, p] = raw.split(':');
  if (!host) return null;
  const okHost = ip4.test(host) || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*$/i.test(host);
  if (!okHost) return null;
  const portNum = Number(p || port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null;
  return `http://${host}:${portNum}`;
}

export const keypressUrl = (base, key) => (base && KEYS.some((k) => k.key === key) ? `${base}/keypress/${key}` : null);
export const launchUrl = (base, appId) => (base && /^\d{1,10}$/.test(String(appId)) ? `${base}/launch/${appId}` : null);
export const channel = (name) => CHANNELS.find((c) => c.name.toLowerCase() === String(name || '').toLowerCase()) || null;
export const platform = (id) => PLATFORMS.find((p) => p.id === String(id || '')) || null;

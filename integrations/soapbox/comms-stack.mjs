// comms-stack.mjs — WHAT IT ACTUALLY TAKES TO OFFER PHONE AND LIVE MEDIA.
//
// The operator asked whether we can create WiFi phone service and what else GitHub has that would
// expand the radio/media suite. The software half of that question is easy and the answer is yes —
// the stacks below are mature, permissively licensed and actively maintained.
//
// ⚠️ THE SOFTWARE IS NOT THE HARD PART, AND THIS IS THE WHOLE POINT OF THIS FILE.
//
// The moment a service connects to the PUBLIC TELEPHONE NETWORK — real numbers, calls to and from
// ordinary phones — the operator becomes an INTERCONNECTED VoIP PROVIDER in the FCC's sense, and
// that carries obligations that have nothing to do with code:
//
//     • E911. Interconnected VoIP must deliver 911 with the caller's registered location. This is
//       the one that ends projects. It is a life-safety obligation, it is enforced, and "we are
//       only a small service" is not a defence.
//     • FCC registration and Form 499-A, with Universal Service Fund contributions assessed on
//       interstate revenue.
//     • CALEA — lawful-intercept capability.
//     • CPNI — customer proprietary network information rules, with an annual certification.
//     • State-level registration in some states, and 911 fee remittance.
//
// APP-TO-APP CALLING TRIGGERS NONE OF THAT. A service where members call each other inside the app,
// with no PSTN interconnection, is not interconnected VoIP. That is the version worth building
// first, and `tiers()` exists so nobody discovers the distinction after choosing an architecture.
//
// ⭐ AND THERE IS A THIRD PATH that gets numbers without the licence: RESELL. Telnyx, Bandwidth and
// similar carriers already hold the registrations and provide E911; a white-label arrangement puts
// the regulatory burden on them. It costs margin and it is how almost every small "phone app" ships.
//
// Nothing here is legal advice and the file says so where it matters. It is an engineering map with
// the regulatory cliff marked, because the cliff is not visible from the code.

const str = (s) => String(s == null ? '' : s).trim();

export const REG_TIERS = Object.freeze({
  APP_ONLY: {
    id: 'app-only', label: 'App-to-app only (no PSTN)',
    interconnected: false,
    obligations: [],
    note: 'Members call members inside the app. No phone numbers, no calls to or from ordinary '
        + 'phones. Not interconnected VoIP, so none of the carrier obligations attach. '
        + '⭐ Build this first.',
  },
  RESELL: {
    id: 'resell', label: 'Numbers resold from a licensed carrier',
    interconnected: true, burdenOn: 'carrier',
    obligations: ['carrier holds E911, 499-A, USF, CALEA, CPNI'],
    note: 'Real numbers, real calls, and the carrier carries the registrations and the E911 '
        + 'plumbing. Costs margin. This is how nearly every small phone app actually ships. '
        + '⚠️ Read the carrier agreement for what it does NOT cover.',
  },
  FULL: {
    id: 'full', label: 'Own interconnected VoIP service',
    interconnected: true, burdenOn: 'us',
    obligations: ['E911 with registered location', 'FCC registration + Form 499-A',
                  'USF contributions', 'CALEA lawful intercept', 'CPNI rules + annual certification',
                  'state registration and 911 fee remittance in some states'],
    note: '⚠️ E911 is the obligation that ends projects. Do not choose this tier to save money — '
        + 'it does not.',
  },
});

/** What does a given architecture trigger? Returns the tier, never a bare boolean. */
export function tiers(architecture) {
  const a = str(architecture).toLowerCase();
  if (/pstn|number|dial.?out|landline|sms|e911/.test(a)) {
    return { ...REG_TIERS.RESELL,
      alsoConsider: REG_TIERS.FULL,
      recommendation: 'resell — do not seek your own interconnected-VoIP status for a v1' };
  }
  if (/app|internal|member|webrtc|in-app/.test(a)) {
    return { ...REG_TIERS.APP_ONLY, recommendation: 'ship this first' };
  }
  return { ...REG_TIERS.APP_ONLY,
    recommendation: 'unrecognised architecture — assumed app-only; state the PSTN question explicitly' };
}

// Surveyed 7 September 2026 against the GitHub API. Star counts are a staleness marker, not a
// quality judgement — `pushed` is the field that matters.
export const STACKS = Object.freeze([
  // ── voice / SIP ──────────────────────────────────────────────────────────────────
  { id: 'livekit', repo: 'livekit/livekit', stars: 20766, lang: 'Go', license: 'Apache-2.0',
    pushed: '2026-09-07', role: 'WebRTC SFU + SDKs', tier: 'app-only',
    why: '⭐ The strongest single choice for app-to-app voice and video. Apache-2.0, Go, actively '
       + 'developed, SDKs for web and mobile, and it does rooms rather than raw peer plumbing.' },
  { id: 'mediasoup', repo: 'versatica/mediasoup', stars: 7355, lang: 'C++', license: 'ISC',
    pushed: '2026-09-07', role: 'WebRTC SFU library', tier: 'app-only',
    why: 'Lower level than LiveKit — a library, not a server. More control, more to build.' },
  { id: 'janus', repo: 'meetecho/janus-gateway', stars: 9160, lang: 'C', license: 'GPL-3.0',
    pushed: '2026-09-07', role: 'WebRTC gateway', tier: 'app-only',
    why: '⚠️ GPL-3.0 — fine for a hosted service, a real question for anything distributed.' },
  { id: 'pion', repo: 'pion/webrtc', stars: 16764, lang: 'Go', license: 'MIT',
    pushed: '2026-09-07', role: 'WebRTC in pure Go', tier: 'app-only',
    why: 'MIT, no cgo. What you build on when you want the pieces yourself.' },
  { id: 'coturn', repo: 'coturn/coturn', stars: 14389, lang: 'C', license: 'see repo',
    pushed: '2026-09-07', role: 'STUN/TURN relay', tier: 'app-only',
    why: '⭐ NOT OPTIONAL. Roughly a fifth of calls fail without a TURN relay — symmetric NAT and '
       + 'corporate firewalls. Budget the bandwidth: relayed media costs real transfer.' },
  { id: 'asterisk', repo: 'asterisk/asterisk', stars: 3512, lang: 'C', license: 'see repo',
    pushed: '2026-09-02', role: 'PBX / SIP', tier: 'resell',
    why: 'The classic PBX. Reach for it when there are real numbers and call flows.' },
  { id: 'freeswitch', repo: 'signalwire/freeswitch', stars: 5137, lang: 'C', license: 'see repo',
    pushed: '2026-09-04', role: 'Softswitch', tier: 'resell',
    why: 'Scales better than Asterisk for concurrent calls; steeper to operate.' },
  { id: 'kamailio', repo: 'kamailio/kamailio', stars: 2937, lang: 'C', license: 'see repo',
    pushed: '2026-09-07', role: 'SIP proxy / registrar', tier: 'resell',
    why: 'Signalling at scale. Pairs with a media server rather than replacing one.' },
  { id: 'routr', repo: 'fonoster/routr', stars: 1709, lang: 'TypeScript', license: 'MIT',
    pushed: '2026-09-07', role: 'SIP server, modern stack', tier: 'resell',
    why: '⭐ MIT and TypeScript — by far the easiest SIP server for this repo to actually maintain.' },
  { id: 'sipjs', repo: 'onsip/SIP.js', stars: 2094, lang: 'TypeScript', license: 'MIT',
    pushed: '2026-06-15', role: 'Browser SIP client', tier: 'app-only',
    why: 'MIT. ⚠️ Quieter than the rest — check before committing.' },

  // ── radio / streaming ────────────────────────────────────────────────────────────
  { id: 'azuracast', repo: 'AzuraCast/AzuraCast', stars: 4023, lang: 'PHP', license: 'AGPL-3.0',
    pushed: '2026-09-07', role: 'Full radio station platform', tier: 'app-only',
    why: '⭐ The complete answer for running an actual station — scheduling, playlists, DJ '
       + 'streaming, listener stats, Icecast built in. ⚠️ AGPL-3.0: hosting it triggers the network '
       + 'clause, so the source obligation is live for a hosted service.' },
  { id: 'libretime', repo: 'libretime/libretime', stars: 942, lang: 'PHP', license: 'AGPL-3.0',
    pushed: '2026-09-07', role: 'Radio automation', tier: 'app-only',
    why: 'The Airtime successor. Same AGPL consideration as AzuraCast.' },
  { id: 'liquidsoap', repo: 'savonet/liquidsoap', stars: 1727, lang: 'OCaml', license: 'GPL-2.0',
    pushed: '2026-09-07', role: 'Stream scripting engine', tier: 'app-only',
    why: 'The engine underneath most of the others. Use it when the playlist logic is the product.' },
  { id: 'icecast', repo: 'xiph/Icecast-Server', stars: 552, lang: 'C', license: 'GPL-2.0',
    pushed: '2026-08-19', role: 'Stream server', tier: 'app-only',
    why: 'The listener-facing endpoint. Boring, which is the compliment.' },
  { id: 'owncast', repo: 'owncast/owncast', stars: 11512, lang: 'Go', license: 'MIT',
    pushed: '2026-09-07', role: 'Self-hosted live video + chat', tier: 'app-only',
    why: '⭐ MIT, Go, single binary. The lowest-effort way to add live video with chat.' },
  { id: 'mediamtx', repo: 'bluenviron/mediamtx', stars: 20057, lang: 'Go', license: 'MIT',
    pushed: '2026-09-07', role: 'RTSP/RTMP/WebRTC/HLS relay', tier: 'app-only',
    why: '⭐ MIT, one binary, converts between every ingest and playback protocol. The glue piece.' },
  { id: 'srs', repo: 'ossrs/srs', stars: 29215, lang: 'C++', license: 'MIT',
    pushed: '2026-09-05', role: 'Streaming cluster', tier: 'app-only',
    why: 'MIT and very fast; heavier to operate than MediaMTX.' },
  { id: 'jitsi', repo: 'jitsi/jitsi-meet', stars: 29884, lang: 'TypeScript', license: 'Apache-2.0',
    pushed: '2026-09-07', role: 'Video conferencing', tier: 'app-only',
    why: 'Apache-2.0 and turnkey. Heavier than LiveKit if all you want is calls.' },
  { id: 'synapse', repo: 'element-hq/synapse', stars: 4589, lang: 'Python', license: 'AGPL-3.0',
    pushed: '2026-09-07', role: 'Matrix homeserver — messaging + VoIP signalling', tier: 'app-only',
    why: 'Federated messaging with calling built on the same WebRTC. ⚠️ AGPL-3.0.' },
]);

export const stack = (id) => STACKS.find((s) => s.id === str(id)) || null;
export const byTier = (tier) => STACKS.filter((s) => s.tier === str(tier));

/** Licences that constrain a HOSTED service specifically — the network clause is the trap. */
export function licenseWarnings() {
  return STACKS.filter((s) => /AGPL/.test(s.license)).map((s) => ({
    id: s.id, license: s.license,
    warning: 'AGPL network clause: offering this over a network to users triggers the source '
           + 'obligation even though nothing is distributed. Fine if we publish; a decision if we do not.',
  }));
}

/** A staleness check that does not pretend to judge quality. */
export function stale(asOfISO = new Date().toISOString(), months = 12) {
  const cut = new Date(asOfISO);
  cut.setUTCMonth(cut.getUTCMonth() - months);
  return STACKS.filter((s) => new Date(s.pushed) < cut)
    .map((s) => ({ id: s.id, pushed: s.pushed, note: `no push in ${months} months — verify before adopting` }));
}

/** The build order, with the reasoning attached rather than implied. */
export function plan() {
  return [
    { step: 1, what: 'App-to-app voice/video with LiveKit + coturn',
      tier: 'app-only', triggers: 'no carrier obligations',
      why: 'ships without touching the regulatory question at all, and coturn is what makes it '
         + 'actually connect for the ~20% of users behind symmetric NAT' },
    { step: 2, what: 'Live audio with MediaMTX or Owncast, pointed at the existing radio reader',
      tier: 'app-only', triggers: 'none',
      why: 'radio.mjs already POINTS at broadcasters\' own streams and never rehosts — this adds '
         + 'the ability to originate OUR OWN stream without changing that posture for theirs' },
    { step: 3, what: 'Real numbers by RESELLING from a licensed carrier',
      tier: 'resell', triggers: 'carrier holds E911, 499-A, USF, CALEA, CPNI',
      why: '⭐ the same carriers already priced for fax in doc-services.mjs — one account, both '
         + 'products, and the regulatory burden stays with them' },
    { step: 4, what: 'Own interconnected VoIP service',
      tier: 'full', triggers: 'E911, FCC registration, USF, CALEA, CPNI, state filings',
      why: '⚠️ only if volume ever justifies it. E911 alone is a programme, not a feature.' },
  ];
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };
  try {
    return send(200, {
      module: 'comms-stack',
      headline: 'The software is free and mature. Touching the public phone network is what costs — '
              + 'E911, FCC registration, USF, CALEA and CPNI attach to interconnected VoIP and not '
              + 'to app-to-app calling.',
      surveyedOn: '2026-09-07',
      tiers: REG_TIERS,
      plan: plan(),
      counts: { stacks: STACKS.length, agpl: licenseWarnings().length },
      disclaimer: 'Engineering map with the regulatory cliff marked. Not legal advice; confirm '
                + 'current FCC obligations with counsel before selling anything that dials a phone.',
    });
  } catch (e) { return send(500, { error: String((e && e.message) || e) }); }
}

if (process.argv[1] && process.argv[1].endsWith('comms-stack.mjs')) {
  for (const s of plan()) console.log(`${s.step}. [${s.tier}] ${s.what}\n     ${s.triggers}`);
  console.log('\nAGPL (network clause):', licenseWarnings().map((w) => w.id).join(', '));
  console.log('stale (>12mo):', stale().map((s) => `${s.id}@${s.pushed}`).join(', ') || 'none');
}

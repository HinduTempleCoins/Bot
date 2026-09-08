// soapbox-tools — the catalogue of SoapBox Tools: the practical utilities anyone can use.
//
// The operator's framing, 8 September 2026: "our Thing is Called SoapBox Fax I guess, and we are
// going to Start making Other Things also, all kinds of Tools for People to use... This goes with
// like the Image Hosting stuff and Everything, all the PDF Altering Tools and the Fax and all."
//
// So this is a SUITE, not a pile of modules. The suite has a thesis, and the thesis is the reason
// someone would use ours instead of the ad-farm that currently owns these searches:
//
//   Every one of these tools exists elsewhere behind a watermark, a signup wall, a 2MB cap, or a
//   "free trial" that keeps your document. Ours do not. The thing being sold is not the tool.
//
// WHAT THIS MODULE IS: a registry, not an implementation. Each entry points at the module that
// does the work and states honestly what state it is in. `status` is the load-bearing field --
// `live` means it is deployed and works, `built` means the code exists and is tested but nothing
// is serving it yet, `blocked` means it needs something we do not have. Claiming `live` for a
// `blocked` tool is the exact failure this field exists to prevent.

const str = (v) => String(v == null ? '' : v);

export const STATUS = Object.freeze({
  LIVE: 'live',        // deployed and serving; a URL proves it
  BUILT: 'built',      // code exists, tests pass, nothing is serving it
  BLOCKED: 'blocked',  // needs a key, an account, or a decision we do not have
  PLANNED: 'planned',  // named, not written
});

export const TOOLS = Object.freeze([
  {
    id: 'soapbox-fax',
    name: 'SoapBox Fax',
    blurb: 'Send a document to a fax number, with a real cover sheet and a receipt you can file.',
    why: 'Records offices, courts and jails still take fax and often take nothing else — and a '
       + 'fax transmission report is timestamped proof of the date a request arrived, which email '
       + 'has no equivalent for. Tex. Gov\'t Code § 552.301(a-1) even deems a MAILED request '
       + 'received three business days after the postmark when the actual date cannot be '
       + 'established; a fax establishes it.',
    modules: ['soapbox/fax-system.mjs', 'soapbox/fax-service.mjs', 'soapbox/fax-receipts.mjs',
              'soapbox/business-hours.mjs', 'soapbox/doc-services.mjs'],
    status: STATUS.BLOCKED,
    blockedOn: 'a provider API key (Telnyx/ClickSend/Phaxio) and a hosted URL for the PDF — the '
             + 'provider APIs fetch a URL, they do not accept raw text. Manual mode works today: '
             + 'it renders the complete packet to print and send by hand.',
    freeUnlike: 'eFax and its imitators put the page behind a subscription and a page cap.',
  },
  {
    id: 'soapbox-docs',
    name: 'SoapBox Document Tools',
    blurb: 'Convert, merge, split, extract and OCR — PDF, Office, images, ebooks.',
    why: 'The single most-searched free utility on the internet, and the incumbents keep your file.',
    modules: ['soapbox/docconvert.mjs', 'soapbox/doc-services.mjs'],
    status: STATUS.BUILT,
    blockedOn: 'an engine host (Gotenberg / Stirling-PDF / Tika / Pandoc) — the adapters are '
             + 'written and the shapers are tested; nothing is pointed at a running engine.',
    freeUnlike: 'Smallpdf and iLovePDF cap free conversions and upload your document to their cloud.',
  },
  {
    id: 'soapbox-host',
    name: 'SoapBox Hosting',
    blurb: 'Put an image, a document or a media file somewhere with a permanent link.',
    why: 'Every other tool in this suite needs a URL to point at — including the fax, which cannot '
       + 'send until the PDF is somewhere fetchable. This is the dependency under the suite.',
    modules: ['soapbox/nft-host.mjs'],
    status: STATUS.PLANNED,
    blockedOn: 'a storage bucket and a public base URL. ⭐ This is the highest-leverage gap: '
             + 'hosting unblocks SoapBox Fax and the document tools at the same time.',
    freeUnlike: 'Imgur and the rest reserve the right to delete, and most strip the original file.',
  },
  {
    id: 'soapbox-records',
    name: 'SoapBox Records Requests',
    blurb: 'Write, address, send and track a public-records request, and know when it is late.',
    why: 'Most people never file one because the maze is the barrier: who takes email, who takes '
       + 'only a portal, which address starts the clock, and when the clock actually runs out.',
    modules: ['records-requests.mjs', 'soapbox/fax-receipts.mjs', 'soapbox/business-hours.mjs'],
    status: STATUS.BUILT,
    blockedOn: 'a sending path — see soapbox-mail. The composing, addressing, deadline and '
             + 'receipt-tracking sides all work and are tested.',
    freeUnlike: 'MuckRock charges per request past a small free tier.',
  },
  {
    id: 'soapbox-credentials',
    name: 'SoapBox Credentials',
    blurb: 'A plain map of how to actually earn a credential, by industry — free paths first.',
    why: 'The credentialing landscape is deliberately confusing, and almost every site explaining '
       + 'it is paid placement. We rank by recognition and value, never by who pays, and we link '
       + 'out to the official issuer rather than selling anything.',
    modules: ['soapbox/credentials-catalog.mjs', 'soapbox/credentials-issuer.mjs',
              'soapbox/credential-anchor.mjs', 'soapbox/credential-assessment.mjs'],
    status: STATUS.LIVE,
    url: 'https://credentials.soapbox.community',
    freeUnlike: 'the lead-generation sites that rank by advertiser.',
  },
  {
    id: 'hierophant',
    name: 'The Hierophant',
    blurb: 'A map of the world\'s sacred texts — who is in each one, and what to read alongside it.',
    why: 'The texts are already free at Sacred-Texts, Gutenberg and Archive.org. What is missing '
       + 'is the map, so we build the map and point at the free copies rather than re-hosting them.',
    modules: ['hierophant-catalog.mjs', 'hierophant-entities.mjs'],
    status: STATUS.LIVE,
    url: 'https://hierophant.soapbox.community',
    freeUnlike: 'nothing — this one has no real commercial equivalent, which is why it exists.',
  },
  {
    id: 'soapbox-mail',
    name: 'SoapBox Mail',
    blurb: 'Send real mail — email at volume, and paper where paper is required.',
    why: 'Everything else in the suite ends in "and then it has to reach somebody."',
    modules: [],
    status: STATUS.BLOCKED,
    blockedOn: '⚠️ a transactional sender (Resend / Postmark / SES). Volume sending from a '
             + 'personal mailbox gets that mailbox rate-limited and then suspended — and the '
             + 'operator\'s mailbox carries legal correspondence, so it must not be the sender.',
    freeUnlike: 'Mailchimp, which prices on list size rather than on sends.',
  },
]);

export const tool = (id) => TOOLS.find((t) => t.id === str(id)) || null;
export const byStatus = (s) => TOOLS.filter((t) => t.status === str(s));
export const live = () => byStatus(STATUS.LIVE);

/** What is stopping the suite, most-shared blocker first. A blocker under two tools is worth more. */
export function blockers() {
  const counts = new Map();
  for (const t of TOOLS) {
    if (!t.blockedOn) continue;
    const key = t.blockedOn;
    const e = counts.get(key) || { blockedOn: key, tools: [] };
    e.tools.push(t.id);
    counts.set(key, e);
  }
  return [...counts.values()].sort((a, b) => b.tools.length - a.tools.length);
}

/** An honest one-line status per tool. Never upgrades `built` to `live`. */
export function statusLine(t) {
  if (!t) return '';
  if (t.status === STATUS.LIVE) return `${t.name}: LIVE — ${t.url}`;
  if (t.status === STATUS.PLANNED) return `${t.name}: PLANNED — ${t.blockedOn || 'not started'}`;
  return `${t.name}: ${t.status.toUpperCase()} — blocked on ${t.blockedOn}`;
}

export function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  const id = url.searchParams.get('id');
  if (id) {
    const t = tool(id);
    return t ? send(200, { ok: true, tool: t }) : send(404, { ok: false, error: 'unknown tool' });
  }
  if (url.pathname.endsWith('/blockers')) return send(200, { ok: true, blockers: blockers() });
  return send(200, {
    ok: true, suite: 'SoapBox Tools',
    counts: {
      live: byStatus(STATUS.LIVE).length,
      built: byStatus(STATUS.BUILT).length,
      blocked: byStatus(STATUS.BLOCKED).length,
      planned: byStatus(STATUS.PLANNED).length,
    },
    tools: TOOLS.map((t) => ({ id: t.id, name: t.name, status: t.status, url: t.url || null })),
  });
}

if (process.argv[1] && process.argv[1].endsWith('soapbox-tools.mjs')) {
  console.log('\nSoapBox Tools\n');
  for (const t of TOOLS) console.log('  ' + statusLine(t));
  console.log('\nShared blockers, most-shared first:\n');
  for (const b of blockers()) {
    console.log(`  [${b.tools.length}] ${b.tools.join(', ')}`);
    console.log(`      ${b.blockedOn}\n`);
  }
}

// pentecaust/groups/server.mjs — the HTTP surface for GROUPS. Step 2 of the roadmap in
// .local/GROUPS_SOLUTION_DESIGN.md, written 2026-08-29 and never built: the model shipped with 24
// passing tests and was imported by NOTHING, so the primitive existed and no one could reach it.
//
// ⭐ WHY THIS MOUNTS INSIDE PENTECAUST AND NOT ON ITS OWN HOST.
// A group is only worth anything to somebody who is signed in, and Pentecaust is where identity now
// lives — including the '~…' messenger handles a social login gets without any MELEK account at all.
// A separate groups host would be a page nobody arrives at already logged in to, which is exactly why
// site/bounties has never served a request.
//
// IDENTITY: the caller is resolved by an injected whoami, never by a body field. Every private act is
// bound to that verified account — the same deny-by-default boundary pentecaust/server.mjs uses.
//
// House style: ESM, soft-fail-never-throw, handler(req,res,deps), esc() at the render edge.

import {
  createGroup, addMember, approve, invite, removeMember, setRole, setJoinPolicy, setAbout,
  postToGroup, listFeed, getGroup, isMember, listGroups, groupsForAccount,
  groupChannelId, ROLES, JOIN_POLICIES, KINDS,
} from './model.mjs';

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const unauth = (res) => json(res, 401, { ok: false, reason: 'sign in first' });

function readBody(req, max = 65536) {
  if (req && req.body !== undefined && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    try {
      let d = ''; let over = false;
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

/**
 * handler(req, res, { whoami, opts })
 *   whoami(req) → the verified account (a MELEK name OR a '~…' messenger handle), or null.
 *   opts        → passed through to the model (fs/file seams for tests).
 */
export async function handler(req, res, deps = {}) {
  const who = typeof deps.whoami === 'function' ? deps.whoami : () => null;
  const opts = deps.opts || {};
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const [pathRaw, qs = ''] = String((req && req.url) || '/').split('?');
    const path = (pathRaw || '/').replace(/\/+$/, '') || '/';
    const q = new URLSearchParams(qs);
    const segs = path.split('/').filter(Boolean);        // groups[/:id[/action]]

    // ── public reads ────────────────────────────────────────────────────────────────────────────
    // The directory is open on purpose: somebody deciding whether to join should see what exists
    // before signing up. invite-only groups are already hidden by listGroups().
    if (method === 'GET' && path === '/groups') {
      return json(res, 200, { ok: true, roles: Object.keys(ROLES), joinPolicies: JOIN_POLICIES, kinds: KINDS, groups: listGroups(opts) });
    }
    if (method === 'GET' && segs[0] === 'groups' && segs[1] && segs.length === 2) {
      const g = getGroup(segs[1], opts);
      return g ? json(res, 200, { ok: true, group: g }) : json(res, 404, { ok: false, reason: 'no such group' });
    }
    if (method === 'GET' && segs[0] === 'groups' && segs[1] && segs[2] === 'feed') {
      const g = getGroup(segs[1], opts);
      if (!g) return json(res, 404, { ok: false, reason: 'no such group' });
      return json(res, 200, { ok: true, id: segs[1], feed: listFeed(segs[1], { limit: Number(q.get('limit')) || 50 }, opts) });
    }

    // ── mine ────────────────────────────────────────────────────────────────────────────────────
    if (method === 'GET' && path === '/me/groups') {
      const me = who(req); if (!me) return unauth(res);
      return json(res, 200, { ok: true, account: me, groups: groupsForAccount(me, opts) });
    }
    // Your own role + chat channel for one group. Session-only: a role is not public information.
    if (method === 'GET' && segs[0] === 'groups' && segs[1] && segs[2] === 'me') {
      const me = who(req); if (!me) return unauth(res);
      const g = getGroup(segs[1], opts);
      if (!g) return json(res, 404, { ok: false, reason: 'no such group' });
      // ⚠️ roleOf() takes the RAW group, but getGroup() returns view() — whose `members` is an ARRAY of
      // {account, role}, not the raw keyed object roleOf expects. Handing the view to roleOf returned
      // null for everyone including the owner, so every role check silently answered "no role" rather
      // than failing loudly. The view already carries the role; read it from there.
      const mine = (g.members || []).find((x) => x && x.account === me);
      return json(res, 200, {
        ok: true, id: segs[1], account: me, role: (mine && mine.role) || null,
        member: isMember(segs[1], me, opts), channel: groupChannelId(segs[1]),
      });
    }

    if (method !== 'POST') return json(res, 404, { ok: false, reason: 'not-found' });

    const me = who(req); if (!me) return unauth(res);
    const b = await readBody(req);
    if (b == null) return json(res, 400, { ok: false, reason: 'bad-body' });

    // ⚠️ Every one of these passes `me`, never b.actor/b.account-as-self. The model enforces rank, but
    // it can only do that against the actor it is handed — so the actor must come from the session or
    // the whole role system is decoration.
    if (path === '/groups') return json(res, 200, createGroup({ ...b, owner: me }, opts));

    const id = segs[1];
    if (segs[0] !== 'groups' || !id) return json(res, 404, { ok: false, reason: 'not-found' });

    switch (segs[2]) {
      case 'join':      return json(res, 200, addMember(id, me, { ...opts, balances: b.balances }));
      case 'leave':     return json(res, 200, removeMember(id, me, me, opts));
      case 'approve':   return json(res, 200, approve(id, me, b.account, opts));
      case 'invite':    return json(res, 200, invite(id, me, b.account, opts));
      case 'kick':      return json(res, 200, removeMember(id, me, b.account, opts));
      case 'role':      return json(res, 200, setRole(id, me, b.account, b.role, opts));
      case 'policy':    return json(res, 200, setJoinPolicy(id, me, b.joinPolicy, b.tokenGate, opts));
      case 'about':     return json(res, 200, setAbout(id, me, b.about, opts));
      case 'post':      return json(res, 200, postToGroup(id, { ...b, author: me }, opts));
      default:          return json(res, 404, { ok: false, reason: 'not-found' });
    }
  } catch { return json(res, 500, { ok: false, reason: 'error' }); }
}

export default { handler };

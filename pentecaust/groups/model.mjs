// pentecaust/groups/model.mjs — MELEK GROUPS: HIVE-communities-style content groups.
//
// WHAT THIS IS (and how it differs from pentecaust/model.mjs "Teams")
//   Teams (pentecaust/model.mjs) are the cross-game CLAN/chat primitive: small rosters that chat in-game and
//   out. GROUPS are the HIVE-communities analogue: a durable, content-first COMMUNITY that a feed of posts is
//   tagged to (a subreddit / a HIVE community like `hive-167922 "LeoFinance"`), with a subscriber roster and a
//   moderation hierarchy. The two share the same persistence discipline and can coexist — a person is on Teams
//   for their clan chat and subscribed to Groups for the topics they read.
//
//   The DURABLE layer is the MELEK Graphene chain: a group maps to an on-chain community ACCOUNT (HIVE names
//   these `hive-NNNNNN`; here a group carries an optional `account` once provisioned) and posts tag that
//   community as their category. This module is the OFF-CHAIN roster + feed index the surfaces read — it holds
//   NO keys and makes NO chain writes. Provisioning the community account and broadcasting posts happen through
//   MELEK-Signer elsewhere; this module records the membership graph, the roles, and a lightweight pointer
//   index of recent posts (author/permlink) so a group page can render its feed without a full chain scan.
//
//   GROUP CHAT reuses pentecaust/messaging.mjs — a group's chat channel id is `group:<id>` (see groupChannelId).
//   TOKEN-GATED membership reuses integrations/token-gate.mjs — a `token` join policy runs the caller-supplied
//   balances through the group's gate rules; this module never touches a wallet or chain to fetch balances.
//
// Persistence mirrors pentecaust/model.mjs: one JSON file, injectable fs, soft-fail-never-throw, offline tests.
//
//   import { createGroup, addMember, setRole, removeMember, approve, invite, setJoinPolicy, setAbout,
//            getGroup, isMember, roleOf, listGroups, groupsForAccount,
//            postToGroup, listFeed, groupChannelId, ROLES, JOIN_POLICIES, KINDS } from './groups/model.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../../signup/welcome-grant.mjs';
import { evaluateGate } from '../../integrations/token-gate.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('GROUPS_DATA', join(process.cwd(), 'data', 'groups.json'));

// Cosmetic labels a group can wear (parallels Teams' KINDS). 'community' is the default HIVE-ish label.
export const KINDS = ['community', 'group', 'topic', 'board', 'circle', 'hub'];
// How a person becomes a member:
//   open   — subscribe instantly (the default; HIVE communities are open-subscribe)
//   apply  — request → a mod approves
//   invite — only an invited account may join
//   token  — must pass the group's token-gate (balances supplied by the caller, checked here)
export const JOIN_POLICIES = ['open', 'apply', 'invite', 'token'];
// Moderation hierarchy (HIVE roles). Higher rank manages lower. 'muted' is below member (can read, not post).
export const ROLES = { owner: 4, admin: 3, mod: 2, member: 1, muted: 0 };
const SETTABLE_ROLES = ['admin', 'mod', 'member', 'muted']; // owner is transferred, never "set"

const MAX_MEMBERS_DEFAULT = Number(env('GROUPS_MAX_MEMBERS', '100000')) || 100000;
const KEEP_FEED = Number(env('GROUPS_FEED_KEEP', '200')) || 200; // ring-buffered recent-post pointers
const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);
const acct = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();

// ── injectable fs + store (same shape discipline as pentecaust/model.mjs) ────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { groups: {} };
  try { const o = JSON.parse(raw); return o && o.groups ? o : { groups: {} }; } catch { return { groups: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}
function uniqueId(store, base) {
  const b = base || 'group';
  if (!store.groups[b]) return b;
  for (let i = 2; i < 100000; i++) { const id = `${b}-${i}`; if (!store.groups[id]) return id; }
  return `${b}-${Date.now()}`;
}
export function roleOf(group, account) {
  const a = acct(account);
  return group && group.members && group.members[a] ? group.members[a].role : null;
}
const rank = (role) => ROLES[role] || 0;
// Can `actor` manage `target`? Mod+ and strictly outranks the target (owner outranks all).
function canManage(group, actor, target) {
  const ar = rank(roleOf(group, actor));
  if (ar < ROLES.mod) return false;
  return ar > rank(roleOf(group, target));
}

// The chat-channel id a group's group-chat lives under (pentecaust/messaging.mjs readChannel(`group:<id>`)).
export function groupChannelId(id) { return `group:${String(id || '')}`; }

// The category / tag a post carries to belong to this group.
//   • If the group has a provisioned on-chain community account, that account IS the category (HIVE model).
//   • Otherwise fall back to the group's tag (a plain hashtag community until an account is minted).
export function groupCategory(group) {
  if (!group) return null;
  return group.account || group.tag || `group-${group.id}`;
}

// Public, store-free view (safe to hand a client). Omits raw internal maps.
export function view(group) {
  if (!group) return null;
  return {
    id: group.id, name: group.name, about: group.about || '', kind: group.kind,
    joinPolicy: group.joinPolicy, owner: group.owner, account: group.account || null,
    tag: group.tag || null, category: groupCategory(group),
    tokenGate: Array.isArray(group.tokenGate) ? group.tokenGate : [],
    maxMembers: group.maxMembers, created: group.created,
    members: Object.entries(group.members).map(([account, m]) => ({ account, role: m.role, joined: m.joined }))
      .sort((a, b) => rank(b.role) - rank(a.role) || a.joined - b.joined),
    memberCount: Object.keys(group.members).length,
    pending: Object.keys(group.applicants || {}).length,
    posts: (group.feed || []).length,
  };
}

// ── operations ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Found a group. The owner becomes its owner-role member. Persisted; never throws.
 * @param {{owner, name, about?, kind?, joinPolicy?, tag?, account?, tokenGate?, maxMembers?}} spec
 *   tokenGate — token-gate rules (see integrations/token-gate.mjs); only meaningful with joinPolicy 'token'.
 *   account   — a pre-provisioned on-chain community account name, if one already exists.
 */
export function createGroup(spec = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const owner = acct(spec.owner);
  if (!validAccountName(owner)) return { ok: false, reason: 'owner must be a valid MELEK account name' };
  const name = clamp(spec.name, 60).trim();
  if (name.length < 2) return { ok: false, reason: 'group name too short' };
  const kind = KINDS.includes(spec.kind) ? spec.kind : 'community';
  const joinPolicy = JOIN_POLICIES.includes(spec.joinPolicy) ? spec.joinPolicy : 'open';
  const max = Math.min(1000000, Math.max(2, Number(spec.maxMembers) || MAX_MEMBERS_DEFAULT));
  const tokenGate = Array.isArray(spec.tokenGate) ? spec.tokenGate : [];
  const account = spec.account && validAccountName(acct(spec.account)) ? acct(spec.account) : null;
  const t = now(opts);

  const store = loadStore(fs, file);
  const id = uniqueId(store, slug(name) || 'group');
  const tag = spec.tag ? slug(spec.tag) : slug(name) || `group-${id}`;
  const group = {
    id, name, about: clamp(spec.about, 500), kind, joinPolicy, owner,
    account, tag, tokenGate, maxMembers: max,
    members: { [owner]: { role: 'owner', joined: t } },
    applicants: {}, invites: {}, feed: [], created: t,
  };
  store.groups[id] = group;
  saveStore(fs, file, store);
  return { ok: true, group: view(group) };
}

/**
 * Subscribe/join a group. Honors joinPolicy:
 *   open   → member instantly
 *   apply  → request queued (status 'applied')
 *   invite → member only if invited, else 'invite-only'
 *   token  → member only if opts.balances passes the group's tokenGate, else 'gated'
 * @returns {{ok, status, group?}}
 */
export function addMember(id, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = acct(account);
  if (!validAccountName(who)) return { ok: false, reason: 'account must be a valid MELEK account name' };
  const store = loadStore(fs, file);
  const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (group.members[who]) return { ok: true, status: 'already-member', group: view(group) };
  if (Object.keys(group.members).length >= group.maxMembers) return { ok: false, reason: 'group is full' };
  const t = now(opts);
  const admit = () => {
    delete group.invites[who]; delete group.applicants[who];
    group.members[who] = { role: 'member', joined: t };
    saveStore(fs, file, store);
    return { ok: true, status: 'joined', group: view(group) };
  };

  switch (group.joinPolicy) {
    case 'open':
      return admit();
    case 'apply':
      if (group.invites[who]) return admit();     // an invite short-circuits the queue
      group.applicants[who] = t; saveStore(fs, file, store);
      return { ok: true, status: 'applied', group: view(group) };
    case 'invite':
      if (group.invites[who]) return admit();
      return { ok: false, status: 'invite-only', reason: 'this group is invite-only' };
    case 'token': {
      if (group.invites[who]) return admit();     // an invite overrides the gate
      const balances = (opts.balances && typeof opts.balances === 'object') ? opts.balances : {};
      const { grantedRoles } = evaluateGate({ balances, rules: group.tokenGate });
      if (grantedRoles.length) return admit();
      return { ok: false, status: 'gated', reason: 'token requirement not met' };
    }
    default:
      return admit();
  }
}

/** Mod+ approves a pending applicant (apply-policy) into membership. */
export function approve(id, actor, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = acct(account); const by = acct(actor);
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (rank(roleOf(group, by)) < ROLES.mod) return { ok: false, reason: 'not allowed (mod+ only)' };
  if (!group.applicants[who]) return { ok: false, reason: 'no such applicant' };
  if (Object.keys(group.members).length >= group.maxMembers) return { ok: false, reason: 'group is full' };
  delete group.applicants[who];
  group.members[who] = { role: 'member', joined: now(opts) };
  saveStore(fs, file, store);
  return { ok: true, status: 'joined', group: view(group) };
}

/** Mod+ invites an account (invite/token/apply policies); the invitee then addMember()s. */
export function invite(id, actor, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = acct(account); const by = acct(actor);
  if (!validAccountName(who)) return { ok: false, reason: 'account must be a valid MELEK account name' };
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (rank(roleOf(group, by)) < ROLES.mod) return { ok: false, reason: 'not allowed (mod+ only)' };
  group.invites[who] = now(opts); saveStore(fs, file, store);
  return { ok: true, status: 'invited', group: view(group) };
}

/**
 * Remove a member — leave (self) or kick (a higher-ranked actor removes a lower one).
 * If the OWNER leaves, ownership passes to the most senior remaining member; an empty group is deleted.
 */
export function removeMember(id, actor, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = acct(account); const by = acct(actor);
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (!group.members[who]) return { ok: false, reason: 'not a member' };
  const selfLeave = who === by;
  if (!selfLeave && !canManage(group, by, who)) {
    return { ok: false, reason: 'not allowed (need a higher role than the target)' };
  }
  const wasOwner = roleOf(group, who) === 'owner';
  delete group.members[who];
  const remaining = Object.keys(group.members);
  if (remaining.length === 0) { delete store.groups[id]; saveStore(fs, file, store); return { ok: true, status: 'disbanded' }; }
  if (wasOwner) {
    const heir = remaining.sort((a, b) =>
      rank(group.members[b].role) - rank(group.members[a].role) || group.members[a].joined - group.members[b].joined)[0];
    group.members[heir].role = 'owner'; group.owner = heir;
  }
  saveStore(fs, file, store);
  return { ok: true, status: selfLeave ? 'left' : 'removed', group: view(group), newOwner: wasOwner ? group.owner : undefined };
}

/**
 * Set a member's role. Admin+ may set roles, but only to a role strictly below the actor's own rank, and only
 * on a member they outrank. Setting role 'owner' transfers ownership (the old owner drops to admin).
 */
export function setRole(id, actor, account, role, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = acct(account); const by = acct(actor);
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (!group.members[who]) return { ok: false, reason: 'not a member' };
  if (who === by) return { ok: false, reason: 'cannot change your own role' };

  if (role === 'owner') {
    if (roleOf(group, by) !== 'owner') return { ok: false, reason: 'only the owner can transfer ownership' };
    group.members[by].role = 'admin'; group.owner = who; group.members[who].role = 'owner';
    saveStore(fs, file, store);
    return { ok: true, group: view(group) };
  }
  if (!SETTABLE_ROLES.includes(role)) return { ok: false, reason: 'unknown role' };
  const byRank = rank(roleOf(group, by));
  if (byRank < ROLES.admin) return { ok: false, reason: 'not allowed (admin+ only)' };
  if (byRank <= rank(roleOf(group, who))) return { ok: false, reason: 'cannot manage an equal or higher member' };
  if (rank(role) >= byRank) return { ok: false, reason: 'cannot grant a role at or above your own' };
  group.members[who].role = role;
  saveStore(fs, file, store);
  return { ok: true, group: view(group) };
}

/** Admin+ changes the join policy (and optional token-gate rules alongside a 'token' policy). */
export function setJoinPolicy(id, actor, joinPolicy, tokenGate, opts = {}) {
  if (!JOIN_POLICIES.includes(joinPolicy)) return { ok: false, reason: 'unknown join policy' };
  const { fs, file } = ctx(opts);
  const by = acct(actor);
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (rank(roleOf(group, by)) < ROLES.admin) return { ok: false, reason: 'not allowed (admin+ only)' };
  group.joinPolicy = joinPolicy;
  if (Array.isArray(tokenGate)) group.tokenGate = tokenGate;
  saveStore(fs, file, store);
  return { ok: true, group: view(group) };
}

/** Admin+ sets the group's about/description text. */
export function setAbout(id, actor, about, opts = {}) {
  const { fs, file } = ctx(opts);
  const by = acct(actor);
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (rank(roleOf(group, by)) < ROLES.admin) return { ok: false, reason: 'not allowed (admin+ only)' };
  group.about = clamp(about, 500);
  saveStore(fs, file, store);
  return { ok: true, group: view(group) };
}

/** Link a provisioned on-chain community account to the group (owner/admin only). */
export function setAccount(id, actor, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const by = acct(actor); const a = acct(account);
  if (!validAccountName(a)) return { ok: false, reason: 'account must be a valid MELEK account name' };
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  if (rank(roleOf(group, by)) < ROLES.admin) return { ok: false, reason: 'not allowed (admin+ only)' };
  group.account = a;
  saveStore(fs, file, store);
  return { ok: true, group: view(group) };
}

// ── posts-to-group ────────────────────────────────────────────────────────────────────────────────
/**
 * Build the metadata a post carries to belong to this group, and record a pointer in the group's feed index.
 *
 *   • The DURABLE post is broadcast on-chain elsewhere (through MELEK-Signer) — this module signs nothing and
 *     stores no post body. It returns the `meta` a caller stamps onto the `comment` op so the post is tagged
 *     to the group (category = the community account or the group tag; the group tag is first in json tags),
 *     and it appends a lightweight {author, permlink, title, ts} pointer to the group's ring-buffered feed so
 *     a group page can list recent posts without a chain scan.
 *   • Posting requires membership and a non-muted role (HIVE: guests/muted can't post to a community).
 *
 * @param {{author, permlink, title?, parentAuthor?}} post
 * @returns {{ok, meta?, feedRef?, group?}}
 */
export function postToGroup(id, post = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const author = acct(post.author);
  if (!validAccountName(author)) return { ok: false, reason: 'author must be a valid MELEK account name' };
  const permlink = slug(post.permlink);
  if (!permlink) return { ok: false, reason: 'permlink required' };
  const store = loadStore(fs, file); const group = store.groups[id];
  if (!group) return { ok: false, reason: 'no such group' };
  const role = roleOf(group, author);
  if (!role) return { ok: false, reason: 'only members can post to this group' };
  if (role === 'muted') return { ok: false, reason: 'muted members cannot post' };

  const category = groupCategory(group);
  const tags = [group.tag, ...(Array.isArray(post.tags) ? post.tags.map(slug) : [])].filter(Boolean);
  const uniqTags = [...new Set(tags)].slice(0, 10);
  const meta = {
    // Graphene `comment` fields the broadcaster fills in (category = HIVE community routing).
    parent_permlink: category,
    parent_author: post.parentAuthor ? acct(post.parentAuthor) : '',
    // json_metadata payload — group is first tag; `community` mirrors HIVE's community field.
    json_metadata: { app: 'melek/groups', community: group.account || undefined, group: group.id, tags: uniqTags },
  };
  const feedRef = { author, permlink, title: clamp(post.title, 200), ts: now(opts) };
  group.feed = group.feed || [];
  group.feed.push(feedRef);
  if (group.feed.length > KEEP_FEED) group.feed = group.feed.slice(-KEEP_FEED);
  saveStore(fs, file, store);
  return { ok: true, meta, feedRef, group: view(group) };
}

/** Recent posts tagged to a group, newest-first (the off-chain feed index; not the chain of record). */
export function listFeed(id, { limit = 50 } = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const group = loadStore(fs, file).groups[id];
  if (!group) return [];
  const cap = Math.max(1, Math.min(KEEP_FEED, limit));
  return (group.feed || []).slice(-cap).reverse();
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────
export function getGroup(id, opts = {}) { const { fs, file } = ctx(opts); return view(loadStore(fs, file).groups[id]); }
export function isMember(id, account, opts = {}) {
  const { fs, file } = ctx(opts); const group = loadStore(fs, file).groups[id];
  return !!(group && group.members[acct(account)]);
}
/** Every group an account belongs to (one identity, all its groups). */
export function groupsForAccount(account, opts = {}) {
  const { fs, file } = ctx(opts); const who = acct(account);
  return Object.values(loadStore(fs, file).groups).filter((g) => g.members[who]).map(view);
}
/** Browse joinable groups — open/apply/token are listed; invite-only is hidden from the directory. */
export function listGroups(opts = {}) {
  const { fs, file } = ctx(opts);
  return Object.values(loadStore(fs, file).groups)
    .filter((g) => g.joinPolicy !== 'invite')
    .map(view).sort((a, b) => b.memberCount - a.memberCount);
}

// ── CLI (guarded) — offline demo on a temp store ───────────────────────────────────────────────────
if (process.argv[1] && /groups\/model\.mjs$/.test(process.argv[1])) {
  const file = `/tmp/groups-demo-${process.pid}.json`;
  const o = { file };
  console.log('MELEK Groups — offline demo (HIVE-communities-style content groups):\n');
  const c = createGroup({ name: 'Plant Medicine', owner: 'hathor', kind: 'community', tag: 'plantmedicine' }, o);
  console.log('create :', c.group.id, `(${c.group.kind} "${c.group.name}", ${c.group.joinPolicy}, category=${c.group.category})`);
  console.log('join   :', addMember(c.group.id, 'alice', o).status, '+', addMember(c.group.id, 'bob', o).status);
  setRole(c.group.id, 'hathor', 'alice', 'mod', o);
  console.log('roles  :', getGroup(c.group.id, o).members.map((m) => `${m.account}=${m.role}`).join(', '));
  const p = postToGroup(c.group.id, { author: 'bob', permlink: 'my-first-post', title: 'Hello group' }, o);
  console.log('post   :', 'category=' + p.meta.parent_permlink, 'tags=' + p.meta.json_metadata.tags.join(','));
  console.log('feed   :', listFeed(c.group.id, {}, o).map((r) => `@${r.author}/${r.permlink}`).join(', '));
  console.log('remove :', removeMember(c.group.id, 'alice', 'bob', o).status, '(mod alice removes member bob)');
  console.log('mine   :', groupsForAccount('hathor', o).map((g) => `${g.name} (${g.kind})`).join(', '));
  try { (await import('node:fs')).unlinkSync(file); } catch {}
}

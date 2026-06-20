// pentecaust/model.mjs — Pentecaust Messaging: the OPEN, cross-game group primitive (Teams/Alliances/Clans).
//
// Operator (2026-06-20): "make our PM/DM system something like a game chat system, where a Clan or
// Team or some sort could be formed and they can chat in-game, out-of-game, or from different games…
// we'll need it for our later games." + "Alliance and other words can be used, make it OPEN though,
// it could just be like a 'Team'."
//
// PRANA's own design delegates ALL social/graph (follows, memberships, teams, chat) to MELEK — PRANA is
// the EVM game/DeFi L1, MELEK is the Graphene social L1. So the team + messaging layer lives HERE, keyed
// to a MELEK account name. That account is the ONE cross-game identity: the same person in Minecraft, the
// walking app, a PRANA strategy game, and the website is one member of one team with one chat.
//
// "OPEN" two ways, per the operator: (1) the LABEL is cosmetic and free — team | alliance | clan | crew |
// guild | squad, pick per game; (2) membership is OPEN-join by default (anyone can join instantly), with
// 'apply' (request → approve) and 'invite' (invite-only) also available. A team is never locked to one game.
//
// Persistence mirrors move-ledger.mjs: one JSON file, injectable fs, pure-ish helpers, soft-fail-never-throw,
// fully offline-testable. No keys, no chain writes here — this is the off-chain roster the games read.
//
//   import { createTeam, joinTeam, leaveTeam, kick, setRole, getTeam, teamsForAccount } from './model.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('TEAMS_DATA', join(process.cwd(), 'data', 'teams.json'));

// Cosmetic labels a group can wear (the operator's "Alliance and other words"). 'team' is the default.
export const KINDS = ['team', 'alliance', 'clan', 'crew', 'guild', 'squad', 'party'];
// Membership models. 'open' = join instantly (the default the operator asked for).
export const OPENNESS = ['open', 'apply', 'invite'];
// Role hierarchy. Higher rank can manage lower; a member can only manage themselves (leave).
export const ROLES = { leader: 3, officer: 2, member: 1 };
const MAX_MEMBERS_DEFAULT = Number(env('TEAMS_MAX_MEMBERS', '200')) || 200;

const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());

// ── injectable fs + store (same shape discipline as move-ledger) ────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { teams: {} };
  try { const o = JSON.parse(raw); return o && o.teams ? o : { teams: {} }; } catch { return { teams: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}
function uniqueId(store, base) {
  const b = base || 'team';
  if (!store.teams[b]) return b;
  for (let i = 2; i < 10000; i++) { const id = `${b}-${i}`; if (!store.teams[id]) return id; }
  return `${b}-${Date.now()}`;
}
function cleanTag(tag) {
  const t = String(tag || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return t.length >= 2 ? t : null;
}
export function roleOf(team, account) { return team && team.members && team.members[account] ? team.members[account].role : null; }
function rank(role) { return ROLES[role] || 0; }
// Can `actor` manage `target` in this team? Officer+ and strictly outranks the target (leader outranks all).
function canManage(team, actor, target) {
  const ar = rank(roleOf(team, actor));
  if (ar < ROLES.officer) return false;
  return ar > rank(roleOf(team, target));
}

// Public, store-free view of a team (safe to hand to a client).
export function view(team) {
  if (!team) return null;
  return {
    id: team.id, name: team.name, tag: team.tag || null, kind: team.kind, openness: team.openness,
    owner: team.owner, game: team.game || null, motd: team.motd || '', maxMembers: team.maxMembers,
    created: team.created,
    members: Object.entries(team.members).map(([account, m]) => ({ account, role: m.role, joined: m.joined }))
      .sort((a, b) => rank(b.role) - rank(a.role) || a.joined - b.joined),
    memberCount: Object.keys(team.members).length,
    pending: Object.keys(team.applicants || {}).length,
  };
}

// ── operations ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Found a team. The owner becomes its leader. PURE result + persisted. Never throws.
 * @param {{name, owner, kind?, openness?, tag?, game?, maxMembers?}} spec
 */
export function createTeam(spec = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const owner = String(spec.owner || '').toLowerCase();
  if (!validAccountName(owner)) return { ok: false, reason: 'owner must be a valid MELEK account name' };
  const name = String(spec.name || '').trim().slice(0, 48);
  if (name.length < 2) return { ok: false, reason: 'team name too short' };
  const kind = KINDS.includes(spec.kind) ? spec.kind : 'team';
  const openness = OPENNESS.includes(spec.openness) ? spec.openness : 'open';
  const max = Math.min(5000, Math.max(2, Number(spec.maxMembers) || MAX_MEMBERS_DEFAULT));
  const t = now(opts);

  const store = loadStore(fs, file);
  const id = uniqueId(store, slug(name) || 'team');
  const team = {
    id, name, tag: cleanTag(spec.tag), kind, openness, owner,
    game: spec.game ? slug(spec.game) : null, maxMembers: max, motd: '',
    members: { [owner]: { role: 'leader', joined: t } }, applicants: {}, invites: {}, created: t,
  };
  store.teams[id] = team;
  saveStore(fs, file, store);
  return { ok: true, team: view(team) };
}

/**
 * Join a team. Honors openness: open → joined instantly; apply → request queued; invite → only if invited.
 * @returns {{ok, status:'joined'|'applied'|'invited-only'|..., team?}}
 */
export function joinTeam(id, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'account must be a valid MELEK account name' };
  const store = loadStore(fs, file);
  const team = store.teams[id];
  if (!team) return { ok: false, reason: 'no such team' };
  if (team.members[who]) return { ok: true, status: 'already-member', team: view(team) };
  if (Object.keys(team.members).length >= team.maxMembers) return { ok: false, reason: 'team is full' };
  const t = now(opts);

  if (team.openness === 'open' || team.invites[who]) {
    delete team.invites[who]; delete team.applicants[who];
    team.members[who] = { role: 'member', joined: t };
    saveStore(fs, file, store);
    return { ok: true, status: 'joined', team: view(team) };
  }
  if (team.openness === 'apply') {
    team.applicants[who] = t; saveStore(fs, file, store);
    return { ok: true, status: 'applied', team: view(team) };
  }
  return { ok: false, status: 'invite-only', reason: 'this team is invite-only' };
}

/** Officer+ approves a pending applicant (apply-mode) into membership. */
export function approve(id, actor, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase(); const by = String(actor || '').toLowerCase();
  const store = loadStore(fs, file); const team = store.teams[id];
  if (!team) return { ok: false, reason: 'no such team' };
  if (rank(roleOf(team, by)) < ROLES.officer) return { ok: false, reason: 'not allowed (officer+ only)' };
  if (!team.applicants[who]) return { ok: false, reason: 'no such applicant' };
  if (Object.keys(team.members).length >= team.maxMembers) return { ok: false, reason: 'team is full' };
  delete team.applicants[who];
  team.members[who] = { role: 'member', joined: now(opts) };
  saveStore(fs, file, store);
  return { ok: true, status: 'joined', team: view(team) };
}

/** Officer+ invites an account (for invite-only teams; the invitee then join()s). */
export function invite(id, actor, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase(); const by = String(actor || '').toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'account must be a valid MELEK account name' };
  const store = loadStore(fs, file); const team = store.teams[id];
  if (!team) return { ok: false, reason: 'no such team' };
  if (rank(roleOf(team, by)) < ROLES.officer) return { ok: false, reason: 'not allowed (officer+ only)' };
  team.invites[who] = now(opts); saveStore(fs, file, store);
  return { ok: true, status: 'invited', team: view(team) };
}

/** Leave a team. If the leader leaves, leadership passes to the most senior remaining member; empty teams disband. */
export function leaveTeam(id, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase();
  const store = loadStore(fs, file); const team = store.teams[id];
  if (!team) return { ok: false, reason: 'no such team' };
  if (!team.members[who]) return { ok: false, reason: 'not a member' };
  const wasLeader = roleOf(team, who) === 'leader';
  delete team.members[who];
  const remaining = Object.keys(team.members);
  if (remaining.length === 0) { delete store.teams[id]; saveStore(fs, file, store); return { ok: true, status: 'disbanded' }; }
  if (wasLeader) {
    // promote the most senior (then earliest-joined) remaining member to leader
    const heir = remaining.sort((a, b) => rank(team.members[b].role) - rank(team.members[a].role) || team.members[a].joined - team.members[b].joined)[0];
    team.members[heir].role = 'leader'; team.owner = heir;
  }
  saveStore(fs, file, store);
  return { ok: true, status: 'left', team: view(team), newLeader: wasLeader ? team.owner : undefined };
}

/** Officer+ removes a lower-ranked member. Cannot kick a peer or a superior. */
export function kick(id, actor, account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase(); const by = String(actor || '').toLowerCase();
  const store = loadStore(fs, file); const team = store.teams[id];
  if (!team) return { ok: false, reason: 'no such team' };
  if (!team.members[who]) return { ok: false, reason: 'not a member' };
  if (who === by) return { ok: false, reason: 'use leave, not kick, on yourself' };
  if (!canManage(team, by, who)) return { ok: false, reason: 'not allowed (need a higher role than the target)' };
  delete team.members[who];
  saveStore(fs, file, store);
  return { ok: true, status: 'kicked', team: view(team) };
}

/** Leader sets a member's role (leader|officer|member). Only the leader may change roles. */
export function setRole(id, actor, account, role, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase(); const by = String(actor || '').toLowerCase();
  if (!ROLES[role]) return { ok: false, reason: 'unknown role' };
  const store = loadStore(fs, file); const team = store.teams[id];
  if (!team) return { ok: false, reason: 'no such team' };
  if (roleOf(team, by) !== 'leader') return { ok: false, reason: 'only the leader can set roles' };
  if (!team.members[who]) return { ok: false, reason: 'not a member' };
  if (who === by) return { ok: false, reason: 'transfer leadership via setRole on another member' };
  if (role === 'leader') { team.members[by].role = 'officer'; team.owner = who; } // hand off the crown
  team.members[who].role = role;
  saveStore(fs, file, store);
  return { ok: true, team: view(team) };
}

/** Leader/officer sets the team's message-of-the-day (shown atop the team chat). */
export function setMotd(id, actor, text, opts = {}) {
  const { fs, file } = ctx(opts);
  const by = String(actor || '').toLowerCase();
  const store = loadStore(fs, file); const team = store.teams[id];
  if (!team) return { ok: false, reason: 'no such team' };
  if (rank(roleOf(team, by)) < ROLES.officer) return { ok: false, reason: 'not allowed (officer+ only)' };
  team.motd = String(text || '').slice(0, 280);
  saveStore(fs, file, store);
  return { ok: true, team: view(team) };
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────
export function getTeam(id, opts = {}) { const { fs, file } = ctx(opts); return view(loadStore(fs, file).teams[id]); }
export function isMember(id, account, opts = {}) {
  const { fs, file } = ctx(opts); const team = loadStore(fs, file).teams[id];
  return !!(team && team.members[String(account || '').toLowerCase()]);
}
/** Every team an account belongs to (cross-game — one identity, all its teams). */
export function teamsForAccount(account, opts = {}) {
  const { fs, file } = ctx(opts); const who = String(account || '').toLowerCase();
  return Object.values(loadStore(fs, file).teams).filter((t) => t.members[who]).map(view);
}
/** Browse joinable teams (open + apply are listed; invite-only are hidden from the directory). */
export function listTeams(opts = {}) {
  const { fs, file } = ctx(opts);
  return Object.values(loadStore(fs, file).teams)
    .filter((t) => t.openness !== 'invite')
    .map(view).sort((a, b) => b.memberCount - a.memberCount);
}

// ── CLI (guarded) — offline demo on a temp store ───────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('model.mjs') && /teams\/model\.mjs$/.test(process.argv[1])) {
  const file = `/tmp/teams-demo-${process.pid}.json`;
  const o = { file };
  console.log('MELEK Teams — offline demo (open, cross-game groups):\n');
  const c = createTeam({ name: 'Van Kush Family', owner: 'ryan', kind: 'alliance', tag: 'VKF' }, o);
  console.log('create:', c.team.id, `(${c.team.kind} "${c.team.name}" [${c.team.tag}], ${c.team.openness})`);
  console.log('join  :', joinTeam(c.team.id, 'steve', o).status, '+', joinTeam(c.team.id, 'alex', o).status);
  setRole(c.team.id, 'ryan', 'steve', 'officer', o);
  console.log('roles :', getTeam(c.team.id, o).members.map((m) => `${m.account}=${m.role}`).join(', '));
  console.log('kick  :', kick(c.team.id, 'steve', 'alex', o).status, '(officer steve removes member alex)');
  console.log('mine  :', teamsForAccount('steve', o).map((t) => `${t.name} (${t.kind})`).join(', '));
  try { (await import('node:fs')).unlinkSync(file); } catch {}
}

import { COACHES, COMPETITIONS, INJURIES, MATCHES, PLAYERS, USERS_INITIAL } from "../data/mock.js";

// ── GLOBAL CSS ──────────────────────────────────────────

// ══════════════════════════════════════════════════════
//  RBAC — single source of truth for data access.
//  Enforced client-side here; maps 1:1 to Postgres Row-Level
//  Security in production (scope → RLS predicate, deny → column
//  grants). UI nav-gating is courtesy; THIS is the security layer.
// ══════════════════════════════════════════════════════

// 6 tiers · 17 roles (reconciled — edit here and policy follows)
const RBAC_TIERS = [
  { id:"platform",    label:"Platform",          roles:["superadmin","platformsupport"] },
  { id:"leadership",  label:"School Leadership",  roles:["headmaster","sportsmaster","schooladmin","financeadmin"] },
  { id:"coaching",    label:"Coaching",           roles:["headcoach","coach","assistant","analyst"] },
  { id:"operations",  label:"Operations",         roles:["scorer","medical","groundskeeper","driver"] },
  { id:"participant", label:"Participant",        roles:["player"] },
  { id:"external",    label:"External",           roles:["parent","spectator"] },
];

// Sensitive field groups — referenced by name in the policy's `deny`.
const RBAC_FIELDS = {
  pii:      ["email","phone","born","hometown","houseAtSchool","address","guardian","height","weight"],
  clinical: ["notes","physio"],
};

const SCOPE_RANK = { none:0, own:1, team:2, school:3, all:4 };

// role → { can:actions, scope:default, only?:[resources], scopes?:{res:scope}, deny?:{res|"*":[groups]} }
const POLICY = {
  superadmin:      { can:"crud", scope:"all" },
  platformsupport: { can:"r",    scope:"all",    deny:{ "*":["pii"], injuries:["clinical"] } },
  headmaster:      { can:"ru",   scope:"school", deny:{ injuries:["clinical"] } },
  sportsmaster:    { can:"crud", scope:"school", only:["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","injuries","skills","training","logistics","fields","staff","calendar","management","notifications","settings","rulebook","scoring"], deny:{ injuries:["clinical"] } },
  schooladmin:     { can:"crud", scope:"school", only:["dashboard","matches","competitions","squad","players","profiles","analytics","injuries","logistics","fields","staff","calendar","management","notifications","settings"], deny:{ injuries:["clinical"] } },
  financeadmin:    { can:"crud", scope:"school", only:["dashboard","profiles","finance","calendar","management","notifications","settings"], deny:{ profiles:["born","houseAtSchool","height","weight","guardian"] } },
  headcoach:       { can:"crud", scope:"school", only:["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications","scoring"] },
  coach:           { can:"cru",  scope:"team",   only:["dashboard","matches","squad","players","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications","scoring"] },
  assistant:       { can:"ru",   scope:"team",   only:["dashboard","matches","squad","players","profiles","skills","training","injuries","calendar","notifications","scoring"], deny:{ injuries:["clinical"] } },
  analyst:         { can:"r",    scope:"school", only:["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","skills","calendar"], deny:{ "*":["pii"] } },
  scorer:          { can:"cru",  scope:"team",   only:["dashboard","matches","calendar","notifications","scoring"] },
  medical:         { can:"crud", scope:"school", only:["dashboard","injuries","players","profiles","training","squad","calendar","notifications"] },
  groundskeeper:   { can:"ru",   scope:"school", only:["dashboard","fields","matches","calendar","notifications","management"] },
  driver:          { can:"r",    scope:"school", only:["dashboard","logistics","matches","calendar","notifications"] },
  player:          { can:"r",    scope:"own",    only:["dashboard","matches","profiles","analytics","skills","training","injuries","calendar","notifications"] },
  parent:          { can:"r",    scope:"own",    only:["dashboard","matches","competitions","profiles","injuries","logistics","calendar","notifications"],
                     scopes:{ matches:"school", competitions:"school", leagues:"school", calendar:"school", logistics:"team" } },
  spectator:       { can:"r",    scope:"school", only:["dashboard","matches","competitions","leagues","analytics","calendar"], deny:{ "*":["pii"] } },
};

function rbacExpandDeny(deny, resource){
  if(!deny) return [];
  const groups = [...(deny["*"]||[]), ...(deny[resource]||[])];
  return groups.flatMap(g => RBAC_FIELDS[g] || [g]);
}

// Central decision: may `role` do `action` on `resource`?
function can(role, resource, action="r"){
  if(role==="superadmin") return { allowed:true, scope:"all", deny:[] };
  const p = POLICY[role];
  if(!p) return { allowed:false, scope:"none", deny:[] };
  if(p.only && !p.only.includes(resource)) return { allowed:false, scope:"none", deny:[] };
  if(!p.can.includes(action[0])) return { allowed:false, scope:p.scope, deny:[] };
  const scope = (p.scopes && p.scopes[resource]) || p.scope || "none";
  return { allowed:true, scope, deny:rbacExpandDeny(p.deny, resource) };
}

// Live-scoring capability. Opt-in: the role must explicitly list the
// "scoring" resource with a create/update grant. superadmin bypasses.
// Roles without an `only` list (e.g. headmaster) are deliberately excluded.
function canScore(role){
  if(role==="superadmin") return true;
  const p=POLICY[role];
  return !!(p && p.only && p.only.includes("scoring") && /[cu]/.test(p.can));
}

// Security context for a role (mock: resolved from USERS/COACHES/PLAYERS).
function principalForRole(role){
  const u = USERS_INITIAL.find(x => x.role === role) || null;
  const coach  = u && u.coachId ? COACHES.find(c => c.id === u.coachId) : null;
  const player = u && u.player  ? PLAYERS.find(p => p.id === u.player)  : null;
  const teams  = coach ? [coach.team] : player ? [player.team] : [];
  return { role, userId: u ? u.id : "syn_"+role, playerId: u ? u.player : null,
           staffId: u ? u.staffId : null, coachId: u ? u.coachId : null,
           childIds: (u && u.player) ? [u.player] : [], teams, school:"HIL" };
}

function rbacAnchors(resource, row){
  if(resource==="injuries"){
    const pl = PLAYERS.find(p => p.id === row.player) || {};
    return { team: pl.team, school: pl.school || "HIL", ownId: row.player };
  }
  return { team: row.team, school: row.school || "HIL", ownId: row.id };
}

function inScope(scope, principal, resource, row){
  if(scope==="all")  return true;
  if(scope==="none") return false;
  const a = rbacAnchors(resource, row);
  if(scope==="school") return a.school === principal.school;
  if(scope==="team")   return principal.teams.includes(a.team);
  if(scope==="own")    return principal.childIds.includes(a.ownId) || a.ownId === principal.playerId;
  return false;
}

function rbacStrip(row, deny){
  if(!deny || !deny.length) return row;
  const out = { ...row };
  deny.forEach(f => { if(f in out) out[f] = null; });
  return out;
}

// The choke-point every view should read through. Today it wraps the mock
// constants; in production it becomes the authenticated API call.
const RBAC_SOURCE = {
  players: () => PLAYERS, injuries: () => INJURIES, profiles: () => PLAYERS,
  matches: () => MATCHES, competitions: () => COMPETITIONS,
};

function getData(resource, principal){
  const fn = RBAC_SOURCE[resource];
  const src = fn ? fn() : [];
  const { allowed, scope, deny } = can(principal.role, resource, "r");
  if(!allowed) return [];
  return src.filter(row => inScope(scope, principal, resource, row))
            .map(row => rbacStrip(row, deny));
}

// Single-record variant (returns null if the role may not read the resource).
function filterRecord(role, resource, record){
  if(!record) return record;
  const { allowed, deny } = can(role, resource, "r");
  if(!allowed) return null;
  return rbacStrip(record, deny);
}

export { POLICY, RBAC_FIELDS, RBAC_SOURCE, RBAC_TIERS, SCOPE_RANK, can, canScore, filterRecord, getData, inScope, principalForRole, rbacAnchors, rbacExpandDeny, rbacStrip };

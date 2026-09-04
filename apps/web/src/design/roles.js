import { roleGrants } from "@scrbrd/policy/roles";
import { LEGACY_ROLE_NAMES } from "../rbac/legacy-roles.js";

/* ═══════════════════════════════════════════════════════
   ROLE IDENTITY
   ═══════════════════════════════════════════════════════

   ONE VOCABULARY. This file used to name seventeen roles the authorization
   model had never heard of — superadmin, headmaster, sportsmaster, headcoach —
   while fourteen roles that DO carry permissions had no visual identity at
   all. Signing in as a director of sport produced ROLES[undefined] and an
   empty shell: no navigation, no colour, no name.

   The policy's twenty-two roles are the vocabulary now, because they are the
   ones that decide anything. The old names live on as aliases below so the
   demonstration accounts keep working.

   COLOUR CARRIES MEANING, IN TWO DIMENSIONS.
   Family says which domain of access a role sits in; position within the
   family says how senior it is. Both are legible at a glance, which is the
   whole justification for giving roles colours at all — the audit's §4.2
   calls role colour a permission-context signal, and a signal that repeats
   itself is not one.

   The audit found six colliding pairs across seventeen roles, every collision
   between an original role and one added in a merge: the new ones were given
   recycled colours. Super Admin and Headmaster were identical while having
   materially different access to clinical records. Driver and Finance Admin
   were identical. The signal was ambiguous exactly where the access
   differences were largest.

   HOW THESE VALUES WERE CHOSEN — all of it checked, none of it eyeballed:
     - every colour clears WCAG AA (4.5:1) against all five surfaces, because
       role colour is used as TEXT; the weakest is 5.1:1
     - all twenty-two are distinct: minimum ΔE76 of 10.4 across all 231 pairs
     - siblings share a hue and differ in lightness, so Coach and Assistant
       Coach look related — which they are — without looking the same
     - the off-palette #22d3ee is gone; so is every recycled value

   apps/web/test/design.test.mjs re-derives all of this on every run. A new
   role with a borrowed colour, or one that fails contrast, fails the build.
*/

const ROLE_IDENTITY = {
  // platform — operating the platform itself
  platformadmin:          { label:"Platform Admin", icon:"⚡", color:"#c5adfa", family:"platform" },  // 7.66:1
  // governance — running an institution
  principal:              { label:"Principal", icon:"🎓", color:"#8a8cf4", family:"governance" },  // 5.1:1
  directorofsport:        { label:"Director of Sport", icon:"🏅", color:"#a1a3f7", family:"governance" },  // 6.5:1
  schooladmin:            { label:"School Admin", icon:"🏫", color:"#b9baf9", family:"governance" },  // 8.18:1
  sportsadmin:            { label:"Sports Admin", icon:"📋", color:"#d0d1fb", family:"governance" },  // 10.13:1
  // coaching — coaching a side
  coach:                  { label:"Coach", icon:"🎯", color:"#0fae79", family:"coaching" },  // 5.25:1
  assistantcoach:         { label:"Assistant Coach", icon:"🤝", color:"#11ca8d", family:"coaching" },  // 7.04:1
  teammanager:            { label:"Team Manager", icon:"📣", color:"#14eba4", family:"coaching" },  // 9.6:1
  // playing — playing, or belonging to someone who does
  player:                 { label:"Player", icon:"🏏", color:"#08a3e8", family:"playing" },  // 5.29:1
  guardian:               { label:"Parent / Guardian", icon:"👪", color:"#3fbff8", family:"playing" },  // 7.15:1
  spectator:              { label:"Spectator", icon:"👁", color:"#8ed9fb", family:"playing" },  // 9.62:1
  // Not a job — it is the pupil's own file. A `selfaccess` assignment names one
  // person in assignment_subject and carries the capabilities that read their
  // medical, PII and development records, scoped to that one player row. It
  // rarely appears in a role switcher, but the model has 23 roles and every one
  // of them needs an identity or the shell renders a blank for it.
  selfaccess:             { label:"My Record", icon:"🪪", color:"#f472b6", family:"playing" },  // 6.00:1
  // match — officiating and recording a match
  scorer:                 { label:"Scorer", icon:"✍️", color:"#d88b09", family:"match" },  // 5.44:1
  official:               { label:"Match Official", icon:"🧭", color:"#f8b94f", family:"match" },  // 8.6:1
  // analysis — reading the game
  analyst:                { label:"Performance Analyst", icon:"📈", color:"#f9761a", family:"analysis" },  // 5.45:1
  scout:                  { label:"Scout", icon:"🔎", color:"#fcb483", family:"analysis" },  // 8.56:1
  // clinical — clinical care
  medical:                { label:"Medical Staff", icon:"⚕️", color:"#f99fae", family:"clinical" },  // 7.57:1
  // operations — getting people and grounds ready
  transportcoordinator:   { label:"Transport Coordinator", icon:"🗺️", color:"#13aa9a", family:"operations" },  // 5.17:1
  driver:                 { label:"Driver", icon:"🚌", color:"#16cab7", family:"operations" },  // 7.26:1
  facilities:             { label:"Groundskeeper", icon:"🌿", color:"#22e7d1", family:"operations" },  // 9.58:1
  // commercial — money
  finance:                { label:"Finance Admin", icon:"💰", color:"#83cb16", family:"commercial" },  // 7.51:1
  // media — telling people about it
  media:                  { label:"Media", icon:"📰", color:"#f59ec9", family:"media" },  // 7.58:1
  // competition — running a competition
  competitionadmin:       { label:"Competition Admin", icon:"🏆", color:"#07c8e9", family:"competition" },  // 7.46:1
};

/* ── Navigation, derived from capabilities ──────────────────────────
   The nav used to be a hand-written list per role, which is a second place
   for authority to live and a second place for it to drift: a role could gain
   a capability and never gain the menu entry, or keep an entry long after the
   capability went. Both happened.

   A destination is offered when the role holds the capability that governs
   what is on it. This is presentation only — every view behind these entries
   re-authorises server-side against the person's assignments, so a wrong
   answer here shows the wrong menu, never the wrong data.

   `null` means "everyone": your own dashboard, your own alerts, your own
   settings, and the rulebook, which is reference material.
*/
const NAV_CAPABILITY = {
  dashboard:     null,
  matches:       "fixture.read",
  competitions:  "competition.read",
  leagues:       "competition.read",
  squad:         "team.read",
  profiles:      "player.profile.read",
  analytics:     "analytics.read",
  skills:        "player.development.read",
  training:      "player.development.read",
  injuries:      "medical.status.read",
  logistics:     "transport.read",
  calendar:      "fixture.read",
  fields:        "facility.read",
  staff:         "user.read",
  notifications: null,
  settings:      null,
  management:    "user.role.assign",
  rulebook:      null,
  pitchdeck:     "platform.tenant.manage",
};

/** The order destinations appear in. Dashboard first, settings last. */
const NAV_ORDER = Object.keys(NAV_CAPABILITY);

const navFor = (role) =>
  NAV_ORDER.filter((k) => {
    const cap = NAV_CAPABILITY[k];
    return cap === null || roleGrants(role, cap);
  });

/* ── Legacy names ───────────────────────────────────────────────────
   The demonstration accounts and the seeded fixtures still speak the old
   vocabulary. Mapping rather than renaming keeps them working.

   The mapping is DERIVED from rbac/index.js, which already had to declare it
   in order to hand a legacy name its assignments. Two copies would drift, and
   the symptom would be a login that works with no navigation — which is the
   bug this whole file is fixing. Names that are already policy roles are
   filtered out: `coach` is not an alias for anything.
*/
const LEGACY_ROLE_ALIAS = Object.fromEntries(
  Object.entries(LEGACY_ROLE_NAMES).filter(([legacy]) => !ROLE_IDENTITY[legacy]),
);

/** Resolve any role name — current or legacy — to the policy vocabulary. */
const canonicalRole = (r) => (ROLE_IDENTITY[r] ? r : LEGACY_ROLE_ALIAS[r] ?? r);

/**
 * The shape the shell reads: label, icon, colour and nav, for every role in
 * the policy AND every legacy name that maps onto one. Built once.
 */
const ROLES = Object.fromEntries([
  ...Object.entries(ROLE_IDENTITY).map(([r, id]) => [r, { ...id, nav: navFor(r) }]),
  ...Object.entries(LEGACY_ROLE_ALIAS).map(([legacy, real]) => [
    legacy, { ...ROLE_IDENTITY[real], nav: navFor(real), aliasOf: real },
  ]),
]);

/** Roles grouped by access domain — for a legend, or a role picker. */
const ROLE_FAMILIES = Object.entries(ROLE_IDENTITY).reduce((acc, [r, id]) => {
  (acc[id.family] ??= []).push(r);
  return acc;
}, {});

const NAV_META = {
  dashboard:    { icon:"⬡",  label:"Dashboard"    },
  matches:      { icon:"🏏",  label:"Match Centre" },
  competitions: { icon:"🏆",  label:"Competitions" },
  leagues:      { icon:"📋",  label:"Leagues"      },
  squad:        { icon:"👥",  label:"Squad"        },
  profiles:     { icon:"👤",  label:"Profiles"     },
  analytics:    { icon:"📊",  label:"Analytics"    },
  skills:       { icon:"🎯",  label:"Skills"       },
  training:     { icon:"💪",  label:"Training"     },
  injuries:     { icon:"🏥",  label:"Injuries"     },
  logistics:    { icon:"🚌",  label:"Logistics"    },
  calendar:     { icon:"📅",  label:"Calendar"     },
  fields:       { icon:"🌿",  label:"Fields"       },
  staff:        { icon:"🔧",  label:"Staff"        },
  notifications:{ icon:"🔔",  label:"Alerts"       },
  settings:     { icon:"⚙️",  label:"Settings"     },
  management:   { icon:"🛠️",  label:"Management"   },
  rulebook:     { icon:"📖",  label:"Rulebook"     },
  pitchdeck:    { icon:"📐",  label:"Pitch Deck"   },
};

export { NAV_META, ROLES, ROLE_IDENTITY, ROLE_FAMILIES, NAV_CAPABILITY, canonicalRole, navFor };

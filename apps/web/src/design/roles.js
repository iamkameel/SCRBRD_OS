import { roleGrants } from "@scrbrd/policy/roles";
import { themeName } from "./tokens.js";

/* ═══════════════════════════════════════════════════════
   ROLE IDENTITY
   ═══════════════════════════════════════════════════════

   ONE VOCABULARY. This file used to name seventeen roles the authorization
   model had never heard of — superadmin, headmaster, sportsmaster, headcoach —
   while fourteen roles that DO carry permissions had no visual identity at
   all. Signing in as a director of sport produced ROLES[undefined] and an
   empty shell: no navigation, no colour, no name.

   The policy's roles are the vocabulary now, because they are the ones that
   decide anything. The old names do not live on even as aliases (SCRBRD-027):
   every sign-in and onboarding entry point speaks a real policy role name
   directly, so there is nothing left to translate.

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

   TWO VALUES PER ROLE (2.1). The colours below were chosen for contrast
   UNDER LIGHTS — every one is a light tint that reads on near-black and
   would all but vanish on the Daylight whitewash (Coach's green is 2.86:1 on
   white, 2.28:1 on a hover row). ROLE_DAYLIGHT, after the table, is each role's daylight value:
   the same family hue, deepened until it reads on the DARKEST daylight
   surface, with siblings still stepping in lightness. `color` is a getter
   that answers for the theme in force, so every screen that reads
   ROLES[r].color is right in both without knowing there are two.
*/

const ROLE_IDENTITY = {
  // platform — operating the platform itself
  // The owner's key sits first and reads gold, because it is not a job at a
  // school and should not look like one. Gold is 21.6 dE from its nearest
  // neighbour (Match Official) and 8.83:1 on the darkest surface, so it clears
  // both bars the suite holds with room to spare — checked, not chosen by eye.
  superadmin:             { label:"Super Admin", icon:"🗝️", color:"#f5c518", family:"platform" },  // 8.83:1
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
  // A pupil holds `player` for the things about the team and `selfaccess`
  // for his own record; the two together are the pupil. `also` says so, so
  // the persona's menu (and the demo's) carries his own screens without the
  // team role having to hold a capability across the side.
  player:                 { label:"Player", icon:"🏏", color:"#08a3e8", family:"playing", also:["selfaccess"] },  // 5.29:1
  guardian:               { label:"Parent / Guardian", icon:"👪", color:"#3fbff8", family:"playing" },  // 7.15:1
  spectator:              { label:"Spectator", icon:"👁", color:"#8ed9fb", family:"playing" },  // 9.62:1
  // Not a job — it is the pupil's own file. A `selfaccess` assignment names one
  // person in assignment_subject and carries the capabilities that read their
  // medical, PII and development records, scoped to that one player row. It
  // rarely appears in a role switcher, but the model has 23 roles and every one
  // of them needs an identity or the shell renders a blank for it.
  selfaccess:             { label:"My Record", icon:"🪪", color:"#f472b6", family:"playing" },  // 6.00:1
  // A temporary, single-player grant from another coach — not a job anyone
  // holds, but a role in the model, and every role in the model needs an
  // identity or the shell renders a blank for it. Deliberately the greyest
  // colour in the palette: it is borrowed access, and it should not look like
  // a position at the school.
  enquiry:                { label:"Enquiry Access", icon:"🔑", color:"#a1a1aa", family:"admin" },  // 6.20:1
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
  // SCRBRD-030 split the old `finance` bundle: this is the commercial half,
  // sponsorship.finance.read included, kept out of the school office's own
  // grantable list the same way finance itself is. Same family as finance —
  // both are "money" — a different hue so the two are never mistaken for one
  // another: 11.55 dE from its nearest neighbour (Super Admin's gold) and
  // 6.69:1 on the darkest surface, checked, not chosen by eye.
  sponsorship:            { label:"Sponsorship", icon:"🤝", color:"#d1ae00", family:"commercial" },  // 6.69:1
  // media — telling people about it
  media:                  { label:"Media", icon:"📰", color:"#f59ec9", family:"media" },  // 7.58:1
  // competition — running a competition
  competitionadmin:       { label:"Competition Admin", icon:"🏆", color:"#07c8e9", family:"competition" },  // 7.46:1
};

/**
 * Each role's colour in DAYLIGHT. Same checks as the table above, against the
 * daylight surfaces (the ratio is on the darkest of them, #e3e7dd): every one
 * clears 4.5:1, and the closest pair is 8.9 dE apart (Assistant Coach and
 * Team Manager, siblings in one family). Designed in CIELAB lightness /
 * chroma / hue — one hue per family, siblings a lightness step apart — then
 * darkened in L* only where a value fell short of 4.55:1.
 */
const ROLE_DAYLIGHT = {
  superadmin:           "#6d5800",  // 5.50:1
  platformadmin:        "#763f81",  // 5.98:1
  principal:            "#38308a",  // 8.55:1
  directorofsport:      "#48418d",  // 6.93:1
  schooladmin:          "#575290",  // 5.55:1
  sportsadmin:          "#63618f",  // 4.60:1
  coach:                "#00491d",  // 8.49:1
  assistantcoach:       "#005e2c",  // 6.35:1
  teammanager:          "#007340",  // 4.75:1
  player:               "#004785",  // 7.47:1
  guardian:             "#005b8c",  // 5.82:1
  spectator:            "#006e92",  // 4.59:1
  selfaccess:           "#92175e",  // 6.68:1
  enquiry:              "#4b4e52",  // 6.67:1
  scorer:               "#743900",  // 7.19:1
  official:             "#905a16",  // 4.57:1
  analyst:              "#9c3407",  // 5.76:1
  scout:                "#98552e",  // 4.56:1
  medical:              "#992d3f",  // 5.98:1
  transportcoordinator: "#004844",  // 8.33:1
  driver:               "#005d56",  // 6.20:1
  facilities:           "#00736a",  // 4.57:1
  finance:              "#34650b",  // 5.56:1
  sponsorship:          "#464a00",  // 7.47:1
  media:                "#8e3e7c",  // 5.35:1
  competitionadmin:     "#00626d",  // 5.64:1
};

// `color` answers for the theme in force. A getter, so a screen that read the
// colour an hour ago under lights reads the daylight one on its next render.
const colourFor = (r, floodlit) => ({
  enumerable: true, configurable: true,
  get: () => (themeName() === "daylight" ? ROLE_DAYLIGHT[r] ?? floodlit : floodlit),
});
for (const [r, id] of Object.entries(ROLE_IDENTITY)) Object.defineProperty(id, "color", colourFor(r, id.color));

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
  news:          "news.read",
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
  // The read side of match_duties' own union — each sub-select carries its
  // own capability regardless of this entry, so a role sees no more here
  // than it would opening one fixture's duty roster at a time.
  readiness:     "fixture.read",
  // The same capability the appointments themselves are read under. Nav mirrors
  // the API; the API is the security — a destination that appears for somebody
  // who may not read a fixture would show them an empty screen, not a leak,
  // but it would still be the browser making a claim about authority.
  officials:     "fixture.read",
  staff:         "user.read",
  // The read capability the sponsors themselves are read under, not the manage
  // one: a director of sport who may see which boards are committed but may
  // not sign a brand still needs the destination. What they can DO once there
  // is decided by the same capability twice — once for the button, once, and
  // authoritatively, by the INSERT policy.
  sponsors:      "sponsorship.read",
  notifications: null,
  settings:      null,
  management:    "user.role.assign",
  // The modules screen. Gated by the capability that can HIDE a module rather
  // than the one that can grant one, because that is the wider of the two — a
  // platform administrator holds both. Not itself a switchable module: a
  // destination you can turn off and then cannot reach to turn back on is a
  // destination nobody can recover.
  modules:       "school.feature.manage",
  rulebook:      null,
  pitchdeck:     "platform.tenant.manage",
};

/* ── Grouping ───────────────────────────────────────────────────────
   Twenty-two destinations in one column is a list to be read, not a menu to
   be scanned. Each belongs to one group, and the groups are ordered by how
   often the person at the ground needs them: the fixture first, the people
   in it, their development, what it takes to get them there, then the
   administration, then the person's own screens last.

   This is the ONLY ordered structure. NAV_ORDER is derived from it, so a
   destination cannot be in the capability map and missing from the menu, or
   drawn twice: the design test checks both directions. Grouping is
   presentation — a group with nothing in it for this role is not drawn, and
   nothing here adds a destination the capability map withheld.
*/
const NAV_GROUPS = [
  { key:"play",    label:"Play",       items:["dashboard","news","matches","calendar","competitions","leagues","officials"] },
  { key:"people",  label:"People",     items:["squad","profiles","injuries","staff"] },
  { key:"develop", label:"Develop",    items:["analytics","skills","training"] },
  { key:"operate", label:"Operate",    items:["logistics","fields","sponsors","readiness"] },
  { key:"admin",   label:"Administer", items:["management","modules","pitchdeck"] },
  { key:"you",     label:"You",        items:["notifications","settings","rulebook"] },
];

/** destination → group key */
const NAV_GROUP = Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items.map((k) => [k, g.key])));

/** The order destinations appear in: group by group, dashboard first. */
const NAV_ORDER = NAV_GROUPS.flatMap((g) => g.items);

/**
 * A role's (already-narrowed) destinations, arranged for drawing:
 * `[{ key, label, items }]` in group order, empty groups left out. The order
 * within a group is the group's, not the caller's, so two shells that pass
 * the same keys draw the same menu.
 */
const groupNav = (keys) =>
  NAV_GROUPS.map((g) => ({ key: g.key, label: g.label, items: g.items.filter((k) => keys.includes(k)) }))
            .filter((g) => g.items.length > 0);

/** The destinations a SET of roles reaches: what any of them holds. */
const navForRoles = (roles) =>
  NAV_ORDER.filter((k) => {
    const cap = NAV_CAPABILITY[k];
    return cap === null || roles.some((r) => roleGrants(r, cap));
  });

/** A persona's destinations: its role, plus the roles it always comes with. */
const navFor = (role) => navForRoles([role, ...(ROLE_IDENTITY[role]?.also ?? [])]);

/* ── Legacy names — retired (SCRBRD-027) ─────────────────────────────
   The demonstration accounts, the seeded fixtures and the onboarding persona
   picker used to speak an old vocabulary (superadmin-as-alias, headmaster,
   sportsmaster, parent, assistant…) that this file mapped onto the policy's
   own role names via rbac/legacy-roles.js's LEGACY_ROLE_NAMES.

   That vocabulary is gone from every entry point that can set the SIGNED-IN
   role — LoginPage's accounts, OnboardingFlow's persona picker and
   ManagementView's role picker all speak policy role names directly now
   (apps/web/test/design.test.mjs asserts this for the first two). With
   nothing left to translate, `canonicalRole` is identity on every policy
   role and ROLES carries exactly ROLE_IDENTITY's keys — no wider lookup
   table for a menu to accidentally iterate and duplicate.
*/

/** Identity on the policy vocabulary — kept as a function because every call
 *  site names it, not what it does; TopBar and SettingsView both compare a
 *  role against `canonicalRole(other)` rather than the role itself. */
const canonicalRole = (r) => r;

/** The shape the shell reads: label, icon, colour and nav, per policy role. */
// Descriptors, not a spread: `{ ...id }` would copy the colour getter's
// VALUE at import time, and every role would keep the theme it loaded in.
const ROLES = Object.fromEntries(
  Object.entries(ROLE_IDENTITY).map(([r, id]) => [r, Object.defineProperties({ nav: navFor(r) }, Object.getOwnPropertyDescriptors(id))]),
);

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
  readiness:    { icon:"🛡️",  label:"Readiness"    },
  officials:    { icon:"🧑‍⚖️", label:"Officials"    },
  staff:        { icon:"🔧",  label:"Staff"        },
  sponsors:     { icon:"🤝",  label:"Sponsors"     },
  news:         { icon:"📰",  label:"Newsfeed"     },
  notifications:{ icon:"🔔",  label:"Alerts"       },
  settings:     { icon:"⚙️",  label:"Settings"     },
  management:   { icon:"🛠️",  label:"Management"   },
  modules:      { icon:"🎛",  label:"Modules"      },
  rulebook:     { icon:"📖",  label:"Rulebook"     },
  pitchdeck:    { icon:"📐",  label:"Pitch Deck"   },
};

export { NAV_META, NAV_GROUPS, NAV_GROUP, NAV_ORDER, ROLES, ROLE_DAYLIGHT, ROLE_IDENTITY, ROLE_FAMILIES, NAV_CAPABILITY, canonicalRole, groupNav, navFor, navForRoles };

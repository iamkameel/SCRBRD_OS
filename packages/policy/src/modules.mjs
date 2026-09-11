/**
 * SCRBRD — what the product OFFERS, and to whom it is offered.
 *
 * This is not authorization and must never be read as any part of it. Every
 * question of who may see a row is answered by capabilities.mjs, roles.mjs and
 * the row-level policies generated from tables.mjs, and nothing in this file
 * can widen any of those answers. What this adds is a second, independent gate
 * that can only ever NARROW them:
 *
 *     visible  =  RBAC says yes  AND  this module is switched on for you
 *
 * An AND, at every level, in that order. A module switched on for somebody who
 * lacks the capability gives them nothing at all — which is the property that
 * makes the whole mechanism safe to hand to a school administrator.
 *
 * THREE LEVELS, AND WHICH WAY EACH CAN MOVE
 * ─────────────────────────────────────────
 * PLATFORM (feature_flag)      the default for everybody, plus `locked`,
 *                              which means nobody may deviate — the DRS case,
 *                              where the feature is built and must not be used
 *                              until there is ball-tracking to feed it.
 * SCHOOL GRANT (feature_grant) written ONLY under platform.feature.manage.
 *                              This is the commercial lever: a module that is
 *                              off by default and on for the schools whose
 *                              plan includes it. It can go either way, because
 *                              it is the platform's own decision.
 * SUPPRESSION (feature_suppression)
 *                              written under school.feature.manage, by a
 *                              school for itself or for one of its people.
 *                              IT HAS NO "ON" STATE TO SET. The row's
 *                              existence is the switch, and the switch has one
 *                              position: off.
 *
 * That last point is the design. A school administrator cannot buy, misclick
 * or exploit their way into a module the platform did not grant them, not
 * because a policy forbids setting a boolean to true, but because there is no
 * boolean. It is the same reasoning as "a cached notification is not
 * permission": the safe property is structural rather than enforced.
 *
 * WHAT A MODULE OWNS
 * ──────────────────
 * `reads` names the read resources that BELONG to a module — the ones the API
 * refuses when it is off. Switching a module off is meant to remove the
 * information, not just the doorway, so a school that turns off Injuries stops
 * receiving injury rows anywhere, including the dashboard card that counts
 * them.
 *
 * Which means the list has to be honest about SHARED reads. `matches`,
 * `players` and `competitions` are infrastructure — a dozen screens read them
 * — so no module claims them, and turning off Competitions closes its
 * destination and its writes without blanking the opponent's name in Match
 * Centre. Where a module owns nothing exclusively, it says so with an empty
 * list rather than claiming a read it would break other screens by refusing.
 */

/** A destination in the shell, and the data behind it. */
export const MODULES = {
  // Destinations that are somebody's own — their dashboard, their alerts,
  // their settings — are deliberately ABSENT from this file. A switch that
  // cannot be thrown is not a switch, and a product that lets a school hide a
  // person's own settings screen from them has stopped being theirs.
  competitions: {
    kind: "module", label: "Competitions", nav: "competitions",
    capability: "competition.read",
    // `competitions` is read by Match Centre, the dashboard, Logistics and the
    // scorecard header. Claiming it would blank an opponent's competition name
    // across the app the moment a school hid the destination.
    reads: [],
  },
  leagues: {
    kind: "module", label: "Leagues", nav: "leagues",
    capability: "competition.read",
    reads: ["league"],
  },
  analytics: {
    kind: "module", label: "Analytics", nav: "analytics",
    capability: "analytics.read",
    reads: ["phases", "matchups", "matchup_coverage", "shot_points",
            "shot_point_coverage", "derby_record", "band_changes"],
  },
  skills: {
    kind: "module", label: "Skills", nav: "skills",
    capability: "player.development.read",
    reads: ["skills"],
  },
  training: {
    kind: "module", label: "Training", nav: "training",
    capability: "player.development.read",
    reads: ["training", "training_attendance"],
  },
  injuries: {
    kind: "module", label: "Injuries", nav: "injuries",
    capability: "medical.status.read",
    // Owned outright, and the consequence is intended: a school that switches
    // off Injuries stops seeing injury rows on the dashboard and on a player's
    // profile too, not merely on the Injuries screen.
    reads: ["injuries"],
  },
  logistics: {
    kind: "module", label: "Logistics", nav: "logistics",
    capability: "transport.read",
    reads: [],
  },
  fields: {
    kind: "module", label: "Fields", nav: "fields",
    capability: "facility.read",
    // Not `grounds`: Match Centre, Logistics and Staff all name a venue.
    reads: ["ground_conditions", "pitch_report"],
  },
  officials: {
    kind: "module", label: "Officials", nav: "officials",
    capability: "fixture.read",
    reads: ["officials"],
  },
  sponsors: {
    kind: "module", label: "Sponsors", nav: "sponsors",
    capability: "sponsorship.read",
    reads: ["sponsors", "sponsor_categories", "sponsorships"],
  },
  staff: {
    kind: "module", label: "Staff", nav: "staff",
    capability: "user.read",
    reads: ["staff"],
  },
};

/**
 * Behaviours rather than destinations.
 *
 * The difference that matters is not size. A module has a doorway a person can
 * be sent to; a feature is something the product does inside one. Both resolve
 * through exactly the same three levels — this split exists so an
 * administrator's screen can group them, and so that "turn off Analytics" and
 * "turn off DRS" are visibly the same kind of act.
 */
export const FEATURES = {
  drs_review: {
    kind: "feature", label: "DRS / LBW review",
    // Enforced in the database as well, by a trigger on drs_review. A feature
    // whose only guard is the API is a feature anybody with a queued offline
    // write still has.
    reads: ["drs_reviews"],
  },
  broadcast: {
    kind: "feature", label: "Broadcast overlay",
    reads: ["broadcast_state"],
  },
  scouting: {
    kind: "feature", label: "Scouting",
    reads: ["scouting_candidates"],
  },
};

/**
 * The sports, which gate MACHINERY rather than a destination or a behaviour.
 *
 * SCRBRD OS is a school-sport platform and Cricket OS is one sport inside it.
 * A sport is not a tenant — the tenant is the school and stays the school —
 * and it is not a module either, because switching hockey on does not add a
 * doorway: it makes every existing doorway accept a hockey fixture.
 *
 * `engine` is the honest half, and it is in the database too (db/00, on
 * `sport`). Most of this product turned out to be sport-agnostic already:
 * squad selection, availability, readiness, transport, officials, fields,
 * notifications, sponsors and the module system care about a fixture and a
 * roster, not about which game. Only the ball log, the toss, DRS and the
 * analytics that replay them are cricket's. So a sport at 'fixtures' is
 * genuinely useful on the day it is switched on, and saying "live" when only
 * that half exists is the mock-screen failure this project keeps finding in
 * other builds.
 *
 * None of these claims a read. A sport does not own `matches` — a school
 * running cricket and hockey needs both on one fixture list, and a switch that
 * blanked the shared reads would take the other sport's fixtures down with it.
 * The gate is on the WRITE, in the database, where match_sport_is_enabled()
 * refuses a fixture in a sport the school has not been granted. History
 * survives a sport being switched off, deliberately: a school that stops
 * running hockey keeps last season's hockey fixtures.
 */
export const SPORTS = {
  sport_cricket:   { kind: "sport", label: "Cricket",   engine: "scoring",  reads: [] },
  sport_rugby:     { kind: "sport", label: "Rugby",     engine: "fixtures", reads: [] },
  sport_hockey:    { kind: "sport", label: "Hockey",    engine: "fixtures", reads: [] },
  sport_netball:   { kind: "sport", label: "Netball",   engine: "fixtures", reads: [] },
  sport_football:  { kind: "sport", label: "Football",  engine: "fixtures", reads: [] },
  sport_athletics: { kind: "sport", label: "Athletics", engine: "none",     reads: [] },
  sport_swimming:  { kind: "sport", label: "Swimming",  engine: "none",     reads: [] },
};

/** A sport's flag key, from its code. Mirrors the generated column in db/00. */
export const sportFlagKey = (code) => `sport_${code}`;

/** Everything switchable — module, feature and sport — keyed the way the flag table is. */
export const SWITCHABLE = { ...MODULES, ...FEATURES, ...SPORTS };

/**
 * resource → the module or feature that owns it.
 *
 * Built once, and it throws on a resource claimed twice. Two owners would mean
 * a read refused when EITHER is off while the administrator's screen shows one
 * switch — a thing that is off for a reason nobody can find.
 */
export const OWNER_OF_READ = (() => {
  const out = {};
  for (const [key, def] of Object.entries(SWITCHABLE)) {
    for (const r of def.reads ?? []) {
      if (out[r]) throw new Error(`read "${r}" is claimed by both ${out[r]} and ${key}`);
      out[r] = key;
    }
  }
  return out;
})();

/** nav destination → the module that gates it, for the shell's menu. */
export const MODULE_OF_NAV = Object.fromEntries(
  Object.entries(MODULES).filter(([, d]) => d.nav).map(([k, d]) => [d.nav, k]));

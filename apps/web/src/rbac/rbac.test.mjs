/**
 * Proves the client choke point enforces the scoped model against the demo
 * data — the same guarantees db/99_rls_verify.sql proves in Postgres, checked
 * here on the surface the 19 views actually call.
 *
 * The point of testing both is that they are generated from one policy. If
 * these two ever disagree, the policy has been forked somewhere.
 */
import { can, canScore, getData, filterRecord, countData, grantedBy, principalForRole } from "./index.js";
// This suite is the one place outside rbac/ that may read the raw constants:
// it needs the unscoped totals to prove that scoped reads are smaller.
import { PLAYERS, INJURIES } from "../data/mock.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const P = (role) => principalForRole(role);

// ── A. Row scoping ───────────────────────────────────────
group("A. Row scoping");
{
  const coachRows = getData("players", P("coach"));
  const dosRows = getData("players", P("sportsmaster"));
  ok("coach sees only their own team",
     coachRows.length > 0 && coachRows.every((p) => p.team === "U19A"));
  ok("director of sport sees the whole school",
     dosRows.length > coachRows.length && dosRows.every((p) => p.school === "HIL"));
  ok("neither reaches the other school",
     [...coachRows, ...dosRows].every((p) => p.school !== "WES"));
  ok("a player sees only themselves",
     getData("players", P("player")).every((p) => p.id === "p1"));
  ok("a guardian sees only their child",
     getData("players", P("parent")).every((p) => p.id === "p5"));
  ok("a spectator reaches no player records at all",
     getData("players", P("spectator")).length === 0);
  ok("an unknown role gets nothing (default deny)",
     getData("players", P("nonsense-role")).length === 0);
}

// ── A2. Everyone who needs a fixture can see one ─────────
group("A2. Fixtures reach the people who need them");
{
  // Regression: the demo rows name the side in `homeTeam` rather than carrying
  // a team code, so the team anchor came out null — and a null on the resource
  // narrows. That left a team coach, and a SCORER whose whole job is scoring a
  // match, seeing no fixtures at all.
  ok("coach sees their team's fixtures",   getData("matches", P("coach")).length > 0);
  ok("scorer sees fixtures to score",      getData("matches", P("scorer")).length > 0);
  ok("coach sees a live fixture",          getData("matches", P("coach")).some((m) => m.status === "live"));
  ok("guardian sees their child's school fixtures", getData("matches", P("parent")).length > 0);
  ok("director sees more than a team coach",
     getData("matches", P("sportsmaster")).length > getData("matches", P("coach")).length);
  ok("coach's fixtures are their own team's",
     getData("matches", P("coach")).every((m) => /U19A/.test(m.homeTeam ?? "")));
}

// ── B. Aggregates use the same scope ─────────────────────
group("B. Aggregates cannot exceed row scope");
{
  const coachCount = countData("players", P("coach"));
  ok("count matches the rows actually readable",
     coachCount === getData("players", P("coach")).length);
  ok("a team coach's count is below the school total",
     coachCount < PLAYERS.filter((p) => p.school === "HIL").length);
  ok("injury count is scoped too",
     countData("injuries", P("coach")) <= INJURIES.length);
}

// ── C. Column masking ────────────────────────────────────
group("C. Column masking");
{
  const asCoach = getData("players", P("coach"));
  const asAdmin = getData("players", P("schooladmin"));
  const asGuardian = getData("players", P("parent"));

  ok("coach cannot read a minor date of birth", asCoach.every((p) => p.born === null));
  ok("coach cannot read guardian details",      asCoach.every((p) => p.height === null && p.weight === null));
  ok("coach CAN read the sporting profile",     asCoach.every((p) => p.name && p.team));
  ok("school admin can read PII",               asAdmin.some((p) => p.born !== null));
  ok("guardian can read their own child's PII", asGuardian.every((p) => p.born !== null));
  ok("analyst is PII-stripped",                 getData("players", P("analyst")).every((p) => p.born === null));
}
{
  const coachInj = getData("injuries", P("coach"));
  const medInj = getData("injuries", P("medical"));
  ok("coach sees that a player is unavailable", coachInj.length > 0);
  ok("coach cannot read clinical notes",        coachInj.every((i) => i.notes === null && i.physio === null));
  ok("coach CAN read return-to-play",           coachInj.every((i) => i.rtw));
  ok("medical staff read clinical notes",       medInj.some((i) => i.notes !== null));
  ok("guardian cannot read clinical notes",     getData("injuries", P("parent")).every((i) => i.notes === null));
  ok("driver reaches no injuries at all",       getData("injuries", P("driver")).length === 0);
  ok("scorer reaches no injuries at all",       getData("injuries", P("scorer")).length === 0);
}

// ── D. The platform-admin change ─────────────────────────
group("D. Operating the platform is not a licence to browse");
{
  // The most visible behaviour change from the migration, and it is intended:
  // under the previous model superadmin saw everything.
  ok("platform admin reaches no clinical records", getData("injuries", P("superadmin")).length === 0);
  ok("platform admin reaches no player PII",
     getData("players", P("superadmin")).every((p) => p.born === null || p.born === undefined));
}

// ── E. can() / canScore() ────────────────────────────────
group("E. Legacy surface still answers correctly");
{
  ok("coach may update injuries? no",     can("coach", "injuries", "update").allowed === false);
  ok("medical may update injuries",       can("medical", "injuries", "update").allowed === true);
  ok("coach reads players at team scope", can("coach", "players", "r").scope === "team");
  ok("director reads at school scope",    can("sportsmaster", "players", "r").scope === "school");
  ok("player reads at own scope",         can("player", "players", "r").scope === "own");
  ok("deny lists the masked fields",      can("coach", "players", "r").deny.includes("born"));
  ok("no deny where nothing is masked",   can("schooladmin", "players", "r").deny.length === 0);
  ok("unknown resource denies",           can("coach", "nonsense", "r").allowed === false);

  ok("coach may score",       canScore("coach") === true);
  ok("scorer may score",      canScore("scorer") === true);
  ok("parent may NOT score",  canScore("parent") === false);
  ok("driver may NOT score",  canScore("driver") === false);
  ok("spectator may NOT score", canScore("spectator") === false);
  ok("unknown role may NOT score", canScore("nonsense-role") === false);
}

// ── F. filterRecord and provenance ───────────────────────
group("F. Single records and provenance");
{
  const own = PLAYERS.find((p) => p.team === "U19A");
  const other = PLAYERS.find((p) => p.school === "WES");
  ok("coach reads a row in their team",       filterRecord("coach", "players", own) !== null);
  ok("coach cannot read a row in another school", filterRecord("coach", "players", other) === null);
  ok("filterRecord masks as getData does",    filterRecord("coach", "players", own).born === null);
  ok("null in, null out",                     filterRecord("coach", "players", null) === null);

  const via = grantedBy("players", own, P("coach"));
  ok("provenance names the granting assignment", via?.role === "coach" && via?.team === "U19A");
  ok("provenance is null when denied",           grantedBy("players", other, P("coach")) === null);
}

// ── G. The choke point stays the only door ───────────────
group("G. No module reaches around the choke point");
{
  // handover §8.1 item 3: eighteen views imported the mock constants directly,
  // so every list, count and search result was computed over the whole dataset
  // regardless of who was looking. This fails the build if that returns.
  const root = new URL("../", import.meta.url).pathname;
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx|mjs)$/.test(e.name)) continue;
      const rel = full.slice(root.length);
      if (rel.startsWith("rbac/")) continue;           // the one legitimate importer
      const src = readFileSync(full, "utf8");
      if (/^import .*from "(\.\.\/)*data\/mock\.js"/m.test(src)) offenders.push(rel);
    }
  };
  walk(root);
  ok(`no module outside rbac/ imports the mock data${offenders.length ? " — " + offenders.join(", ") : ""}`,
     offenders.length === 0);
}

console.log(`\n${"─".repeat(52)}\nCLIENT RBAC SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

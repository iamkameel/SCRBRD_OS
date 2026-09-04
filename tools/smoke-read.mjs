#!/usr/bin/env node
/**
 * The read path, against a real database.
 *
 * This exists because the read suite cannot do what it looks like it does. It
 * runs against a fake pool that answers any query with canned rows, which
 * proves the handler does no RBAC of its own — a real and useful claim — but
 * makes it structurally incapable of noticing that the SQL is wrong, or that a
 * view is handing back rows the policies would have refused.
 *
 * Both of those had happened:
 *
 *   - `matches` named six columns that have never existed on the table, so
 *     every call returned SQLSTATE 42703 and the fixture list could not load.
 *     31 assertions passed the whole time.
 *
 *   - the *_masked views ran as their OWNER, who owns the tables underneath
 *     them and therefore bypasses row-level security. player_masked returned
 *     every player at every school — through the one object the read path is
 *     required to use for personal information, and invisibly, because the
 *     leaked rows were still column-masked and so looked exactly right.
 *
 * So this asks the real server, as real seeded people, and checks both that
 * the queries run and that different people get different answers.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-read.mjs
 */
import { spawn } from "node:child_process";

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-read-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, token) => {
  const res = await fetch(BASE + path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "device-read-smoke" }),
  });
  return (await res.json()).token;
};
const read = async (resource, token) => {
  const r = await api(`/api/read/${resource}`, token);
  if (r.status !== 200) throw new Error(`${resource}: ${JSON.stringify(r.body)}`);
  return r.body.rows;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const h = await api("/api/health"); if (h.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach = await login("coach@example.invalid");     // U19A only
  const scorer = await login("scorer@example.invalid");   // school-wide, no medical
  const medic = await login("medical@example.invalid");
  const guardian = await login("parent@example.invalid"); // one child

  // ── Every query runs ────────────────────────────────────────────
  group("Every wired query actually runs");
  // Named individually rather than looped over liveResources(), because two of
  // them take a required parameter and a smoke that silently skipped those
  // would be the same class of test as the fake pool: green, and blind.
  for (const resource of [
    "matches", "players", "injuries", "competitions",
    "coaches", "staff", "users", "grounds",
    "training", "training_attendance", "skills", "notifications",
    "league", "weather", "career",
  ]) {
    let ran = true, err = null;
    try { await read(resource, medic); } catch (e) { ran = false; err = e.message; }
    ok(`${resource} returns rows rather than a SQL error${ran ? "" : ` — ${err}`}`, ran);
  }

  // ── The heat map's filter lives in SQL, not in report code ──────
  group("Shot placement");
  const MATCH = "77777777-0000-0000-0000-000000000001";
  let pointsRan = true, covRan = true;
  try { await read(`shot_points?matchId=${MATCH}`, coach); } catch { pointsRan = false; }
  try { await read(`shot_point_coverage?matchId=${MATCH}`, coach); } catch { covRan = false; }
  ok("the point-era query runs", pointsRan);
  ok("the coverage query runs", covRan);
  const cov = covRan ? (await read(`shot_point_coverage?matchId=${MATCH}`, coach))[0] : null;
  ok("coverage is reportable rather than inferred",
     cov !== null && "points" in cov && "sector_era" in cov);
  // Nothing has been captured as a point yet, and the seed carries no balls —
  // so the honest answer is zero, not a synthesised one.
  ok("a match with no point-era balls returns none, not fabricated ones",
     (await read(`shot_points?matchId=${MATCH}`, coach)).length === 0);

  // ── The same query, different answers ───────────────────────────
  group("The same query, scoped per person");
  const coachMatches = await read("matches", coach);
  const scorerMatches = await read("matches", scorer);
  ok("a team-scoped coach sees only their team's fixtures",
     coachMatches.length > 0 && coachMatches.every((m) => m.team_code === "U19A"));
  ok("a school-scoped scorer sees more of them", scorerMatches.length > coachMatches.length);
  ok("nobody sees another school's fixtures",
     [...coachMatches, ...scorerMatches].every((m) => m.school_id === HIL));
  ok("the fixture carries what a match centre needs",
     coachMatches.every((m) => m.id && m.opponent && m.starts_at && m.status));

  // ── Views must not smuggle rows past the policies ───────────────
  group("Masked views filter rows as well as columns");
  const coachPlayers = await read("players", coach);
  ok("the coach's roster is their own team", coachPlayers.length > 0);
  ok("...and contains nobody from another school",
     !coachPlayers.some((p) => p.school_id === WES));

  // The guardian case is the sharpest: their assignment names one child, so
  // the roster is one row. A view running as its owner returned all eight.
  const guardianPlayers = await read("players", guardian);
  ok("a guardian's roster is only their own child", guardianPlayers.length === 1);

  // ── Columns, per row, per capability ────────────────────────────
  group("Sensitive columns are masked per capability");
  ok("the scorer reads a player without their date of birth",
     (await read("players", scorer)).every((p) => p.born == null));
  ok("...and the guardian reads their own child's",
     guardianPlayers.every((p) => p.born != null));

  const medicInjuries = await read("injuries", medic);
  const coachInjuries = await read("injuries", coach);
  ok("the physio reads clinical notes", medicInjuries.some((i) => i.notes));
  ok("the coach reads that a player is unavailable", coachInjuries.length > 0);
  ok("...but not the diagnosis behind it", coachInjuries.every((i) => i.notes == null));
  ok("the scorer reads no injuries at all", (await read("injuries", scorer)).length === 0);

  // ── Three tiers, not two ────────────────────────────────────────
  // `injury_type` reads "Grade 2 hamstring strain" — it IS the diagnosis — and
  // it used to sit unmasked behind medical.status.read, which the player
  // bundle holds. A pupil could read what was wrong with a team mate from a
  // column called "type", while notes and physio were carefully protected.
  const pupil = await login("spectator@example.invalid");   // assignment: player
  const pupilInjuries = await read("injuries", pupil);
  ok("a pupil sees that a team mate is unavailable", pupilInjuries.length > 0);
  ok("...and when they are expected back",
     pupilInjuries.every((i) => i.rtw_date != null));
  ok("...and NOT what is wrong with them",
     pupilInjuries.every((i) => i.injury_type == null));
  ok("...nor how severe it is", pupilInjuries.every((i) => i.severity == null));
  ok("...nor what stage of rehabilitation they are at",
     pupilInjuries.every((i) => i.phase == null));

  // A coach picks a side and manages a bowling load, so they need the nature.
  ok("a coach reads what the injury is", coachInjuries.every((i) => i.injury_type != null));
  ok("...and how severe", coachInjuries.every((i) => i.severity != null));

  // ── Your own file ───────────────────────────────────────────────
  // A pupil holds `player` for the things about the team, and that assignment
  // reaches every team mate — so it cannot carry the capabilities that read a
  // medical record. Self-access is its own assignment naming exactly one
  // person, and the model's rule does the rest: a capability applies only
  // within the scope of the assignment granting it.
  const self = await login("pillay@example.invalid");   // R Pillay, injured
  const own = await read("injuries", self);
  const mine = own.filter((i) => i.player_id === "aaaaaaaa-0000-0000-0000-000000000005");
  const theirs = own.filter((i) => i.player_id !== "aaaaaaaa-0000-0000-0000-000000000005");

  ok("a player reads their own injury record", mine.length === 1);
  ok("...including what it is", mine.every((i) => i.injury_type != null));
  ok("...and their own clinical notes — reading your own record is not a disclosure",
     mine.every((i) => i.notes != null));
  ok("...and who is treating them", mine.every((i) => i.physio != null));

  ok("a team mate's unavailability is still visible", theirs.length > 0);
  ok("...but not what is wrong with them",
     theirs.every((i) => i.injury_type == null));
  ok("...and certainly not their clinical notes",
     theirs.every((i) => i.notes == null));

  // A parent needs to know what is wrong with their OWN child — same row, same
  // policy, different answer, because their assignment names that child.
  const guardianInjuries = await read("injuries", guardian);
  ok("a guardian reads their own child's injury type",
     guardianInjuries.length === 1 && guardianInjuries[0].injury_type != null);
  ok("...but still not the clinical notes behind it",
     guardianInjuries.every((i) => i.notes == null));

  // ── The programme reads, scoped per person ──────────────────────
  // Each of these was, until now, a decision made in the browser against a
  // mock module. The claim is not that the query runs — that is the block
  // above — but that two people asking the same question get different
  // answers, which is the only evidence that anything is being enforced.
  group("The programme reads are scoped, not just wired");

  const watcher = await login("watcher@example.invalid");  // a real spectator

  const coachTraining = await read("training", coach);
  ok("a U19A coach sees their own team's sessions",
     coachTraining.length > 0 && coachTraining.every((t) => t.team_code === "U19A"));
  ok("...and not another team's", !coachTraining.some((t) => t.team_code === "U16B"));

  // The register is the sensitive half. A guardian reads the schedule in full
  // and exactly one row of the attendance list — from two tables, in one
  // session, because the split is the security model.
  const guardianTraining = await read("training", guardian);
  const guardianRegister = await read("training_attendance", guardian);
  ok("a guardian still sees the training schedule", guardianTraining.length > 0);
  ok("...but only their own child on the register", guardianRegister.length === 1);

  ok("a guardian reads no development assessments at all",
     (await read("skills", guardian)).length === 0);
  const coachSkills = await read("skills", coach);
  ok("a coach reads their own squad's assessments", coachSkills.length > 0);
  ok("...and nobody else's", coachSkills.every((s) => s.team_code === "U19A"));

  // ── A notification is not permission ────────────────────────────
  // The sharpest read in the file. news.read is a floor capability; if it were
  // the only gate, the feed would hand out everything every other policy
  // refuses. A spectator holds news.read and must still not receive a notice
  // whose body names a child's injury.
  group("A cached notification is not permission");
  const watcherNotices = await read("notifications", watcher);
  const medicNotices   = await read("notifications", medic);
  const coachNotices   = await read("notifications", coach);
  ok("a spectator receives general school notices", watcherNotices.length > 0);
  ok("a spectator does NOT receive a medical notice",
     !watcherNotices.some((n) => n.kind === "injury"));
  ok("the medical officer does", medicNotices.some((n) => n.kind === "injury"));
  ok("so does the coach of the team it concerns",
     coachNotices.some((n) => n.kind === "injury"));
  ok("...and the coach does not receive another team's notice",
     !coachNotices.some((n) => n.team_code === "U16B"));
  ok("a school-wide notice reaches a team-scoped coach",
     coachNotices.some((n) => n.team_code === null));
  ok("read state comes back per person, not per notice",
     watcherNotices.every((n) => n.read === false));

  // ── Career figures are derived, and scoped like the rows ────────
  // The aggregate reads ball_event_live, which is security_invoker, so it
  // covers exactly the deliveries the reader may see. Two people getting
  // different career totals for the same player is correct: an aggregate
  // discloses as surely as a row, and a total computed over matches the reader
  // cannot see would tell them those matches exist.
  group("Career statistics are derived, never stored");
  const coachCareer = await read("career", coach);
  ok("every player comes back, batted or not", coachCareer.length > 0);
  ok("a player who has not batted has no average rather than zero",
     coachCareer.every((c) => Number(c.balls_faced) > 0 || Number(c.dismissals) === 0));
  ok("the figures are counts, for the client to turn into rates",
     coachCareer.every((c) => "runs" in c && "balls_faced" in c && "dismissals" in c));
  ok("a form guide comes back as an array, empty when nobody has batted",
     coachCareer.every((c) => Array.isArray(c.form)));
  ok("no stored average column exists — nothing here is a stat SCRBRD wrote down",
     coachCareer.every((c) => !("avg" in c) && !("strike_rate" in c)));

  // Scoped like everything else: a guardian's career read covers their own
  // child only, because the underlying player read does.
  const guardianCareer = await read("career", guardian);
  ok("a guardian's career read is their own child only", guardianCareer.length === 1);

  // ── An injury alerts the circle of care ─────────────────────────
  // Recording an injury publishes a notice by trigger, not by a call the write
  // path has to remember. Nobody is listed as a recipient: the notice declares
  // medical.nature.read and names the player, and the notification policy
  // lands it on coaches of that player's current side, school administration,
  // medical staff, the parent OF THAT CHILD, and the player themselves.
  group("An injury alerts the people who need to know");
  const P_INJURED = "aaaaaaaa-0000-0000-0000-000000000005";
  const injuryAlerts = (rows) => rows.filter((n) => n.kind === "injury");

  const coachAlerts = injuryAlerts(await read("notifications", coach));
  ok("the coach of the side is alerted", coachAlerts.length > 0);
  ok("...and the alert names the player and the injury",
     coachAlerts.some((n) => /Pillay/.test(n.body) && /hamstring/i.test(n.body)));

  const parentAlerts = injuryAlerts(await read("notifications", guardian));
  ok("the parent of that child is alerted",
     parentAlerts.some((n) => n.subject_person_id === P_INJURED));
  ok("...and about nobody else's child",
     parentAlerts.every((n) => n.subject_person_id == null || n.subject_person_id === P_INJURED));

  const selfAlerts = injuryAlerts(await read("notifications", self));
  ok("the player themselves is told", selfAlerts.length > 0);
  ok("...about their own injury only",
     selfAlerts.every((n) => n.subject_person_id == null || n.subject_person_id === P_INJURED));

  const medicAlerts = injuryAlerts(await read("notifications", medic));
  ok("medical staff are alerted", medicAlerts.length > 0);

  // A team mate learns that someone is unavailable and not what is wrong with
  // them — the tier the notice declares decides who receives it, and the
  // player bundle holds medical.status.read and not medical.nature.read.
  const pupilAlerts = injuryAlerts(await read("notifications", pupil));
  ok("a team mate is not alerted to the nature of an injury",
     pupilAlerts.every((n) => !/hamstring|impingement/i.test(n.body)));

  ok("a spectator receives no injury alert at all",
     injuryAlerts(await read("notifications", watcher)).length === 0);

  // ── The ladder is shared, the rest is not ───────────────────────
  group("Participation, not authorship, decides a league");
  const ladder = await read("league", coach);
  ok("a team-scoped coach reads the whole ladder, not just their own row",
     ladder.length === 2);
  ok("...including the opposition's record",
     ladder.some((r) => r.school_id === WES));
  ok("the ladder comes back ordered by points",
     ladder.every((r, i) => i === 0 || ladder[i - 1].points >= r.points));

  // ── Default deny ────────────────────────────────────────────────
  group("Default deny");
  const anon = await api("/api/read/players");
  ok("an unauthenticated read is refused", anon.status === 401);
  const nonsense = await api("/api/read/nonsense", coach);
  ok("an unknown resource is a 404, not an empty list", nonsense.status === 404);
} catch (e) {
  ok(`the read walk threw: ${e.message?.slice(0, 120)}`, false);
} finally {
  server.kill("SIGTERM");
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nREAD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

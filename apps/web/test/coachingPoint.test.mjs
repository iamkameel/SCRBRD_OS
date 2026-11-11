/**
 * The coaching point's words, kept in two places and held together here
 * (GA-I27 §6, GA-I26a §2.2; db/104).
 *
 * A coaching point refuses the cockpit's never-words twice: the screen before
 * it sends (NEVER_ON_THE_COCKPIT, apps/web/src/lib/cockpitNever.js) and the
 * database before it stores (coaching_point_never(), db/104). Two copies of a
 * word list drift, and the drift is silent: a word added to one refuses on
 * the screen and stores through the API, or the other way round. So the SQL
 * copy is read out of the migration and compared to the JavaScript one, text
 * for text, with Postgres's word boundary (\y) for JavaScript's (\b).
 *
 * When the list changes, the SQL changes in a NEW migration (db/104 is frozen
 * once shipped) that replaces coaching_point_never(); this test then reads that
 * file, which is the last one in db/ to define the function.
 *
 *   node apps/web/test/coachingPoint.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";
import { roleGrants } from "@scrbrd/policy/roles";
import { panelsOf } from "../src/lib/cockpit.js";
import { matchupFigures, matchupLine } from "../src/lib/captain.js";
import {
  POINT_MAX, pointerOfCard, pointerOfScore, pointerWords, pointLines, pointProblem, handToSkills, handedToSkills, clearHanded,
} from "../src/lib/coachingPoint.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };

const DB = join(dirname(fileURLToPath(import.meta.url)), "../../../db");
const files = readdirSync(DB).filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  .filter((f) => readFileSync(join(DB, f), "utf8").includes("CREATE OR REPLACE FUNCTION coaching_point_never("));
ok("a migration defines coaching_point_never()", files.length > 0);
const file = files.at(-1) ?? "";
const sql = file ? readFileSync(join(DB, file), "utf8") : "";
const body = sql.slice(sql.lastIndexOf("CREATE OR REPLACE FUNCTION coaching_point_never("));
const pattern = body.match(/~\*\s*'((?:[^']|'')*)'/)?.[1]?.replaceAll("''", "'");
ok(`${file} carries the pattern as one string`, typeof pattern === "string" && pattern.length > 20);

const asJs = (pattern ?? "").replaceAll("\\y", "\\b");
ok("the SQL copy is NEVER_ON_THE_COCKPIT, word for word", asJs === NEVER_ON_THE_COCKPIT.source,
   { sql: asJs, js: NEVER_ON_THE_COCKPIT.source });
ok("...and both are case-insensitive", NEVER_ON_THE_COCKPIT.flags.includes("i") && /~\*/.test(body));
ok("the SQL uses no \\b (in Postgres that is a backspace, not a boundary)", !(pattern ?? "").includes("\\b"));

// The sentences the proof uses, read the same way by both copies.
const sqlAsRegex = new RegExp(asJs, "i");
for (const [s, refused] of [
  ["front foot is late to the pitch", false],
  ["a hamstring niggle after the second spell", true],
  ["bowled at 70 % of his pace", true],
  ["under pressure he plays across the line", true],
  ["the ratio of dots to runs", true],
  ["his flagging energy late on", false],
]) {
  ok(`"${s}" is ${refused ? "refused" : "accepted"} by both`,
     NEVER_ON_THE_COCKPIT.test(s) === refused && sqlAsRegex.test(s) === refused);
}

// ── GA-I27 slice 2 (C4): the screens' half ──────────────────────────────
console.log("\nWho reads a coaching point, and who makes one (GA-I26a AH-D3; GA-I27 C-D4, §3.2)");
{
  // Read under the note's own capability: the coach, the assistant, the
  // director, the principal. Never the boy, his parents, a team-mate (the
  // captain is a `player`), the team manager, the analyst, the physio, the
  // scorer or the office. The drawer's S13 read is made only where the
  // assignment holds it (the cockpit's `points` panel).
  const READERS = ["coach", "assistantcoach", "directorofsport", "principal"];
  const NEVER = ["player", "selfaccess", "guardian", "teammanager", "analyst", "medical", "scorer", "schooladmin"];
  ok("the coach, the assistant, the director and the principal hold player.note.read", READERS.every((r) => roleGrants(r, "player.note.read")));
  ok("...the boy, his parents, a team-mate, the team manager, the analyst, the physio, the scorer and the office do not",
     NEVER.every((r) => !roleGrants(r, "player.note.read")), NEVER.filter((r) => roleGrants(r, "player.note.read")));
  ok("the drawer asks for points only where its assignment holds the note capability", READERS.every((r) => panelsOf(r).points) && NEVER.every((r) => !panelsOf(r).points));
  // Made by a writer of his scores who writes notes (coaching_point_write): the coach.
  const makes = (r) => roleGrants(r, "player.development.write") && roleGrants(r, "player.note.write");
  ok("a point is made by the coach alone of these", ["coach"].every(makes) && [...READERS.slice(1), ...NEVER].every((r) => !makes(r)));
  ok("...and withdrawn by a note writer: the coach, the assistant, the director",
     ["coach", "assistantcoach", "directorofsport"].every((r) => roleGrants(r, "player.note.write")) && !roleGrants("principal", "player.note.write") && NEVER.every((r) => !roleGrants(r, "player.note.write")));
  // The pupil's and the parent's shells never import the point (static).
  const FAM = new URL("../src/views/family/", import.meta.url);
  const famFiles = readdirSync(FAM).filter((f) => /\.(jsx?|mjs)$/.test(f));
  const fam = famFiles.map((f) => readFileSync(new URL(f, FAM), "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1")).join("\n");
  ok(`no family or pupil screen (${famFiles.length} files, the captain's included) imports the coaching point or reads coaching_points`,
     famFiles.includes("pupil.jsx") && famFiles.includes("captain.jsx") && !/coachingPoint|coaching_points|CoachingPoints|PointModal|Make a coaching point/.test(fam));
}

console.log("\nThe pointer, from a card and from a score");
{
  const card = { rule: "S5", lines: ["D Erasmus v pace · 48 balls · 31 runs · out 3 times", "48 of 61 balls attributable"], evidence: { params: { playerId: "p1", type: "pace" }, asOf: Date.UTC(2026, 9, 11, 12, 2) } };
  const p = pointerOfCard(card, "m1", Date.UTC(2026, 9, 11, 13, 0));
  ok("an S5 card points at matchups for that boy and type, keeps its lines, and carries its fixture",
     p?.playerId === "p1" && p.matchId === "m1" && p.evidence.read === "matchups" && p.evidence.rule === "S5"
     && JSON.stringify(p.evidence.params) === JSON.stringify({ playerId: "p1", type: "pace" }) && p.evidence.text.length === 2 && p.evidence.asOf === "2026-10-11T12:02:00.000Z", p);
  ok("...its pointer is the card's collapsed line and 'as at'", pointerWords(p, Date.UTC(2026, 9, 11, 13, 0)) === "D Erasmus v pace · 48 balls · 31 runs · out 3 times · as at 14:02", pointerWords(p, Date.UTC(2026, 9, 11, 13, 0)));
  ok("a card with no read time stands on the moment he saw it", pointerOfCard({ ...card, evidence: { ...card.evidence, asOf: null } }, "m1", 5000)?.evidence.asOf === new Date(5000).toISOString());
  ok("no other card may seed one here (C-D7: S5 only from the drawer)", ["S1", "S3", "S4a", "S6", "S7", "S12", "S13"].every((r) => pointerOfCard({ ...card, rule: r }, "m1", 0) === null));
  const sc = pointerOfScore({ id: "sk1", metric: "againstPace", score: 11, assessedOn: "2026-09-14" }, "p1");
  ok("a score points at that row and carries no fixture", sc?.evidence.read === "skills" && sc.evidence.params.skillId === "sk1" && sc.matchId === null && sc.line === "against pace 11 · 14 Sep", sc);
  ok("...and a withdrawn score is no pointer", pointerOfScore({ id: "sk1", metric: "againstPace", score: 11, assessedOn: "2026-09-14", withdrawn: true }, "p1") === null);
  ok("matchupLine and matchupFigures are one another's inverse",
     JSON.stringify(matchupFigures(matchupLine("R Pillay", { type: "spin", balls: 1, runs: 1, out: 1 }))) === JSON.stringify({ type: "spin", balls: 1, runs: 1, out: 1 })
     && JSON.stringify(matchupFigures(matchupLine("R Pillay", { type: "pace", balls: 36, runs: 42, out: 0 }))) === JSON.stringify({ type: "pace", balls: 36, runs: 42, out: 0 }));
}

console.log("\nThe field's refusals, before it sends");
{
  const side = ["R Pillay", "K Naidoo", "Bo"];
  ok("a plain sentence passes", pointProblem("Front foot is late to the pitch", side) === null);
  ok("empty, and over 500", pointProblem("  ", side) === "body_required" && pointProblem("x".repeat(POINT_MAX + 1), side) === "body_length" && POINT_MAX === 500);
  ok("a never-word", pointProblem("a hamstring niggle late on", side) === "forbidden_word");
  ok("another boy in full", pointProblem("Bat him above K Naidoo", side) === "names_another_boy" && pointProblem("bat him above k naidoo", side) === "names_another_boy");
  ok("...but not a lone short word that might sit inside another", pointProblem("Bowled well", side) === null);
}

console.log("\nStood on, and now (C-D5): both kept, 'corrected' only where nothing else explains it");
{
  const NOW = Date.UTC(2026, 9, 12, 16, 0);
  const pt = { read: "matchups", rule: "S5", params: { playerId: "p1", type: "pace" }, text: ["D Erasmus v pace · 36 balls · 42 runs · not out"], asOf: Date.UTC(2026, 9, 11, 12, 2), name: "D Erasmus" };
  const rows = (balls, runs, out = 0) => [{ bowlingStyle: "Right-arm fast", balls, runs, dismissals: out }];
  const same = pointLines(pt, { matchups: rows(36, 42), at: NOW, now: NOW });
  ok("unchanged: stood on, with its time, and no 'now'", same.stood === "stood on: D Erasmus v pace · 36 balls · 42 runs · not out · as at 14:02, 11 Oct" && same.now === null, same);
  const play = pointLines(pt, { matchups: rows(42, 50), at: NOW, now: NOW });
  ok("moved by play: 'now' and no 'corrected'", play.now === "now: D Erasmus v pace · 42 balls · 50 runs · not out · as at 18:00" && !play.corrected, play.now);
  const fix = pointLines(pt, { matchups: rows(35, 38), at: NOW, now: NOW });
  ok("a ball voided: fewer balls, 'corrected'", fix.now === "now: D Erasmus v pace · 35 balls · 38 runs · not out · as at 18:00 · corrected" && fix.corrected, fix.now);
  const fix2 = pointLines(pt, { matchups: rows(36, 40), at: NOW, now: NOW });
  ok("the same balls, other runs: 'corrected'", fix2.corrected && /· corrected$/.test(fix2.now ?? ""));
  ok("not re-derivable for this reader: stood on alone, no invented figure", pointLines(pt, { matchups: null, now: NOW }).now === null);
  const H = [{ id: "a", category: "technical", metric: "againstPace", score: 8, assessedOn: "2026-03-01" }, { id: "b", category: "technical", metric: "againstPace", score: 11, assessedOn: "2026-09-14" }];
  const sk = { read: "skills", skillId: "b" };
  ok("on a score that still stands: stood on, no 'now'", JSON.stringify(pointLines(sk, { history: H, now: NOW })) === JSON.stringify({ stood: "stood on: against pace 11 · 14 Sep", now: null, corrected: false }));
  ok("a newer score since: 'now' with it", pointLines(sk, { history: [...H, { id: "c", category: "technical", metric: "againstPace", score: 13, assessedOn: "2026-10-10" }], now: NOW }).now === "now: against pace 13 · 10 Oct");
  const gone = pointLines(sk, { history: [H[0], { ...H[1], withdrawn: true }], now: NOW });
  ok("the score it stood on withdrawn: 'now' the one that stands, and says so", gone.now === "now: against pace 8 · 1 Mar · the score it stood on was withdrawn" && gone.corrected, gone.now);
  const words = [same, play, fix, gone].flatMap((w) => [w.stood, w.now ?? ""]).join(" | ");
  ok("none of it is a never-word", !NEVER_ON_THE_COCKPIT.test(words), words.match(NEVER_ON_THE_COCKPIT)?.[0]);
}

console.log("\nThe door from the drawer: held for one opening, never stored");
{
  handToSkills({ playerId: "p1", pointer: { line: "x" } });
  ok("handed, and readable without taking", handedToSkills()?.playerId === "p1" && handedToSkills()?.playerId === "p1");
  clearHanded();
  ok("...and gone once taken", handedToSkills() === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * A refusal's likely cause (causes.mjs), beside REFUSAL_TEXT.
 *
 *   - The over the pad closed after six legal balls: "7 balls in this over?"
 *     counts the deliveries the fold has in it, wides and no-balls included.
 *   - Each cause that reads the fold names players from the fold's batters
 *     and bowlers, and never an id: a player the fold knows only by a UUID is
 *     a role ("the bowler").
 *   - A cause that needs the innings says nothing without one (the held
 *     sheet passes only the event).
 *   - No text carries a Law clause number, over every code REFUSAL has and
 *     every context the tests build.
 *   - Every code a cause is written for is a code the Laws or the server use.
 *
 *   node packages/scoring/test/causes.test.mjs
 */
import {
  deriveInnings, inningsStart, batters, bowler, ball, lawsRefusal, likelyCause, foldName,
  REFUSAL, REFUSAL_TEXT, REFUSAL_CAUSE, BALL_TYPE,
} from "../src/index.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
/** @param {string} t */
const group = (t) => console.log("\n" + t);

const UUID = "3f1c2a4e-9b7d-4c1a-8e2f-0a1b2c3d4e5f";
const SQUAD = [{ id: "a1", name: "R Pillay" }, { id: "a2", name: "D Erasmus" }, { id: "a3", name: "S Mokoena" }, { id: UUID, name: UUID }];
const BOWLING = [{ id: "b1", name: "K Naidoo" }, { id: "b2", name: "B Zulu" }, { id: UUID.replace("3f", "4f"), name: UUID.replace("3f", "4f") }];
const open = () => [
  inningsStart({ battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: SQUAD, bowlingSquad: BOWLING, overs: 2 }),
  batters({ striker: "a1", nonStriker: "a2" }),
  bowler({ bowler: "b1" }),
];
/** @param {number} v */
const run = (v) => ball({ type: BALL_TYPE.RUN, value: v });

group("Six legal balls: the pad closed the over, and a seventh is refused");
{
  const evs = [...open(), run(0), run(1), ball({ type: BALL_TYPE.WIDE }), run(0), run(4), run(0), run(1)];
  const inn = deriveInnings(evs);
  const code = lawsRefusal({ innings: [inn], events: [evs] }, run(0));
  ok("the Laws refuse the seventh ball: nobody is bowling the next over", code === REFUSAL.NEXT_BOWLER, code);
  const why = likelyCause(code, { inn });
  ok(`...and the cause counts the over's deliveries, the wide in it ("${why}")`,
     why === "8 balls in this over? Six legal balls are already recorded in over 1. Was one of them a wide or no-ball?");
  const plain = deriveInnings([...open(), ...[0, 1, 2, 0, 1, 0].map(run)]);
  ok("with six deliveries and no extra, it asks about the seventh",
     /^7 balls in this over\?/.test(likelyCause(REFUSAL.NEXT_BOWLER, { inn: plain }) ?? ""));
  const midOver = deriveInnings([...open(), run(0), run(1)]);
  ok("mid-over there is no such cause (the over is not closed)", likelyCause(REFUSAL.NEXT_BOWLER, { inn: midOver }) === null);
  ok("...nor without the innings (the held sheet passes only the event)", likelyCause(REFUSAL.NEXT_BOWLER, { ev: run(0) }) === null);
}

group("Names come from the fold, never an id");
{
  const evs = [...open(), ...[0, 0, 0, 0, 0, 0].map(run)];
  const inn = deriveInnings(evs);
  ok("a bowler the fold names", foldName(inn, "b1", "the bowler") === "K Naidoo");
  const byId = deriveInnings([
    inningsStart({ battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: SQUAD, bowlingSquad: BOWLING, overs: 2 }),
    batters({ striker: UUID, nonStriker: "a2" }), bowler({ bowler: BOWLING[2].id }), ...[0, 0, 0, 0, 0, 0].map(run)]);
  ok("the fold names a player it holds no name for by his id (the case this guards)",
     byId.batsmen.some((b) => b.name === UUID) && byId.bowlers.some((b) => b.name === BOWLING[2].id));
  ok("a player it knows only by a UUID is a role", foldName(byId, UUID, "the batter") === "the batter");
  const idCause = likelyCause(REFUSAL.CONSECUTIVE_OVERS, { inn: byId, ev: bowler({ bowler: BOWLING[2].id }) });
  ok(`...and so in a cause ("${idCause}")`, idCause != null && !idCause.includes(BOWLING[2].id) && /^The same bowler/.test(idCause));
  ok("an event id is never a name", foldName({ batsmen: [{ id: "x", name: "dev:match:k9:1" }] }, "x", "the batter") === "the batter");
  ok("an unknown id is a role", foldName(inn, "nobody-here", "the bowler") === "the bowler");
  const cons = likelyCause(REFUSAL.CONSECUTIVE_OVERS, { inn, ev: bowler({ bowler: "b1" }) });
  ok(`consecutive overs names him ("${cons}")`, cons === "K Naidoo bowled the last over. Was the new bowler named for the wrong over?");
  const anon = likelyCause(REFUSAL.CONSECUTIVE_OVERS, { ev: bowler({ bowler: BOWLING[2].id }) });
  ok(`...and without a name, no id ("${anon}")`, anon != null && !anon.includes(BOWLING[2].id) && /^The same bowler/.test(anon));
}

group("A wicket, and the batter to come");
{
  const evs = [...open(), run(1), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })];
  const inn = deriveInnings(evs);
  const code = lawsRefusal({ innings: [inn], events: [evs] }, run(0));
  ok("the Laws refuse the next ball: there is no batter at one end", code === REFUSAL.NEXT_BATTER, code);
  const why = likelyCause(code, { inn });
  ok(`...the cause says who is out ("${why}")`, why === "D Erasmus is out, and the next batter has not been named.");
}

group("An innings that is over says why");
{
  const evs = [...open(), ...Array.from({ length: 6 }, () => run(0)), bowler({ bowler: "b2" }), ...Array.from({ length: 6 }, () => run(1))];
  const inn = deriveInnings(evs);
  ok("two overs of two: over", inn.complete && inn.endReason === "overs_complete");
  ok("the cause is the overs", likelyCause(REFUSAL.INNINGS_OVER, { inn }) === "All 2 overs have been bowled.");
  ok("an unknown code has none", likelyCause("no_such_code", { inn }) === null && likelyCause(null) === null);
}

group("The words: no Law clause numbers, and only codes that exist");
{
  const known = new Set([...Object.values(REFUSAL), ...Object.keys(REFUSAL_TEXT)]);
  const stray = Object.keys(REFUSAL_CAUSE).filter((c) => !known.has(c));
  ok("every cause is for a code the Laws or the server use", stray.length === 0, stray.join(", "));
  const inns = [
    null,
    deriveInnings([...open(), ...[0, 0, 0, 0, 0, 0].map(run)]),
    deriveInnings([...open(), run(1), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]),
    deriveInnings([...open(), ...Array.from({ length: 6 }, () => run(0)), bowler({ bowler: "b2" }), ...Array.from({ length: 6 }, () => run(1))]),
  ];
  const evs = [null, run(0), bowler({ bowler: "b1" }), batters({ striker: "a1" })];
  const LAW = /\bLaws?\s*\d|\b\d{1,2}\.\d{1,2}(\.\d+)?\b/;
  const bad = [];
  let said = 0;
  for (const code of Object.keys(REFUSAL_CAUSE)) {
    for (const inn of inns) for (const ev of evs) {
      const w = likelyCause(code, { inn, ev });
      if (w == null) continue;
      said++;
      if (LAW.test(w) || w.includes(UUID) || /\bundefined\b|\bnull\b|NaN/.test(w)) bad.push(`${code}: ${w}`);
    }
  }
  ok(`${said} causes said over every code and context: no clause number, no id, nothing undefined`, said > 20 && bad.length === 0, bad.slice(0, 3).join(" | "));
}

console.log(`\nCAUSES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// rejudge.mjs (the Laws audit F4, db/121): which later balls' strikers the
// fold re-judges after an amendment voids an older one.
//   node services/api/write/rejudge.test.mjs
import { toRow } from "@scrbrd/scoring";
import { inningsStart, batters, bowler, ball, voidEvent } from "@scrbrd/scoring";
import { rejudgedStrikers } from "./rejudge.mjs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d); } };
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "aaaaaaaa-0000-0000-0000-000000000002";
/** Rows as the route reads them: toRow() with seq and the key. */
const rows = (evs) => evs.map((e, k) => ({ ...toRow({ ...e, innings: e.innings ?? 0 }), seq: k + 1, idempotency_key: `k${k + 1}` }));
const base = [inningsStart({ battingTeam: "H", bowlingTeam: "W" }), batters({ striker: A, nonStriker: B }), bowler({ bowler: "Bowler" })];

{
  // 4 a single (A), 5 a four (B), 6 a single (B), 7 two (A); 8 voids 4.
  const evs = [...base, ball({ type: "run", value: 1, striker: A }), ball({ type: "run", value: 4, striker: B }),
    ball({ type: "run", value: 1, striker: B }), ball({ type: "run", value: 2, striker: A })];
  const r = rows(evs);
  r.push({ ...toRow({ ...voidEvent({ target: "k4" }), innings: 0 }), seq: 8, idempotency_key: "k8" });
  const got = rejudgedStrikers(r, {}, { innings: 0, afterSeq: 4 });
  ok("after the void, 5 and 6 are A's and 7 is B's", JSON.stringify(got) === JSON.stringify([{ seq: 5, striker_id: A }, { seq: 6, striker_id: A }, { seq: 7, striker_id: B }]), JSON.stringify(got));
  ok("...nothing before the target, nothing where the stamp is right", rejudgedStrikers(rows(evs), {}, { innings: 0, afterSeq: 4 }).length === 0);
}
{
  // No batters event: the fold has nobody on strike, and re-judges nothing.
  const evs = [inningsStart({ battingTeam: "H", bowlingTeam: "W" }), ball({ type: "run", value: 1, striker: A }), ball({ type: "run", value: 4, striker: B })];
  const r = rows(evs);
  r.push({ ...toRow({ ...voidEvent({ target: "k2" }), innings: 0 }), seq: 4, idempotency_key: "k4" });
  ok("a log with nobody on strike keeps its stamps", rejudgedStrikers(r, {}, { innings: 0, afterSeq: 2 }).length === 0);
}
{
  // A typed-name striker the fold has, where the stamp named a player: NULL.
  const evs = [...base.slice(0, 1), batters({ striker: "T Typed", nonStriker: A }), bowler({ bowler: "Bowler" }),
    ball({ type: "run", value: 1, striker: "T Typed" }), ball({ type: "run", value: 1, striker: A })];
  const r = rows(evs);
  r.push({ ...toRow({ ...voidEvent({ target: "k4" }), innings: 0 }), seq: 6, idempotency_key: "k6" });
  const got = rejudgedStrikers(r, {}, { innings: 0, afterSeq: 4 });
  ok("a typed name faced it: not attributable, NULL", JSON.stringify(got) === JSON.stringify([{ seq: 5, striker_id: null }]), JSON.stringify(got));
}
{
  // The review's B2: db/99 §98 runs the precheck's query word for word, so a
  // seeded database's zero is the query the lead runs on production.
  const marked = (file) => {
    const t = readFileSync(new URL(file, import.meta.url), "utf8");
    const a = t.indexOf("-- precheck:begin"), b = t.indexOf("-- precheck:end");
    return a >= 0 && b > a ? t.slice(a, b) : null;
  };
  const tool = marked("../../../tools/sql/laws121-precheck.sql"), verify = marked("../../../db/99_rls_verify.sql");
  ok("the precheck's query is marked in tools/sql/laws121-precheck.sql", tool != null && tool.includes("ball_event_live"));
  ok("db/99 §98's copy is the precheck's query, word for word", tool != null && tool === verify);
}

console.log(`\nrejudge: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

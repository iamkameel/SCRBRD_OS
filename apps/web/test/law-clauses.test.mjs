/**
 * No Law clause number on any scorer screen (SCRBRD-094: Kameel is verifying
 * the numbers against the current Code, so no screen shows one until he has).
 *
 * A sweep of every string a scorer screen can show, not a list of the ones
 * somebody remembered:
 *
 *   - REFUSAL_TEXT, every code — the held sheet shows it as it is;
 *   - REFUSAL_CAUSE, every code over a spread of folds and events;
 *   - PENALTY_REASON_TEXT, through penaltyReasonWords(), as every screen reads it;
 *   - the suspension words: the reasons, the scopes, suspensionWords(), and the
 *     pad's own helpers over them;
 *   - every pad helper that turns a refusal code into words, over every code;
 *   - the sheets' literal text: every string and every piece of JSX text in
 *     apps/web/src/scorer, comments stripped (a clause number may stay in a
 *     comment — that is where the Laws are cited for the next reader).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/law-clauses.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import {
  inningsStart, batters, bowler, ball, BALL_TYPE, REFUSAL, REFUSAL_TEXT, REFUSAL_CAUSE, likelyCause, deriveInnings,
  PENALTY_REASON, PENALTY_REASON_TEXT, penaltyReasonWords, SUSPENSION_REASON, SUSPENSION_REASON_TEXT,
  SUSPENSION_SCOPE_TEXT, SUSPENSION_REASON_SCOPE, suspensionWords, bowlerSuspended, SCORING_BLOCK_TEXT,
} from "@scrbrd/scoring";
import { reasonWords as heldReasonWords } from "@scrbrd/sync";
import { refusalWords, reasonWords as padPenaltyWords } from "../src/scorer/penalty.js";
import { suspensionReasonWords, suspensionRefusalWords, scopeWords } from "../src/scorer/suspension.js";
import { retireRefusalWords } from "../src/scorer/retire.js";
import { unavailableWords } from "../src/scorer/prompts.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

/**
 * A Law clause number: "Law 40", "Laws 17", "(Law …", or a bare three-part
 * clause such as 17.8.1. Not a two-part decimal on its own: "over 1.2" is how
 * a scorer writes where in the innings something happened.
 */
const CLAUSE = /\bLaws?\s*\d|\(\s*Laws?\b|\b\d{1,2}\.\d{1,2}\.\d+\b/;
const clauses = (xs) => xs.filter((x) => typeof x === "string" && CLAUSE.test(x));

// The codes: every refusal the Laws make, and every key the words tables hold.
const CODES = [...new Set([...Object.values(REFUSAL), ...Object.keys(REFUSAL_TEXT), ...Object.keys(REFUSAL_CAUSE)])];

group("The pattern itself");
{
  ok("it finds a clause in brackets", CLAUSE.test("injury or suspension (Law 17.8.1)"));
  ok("...after a colon", CLAUSE.test("Law 17.8.1: a bowler may be replaced"));
  ok("...and a bare three-part clause", CLAUSE.test("the protected area, 41.13.2"));
  ok("it leaves the Laws named in words alone", !CLAUSE.test("The Laws refuse this. He is not at the crease."));
  ok("...and where in the innings: over 1.2", !CLAUSE.test("at over 1.2, for a beamer"));
}

group("REFUSAL_TEXT and REFUSAL_CAUSE");
{
  ok(`REFUSAL_TEXT: none of ${Object.keys(REFUSAL_TEXT).length}`, clauses(Object.values(REFUSAL_TEXT)).length === 0,
     clauses(Object.values(REFUSAL_TEXT)).join(" | "));
  const SQUAD = [{ id: "a1", name: "R Pillay" }, { id: "a2", name: "D Erasmus" }, { id: "a3", name: "S Mokoena" }];
  const BOWLING = [{ id: "b1", name: "K Naidoo" }, { id: "b2", name: "B Zulu" }];
  const open = () => [inningsStart({ battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: SQUAD, bowlingSquad: BOWLING, overs: 2 }),
    batters({ striker: "a1", nonStriker: "a2" }), bowler({ bowler: "b1" })];
  const run = (v) => ball({ type: BALL_TYPE.RUN, value: v });
  const all = deriveInnings([...open(), ...Array.from({ length: 6 }, () => run(0)), bowler({ bowler: "b2" }), ...Array.from({ length: 6 }, () => run(1))]);
  const inns = [null, deriveInnings([...open(), ...[0, 0, 0, 0, 0, 0].map(run)]),
    deriveInnings([...open(), run(1), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]), all,
    { ...all, endReason: "all_out" }, { ...all, endReason: "target_reached", target: 9 }, { ...all, sealed: true }];
  const evs = [null, run(0), bowler({ bowler: "b1" }), batters({ striker: "a1" }), { kind: "retire", batter: "a2", reason: "hurt" }];
  const said = [];
  for (const code of CODES) for (const inn of inns) for (const ev of evs) {
    const w = likelyCause(code, { inn, ev });
    if (w != null) said.push(`${code}: ${w}`);
  }
  ok(`REFUSAL_CAUSE: none of ${said.length} causes over every code, fold and event`, said.length > 30 && clauses(said).length === 0,
     clauses(said).join(" | "));
}

group("Penalty runs and suspensions");
{
  const reasons = Object.keys(PENALTY_REASON_TEXT);
  ok("PENALTY_REASON_TEXT still carries clauses (for the code's reader) — the screens read it through penaltyReasonWords",
     clauses(Object.values(PENALTY_REASON_TEXT)).length > 0);
  const words = [...reasons.map(penaltyReasonWords), ...Object.values(PENALTY_REASON).map(padPenaltyWords)];
  ok(`penaltyReasonWords, and the pad's buttons: none of ${words.length}`, words.length >= reasons.length && clauses(words).length === 0,
     clauses(words).join(" | "));
  const reasonsS = Object.values(SUSPENSION_REASON);
  const susp = [
    ...Object.values(SUSPENSION_REASON_TEXT), ...Object.values(SUSPENSION_SCOPE_TEXT),
    ...reasonsS.map((r) => suspensionWords(bowlerSuspended({ bowler: "b1", reason: r, scope: SUSPENSION_REASON_SCOPE[r] }))),
    ...reasonsS.map(suspensionReasonWords), ...reasonsS.map(scopeWords),
  ];
  ok(`the suspension words: none of ${susp.length}`, susp.length >= 4 * reasonsS.length && clauses(susp).length === 0, clauses(susp).join(" | "));
}

group("Every pad helper that says a refusal, over every code");
{
  const helpers = { refusalWords, suspensionRefusalWords, retireRefusalWords, unavailableWords, heldReasonWords };
  for (const [name, f] of Object.entries(helpers)) {
    const out = CODES.map((c) => f(c)).filter((w) => w != null);
    ok(`${name}: none of ${out.length}`, out.length >= CODES.length - 1 && clauses(out).length === 0, clauses(out).join(" | "));
  }
  const blocks = Object.values(SCORING_BLOCK_TEXT).flatMap((t) => [t.says, t.fix]);
  ok(`the pad's "can't score yet" words: none of ${blocks.length}`, clauses(blocks).length === 0, clauses(blocks).join(" | "));
}

/**
 * Every string literal, template piece and piece of JSX text in a source
 * file, comments stripped. esbuild compiles the JSX (its text becomes string
 * arguments) and drops the comments; this walks what is left, skipping
 * regular expressions, which are code and not words.
 * @param {string} source @param {string} file
 */
function literals(source, file) {
  const { code } = transformSync(source, { loader: file.endsWith(".jsx") ? "jsx" : "js", jsx: "automatic", format: "esm", legalComments: "none", charset: "utf8" });
  const out = [];
  let i = 0, prev = "";
  const regexCan = () => prev === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of|void|delete|new)$/.test(prev);
  /** Read a quoted string from i (at the quote); returns its text. */
  const quoted = (q) => { let s = ""; i++; while (i < code.length && code[i] !== q) { if (code[i] === "\\") { s += code[i + 1]; i += 2; } else s += code[i++]; } i++; return s; };
  /** Walk code until an unmatched "}" (inside a template's ${…}), or the end. */
  const walk = (inExpr) => {
    let depth = 0;
    while (i < code.length) {
      const c = code[i];
      if (c === '"' || c === "'") { out.push(quoted(c)); prev = "x"; continue; }
      if (c === "`") { template(); prev = "x"; continue; }
      if (c === "/" && code[i + 1] === "/") { while (i < code.length && code[i] !== "\n") i++; continue; }
      if (c === "/" && code[i + 1] === "*") { i = code.indexOf("*/", i + 2) + 2; continue; }
      if (c === "/" && regexCan()) {
        i++; let cls = false;
        while (i < code.length && (code[i] !== "/" || cls)) { if (code[i] === "\\") i++; else if (code[i] === "[") cls = true; else if (code[i] === "]") cls = false; i++; }
        i++; while (/[a-z]/i.test(code[i] ?? "")) i++;
        prev = "x"; continue;
      }
      if (c === "{") depth++;
      if (c === "}") { if (inExpr && depth === 0) { i++; return; } depth--; }
      if (!/\s/.test(c)) prev = (/[\w$]/.test(c) && /[\w$]$/.test(prev)) ? prev + c : c;
      i++;
    }
  };
  const template = () => {
    let s = ""; i++;
    while (i < code.length && code[i] !== "`") {
      if (code[i] === "\\") { s += code[i + 1]; i += 2; continue; }
      if (code[i] === "$" && code[i + 1] === "{") { out.push(s); s = ""; i += 2; walk(true); continue; }
      s += code[i++];
    }
    i++; out.push(s);
  };
  walk(false);
  return out.filter((s) => s.trim() !== "");
}

group("The sheets' literal text: every scorer source file, comments stripped");
{
  // The sweep can see a clause in JSX text, a string and a template, and not
  // in a comment or a regular expression.
  const probe = literals(`// Law 17.8.1 is cited here
    /** (Law 40) */
    const re = /\\bLaws?\\s+\\d/;
    export const A = () => <p title="x">Timed out (Law 40)</p>;
    export const B = (n) => \`over \${n ? "Law 41.13" : 1} done\`;`, "probe.jsx");
  const found = clauses(probe);
  ok("the sweep sees a clause in JSX text and in a template's expression", found.includes("Timed out (Law 40)") && found.includes("Law 41.13"),
     JSON.stringify(probe));
  ok("...and none in the comments or the regular expression", found.length === 2, JSON.stringify(found));

  const dir = new URL("../src/scorer/", import.meta.url).pathname;
  const files = readdirSync(dir).filter((f) => /\.(jsx?|mjs)$/.test(f));
  let n = 0;
  const hits = [], seen = new Set();
  for (const f of files) {
    const lits = literals(readFileSync(join(dir, f), "utf8"), f);
    n += lits.length;
    for (const s of lits) seen.add(s.trim());
    for (const s of clauses(lits)) hits.push(`${f}: ${s}`);
  }
  // Not vacuous: the words the three clause numbers were taken from, and the
  // sheets' headings, are among what it read.
  const known = ["Incoming batter timed out?", "Timed out — tap the batter who did not arrive in time",
    "Injury or suspended?", "Retired hurt — may resume", "Batter retired hurt", "Who is going off?"];
  ok("it reads the sheets' words", known.every((k) => seen.has(k)), known.filter((k) => !seen.has(k)).join(" | "));
  ok(`${files.length} files, ${n} strings: no Law clause number in any`, files.length >= 20 && n > 1000 && hits.length === 0, hits.join(" | "));
  ok("...the sweep reaches the new sheet", files.includes("retireSheet.jsx") && files.includes("retire.js"));
}

console.log("\n" + "─".repeat(52));
console.log(`LAW CLAUSES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

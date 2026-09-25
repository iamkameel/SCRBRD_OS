#!/usr/bin/env node
/**
 * The API walks, each against a freshly seeded database.
 *
 * This replaces a single 1,400-character `smoke:api` line in package.json that
 * repeated `migrate --reset --seed && node tools/smoke-X.mjs` sixteen times.
 * Nobody could read it, and the predictable thing happened: smoke-squad.mjs
 * was written, passed, committed — and never added, so the walk proving that a
 * fifteen-year-old cannot be named for a U13 fixture had never once run in a
 * verify. A check that exists and never runs is the shape of failure this
 * whole feature was written to close, and it had reappeared in the tooling.
 *
 * So the list is a list, and UNLISTED() below fails the run if a smoke walk
 * exists on disk that neither this file nor `smoke` in package.json names. You
 * cannot quietly add a walk that nobody runs any more.
 *
 *   node tools/run-smoke-api.mjs            all of them
 *   node tools/run-smoke-api.mjs toss squad  just these
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Every walk here gets a reset first: they assert against seeded rows and a
// previous walk's writes would make them pass or fail for the wrong reason.
const WALKS = [
  "read", "sync", "handover", "handover-crash", "fold",
  "assess", "access", "eligibility", "roster", "audit", "guardian",
  "rating", "notes", "amend", "login",
  // The owner's key, minted from outside the platform, and redeemed.
  "bootstrap",
  // The way out of quarantine: who may open it, and what a released ball is.
  "quarantine",
  // A retry writes once: the Idempotency-Key layer over every write route.
  "idempotency",
  // What a scoring command may be, decided by the server at commit: one key
  // one event (db/36), last-in-first-out undo, and the Laws.
  "laws",
  // The owner's own way back in, off by default, gated on its own secret.
  "owner-recovery",
  // Pre-match: who can play, naming the side, calling the toss, and the
  // conditions both sides play in.
  "availability", "squad", "toss", "conditions",
  // Getting the side there: three capabilities that had nothing to act on.
  "transport",
  // The dashboard's figures, and the scope they are counted over.
  "summary",
  // An innings in three parts, and the scope the parts inherit.
  "phases",
  // The scouting consent primitive: accreditation, consent, evidence.
  "scouting",
  // The scorecard a viewer opens from Match Centre: the real replay, not a
  // seeded reconstruction of the final score.
  "scorecard",
  // Appointing the officials: officiating.assign, which had nothing to act on.
  "officials",
  // A duty and the authority it rests on: the office links, suspends and
  // lifts, each with a reason; withdrawing the duty revokes it (SCRBRD-034).
  "duties",
  // The head-to-head against a rival, derived from the fixtures rather than
  // stored beside them.
  "derby",
  // Batter against bowler, and how much of the log a matchup can speak for.
  "matchups",
  // DRS, and the platform switch that holds it off until there is
  // ball-tracking to feed it.
  "drs",
  // The public overlay, and the names that do not go on it.
  "broadcast",
  // Stats-Magic's own context: real career figures from /read/career, and no
  // child's name in the request that would have gone to the model provider.
  "statsmagic",
  // Sponsorship: which brands may be on a child's scoreboard, and what stays
  // between the school and the sponsor.
  "commercial",
  // Module access: three levels, one direction each, and the assertion that
  // switching everything on grants nobody a single row.
  "modules",
  // The two ways an authorization model dies: nobody appoints themselves
  // upward, and nobody gets locked out.
  "escalation",
  // Getting four hundred boys in, and the data back out.
  "csv",
  // The intersection three people own: the family's answer, the physio's
  // restriction and the coach's XI, which nothing joined until now.
  "readiness",
  // The notification system's missing half: publishing a notice, and getting
  // it onto a phone without re-deciding who may have it.
  "push",
  // The rewards algorithm's coefficients, and the fact that nobody can read
  // them — including the people whose boys the figure is about.
  "rewards",
  // School sport rather than cricket: a sport is a dimension, most of the
  // product turns out to be sport-agnostic, and cricket's machinery is
  // cricket's.
  "sport",
  // One fixture, two schools — and a route to arrange one, which the product
  // had never had.
  "fixture",
  // Moving a boy between sides WITH A DATE, and reading a side as it stood on
  // one. The history table itself is smoke-membership's.
  "moves",
  // Who to ring when something happens to a child, and whether the bus is
  // insured to carry him.
  "contacts",
  "clearance",
  "workload",
  "recognition",
  "season",
  "requests",
  "enrol",
  "kit",
  "passport",
  "web",
  "roster-add",
  // Where a boy has played: derived from team_code writes, forgeable by
  // nobody, and the end of a promotion overwriting a season.
  "membership",
  // Reading the other side ahead of a fixture: the one deliberate crossing of
  // the tenant line, bounded by a fixture, a window and a column list.
  "opposition",
  // The officials register: a panel that belongs to no school, read
  // through official_masked so a name is public and a person is not.
  "register",
  // The gaps db/10 and db/11 could only warn about, and the one write route
  // that closes the first of them.
  "dob-gaps",
  "support",
  // The disciplinary record: two capabilities that were in six role bundles
  // and gated nothing, and the only policy in the schema whose fixture anchor
  // is allowed to be NULL.
  "discipline",
  // How a boy is out, and how a bowler takes wickets, by method rather than
  // as a single count.
  "dismissals",
  // A wicket the free hit saved: the fold and every SQL reader agree, over
  // generated logs (db/42).
  "free-hit",
  // Every batting and bowling figure SQL keeps is the fold's — who is out at
  // either end, the opposition's figures, a ball with no type, a wicket with
  // no method — and the doors that refuse the last two (db/43).
  "fold-figures",
  "commit",
  // The API refuses to start on a database missing a migration it was built
  // against, and starts on one that is ahead of it (SCRBRD-066).
  "schema-guard",
];

// Walks that drive a real browser AND need a database. They need two things
// the API walks do not — a built client in apps/web/dist and a Chromium — so
// they run under `--browser` rather than in the default set. Splitting them
// out is not tidiness: CI's first run put them in the API job, which had
// neither, and both jobs failed on a missing dist/index.html.
// browser-held provokes a refusal on the pad and resolves it (SCRBRD-070):
// discard, the cascade, record again, and the handover warning.
// browser-pad-laws asks the pad the 2026-09-24 questions (SCRBRD-081, 080,
// 068, 069) and holds the board to the server's fold of what it wrote.
// browser-innings-end scores an innings to its end, which nothing else does:
// browser-sync taps four deliveries of twenty overs, so the review gate between
// the last ball and a closed innings was never exercised end to end.
const BROWSER_WALKS = ["browser-sync", "browser-read", "browser-deck", "browser-dossier", "browser-handover", "browser-innings-end", "browser-quarantine", "browser-drs", "browser-dismissals", "browser-discipline", "browser-support", "browser-seasons", "browser-rulebook", "browser-duties", "browser-fixture-create", "browser-held", "browser-toss", "browser-offline-undo", "browser-dayof",
  // SCRBRD-082 / SCRBRD-084: the Post-Match Report and the Season Awards tab.
  "browser-report", "browser-awards",
  // SCRBRD-068/069/080/081: the pad's four new Laws questions.
  "browser-pad-laws"];

// Walks that need no database, run by `pnpm smoke` instead. Named here only so
// the completeness check below knows they are accounted for.
const NO_DB = ["", "scorer", "persist", "a11y"];

const onDisk = readdirSync("tools")
  .filter((f) => /^smoke.*\.mjs$/.test(f))
  .map((f) => f.replace(/^smoke-?/, "").replace(/\.mjs$/, ""));
const known = new Set([...WALKS, ...BROWSER_WALKS, ...NO_DB]);
const unlisted = onDisk.filter((n) => !known.has(n));
if (unlisted.length) {
  console.error(`\n✗ smoke walks exist that nothing runs: ${unlisted.map((n) => `smoke-${n}`).join(", ")}`);
  console.error("  Add them to WALKS in tools/run-smoke-api.mjs (BROWSER_WALKS if they drive a browser, NO_DB if they need no database).");
  process.exit(1);
}

// `--browser` runs the browser set instead of the API set. Both are named
// walks on the same runner, so a browser walk still gets its own reset and
// still cannot go unlisted.
// A bare "--" arrives when a package manager forwards arguments (pnpm keeps
// the separator; npm eats it). It is noise from the caller, not a walk name.
const args = process.argv.slice(2).filter((a) => a !== "--");
const wantBrowser = args.includes("--browser");
const only = args.filter((a) => a !== "--browser");
const pool = wantBrowser ? BROWSER_WALKS : WALKS;
const run = only.length ? pool.filter((w) => only.includes(w)) : pool;
if (only.length && run.length !== only.length) {
  console.error(`✗ unknown walk: ${only.filter((o) => !pool.includes(o)).join(", ")}`);
  process.exit(1);
}

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// ── The live RLS verifier, once, before any walk ────────────────
//
// db/99_rls_verify.sql asserts the policies against a real connection as real
// principals, and it is the only thing in the project that can catch a policy
// that is correct in the model and inert in the database. It ran only when
// somebody typed `--verify`, and so it sat red: an assertion written as a row
// COUNT had stopped matching a seed that grew, and the failure went unseen
// through several sessions of work — a verifier nothing runs is a document,
// which is the failure mode this project keeps naming in other people's repos.
//
// It runs here because this is the one entry point that already has a database
// and already refuses to start when something is missing. Hard exit rather
// than a failed line in the summary: if the policies do not hold, what the
// walks go on to prove about the routes is not worth reading.
{
  const v = sh("node", ["tools/migrate.mjs", "--reset", "--seed", "--verify"]);
  if (v.status !== 0) {
    console.error("\n✗ the live RLS verifier failed — not running the walks");
    console.error((v.stdout + v.stderr).split("\n").filter((l) => /ASSERT|ERROR|✗/.test(l)).slice(0, 8).join("\n"));
    process.exit(1);
  }
  console.log("✓ rls-verify      live policy assertions hold");
}

let allPass = true;
const summary = [];

for (const walk of run) {
  const reset = sh("node", ["tools/migrate.mjs", "--reset", "--seed"]);
  if (reset.status !== 0) {
    console.log(`✗ ${walk.padEnd(14)} could not reset the database`);
    console.log((reset.stdout + reset.stderr).split("\n").slice(-6).join("\n"));
    allPass = false; summary.push({ walk, ok: false, passed: 0 });
    continue;
  }
  const r = sh("node", [`tools/smoke-${walk}.mjs`]);
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : (r.status === 0 ? 0 : "?");
  const ok = r.status === 0 && failed === 0;
  if (!ok) allPass = false;
  summary.push({ walk, ok, passed });
  console.log(`${ok ? "✓" : "✗"} ${walk.padEnd(14)} ${m ? m[0] : "(no summary — see below)"}`);
  // On failure show the failing assertions, not the whole walk: the group
  // headings are context and the ✗ lines are the finding.
  if (!ok) console.log(out.split("\n").filter((l) => l.includes("✗") || l.includes("Error")).slice(0, 10).join("\n"));
}

const total = summary.reduce((a, s) => a + s.passed, 0);
console.log("\n" + "─".repeat(52));
console.log(`${allPass ? "ALL WALKS PASSED" : "SOME WALKS FAILED"} · ${total} assertions across ${run.length} walks`);
process.exit(allPass ? 0 : 1);

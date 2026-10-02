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
  // A handover verifies against THIS innings, penalty runs included (SCRBRD-088, db/45).
  "handover-innings",
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
  // A competition's playing conditions (SCRBRD-114, db/61): versions,
  // citations, the fixture's competition, the document fixed on the first
  // event (live and on the pad's credential), the handover's hash.
  "playing-conditions",
  // ── SCRBRD-114 phase 3a (db/69): match results and the league table ──
  // Two matches scored on the real write path, the result in words, the
  // table computed under the league's figures, a walkover, adjustments, a
  // re-fix, an amendment that flips a result, and the signed-out reads.
  "results",
  // ── end SCRBRD-114 phase 3a ──
  // ── SCRBRD-114 phase 3b (db/71): the super over ──
  // A cup tie and a friendly's, scored on the real write path; the cup tie
  // waits for its super over; the Laws and the document at the door; the
  // pair scored; the result, the live score, careers and the bowler's day;
  // completion once settled; the signed-out log and header.
  "superover",
  // ── SCRBRD-114 phase 3c (db/72): knockout progression ──
  // A cup drawn by the planner and published; the semi-finals played; the
  // final made from their winners with a row for each side; a correction
  // re-resolves the unplayed final and flags the played one; the organiser
  // clears the flag with a note.
  "progression",
  // ── SCRBRD-130 R1/R3 (db/73, db/74): rain on the real write path — the
  // server refusing play while stopped, a revision behind the balls, a par
  // without a target; a chase decided on the umpires' par; venue par at a
  // ground and at a point in a live innings. ──
  "rain",
  // The scorebook importer (SCRBRD-120, db/63): photos stripped and read on
  // the log, a card ticked and checked, two people, the commit's Laws and
  // seal, the match complete, the amendment path, the purge.
  "scorebook",
  // The fixture planner, phase 2 (SCRBRD-123, db/67): the ground owner's
  // windows and closures, blackouts, a draft computed on the server from the
  // database, a lock kept by regenerating, and publishing through the
  // fixture route — twice, making each match once.
  "planner",
  // Making a league (SCRBRD-123, db/67 §8a–8c): created by the league, four
  // teams invited and answered by their schools, conditions from the
  // platform's defaults and published, and the planner over the three that
  // accepted.
  "competition",
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
  // SCRBRD-110 phase 1 (db/60): the nets band and the health consent, over HTTP.
  "load",
  // SCRBRD-110 phase 0 (db/62): the guardian link past eighteen — open while
  // he is at school, ended when he leaves — and option C for the public name.
  "link18",
  "recognition",
  "season",
  "requests",
  "enrol",
  // Ending a role (SCRBRD-132 C1, db/77): the other half of enrolling —
  // ended with a reason, holding nothing on the next request, on the record,
  // told without the reason; the guardian link's rules and nobody's last key.
  "end-role",
  // The audit log, read (SCRBRD-132 B2, db/79): under audit.read, one school
  // at a time, a child in initials, never a safeguarding row or a reason,
  // and every read of it on the record. (smoke-audit is access_log's own.)
  "audit-log",
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
  // Safeguarding, phase 1 (db/57): anybody raises a concern and keeps only a
  // reference; the DSO, and nobody else, reads it — and the log says so to
  // nobody else either.
  "safeguarding",
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
  // The pad's resume credential (SCRBRD-078 option B, db/50): issued on a
  // claim, good for five routes on one match, refused on every other route,
  // and ended by every path that ends it. SCRBRD-087 with an ordinary token.
  "pad-resume",
  // The API refuses to start on a database missing a migration it was built
  // against, and starts on one that is ahead of it (SCRBRD-066).
  "schema-guard",
  "public",
  // Parent lift clubs, phase 1 (SCRBRD-124, db/70): the school's two keys, a
  // driver's declaration, a round trip made as one act, consent per boy per
  // lift by version, the fixture moving under it, names and numbers through
  // the logged doors only, and a family's "no" never switched off.
  "lifts",
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
  // Redesign step 3c / SCRBRD-098: the Match Centre's six tabs, the
  // scorecard's layout and the shared commentary, on a real scored match.
  "browser-matchcentre",
  // SCRBRD-124 phase 1 (db/70): the principal's lift policy, a parent's
  // declaration, a round trip offered, a seat asked for and accepted, the
  // office's counts, and no lifts block where the module is not live.
  "browser-lifts",
  // Wave A of the prototype clean-up (1 October 2026): the kit register
  // alone on Logistics, no dead injury controls, the Skills axis, school
  // search from the platform's list, Profiles' school name from the read,
  // Squad's Set Availability and Edit Profile, and a still pitch drawing.
  "browser-cleanup",
  // SCRBRD-068/069/080/081: the pad's four new Laws questions.
  "browser-pad-laws",
  // SCRBRD-078/075/079: a scorer's day with poor signal — the pad loads and
  // reloads with none, says "sign in to send", retries its claim, sends the
  // toss first, matches the server id for id, and clears its outbox at the end.
  "browser-offline-day",
  // SCRBRD-078 option B: a reloaded pad re-attaches with its resume
  // credential and sends by itself, nobody signed in; force-released, it
  // stops in words; signed in again, it goes on.
  "browser-pad-resume",
  // SCRBRD-094 item 1: the pad's penalty runs sheet — five to either side,
  // a short run, a credit the next innings opens on, a target raised
  // mid-chase, a refusal said in place — held to the API's live score.
  "browser-penalty",
  // ── SCRBRD-130 R1 (db/73): rain on the pad — play stopped and the keys
  // off, resumed at fewer overs, the first innings cut short and the
  // umpires' figures for the chase, the chase cut short with their par and
  // the server's result decided on it. ──
  "browser-rain",
  // SCRBRD-094 item 2: a bowler suspended mid-over — the reason in words,
  // the replacement only from the bowlers the Laws take, the suspended man
  // and the replacement refused after, split-over figures on the scorecard,
  // the API and SQL, a reload, and the umpires' report.
  "browser-suspension",
  // SCRBRD-113: the Laws' 4th Edition on a fixture dated 3 October 2026 —
  // the bouncer over head height, how long each suspension is for, the
  // fielding captain's choice of striker after short running and an
  // obstructed catch, and a delivery that does not count in the over.
  "browser-laws4",
  // SCRBRD-100 "Left, on the pad": dot and 1 the biggest keys, every extra in
  // two taps stored as the event it always was, undo in words, the likely
  // bowler and the next batter first, a refusal's likely cause, the haptic
  // tick — held to the API's live score at 390 × 844.
  "browser-padfeel",
  // SCRBRD-101: the wagon wheel — a point from the pad's Area step, OFF and
  // LEG by the batter's hand, the hub's event for the same tap, the Match
  // Centre's mixed-hand wheel and a left-hander's sector-era ball re-worded.
  "browser-wagonwheel",
  // SCRBRD-071: a batter retired hurt from the pad's menu, mid-over — not a
  // wicket; the next batter at once, the over finished, the scorecard's
  // "retired hurt", and his return with his line going on — held to the
  // API's live score and SQL's player_innings at 390 × 844.
  "browser-retire",
  // Safeguarding, phase 1 (db/57): a parent raises a concern and keeps a
  // reference; the DSO finds it in her inbox; a coach sees nothing of it.
  "browser-safeguarding",
  // Redesign step 4, phase A: the pupil's app — his Home, his own answer, his
  // passport and his own file; no team-mate's injury, fitness or return date
  // (K3, db/55); 12px and 44px at phone width.
  "browser-pupil",
  // The public pages, phase 1 (db/59): signed out, names by the rule, noindex.
  "browser-public",
  // SCRBRD-110 phase 1 (db/60): the health-monitoring consent on Settings → Me,
  // the eighteen card, and the sign-up row — both themes, 12px and 44px.
  "browser-consent",
  // Playing conditions, phase 1 (db/61, SCRBRD-114): a fixture arranged in a
  // league pre-filled from its conditions; the pad's words; the bowled after
  // a no-ball standing where the league says no free hit.
  "browser-playing-conditions",
  // ── SCRBRD-114 phase 3a (db/69): the table, the decision and adjustment
  // sheets as the organiser uses them, the participant's read, the Match
  // Centre's and the public page's result line; 12px, 44px, 390, Daylight.
  "browser-results",
  // ── end SCRBRD-114 phase 3a ──
  // ── SCRBRD-114 phase 3b, the screens: a tied cup match scored on the pad,
  // the Super over button and its sheet, the board's block (target, balls
  // left, wickets left of two), two wickets ending an innings, a second
  // super over with the eligibility words, the result as the engine words
  // it, the scorecard block below the match's innings, and a league tie with
  // no button and the words why; 390, the 12px and 44px floors. ──
  "browser-superover",
  // ── end SCRBRD-114 phase 3b screens ──
  // The playing-conditions screen (SCRBRD-114, Leagues → the competition →
  // Playing conditions): an organiser drafts, cites, is refused in words,
  // publishes for tomorrow, versions and withdraws; the version in force with
  // its count and sources; a reader sees it read-only with no draft; phone,
  // both themes, the 12px and 44px floors.
  "browser-playing-conditions-screen",
  // The scorebook importer's three screens (SCRBRD-120, Match Centre → a played
  // fixture): a scorer adds pages (a text file and a huge photo refused in
  // words), types the card beside them and submits it; she cannot confirm; the
  // director of sport returns it with a note, then confirms; the scorecard says
  // "From the scorebook"; a book that is out is acknowledged; a person who
  // worked on the card is told why she cannot confirm; a parent sees no entry
  // point; phone, Daylight, the 12px and 44px floors.
  "browser-scorebook",
  // Making a league and planning its fixtures (SCRBRD-127 the wizard, SCRBRD-123
  // the planner screen): a league administrator makes a league and invites four
  // teams, told in words she cannot accept for a school; two schools answer from
  // "Invitations to leagues" (three accept, one declines); conditions start from
  // the Laws and the platform's defaults, are ticked and entered (points 4/2/2/0,
  // a super over) and published from tomorrow; a ground owner offers slots,
  // closes the ground and names its ends; the planner draws a bracket and a
  // round robin, shows a fixture's reasons, locks, regenerates and publishes with
  // a per-fixture report; phone, Daylight, the 12px and 44px floors.
  "browser-league",
  // Management → Users on the real directory: each person with every role they
  // hold (ended ones muted and worded), Add user / Add role saved for real, a
  // role the caller may not grant not offered and a forced post refused in
  // words, the fake actions gone, tabs by capability, no invented audit or
  // ground tasks, nothing offered signed out; 12px, 44px, phone.
  "browser-management"];

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

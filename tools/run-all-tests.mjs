#!/usr/bin/env node
/**
 * Runs every SCRBRD suite and reports a combined pass/fail.
 *
 * The scoring suite runs first: it proves the fold that every other layer
 * derives from, so a failure there makes the rest of the output noise.
 */
import { spawnSync } from "node:child_process";

const SUITES = [
  ["authorize","packages/policy/test/authorize.test.mjs"],
  ["scoring",  "packages/scoring/test/replay.test.mjs"],
  ["laws-spec","packages/scoring/test/laws-spec.test.mjs"],
  ["design",   "apps/web/test/design.test.mjs"],
  ["analytics","apps/web/test/analytics.test.mjs"],
  ["home-routing","apps/web/test/home-routing.test.mjs"],
  ["teams",    "packages/policy/test/teams.test.mjs"],
  ["sa-id",    "packages/policy/test/sa-id.test.mjs"],
  ["dob",      "packages/policy/test/date-of-birth.test.mjs"],
  ["modules",  "packages/policy/test/modules.test.mjs"],
  ["separation","packages/policy/test/separation.test.mjs"],
  ["sensitivity","packages/policy/test/sensitivity.test.mjs"],
  ["invariants","packages/policy/test/invariants.test.mjs"],
  // What a signed-out page may show about a pupil (SCRBRD-083): the surfaces,
  // the never-public list against every masked column, the name rule.
  ["public",   "packages/policy/test/public.test.mjs"],
  ["rating",   "packages/scoring/test/rating.test.mjs"],
  ["rubric",   "packages/scoring/test/rubric.test.mjs"],
  ["readiness","packages/scoring/test/readiness.test.mjs"],
  // What a scoring command may be: the Laws the server enforces at commit.
  ["laws",     "packages/scoring/test/laws.test.mjs"],
  // The wicket-keeper (SCRBRD-126): the event, the keeper at each ball, his
  // catches and stumpings, a stumping only his (Law 39), the words.
  ["keeper",   "packages/scoring/test/keeper.test.mjs"],
  // ── SCRBRD-114 phase 3a (db/69): a match's result ──
  // describeResult() over the design's logs (result-logs.mjs, which
  // smoke-fold-figures holds match_result() to): the abandoned seal and two
  // innings a side read right, decisions, and the words.
  ["result",   "packages/scoring/test/result.test.mjs"],
  // ── end SCRBRD-114 phase 3a ──
  // ── SCRBRD-114 phase 3b (db/71): the super over — the marker, the fold's
  // two-wicket end and pair-scoped credits, the Laws' structure ──
  ["superover", "packages/scoring/test/super-over.test.mjs"],
  // ── SCRBRD-130 R1 (db/73): rain — stops, resumptions, par, the words ──
  ["rain",     "packages/scoring/test/rain.test.mjs"],
  // ── end SCRBRD-130 R1 ──
  // ── SCRBRD-130 R3 (db/74): venue par — the floor pinned with SQL, par at a point ──
  ["venue",    "packages/scoring/test/venue.test.mjs"],
  // ── end SCRBRD-130 R3 ──
  // ── SCRBRD-130 R2 (db/75): the DLS Standard Edition calculator, on the
  // synthetic table only; the structural checks; the D5 grep ──
  ["dls",      "packages/scoring/test/dls.test.mjs"],
  // ── end SCRBRD-130 R2 ──
  // The Laws' 4th Edition from 1 October 2026, by the match date (SCRBRD-113):
  // every rule that differs, asked of a match on 30 September and 1 October.
  ["edition",  "packages/scoring/test/edition.test.mjs"],
  // Playing conditions per competition (SCRBRD-114, phase 1): the catalogue
  // pinned against db/99, the readers, the fold under a document, and no
  // document folding exactly as before.
  ["conditions", "packages/scoring/test/conditions.test.mjs"],
  // An innings from a paper scorebook (SCRBRD-120, phase 1): the card's
  // arithmetic over the PARITY list db/63 answers too, the fold of a summary
  // (nothing zero-filled, no ball invented), the seal, and the three Laws.
  ["summary", "packages/scoring/test/summary.test.mjs"],
  // The fixture planner's engine (SCRBRD-123): complete round robins and
  // seeded knockouts for 2–16, placement under the required rules, locks,
  // SA-day blackouts, determinism, and an independent check at the ceiling.
  ["planner", "packages/scoring/test/planner.test.mjs"],
  // A refusal's likely cause, in words beside REFUSAL_TEXT (SCRBRD-100): names
  // from the fold and never an id, no Law clause numbers.
  ["causes",   "packages/scoring/test/causes.test.mjs"],
  // What a person does about an event the server refused (SCRBRD-070).
  ["held",     "packages/sync/test/held.test.mjs"],
  // Undo and the outbox: withdraw what never left, void what may have (SCRBRD-074/075);
  // an outbox that opens before the token, the flush gate, the toss first, the clear (SCRBRD-078/075/079).
  ["outbox",   "packages/sync/test/sync-engine.test.mjs"],
  // A live pad attaching: never split, never merged, never taking another device's match (SCRBRD-078/075).
  ["attach",   "packages/sync/test/attach.test.mjs"],
  // Who bats first on a live fixture: the recorded toss, never a default (SCRBRD-067).
  ["toss",     "packages/scoring/test/toss.test.mjs"],
  ["phases",   "packages/scoring/test/phases.test.mjs"],
  // The commentary every viewer shares (SCRBRD-098): lines from the fold,
  // names only from the caller, a void has none, the same log the same words.
  ["commentary", "packages/scoring/test/commentary.test.mjs"],
  // Where the ball went, relative to the batter (SCRBRD-101): the sectors
  // named by the fielding families, and a stored seg read through the hand.
  ["placement", "packages/scoring/test/placement.test.mjs"],
  ["spatial",  "packages/scoring/test/spatial.test.mjs"],
  ["wheel",    "apps/web/test/wheel.test.mjs"],
  // The wagon-wheel analysis panel's counting rules (SCRBRD-102): sides,
  // areas, run chips and filters, over hand-built balls.
  ["wagon-analysis", "apps/web/test/wagon-analysis.test.mjs"],
  // The pad's Area step records a point, the same event as the Pro hub's for
  // the same tap (SCRBRD-101). Imports pad.jsx, so it needs the transform.
  ["pad-point", "apps/web/test/pad-point.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["roadmap",  "apps/web/test/roadmap.test.mjs"],
  // Pure derivations behind the Post-Match Report and Season Awards screens
  // (SCRBRD-082/084) — no DOM, no database, just the fold's own shapes.
  ["post-match-report", "apps/web/test/post-match-report.test.mjs"],
  // SCRBRD-114 phase 3a: the league table's words and choices (lib/standings.js).
  ["standings", "apps/web/test/standings.test.mjs"],
  // SCRBRD-114 phase 3b, the screens: the pad's Super over offer and the
  // engine's words for why not, the pair's two innings_starts, the board's
  // block, the eligibility words, the commentary's words.
  ["super-over-screens", "apps/web/test/super-over-screens.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["season-awards",     "apps/web/test/season-awards.test.mjs"],
  // A figure a scorebook did not record stays null on the career screens
  // (SCRBRD-120 D12): the adapter, the strike rate over recorded balls, "at least N".
  ["unrecorded-figures", "apps/web/test/unrecorded-figures.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The Match Centre's own derivations (redesign step 3c): sides named in
  // full and by code, the match line, the scorecard's parts, the break.
  ["match-centre",      "apps/web/test/match-centre.test.mjs"],
  // The public page (SCRBRD-083): the redacted log made foldable, no
  // pseudonym ever shown as a name.
  ["public-page",       "apps/web/test/public-page.test.mjs"],
  // The public page's live region: each new ball in plain words, only what is
  // new, nobody named (lib/announce.js).
  ["announce",          "apps/web/test/announce.test.mjs"],
  // "At this rate" on the first innings' board: plain arithmetic, left off
  // when it would say nothing (scorer/boardData.js atThisRate).
  ["at-this-rate",      "apps/web/test/at-this-rate.test.mjs"],
  // GA-I05: the worm, runs per over and the run rate, rendered from real
  // folds — the worm ends on the total, extras and penalty runs are in, a
  // finished chase has an end and no NaN (scorer/chartData.js).
  ["charts",            "apps/web/test/charts.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The ground display (SCRBRD-133 G1): the rotation with a hand-held clock —
  // the dwell, the skip, a wicket's interrupt resuming where it was, the holds
  // — and its panels over built logs (display/rotation.js, display/data.js).
  ["rotation",          "apps/web/test/rotation.test.mjs"],
  // Par and pressure (SCRBRD-133 G2): every row of §3.3 against hand figures —
  // the server's report (@scrbrd/scoring parReport()), the Board's words, the
  // rate track and the worm's par line — and no resource computed by a page.
  ["par",               "apps/web/test/par.test.mjs"],
  // The ground display's QR code (lib/qr.js) against an independent encoder.
  ["qr",                "apps/web/test/qr.test.mjs"],
  // Renders components, so it needs the .jsx transform hook.
  ["system",   "apps/web/test/system.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the scorer's review sheet, so it needs the same transform.
  ["review",   "apps/web/test/innings-review.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The pitch deck's live slides: the demonstration match is a real folded log,
  // the showcase reads nothing, every frame is inert and draws the app's own ids.
  ["deck-showcase", "apps/web/test/deck-showcase.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the pad's "can't score yet" panel from a folded innings, same transform.
  ["blocked",  "apps/web/test/scoring-blocked.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // What a live pad says about the server when it cannot send (SCRBRD-078), same transform.
  ["sync-banner", "apps/web/test/sync-banner.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Practice Match, phase 1: a pasted list read, the squad limits, the display
  // name, the cfg startMatch takes, a reload that loses nothing (score, wickets,
  // overs, batters, bowler, undo), no route to the sync path or to any normal
  // list, delete one and delete all, the weather record, the scorecard file.
  ["practice", "apps/web/test/practice.test.mjs"],
  // A panel that throws is a quiet card in its place, logs its name and the
  // message once, and resets on "Try again" (ui/ErrorBoundary.jsx); same transform.
  ["error-boundary", "apps/web/test/error-boundary.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the profile's dismissal-by-method card, same transform.
  ["dismissal-card", "apps/web/test/dismissal-breakdown.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the placement charts and the capture-profile picker (SCRBRD-039).
  ["capture-profile", "apps/web/test/capture-profile.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The pad's penalty runs: the match's fold, the Laws asked before an award
  // is offered, and the sheet as drawn (SCRBRD-094), same transform.
  ["penalty-sheet", "apps/web/test/penalty-sheet.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The pad's "Umpire suspended the bowler": the Laws asked before a reason or
  // a replacement is offered, why-not in words, the report (SCRBRD-094 item 2).
  ["suspension-sheet", "apps/web/test/suspension-sheet.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The pad's "Batter retired hurt": the event (not a wicket), the Laws asked
  // before a batter is offered, the fold after it and his return (SCRBRD-071).
  ["retire-sheet", "apps/web/test/retire-sheet.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["ways-out", "apps/web/test/ways-out.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Management's people list: every person with every role they hold, the
  // filters across all of them, nothing that writes signed out, the role
  // picker offering what GRANTABLE_ROLES gives the caller, refusals in words.
  ["people", "apps/web/test/people.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Settings → Import and the Staff screen: the screen's kinds held to the
  // server's IMPORTS, Import offered only after a clean Check of the same file,
  // the route's words, who is offered the tab, and who counts as staff.
  ["import-screen", "apps/web/test/import-screen.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Redesign step 4, phase A: the family and pupil apps' helpers — one child
  // per screen, a method and never a name, the tenant's words (G15) — and
  // the Match Centre's family mode (G13).
  ["family", "apps/web/test/family.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The coach's match-day cockpit and the intelligence feed (SCRBRD-136/137
  // phase A): the entry gate derived from roles.mjs and held to the design's
  // table, the status-tier-only health, the load word, the head count of
  // lifts (cockpit); each feed rule at its threshold and one short of it, its
  // gate, its words, and what a dismissal holds (signals).
  ["cockpit", "apps/web/test/cockpit.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["signals", "apps/web/test/signals.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The match-day queue, phase A0 (GA-I09–I11): the chooser that gives the
  // coach's card one card per admitted fixture, one assignment each, and the
  // per-fixture count: "N to resolve" and "Could not read X", a failed read
  // never the same as nothing.
  ["queue", "apps/web/test/queue.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The parent's action list, phase A0 (GA-I20): R1 an answer owed and R2
  // answer again, over a side's worth of rows narrowed to his own; the
  // fourteen-day fold; "N to do" and "Could not read X", a failed read never
  // the same as nothing; no reason, no note, no "done".
  ["todo", "apps/web/test/todo.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Pick the side (lib/pickSide.js): the draft and its numbers, the twelfth man,
  // the route's three pre-write checks in its own codes, the codes as sentences,
  // and which boy a trigger's message names.
  ["pick-side", "apps/web/test/pick-side.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The side the live scorer scores (scorer/side.js): the side the coach named
  // when there is one — withdrawn rows and the twelfth left out, in batting
  // order — else the team's roster exactly as before; the away end only where
  // its own sheet is readable; and the pad's line saying which.
  ["scorer-side", "apps/web/test/scorer-side.test.mjs"],
  // Signing in with Google and joining a school (SCRBRD-140 phase 1, the screens):
  // each answer of the exchange as one state, Google's config from the
  // environment only, the signed privacy paragraph word for word, a request
  // and never a role, a parent's child as free text that is never looked up
  // and never "found", the ways to sign in and the office's Claims list.
  ["signin-screens", "apps/web/test/signin.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Ending a role (SCRBRD-132 C1, db/77): EndRoleButton asks for the reason,
  // posts, shows refusals in the route's words; every code db/77 answers has them.
  ["end-role", "apps/web/test/end-role.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["decide-words", "apps/web/test/decide-words.test.mjs"],
  // GA-I21: one label for demo / practice / read only (no "official": a result
  // is read from the log, not stored), and the bowling-ceiling refusal in words.
  ["state-label", "apps/web/test/state-label.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The three solo-test screens, over routes that already existed: the office
  // verifying a parent's link and recording the family's agreement, booking a
  // vehicle and a trip, and signing out everywhere. Who is offered, what is
  // asked, the order of the sign-out, and a refusal in words for every code.
  ["guardian-link-screen", "apps/web/test/guardian-link.test.mjs"],
  ["transport-book", "apps/web/test/transport-book.test.mjs"],
  ["sign-out-everywhere", "apps/web/test/sign-out-everywhere.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The playing-conditions screen's words (SCRBRD-114): a figure and its unit,
  // its source, "N of M confirmed", a version's standing, a refusal in words.
  ["playing-conditions-screen", "apps/web/test/playing-conditions.test.mjs"],
  // The scorebook importer's screens (SCRBRD-120): who is offered the entry
  // point, a refusal in words, a blank that is null and never nought, the ticks
  // that follow a row, an opposition name that is a typed key and never a player.
  ["scorebook-screen", "apps/web/test/scorebook.test.mjs"],
  // The league wizard's and the fixture planner's words (SCRBRD-123/127): an
  // entrant's standing (the organiser cannot accept for a school), a checklist
  // row's kind, the rules she types, a plan by round and by day and as a
  // bracket, the locks a click makes, a publishing outcome, a refusal.
  ["league-screen", "apps/web/test/league.test.mjs"],
  // No Law clause number on any scorer screen: every words table, every
  // refusal helper over every code, and the sheets' literal text (SCRBRD-094).
  ["law-clauses", "apps/web/test/law-clauses.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The pad's premium feel (SCRBRD-100): every extra's two taps build the
  // event the pad always sent, byte for byte; the likely bowler and the next
  // batter first; undo in words; dot and 1 the biggest keys; the haptic tick.
  ["pad-feel", "apps/web/test/pad-feel.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the Board — always black, figures that flip (DESIGN_DIRECTION §1).
  ["board",    "apps/web/test/board.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // No emoji in the client outside a reasoned allow-list, every icon name
  // resolves, and the glyphs sit on Lucide's grid (DESIGN_DIRECTION §3.4).
  // The client's side of the weather hint (lib/weatherHint.js): null on any
  // failure, a mocked fetch.
  ["weather-hint", "apps/web/test/weather-hint.test.mjs"],
  // GA-I18: the weather observation keeps its time, a provider hint is a hint,
  // and a reading is never another ground's.
  ["weather-stamp", "apps/web/test/weather-stamp.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // GA-I06: the skills radar's scale is an argument, 20/20 reaches the outer
  // ring, and no target exists without a saved goal.
  ["radar", "apps/web/test/radar.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // GA-I08: one read-state contract: loading, empty, unassessed, forbidden,
  // disabled, failed, stale and partial each say something different, retry
  // re-runs the same read, and useSkills no longer throws its state away.
  ["readstate", "apps/web/test/readstate.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // GA-I13: the scorer's home — who lands on it (the scorer's bundle alone),
  // his fixtures appointed first, each one's state for this device, what this
  // device has to resume with its unsent events, and the lines before the toss.
  ["scorer-home", "apps/web/test/scorer-home.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // GA-I07: Squad and Analytics open on the person's own side, and a gate
  // answers from the roles held, as the menu does.
  ["team-context", "apps/web/test/team-context.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["icons",    "apps/web/test/icons.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The public home page's sections (SCRBRD-142 phase 1): signed out, the
  // strip and news hidden on a 404, the analytics toggle writes the pref and
  // starts nothing, the 12px and 44px floors, the copy.
  ["home-page", "apps/web/test/home-page.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // SCRBRD-142 phase 2's switch on Settings → School and the line under the
  // Publish switch (the words held to the design, the line's forms), and
  // Fields → Add ground (every refusal in words, the route's limits).
  ["listing-screens", "apps/web/test/listing-screens.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["client",   "apps/web/src/rbac/rbac.test.mjs"],
  ["handover", "services/api/handover/scoring-session.test.mjs"],
  ["rls",      "services/api/rls/rls.test.mjs"],
  ["auth",     "services/api/auth/auth.test.mjs"],
  // A keyed write is one transaction (GA-I01): the claim, the fingerprint,
  // the handler's calls as savepoints, the receipt before the one COMMIT.
  ["replay",   "services/api/write/replay.test.mjs"],
  // Sign-up with Google (SCRBRD-140): a Firebase ID token verified with no
  // firebase-admin, every refusal by name, keys fetched by an injected fetcher.
  ["firebase-verify", "services/api/auth/firebase-verify.test.mjs"],
  // The exchange's rate limits, sized for a school behind one address, and
  // the walk's signing key never the default.
  ["signin-api", "services/api/auth/signin-api.test.mjs"],
  // The pad's resume credential (SCRBRD-078): the device signs, the server
  // verifies, and a signed request reaches five routes and nothing else.
  ["pad-resume", "services/api/auth/pad-resume.test.mjs"],
  ["read",     "services/api/read/read.test.mjs"],
  // The signed-out read path (SCRBRD-083): the projection, the router, the shell.
  ["public-api", "services/api/public/public.test.mjs"],
  ["csv",      "services/api/io/csv.test.mjs"],
  // Notifications S0 (docs/design/NOTIFICATIONS.md D6, D12): the publish
  // route's lock, every push a pointer, an expired notice never sent.
  ["push-api", "services/api/notify/push-api.test.mjs"],
  // Notifications S1 (D1, D2, D5, D17, D18): the lists and the per-kind
  // contract agree with db/89's CHECKs and functions; opening a notice and
  // "Mark all read" write the reader's own receipt and nothing else; one
  // client store holds the list and the count every badge reads.
  ["notif-contract", "packages/policy/test/notifications.test.mjs"],
  ["receipts", "services/api/notify/receipts.test.mjs"],
  ["notif-store", "apps/web/test/notifications-store.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // The pilot load's checker (docs/pilot/PILOT_LOAD.md): duplicates, a bad
  // birthday, a side his birthday does not fit, a guardian with no email, an
  // email two people share; the templates clean; and it sends nothing.
  ["pilot-load-check", "tools/pilot-load-check.test.mjs"],
  // A scorebook page's photo (SCRBRD-120): JPEG or PNG only, its metadata
  // stripped without a decoder, and the private store's two backends.
  ["page-image", "services/api/io/page-image.test.mjs"],
  ["write",    "services/api/write/write.test.mjs"],
  // The planner's drafts through the fixture route's own validation (SCRBRD-123).
  ["planner-drafts", "services/api/write/planner-drafts.test.mjs"],
  ["migrate",  "tools/migrate.test.mjs"],
  // No file under tools/, services/ or packages/ hard-codes the database
  // address outside tools/db-url.mjs, which is what lets a worktree run
  // verification against its own database.
  ["db-url-guard", "tools/db-url-guard.test.mjs"],
  ["shipped",  "tools/shipped.test.mjs"],
  // The backup drill's tool (docs/pilot/BACKUP_RESTORE.md): which hosts are
  // this machine, the ledger and row-count comparisons, the roles a dump's
  // grants name, and a restore aimed anywhere else refused with exit 2.
  ["backup-verify", "tools/backup-verify.test.mjs"],
  ["schema-guard", "services/api/schema-guard.test.mjs"],
  ["imports",  "tools/check-imports.test.mjs"],
  ["guard",    "tools/hooks/guard.test.mjs"],
  // The typecheck strict list only grows, and names nothing that is not there.
  ["ts-scope", "tools/typecheck-scope.test.mjs"],
  // The browser walks' shards: every walk in exactly one, for n = 1 to 6, and
  // --shard 1/1 is the whole list as it was.
  ["smoke-shard", "tools/run-smoke-shard.test.mjs"],
  ["ai",       "services/api/ai/ai.test.mjs"],
  // The scorebook reader (SCRBRD-120 phase 4, D8): the request carries the
  // page photos and the hint and nothing else, asserted whole; an id in a
  // name cell is dropped; our boys matched on the server, after the model.
  ["scorebook-reader", "services/api/ai/scorebook-reader.test.mjs"],
  ["realtime", "services/api/realtime/realtime.test.mjs"],
  // Practice Match's weather hint (2026-10-02): Google's condition types by
  // the table, the units, the position rounded, the gate, the ten-minute
  // cache — over a stubbed fetch; nothing here calls Google.
  ["weather",  "services/api/weather/weather.test.mjs"],
];

let allPass = true;
const summary = [];
for (const [name, path, flags = []] of SUITES) {
  const r = spawnSync("node", [...flags, path], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : (r.status === 0 ? 0 : "?");
  const ok = r.status === 0 && failed === 0;
  if (!ok) allPass = false;
  summary.push({ name, passed, failed, ok });
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(10)} ${m ? m[0] : "(no summary — see below)"}`);
  if (!ok) console.log(out.split("\n").filter(l => l.includes("✗") || l.includes("Error")).slice(0, 8).join("\n"));
}

const total = summary.reduce((a, s) => a + (typeof s.passed === "number" ? s.passed : 0), 0);
console.log("\n" + "─".repeat(52));
console.log(`${allPass ? "ALL SUITES PASSED" : "SOME SUITES FAILED"} · ${total} assertions across ${SUITES.length} suites`);
process.exit(allPass ? 0 : 1);

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
 *   node tools/run-smoke-api.mjs --browser --shard 2/4
 *                                           the second of four fixed slices of
 *                                           the set (CI runs one job per slice)
 *   node tools/run-smoke-api.mjs --browser --shard 2/4 --list
 *                                           print that slice, run nothing: no
 *                                           database needed
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
  // Corrections everywhere (GA-I36 N1, N2): who may list a correction, and
  // an approval or a release reaching the public log on its next read.
  "corrections",
  // A retry writes once: the Idempotency-Key layer over every write route.
  "idempotency",
  // The managed-host reset drops only what db/ creates (GA-I02): somebody
  // else's table, view, function, enum and sequence survive it, in a
  // scratch database of the walk's own, and through the rebuild bundle too.
  "reset-objects",
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
  // The pilot's load (PILOT_LOAD.md gaps 3 and 4): parents in bulk, each row
  // enrol_person() under the office's own identity; and a ground made by
  // route rather than by SQL on the owner's key.
  "guardian-import",
  "grounds",
  // Ending a role (SCRBRD-132 C1, db/77): the other half of enrolling —
  // ended with a reason, holding nothing on the next request, on the record,
  // told without the reason; the guardian link's rules and nobody's last key.
  "end-role",
  // Disabling and enabling an account (account lifecycle slice 1, db/85 and
  // db/81, no migration): the `accounts` read with disabled ones on it and
  // its log; the coach's token dead on its next request and every role kept;
  // enabled, he signs in again; the principal and the DSO refused; nobody
  // acts on their own account.
  "accounts",
  // The audit log, read (SCRBRD-132 B2, db/79): under audit.read, one school
  // at a time, a child in initials, never a safeguarding row or a reason,
  // and every read of it on the record. (smoke-audit is access_log's own.)
  "audit-log",
  // Signing in with Google (SCRBRD-140 phase 1, db/81): the exchange and its
  // refusals, an account with no school reading nothing, a request granted
  // and seen on the next read, a claim the office confirms, the code path,
  // a second Google account, revocation, and the rate limits — against the
  // walk's own signing key, which a production server refuses to start with.
  "signup",
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
  // The API refuses to start as the owner, a superuser or a BYPASSRLS role,
  // starts as scrbrd_app, and /api/health names the commit it was built from
  // (gap analysis I14–I16, claims 12 and 14).
  "owner-refusal",
  "public",
  // A child's name on the public pages over HTTP (SCRBRD-083 C1–C5, PILOT_LOAD
  // gap 5): a guardian's consent for his own child and no other, the office's
  // "no" on the family's word, the never-public mark over a consent, names
  // off per age group — each on the public log's very next request.
  "public-name",
  // Parent lift clubs, phase 1 (SCRBRD-124, db/70): the school's two keys, a
  // driver's declaration, a round trip made as one act, consent per boy per
  // lift by version, the fixture moving under it, names and numbers through
  // the logged doors only, and a family's "no" never switched off.
  "lifts",
  // The match-day queue (GA-I09–I11 slice A1): the reads its rows are derived
  // from answer the director, the office, the principal, a coach of two sides,
  // and nobody who is not a reader; the lift exceptions are logged once for
  // each call the office makes.
  "queue",
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
const BROWSER_WALKS = ["browser-sync", "browser-read", "browser-deck", "browser-dossier", "browser-handover", "browser-handover-offline", "browser-innings-end", "browser-quarantine", "browser-drs", "browser-dismissals", "browser-discipline", "browser-support", "browser-seasons", "browser-rulebook", "browser-duties", "browser-fixture-create", "browser-held", "browser-toss", "browser-offline-undo", "browser-dayof",
  // SCRBRD-082 / SCRBRD-084: the Post-Match Report and the Season Awards tab.
  "browser-report", "browser-awards",
  // Redesign step 3c / SCRBRD-098: the Match Centre's six tabs, the
  // scorecard's layout and the shared commentary, on a real scored match.
  "browser-matchcentre",
  // GA-I36: a correction approved from the sheet reaches two watchers on their next poll.
  "browser-corrections",
  // SCRBRD-133 G1: the ground display, signed out, at 1920×1080, 1024×768
  // and 390×844 — names only under the rule (and a withdrawal reaching an
  // open display), no token, the 12px floor, the 404, the rotation's skip and
  // its resume after a wicket, the holds, the sleep, Daylight, nothing pressed.
  "browser-display",
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
  // db/87 (Law 22.9, 21.17): a run out off a no-ball and a stumping off a
  // wide through the pad; the board, the server's fold, match_live_score,
  // the scorecard, the career read and the public page say the same score.
  "browser-wicket-on-extra",
  // SCRBRD-078/075/079: a scorer's day with poor signal — the pad loads and
  // reloads with none, says "sign in to send", retries its claim, sends the
  // toss first, matches the server id for id, and clears its outbox at the end.
  "browser-offline-day",
  // SCRBRD-078 option B: a reloaded pad re-attaches with its resume
  // credential and sends by itself, nobody signed in; force-released, it
  // stops in words; signed in again, it goes on.
  "browser-pad-resume",
  // GA-I13: the scorer's home — appointed first, a fixture another device
  // holds, a match resumed after a reload with its unsent events counted,
  // the empty state, and a coach kept on the day sheet.
  "browser-scorer-home",
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
  // SCRBRD-083 C1–C5: the parent's switch on her child's file, the office's
  // never-public mark and its reason (never on her screen), the director of
  // sport's names off per age group — each held to the public log; 12px, 44px.
  "browser-public-name",
  // SCRBRD-142 phases 1–2 (db/82): the home page at /, signed out at phone
  // width — no app, no token, no robots meta, Log in to /app, no child's
  // name; the analytics switch starts nothing there; a listed fixture's card
  // with no ground, nofollow, landing on /live/:id.
  "browser-home",
  // SCRBRD-142 phase 2's switch and Fields → Add ground: the director of sport lists
  // the school and the public list carries (then drops) a published fixture, the
  // panel's line follows; a one-side publisher's switch is disabled with its
  // reason; the office adds a field and a pitch on it, a duplicate is refused in
  // words; a coach has neither; 12px and 44px at 390 wide in Daylight.
  "browser-listing",
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
  "browser-management",
  // Account lifecycle slice 1 (no migration): Disable account and Enable
  // account on Management → Users, offered only where db/81's rule allows —
  // the confirmation's words, the coach signed out and still listed as
  // "Disabled" with his roles, the filter, enabled and signed in again; a
  // role at another school refused in the server's words; 12px, 44px, 390,
  // reduced motion.
  "browser-accounts",
  // The coach's match-day cockpit and the intelligence feed (SCRBRD-136/137
  // phase A): the Coach tab, the Dashboard's match-day card and the feed's
  // drawer, by capability — the coach, the assistant coach, the team manager,
  // the physio and the director of sport each see the panels the policy grants
  // them, a scorer, a parent and a pupil see nothing; no injury nature and no
  // reason for an absence anywhere; every card's evidence equal to the reads;
  // Seen per person and per evidence; the live tab's cap sentences are the
  // pad's; 12px, 44px, both themes, reduced motion.
  "browser-cockpit",
  // Pick the side (Match Centre → Match Details, and the Coach tab's side
  // panel): a coach names an XI with a batting order and a twelfth and the Coach
  // tab shows it with no reload; a boy too old for the age group is refused in
  // the trigger's words beside him and the old side stands; duplicate numbers
  // are refused before anything is sent; a coach of another team and a parent
  // are offered nothing and a forced post is a 403; 12px, 44px, 390, Daylight.
  "browser-pick-side",
  // The live scorer scores the side the coach named: a fixture with a named
  // side opens the pad with exactly those eleven in that batting order and
  // says so; the twelfth and a withdrawn boy are not offered; a fixture with
  // none opens with the U14A roster as before and says that; the away side
  // batting first is typed, with the named eleven bowling.
  "browser-scorer-side",
  // Signing in with Google, from a browser (SCRBRD-140 phase 1, the screens):
  // the button and the signed privacy paragraph, the SDK fetched only when
  // pressed, a new account on the no-school screen, a parent's request as free
  // text with nothing looked up and nothing linked, the office's answer, Me's
  // ways to sign in (add, refuse, remove), and the office's Claims list; 12px
  // and 44px, both themes.
  "browser-signup",
  // Practice Match, phase 1: a scorer starts one from the start screen with
  // typed teams and pasted squads, scores an over, reloads mid-over and
  // resumes with undo intact, changes the weather at an over and ball; every
  // request the page made is held to the names typed (none carries one, and
  // no write reaches the API); the scorecard saved as a file; one deleted and
  // all deleted from the page's own confirmation, and nothing left in
  // IndexedDB or localStorage; 390 wide.
  "browser-practice",
  // Settings → Import and the Staff screen: the office has the tab and a coach
  // does not; the template downloads; a file with one bad line shows that line
  // in the route's words and keeps Import disabled; a clean file is checked,
  // imported and on Squad, and Import is offered only after a clean Check of
  // that same file; Staff is the school's role assignments, checked against
  // role_assignment; 12px, 44px, 390 wide.
  "browser-import",
  // The three screens the solo test could not reach (7 October 2026), each over
  // a route that already existed: the office verifying a parent's link and
  // recording the family's agreement (Squad → Edit Profile → Guardian links),
  // booking a vehicle and a trip (Logistics → transport), and Sign out
  // everywhere (Settings → Me). The rows each writes, the refusal and the
  // failure in words with the form kept, who is not offered it, 12px and 44px.
  "browser-solo",
  // GA-I09–I11 slice A1: the match-day queue on the "To resolve" screen —
  // the director's grouped counts with owner, clock and door, the office
  // list, the lifts on a tap, a coach of two sides, a failed read said as a
  // failed read, the Later fold, the empty and the clear screen; 12px, 44px.
  "browser-queue"];

// Walks that need no database, run by `pnpm smoke` instead. Named here only so
// the completeness check below knows they are accounted for.
const NO_DB = ["", "scorer", "persist", "a11y"];

// Run by hand and never here: it needs the 330 invented players, which are
// kept out of the repository, and the demo cast loaded on top of the seed
// (docs/pilot/SOLO_TEST.md). Named so the check below knows it is not lost.
const BY_HAND = ["demo-cast"];

const onDisk = readdirSync("tools")
  .filter((f) => /^smoke.*\.mjs$/.test(f))
  .map((f) => f.replace(/^smoke-?/, "").replace(/\.mjs$/, ""));
const known = new Set([...WALKS, ...BROWSER_WALKS, ...NO_DB, ...BY_HAND]);
const unlisted = onDisk.filter((n) => !known.has(n));
if (unlisted.length) {
  console.error(`\n✗ smoke walks exist that nothing runs: ${unlisted.map((n) => `smoke-${n}`).join(", ")}`);
  console.error("  Add them to WALKS in tools/run-smoke-api.mjs (BROWSER_WALKS if they drive a browser, NO_DB if they need no database).");
  process.exit(1);
}

// What a walk costs, in seconds on a CI runner. A shard's length is the sum
// of its walks, so the split has to know the heavy ones. These are measured,
// not guessed: the gaps between walks in CI run 37016856524 (2 Oct 2026,
// Browser walks, one job), rounded to 10 s. A walk added since then and not
// named here (browser-cockpit, browser-practice, ...) costs DEFAULT_COST, about
// the median. Re-measure from a CI log when the shards drift apart. A wrong
// weight costs balance, never coverage: every walk is in exactly one shard.
// Each shard also pays the rls-verify preamble (~250 s) and its own setup.
const DEFAULT_COST = 70;
const WEIGHTS = {
  "browser-read": 580,
  "browser-lifts": 200, "browser-scorebook": 170, "browser-league": 160,
  "browser-deck": 150, "browser-matchcentre": 150, "browser-pupil": 140,
  "browser-superover": 140, "browser-display": 120, "browser-retire": 110,
  "browser-held": 100, "browser-consent": 100, "browser-pad-laws": 100,
  "browser-penalty": 100, "browser-padfeel": 100, "browser-discipline": 100,
  "browser-cockpit": 100, "browser-management": 90, "browser-rain": 80,
  "browser-offline-day": 80, "browser-playing-conditions-screen": 70,
  "browser-public": 70, "browser-cleanup": 70, "browser-suspension": 70,
  "browser-laws4": 70, "browser-handover": 60, "browser-handover-offline": 70, "browser-support": 60,
  "browser-pad-resume": 60, "browser-dossier": 60, "browser-offline-undo": 50,
  "browser-wagonwheel": 50, "browser-results": 50, "browser-drs": 50,
  "browser-safeguarding": 50, "browser-playing-conditions": 50,
  "browser-innings-end": 40, "browser-toss": 40, "browser-dayof": 40,
  "browser-quarantine": 40, "browser-sync": 40, "browser-fixture-create": 30,
  "browser-awards": 30, "browser-dismissals": 30, "browser-duties": 30,
  "browser-rulebook": 30, "browser-seasons": 20, "browser-report": 20,
};
const weightOf = (w) => WEIGHTS[w] ?? DEFAULT_COST;
const staleWeights = Object.keys(WEIGHTS).filter((w) => !BROWSER_WALKS.includes(w));
if (staleWeights.length) {
  console.error(`\n✗ WEIGHTS names walks that are not in BROWSER_WALKS: ${staleWeights.join(", ")}`);
  process.exit(1);
}

// Shard i of n (1-based) of `walks`: heaviest first, each to the lightest shard
// so far, ties to the lowest shard number and to list order. Nothing random and
// nothing that depends on the machine, so every job computes the same split and
// every walk is in exactly one. A shard keeps the list's own order.
function shardOf(walks, i, n) {
  const load = new Array(n).fill(0);
  const owner = new Map();
  const heaviestFirst = walks.map((w, at) => ({ w, at }))
    .sort((a, b) => weightOf(b.w) - weightOf(a.w) || a.at - b.at);
  for (const { w } of heaviestFirst) {
    const k = load.indexOf(Math.min(...load));
    load[k] += weightOf(w);
    owner.set(w, k);
  }
  return walks.filter((w) => owner.get(w) === i - 1);
}

// `--browser` runs the browser set instead of the API set. Both are named
// walks on the same runner, so a browser walk still gets its own reset and
// still cannot go unlisted.
// A bare "--" arrives when a package manager forwards arguments (pnpm keeps
// the separator; npm eats it). It is noise from the caller, not a walk name.
let args = process.argv.slice(2).filter((a) => a !== "--");
const wantBrowser = args.includes("--browser");
const listOnly = args.includes("--list");
let shard = null;
{
  const at = args.findIndex((a) => a === "--shard" || a.startsWith("--shard="));
  if (at !== -1) {
    const spaced = args[at] === "--shard";
    const spec = spaced ? args[at + 1] : args[at].slice("--shard=".length);
    const m = /^(\d+)\/(\d+)$/.exec(spec ?? "");
    const [i, n] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
    if (!m || i < 1 || i > n) {
      console.error(`✗ --shard wants i/n with 1 <= i <= n, e.g. --shard 2/4 (got "${spec ?? ""}")`);
      process.exit(1);
    }
    shard = { i, n };
    args = args.filter((_, k) => k !== at && !(spaced && k === at + 1));
  }
}
const only = args.filter((a) => a !== "--browser" && a !== "--list");
const pool = wantBrowser ? BROWSER_WALKS : WALKS;
if (only.some((o) => !pool.includes(o))) {
  console.error(`✗ unknown walk: ${only.filter((o) => !pool.includes(o)).join(", ")}`);
  process.exit(1);
}
const slice = shard ? shardOf(pool, shard.i, shard.n) : pool;
const run = only.length ? slice.filter((w) => only.includes(w)) : slice;

// One walk per line on stdout, the slice's weight on stderr, nothing run.
if (listOnly) {
  for (const w of run) console.log(w);
  console.error(`${shard ? `shard ${shard.i}/${shard.n}: ` : ""}${run.length} walks, weight ${run.reduce((a, w) => a + weightOf(w), 0)}`);
  process.exit(0);
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

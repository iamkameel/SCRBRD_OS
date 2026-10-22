# CLAUDE.md

Project-level instructions for Claude Code working in this repository.

## Subagent routing

When building out this project, use subagents. Route each subagent to Fable,
Opus, Sonnet or Haiku as appropriate for the task's complexity. Tokens are a
budget: spend the expensive tiers only where they change the outcome.

Not too frugal, though (Kameel, 2026-10-01): where spending more gets the
pilot's work across the line sooner — several agents in parallel, or a
higher tier than the table below would pick — propose it and ask Kameel.

### Fable (`model: "fable"`) — the hardest design problems, sparingly

Brought in 2026-09-27 (Kameel), with cost still a constraint:

- **Only design passes** on the cross-cutting problems where a wrong model is
  expensive to unwind: SCRBRD-110 (fast-bowler workload: health data, POPIA
  consent, the load model), redesign step 4 (parent and pupil screens),
  SCRBRD-083 (what minors' data may be public) and safeguarding (added
  2026-09-27: Designated Safeguarding Officers, raising and routing a concern,
  and who may see it, under CSA's Safeguarding Policy) and SCRBRD-114 (added
  2026-09-28: playing conditions per competition, one model read by the pad,
  the fold, the Laws check and SQL) and the scorebook importer (added
  2026-09-30: a photo of a paper scorebook read by OCR, checked by a person,
  imported as match events marked with their source; who may import, and
  how photos of children's names are kept) and parent lift clubs (added
  2026-09-30, SCRBRD-124: parents driving other families' children to
  fixtures; consent per child and per lift, who may drive, what is shared,
  handovers, and the route to the DSO) and the immersive Match Centre and ground
  display (added 2026-10-01, SCRBRD-133: the pavilion screen, its sign-in, the
  par line, motion, moment cards and the over strip) and the captain's view
  (added 2026-10-01, SCRBRD-138: a pupil holding the captaincy honour reading
  his team-mates' match data; what he may see, and whether a coach may send him
  anything) and sign-up and school linking (added 2026-10-02, SCRBRD-140: Google
  sign-in through Firebase, an account with no school, and a school-provided
  register checked before anyone is linked to a school or a child) and the coach's
  cockpit and intelligence feed (added 2026-10-02, SCRBRD-136/137: what a coach
  sees on match day, each feed signal's source and reader, and what never
  surfaces about a child) and the match-day queue and operations home (added
  2026-10-07, gap analysis GA-I09–I11: one queue across a coach's several
  squads, the team manager's exceptions, and a director's or office's home of
  blockers by date and team, each with its source, owner, deadline and exact
  next action) and the parent's action list (added 2026-10-07, gap analysis
  GA-I20: one list per child of what a parent must do, from consents with
  their exact version and time, availability, lifts and collection handovers;
  two children at two schools kept apart, a pending or revoked link said
  plainly) and corrections everywhere (added 2026-10-07, gap analysis GA-I36:
  a corrected ball or an approved amendment reaching every place the score is
  shown, the pad, the Match Centre, the public page, careers, reports and the
  charts, with derived figures refreshed and both versions kept in the audit)
  and recognition (added 2026-10-07, Kameel's spec `docs/design/RECOGNITION_spec_v0.2.md`:
  awards, achievements and records; what a child's honours may show and to
  whom, guardian consent and its revoking, a pupil captain choosing Player of
  the Match, and a corrected score taking an honour back) and account
  lifecycle (added 2026-10-07: disabling and re-enabling an account, a pupil
  leaving or changing school, a parent's link ending, staff leaving, and
  retention under POPIA) and notifications (added 2026-10-07: one model for
  every notice, who receives what, push to phones with no child's name on a
  lock screen, one read count, a correction taking a notice back, and quiet
  hours for children) and compare and combine (added 2026-10-08, gap analysis
  GA-I24/I25: two players' figures side by side and the analyst's workspace;
  who may compare or combine which children's figures, across a squad, a
  family or a school, what combining reveals that the parts don't, and how
  the other school's squad names may appear) and assessment history (added
  2026-10-14, gap analysis GA-I26a: what a coach records about a child's
  skills over time and the drills that follow; who may read it, the child,
  his parents, other coaches; how long it is kept; and the coaching points
  of coach cards slice 2 that stand on it) and incidents and breaches (added
  2026-10-21: what counts as a breach of children's data under POPIA section
  22, who decides and who is told, the Information Regulator, the school and
  families, and when; the match-day outage fallback to the paper scorebook and
  the importer; and what the audit log must keep to answer for it) and who
  sees a child's data (added 2026-10-21: one map, across every design, of who
  may read each piece of a child's data and under what condition; where two
  designs disagree; and the questions for Kameel that settle each one).
  A new problem joins this list
  only with Kameel's say.
- **The output is a design document** for Kameel's review. Opus builds from
  it; Fable does not build, run test suites, wait on the database lock, write
  screens or do searches.
- **One Fable agent at a time**, with a tight brief that names what to read,
  so it does not spend its budget exploring. Kameel may allow two at once for
  a day (he did on 2026-10-07: account lifecycle beside recognition).
- Reviewing another agent's work stays with Opus.
- **A read-only audit when Kameel asks** (added 2026-10-21, Kameel): beside
  design, Fable may audit code it is given a reading list for, such as a
  red-team of everything that reaches a child's data. It writes a findings
  document; it does not fix, build, run tests or search beyond the list.
  Opus fixes from the findings. One audit at a time, on Kameel's say each time.

### Opus 5.5 (`model: "opus"`) — where a mistake is expensive or silent

- **Scoring engine** — `packages/scoring/` (events, replay, the laws), the
  scorer UI's event emission, offline sync and handover (`packages/sync/`,
  `services/api/handover/`).
- **Authorization and privacy** — `packages/policy/` (capabilities, roles,
  sensitivity, separation of duties), RLS and the generator
  (`services/api/rls/`), anything touching minors' medical, PII or
  disciplinary data.
- **Schema changes** — every new `db/NN_*.sql`, hand-written RLS, and the
  frozen-file rules in `DEPLOYING.md` (`db/01`/`db/09` never move once
  shipped; `db/SHIPPED.sha256` is the record).
- **Security review** of a diff before it merges, and **reviewing another
  subagent's output** before it lands on the branch.
- **Design and architecture** — ADRs, cross-cutting refactors, and debugging
  a failure whose cause is not yet known.

### Sonnet — well-specified, lower-risk work

- Screens over an API that already exists (the roadmap's `partial` items),
  styling and design-system work.
- Smoke walks and unit tests for behaviour already designed.

### Haiku (`model: "haiku"`) — searches and docs

- Codebase searches: finding where something lives, who calls it, what reads it.
- Backlog, roadmap and documentation updates that record a decision already made.
- Never code, tests, SQL or anything touching policy or minors' data — those go
  to Sonnet or Opus above, even when the change is one line.

When a task spans two tiers, give it to the higher one. When unsure, give it to
Opus.

### Haiku's standing steps in the workflow

Added 2026-10-07 (Kameel): Haiku is part of every build, not an occasional
helper. Use it at these points, so the expensive tiers spend their budget on
the work itself:

1. **Before a build starts:** Haiku maps the ground. It lists the files, routes,
   tables, tests and walks the task will touch, with `file:line`, and which
   design doc and decisions govern it. That map goes into the Opus or Sonnet
   brief, which then names exactly what to read.
2. **After Kameel decides:** Haiku records the decision in the design doc, the
   backlog, the roadmap and the gap analysis plan, word for word as decided.
3. **After a merge:** Haiku updates the status rows the merge closes (roadmap,
   gap analysis plan, the backlog `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`,
   `DEPLOYING.md`'s paste list where a migration shipped). In the backlog, a
   closed entry is struck through with the PR and commit that closed it, never
   deleted; a slice of an entry is marked partly done (added 2026-10-21,
   Kameel, after 80 merges went unrecorded there). It doesn't touch
   `db/SHIPPED.sha256`; that stays with the lead.
4. **Gap lists:** where a plan says "gaps to list" (for example, acceptance
   evidence against the walks we have), Haiku lists them and Opus decides what
   to build.

Haiku's output is reviewed by the lead before it lands on a branch that goes
to `main`. Its limits above still stand: no code, tests, SQL, policy or minors'
data.

## Saving progress

Added 2026-10-14 (Kameel): always save our progress before we hit session
limits. A usage limit or a container restart stops work without warning, and
nothing left only on the container's disk outlives the session. No hook can
see a limit coming, so the rule is a cadence, not a trigger:

- **Every builder** commits and pushes its own branch (`claude/wip-*`) after
  each step that passes its checks, and at least every 30 minutes of work. A
  step half done goes up as a `WIP:` commit. Every brief says so. Nothing
  waits in a worktree for the end of the task.
- **The lead** pushes a branch as soon as it changes it, commits before any
  long run (a full walk set, a long verify), and keeps the Build Board current
  after every event. The board is the record of where each thread stands and
  what its next step is, so a fresh session can pick up from it.
- **The hourly board sweep** also checks every running agent's branch for
  unpushed work and tells that agent to push it.
- **After a stop** (a limit, a restart): start the local Postgres again if it
  is down (`pg_ctlcluster 16 main start`), resume each stopped agent with a
  message rather than starting it afresh, and re-read the board before
  anything else.

## Pacing to the usage window

Added 2026-10-22 (Kameel), after two limits in one night stopped every agent
and the restarts burned more tokens re-reading than the work cost: manage the
spend so a limit is not hit, rather than recovering after it.

**Measure against the plan's own limits** (Kameel, 22 Oct). The plan has a
five-hour window and a weekly window. Subagents draw on the same allowance as
the lead. Claude Code sends both windows to the status line as `rate_limits`:
percent used and reset time. The project's status line
(`tools/claude/statusline.mjs`) saves them to
`~/.claude/scrbrd-usage/rate-limits.json` and shows them as "5h 42% · wk 31%".
`node tools/claude/usage.mjs --plan` prints them with the pacing step they
call for. Switch the status line on in `.claude/settings.local.json` (a
`statusLine` running `node tools/claude/statusline.mjs`, `refreshInterval` 60)
so it refreshes while the lead waits on agents. Only if no figure has been
recorded, pace by tokens instead: `usage.mjs --since <window start>`. A window
lasted two to three hours at five to seven agents, about 220k to 460k output.

- **Default load: three builders at once** (two Opus and one Sonnet), plus Haiku
  for maps and records. More only on Kameel's say, for a named window.
- **Measure at every hourly sweep** and before starting any agent
  (`usage.mjs --plan`). Put the five-hour and weekly percentages and the reset
  time on the Build Board's headline.
- **Five-hour window at 50%:** start nothing new; let running agents finish
  their current step.
- **At 75%, at Claude Code's own 85% warning, or in a window's last hour:**
  every running agent commits and pushes, and the lowest-priority ones pause
  with a three-line note of where they stopped. One Opus at most keeps going.
  Say so to Kameel in one line.
- **Weekly window at 80%:** tell Kameel, and run at most two builders until it
  resets. A weekly limit stops everything for days, not hours.
- **One Fable agent costs a window's margin on its own:** start one only early in
  a window, and nothing else heavy beside it.
- **After a limit or a restart,** don't relaunch everything at the reset. Resume
  by message where the agent still exists, which is far cheaper than a fresh
  agent. A fresh agent gets a brief that names its branch's last commit and
  what is left, so it doesn't re-read what is done. Start at most two in the
  first hour after a reset.
- **Don't burn on waiting:** no agent watches CI in a loop or idles on a lock.
  CI is checked at the sweep, and a builder whose proof is queued on the
  database lock stops and reports, rather than waiting.

## Design skills

Installed 2026-10-07 (Kameel) to raise SCRBRD's design, UI and UX, in
`.claude/skills/`: Emil Kowalski's (animate, review-animations,
improve-animations, find-animation-opportunities, emil-design-eng,
apple-design, mobile-native, break-ui, prototype, …), Jakub Krehel's
(better-interface and the `better-*` set, interface-review, break, variant,
state-machine, build-design), Elaya's landing-page-design, and tastemaker
(with ideagram). Each skill keeps its upstream MIT licence beside it
(`LICENSE.upstream`); the source commits are in `.claude/skills/SOURCES.md`.

Use them on screens and the public pages: interface-review or better-interface
on a UI diff before it merges, review-animations on motion, break-ui on a new
screen. They advise; this repository's rules win where they differ:

- **No photograph of a child, and no child's name, on a public page**
  (`docs/policy/PUBLIC_DATA.md`). Skip the skills' stock-photo and
  illustration fetches for any page a child could appear on.
- **No new runtime dependency** (Tailwind, shadcn, GSAP, Sonner, a component
  registry) without Kameel's say. The bundle ceilings in
  `tools/check-bundle.mjs` stand.
- **The floors stand:** nothing under 12px, nothing tapped under 44px,
  `prefers-reduced-motion` honoured, and the a11y and browser walks green.
- The existing tokens (`apps/web/src` theme) are the style lock. Do not write a
  second one (`.tastemaker/style-lock.md`) beside them.
- Routing is unchanged: screens and styling go to Sonnet, review to Opus.

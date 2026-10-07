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
  plainly). A new problem joins this list
  only with Kameel's say.
- **The output is a design document** for Kameel's review. Opus builds from
  it; Fable does not build, run test suites, wait on the database lock, write
  screens or do searches.
- **One Fable agent at a time**, with a tight brief that names what to read,
  so it does not spend its budget exploring.
- Reviewing another agent's work stays with Opus.

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

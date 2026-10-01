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
  handovers, and the route to the DSO). A new problem joins this list
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

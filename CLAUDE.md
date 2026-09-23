# CLAUDE.md

Project-level instructions for Claude Code working in this repository.

## Subagent routing

When building out this project, use subagents. Route each subagent to Opus or
Sonnet as appropriate for the task's complexity — never Fable, for any
subagent, under any circumstances.

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
- Backlog, roadmap and documentation updates; codebase searches.

When a task spans both, give it to Opus. When unsure, give it to Opus.

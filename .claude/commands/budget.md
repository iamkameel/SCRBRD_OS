---
description: Tokens by tier (Fable, Opus, Sonnet, Haiku), by day and by subagent task, from this project's transcripts
argument-hint: "[--days N] [--all-projects]"
allowed-tools: Bash(node tools/claude/usage.mjs:*)
---
!`node tools/claude/usage.mjs $ARGUMENTS`

Show the report above exactly as printed, in a code block. Then, in three
lines at most, say whether the split between the tiers fits CLAUDE.md's
routing (Fable for design passes only, Opus where a mistake is expensive,
Sonnet for screens, Haiku for maps and docs), and name the single biggest
task. Run nothing else.

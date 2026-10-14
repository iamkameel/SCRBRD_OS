#!/usr/bin/env node
/**
 * The usage report and the status line, against transcripts written here.
 *
 * The figures matter only if they are counted once and put in the right
 * tier and day, so each fixture line below is one of the ways a real
 * transcript can mislead: a reply split over several lines, a reply whose
 * final count was never written, a synthetic line, a line that does not
 * parse, a reply just after midnight in Johannesburg but before it in UTC.
 *
 * Falsified by making readMessages sum the repeated lines (the double count
 * goes red) and by dropping the estimate (the unfinished reply goes red).
 *
 *   node tools/claude/usage.test.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tierOf, projectSlug, dayOf, readMessages, listTranscripts, summarise, ledgerByDay, render, sumOf } from "./usage.mjs";
import { record, spentToday, line, contextPct } from "./statusline.mjs";

let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};
const group = (t) => console.log("\n" + t);

const root = mkdtempSync(join(tmpdir(), "scrbrd-usage-"));
const TZ = "Africa/Johannesburg";
const msg = (id, model, ts, usage, content = [], stop = null) => JSON.stringify({
  type: "assistant", timestamp: ts, uuid: `u-${id}-${Math.random()}`,
  message: { id, model, usage, content, stop_reason: stop },
});
const u = (input, cw, cr, out) => ({ input_tokens: input, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out });

try {
  group("Tiers and names");
  ok("claude-opus-5-5 is Opus", tierOf("claude-opus-5-5") === "Opus");
  ok("claude-fable-5-1 is Fable", tierOf("claude-fable-5-1") === "Fable");
  ok("an older Haiku is still Haiku", tierOf("claude-haiku-4-5-20251001") === "Haiku");
  ok("<synthetic> is no tier", tierOf("<synthetic>") === null);
  ok("an unknown model is Other", tierOf("some-model") === "Other");
  ok("the project folder name is Claude Code's", projectSlug("/home/user/SCRBRD_OS") === "-home-user-SCRBRD-OS");
  ok("22:30 UTC on the 13th is the 14th in Johannesburg", dayOf("2026-10-13T22:30:00Z", TZ) === "2026-10-14");

  const proj = join(root, "projects", "-p");
  const sub = join(proj, "s1", "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(proj, "s1.jsonl"), [
    // One reply over three lines, finished: counted once, final count kept.
    msg("m1", "claude-opus-5-5", "2026-10-14T08:00:00Z", u(2, 100, 1000, 5), [{ type: "thinking", thinking: "x".repeat(40) }]),
    msg("m1", "claude-opus-5-5", "2026-10-14T08:00:00Z", u(2, 100, 1000, 5), [{ type: "text", text: "hello" }]),
    msg("m1", "claude-opus-5-5", "2026-10-14T08:00:00Z", u(2, 100, 1000, 300), [{ type: "tool_use", input: { a: 1 } }], "tool_use"),
    // Unfinished: the transcript kept the opening 8; its 4000 characters say about 1000.
    msg("m2", "claude-opus-5-5", "2026-10-13T22:30:00Z", u(1, 0, 500, 8), [{ type: "tool_use", input: { content: "y".repeat(3988) } }]),
    msg("m3", "<synthetic>", "2026-10-14T09:00:00Z", u(0, 0, 0, 0)),
    "{ not json",
    JSON.stringify({ type: "user", message: { role: "user", content: "usage" } }),
  ].join("\n"));
  writeFileSync(join(sub, "agent-a1.jsonl"), [
    msg("h1", "claude-haiku-5-5", "2026-10-14T10:00:00Z", u(3, 50, 200, 40), [], "end_turn"),
  ].join("\n"));
  writeFileSync(join(sub, "agent-a1.meta.json"), JSON.stringify({ description: "Haiku: map the ground", agentType: "Explore" }));
  // An old reply outside the window.
  writeFileSync(join(proj, "s0.jsonl"), msg("o1", "claude-sonnet-5-5", "2026-09-01T10:00:00Z", u(1, 1, 1, 999), [], "end_turn"));

  group("Reading a transcript");
  const ms = readMessages(join(proj, "s1.jsonl"));
  const m1 = ms.find((m) => m.id === "m1"), m2 = ms.find((m) => m.id === "m2");
  ok("a reply over three lines is one record", ms.filter((m) => m.id === "m1").length === 1);
  ok("synthetic and broken lines are skipped", ms.length === 2, JSON.stringify(ms.map((m) => m.id)));
  ok("a finished reply keeps its final output count", m1?.output === 300 && m1?.estimated === false, JSON.stringify(m1));
  ok("its input and cache figures are not tripled", m1?.input === 2 && m1?.cacheWrite === 100 && m1?.cacheRead === 1000);
  ok("an unfinished reply's output is estimated from its length", m2?.output > 900 && m2?.output < 1100 && m2?.estimated === true, JSON.stringify(m2));

  group("Adding up");
  const ts = listTranscripts(proj);
  ok("the subagent is found with its description", ts.some((t) => t.agent?.description === "Haiku: map the ground"));
  const s = summarise(ts, { since: "2026-10-08", timeZone: TZ });
  ok("Opus has the two replies, Haiku one", s.byTier.Opus.messages === 2 && s.byTier.Haiku.messages === 1);
  ok("the September reply is outside the window", s.byTier.Sonnet.messages === 0);
  ok("both Opus replies fall on the 14th in Johannesburg", s.byDay["2026-10-14"]?.Opus.messages === 2 && !s.byDay["2026-10-13"]);
  ok("lead and subagent are kept apart", s.lead.messages === 2 && s.agents.messages === 1);
  ok("the task carries its tier and output", s.tasks[0]?.tier === "Haiku" && s.tasks[0]?.output === 40);
  ok("one estimate is counted", sumOf(Object.values(s.byTier)).estimated === 1);
  const text = render(s, { label: "p", since: "2026-10-08", timeZone: TZ, spend: null });
  ok("the report names the estimate", /Output for 1 of 3 replies is estimated/.test(text));
  ok("the report prints no price of its own", !/\$/.test(text));

  group("The ledger");
  const ledger = join(root, "ledger");
  const day1 = new Date("2026-10-13T10:00:00Z"), day2 = new Date("2026-10-14T10:00:00Z");
  const base = { session_id: "s/1..", model: { id: "claude-opus-5-5" }, workspace: { project_dir: "/home/user/SCRBRD_OS" } };
  record({ ...base, cost: { total_cost_usd: 2 } }, day1, ledger);
  record({ ...base, cost: { total_cost_usd: 5 } }, day2, ledger);
  record({ ...base, session_id: "s2", cost: { total_cost_usd: 1.5 } }, day2, ledger);
  const saved = JSON.parse(readFileSync(join(ledger, "s1.json"), "utf8"));
  ok("the session id is cleaned for a file name", saved.session === "s1");
  ok("the ledger holds figures and the project folder only", JSON.stringify(Object.keys(saved).sort()) === JSON.stringify(["byDay", "lastSeen", "model", "project", "session"]));
  ok("today is today's spend, not the session's whole cost", Math.abs(spentToday(day2, ledger) - 4.5) < 1e-9, String(spentToday(day2, ledger)));
  const by = ledgerByDay([saved], "-home-user-SCRBRD-OS");
  ok("the report's days split the same way", by["2026-10-13"] === 2 && by["2026-10-14"] === 3, JSON.stringify(by));
  ok("no cost, no record", record({ session_id: "x" }, day2, ledger) === null);

  group("The line");
  ok("a full input reads as one line", line({ model: { display_name: "Opus 5.5" }, cost: { total_cost_usd: 4.18, total_duration_ms: 3120000, total_lines_added: 120, total_lines_removed: 8 }, context_window: { used_percentage: 63.4 } }, { today: 11.92, branch: "b" })
    === "Opus 5.5 · $4.18 · today $11.92 · 52m · ctx 63% · +120 −8 · b");
  ok("an empty input still prints", line({}) === "Claude");
  ok("context from current_usage when there is no percentage", contextPct({ context_window_size: 200000, current_usage: { input_tokens: 1000, cache_read_input_tokens: 99000 } }) === 50);
  ok("over two hours reads as hours", /2h05/.test(line({ cost: { total_duration_ms: 125 * 60000 } })));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;

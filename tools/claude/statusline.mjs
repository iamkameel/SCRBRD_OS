#!/usr/bin/env node
/**
 * The Claude Code status line for SCRBRD: the session's model, its cost, what
 * today has cost so far, how full the context is, and the branch.
 *
 *   Opus 5.5 · $4.18 · today $11.92 · 52m · ctx 63% · +120 −8 · claude/scrbrd-os-03vb2m
 *
 * Claude Code runs this after each reply with the session as JSON on stdin
 * (model, cost.total_cost_usd, cost.total_duration_ms, the line counts, and on
 * newer versions context_window). Every field is optional here: a field the
 * running version does not send is left out of the line, never guessed.
 *
 * Each run also writes the session's running cost to a small ledger,
 * ~/.claude/scrbrd-usage/sessions/<session>.json, as last seen on each day.
 * That is where "today" and the cost column of tools/claude/usage.mjs come
 * from. The ledger holds figures only: no prompt, no file content, no path
 * beyond the project's folder name.
 *
 * It also keeps the plan's own usage limits, when Claude Code sends them
 * (rate_limits: the five-hour and weekly windows), in
 * ~/.claude/scrbrd-usage/rate-limits.json, and shows them as "5h 42% · wk 31%".
 * The lead paces by them (CLAUDE.md "Pacing to the usage window").
 *
 * It must never break the terminal: any error prints the shortest line it can.
 *
 * Switch it on in your own ~/.claude/settings.json (it is not set for you):
 *   "statusLine": { "type": "command", "command": "node tools/claude/statusline.mjs" }
 * Claude Code runs it from the session's directory, so the relative path works
 * when you start Claude Code in the repository root.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir, projectSlug, dayOf } from "./usage.mjs";

const TZ = process.env.TZ || "Africa/Johannesburg";
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const ledgerDir = () => join(configDir(), "scrbrd-usage", "sessions");
const safeId = (id) => String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);

/** Records the session's running cost as last seen today; returns the record. */
export function record(input, now = new Date(), dir = ledgerDir()) {
  const id = safeId(input.session_id);
  const cost = num(input.cost?.total_cost_usd);
  if (!id || cost == null) return null;
  const file = join(dir, `${id}.json`);
  let rec;
  try { rec = JSON.parse(readFileSync(file, "utf8")); } catch { rec = { session: id, byDay: {} }; }
  const day = dayOf(now.toISOString(), TZ);
  const project = projectSlug(input.workspace?.project_dir || input.cwd || "");
  if (rec.byDay?.[day] === cost && rec.project === project) return rec;
  rec = { ...rec, project, model: input.model?.id || rec.model || null, lastSeen: now.toISOString(), byDay: { ...rec.byDay, [day]: cost } };
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec));
  renameSync(tmp, file);
  return rec;
}

/** Today's spend across every session in the ledger. */
export function spentToday(now = new Date(), dir = ledgerDir()) {
  const day = dayOf(now.toISOString(), TZ);
  let total = 0;
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return 0; }
  for (const f of files) {
    try {
      const { byDay = {} } = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (byDay[day] == null) continue;
      const before = Math.max(0, ...Object.entries(byDay).filter(([d]) => d < day).map(([, v]) => v));
      total += Math.max(0, byDay[day] - before);
    } catch { /* skip a file being written */ }
  }
  return total;
}

// ── The plan's own limits (CLAUDE.md "Pacing to the usage window") ──
// Claude Code sends rate_limits to the status line on Pro and Max plans
// (2.1.80 and later): the five-hour and seven-day windows, each with
// used_percentage (0–100) and resets_at (Unix seconds). Either window may be
// missing. The latest seen is kept in one small file, so a lead session and
// tools/claude/usage.mjs --plan can pace by the plan's own figures.
export const limitsFile = () => join(configDir(), "scrbrd-usage", "rate-limits.json");
const window = (w) => {
  const used = num(w?.used_percentage), resets = num(w?.resets_at);
  return used == null ? null : { used_percentage: used, resets_at: resets };
};
/** Saves the plan's limits as last seen; returns what was written, or null. */
export function recordLimits(input, now = new Date(), file = limitsFile()) {
  const five = window(input?.rate_limits?.five_hour), week = window(input?.rate_limits?.seven_day);
  if (!five && !week) return null;
  const rec = { at: now.toISOString(), five_hour: five, seven_day: week };
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec));
  renameSync(tmp, file);
  return rec;
}

const usd = (v) => `$${v.toFixed(2)}`;
function elapsed(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** The context window's fill, from whichever shape this version sends. */
export function contextPct(cw) {
  if (!cw || typeof cw !== "object") return null;
  const used = num(cw.used_percentage);
  if (used != null) return Math.round(used);
  const size = num(cw.context_window_size);
  const cur = cw.current_usage;
  if (size && cur && typeof cur === "object") {
    const t = (num(cur.input_tokens) || 0) + (num(cur.cache_creation_input_tokens) || 0) + (num(cur.cache_read_input_tokens) || 0);
    return Math.round((100 * t) / size);
  }
  return null;
}

export function line(input, { today, branch } = {}) {
  const parts = [];
  parts.push(input.model?.display_name || input.model?.id || "Claude");
  const cost = num(input.cost?.total_cost_usd);
  if (cost != null) parts.push(usd(cost));
  if (today != null && today > 0) parts.push(`today ${usd(today)}`);
  const dur = num(input.cost?.total_duration_ms);
  if (dur != null) parts.push(elapsed(dur));
  const five = num(input.rate_limits?.five_hour?.used_percentage), week = num(input.rate_limits?.seven_day?.used_percentage);
  if (five != null) parts.push(`5h ${Math.round(five)}%`);
  if (week != null) parts.push(`wk ${Math.round(week)}%`);
  const ctx = contextPct(input.context_window);
  if (ctx != null) parts.push(`ctx ${ctx}%`);
  else if (input.exceeds_200k_tokens === true) parts.push("ctx >200k");
  const add = num(input.cost?.total_lines_added), del = num(input.cost?.total_lines_removed);
  if (add != null || del != null) parts.push(`+${add ?? 0} −${del ?? 0}`);
  if (branch) parts.push(branch);
  return parts.join(" · ");
}

function gitBranch(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 500, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch { return null; }
}

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* empty line below */ }
  let today = null;
  try { record(input); today = spentToday(); } catch { /* the line still prints */ }
  try { recordLimits(input); } catch { /* the line still prints */ }
  const branch = gitBranch(input.workspace?.current_dir || input.cwd || process.cwd());
  try { process.stdout.write(line(input, { today, branch })); } catch { process.stdout.write("Claude"); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

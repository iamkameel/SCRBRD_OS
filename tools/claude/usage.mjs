#!/usr/bin/env node
/**
 * What this project's Claude Code sessions spent, by tier, by day and by task.
 *
 * CLAUDE.md treats tokens as a budget and routes work to Fable, Opus, Sonnet
 * or Haiku by what a mistake would cost. This report is the receipt: it reads
 * the transcripts Claude Code already keeps (~/.claude/projects/<project>/,
 * subagents included) and adds up the usage each model reported, so the split
 * between the tiers can be checked against the routing table.
 *
 * Tokens only, from the transcripts. Rand and dollars come from Claude Code
 * itself: the status line (tools/claude/statusline.mjs) records each
 * session's own total_cost_usd, and this report adds those up where they
 * exist. It never prices tokens itself, because a price table here would go
 * stale without anyone noticing.
 *
 * It reads nothing but the transcripts and that ledger: no credentials, no
 * network. A transcript line that does not parse is skipped, not fatal.
 *
 *   node tools/claude/usage.mjs                 the last 7 days, this project
 *   node tools/claude/usage.mjs --days 1        today only
 *   node tools/claude/usage.mjs --since <ISO>   from a moment, e.g. the current usage
 *                                               window's start (CLAUDE.md "Pacing")
 *   node tools/claude/usage.mjs --all-projects  every project on this machine
 *   node tools/claude/usage.mjs --json          the same figures as JSON
 *   node tools/claude/usage.mjs --board         the Build Board's meta/usage document
 *
 * Days are counted in Africa/Johannesburg unless TZ or --tz says otherwise.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const TIERS = ["Fable", "Opus", "Sonnet", "Haiku", "Other"];

/** A model id as one of CLAUDE.md's tiers, or null for a non-model line. */
export function tierOf(model) {
  if (!model || model === "<synthetic>") return null;
  const m = String(model).toLowerCase();
  if (m.includes("fable")) return "Fable";
  if (m.includes("opus")) return "Opus";
  if (m.includes("sonnet")) return "Sonnet";
  if (m.includes("haiku")) return "Haiku";
  return "Other";
}

/** Claude Code's folder name for a project directory. */
export const projectSlug = (dir) => dir.replace(/[^A-Za-z0-9]/g, "-");

export const configDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

/** The calendar day of an ISO timestamp in a time zone, as YYYY-MM-DD. */
export function dayOf(ts, timeZone) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const n = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Every transcript under a project folder: the sessions, and each session's
 * subagents with the task description their .meta.json carries.
 */
export function listTranscripts(projectDir) {
  const out = [];
  if (!existsSync(projectDir)) return out;
  for (const name of readdirSync(projectDir)) {
    const p = join(projectDir, name);
    if (name.endsWith(".jsonl")) out.push({ path: p, session: name.slice(0, -6), agent: null });
    else if (statSync(p).isDirectory()) {
      const sub = join(p, "subagents");
      if (!existsSync(sub)) continue;
      for (const f of readdirSync(sub)) {
        if (!f.endsWith(".jsonl")) continue;
        const id = f.slice(0, -6);
        let meta = {};
        try { meta = JSON.parse(readFileSync(join(sub, `${id}.meta.json`), "utf8")); } catch { /* no meta */ }
        out.push({ path: join(sub, f), session: name, agent: { id, description: meta.description || id, type: meta.agentType || null } });
      }
    }
  }
  return out;
}

/** Characters of what a content block says: text, thinking, a tool call's input. */
export function blockChars(b) {
  if (!b || typeof b !== "object") return 0;
  if (b.type === "text") return String(b.text || "").length;
  if (b.type === "thinking") return String(b.thinking || "").length;
  if (b.type === "tool_use") return JSON.stringify(b.input ?? {}).length;
  return 0;
}

/** About four characters a token: close enough to rank the tiers, and labelled as an estimate. */
export const CHARS_PER_TOKEN = 4;

/**
 * One record per API message. Claude Code writes a line per content block,
 * each repeating the usage it had when the reply began. Only a line with a
 * stop_reason carries the final output count; a reply with no such line keeps
 * just its opening partial figure (a 38 KB design doc logged as 8 tokens). For
 * those, output is estimated from the length of what the blocks say, and the
 * record is marked so the report can say how many it estimated. Input and
 * cache figures are known when the reply begins, so they are always exact.
 */
export function readMessages(path) {
  const byId = new Map();
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return []; }
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d?.message;
    if (d?.type !== "assistant" || !m?.usage) continue;
    const tier = tierOf(m.model);
    if (!tier) continue;
    const u = m.usage;
    const id = m.id || d.uuid;
    const rec = byId.get(id) ?? {
      id, model: m.model, tier, ts: d.timestamp,
      input: n(u.input_tokens),
      cacheWrite: n(u.cache_creation_input_tokens),
      cacheRead: n(u.cache_read_input_tokens),
      recorded: 0, chars: 0, final: false,
    };
    rec.recorded = Math.max(rec.recorded, n(u.output_tokens));
    rec.chars += (Array.isArray(m.content) ? m.content : []).reduce((a, b) => a + blockChars(b), 0);
    if (m.stop_reason) rec.final = true;
    byId.set(id, rec);
  }
  return [...byId.values()].map(({ recorded, chars, final, ...r }) => {
    const guess = Math.ceil(chars / CHARS_PER_TOKEN);
    return final || guess <= recorded
      ? { ...r, output: recorded, estimated: false }
      : { ...r, output: guess, estimated: true };
  });
}

const blank = () => ({ messages: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, estimated: 0 });
const add = (into, r) => {
  into.messages += 1; into.input += r.input; into.cacheWrite += r.cacheWrite;
  into.cacheRead += r.cacheRead; into.output += r.output;
  into.estimated += r.estimated ? 1 : 0;
  return into;
};

/** The session ledger the status line keeps: one small file per session. */
export function readLedger(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), "utf8"))); } catch { /* skip */ }
  }
  return out;
}

/**
 * Spend per day from the ledger. Each session file holds its running
 * total_cost_usd as last seen on each day, so a day's spend is that day's
 * figure less the previous day's.
 */
export function ledgerByDay(sessions, project) {
  const days = {};
  for (const s of sessions) {
    if (project && s.project !== project) continue;
    const entries = Object.entries(s.byDay || {}).sort(([a], [b]) => a.localeCompare(b));
    let before = 0;
    for (const [day, total] of entries) {
      days[day] = (days[day] || 0) + Math.max(0, n(total) - before);
      before = Math.max(before, n(total));
    }
  }
  return days;
}

/** Adds up a set of transcripts over the days asked for. */
export function summarise(transcripts, { since, sinceTs, timeZone }) {
  const from = sinceTs ? Date.parse(sinceTs) : NaN;
  const byTier = Object.fromEntries(TIERS.map((t) => [t, blank()]));
  const byDay = {};
  const lead = blank(), agents = blank();
  const tasks = [];
  for (const t of transcripts) {
    const task = t.agent ? { ...t.agent, session: t.session, tier: null, ...blank() } : null;
    for (const r of readMessages(t.path)) {
      const day = dayOf(r.ts, timeZone);
      if (!day || (since && day < since)) continue;
      if (!Number.isNaN(from) && Date.parse(r.ts) < from) continue;
      add(byTier[r.tier], r);
      byDay[day] ??= Object.fromEntries(TIERS.map((x) => [x, blank()]));
      add(byDay[day][r.tier], r);
      add(t.agent ? agents : lead, r);
      if (task) { add(task, r); task.tier ??= r.tier; }
    }
    if (task && task.messages) tasks.push(task);
  }
  tasks.sort((a, b) => b.output - a.output);
  return { byTier, byDay, lead, agents, tasks };
}

// ── printing ──

export function fmt(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}
/** Field-by-field sum of several tallies. */
export const sumOf = (xs) => xs.reduce((a, x) => {
  for (const k of Object.keys(a)) a[k] += x[k];
  return a;
}, blank());

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
const usd = (v) => `$${v.toFixed(2)}`;

function table(rows, align) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r, ri) => {
    const line = r.map((c, i) => (align[i] === "r" ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join("  ");
    return ri === 0 ? `${line}\n${w.map((x) => "─".repeat(x)).join("  ")}` : line;
  }).join("\n");
}

export function render(s, { label, since, timeZone, spend }) {
  const out = [];
  const total = sumOf(TIERS.map((t) => s.byTier[t]));
  const totalOut = total.output;
  const totalIn = (x) => x.input + x.cacheWrite + x.cacheRead;
  out.push(`Claude Code usage · ${label} · from ${since} · days in ${timeZone}`);
  out.push("");
  out.push(table([
    ["Tier", "Replies", "Fresh in", "Cache write", "Cache read", "Output", "Share of output"],
    ...TIERS.filter((t) => s.byTier[t].messages).map((t) => {
      const x = s.byTier[t];
      return [t, x.messages, fmt(x.input), fmt(x.cacheWrite), fmt(x.cacheRead), fmt(x.output), pct(x.output, totalOut)];
    }),
    ["All", total.messages, fmt(total.input), fmt(total.cacheWrite), fmt(total.cacheRead), fmt(total.output), ""],
  ], "lrrrrrr"));
  out.push("");
  const days = Object.keys(s.byDay).sort().reverse();
  if (days.length) {
    out.push(table([
      ["Day", "Output", "Input (all)", "Output by tier", spend ? "Cost" : ""],
      ...days.map((d) => {
        const row = s.byDay[d];
        const o = TIERS.reduce((a, t) => a + row[t].output, 0);
        const i = TIERS.reduce((a, t) => a + totalIn(row[t]), 0);
        const split = TIERS.filter((t) => row[t].output).map((t) => `${t} ${pct(row[t].output, o)}`).join(" · ");
        return [d, fmt(o), fmt(i), split, spend ? (spend[d] != null ? usd(spend[d]) : "–") : ""];
      }),
    ], "lrrll"));
    out.push("");
  }
  out.push(`Lead sessions: ${fmt(s.lead.output)} output, ${fmt(totalIn(s.lead))} input · Subagents: ${fmt(s.agents.output)} output, ${fmt(totalIn(s.agents))} input (${s.tasks.length} tasks)`);
  if (s.tasks.length) {
    out.push("");
    out.push(table([
      ["Biggest subagent tasks", "Tier", "Output", "Input (all)"],
      ...s.tasks.slice(0, 10).map((t) => [t.description.slice(0, 60), t.tier, fmt(t.output), fmt(totalIn(t))]),
    ], "llrr"));
  }
  out.push("");
  if (total.estimated) out.push(`Output for ${total.estimated} of ${total.messages} replies is estimated at ${CHARS_PER_TOKEN} characters a token: their transcripts kept only the opening count. Input and cache figures are exact.`);
  out.push(spend
    ? "Cost is Claude Code's own total_cost_usd, recorded by the status line; days it was not running show –."
    : "No cost recorded yet: the status line (tools/claude/statusline.mjs) records it once it is switched on.");
  return out.join("\n");
}

/**
 * The Build Board's meta/usage document: totals per tier, a row per day, the
 * biggest tasks by their description. Figures and task titles only.
 */
export function boardDoc(s, { since, timeZone, spend, now = new Date() }) {
  const tot = (x) => ({ replies: x.messages, output: x.output, input: x.input + x.cacheWrite + x.cacheRead });
  const all = sumOf(TIERS.map((t) => s.byTier[t]));
  return {
    asOf: now.toISOString(), since, timeZone,
    replies: all.messages, estimated: all.estimated,
    tiers: Object.fromEntries(TIERS.filter((t) => s.byTier[t].messages).map((t) => [t, tot(s.byTier[t])])),
    days: Object.keys(s.byDay).sort().map((day) => ({
      day,
      ...Object.fromEntries(TIERS.filter((t) => s.byDay[day][t].messages).map((t) => [t, tot(s.byDay[day][t])])),
      ...(spend && spend[day] != null ? { cost: Math.round(spend[day] * 100) / 100 } : {}),
    })),
    lead: tot(s.lead), agents: tot(s.agents), taskCount: s.tasks.length,
    tasks: s.tasks.slice(0, 8).map((t) => ({ title: t.description.slice(0, 80), tier: t.tier, ...tot(t) })),
  };
}

// ── command line ──

function parseArgs(argv) {
  const a = { days: 7, json: false, all: false, tz: process.env.TZ || "Africa/Johannesburg", dir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--days") a.days = Math.max(1, parseInt(argv[++i], 10) || 7);
    else if (k === "--since") a.sinceTs = argv[++i];
    else if (k === "--json") a.json = true;
    else if (k === "--board") a.board = true;
    else if (k === "--all-projects") a.all = true;
    else if (k === "--tz") a.tz = argv[++i];
    else if (k === "--project-dir") a.dir = argv[++i];
    else if (k === "--help" || k === "-h") a.help = true;
  }
  return a;
}

export function main(argv = process.argv.slice(2), now = new Date()) {
  const a = parseArgs(argv);
  if (a.help) { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]); return 0; }
  const root = join(configDir(), "projects");
  const slug = projectSlug(a.dir);
  const folders = a.all ? (existsSync(root) ? readdirSync(root).map((f) => join(root, f)) : []) : [join(root, slug)];
  const transcripts = folders.flatMap(listTranscripts);
  const sinceDate = new Date(now.getTime() - (a.days - 1) * 86400000);
  const since = a.sinceTs ? dayOf(new Date(a.sinceTs).toISOString(), a.tz) : dayOf(sinceDate.toISOString(), a.tz);
  const s = summarise(transcripts, { since, sinceTs: a.sinceTs, timeZone: a.tz });
  const ledger = readLedger(join(configDir(), "scrbrd-usage", "sessions"));
  const spendAll = ledgerByDay(ledger, a.all ? null : slug);
  const spend = Object.keys(spendAll).length
    ? Object.fromEntries(Object.entries(spendAll).filter(([d]) => d >= since)) : null;
  const label = a.all ? "all projects" : basename(a.dir);
  if (a.board) console.log(JSON.stringify(boardDoc(s, { since, timeZone: a.tz, spend, now })));
  else if (a.json) console.log(JSON.stringify({ label, since, timeZone: a.tz, ...s, spend }, null, 2));
  else console.log(transcripts.length ? render(s, { label, since, timeZone: a.tz, spend }) : `No Claude Code transcripts found for ${label} under ${root}.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();

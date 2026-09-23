#!/usr/bin/env node
/**
 * The guard's own acceptance test: the calls it must stop, and — the half that
 * matters more — the everyday ones it must leave alone.
 *
 * A PreToolUse hook fails in two directions, and only one of them is loud. Too
 * narrow and it never fires: the ledger edit goes through and nobody learns
 * until a deploy. Too broad and it fires on `cat db/09_rls_policies.sql`,
 * which is not a safety feature, it is sand in the gears — and the way that
 * gets resolved is by deleting the hook. So every deny below is paired with
 * the nearest harmless command that shares its words.
 *
 * The test runs the script the way Claude Code does — as a subprocess with the
 * payload on stdin — because the envelope is part of the contract: a
 * hookEventName that is not exactly "PreToolUse" is ignored in silence, and a
 * guard whose refusals are ignored in silence is the first failure again.
 *
 * Falsified by raising FROZEN_THROUGH's effective floor (setting it to -1) and
 * confirming the ledger block below goes red rather than staying green off the
 * other assertions, and by replacing the decision with a constant "deny" and
 * confirming the "left alone" block goes red.
 *
 *   node tools/hooks/guard.test.mjs
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FROZEN_THROUGH } from "./guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, "guard.mjs");
const DB = join(HERE, "..", "..", "db");

let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};
const group = (t) => console.log("\n" + t);

/** Run the hook exactly as Claude Code runs it. */
const ask = (payload) => {
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify(payload), encoding: "utf8" });
  if (r.status !== 0) return { decision: "(crashed)", reason: r.stderr.split("\n")[0] };
  if (!r.stdout.trim()) return { decision: null, reason: "" };
  let j;
  try { j = JSON.parse(r.stdout); } catch { return { decision: "(unparseable)", reason: r.stdout.slice(0, 120) }; }
  const o = j.hookSpecificOutput ?? {};
  return { decision: o.permissionDecision, reason: o.permissionDecisionReason ?? "", event: o.hookEventName };
};
const bash = (command) => ask({ tool_name: "Bash", tool_input: { command } });
const edit = (file_path, tool = "Edit") => ask({ tool_name: tool, tool_input: { file_path } });

const denies = (label, got, mentions) =>
  ok(label, got.decision === "deny" && mentions.test(got.reason), `${got.decision} — ${got.reason}`);
const asks = (label, got) => ok(label, got.decision === "ask", `${got.decision} — ${got.reason}`);
const quiet = (label, got) => ok(label, got.decision === null, `answered ${got.decision}: ${got.reason}`);

// ── The envelope ─────────────────────────────────────────
group("The answer is shaped the way Claude Code reads it");
{
  const r = bash("rm -rf /");
  ok("a refusal names the event it is answering", r.event === "PreToolUse", r.event);
  ok("...and carries a reason a reader can act on", /root|home directory/.test(r.reason), r.reason);
  ok("the guard never answers \"allow\"", ["deny", "ask"].includes(r.decision), r.decision);
}
quiet("an empty payload is not grounds to block anything", ask({}));
{
  const r = spawnSync(process.execPath, [GUARD], { input: "not json at all", encoding: "utf8" });
  ok("neither is an unreadable one", r.status === 0 && !r.stdout.trim(), `${r.status} ${r.stdout}`);
}

// ── The ledger ───────────────────────────────────────────
group("The migration ledger is closed, by every route in");
const frozen = readdirSync(DB)
  .filter((f) => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f) && Number(f.slice(0, 2)) <= FROZEN_THROUGH)
  .sort();
// The constant is the whole rule, and a constant can rot: pointed past the
// last file it closes nothing, and the block below would still pass green on
// the files it does cover. So the top of the range has to be a real file.
// (The count is not asserted — the numbering has a gap at db/03, which was
// never written, so N-1 files reach db/N.)
ok(`db/${FROZEN_THROUGH} exists, so the frozen range ends on a real file`,
   frozen.some((f) => Number(f.slice(0, 2)) === FROZEN_THROUGH),
   `top of db/ is ${frozen.at(-1)}`);
{
  // `frozen` empty would make "all of them were refused" true and mean
  // nothing, which is how the -1 falsification above passed this line before
  // the floor was added.
  const through = frozen.map((f) => edit(`db/${f}`)).filter((r) => r.decision === "deny");
  ok(`every one of the ${frozen.length} is refused to Edit`,
     frozen.length > 10 && through.length === frozen.length,
     `${through.length} of ${frozen.length}`);
}
denies("Write is refused the same file", edit("db/09_rls_policies.sql", "Write"), /new db\/NN/);
denies("...and so is an absolute path to it", edit(join(DB, "09_rls_policies.sql")), /09_rls_policies/);
denies("a shell redirect into one is refused", bash("cat >> db/12_news.sql"), /new db\/NN/);
denies("so is sed -i", bash("sed -i 's/a/b/' db/07_shot_placement.sql"), /new db\/NN/);
denies("so is a copy landing on one", bash("cp /tmp/fixed.sql db/07_shot_placement.sql"), /new db\/NN/);
denies("so is deleting one", bash("rm db/11_player_date_of_birth.sql"), /already been applied/);
denies("...and hiding it mid-command does not help", bash("pnpm build && sed -i '1d' db/00_schema_core.sql"), /00_schema_core/);
denies("db/ itself cannot be deleted", bash("rm -rf db/"), /whole schema's history/);

group("...and everything that only reads it goes through untouched");
quiet("cat", bash("cat db/07_shot_placement.sql"));
quiet("grep", bash("grep -n 'CREATE POLICY' db/09_rls_policies.sql | head -20"));
quiet("sed -n, which prints rather than edits", bash("sed -n 1,40p db/23_authz_time_box.sql"));
quiet("a diff", bash("git diff db/09_rls_policies.sql"));
quiet("a copy taken *from* one", bash("cp db/07_shot_placement.sql /tmp/before.sql"));
quiet("the migrator, which applies them all", bash("node tools/migrate.mjs --reset --seed"));
quiet("a redirect that merely mentions db in its output path", bash("grep -c ';' db/09_rls_policies.sql > /tmp/n.txt"));

group("The next migration is not history yet");
quiet(`db/${FROZEN_THROUGH + 1} can be written`, edit(`db/${FROZEN_THROUGH + 1}_whatever.sql`, "Write"));
quiet("the seed is regenerated, not frozen", edit("db/98_seed_pilot.sql"));
quiet("and so is the RLS verifier", edit("db/99_rls_verify.sql"));

// ── The blast radius ─────────────────────────────────────
group("The deletes and pushes that cannot be undone");
denies("rm -rf at the machine's root", bash("rm -rf /"), /root or the home/);
denies("rm -rf at the home directory", bash("rm -rf ~/.claude/plugins"), /root or the home/);
denies("rm -rf $HOME", bash("rm -rf $HOME/work"), /root or the home/);
denies("a delete that names .git", bash("rm -rf .git"), /history/);
denies("a bare force-push", bash("git push -u origin claude/ui-refactor-ds2 --force"), /force-with-lease/);
denies("its short form", bash("git push -f origin claude/ui-refactor-ds2"), /force-with-lease/);
denies("a push straight at main", bash("git push -u origin main"), /pull request/);
denies("...including by refspec", bash("git push origin HEAD:main"), /pull request/);
asks("a leased force-push is asked about, not refused", bash("git push --force-with-lease -u origin claude/ui-refactor-ds2"));
asks("so is a hard reset", bash("git reset --hard origin/main"));
asks("so is git clean -f", bash("git clean -fd"));
asks("a write outside the working tree is asked about", edit("/root/.claude/settings.json", "Write"));

group("...and the day's actual work is never in the way");
quiet("the branch this session pushes to", bash("git push -u origin claude/ui-refactor-ds2"));
quiet("a branch whose name merely contains main", bash("git push -u origin claude/maintenance"));
quiet("fetching main", bash("git fetch origin main"));
quiet("restarting the branch from merged main", bash("git checkout -B claude/ui-refactor-ds2 origin/main"));
quiet("the full verification chain", bash("node tools/run-all-tests.mjs && node tools/check-imports.mjs && pnpm build && node tools/check-bundle.mjs"));
quiet("clearing a build directory", bash("rm -rf apps/web/dist"));
quiet("clearing node_modules", bash("rm -rf node_modules"));
quiet("a commit", bash("git commit -m 'the guard'"));
quiet("a status", bash("git status --short"));
quiet("writing a view", edit("apps/web/src/views/AnalyticsView.jsx"));
quiet("writing into the session scratchpad", edit("/tmp/claude-0/x/notes.md", "Write"));
quiet("a tool the guard has no opinion about", ask({ tool_name: "Read", tool_input: { file_path: "db/09_rls_policies.sql" } }));
quiet("...or a Grep over the frozen files", ask({ tool_name: "Grep", tool_input: { pattern: "POLICY", path: "db" } }));

console.log("\n" + "─".repeat(52));
console.log(`GUARD: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

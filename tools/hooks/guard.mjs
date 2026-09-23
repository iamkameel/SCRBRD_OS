#!/usr/bin/env node
/**
 * The PreToolUse guard: the two boundaries this repo cannot afford to cross
 * by accident.
 *
 * Claude Code runs this before every Bash, Edit and Write it is about to make,
 * handing it the call as JSON on stdin. The guard answers with a permission
 * decision, or with nothing at all — and nothing is the normal answer. It
 * never returns "allow": that would skip the permission prompt the user
 * already chose, and a guard whose job is to narrow what an agent may do has
 * no business widening it. Silence means "no opinion, carry on as configured".
 *
 * The two boundaries:
 *
 *   1. The migration ledger. db/00–23 have run against production, and
 *      tools/migrate.mjs refuses a file whose hash moved — so an edit to one
 *      of them is not a correction, it is a migration that can never be
 *      applied anywhere except a fresh database. The correction is a new
 *      db/NN. Editing the file in place looks like it worked right up until a
 *      deploy, which is the worst possible moment to find out, so this one is
 *      a hard deny on both routes in: the Edit/Write tools, and a shell
 *      redirect or sed -i.
 *
 *   2. The blast radius. A recursive delete aimed at the machine's root, the
 *      home directory or .git; a force-push with no lease; a push straight at
 *      main. None of those is recoverable from inside the session that did it.
 *
 * Everything else that merely *could* lose work — reset --hard, clean -f, a
 * leased force-push — is asked about rather than refused, because each has a
 * legitimate use here (restarting the working branch from merged main is one).
 *
 * The Bash rules read the command as text, split on the shell's own operators.
 * Real parsing is out of scope for a hook, so they are deliberately
 * conservative and will miss an evasion that was trying to evade: this is a
 * seatbelt, not a sandbox. Worth having anyway, because the accidents it
 * catches are the ones that actually happen — a path typed one directory too
 * high, a -f that was meant to be --force-with-lease, a sed -i on whichever
 * migration was nearest to hand.
 *
 * Proven by tools/hooks/guard.test.mjs, which pipes in both the calls that
 * must be stopped and the everyday ones that must not be.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The highest db/NN in db/SHIPPED.sha256 — the record of what production has
// applied. A hand-bumped constant sat at 23 while 24–28 shipped. At or below
// it a file is history; above it, it has not run yet and is still editable.
// db/98 and db/99 are the seed and the RLS verifier, which tools/migrate.mjs
// excludes from the ledger, so they are excluded here too.
export const FROZEN_THROUGH = Math.max(-1, ...readFileSync(resolve(ROOT, "db", "SHIPPED.sha256"), "utf8")
  .split("\n").map((l) => /\sdb\/(\d\d)_\S+\.sql\s*$/.exec(l)?.[1]).filter(Boolean).map(Number));

const isFrozen = (nn) => Number(nn) <= FROZEN_THROUGH && !/^9[89]$/.test(nn);

/** The frozen migration a file path names, repo-relative, or null. */
export function frozenPath(filePath) {
  const rel = relative(ROOT, resolve(ROOT, String(filePath ?? "")));
  const m = /^db\/(\d\d)_[^/]+\.sql$/.exec(rel);
  return m && isFrozen(m[1]) ? rel : null;
}

/** The frozen migration named anywhere in a shell fragment, or null. */
const frozenInText = (seg) => {
  for (const m of seg.matchAll(/(?:^|[\s"'=(])(?:\.\/)?(db\/(\d\d)_[^\s"';|&)]+\.sql)/g))
    if (isFrozen(m[2])) return m[1];
  return null;
};

const LEDGER = (f) =>
  `${f} has already been applied to production. The ledger is keyed on each ` +
  `file's hash, so changing or removing this one cannot alter a deployed ` +
  `database — it would only change what a fresh one gets, which is how the ` +
  `two drift apart. Ship the correction as a new db/NN instead (see ` +
  `DEPLOYING.md on the ledger).`;

// Each rule is a conjunction over one shell fragment: the command it is about,
// and the shape that makes it the thing being guarded against. First match
// answers.
const BASH = [
  { d: "deny", is: [/\brm\b/, /(?:^|\s)-\S*[rR]/, /\s(?:\/|\/\*|~\S*|\$HOME\S*)(?=\s|$)/],
    why: "a recursive delete aimed at the machine's root or the home directory. Name the directory you mean, inside the working tree." },
  { d: "deny", is: [/\brm\b/, /(?:^|[\s/"'])\.git(?:\/|\s|$|["'])/],
    why: "a delete that names .git — the repository's own history, including commits that have not been pushed anywhere." },
  { d: "deny", is: [/\brm\b/, /(?:^|\s)(?:\.\/)?db\/?(?=\s|$)/],
    why: "a delete that names db/ itself — every migration the ledger describes. A single new migration is a different matter; this is the whole schema's history." },
  { d: "deny", is: [/\bgit\s+push\b/, /(?:^|\s)(?:--force|-f)(?=\s|$)/],
    why: "a force-push with no lease: it overwrites whatever is on the remote, including anything that arrived since your last fetch. Use --force-with-lease." },
  { d: "ask",  is: [/\bgit\s+push\b/, /--force-with-lease/],
    why: "a leased force-push. Legitimate when the branch carries only already-merged history — worth confirming that it does." },
  { d: "deny", is: [/\bgit\s+push\b/, /(?:\s|:)(?:main|master)(?=\s|$)/],
    why: "a push straight at main. Changes reach main through a reviewed pull request, never directly." },
  { d: "ask",  is: [/\bgit\s+reset\b/, /(?:^|\s)--hard(?=\s|$)/],
    why: "a hard reset, which discards every uncommitted change in the working tree." },
  { d: "ask",  is: [/\bgit\s+clean\b/, /(?:^|\s)-\S*f/],
    why: "git clean -f, which deletes untracked files — including any new file not yet added." },
];

/** Is this fragment changing or removing `f`, rather than reading it? */
const writesTo = (seg, f) => {
  if (new RegExp(`>>?\\s*(?:\\./)?${f.replace(/\./g, "\\.")}`).test(seg)) return true;
  if (/\bsed\s+(?:-\S+\s+)*-\S*i/.test(seg)) return true;           // in place
  if (/\b(?:tee|install|truncate|patch|dd|rm|shred)\b/.test(seg)) return true;
  // cp and mv read their first argument and write their last.
  const w = seg.trim().split(/\s+/);
  return /^(?:cp|mv)$/.test(w[0]) && new RegExp(`(?:^|/)${f.replace(/\./g, "\\.")}$`).test(w.at(-1));
};

function decide(input) {
  const tool = input.tool_name;

  if (tool === "Bash") {
    for (const seg of String(input.tool_input?.command ?? "").split(/[;&|]+|\n/)) {
      const f = frozenInText(seg);
      if (f && writesTo(seg, f)) return ["deny", LEDGER(f)];
      for (const r of BASH)
        if (r.is.every((re) => re.test(seg)))
          return [r.d, r.d === "deny" ? `Refused: ${r.why}` : r.why];
    }
    return null;
  }

  if (tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
    const p = String(input.tool_input?.file_path ?? "");
    if (!p) return null;
    const f = frozenPath(p);
    if (f) return ["deny", LEDGER(f)];
    // Outside the working tree. /tmp holds the session scratchpad, so it is no
    // surprise; anywhere else is, and is asked about rather than refused — a
    // hook has no way to know the user did not mean it.
    const abs = resolve(ROOT, p);
    if (relative(ROOT, abs).startsWith("..") && !abs.startsWith("/tmp/"))
      return ["ask", `${abs} is outside the working tree (${ROOT}).`];
    return null;
  }

  return null;
}

// Importing this file (the test does) must not read stdin or exit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = {};
  // An unreadable payload is not grounds to block a call.
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
  const answer = decide(input);
  if (answer) process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: answer[0],
      permissionDecisionReason: answer[1],
    },
  }));
}

export { decide };

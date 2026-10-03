#!/usr/bin/env node
/**
 * The pilot documents say only what the app says.
 *
 * docs/pilot/SCORER_HELP.md and docs/pilot/PILOT_DAY_RUNBOOK.md quote every
 * button, tab and sheet by writing it in **bold**. This checks each bold label
 * against apps/web/src: the label must appear there, word for word, as JSX
 * text, a string literal, a template literal or an aria-label. A label that was
 * renamed, or that never existed, fails the run.
 *
 * What it does not do: it cannot tell whether the control is where the
 * document says it is, or that the step order is right. The browser walks
 * (tools/smoke-browser-*.mjs) and a read of the component are for that.
 *
 *   node tools/check-pilot-docs.mjs
 *
 * Matching rules, kept deliberately plain:
 *  - Comments are ignored (block comments and whole-line // comments), so a
 *    label that survives only in a comment does not pass.
 *  - Runs of white space count as one space, so a label that JSX wraps over
 *    two lines still matches.
 *  - &apos; &amp; &nbsp; &rsquo; in JSX text are read as the characters they
 *    stand for.
 *  - Case counts: "Sign In" (the sign-in screen) is not "Sign in" (the pad's
 *    banner), and the docs use each where the app does.
 *  - A label built from a template, such as `Held ${n}`, is quoted by its
 *    fixed words only ("Held"), never with the number.
 *
 * Also checked: banned phrases that an earlier draft invented, and the
 * scorer's sheet staying under the A4 word budget.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "apps/web/src");
const DOCS = ["docs/pilot/SCORER_HELP.md", "docs/pilot/PILOT_DAY_RUNBOOK.md"];

/**
 * Bold that is not a label. Each entry is a word the docs bold for emphasis;
 * nothing else gets in without a line here saying why.
 */
const NOT_A_LABEL = new Map([
  // A warning that opens a sentence in the runbook ("Do not score balls on
  // the real fixture before the match."). It is an instruction, not a button.
  ["Do not", "emphasis on a warning"],
]);

/**
 * Labels pinned to the file they must be in (`in`, any one of the fragments),
 * and, for a label that is only the fixed words of a longer text, the pattern
 * of that text (`part`). One line each, with where it is on the screen.
 */
const PIN = new Map([
  // The pad (scorer/pad.jsx): the stepper, the keys and the strip.
  ["Shot", { in: ["scorer/pad.jsx"] }],                       // stepper step 1
  ["Area", { in: ["scorer/pad.jsx"] }],                       // stepper step 2
  ["Outcome", { in: ["scorer/pad.jsx"] }],                    // stepper step 3
  ["Wicket", { in: ["scorer/pad.jsx"] }],                     // the red key on Outcome
  ["Dot", { in: ["scorer/pad.jsx"] }],                        // the strip's key
  ["Wide", { in: ["scorer/extras.js"] }],                     // the strip's extras
  ["No ball", { in: ["scorer/extras.js"] }],
  ["Bye", { in: ["scorer/extras.js"] }],
  ["Leg bye", { in: ["scorer/extras.js"] }],
  ["Undo", { in: ["scorer/pad.jsx"] }],                       // the strip's key, beside Dot
  // The pad's title bar and menu (scorer/engine.jsx, scorer/padMenu.jsx).
  ["Pad menu", { in: ["scorer/padMenu.jsx"] }],               // aria-label of the three-dots button
  ["Basic Scoring", { in: ["scorer/engine.jsx"] }],           // menu item
  ["Hand over", { in: ["scorer/engine.jsx"] }],               // title-bar button
  ["Take over", { in: ["scorer/engine.jsx"] }],               // title-bar button when a handover is pending
  // The sync pill (scorer/engine.jsx SyncPill). Held, Sending, Refused carry a count.
  ["Sent", { in: ["scorer/engine.jsx"] }],
  ["Sending", { in: ["scorer/engine.jsx"], part: "label: `Sending \\$\\{" }],
  ["Held", { in: ["scorer/engine.jsx"], part: "label: `Held \\$\\{" }],
  ["Refused", { in: ["scorer/engine.jsx"], part: "label: `Refused \\$\\{" }],
  ["For review", { in: ["scorer/engine.jsx"], part: "label: `For review \\$\\{" }],
  ["On device", { in: ["scorer/engine.jsx"] }],
  ["Handed over", { in: ["scorer/engine.jsx"] }],
  // The sync banner (scorer/syncBanner.jsx).
  ["Sign in", { in: ["scorer/syncBanner.jsx"] }],
  ["Try again", { in: ["scorer/syncBanner.jsx"] }],
  ["Score on this device", { in: ["scorer/syncBanner.jsx"] }],
  ["Someone else is scoring this match", { in: ["lib/handover.js"], part: "Someone else is scoring this match on another device" }],
  ["Another device has taken over scoring this match", { in: ["scorer/syncBanner.jsx"], part: "Another device has taken over scoring this match\\." }],
  // The handover sheet (scorer/sheets.jsx).
  ["Hand over scoring", { in: ["scorer/sheets.jsx"] }],
  ["Claim this match", { in: ["scorer/sheets.jsx"] }],
  ["Confirm and take over", { in: ["scorer/sheets.jsx"] }],
  // The toss and the sheets that follow (scorer/toss.jsx, sheets.jsx, setup.jsx).
  ["The toss", { in: ["scorer/toss.jsx"] }],
  ["Bat", { in: ["scorer/toss.jsx"] }],
  ["Bowl", { in: ["scorer/toss.jsx"] }],
  ["Opening Bowler", { in: ["scorer/sheets.jsx"] }],          // the new-over sheet's title at over 0
  ["Batting Order", { in: ["scorer/sheets.jsx"] }],
  ["Go", { in: ["scorer/sheets.jsx"] }],
  ["Confirm Out", { in: ["scorer/sheets.jsx"] }],
  ["Can't score yet", { in: ["scorer/scoring.jsx"] }],
  ["Match Complete", { in: ["scorer/engine.jsx"] }],
  // Rain (scorer/rainSheet.jsx).
  ["Rain", { in: ["scorer/rainSheet.jsx"] }],
  ["Bad light", { in: ["scorer/rainSheet.jsx"] }],
  ["Wet ground", { in: ["scorer/rainSheet.jsx"] }],
  ["Other", { in: ["scorer/rainSheet.jsx"] }],
  ["Stop play", { in: ["scorer/rainSheet.jsx"] }],
  ["Resume", { in: ["scorer/rainSheet.jsx"] }],               // the banner's button
  ["End innings (rain)", { in: ["scorer/rainSheet.jsx"] }],
  // Held balls (scorer/held.jsx).
  ["Refused by the server", { in: ["scorer/held.jsx"], part: "Refused by the server\\$\\{" }],
  ["Record again", { in: ["scorer/held.jsx"] }],
  ["Discard", { in: ["scorer/held.jsx"] }],
  // Sign-in and the Match Centre.
  ["Continue with Google", { in: ["auth/LoginPage.jsx"] }],
  ["Sign-in code", { in: ["auth/LoginPage.jsx"] }],
  ["Sign In", { in: ["auth/LoginPage.jsx"] }],
  ["Waiting for your school office", { in: ["auth/LoginPage.jsx"] }],
  ["Log in", { in: ["home/sections/Header.jsx"] }],
  ["Match Centre", { in: ["design/roles.js"] }],              // the nav label for "matches"
  ["More", { in: ["shell/MobileNav.jsx"] }],
  ["Open match", { in: ["views/MatchCentreView.jsx"] }],
  ["Scorecard", { in: ["views/matchcentre/MatchView.jsx"] }], // a tab of the fixture's own screen
  // The publication panel and the ground display.
  ["Publish", { in: ["views/publication.jsx"] }],
  ["Withdraw", { in: ["views/publication.jsx"] }],
  ["Floodlit", { in: ["views/publication.jsx"] }],
  ["Daylight", { in: ["views/publication.jsx"] }],
  ["Last updated", { in: ["display/DisplayView.jsx"], part: "Last updated \\{" }],
  // "Play stopped" is the pad's menu item, the sheet's title and the display's panel.
  ["Play stopped", { in: ["scorer/engine.jsx", "scorer/rainSheet.jsx", "display/panels.jsx"] }],
]);

/** Phrases an earlier draft invented or got wrong. They must not come back. */
const BANNED = [
  // The pilot school is Westville Boys' High School (Kameel, 3 October 2026);
  // the opponent is not known yet.
  ["Michaelhouse", "the opponent is not known: use [opponent]"],
  ["77777777-", "a seed match id is not the pilot's match"],
  ["your-api-url", "the address is scrbrd-os.web.app (firebase.json, DEPLOYING.md)"],
  ["Get Started", "the app opens on the sign-in screen"],
  ["Confirm Wicket", "the wicket sheet's button is Confirm Out"],
  ["Arm handover", "the handover button is Hand over scoring"],
  ["Amend", "the innings review has That is right and Take back the last ball"],
  ["Tap your name", "that exists only in the demo"],
];

/** The scorer's sheet must fit one A4 page. */
const SCORER_WORD_LIMIT = 450;

// ── The corpus: apps/web/src, comments removed ──

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if ([".jsx", ".js", ".mjs", ".tsx", ".ts"].includes(extname(p))) yield p;
  }
}

const decode = (s) => s
  .replace(/&apos;|&#39;|&rsquo;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;/g, " ");

/** Source with block comments and whole-line // comments removed. */
const withoutComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");

const squash = (s) => s.replace(/\s+/g, " ");

const corpus = [];
for (const file of walk(SRC)) {
  corpus.push({ file: relative(ROOT, file), text: squash(decode(withoutComments(readFileSync(file, "utf8")))) });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where, and as what, a label occurs, whole. A label counts when it is a
 * complete string literal ("Undo"), a complete template literal, a complete
 * aria-label, or a complete JSX text node (text next to a tag or an
 * expression). A fragment of a longer sentence does not count unless the label
 * is on the PART list, with the pattern of the text it is a fragment of.
 *
 * `where` pins a label to the files it must be in. The short words turn up all
 * over the app ("Sent", "Dot", "Bat"); without a pin a label would pass on a
 * match in an unrelated screen.
 */
function find(label, where = null, part = null) {
  const whole = new RegExp(`(["'\`])${escapeRe(label)}\\1|[>}]\\s*${escapeRe(label)}\\s*[<{]`);
  const aria = new RegExp(`aria-label=\\{?\\s*["'\`]${escapeRe(label)}["'\`]`);
  const fragment = part ? new RegExp(part) : null;
  for (const { file, text } of corpus) {
    if (where && !where.some((w) => file.includes(w))) continue;
    const m = whole.exec(text) ?? fragment?.exec(text) ?? null;
    if (!m) continue;
    const kind = aria.test(text) ? "aria-label" : whole.test(m[0]) ? (/^["'`]/.test(m[0]) ? "string" : "jsx text") : "part of a longer text";
    return { file, kind };
  }
  return null;
}

// ── The docs ──

let failures = 0;
const fail = (msg) => { failures++; console.log("  FAIL", msg); };
const used = new Set();

for (const doc of DOCS) {
  const text = readFileSync(join(ROOT, doc), "utf8");
  const words = text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  console.log(`\n${doc}  (${words} words, ${text.split(/\s+/).filter(Boolean).length} counting marks)`);

  const seen = new Set();
  let n = 0;
  for (const m of text.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
    const label = m[1].trim();
    if (seen.has(label)) continue;
    seen.add(label);
    if (NOT_A_LABEL.has(label)) { used.add(label); console.log(`  skip  ${label}  (${NOT_A_LABEL.get(label)})`); continue; }
    n++;
    const pin = PIN.get(label);
    const hit = find(label, pin?.in ?? null, pin?.part ?? null);
    if (hit) console.log(`  ok    ${label}  [${hit.kind}, ${hit.file}]`);
    else fail(`"${label}" is not in apps/web/src`);
  }
  if (n === 0) fail(`${doc} has no bold labels: nothing was checked`);

  for (const [phrase, why] of BANNED) {
    if (text.includes(phrase)) fail(`"${phrase}" is in ${doc}: ${why}`);
  }

  if (doc.endsWith("SCORER_HELP.md") && text.split(/\s+/).filter(Boolean).length >= SCORER_WORD_LIMIT) {
    fail(`${doc} is ${text.split(/\s+/).filter(Boolean).length} words; the A4 limit is under ${SCORER_WORD_LIMIT}`);
  }
}

for (const label of NOT_A_LABEL.keys()) {
  if (!used.has(label)) fail(`"${label}" is on the not-a-label list but no doc bolds it: remove it`);
}

console.log(`\n${"─".repeat(52)}\nPILOT DOCS: ${failures ? `${failures} failed` : "every bold label is in apps/web/src"}`);
process.exit(failures ? 1 : 0);

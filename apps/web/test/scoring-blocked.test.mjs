/**
 * SCRBRD-040. The pad says why it will not score.
 *
 * `scoringReadiness` (packages/scoring/test/readiness.test.mjs) decides; this
 * checks that what it decided reaches the screen as words — rendered from a
 * REAL folded innings, so the sentence under test is one a scorer can see —
 * and that the engine reads the same answer for its gate rather than keeping
 * a second copy of the rule.
 *
 * The engine group reads engine.jsx as text, which is weaker than driving it;
 * the browser walks (sync, innings-end, handover) drive the real pad through
 * the same gate on every run and would stall if it refused a ready innings.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/scoring-blocked.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  deriveInnings, inningsStart, batters, bowler, ball, BALL_TYPE,
  scoringReadiness, SCORING_BLOCK, SCORING_BLOCK_TEXT,
} from "@scrbrd/scoring";
import { ScoringBlocked } from "../src/scorer/scoring.jsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);
// Rendered markup escapes the apostrophe; the scorer reads the character.
const text = (el) => renderToStaticMarkup(el).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
const panel = (inn) => text(h(ScoringBlocked, { readiness: scoringReadiness(inn), onFix() {} }));

const SQ_A = [{ id: "p1", name: "Adams" }, { id: "p2", name: "Botha" }, { id: "p3", name: "Cele" }];
const SQ_B = [{ id: "w1", name: "Khumalo" }];
const OPEN = inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 1 });

// ── Blocked states say what is missing ───────────────────
group("A blocked pad says what is missing, and offers the fix");
{
  const out = panel(deriveInnings([OPEN]));
  ok("openers missing: 'Can't score yet: the opening batters have not been chosen'",
     out.includes("Can't score yet: the opening batters have not been chosen."), out);
  ok("...with the fix as a button", /<button[^>]*>Choose the opening batters<\/button>/.test(out), out);
  ok("...and what comes after it, so nothing surprises the scorer next",
     out.includes("Then: the opening bowler has not been chosen."), out);
  ok("...announced: role=status, polite", /role="status"/.test(out) && /aria-live="polite"/.test(out), out);
  ok("...and it names the reason for a walk to find", /data-block="openers"/.test(out), out);

  const noInnings = panel(null);
  ok("no innings at all is a sentence now, not a silent pad",
     noInnings.includes("Can't score yet: the batting side for this innings has not been set.")
     && noInnings.includes(">Open the innings<"), noInnings);

  const bowlerOnly = panel(deriveInnings([OPEN, batters({ striker: "p1", nonStriker: "p2" })]));
  ok("bowler missing: says so, with no 'Then'",
     bowlerOnly.includes("the opening bowler has not been chosen") && !bowlerOnly.includes("Then:"), bowlerOnly);

  // Laid out to wrap: a phone at 320px must not scroll sideways for a sentence.
  ok("the panel wraps at phone width rather than overflowing", /flex-wrap:wrap/.test(out), out);
}

group("An innings that is over says so, without 'yet'");
{
  const over = deriveInnings([OPEN, batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 6 }, () => ball({ type: BALL_TYPE.RUN, value: 1 }))]);
  const out = panel(over);
  ok("overs complete: 'Can't score: the innings is over'", out.includes("Can't score: the innings is over"), out);
  ok("...and the fix is the review", out.includes(">Review the innings<"), out);
}

group("A ready innings shows nothing");
{
  const ready = deriveInnings([OPEN, batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" })]);
  ok("ready: the panel renders nothing at all", panel(ready) === "");
}

group("Every reason renders its own words");
{
  for (const code of Object.values(SCORING_BLOCK)) {
    const r = { ready: false, blocked: [{ code, ...SCORING_BLOCK_TEXT[code] }] };
    const out = text(h(ScoringBlocked, { readiness: r, onFix() {} }));
    ok(`${code} is said`, out.includes(SCORING_BLOCK_TEXT[code].says), out);
  }
}

// ── One gate, read twice ─────────────────────────────────
group("The engine gates on the same answer the pad shows");
{
  const engine = readFileSync(join(ROOT, "apps/web/src/scorer/engine.jsx"), "utf8");
  ok("the engine derives readiness from the package", /const readiness=scoringReadiness\(inn\);/.test(engine));
  ok("...and the pad is handed that same value", /<ScoringBlocked readiness=\{readiness\}/.test(engine));
  // A pad waiting on a handover is locked first (SCRBRD-075, spec §4 step 2):
  // its fix is the code; after that, readiness decides as before.
  ok("guardReady decides on it", /const guardReady=\(\)=>\{\s*if\(padLock\)\{setModal\("handover"\);return false;\}\s*if\(readiness\.ready\)return true;/.test(engine));
  ok("commitBall refuses on it — the funnel every delivery goes through",
     /const commitBall=\([^)]*\)=>\{[\s\S]{0,300}?if\(!readiness\.ready\|\|padLock\)return;/.test(engine));
  ok("confirmWicket refuses on it", /const confirmWicket=\([^)]*\)=>\{\s*if\(!readiness\.ready\)/.test(engine));
  // The old inline rule is gone: a second copy of it is how the two disagree.
  ok("no inline striker/bowler check survives beside it",
     !/if\(!inn\.striker\|\|!inn\.nonStriker/.test(engine), engine.match(/if\(!inn\.striker[^\n]*/)?.[0]);
}

console.log("\n" + "─".repeat(52));
console.log(`SCORING BLOCKED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

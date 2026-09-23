/**
 * SCRBRD-038. The checkpoint between the last ball and a closed innings.
 *
 * Until now the ball that completed an innings also closed it: the engine read
 * `complete` off the projection and went straight to the innings break or the
 * result screen. The arithmetic was never in question — it is the same fold —
 * but the scorer never saw the total they were committing to, and an innings
 * sealed on a mis-tapped six is the most expensive thing in the app to unpick:
 * it needs the correction workflow, and that needs an approval from somebody
 * who is not the scorer.
 *
 * What is checked here:
 *
 *   - the sheet reads its figures back from a REAL derived innings, built by
 *     folding an event log, so a number it shows is a number the log implies
 *     rather than a prop somebody passed;
 *   - every reason the laws can produce has words to render, so a new one
 *     cannot appear on screen as an empty badge;
 *   - the absent cases say something rather than nothing — nobody not out is a
 *     sentence, and a bowler who never bowled is not a 0-0 line;
 *   - the gate is actually in the engine's path: no route from a delivery to a
 *     closed innings that skips it, and exactly one place that emits the
 *     innings_end event.
 *
 * The last group reads engine.jsx as text. That is weaker than driving it, and
 * it is worth being exact about how much weaker, because nothing else covers
 * this: no walk reaches an innings end today. smoke-browser-sync opens the real
 * scorer on a real match and taps four deliveries of a twenty-over innings, so
 * the gate below is never exercised end to end. Until a walk scores an innings
 * out (SCRBRD-052), these assertions are the only thing standing between a
 * refactor and a silently restored transition — which is a reason to keep them,
 * and not a reason to mistake them for the real thing.
 *
 * Falsified by restoring the old one-liner (the engine group goes red) and by
 * deleting a row from END_REASON_TEXT (the vocabulary group goes red).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/innings-review.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  deriveInnings, inningsStart, batters, bowler, ball, penalty, inningsEnd, sealInnings,
  BALL_TYPE, INNINGS_END_REASON,
} from "@scrbrd/scoring";
import { InningsReviewSheet } from "../src/scorer/sheets.jsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 160)}` : ""); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el);

const SQ_A = [{ id: "p1", name: "Adams" }, { id: "p2", name: "Botha" }, { id: "p3", name: "Cele" },
              { id: "p4", name: "Dube" }, { id: "p5", name: "Erasmus" }];
const SQ_B = [{ id: "w1", name: "Khumalo" }, { id: "w2", name: "Naidoo" }];

/** An innings folded from a log, the way the scorer's screen gets one. */
const fold = (evs, extra = {}) => deriveInnings([
  inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 1, ...extra }),
  batters({ striker: "p1", nonStriker: "p2" }),
  bowler({ bowler: "w1" }),
  ...evs,
]);
const runs = (n) => ball({ type: BALL_TYPE.RUN, value: n });
const sheet = (inn, no = 1) => html(h(InningsReviewSheet, {
  inn, inningsNo: no, onConfirm() {}, onFixLastBall() {}, onClose() {},
}));

// ── The figures come from the log ────────────────────────
group("The sheet reads the innings back, it does not restate a prop");
{
  // Six legal balls at one over: 1+4+0+6+2 off the bat, one wide, so the
  // innings closes on overs with 14 for 0 — none of which is typed in below.
  const inn = fold([runs(1), runs(4), runs(0), ball({ type: BALL_TYPE.WIDE, value: 0 }), runs(6), runs(2), runs(1)]);
  const out = sheet(inn);
  ok("the innings folded to a complete one", inn.complete === true, `${inn.runs}/${inn.wickets} ${inn.balls}b`);
  ok("the score on screen is the score in the log",
     out.includes(`${inn.runs}/${inn.wickets}`), `${inn.runs}/${inn.wickets}`);
  ok("...and the overs are the legal balls, in cricket's base",
     new RegExp(`>${Math.floor(inn.balls / 6)}\\.${inn.balls % 6} overs<`).test(out), out.match(/>[\d.]+ overs</)?.[0]);
  ok("the reason is named in words, not as a key",
     out.includes("Overs complete") && !out.includes("overs_complete"));
  ok("both batters at the crease are listed, with their scores",
     out.includes("Adams") && out.includes("Botha") && /\d+\* \(\d+\)/.test(out));
  ok("the extras line carries the wide", />1<[\s\S]{0,400}1w 0nb 0b 0lb/.test(out), out.match(/\dw \dnb \db \dlb/)?.[0]);
  ok("the bowler who bowled is shown with his figures",
     out.includes("Khumalo") && /0-\d+ \(1\.0\)/.test(out));
  ok("the bowler who never bowled is not shown a 0-0 line", !out.includes("Naidoo"));
  ok("the sheet is a named dialog", /role="dialog"/.test(out) && /aria-modal="true"/.test(out));
  ok("all three ways out are present and named",
     ["review-confirm", "review-fix"].every((t) => out.includes(`data-testid="${t}"`)) && /aria-label="Close"|Close/.test(out));
  ok("the consequence of confirming is stated on the sheet",
     /needs a correction the scorer cannot approve alone/.test(out));
}

// ── Every reason has words ───────────────────────────────
group("Every ending the laws can produce has words on screen");
{
  const reasons = Object.values(INNINGS_END_REASON);
  ok("there are five endings in the vocabulary", reasons.length === 5, reasons.join(" "));
  const wordsFor = (endReason) => {
    const out = sheet({ ...fold([runs(1)]), complete: true, endReason });
    return (out.match(/>([A-Z][a-z]+(?: [a-z]+)*)<\/span>/) ?? [])[1] ?? null;
  };
  // The fallback is what makes this subtle. Checking only that each reason
  // renders "some words" passes when a row is MISSING, because the fallback
  // sentence is words too — which is how the first version of this block went
  // green on a deleted row. So the test is: every known reason renders words
  // that are NOT the fallback, and no two of them render the same words.
  const FALLBACK = "Innings over";
  const rendered = reasons.map((r) => [r, wordsFor(r)]);
  for (const [r, w] of rendered)
    ok(`${r} renders its own words`,
       !!w && w !== r && !w.includes("_") && w !== FALLBACK, w);
  ok("...and no two endings read the same",
     new Set(rendered.map(([, w]) => w)).size === reasons.length,
     rendered.map(([r, w]) => `${r}=${w}`).join(" "));
  // A reason the vocabulary does not have must still render something, because
  // an old log or a second client can carry one.
  const odd = sheet({ ...fold([runs(1)]), complete: true, endReason: "sandstorm" });
  ok("an unknown reason falls back to a sentence rather than the raw key",
     odd.includes(FALLBACK) && !odd.includes("sandstorm"));
}

// ── The absent cases ─────────────────────────────────────
group("Nothing absent is rendered as a zero");
{
  // All out: nobody is left not out, which is a fact and not a blank.
  const allOut = fold(Array.from({ length: 4 }, () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })));
  const out = sheet(allOut);
  ok("all out derives as all out", allOut.endReason === INNINGS_END_REASON.ALL_OUT, allOut.endReason);
  ok("...and reads 'All out' on the sheet", out.includes("All out"));
  // A rendering assertion rather than a fold one: the log above leaves the
  // non-striker at the crease, because it records no new batter after each
  // wicket. What is being checked is the sheet's handling of an empty list,
  // so the list is made empty here rather than pretending a fold produces it.
  const noneIn = sheet({ ...allOut, batsmen: allOut.batsmen.map((b) => ({ ...b, status: "out" })) });
  ok("nobody not out is a sentence, not a blank", noneIn.includes("Nobody not out"));
  ok("...and it is the only thing in that section", !/\d+\* \(\d+\)/.test(noneIn));
  // Penalty runs only appear when there are some.
  const pen = fold([runs(1), penalty({ value: 5 }), runs(1), runs(1), runs(1), runs(1), runs(1)]);
  ok("a penalty is shown when there is one", sheet(pen).includes("5p"), sheet(pen).match(/\dw[^<]*/)?.[0]);
  ok("...and no penalty column appears when there is none", !sheet(allOut).includes("p<"));
}

// ── The gate is in the path ──────────────────────────────
group("A delivery cannot reach a closed innings without the review");
{
  const engine = readFileSync(join(ROOT, "apps/web/src/scorer/engine.jsx"), "utf8");
  const endedPaths = engine.match(/if\(endedInnings\)[^\n]*/g) ?? [];
  ok("both endings of an innings route through the review", endedPaths.length === 2, endedPaths.join(" | "));
  ok("...and neither of them transitions directly",
     endedPaths.every((l) => l.includes('setModal("inningsReview")')
                          && !l.includes("setScreen") && !l.includes('setModal("innings2")')),
     endedPaths.join(" | "));
  // The close is written to the log exactly once, from the confirmation.
  const emits = (engine.match(/emit\(sealInnings\(/g) ?? []).length;
  ok("the innings_end event is emitted from one place", emits === 1, `${emits} call sites`);
  ok("...and that place is the review's confirm handler",
     /const closeInnings=\(\)=>\{[\s\S]{0,400}?emit\(sealInnings\(inn\)\)/.test(engine));
  // sealInnings() is what puts the figures the sheet just showed onto the event,
  // and the reducer refuses a seal without them — so the reason and the evidence
  // both come off the innings rather than being assembled here. An engine that
  // hand-rolled an inningsEnd() would be writing a seal the model will not honour.
  ok("the seal is built from the innings, not assembled by hand",
     !/inningsEnd\(/.test(engine), "engine.jsx still constructs innings_end itself");
  ok("...and the confirm refuses to seal an innings that is not over",
     /const closeInnings=\(\)=>\{[\s\S]{0,300}?if\(!inn\?\.complete\)return;/.test(engine));

  // The sheet is dismissible, so something has to hold the way back — and it
  // has to be derived from state rather than raised by the transition, because
  // a penalty that completes a chase and a revision that cuts the overs below
  // the balls bowled both end an innings without a delivery and never reached
  // the transition at all.
  ok("a banner stands while the innings is over and not yet closed",
     /\{inn\?\.complete&&!inningsClosed&&!modal&&<InningsOverBanner/.test(engine));
  // "Closed" is the replay's answer, not a scan of the log for the event kind.
  // The two are not the same: a seal whose figures the log does not produce is
  // refused by the reducer, and a screen that counted the event would draw such
  // an innings as closed while the model called it open.
  ok("...and 'closed' is what the replay says, not that the event is present",
     /const inningsClosed=inn\?\.sealed===true/.test(engine));
  ok("...and it opens the same review", /onReview=\{\(\)=>setModal\("inningsReview"\)\}/.test(engine));
}

// ── The gate is in the model, not only in the path ───────
group("The reducer refuses a seal the review did not produce");
{
  // This is the half the group above cannot reach, and the reason it no longer
  // has to: engine.jsx is one producer of innings_end, and the guarantee has to
  // hold for every other — an offline queue replaying, a second device at a
  // handover, a delivery released from quarantine, the server folding the log.
  // Read as source text, the gate was a regex over one React file. Here it is a
  // property of the fold. The exhaustive version lives in group H of
  // packages/scoring/test/replay.test.mjs; these three are the sheet's own
  // contract with it.
  const played = [
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 1 }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 6 }, () => runs(1)),
  ];
  const inn = deriveInnings(played);
  ok("the innings is over and NOT closed before the confirm",
     inn.complete === true && inn.sealed === false);
  ok("...and an innings_end that carries no confirmed figures does not close it",
     deriveInnings([...played, inningsEnd({ reason: inn.endReason })]).sealed === false);
  // The figures on the seal are the figures this sheet renders, because both
  // come off the same derived innings — which is what makes the sheet the
  // evidence rather than the decoration.
  const seal = sealInnings(inn);
  const shown = sheet(inn);
  ok("the seal carries exactly the figures the sheet showed",
     shown.includes(`${seal.confirmed.runs}/${seal.confirmed.wickets}`)
     && new RegExp(`>${Math.floor(seal.confirmed.balls / 6)}\\.${seal.confirmed.balls % 6} overs<`).test(shown));
  ok("...and that seal closes the innings", deriveInnings([...played, seal]).sealed === true);
}

console.log("\n" + "─".repeat(52));
console.log(`INNINGS REVIEW: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

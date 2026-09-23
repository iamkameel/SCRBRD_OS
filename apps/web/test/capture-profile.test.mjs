/**
 * SCRBRD-039. What an innings declared it would capture, where the evidence
 * is shown.
 *
 * The fold and the labels are proven in packages/scoring (replay group I) and
 * against the database in tools/smoke-fold.mjs. This checks the two places a
 * person meets them:
 *
 *   - the charts that draw placement say "not captured, by design" for an
 *     innings that never asked for an exact point, and say exactly what they
 *     said before for one that declared nothing;
 *   - the scorer is asked, at innings setup, and the default declares what the
 *     pad already does rather than something new.
 *
 * Rendered with react-dom/server against innings built by folding a real
 * event log, so a label on screen is one the log implies.
 *
 * Falsified by making pointEvidence() in charts.jsx ignore the declaration
 * (the "by design" group goes red) and by defaulting SetupScreen to null (the
 * setup group goes red).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/capture-profile.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deriveInnings, inningsStart, batters, bowler, ball, noPlacement, placementFromTap,
  BALL_TYPE, CAPTURE_PROFILE, PLACEMENT_NULL,
} from "@scrbrd/scoring";
import { ShotHeatMap, ShotSpider } from "../src/scorer/charts.jsx";
import { Innings2Sheet } from "../src/scorer/sheets.jsx";
import { SetupScreen } from "../src/scorer/setup.jsx";
import { CaptureProfilePicker } from "../src/scorer/ui.jsx";

let pass = 0, fail = 0;
const ok = (n, c, why = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, why); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el);

const SQ = [{ id: "p1", name: "T Bekker" }, { id: "p2", name: "S Naidoo" }];
const innings = (captureProfile, deliveries) => deriveInnings([
  inningsStart({ battingTeam: "Hilton", bowlingTeam: "Maritzburg", squad: SQ, overs: 20, captureProfile }),
  batters({ striker: "p1", nonStriker: "p2" }),
  bowler({ bowler: "b1" }),
  ...deliveries,
]);
const sector = () => ball({ type: BALL_TYPE.RUN, value: 1, seg: 3, zone: "outer",
                            placementSource: "sector", captureProfile: CAPTURE_PROFILE.STANDARD });
const quick = () => ball({ type: BALL_TYPE.RUN, value: 2, ...noPlacement(PLACEMENT_NULL.NOT_REQUIRED, CAPTURE_PROFILE.QUICK) });
const point = () => ball({ type: BALL_TYPE.RUN, value: 4, ...placementFromTap({ angle: 300, radius: 0.9 }) });

group("An innings that never asked for a point says so, by design");
{
  const std = innings("standard", [sector(), quick(), sector()]);
  for (const [name, C] of [["heat map", ShotHeatMap], ["spider", ShotSpider]]) {
    const out = html(h(C, { inn: std }));
    ok(`${name}: a standard innings with no points is 'not captured', not empty`,
       out.includes('data-testid="placement-not-captured"'), out.slice(0, 200));
    ok(`${name}: ...and names the declaration`, out.includes("declared standard (sector only)"));
    ok(`${name}: ...and does not call it a missing record`, !out.includes("No exact placements on record"));
  }
  const qk = html(h(ShotHeatMap, { inn: innings("quick", [quick()]) }));
  ok("a quick innings says runs only", qk.includes("declared quick (runs only)"));
}

group("An innings that declared nothing reads exactly as before");
{
  const undeclared = innings(undefined, [sector(), quick()]);
  ok("the fold says undeclared", undeclared.declaredProfile === null);
  const out = html(h(ShotHeatMap, { inn: undeclared }));
  ok("no points, no declaration: the old sentence, and nothing excused",
     out.includes("No exact placements on record.") && !out.includes("placement-not-captured"));
  // The same innings declared full asked for a point on every ball; its gaps
  // are gaps, the same as undeclared.
  const full = html(h(ShotHeatMap, { inn: innings("full", [sector(), quick()]) }));
  ok("declared full reads its gaps as missing, like undeclared", full.includes("No exact placements on record."));
  // With points, the provenance line is the one it always was.
  const drawn = html(h(ShotHeatMap, { inn: innings(undefined, [point(), sector()]) }));
  ok("the drawn chart keeps its provenance line",
     drawn.includes("1 shot placed exactly.") && drawn.includes("1 ball carried no exact point and is not drawn.")
     && !drawn.includes("placement-not-captured-count"));
}

group("A career reads each ball against its own innings");
{
  // The shape asShotPoint() gives the profile page: rows from many innings,
  // each carrying its innings' declaration.
  const rows = [
    { ...point(), strikerId: "p1", declaredProfile: null },
    { ...sector(), strikerId: "p1", declaredProfile: "standard" },
    { ...sector(), strikerId: "p1", declaredProfile: "standard" },
    { ...sector(), strikerId: "p1", declaredProfile: null },
  ];
  const out = html(h(ShotHeatMap, { inn: { ballLog: rows, squad: [{ id: "p1", batHand: "R" }] }, playerId: "p1" }));
  ok("never-asked and missing are two sentences, with their own counts",
     out.includes("1 ball carried no exact point") && out.includes("2 came from an innings that never asked for an exact point."));
  const allStd = html(h(ShotHeatMap, { inn: { ballLog: rows.slice(1, 3), squad: [] }, playerId: "p1" }));
  ok("a career of only standard innings is 'not captured'", allStd.includes('data-testid="placement-not-captured"'));
}

group("The scorer declares it at innings setup");
{
  const setup = html(h(SetupScreen, { onStart: () => {} }));
  ok("the match step asks what will be captured", setup.includes('data-testid="capture-profile-picker"'));
  ok("...and defaults to full, which is what the pad already does",
     /data-testid="capture-profile-full"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="capture-profile-full"/.test(setup));
  const brk = html(h(Innings2Sheet, { target: 120, teamName: "Maritzburg", overs: 20, declared: "standard",
                                      onClose: () => {}, onStart: () => {} }));
  ok("the innings break carries the first innings' declaration forward",
     /aria-checked="true"[^>]*data-testid="capture-profile-standard"|data-testid="capture-profile-standard"[^>]*aria-checked="true"/.test(brk));
  const none = html(h(Innings2Sheet, { target: 120, teamName: "Maritzburg", overs: 20, declared: null,
                                       onClose: () => {}, onStart: () => {} }));
  ok("...and chooses nothing when nothing was declared", !none.includes('aria-checked="true"')
     && none.includes("Not declared"));
  ok("the picker offers exactly the three profiles the schema accepts",
     ["full", "standard", "quick"].every((p) => html(h(CaptureProfilePicker, { value: null, onChange: () => {} }))
       .includes(`data-testid="capture-profile-${p}"`)));
}

console.log(`\n${"─".repeat(52)}\nCAPTURE PROFILE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// The ground display's rotation and panels (SCRBRD-133 G1, §2.2–2.4, D9):
// apps/web/src/display/rotation.js with a hand-held clock, and
// apps/web/src/display/data.js over logs built with @scrbrd/scoring's own
// constructors. tools/smoke-browser-display.mjs walks the same rules on a
// real display at three sizes.
import { deriveMatch, inningsStart, batters, bowler, ball, penalty, playStopped, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";
import { CYCLE, DWELL_MS, FOW_MS, interruptRotation, nextAvailable, startRotation, stepRotation } from "../src/display/rotation.js";
import {
  availablePanels, displayState, partnershipPanel, overRows, bowlingPanel, fallOfWicket, breakPanel, resultPanel, stoppedPanel,
  pretossPanel, displaySettings, displayUrl, DAYLIGHT_DIM,
} from "../src/display/data.js";
import { T, contrast } from "../src/design/tokens.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

/** Step a rotation through `ticks` of `ms` each; the panels it showed, in order, without repeats. */
function run(state, { from, ms = 250, ticks, available, hold = null, dwellMs = DWELL_MS.normal, paused = false }) {
  let s = state, now = from;
  const seen = [];
  for (let i = 0; i < ticks; i++) {
    now += ms;
    const r = stepRotation(s, { now, available, hold, dwellMs, paused });
    s = r.state;
    if (seen[seen.length - 1] !== r.panel) seen.push(r.panel);
  }
  return { state: s, now, seen };
}
const ALL = new Set(CYCLE);

console.log("A. The cycle and its dwell");
ok("G1's cycle is the partnership, the over story and bowling, in §2.2's order", CYCLE.join() === "partnership,overs,bowling");
ok("Normal is 12 s a panel, Long 24 s", DWELL_MS.normal === 12_000 && DWELL_MS.long === 24_000);
{
  let s = startRotation(0);
  let r = stepRotation(s, { now: 0, available: ALL });
  ok("the first step shows the first panel", r.panel === "partnership");
  s = r.state;
  r = stepRotation(s, { now: 11_999, available: ALL });
  ok("...still at 11.999 s", r.panel === "partnership");
  r = stepRotation(r.state, { now: 12_000, available: ALL });
  ok("...and the over story at 12 s", r.panel === "overs");
  const long = run(startRotation(0), { from: 0, ms: 1000, ticks: 60, available: ALL, dwellMs: DWELL_MS.long });
  ok("Long: three panels in a minute, not five", long.seen.join() === "partnership,overs,bowling", long.seen.join());
  const normal = run(startRotation(0), { from: 0, ms: 1000, ticks: 60, available: ALL });
  ok("Normal: five turns in a minute, wrapping round", normal.seen.join() === "partnership,overs,bowling,partnership,overs", normal.seen.join());
}

console.log("\nB. A panel with nothing to show is skipped");
{
  const noPair = new Set(["overs", "bowling"]);
  const r = run(startRotation(0), { from: 0, ms: 1000, ticks: 72, available: noPair });
  ok("no pair in: the partnership never shows", !r.seen.includes("partnership") && r.seen.join() === "overs,bowling,overs,bowling,overs,bowling", r.seen.join());
  ok("nextAvailable wraps and skips", nextAvailable(2, noPair) === 1 && nextAvailable(0, new Set(["partnership"])) === 0 && nextAvailable(0, new Set()) === -1);
  // A panel that empties while it is up gives way at once.
  let s = stepRotation(startRotation(0), { now: 0, available: ALL }).state;
  const gone = stepRotation(s, { now: 3_000, available: noPair });
  ok("the partnership empties mid-turn (a wicket): the over story at once, not at 12 s", gone.panel === "overs" && gone.state.elapsed === 0);
  const none = stepRotation(startRotation(0), { now: 0, available: new Set() });
  ok("nothing to show: no panel, never an empty one", none.panel === null);
  s = none.state;
  const later = stepRotation(s, { now: 500, available: new Set(["bowling"]) });
  ok("...and the first panel that has something, as soon as it has", later.panel === "bowling");
}

console.log("\nC. A wicket interrupts, and the cycle resumes where it was");
{
  // Bowling is up, 5 s into its 12.
  let s = stepRotation(startRotation(0), { now: 0, available: ALL }).state;
  s = run(s, { from: 0, ms: 1000, ticks: 24, available: ALL }).state;     // partnership 0–12 s, overs 12–24 s → bowling at 24 s
  let r = stepRotation(s, { now: 29_000, available: ALL });
  ok("bowling is up, 5 s in", r.panel === "bowling" && r.state.elapsed === 5_000, JSON.stringify(r.state));
  s = interruptRotation(r.state, "fow", 29_000);
  r = stepRotation(s, { now: 29_250, available: new Set(["overs", "bowling"]) });
  ok("the wicket: the fall of the wicket at once", r.panel === "fow");
  const during = run(r.state, { from: 29_250, ms: 250, ticks: 30, available: new Set(["overs", "bowling"]) });
  ok(`...for ${FOW_MS / 1000} s, and nothing else under it`, during.seen.join() === "fow" && FOW_MS === 8_000, during.seen.join());
  r = stepRotation(during.state, { now: 37_000, available: new Set(["overs", "bowling"]) });
  ok("then BOWLING again — where it was, not the start of the cycle", r.panel === "bowling", r.panel);
  ok("...with the 7 s it had left (its clock stood still under the card)", r.state.elapsed === 5_000, String(r.state.elapsed));
  r = stepRotation(r.state, { now: 43_999, available: new Set(["overs", "bowling"]) });
  ok("...so it goes at 44 s, not 49 or 37", r.panel === "bowling");
  r = stepRotation(r.state, { now: 44_000, available: new Set(["overs", "bowling"]) });
  ok("...to the over story, skipping the partnership (no pair since the wicket)", r.panel === "overs");
}

console.log("\nD. The break, the result, a stop and the pre-toss facts hold");
{
  let s = stepRotation(startRotation(0), { now: 0, available: ALL }).state;
  s = stepRotation(s, { now: 6_000, available: ALL }).state;                // partnership, 6 s in
  const held = run(s, { from: 6_000, ms: 1000, ticks: 120, available: ALL, hold: "break" });
  ok("a hold shows itself for two minutes, through ten dwells", held.seen.join() === "break", held.seen.join());
  const after = stepRotation(held.state, { now: 126_250, available: ALL });
  ok("...and when it lifts the cycle goes on where it was: the partnership, 6 s in (and the quarter second since)",
     after.panel === "partnership" && after.state.elapsed === 6_250, JSON.stringify(after.state));
  for (const h of ["result", "stopped", "pretoss"]) {
    const x = run(s, { from: 6_000, ms: 1000, ticks: 60, available: ALL, hold: h });
    ok(`"${h}" holds`, x.seen.join() === h);
  }
  const both = stepRotation(interruptRotation(s, "fow", 6_000), { now: 6_100, available: ALL, hold: "result" });
  ok("a hold outranks an interrupt", both.panel === "result");
}

console.log("\nE. Paused (the signed-in big screen's Space)");
{
  let s = stepRotation(startRotation(0), { now: 0, available: ALL }).state;
  const p = run(s, { from: 0, ms: 1000, ticks: 60, available: ALL, paused: true });
  ok("paused: one panel for a minute", p.seen.join() === "partnership");
  const go = run(p.state, { from: 60_000, ms: 1000, ticks: 12, available: ALL });
  ok("...and its full dwell when it resumes", go.seen.join() === "partnership,overs", go.seen.join());
}

// ── The panels, over built logs ──

const HOME = { id: "m1", homeTeam: "1XI", homeLabel: "Hilton College 1XI", awayTeam: "Kearsney College 1XI", awayLabel: null,
  venue: "Gordon Sherwood Oval", startsAt: "2026-10-03T08:00:00Z", status: "live", overs: 5, format: "T5" };
const squad = (p, n = 11) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()} Player${i + 1}` }));
const H = squad("h"), K = squad("k");
let seq = 0;
const at = (inn) => (ev) => ({ ...ev, innings: inn, id: `ev${++seq}`, clientTs: Date.parse("2026-10-03T08:00:00Z") + seq * 30_000 });
const A = at(0), B = at(1);
const head0 = [A(inningsStart({ battingTeam: "1XI", bowlingTeam: "Kearsney College 1XI", teamKey: "1XI", bowlingTeamKey: "Kearsney College 1XI",
  squad: H, bowlingSquad: K, overs: 5 })), A(batters({ striker: "h1", nonStriker: "h2" })), A(bowler({ bowler: "k1" }))];
// Over 1: 1 4 · W(h1) — then h3 in — 2 wd — six balls with the wide: 1,4,0,W,2,wd,(6th legal) 1
const over1 = [A(ball({ value: 1 })), A(ball({ value: 4 })), A(ball({ value: 0 })), A(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }))];
const newBat = [A(batters({ striker: "h3" }))];
const over1b = [A(ball({ value: 2 })), A(ball({ type: BALL_TYPE.WIDE, value: 0 })), A(ball({ value: 1 }))];
const over2 = [A(bowler({ bowler: "k2" })), A(penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" })),
  ...Array.from({ length: 6 }, () => A(ball({ value: 0 })))];

console.log("\nF. What the display draws");
{
  const log = [...head0, ...over1];
  const m = deriveMatch(log, {});
  const st = displayState({ match: HOME, innings: m.innings });
  ok("before the next batter: no pair, so no partnership panel", !st.available.has("partnership") && st.available.has("bowling") && !st.available.has("overs"),
     [...st.available].join());
  const fow = fallOfWicket(st.inn);
  ok("the fall of the wicket: his label, his score, how, the score at the fall, the stand",
     fow.batter.name === "H Player2" && fow.batter.runs === 4 && fow.batter.balls === 3 && fow.batter.how === "b K Player1" && fow.score === "5/1"
       && fow.stand?.runs === 5 && fow.stand.names === "H Player1 and H Player2",
     JSON.stringify(fow));
  ok("...and no new batter named before he is in", fow.next === null);
  const in3 = deriveMatch([...log, ...newBat], {}).innings[0];
  ok("...then the new batter's label once he is", fallOfWicket(in3).next === "H Player3", JSON.stringify(fallOfWicket(in3)));

  const full = deriveMatch([...log, ...newBat, ...over1b, ...over2], {});
  const inn = full.innings[0];
  const st2 = displayState({ match: HOME, innings: full.innings });
  ok("two overs bowled, a pair in: every panel of the cycle has something", ["partnership", "overs", "bowling"].every((p) => st2.available.has(p)));
  const rows = overRows(inn, { events: [...log, ...newBat, ...over1b, ...over2], fold: {}, n: 0 });
  ok("the over story: newest first, two rows", rows.length === 2 && rows[0].over === 2 && rows[1].over === 1, JSON.stringify(rows));
  ok("over 1: its bowler, its chips as the Board draws them, 9 · 1W, and 9/1 after it",
     rows[1].bowler === "K Player1" && rows[1].chips.join(" ") === "1 4 · W 2 wd 1" && rows[1].figure === "9 · 1W" && rows[1].score === "9/1",
     JSON.stringify(rows[1]));
  ok("over 2: a maiden says M — and the score after it carries the five penalty runs the balls never did (14/1)",
     rows[0].figure === "M" && rows[0].score === "14/1" && inn.runs === 14, JSON.stringify(rows[0]));
  const p = partnershipPanel(inn);
  ok("the partnership: the pair by label, the stand's runs, each one's share off the bat",
     p.batters.map((b) => `${b.name} ${b.runs} (${b.balls})`).join() === "H Player1 0 (0),H Player3 3 (8)" && p.wicket === 2 && p.runs === 9,
     JSON.stringify(p));
  ok("...the stand's extras are the rest (the wide and the five penalty runs)", p.extras === 6, String(p.extras));
  ok("...and the first stand, ended at the first wicket", p.earlier.length === 1 && p.earlier[0].runs === 5 && p.earlier[0].wicket === 1);
  const b = bowlingPanel(inn);
  ok("bowling: the bowler on, his figures and economy, his over as chips; the other's figures",
     b.on.name === "K Player2" && b.on.runs === 0 && b.on.overs === "1.0" && b.his[0].chips.join("") === "······" && b.others[0].name === "K Player1",
     JSON.stringify(b));
}

console.log("\nG. What holds");
{
  const pre = displayState({ match: { ...HOME, status: "upcoming" }, innings: [] });
  ok("nothing played: the pre-toss facts hold", pre.hold === "pretoss" && pre.available.size === 0);
  const pt = pretossPanel({ ...HOME, status: "upcoming" });
  ok("...the sides, the ground, the start and the format", pt.sides === "Hilton College 1XI v Kearsney College 1XI"
     && pt.rows.map(([k]) => k).join() === "Ground,Start,Format" && /10:00/.test(pt.rows[1][1]), JSON.stringify(pt));

  const first = [...head0, ...Array.from({ length: 30 }, () => A(ball({ value: 1 })))];
  const sealed = deriveInnings(first);
  const brk = deriveMatch([...first, A(sealInnings(sealed, "overs"))], {});
  const sb = displayState({ match: HOME, innings: brk.innings });
  ok("the first innings over, the second not begun: the break holds", sb.hold === "break", sb.hold);
  const bp = breakPanel(HOME, sb.played);
  ok("...the chase's target in words, and the first innings' four facts",
     bp.words === "Kearsney College 1XI need 31 to win from 5 overs" && bp.facts.topScorers.length > 0, JSON.stringify(bp).slice(0, 300));

  const chase = [B(inningsStart({ battingTeam: "Kearsney College 1XI", bowlingTeam: "1XI", teamKey: "Kearsney College 1XI", bowlingTeamKey: "1XI",
    squad: K, bowlingSquad: H, overs: 5, target: 31 })), B(batters({ striker: "k1", nonStriker: "k2" })), B(bowler({ bowler: "h1" })),
  ...Array.from({ length: 6 }, () => B(ball({ value: 6 })))];
  const won = deriveMatch([...first, A(sealInnings(sealed, "overs")), ...chase], {});
  const sr = displayState({ match: HOME, innings: won.innings, settled: !!won.result });
  ok("the chase reaches 36: the result holds", !!won.result && sr.hold === "result");
  const rp = resultPanel(HOME, sr.played, "Kearsney College 1XI won by 10 wickets");
  ok("...its words and both innings' lines", rp.words === "Kearsney College 1XI won by 10 wickets"
     && rp.lines.join(" | ") === "Hilton College 1XI 30/0 (5) | Kearsney College 1XI 36/0 (1)", rp.lines.join(" | "));
  const live = displayState({ match: HOME, innings: deriveMatch([...first, A(sealInnings(sealed, "overs")), ...chase.slice(0, 5)], {}).innings });
  ok("the chase under way: no hold, the Board on the chase", live.hold === null && live.index === 1 && live.target === 31);

  const rain = deriveMatch([...head0, A(ball({ value: 1 })), A(ball({ value: 2 })), A(playStopped({ reason: "rain", at: Date.parse("2026-10-03T12:32:00Z") }))], {});
  const ss = displayState({ match: HOME, innings: rain.innings });
  ok("play stopped: the stop holds", ss.hold === "stopped");
  ok("...in words: \"Play stopped (rain) at 0.2 ov, 3/0, 14:32\" (Johannesburg)", stoppedPanel(ss.inn).words === "Play stopped (rain) at 0.2 ov, 3/0, 14:32",
     stoppedPanel(ss.inn).words);
  ok("a stop's words say rain or light and nothing about a boy", !/hurt|injur|ill/i.test(stoppedPanel(ss.inn).words));
}

console.log("\nH. The settings in the URL (D14)");
{
  ok("nothing asked: Floodlit, Normal, motion on", JSON.stringify(displaySettings("")) === JSON.stringify({ theme: "floodlit", dwell: "normal", reduceMotion: false }));
  ok("all three asked", JSON.stringify(displaySettings("?theme=daylight&dwell=long&motion=reduce")) === JSON.stringify({ theme: "daylight", dwell: "long", reduceMotion: true }));
  ok("anything else is the default", JSON.stringify(displaySettings("?theme=pink&dwell=5&motion=yes")) === JSON.stringify({ theme: "floodlit", dwell: "normal", reduceMotion: false }));
  ok("the link leaves the defaults out", displayUrl("https://x.example", "abc", {}) === "https://x.example/display/abc");
  ok("...and carries what was chosen", displayUrl("https://x.example", "abc", { theme: "daylight", dwell: "long", reduceMotion: true })
     === "https://x.example/display/abc?theme=daylight&dwell=long&motion=reduce");
  const dim = contrast(T.board.dim, T.board.face), day = contrast(DAYLIGHT_DIM, T.board.face);
  ok(`Daylight lifts board.dim one step: ${dim.toFixed(2)}:1 → ${day.toFixed(2)}:1, about 10:1 (§2.6)`, day > dim && day >= 9.5 && day < 12);
  ok("...still under the figures' white, so dim still reads as dim", day < contrast(T.board.figure, T.board.face));
}

console.log("\nI. Nothing here names a boy on its own");
{
  ok("availablePanels over nothing is empty", availablePanels(null).size === 0);
  ok("the partnership with no pair is nothing, not a placeholder", partnershipPanel({ striker: "a", nonStriker: null, curPartner: { runs: 0, balls: 0 } }) === null);
  ok("no wicket yet: no fall of wicket", fallOfWicket({ fow: [] }) === null);
}

console.log(`\nROTATION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

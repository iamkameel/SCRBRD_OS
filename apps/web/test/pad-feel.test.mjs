/**
 * The pad's premium-feel items (SCRBRD-100, "Left, on the pad").
 *
 *   1. EVERY EXTRA IS THE EVENT IT WAS. An extra is two taps now — its kind
 *      on the strip, then its runs. Each one is built both ways, byte for
 *      byte: the way the pad recorded it before (the old pad's call into the
 *      engine, through the engine's delivery code as it stood at 0f31ee0,
 *      copied below as LEGACY), and the way it records it now (extraCall()
 *      in extras.js, through delivery.js, which that code moved to). Every
 *      kind, every run the pad offers, a free hit and not, the pro hub's
 *      approach and shot left over, on Basic Scoring, the idle three-phase
 *      pad and the outcome phase. A wide with runs has no one-tap path
 *      before; its "before" is the engine's own onScore("Wd", n), the same
 *      commitBall. The engine's wiring from each call to its builder is read
 *      from engine.jsx and pad.jsx, so a test that passed with the wiring
 *      changed underneath it cannot happen.
 *   2. The new-over prompt lists the likely bowler first — the one who
 *      bowled the over before last, when the Laws let him — then the rest of
 *      the rotation as they first bowled, then those who have not; anyone
 *      the Laws refuse stays, unavailable, with the reason in words (and a
 *      refusal code this build has never seen is honoured, as the Laws
 *      batch's suspended bowler will be). The new-batter prompt lists the
 *      batting order's next name first.
 *   3. Undo says what it will take back, in words, with names from the
 *      fold and never an id.
 *   4. The pad as drawn: dot and 1 the biggest run keys, the extras on the
 *      strip, undo's label, the haptic tick off under reduced motion.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/pad-feel.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  deriveInnings, inningsStart, batters, bowler, ball, penalty, retire, lawsRefusal, lastUndoableIndex,
  ball as ballEvent, noPlacement, NO_CONTACT_SHOTS, PLACEMENT_NULL, PLACEMENT_SOURCE, CAPTURE_PROFILE,
  BALL_TYPE, REFUSAL_TEXT,
} from "@scrbrd/scoring";
import { shortRunEvents } from "../src/scorer/penalty.js";
import { deliveryEvents, noBallEvent } from "../src/scorer/delivery.js";
import { EXTRAS, extraCall, NB_TYPES, NB_FROM } from "../src/scorer/extras.js";
import { bowlerChoices, batterChoices, undoWords, unavailableWords, noClause } from "../src/scorer/prompts.js";
import { hapticTick, setHapticOn, HAPTIC_KEY } from "../src/scorer/haptic.js";
import { Pad } from "../src/scorer/pad.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const src = (f) => readFileSync(join(ROOT, f), "utf8");

// A fixed clock: an event's clientTs is Date.now() when it is built.
const realNow = Date.now;
Date.now = () => 1790000000000;

const UUID = "0b7c2d5e-1f3a-4b6c-9d8e-7f6a5b4c3d2e";
const SQ = [["a1", "R Pillay"], ["a2", "D Erasmus"], ["a3", "S Mokoena"], ["a4", "T Dlamini"], ["a5", "J Botha"], ["a6", "L Naidoo"], [UUID, UUID]]
  .map(([id, name]) => ({ id, name }));
const BW = [["b1", "K Naidoo"], ["b2", "M Botha"], ["b3", "P Ngcobo"], ["b4", "T van Rooyen"], ["b5", "L Govender"]].map(([id, name]) => ({ id, name }));
const open = () => [
  inningsStart({ battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: SQ, bowlingSquad: BW, overs: 20 }),
  batters({ striker: "a1", nonStriker: "a2" }),
  bowler({ bowler: "b1" }),
];
const run = (v) => ball({ type: BALL_TYPE.RUN, value: v });
const over = (by, balls = [0, 0, 0, 0, 0, 0]) => [bowler({ bowler: by }), ...balls.map(run)];

// ── LEGACY: the pad's delivery code at 0f31ee0, as it was ──────────────
// engine.jsx commitBall()'s event, and the no-ball sheet's confirm.
const legacyCrease = (i) => ({ striker: i?.striker ?? null, nonStriker: i?.nonStriker ?? null, bowler: i?.bowler ?? null });
function legacyCommitBall({ curIn, before, freeHit }, type, value, shot, seg, zone, approach, placement, { shortRun = false } = {}) {
  const place = placement ?? (seg != null
    ? { seg, zone, placementSource: PLACEMENT_SOURCE.SECTOR, captureProfile: CAPTURE_PROFILE.STANDARD }
    : noPlacement(
        NO_CONTACT_SHOTS.has(shot) ? PLACEMENT_NULL.NO_CONTACT : PLACEMENT_NULL.NOT_REQUIRED,
        CAPTURE_PROFILE.QUICK));
  const delivery = {
    type, value, shot, bowlerApproach: approach || null, freeHit,
    ...legacyCrease(before),
    ...place,
  };
  return shortRun ? shortRunEvents(curIn, delivery) : [ballEvent(delivery)];
}
function legacyNoBall({ inn, selShot, selSeg }, nbType, runs, nbRuns) {
  return [ballEvent({ type: "Nb", value: runs, shot: selShot,
    seg: selSeg?.seg ?? null, zone: selSeg?.zone ?? null, nbType, ...(nbRuns ? { nbRuns } : {}),
    ...legacyCrease(inn) })];
}
// The old pad's calls, as pad.jsx made them at 0f31ee0, into the engine as it
// was: Strip onWide → onWide() → commitBall("Wd",0,…,hubApproach); the engine's
// onScore("Wd",n) → commitBall("Wd",n,…,hubApproach); the no-ball sheet's
// onConfirm(type, runs, runs > 0 ? whose : null); Basic Scoring's byes
// (basicExtra → onCommitDetailed(t,n,null,null,null)) and the outcome phase's
// (commitExtra → onCommitDetailed(t,n,shot,seg,zone)) → commitBall(…,null).
const LEGACY = {
  wide: (st, n) => legacyCommitBall(st, "Wd", n, null, null, null, st.hubApproach),
  noBall: (st, type, n, from) => legacyNoBall(st, type, n, n > 0 ? from : null),
  basicBye: (st, t, n) => legacyCommitBall(st, t, n, null, null, null, null),
  outcomeBye: (st, t, n, shot, area) => legacyCommitBall(st, t, n, shot, area?.seg ?? null, area?.zone ?? null, null),
};

// ── NOW: the pad's second tap, through the engine's wiring, to delivery.js ──
const ENGINE = {
  wide: (st, runs) => deliveryEvents({ curIn: st.curIn, before: st.before, freeHit: st.freeHit, type: "Wd", value: runs,
    shot: null, seg: null, zone: null, approach: st.hubApproach }),
  noBall: (st, nbType, runs, nbRuns) => [noBallEvent({ inn: st.inn, nbType, runs, nbRuns, selShot: st.selShot, selSeg: st.selSeg })],
  commit: (st, type, value, shot, seg, zone) => deliveryEvents({ curIn: st.curIn, before: st.before, freeHit: st.freeHit, type, value,
    shot, seg, zone, approach: null }),
};
const now = (st, kind, n, pad) => {
  const call = extraCall(kind, n, pad);
  return ENGINE[call.to](st, ...call.args);
};
const bytes = (evs) => JSON.stringify(evs);

group("1. Every extra, both ways: the same bytes");
{
  const evs = [...open(), run(1), run(0), run(4)];
  const inn = deriveInnings(evs);
  const states = [];
  for (const freeHit of [false, true]) for (const hubApproach of [null, "over"]) for (const sel of [false, true]) {
    states.push({ curIn: 0, before: inn, inn, freeHit, hubApproach,
      selShot: sel ? "drive" : null, selSeg: sel ? { seg: 3, zone: "outer" } : null });
  }
  let compared = 0;
  const differ = [];
  const same = (label, a, b) => { compared++; if (bytes(a) !== bytes(b)) differ.push(`${label}: ${bytes(a).slice(0, 120)} ≠ ${bytes(b).slice(0, 120)}`); };
  const extra = (k) => EXTRAS.find((x) => x.kind === k);
  for (const st of states) {
    for (const basic of [true, false]) {
      // A wide: the old one-tap wide is runs 0; with runs, the engine's own onScore("Wd", n).
      for (const n of extra("Wd").runs) same(`wide ${n} basic=${basic}`, LEGACY.wide(st, n), now(st, "Wd", n, { basic }));
      // A wide mid-ball, after a shot and an area: it drops them, as it always did.
      same("wide mid-ball", LEGACY.wide(st, 0), now(st, "Wd", 0, { basic: false, shot: "pull", area: { seg: 5, zone: "boundary" } }));
      // A no-ball: every type, every run, whose the runs are.
      for (const t of NB_TYPES) for (const f of NB_FROM) for (const n of extra("Nb").runs) {
        same(`no-ball ${t.id} ${n} ${f.id}`, LEGACY.noBall(st, t.id, n, f.id), now(st, "Nb", n, { basic, nb: { type: t.id, from: f.id } }));
      }
    }
    // Byes and leg byes: Basic Scoring's, the idle three-phase pad's (nothing
    // chosen: Basic Scoring's call), and the outcome phase's with its shot and area.
    for (const k of ["B", "LB"]) for (const n of extra(k).runs) {
      same(`${k} ${n} basic`, LEGACY.basicBye(st, k, n), now(st, k, n, { basic: true }));
      same(`${k} ${n} idle three-phase`, LEGACY.basicBye(st, k, n), now(st, k, n, { basic: false, shot: null, area: null }));
      for (const [shot, area] of [["missed", null], ["padded", { seg: 2, zone: "inner" }], ["drive", { seg: 0, zone: "boundary" }]]) {
        same(`${k} ${n} outcome ${shot}`, LEGACY.outcomeBye(st, k, n, shot, area), now(st, k, n, { basic: false, shot, area }));
      }
    }
  }
  console.log(`  (${compared} extras built both ways; ${differ.length} differ)`);
  ok(`${compared} extras built both ways: byte-identical`, compared > 400 && differ.length === 0, differ.slice(0, 2).join(" | "));
  // The same, the other way round: something that is NOT the old event does not pass.
  const st = states[0];
  ok("...and the comparison can fail: a wide of 1 is not the old one-tap wide", bytes(LEGACY.wide(st, 0)) !== bytes(now(st, "Wd", 1, {})));
  ok("...nor a no-ball whose runs were said to be byes with no runs taken, written as byes",
     bytes(LEGACY.noBall(st, "front_foot", 0, "byes")) === bytes(now(st, "Nb", 0, { nb: { type: "front_foot", from: "byes" } }))
     && !("nbRuns" in now(st, "Nb", 0, { nb: { type: "front_foot", from: "byes" } })[0]));
  // The short run and a sector through commitBall, the same code moved.
  for (const shortRun of [false, true]) {
    const a = legacyCommitBall(st, "run", 0, "drive", 4, "outer", "round", undefined, { shortRun });
    const b = deliveryEvents({ curIn: 0, before: st.before, freeHit: st.freeHit, type: "run", value: 0, shot: "drive", seg: 4, zone: "outer", approach: "round", shortRun });
    ok(`commitBall's events, moved to delivery.js, are the same${shortRun ? " for a short run" : ""}`, bytes(a) === bytes(b));
  }

  // The wiring the comparison assumes is the wiring the pad and the engine have.
  const eng = src("apps/web/src/scorer/engine.jsx"), pad = src("apps/web/src/scorer/pad.jsx");
  ok("engine: recordWide(runs) is commitBall(\"Wd\",runs,null,null,null,hubApproach)",
     /const recordWide=\(runs\)=>\{\s*if\(!guardReady\(\)\)return;\s*commitBall\("Wd",runs,null,null,null,hubApproach\);/.test(eng));
  ok("engine: the one-tap wide is recordWide(0)", /const onWide=\(\)=>recordWide\(0\);/.test(eng));
  ok("engine: onCommitDetailed is commitBall(type,value,shot,seg,zone,null)",
     /const onCommitDetailed=\(type,value,shot,seg,zone\)=>\{\s*if\(!guardReady\(\)\)return;\s*commitBall\(type,value,shot,seg,zone,null\);/.test(eng));
  ok("engine: recordNoBall emits noBallEvent({inn,nbType,runs,nbRuns,selShot,selSeg})",
     /const recordNoBall=\(nbType,runs,nbRuns\)=>\{\s*emit\(noBallEvent\(\{inn,nbType,runs,nbRuns,selShot,selSeg\}\)\);/.test(eng));
  ok("engine: the no-ball sheet confirms through the same recordNoBall", /<NoBallSheet\s+onConfirm=\{recordNoBall\}/.test(eng));
  ok("engine: commitBall builds through deliveryEvents with the engine's own state",
     /const evs=deliveryEvents\(\{curIn,before,freeHit,type,value,shot,seg,zone,approach,placement,shortRun\}\);/.test(eng));
  ok("engine: the pad's wide and no-ball are those two", /onWide=\{recordWide\} onNoBall=\{recordNoBall\}/.test(eng));
  ok("pad: an extra's second tap dispatches extraCall() as named",
     /if \(call\.to === "wide"\) onWide\(\.\.\.call\.args\);\s*else if \(call\.to === "noBall"\) onNoBall\(\.\.\.call\.args\);\s*else onCommitDetailed\(\.\.\.call\.args\);/.test(pad)
     && /extraCall\(extra, n, \{ basic, shot, area, nb \}\)/.test(pad));
}

group("2. The new-over prompt: the likely bowler first");
{
  const roster = BW.map((b) => ({ ...b, role: "BOWL" }));
  // Overs: b1, b2, b1, b2, b3 — the sixth is next; b3 bowled the last one.
  const evs = [...open(), 0, 0, 0, 0, 0, 0].map((x) => (typeof x === "number" ? run(x) : x))
    .concat(over("b2"), over("b1"), over("b2"), over("b3"));
  const inn = deriveInnings(evs);
  const refuses = (id) => lawsRefusal({ innings: [inn], events: [evs] }, bowler({ bowler: id }));
  const c = bowlerChoices({ inn, roster, refuses });
  const order = c.rows.map((r) => `${r.id}${r.refusal ? "!" : ""}`).join(" ");
  ok(`the one who bowled the over before last is first and marked likely (${order})`, c.likelyId === "b2" && c.rows[0].id === "b2" && c.rows[0].likely);
  ok("...then the rest of the rotation as they first bowled, then those who have not",
     order === "b2 b1 b3! b4 b5", order);
  ok("...the last over's bowler stays in place, unavailable, in words", c.rows.find((r) => r.id === "b3").refusal === "consecutive_overs"
     && unavailableWords("consecutive_overs") === "Bowled the last over");
  ok("...and his figures ride along", c.rows[0].figures?.balls === 12 && c.rows.find((r) => r.id === "b4").figures === null);

  // A rule the Laws add later — a suspended bowler — is honoured without a line here.
  const suspended = (id) => (id === "b2" ? "bowler_suspended" : refuses(id));
  const s = bowlerChoices({ inn, roster, refuses: suspended });
  ok("a bowler the Laws refuse for any reason is not the likely one", s.likelyId === null && s.rows[0].id === "b1");
  ok("...he stays listed, unavailable, with words even for a code this build does not know",
     s.rows.find((r) => r.id === "b2").refusal === "bowler_suspended" && unavailableWords("bowler_suspended") === "Cannot bowl this over");
  ok("REFUSAL_TEXT's words are used where they exist, without a clause number",
     unavailableWords("mid_over_no_reason") === "Say injury or suspended first"
     && unavailableWords("same_batter_both_ends") === "The same batter was named at both ends"
     && noClause("the bowler was changed without saying why (Law 17.8.1)") === "the bowler was changed without saying why"
     && noClause("not two overs running, Law 17.8") === "not two overs running");
  ok("every REFUSAL_TEXT reason reads with no clause number",
     Object.keys(REFUSAL_TEXT).every((k) => !/\bLaws?\s*\d/.test(unavailableWords(k))));

  const first = deriveInnings([...open()]);
  const o = bowlerChoices({ inn: { ...first, bowlers: [] }, roster, refuses: () => null });
  ok("the opening bowler: nobody is likely, the squad in its order", o.likelyId === null && o.rows.map((r) => r.id).join() === "b1,b2,b3,b4,b5");
  const two = deriveInnings([...open(), ...[0, 0, 0, 0, 0, 0].map(run)]);
  ok("the second over: there is no over before last, so nobody is likely", bowlerChoices({ inn: two, roster, refuses: () => null }).likelyId === null);
  const mid = deriveInnings([...evs, run(0)]);
  ok("a change during an over: nobody is likely", bowlerChoices({ inn: mid, roster, refuses: () => null, midOver: true }).likelyId === null);
  // A change during the over before last: the one who finished it is the rotation.
  const swap = [...open(), ...[0, 0, 0].map(run), bowler({ bowler: "b4", reason: "injury" }), ...[0, 0, 0].map(run), ...over("b2")];
  const sw = deriveInnings(swap);
  ok("a change in the over before last: the one who finished it is likely",
     bowlerChoices({ inn: sw, roster, refuses: (id) => lawsRefusal({ innings: [sw], events: [swap] }, bowler({ bowler: id })) }).likelyId === "b4");
}

group("2. The new-batter prompt: the batting order's next name first");
{
  const bats = [{ id: "a1", status: "out" }, { id: "a2", status: "batting" }, { id: "a3", status: "batting" }, { id: "a5", status: "dnb" }];
  const c = batterChoices({ squad: SQ, batsmen: bats });
  ok(`next in the order is first and marked (${c.map((p) => `${p.pos}${p.next ? "*" : ""}`).join(" ")})`,
     c[0].id === "a4" && c[0].next && c.filter((p) => p.next).length === 1);
  ok("...then the rest in order, a did-not-bat included, nobody at the crease or out",
     c.map((p) => p.id).join() === ["a4", "a5", "a6", UUID].join() && c[0].pos === 4);
  ok("bare names read as names", batterChoices({ squad: ["X One", "X Two"], batsmen: [] })[0].name === "X One");
}

group("3. Undo says what it will take back");
{
  // As the pad records them: every event has an id (emit() stamps one).
  const evs = [...open(), run(4)].map((e, i) => ({ ...e, id: `e${i}` }));
  const inn = deriveInnings(evs);
  const words = (e, i = inn) => undoWords(e, i);
  const last = evs[lastUndoableIndex(evs)];
  ok(`a four ("Undo: ${words(last)}")`, words(last) === "4 to R Pillay");
  const at = { striker: "a2", nonStriker: "a1", bowler: "b1" };
  ok("a dot", words(ball({ type: "run", value: 0, ...at })) === "dot ball to D Erasmus");
  ok("a wide, and a wide with runs", words(ball({ type: "Wd", value: 0 })) === "wide" && words(ball({ type: "Wd", value: 2 })) === "wide and 2 runs");
  ok("a no-ball: alone, off the bat, byes, leg byes",
     words(ball({ type: "Nb", value: 0 })) === "no ball" && words(ball({ type: "Nb", value: 1, ...at })) === "no ball and 1 to D Erasmus"
     && words(ball({ type: "Nb", value: 2, nbRuns: "byes" })) === "no ball and 2 byes" && words(ball({ type: "Nb", value: 1, nbRuns: "leg_byes" })) === "no ball and 1 leg bye");
  ok("byes and leg byes", words(ball({ type: "B", value: 1 })) === "1 bye" && words(ball({ type: "LB", value: 3 })) === "3 leg byes");
  ok("a wicket", words(ball({ type: "W", dismissal: "caught", ...at })) === "wicket, D Erasmus caught");
  const inAndOn = [...evs, ball({ type: "W", dismissal: "bowled" }), batters({ striker: "a3" }), ...[0, 0, 0, 0].map(run), bowler({ bowler: "b2" })];
  const io = deriveInnings(inAndOn);
  ok("a batter in, a bowler on", words(batters({ striker: "a3" }), io) === "S Mokoena in" && words(bowler({ bowler: "b2" }), io) === "M Botha to bowl");
  ok("penalty runs, a retirement", words(penalty({ runs: 5, toBattingTeam: false })) === "5 penalty runs to the fielding side"
     && words(retire({ batter: "a1", reason: "hurt" })) === "R Pillay retired hurt");
  const anon = deriveInnings([inningsStart({ battingTeam: "H", bowlingTeam: "K", squad: [{ id: UUID, name: UUID }, { id: "a2", name: "D Erasmus" }], bowlingSquad: BW }),
    batters({ striker: UUID, nonStriker: "a2" }), bowler({ bowler: "b1" }), run(2)]);
  const w = undoWords(ball({ type: "run", value: 2, striker: UUID }), anon);
  ok(`never an id: a player known only by one is "the batter" (${w})`, w === "2 to the batter" && !w.includes(UUID));
  const old = { ...run(6), id: "e-old" };
  const olderLog = [...open(), old];
  ok("an older ball with no striker on it: the fold's own log says who faced it",
     undoWords(old, deriveInnings(olderLog)) === "6 to R Pillay");
  ok("nothing to undo: no words", undoWords(null, inn) === null);
}

group("4. The pad as drawn");
{
  const inn = deriveInnings([...open(), run(4)]);
  const noop = () => {};
  const html = (props) => renderToStaticMarkup(h(Pad, { inn, onCommitDetailed: noop, onWicketCtx: noop, onWide: noop, onNoBall: noop, onUndo: noop, ...props }));
  const tall = (markup, id) => Number(new RegExp(`data-testid="${id}"[^>]*style="[^"]*min-height:(\\d+)px`).exec(markup)?.[1]
    ?? new RegExp(`style="[^"]*min-height:(\\d+)px[^"]*"[^>]*data-testid="${id}"`).exec(markup)?.[1]);
  const basic = html({ basic: true, undoWhat: "4 to R Pillay" });
  const heights = Object.fromEntries(["run-0", "run-1", "run-2", "run-3", "run-4", "run-6", "key-wicket"].map((k) => [k, tall(basic, k)]));
  ok(`dot and 1 are the tallest run keys (${JSON.stringify(heights)})`,
     heights["run-0"] === 88 && heights["run-1"] === 88 && ["run-2", "run-3", "run-4", "run-6"].every((k) => heights[k] === 64));
  ok("...drawn last, next to the strip", basic.indexOf('data-testid="run-0"') > basic.indexOf('data-testid="run-6"')
     && basic.indexOf('data-testid="run-1"') < basic.indexOf('data-testid="pad-strip"')
     && basic.indexOf('data-testid="key-wicket"') < basic.indexOf('data-testid="run-2"'));
  ok("the four extras are on the strip, in order", /data-testid="pad-extras"[\s\S]*key-wide[\s\S]*key-noball[\s\S]*key-byes[\s\S]*key-legbyes/.test(basic));
  ok("...and the outcome keys no longer carry byes of their own", (basic.match(/data-testid="key-byes"/g) ?? []).length === 1);
  ok("undo's name and label say what it takes back", /aria-label="Undo: 4 to R Pillay"[^>]*data-testid="key-undo"|data-testid="key-undo"[^>]*aria-label="Undo: 4 to R Pillay"/.test(basic)
     && /data-testid="key-undo-what"[^>]*>4 to R Pillay</.test(basic));
  ok("with nothing to undo it says so", /aria-label="Undo: nothing to undo"/.test(html({ basic: true })));
  const three = html({ basic: false, undoWhat: "4 to R Pillay" });
  ok("the three-phase pad opens on the shot, with the same strip", /data-testid="phase-shot"/.test(three) && /data-testid="pad-extras"/.test(three)
     && /data-testid="key-dot"/.test(three));
  const small = [...three.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((n) => n < 12);
  ok("nothing on it under 12px", small.length === 0, small.join());
}

group("4. The haptic tick: fire and forget, never under reduced motion");
{
  const calls = [];
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  let reduce = false;
  globalThis.matchMedia = (q) => ({ matches: reduce && /reduce/.test(q) });
  Object.defineProperty(globalThis, "navigator", { value: { vibrate: (ms) => { calls.push(ms); return true; } }, configurable: true });
  hapticTick();
  ok("a recorded ball: one 10 ms tick", calls.length === 1 && calls[0] === 10);
  reduce = true; hapticTick();
  ok("...none while the device asks for reduced motion", calls.length === 1);
  reduce = false; setHapticOn(false); hapticTick();
  ok("...none once switched off on the pad's menu, which is remembered", calls.length === 1 && store.get(HAPTIC_KEY) === "off");
  setHapticOn(true); hapticTick();
  ok("...and back on stores nothing", calls.length === 2 && !store.has(HAPTIC_KEY));
  Object.defineProperty(globalThis, "navigator", { value: { vibrate: () => { throw new Error("no"); } }, configurable: true });
  let threw = false;
  try { hapticTick(); } catch { threw = true; }
  ok("a device whose vibrate throws does not stop the pad", !threw);
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  try { hapticTick(); } catch { threw = true; }
  ok("...nor one with none", !threw);
}

Date.now = realNow;
console.log(`\nPAD FEEL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

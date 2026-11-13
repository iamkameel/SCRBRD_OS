/**
 * THE SCORING PROOF'S PAD PATH: the harness and the pad cannot drift.
 *
 * packages/scoring/test/scorebook/harness.mjs scores each invented scorebook
 * through the scoring package's constructors, with the arguments the pad
 * hands them. This scores the same scorebooks through the scorer's OWN
 * emission code — the functions the panels and sheets call — and holds the
 * two event logs equal, event by event, field by field:
 *
 *   runs, byes, leg byes   extraCall() → commitBall → deliveryEvents()   (extras.js, delivery.js)
 *   a four all run         the "Runs, not a boundary" sheet → deliveryEvents({notBoundary})
 *   a wide                 extraCall("Wd") → recordWide → deliveryEvents()
 *   a no-ball              extraCall("Nb") → recordNoBall → noBallEvent()
 *   a short run            recordShortRun → deliveryEvents({shortRun}) → shortRunEvents()
 *   a wicket off an extra  openExtraWicket → confirmWicket → extraWicketEvent()
 *   the wicket sheet       wicketDetail(), fielderRefs()                  (wicketAsks.js)
 *   retired hurt, resume   retireHurtEvent(), resumeEvent()               (retire.js)
 *   penalty runs           awardEvent()                                   (penalty.js)
 *   the pad's own fold     foldPad()                                      (penalty.js)
 *
 * What engine.jsx builds inline (it cannot be called without the component):
 * the wicket ball itself in confirmWicket, a new batter (addBatsman), a
 * bowler (addBowler), retired and timed out, the innings' start and the
 * break's target. Those are built here from the call as engine.jsx writes
 * it, and section B pins each of those calls in engine.jsx's own text, so a
 * change there fails here before it can drift from the harness.
 *
 *   node apps/web/test/scorebook-pad.test.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  inningsStart, batters as battersEvent, bowler as bowlerEvent, ball as ballEvent, retire as retireEvent,
  revision as revisionEvent, sealInnings, keeper as keeperEvent, lawsEdition, RETIRE_REASON, INNINGS_END_REASON, DISMISSAL,
} from "@scrbrd/scoring";
import { deliveryEvents, noBallEvent, extraWicketEvent, crease } from "../src/scorer/delivery.js";
import { extraCall } from "../src/scorer/extras.js";
import { retireHurtEvent, resumeEvent } from "../src/scorer/retire.js";
import { awardEvent, foldPad } from "../src/scorer/penalty.js";
import { wicketDetail, fielderRefs } from "../src/scorer/wicketAsks.js";
import { bowlerToSuspend, suspendEvent } from "../src/scorer/suspension.js";
import { parseScorebook } from "../../../packages/scoring/test/scorebook/format.mjs";
import { buildLog, clockOf, contextOf, idOf } from "../../../packages/scoring/test/scorebook/harness.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 600)}` : ""); } };
const group = (t) => console.log("\n" + t);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BOOKS = join(ROOT, "packages/scoring/test/scorebook/books");
const realNow = Date.now;

/** The wicket sheet asks every question; the paper answers what applies. */
const ASKS = Object.freeze({ who: true, runs: true, whose: true, end: true });
const HOW = Object.freeze({ bowled: DISMISSAL.BOWLED, lbw: DISMISSAL.LBW, caught: DISMISSAL.CAUGHT, stumped: DISMISSAL.STUMPED,
  hit_wicket: DISMISSAL.HIT_WICKET, run_out: DISMISSAL.RUN_OUT, obstructing_field: DISMISSAL.OBSTRUCTING_FIELD, hit_twice: DISMISSAL.HIT_TWICE });

/**
 * The wicket sheet's answer for the paper's wicket: the method, the fielder's
 * name as the sheet's text, and wicketDetail()'s detail with fielderRefs().
 */
function sheetAnswer(inn, fieldSquad, w, runs, from) {
  const bowlerName = fieldSquad.find((p) => p.id === inn.bowler)?.name ?? null;
  const fielderText = w.fielder === "bowler" ? bowlerName : w.fielder;
  const fielders = fielderText ? fielderRefs([fielderText], fieldSquad) : [];
  const who = w.nonStriker ? inn.nonStriker : inn.striker;
  const detail = wicketDetail(ASKS, { who, strikerId: inn.striker, runs, from: from ?? null, end: w.end, fielders });
  return { mode: HOW[w.how], fielderText: fielderText ?? "", detail };
}

/** The pad scoring a scorebook, as its panels and sheets call it. */
function padLog(book) {
  const t0 = clockOf(book);
  Date.now = () => t0;
  const ctx = contextOf(book);
  const events = [];
  const match = () => ({ innings: foldPad(events, ctx), events });
  // engine.jsx emitAt(): stamped with the innings (and an id the comparison leaves out).
  const emitAt = (at, ...evs) => {
    while (events.length <= at) events.push([]);
    events[at] = [...events[at], ...evs.map((e) => ({ ...e, innings: at }))];
  };
  try {
    book.innings.forEach((paper, curIn) => {
      const emit = (...evs) => emitAt(curIn, ...evs);
      const inn = () => match().innings[curIn];
      const side = paper.side, other = book.sides[0] === side ? book.sides[1] : book.sides[0];
      const squad = Array.from({ length: 11 }, (_, k) => ({ id: idOf(side, `B${k + 1}`), name: `B${k + 1}` }));
      const fieldSquad = [...Array.from({ length: 11 }, (_, k) => ({ id: idOf(other, `BW${k + 1}`), name: `BW${k + 1}` })),
        ...Array.from({ length: 11 }, (_, k) => ({ id: idOf(other, `F${k + 1}`), name: `F${k + 1}` }))];
      const prev = curIn > 0 ? match().innings[curIn - 1] : null;
      const chases = paper.superOver == null ? curIn === 1 : book.innings[curIn - 1]?.superOver === paper.superOver;
      // startMatch's innings_start, the break's (target: the umpires', else
      // the first innings' runs and one), and a super over's.
      emit(inningsStart({
        battingTeam: side, bowlingTeam: other, teamKey: side, bowlingTeamKey: other, squad, bowlingSquad: fieldSquad, twelfthMan: null,
        overs: paper.overs ?? (paper.superOver != null ? 1 : book.overs),
        target: paper.target ?? (chases ? (prev?.runs || 0) + 1 : null),
        captureProfile: undefined, superOver: paper.superOver ?? undefined,
      }));
      emit(battersEvent({ striker: idOf(side, paper.openers[0]), nonStriker: idOf(side, paper.openers[1]) }));
      const used = new Set(paper.openers);
      // addBatsman(name, isStriker): the striker's end when it is empty.
      const addBatsman = (name) => { const asStriker = !inn()?.striker; emit(battersEvent({ ...(asStriker ? { striker: name } : { nonStriker: name }) })); };
      const addBowler = (name, reason) => emit(bowlerEvent({ bowler: name, ...(reason ? { reason } : {}) }));
      const fill = () => {
        for (let k = 0; k < 2; k++) {
          const i = inn();
          if (i.complete || (i.striker != null && i.nonStriker != null)) return;
          const next = squad.find((p) => !used.has(p.name));
          used.add(next.name);
          addBatsman(next.id);
        }
      };
      // commitBall(type, value, shot, seg, zone, approach, placement, opts) on Basic Scoring.
      const commitBall = (type, value, shot, seg, zone, approach, placement, { shortRun = false, notBoundary = false, notInOver = null } = {}) => {
        const before = inn();
        emit(...deliveryEvents({ curIn, before, freeHit: before.freeHit, type, value, shot, seg, zone, approach, placement,
          shortRun, nbType: null, facesNext: null, disallowed: null, notInOver, notBoundary }));
      };
      // engine.jsx confirmWicket(mode, fielder, extra), with modalCtx as
      // onWicketCtx (no shot, no area) or openExtraWicket left it.
      const confirmWicket = (mode, fielder, extra, modalCtx) => {
        const i = inn();
        const freeHit = i.freeHit;
        const offExtra = modalCtx?.extra ?? null;
        emit(offExtra ? extraWicketEvent({ inn: i, extra: offExtra, freeHit, approach: null,
          wicket: { dismissal: mode, fielder, ...(extra.fielders ? { fielders: extra.fielders } : {}), dismissed: extra.dismissed ?? null, outAt: extra.outAt ?? null } })
          : ballEvent({ type: "W", value: extra.runs ?? 0, shot: modalCtx?.shot || null,
            ...(modalCtx?.placement ?? { seg: modalCtx?.seg ?? null, zone: modalCtx?.zone ?? null }),
            dismissal: mode, fielder: fielder || null, freeHit,
            ...(extra.fielders ? { fielders: extra.fielders } : {}),
            ...crease(i),
            ...(extra.dismissed ? { dismissed: extra.dismissed } : {}),
            ...(extra.outAt ? { outAt: extra.outAt } : {}),
            ...(extra.nbRuns ? { nbRuns: extra.nbRuns } : {}),
            ...(extra.facesNext ? { facesNext: extra.facesNext } : {}) }));
      };
      const delivery = (d) => {
        const i = inn();
        if (d.wicket) {
          const from = d.type === "W" ? d.nbRuns : null;
          const { mode, fielderText, detail } = sheetAnswer(i, fieldSquad, d.wicket, d.type === "W" ? d.value : 0, from);
          const modalCtx = d.type === "W" ? { shot: null, seg: null, zone: null, placement: null }
            : { extra: { type: d.type, runs: d.value, nbType: d.type === "Nb" ? d.nbType ?? "front_foot" : null, nbRuns: d.type === "Nb" && d.value > 0 ? d.nbRuns ?? null : null,
              ...(d.notBoundary ? { notBoundary: true } : {}) } };
          confirmWicket(mode, fielderText, detail, modalCtx);
          return;
        }
        if (d.shortRun) { commitBall("run", 0, null, null, null, null, undefined, { shortRun: true }); return; }
        // engine.jsx recordNotInOver(): commitBall with the reason (the pad's sheet, its own button).
        const nio = d.notInOver ? { notInOver: d.notInOver } : {};
        if (d.type === "run" && d.notBoundary) { commitBall("run", d.value, null, null, null, null, undefined, { notBoundary: true }); return; }
        if (d.type === "run") { commitBall("run", d.value, null, null, null, null, undefined, nio); return; }
        const call = extraCall(d.type, d.value, { basic: true, nb: { type: d.nbType ?? "front_foot", from: d.nbRuns ?? null, ...(d.notBoundary ? { notBoundary: true } : {}) } });
        if (call.to === "commit") { const [type, value, shot, seg, zone] = call.args; commitBall(type, value, shot, seg, zone, undefined, undefined, nio); return; }
        if (call.to === "wide") { commitBall("Wd", call.args[0], null, null, null, null); return; }
        // recordNoBall(nbType, runs, nbRuns, notBoundary)
        const [nbType, runs, nbRuns, notBoundary = false] = call.args;
        emit(noBallEvent({ inn: i, nbType, runs, nbRuns, selShot: null, selSeg: null, notBoundary }));
      };

      for (const line of paper.lines) {
        if (line.kind === "revise") { emit(revisionEvent({ overs: line.overs ?? null, target: line.target ?? null, reason: "rain" })); continue; }
        if (line.kind === "declare") { emit(sealInnings(inn(), INNINGS_END_REASON.DECLARED)); continue; }
        fill();
        addBowler(idOf(other, line.bowler));
        for (const step of line.steps) {
          const i = inn();
          if (step.kind === "ball") { fill(); delivery(step.d); continue; }
          const id = idOf(side, step.who);
          if (step.kind === "rh") emit(retireHurtEvent(curIn, id));
          else if (step.kind === "back") emit(resumeEvent(match(), curIn, id, i.striker == null));
          // confirmWicket(RETIRED_OUT): retireEvent({batter: extra.dismissed ?? inn.striker, reason: OUT}).
          else if (step.kind === "rto") emit(retireEvent({ batter: id, reason: RETIRE_REASON.OUT }));
          else if (step.kind === "timed") { used.add(step.who); emit(retireEvent({ batter: id, reason: RETIRE_REASON.TIMED_OUT })); }
          else if (step.kind === "pen") emit(awardEvent(curIn, { toBattingTeam: step.runs > 0, reason: step.reason }));
          else if (step.kind === "bw") addBowler(idOf(other, step.who), step.reason);
          // engine.jsx recordSuspension(): suspendEvent(curIn, bowlerToSuspend(inn), reason, lawsEdition({innings, events})).
          else if (step.kind === "susp") emit(suspendEvent(curIn, bowlerToSuspend(i), step.reason, lawsEdition({ innings: match().innings, events })));
          // engine.jsx addKeeper(id): keeperEvent({keeper: id}).
          else if (step.kind === "kp") emit(keeperEvent({ keeper: idOf(other, step.who) }));
        }
      }
      if (!paper.lines.some((l) => l.kind === "declare")) emit(sealInnings(inn()));
    });
  } finally {
    Date.now = realNow;
  }
  return events;
}

// The ids the pad mints are its own; every other field is compared.
const strip = (e) => { const { id: _id, ...rest } = e; return rest; };

group("A. Every scorebook, through the pad's own emission, is the harness's log");
{
  const files = readdirSync(BOOKS).filter((f) => f.endsWith(".scorebook")).sort();
  ok("there are scorebooks", files.length >= 15, files.length);
  for (const f of files) {
    const book = parseScorebook(readFileSync(join(BOOKS, f), "utf8"), f);
    const harness = buildLog(book);
    const pad = padLog(book);
    ok(`${book.match}: the harness scored it without a problem`, harness.problems.length === 0, harness.problems.join("; "));
    ok(`${book.match}: the same innings`, pad.length === harness.byInnings.length, `${pad.length} v ${harness.byInnings.length}`);
    harness.byInnings.forEach((evs, i) => {
      const mine = (pad[i] ?? []).map(strip), theirs = evs.map(strip);
      const k = theirs.findIndex((e, j) => !isDeepStrictEqual(e, mine[j]));
      ok(`${book.match} innings ${i + 1}: the same ${theirs.length} events`, k === -1 && mine.length === theirs.length,
        k === -1 ? `${mine.length} v ${theirs.length}` : `event ${k}: pad ${JSON.stringify(mine[k])} · harness ${JSON.stringify(theirs[k])}`);
    });
  }
}

group("B. engine.jsx still builds what A builds inline");
{
  // The code alone: full-line comments out, whitespace as one space.
  const eng = readFileSync(join(ROOT, "apps/web/src/scorer/engine.jsx"), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");
  const has = (n, re) => ok(n, re.test(eng));
  has("confirmWicket: an extra's wicket through extraWicketEvent()",
    /const ev=offExtra\?extraWicketEvent\(\{inn,extra:offExtra,freeHit,approach:hubApproach, wicket:\{dismissal:mode,fielder,\.\.\.\(extra\.fielders\?\{fielders:extra\.fielders\}:\{\}\),dismissed:extra\.dismissed\?\?null,outAt:extra\.outAt\?\?null\}\}\)/);
  has("confirmWicket: the wicket ball, field by field",
    /:ballEvent\(\{type:"W",value:extra\.runs\?\?0,shot:modalCtx\?\.shot\|\|null, \.\.\.\(modalCtx\?\.placement\?\?\{seg:modalCtx\?\.seg\?\?null,zone:modalCtx\?\.zone\?\?null\}\), dismissal:mode,fielder:fielder\|\|null,freeHit, \.\.\.\(extra\.fielders\?\{fielders:extra\.fielders\}:\{\}\), \.\.\.crease\(inn\), \.\.\.\(extra\.dismissed\?\{dismissed:extra\.dismissed\}:\{\}\), \.\.\.\(extra\.outAt\?\{outAt:extra\.outAt\}:\{\}\), \.\.\.\(extra\.nbRuns\?\{nbRuns:extra\.nbRuns\}:\{\}\), \.\.\.\(extra\.facesNext\?\{facesNext:extra\.facesNext\}:\{\}\)\}\);/);
  has("confirmWicket: retired out is a retirement of the batter named, else the striker",
    /if\(mode===DISMISSAL\.RETIRED_OUT\)\{ recordNonBallWicket\(retireEvent\(\{batter:extra\.dismissed\?\?inn\.striker,reason:RETIRE_REASON\.OUT\}\)\);/);
  has("timed out is a retirement", /const recordTimedOut=id=>recordNonBallWicket\(retireEvent\(\{batter:id,reason:RETIRE_REASON\.TIMED_OUT\}\),\{keepModal:true\}\);/);
  has("addBatsman: the striker's end when it is empty",
    /const addBatsman=\(name,isStriker,opts=\{\}\)=>\{ const asStriker=isStriker\|\|!inn\?\.striker; emit\(battersEvent\(\{\.\.\.\(asStriker\?\{striker:name\}:\{nonStriker:name\}\)/);
  has("addBowler: the bowler, and a reason only mid-over", /const addBowler=\(name,reason\)=>emit\(bowlerEvent\(\{bowler:name,\.\.\.\(reason\?\{reason\}:\{\}\)\}\)\);/);
  has("commitBall builds every delivery through deliveryEvents()",
    /const evs=deliveryEvents\(\{curIn,before,freeHit,type,value,shot,seg,zone,approach,placement,shortRun,nbType,facesNext,disallowed,notInOver,notBoundary\}\);/);
  has("recordWide: commitBall with the wide's runs", /const recordWide=\(runs\)=>\{ if\(!guardReady\(\)\)return; commitBall\("Wd",runs,null,null,null,hubApproach\);/);
  has("recordSuspension: suspendEvent() with the bowler to suspend and the match's Edition",
    /const recordSuspension=\(reason\)=>\{ const who=bowlerToSuspend\(inn\); const ev=suspendEvent\(curIn,who,reason,lawsEdition\(\{innings,events\}\)\);/);
  has("addKeeper: keeperEvent({keeper})", /const addKeeper=id=>emit\(keeperEvent\(\{keeper:id\}\)\);/);
  has("recordNotInOver: commitBall with the reason", /commitBall\(type,value,null,null,null,null,undefined,\{nbType,notInOver:reason,facesNext\}\);/);
  has("recordNoBall: noBallEvent()", /const recordNoBall=\(nbType,runs,nbRuns,notBoundary=false\)=>\{ const nb=noBallEvent\(\{inn,nbType,runs,nbRuns,selShot,selSeg,notBoundary\}\);/);
  has("recordShortRun: commitBall with no runs, a short run", /commitBall\(type,0,null,null,null,null,undefined,\{shortRun:true,nbType,disallowed:reason,facesNext\}\);/);
  has("Runs, not a boundary: commitBall with notBoundary", /commitBall\("run",n,null,null,null,hubApproach,undefined,\{notBoundary:true\}\);/);
  has("the break: the umpires' target, else the first innings' runs and one", /target: umpires\?\.target \?\? \(\(innings\[0\]\?\.runs \|\| 0\) \+ 1\),/);
  has("the review sheet seals through sealInnings()", /emit\(sealInnings\(inn\)\);/);
  has("emitAt stamps the innings on every event", /const stamped = evs\.map\(e => \(\{ \.\.\.e, innings: at, id: e\.id \?\? newEventId\(/);
}

console.log(`\nscorebook pad path: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

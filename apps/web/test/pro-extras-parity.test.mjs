/**
 * A wide and a no-ball are the same event whichever mode scored them
 * (Kameel, 8 Oct 2026: in a live match, Pro Mode's WIDE was one tap that
 * always recorded a wide of no runs — no runs taken off it, no wicket on it —
 * while Focus Mode's pad asked both).
 *
 * Each mode is driven through its own code, read out of the source and run
 * against one fake engine whose recordWide / recordNoBall / openExtraWicket
 * are the engine's own (also read from engine.jsx), down to delivery.js:
 *
 *   Focus  the pad's second tap: pad.jsx's recordExtra(n, nb, wicket), with
 *          the props engine.jsx gives <Pad>.
 *   Pro    the hub's WIDE / NO BALL key (the props engine.jsx gives
 *          <ScoringPanel>, the handler it names), then the sheet that handler
 *          opens, confirmed with the sheet's own arguments.
 *
 * A wicket goes to the wicket sheet (openExtraWicket), which builds the event
 * with extraWicketEvent from the extra it was handed, as engine.jsx does.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/pro-extras-parity.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveInnings, inningsStart, batters, bowler, ball, BALL_TYPE, dismissalsOffExtra } from "@scrbrd/scoring";
import { deliveryEvents, noBallEvent, extraWicketEvent } from "../src/scorer/delivery.js";
import { EXTRAS, extraCall, NB_TYPES, NB_FROM } from "../src/scorer/extras.js";
import { WideSheet, NoBallSheet } from "../src/scorer/sheets.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const src = (f) => readFileSync(join(ROOT, f), "utf8");
Date.now = () => 1790000000000; // an event's clientTs

const eng = src("apps/web/src/scorer/engine.jsx");
const pad = src("apps/web/src/scorer/pad.jsx");
const sheets = src("apps/web/src/scorer/sheets.jsx");

/** The balanced {…} or (…) that opens at or after `from` in `text`. */
function balanced(text, from) {
  const i = text.slice(from).search(/[{(]/) + from;
  const open = text[i], close = open === "{" ? "}" : ")";
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === open) depth++;
    else if (text[j] === close && --depth === 0) return text.slice(i, j + 1);
  }
  throw new Error("unbalanced at " + from);
}
/** `const name=(…)=>{…}` as written in the source, whitespace and all. */
function constFn(text, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*`).exec(text);
  if (!m) throw new Error(`no const ${name}`);
  const start = m.index + m[0].length;
  const params = balanced(text, start);
  const arrow = text.indexOf("=>", start + params.length) + 2;
  if (/^\s*\{/.test(text.slice(arrow))) return `${params}=>${balanced(text, arrow)}`;
  // An expression body: up to the statement's `;`.
  let depth = 0, j = arrow;
  for (; j < text.length; j++) {
    if ("({[".includes(text[j])) depth++;
    else if (")}]".includes(text[j])) depth--;
    else if (text[j] === ";" && depth === 0) break;
  }
  return `${params}=>${text.slice(arrow, j)}`;
}
/** A JSX prop's expression on the first <Tag …> in the source. */
function prop(text, tag, name) {
  const at = text.indexOf(`<${tag}`);
  const p = text.indexOf(` ${name}={`, at);
  return balanced(text, p + name.length + 2).slice(1, -1);
}
/** The onConfirm of the sheet engine.jsx draws for `modal`. */
function sheetConfirm(modal) {
  const at = eng.indexOf(`if(modal==="${modal}")return (`);
  if (at < 0) return null;
  const end = eng.indexOf("if(modal===", at + 10);
  const block = eng.slice(at, end);
  return balanced(block, block.indexOf("onConfirm={") + 10).slice(1, -1);
}

// ── One fake engine: the engine's own handlers, over delivery.js ─────────
function engine(st) {
  const out = { events: [], modal: null, modalCtx: null };
  const scope = {
    guardReady: () => true,
    setModal: (m) => { out.modal = m; },
    setModalCtx: (c) => { out.modalCtx = c; },
    setSelSeg() {}, setFreeHit() {}, hapticTick() {}, scoreKeyRef: { current: 0 },
    project: () => ({ freeHit: false }),
    emit: (...evs) => out.events.push(...evs),
    noBallEvent,
    inn: st.inn, selShot: st.selShot, selSeg: st.selSeg, hubApproach: st.hubApproach,
    // commitBall's events: deliveryEvents with the engine's own state (pad-feel.test proves the wiring).
    commitBall: (type, value, shot, seg, zone, approach, placement) =>
      out.events.push(...deliveryEvents({ curIn: 0, before: st.inn, freeHit: st.freeHit, type, value, shot, seg, zone, approach, placement })),
  };
  // Each handler sees the others through the scope, as the component's closures do.
  const HANDLERS = ["recordWide", "recordNoBall", "openExtraWicket", "onWide", "onNoBall"];
  const names = [...Object.keys(scope), ...HANDLERS];
  const make = (code) => new Function("$", `const {${names.join(",")}}=new Proxy({}, {get:(_, k)=>$[k], has:()=>true}); return (${code});`)(scope);
  for (const n of HANDLERS) scope[n] = (...a) => made[n](...a);
  const made = Object.fromEntries(HANDLERS.map((n) => [n, make(constFn(eng, n))]));
  scope.make = make;
  // The wicket sheet's confirm, for an extra (engine.jsx confirmWicket).
  out.confirmWicket = (wk) => {
    const offExtra = out.modalCtx?.extra;
    if (!offExtra) return;
    out.events.push(extraWicketEvent({ inn: st.inn, extra: offExtra, freeHit: st.freeHit, approach: st.hubApproach, wicket: wk }));
    out.modal = null;
  };
  out.scope = scope;
  return out;
}

// Focus: the pad's second tap, wired as engine.jsx wires <Pad>.
function focus(st, kind, n, { nb = { type: "front_foot", from: null }, wk = null } = {}) {
  const e = engine(st);
  const s = e.scope;
  const props = { onWide: prop(eng, "Pad inn", "onWide"), onNoBall: prop(eng, "Pad inn", "onNoBall"),
    onExtraWicket: prop(eng, "Pad inn", "onExtraWicket"), onCommitDetailed: "()=>{throw new Error('commit')}" };
  const p = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, s.make(v)]));
  const recordExtra = new Function("extra", "basic", "shot", "area", "extraCall", "setExtra", "reset",
    "onWide", "onNoBall", "onExtraWicket", "onCommitDetailed", `return (${constFn(pad, "recordExtra")});`)(
    kind, false, null, null, extraCall, () => {}, () => {}, p.onWide, p.onNoBall, p.onExtraWicket, p.onCommitDetailed);
  recordExtra(n, nb, !!wk);
  if (wk) e.confirmWicket(wk);
  return e.events;
}

// Pro: the hub's key, wired as engine.jsx wires <ScoringPanel>, then the
// sheet that key opens, confirmed with the sheet's own arguments.
function pro(st, kind, n, { nb = { type: "front_foot", from: null }, wk = null } = {}) {
  const e = engine(st);
  const s = e.scope;
  s.make(prop(eng, "ScoringPanel", kind === "Wd" ? "onWide" : "onNoBall"))();
  if (e.events.length) return e.events;          // the key recorded on its own, asking nothing
  const confirm = sheetConfirm(e.modal);
  if (!confirm) return [`no sheet for modal ${e.modal}`];
  const onConfirm = s.make(confirm);
  // NoBallSheet: onConfirm(nbType, runs, runs>0?from:null, wicket); WideSheet: onConfirm(runs, wicket).
  if (kind === "Wd") onConfirm(n, !!wk); else onConfirm(nb.type, n, n > 0 ? nb.from : null, !!wk);
  if (wk) e.confirmWicket(wk);
  return e.events;
}

const bytes = (evs) => JSON.stringify(evs);
const inn = deriveInnings([
  inningsStart({ battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: [{ id: "a1", name: "R Pillay" }, { id: "a2", name: "D Erasmus" }, { id: "a3", name: "S Mokoena" }],
    bowlingSquad: [{ id: "b1", name: "K Naidoo" }, { id: "b2", name: "M Botha" }], overs: 20 }),
  batters({ striker: "a1", nonStriker: "a2" }), bowler({ bowler: "b1" }),
  ball({ type: BALL_TYPE.RUN, value: 1 }), ball({ type: BALL_TYPE.RUN, value: 0 }),
]);
const states = [];
for (const freeHit of [false, true]) for (const hubApproach of [null, "Over the wicket"]) states.push({ inn, freeHit, hubApproach, selShot: null, selSeg: null });
const WK = {
  stumped: { dismissal: "stumped", fielder: "M Botha", dismissed: null, outAt: null },
  run_out: { dismissal: "run_out", fielder: "M Botha", dismissed: "a2", outAt: "bowler_end" },
  hit_wicket: { dismissal: "hit_wicket", fielder: null, dismissed: null, outAt: null },
  obstructing_field: { dismissal: "obstructing_field", fielder: null, dismissed: "a1", outAt: null },
};

group("1. A wide: the same event from either mode");
{
  const differ = []; let compared = 0;
  const same = (label, a, b) => { compared++; if (bytes(a) !== bytes(b) || a.length !== 1) differ.push(`${label}: focus ${bytes(a).slice(0, 160)} ≠ pro ${bytes(b).slice(0, 160)}`); };
  for (const st of states) {
    for (const n of EXTRAS.find((x) => x.kind === "Wd").runs) {
      same(`wide ${n}`, focus(st, "Wd", n), pro(st, "Wd", n));
      for (const [k, wk] of Object.entries(WK)) same(`wide ${n} + ${k}`, focus(st, "Wd", n, { wk }), pro(st, "Wd", n, { wk }));
    }
  }
  console.log(`  (${compared} wides scored both ways; ${differ.length} differ)`);
  ok(`${compared} wides, Focus and Pro: byte-identical`, compared === 4 * 5 * 5 && differ.length === 0, differ.slice(0, 2).join(" | "));
  const st = states[0];
  const w2 = pro(st, "Wd", 2)[0], ws = pro(st, "Wd", 0, { wk: WK.stumped })[0], wr = pro(st, "Wd", 1, { wk: WK.run_out })[0];
  ok("Pro: a wide with 2 run is a wide of value 2", w2?.type === "Wd" && w2.value === 2, bytes(w2));
  ok("Pro: a wide, stumped, is the wide carrying the stumping", ws?.type === "Wd" && ws.value === 0 && ws.dismissal === "stumped", bytes(ws));
  ok("Pro: a wide, 1 run then run out, carries both", wr?.type === "Wd" && wr.value === 1 && wr.dismissal === "run_out" && wr.dismissed === "a2", bytes(wr));
  const off = dismissalsOffExtra("Wd");
  ok("the four ways out tried are Law 22.9's, and only those", Object.keys(WK).every((k) => off.has(k)) && off.size === 4, [...off].join());
}

group("2. A no-ball: the same event from either mode");
{
  const differ = []; let compared = 0;
  const same = (label, a, b) => { compared++; if (bytes(a) !== bytes(b) || a.length !== 1) differ.push(`${label}: focus ${bytes(a).slice(0, 160)} ≠ pro ${bytes(b).slice(0, 160)}`); };
  for (const st of states) for (const t of NB_TYPES) for (const f of NB_FROM) for (const n of EXTRAS.find((x) => x.kind === "Nb").runs) {
    const nb = { type: t.id, from: f.id };
    same(`no-ball ${t.id} ${n} ${f.id}`, focus(st, "Nb", n, { nb }), pro(st, "Nb", n, { nb }));
    same(`no-ball ${t.id} ${n} ${f.id} + run out`, focus(st, "Nb", n, { nb, wk: WK.run_out }), pro(st, "Nb", n, { nb, wk: WK.run_out }));
  }
  console.log(`  (${compared} no-balls scored both ways; ${differ.length} differ)`);
  ok(`${compared} no-balls, Focus and Pro: byte-identical`, compared === 4 * 3 * 3 * 7 * 2 && differ.length === 0, differ.slice(0, 2).join(" | "));
}

group("3. The sheets ask what the pad asks");
{
  const noop = () => {};
  const wd = renderToStaticMarkup(h(WideSheet, { onConfirm: noop, onClose: noop }));
  const keys = (html, p) => [...html.matchAll(new RegExp(`data-testid="${p}(\\d+)"`, "g"))].map((m) => Number(m[1]));
  ok("the wide sheet offers the pad's wide runs", bytes(keys(wd, "wd-run-")) === bytes(EXTRAS.find((x) => x.kind === "Wd").runs), bytes(keys(wd, "wd-run-")));
  ok("the wide sheet asks: and a wicket?", /data-testid="wd-wicket-yes"/.test(wd) && /data-testid="wd-wicket-no"/.test(wd));
  ok("the wide sheet says the 4th Edition's head-height wide when it applies",
     !/wd-head-height/.test(wd) && /wd-head-height/.test(renderToStaticMarkup(h(WideSheet, { onConfirm: noop, onClose: noop, edition: 4 }))));
  ok("the wide sheet confirms (runs, wicket)", /onClick=\{\(\)=>onConfirm\(runs,wicket\)\}/.test(sheets));
  const nb = renderToStaticMarkup(h(NoBallSheet, { onConfirm: noop, onClose: noop }));
  ok("the no-ball sheet offers the pad's no-ball runs", bytes(keys(nb, "nb-run-")) === bytes(EXTRAS.find((x) => x.kind === "Nb").runs), bytes(keys(nb, "nb-run-")));
  ok("the no-ball sheet confirms (type, runs, whose only with runs, wicket)", /onConfirm\(nbType,runs,runs>0\?from:null,wicket\)/.test(sheets));
  ok("the hub's WIDE and NO BALL keys call the engine's onWide and onNoBall",
     /<button onClick=\{onWide\}/.test(src("apps/web/src/scorer/scoring.jsx")) && /<button onClick=\{onNoBall\}/.test(src("apps/web/src/scorer/scoring.jsx")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

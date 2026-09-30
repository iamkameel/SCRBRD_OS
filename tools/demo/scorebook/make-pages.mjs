#!/usr/bin/env node
/**
 * Two synthetic scorebook pages for the reader's demo and walks (SCRBRD-120
 * phase 4), and the reader's answer to them.
 *
 * NO REAL CHILD IS ON THESE PAGES. The home side's names are the pilot
 * seed's invented Hilton boys (db/98_seed_pilot.sql), written the way a
 * scorer writes them ("Whitfield J"), so the demo shows the API matching our
 * boys to the roster; one more ("Moyo T") is on no roster, so it shows a name
 * left for the person. The opposition ("Ferndale High") and its boys are
 * invented here.
 *
 * The pages are drawn in a real browser (playwright-core, already a dev
 * dependency — nothing new is installed): a printed book's grid, and the
 * entries in blue "handwriting" (a serif italic, every glyph turned and
 * lifted a little by a seeded random, so the output is the same every run).
 * The page is turned a degree, as a photo of a book is.
 *
 * reader-response.json is a Messages API response in the shape the provider
 * returns, its text the ReadCard JSON a reader would give for these pages —
 * figures, names as written, a confidence per cell (lower where the drawing
 * smudges on purpose), and every box measured from where the browser put the
 * entry, as a fraction of the page. It was NOT recorded from the provider:
 * tests and walks never call it (SCOREBOOK_READER_REPLAY replays this file
 * through services/api/ai/scorebook-reader.mjs), and it is labelled so in
 * its `id` and `model`.
 *
 *   node tools/demo/scorebook/make-pages.mjs     → page-1.png, page-2.png, reader-response.json
 */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "../../chromium.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1600, H = 1100;

// ── The innings: Hilton 1st XI 135 for 5 in 20 overs ─────────────────────
// Batting adds up (124 + 11 extras), the bowling does too (132 + 2 b + 1 lb),
// the wickets are the bowlers', the fall of wickets climbs.
export const BATTING = [
  { name: "Whitfield J", how: "c Smit", bowler: "Dube",     runs: 34, balls: 29, fours: 4, sixes: 1, howOut: "caught",  fielder: "Smit" },
  { name: "Bekker T",    how: "bowled", bowler: "Ferreira", runs: 12, balls: 15, fours: 1, sixes: 0, howOut: "bowled" },
  { name: "Naidoo S",    how: "lbw",    bowler: "Botha",    runs: 0,  balls: 3,  fours: 0, sixes: 0, howOut: "lbw" },
  { name: "Cele M",      how: "run out (Govender)", bowler: "", runs: 25, balls: 22, fours: 2, sixes: 0, howOut: "run_out", fielder: "Govender", smudge: "balls" },
  { name: "Pillay R",    how: "not out", bowler: "",        runs: 38, balls: 28, fours: 3, sixes: 1, howOut: "not_out" },
  { name: "Moyo T",      how: "c Dube", bowler: "Ferreira", runs: 9,  balls: 8,  fours: 1, sixes: 0, howOut: "caught",  fielder: "Dube" },
  { name: "Dlamini K",   how: "not out", bowler: "",        runs: 6,  balls: 5,  fours: 0, sixes: 0, howOut: "not_out" },
];
export const DNB = [{ name: "Mahlangu L" }, { name: "Sithole J" }, { name: "Khumalo B", smudge: "name" }];
export const EXTRAS = { byes: 2, legByes: 1, wides: 5, noBalls: 3, penalty: 0 };
export const TOTAL = { total: 135, wickets: 5, overs: "20" };
export const BOWLING = [
  { name: "Ferreira D", overs: "4", maidens: 0, runs: 28, wickets: 2, wides: 2, noBalls: 1 },
  { name: "Dube S",     overs: "4", maidens: 0, runs: 30, wickets: 1, wides: 1, noBalls: 0 },
  { name: "Botha A",    overs: "4", maidens: 1, runs: 22, wickets: 1, wides: 1, noBalls: 2 },
  { name: "Govender N", overs: "4", maidens: 0, runs: 25, wickets: 0, wides: 1, noBalls: 0 },
  { name: "Smit J",     overs: "4", maidens: 0, runs: 27, wickets: 0, wides: 0, noBalls: 0 },
];
export const FOW = [
  { wicket: 1, score: 30,  name: "Bekker",    over: "5.1" },
  { wicket: 2, score: 31,  name: "Naidoo",    over: "5.4" },
  { wicket: 3, score: 72,  name: "Whitfield", over: "11.2" },
  { wicket: 4, score: 98,  name: "Cele",      over: "15.3" },
  { wicket: 5, score: 117, name: "Moyo",      over: "18.1" },
];

// ── Drawing ─────────────────────────────────────────────────────────────

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A handwritten entry at (x, y), tagged with its cell path. */
function hand(r, x, y, text, cell, { size = 30, smudge = false } = {}) {
  const chars = [...String(text)];
  const rotate = chars.map(() => ((r() - 0.5) * 10).toFixed(1)).join(" ");
  const dy = chars.map((_, i) => (i === 0 ? 0 : (r() - 0.5) * 2.4).toFixed(1)).join(" ");
  const tilt = ((r() - 0.5) * 3).toFixed(2);
  const filter = smudge ? ` filter="url(#smudge)" opacity="0.55"` : "";
  return `<text data-cell="${cell}" x="${x}" y="${y}" rotate="${rotate}" dy="${dy}" transform="rotate(${tilt} ${x} ${y})" class="ink" style="font-size:${size}px"${filter}>${esc(text)}</text>`;
}
const printed = (x, y, text, size = 17, anchor = "start") =>
  `<text x="${x}" y="${y}" class="print" style="font-size:${size}px" text-anchor="${anchor}">${esc(text)}</text>`;

function frame(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#6d6a64}
    #page{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#6d6a64}
    svg{position:absolute;left:0;top:0;transform:rotate(-0.8deg);transform-origin:50% 50%}
    .print{font-family:"Liberation Sans",sans-serif;fill:#2b2b2b}
    .ink{font-family:"FreeSerif",serif;font-style:italic;fill:#1d3a8a}
    .rule{stroke:#8f8a7e;stroke-width:1.2}
  </style></head><body><div id="page"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><filter id="smudge"><feGaussianBlur stdDeviation="2.2"/></filter>
      <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbf6e8"/><stop offset="1" stop-color="#efe7d2"/></linearGradient></defs>
    <rect x="40" y="30" width="${W - 80}" height="${H - 60}" fill="url(#paper)" rx="6"/>
    ${printed(80, 80, title, 22)}
    ${body}
  </svg></div></body></html>`;
}

function page1(r) {
  const cols = [[80, "No."], [140, "BATSMAN"], [470, "HOW OUT"], [770, "BOWLER"], [1010, "RUNS"], [1140, "BALLS"], [1270, "4s"], [1380, "6s"]];
  let s = printed(80, 118, "INNINGS OF", 15) + hand(r, 200, 120, "Hilton 1st XI", "team", { size: 30 })
        + printed(640, 118, "v", 15) + hand(r, 680, 120, "Ferndale High", "opponent", { size: 30 })
        + printed(1100, 118, "1st INNINGS · 20 overs", 15);
  const top = 150, row = 62;
  s += cols.map(([x, t]) => printed(x, top + 30, t, 15)).join("");
  for (let i = 0; i <= 12; i++) s += `<line class="rule" x1="70" y1="${top + 45 + i * row}" x2="1530" y2="${top + 45 + i * row}"/>`;
  for (const [x] of cols.slice(1)) s += `<line class="rule" x1="${x - 12}" y1="${top + 10}" x2="${x - 12}" y2="${top + 45 + 12 * row}"/>`;
  BATTING.forEach((b, i) => {
    const y = top + 45 + i * row + 44;
    s += printed(88, y - 6, String(i + 1), 17);
    s += hand(r, 145, y, b.name, `batting.${i}.ref`, { smudge: b.smudge === "name" });
    s += hand(r, 475, y, b.how, b.fielder ? `batting.${i}.fielderRef` : `batting.${i}.howOut`);
    if (b.bowler) s += hand(r, 775, y, b.bowler, `batting.${i}.bowlerRef`);
    s += hand(r, 1020, y, b.runs, `batting.${i}.runs`);
    s += hand(r, 1150, y, b.balls, `batting.${i}.balls`, { smudge: b.smudge === "balls" });
    s += hand(r, 1280, y, b.fours, `batting.${i}.fours`);
    s += hand(r, 1390, y, b.sixes, `batting.${i}.sixes`);
  });
  DNB.forEach((d, j) => {
    const i = BATTING.length + j, y = top + 45 + i * row + 44;
    s += printed(88, y - 6, String(i + 1), 17);
    s += hand(r, 145, y, d.name, `didNotBat.${j}`, { smudge: d.smudge === "name" });
    s += hand(r, 475, y, "did not bat", `didNotBat.${j}.how`, { size: 24 });
  });
  const ey = top + 45 + 11 * row + 44;
  s += printed(145, ey - 6, "EXTRAS", 15);
  s += printed(300, ey - 6, "b", 15) + hand(r, 325, ey, EXTRAS.byes, "extras.byes");
  s += printed(390, ey - 6, "lb", 15) + hand(r, 420, ey, EXTRAS.legByes, "extras.legByes");
  s += printed(485, ey - 6, "w", 15) + hand(r, 510, ey, EXTRAS.wides, "extras.wides");
  s += printed(575, ey - 6, "nb", 15) + hand(r, 605, ey, EXTRAS.noBalls, "extras.noBalls");
  s += printed(670, ey - 6, "p", 15) + hand(r, 695, ey, EXTRAS.penalty, "extras.penalty");
  s += hand(r, 1020, ey, 11, "extras.sum");
  const ty = ey + row;
  s += printed(145, ty - 6, "TOTAL", 17) + hand(r, 1020, ty, TOTAL.total, "total", { size: 34 });
  s += printed(300, ty - 6, "for", 15) + hand(r, 345, ty, TOTAL.wickets, "wickets") + printed(390, ty - 6, "wkts", 15);
  s += printed(480, ty - 6, "overs", 15) + hand(r, 545, ty, TOTAL.overs, "overs");
  return frame("SCHOOL CRICKET SCORE BOOK · BATTING", s);
}

function page2(r) {
  const cols = [[80, "BOWLER"], [470, "OVERS"], [600, "MDNS"], [730, "RUNS"], [860, "WKTS"], [990, "WIDES"], [1120, "NO BALLS"]];
  let s = printed(80, 118, "BOWLING ANALYSIS", 15) + hand(r, 300, 120, "Ferndale High", "team", { size: 30 });
  const top = 150, row = 62;
  s += cols.map(([x, t]) => printed(x, top + 30, t, 15)).join("");
  for (let i = 0; i <= 6; i++) s += `<line class="rule" x1="70" y1="${top + 45 + i * row}" x2="1300" y2="${top + 45 + i * row}"/>`;
  for (const [x] of cols.slice(1)) s += `<line class="rule" x1="${x - 12}" y1="${top + 10}" x2="${x - 12}" y2="${top + 45 + 6 * row}"/>`;
  BOWLING.forEach((b, i) => {
    const y = top + 45 + i * row + 44;
    s += hand(r, 85, y, b.name, `bowling.${i}.ref`);
    s += hand(r, 480, y, b.overs, `bowling.${i}.overs`);
    s += hand(r, 610, y, b.maidens, `bowling.${i}.maidens`);
    s += hand(r, 740, y, b.runs, `bowling.${i}.runs`);
    s += hand(r, 870, y, b.wickets, `bowling.${i}.wickets`);
    s += hand(r, 1000, y, b.wides, `bowling.${i}.wides`);
    s += hand(r, 1130, y, b.noBalls, `bowling.${i}.noBalls`);
  });
  const fy = top + 45 + 6 * row + 80;
  s += printed(80, fy, "FALL OF WICKETS", 15);
  const fx = [80, 300, 520, 740, 960, 1180];
  s += printed(80, fy + 50, "Wkt", 15) + printed(80, fy + 110, "Score", 15) + printed(80, fy + 170, "Bat out", 15) + printed(80, fy + 230, "Over", 15);
  for (let i = 0; i <= 4; i++) s += `<line class="rule" x1="70" y1="${fy + 70 + (i - 1) * 60 + 5}" x2="1400" y2="${fy + 70 + (i - 1) * 60 + 5}"/>`;
  FOW.forEach((w, i) => {
    const x = fx[i + 1] - 40;
    s += hand(r, x, fy + 52, w.wicket, `fallOfWickets.${i}.wicket`);
    s += hand(r, x, fy + 112, w.score, `fallOfWickets.${i}.score`);
    s += hand(r, x, fy + 172, w.name, `fallOfWickets.${i}.ref`, { size: 26 });
    s += hand(r, x, fy + 232, w.over, `fallOfWickets.${i}.over`);
  });
  return frame("SCHOOL CRICKET SCORE BOOK · BOWLING", s);
}

// ── The reader's answer, measured from the drawing ─────────────────────

/** Every tagged entry's box, as fractions of the page. */
async function measure(page) {
  return page.evaluate(() => {
    const root = document.getElementById("page").getBoundingClientRect();
    const out = {};
    for (const el of document.querySelectorAll("[data-cell]")) {
      const b = el.getBoundingClientRect();
      const f = (v) => Math.round(v * 10000) / 10000;
      out[el.getAttribute("data-cell")] = [f((b.left - root.left - 6) / root.width), f((b.top - root.top - 4) / root.height),
                                           f((b.width + 12) / root.width), f((b.height + 8) / root.height)];
    }
    return out;
  });
}

function readerAnswer(boxes1, boxes2) {
  const at = (boxes, page, path, value, confidence = 0.97, note = null) =>
    ({ value, confidence, page: boxes[path] ? page : null, box: boxes[path] ?? null, note });
  const b1 = (path, v, c, n) => at(boxes1, 1, path, v, c, n);
  const b2 = (path, v, c, n) => at(boxes2, 2, path, v, c, n);
  const card = {
    pages: [{ page_no: 1, kind: "batting" }, { page_no: 2, kind: "bowling" }],
    batting: BATTING.map((b, i) => ({
      ref: b1(`batting.${i}.ref`, b.name, 0.95),
      howOut: b1(b.fielder ? `batting.${i}.fielderRef` : `batting.${i}.howOut`, b.howOut, 0.94),
      fielderRef: b.fielder ? b1(`batting.${i}.fielderRef`, b.fielder, 0.9) : { value: null, confidence: 0.95, page: 1, box: null, note: null },
      bowlerRef: b.bowler ? b1(`batting.${i}.bowlerRef`, b.bowler, 0.93) : { value: null, confidence: 0.95, page: 1, box: null, note: null },
      runs: b1(`batting.${i}.runs`, b.runs, 0.98),
      balls: b.smudge === "balls" ? b1(`batting.${i}.balls`, b.balls, 0.55, "smudged: 22 or 27") : b1(`batting.${i}.balls`, b.balls, 0.96),
      fours: b1(`batting.${i}.fours`, b.fours, 0.92),
      sixes: b1(`batting.${i}.sixes`, b.sixes, 0.93),
    })),
    didNotBat: DNB.map((d, j) => (d.smudge === "name"
      ? b1(`didNotBat.${j}`, null, 0.2, "the name is smudged past reading")
      : b1(`didNotBat.${j}`, d.name, 0.9))),
    bowling: BOWLING.map((b, i) => ({
      ref: b2(`bowling.${i}.ref`, b.name, 0.94), overs: b2(`bowling.${i}.overs`, b.overs, 0.97),
      maidens: b2(`bowling.${i}.maidens`, b.maidens, 0.95), runs: b2(`bowling.${i}.runs`, b.runs, 0.97),
      wickets: b2(`bowling.${i}.wickets`, b.wickets, 0.97), wides: b2(`bowling.${i}.wides`, b.wides, i === 3 ? 0.62 : 0.9, i === 3 ? "a 1 or a 7" : null),
      noBalls: b2(`bowling.${i}.noBalls`, b.noBalls, 0.9),
    })),
    extras: Object.fromEntries(Object.entries(EXTRAS).map(([k, v]) => [k, b1(`extras.${k}`, v, k === "legByes" ? 0.7 : 0.95)])),
    total: b1("total", TOTAL.total, 0.98),
    wickets: b1("wickets", TOTAL.wickets, 0.96),
    overs: b1("overs", TOTAL.overs, 0.96),
    fallOfWickets: FOW.map((w, i) => ({
      wicket: b2(`fallOfWickets.${i}.wicket`, w.wicket, 0.97), score: b2(`fallOfWickets.${i}.score`, w.score, 0.95),
      ref: b2(`fallOfWickets.${i}.ref`, w.name, 0.9), over: b2(`fallOfWickets.${i}.over`, w.over, 0.9),
    })),
    endReason: { value: "overs", confidence: 0.85, page: 1, box: boxes1.overs ?? null, note: "20 overs bowled, five wickets down" },
    uncertainties: [
      { path: "batting.3.balls", page: 1, text: "Cele's balls faced are smudged: 22 or 27." },
      { path: "didNotBat.2", page: 1, text: "The tenth name is smudged past reading." },
      { path: "bowling.3.wides", page: 2, text: "Govender's wides: a 1 or a 7." },
    ],
  };
  return {
    id: "msg_synthetic_scorebook_demo",
    type: "message",
    role: "assistant",
    model: "synthetic-fixture",
    content: [{ type: "text", text: JSON.stringify(card) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

const browser = await chromium.launch({ ...launchOptions() });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const boxes = [];
  for (const [n, html] of [[1, page1(rng(1201))], [2, page2(rng(1202))]]) {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    boxes.push(await measure(page));
    writeFileSync(join(HERE, `page-${n}.png`), await page.locator("#page").screenshot({ type: "png" }));
    console.log(`wrote page-${n}.png`);
  }
  writeFileSync(join(HERE, "reader-response.json"), JSON.stringify(readerAnswer(boxes[0], boxes[1]), null, 1) + "\n");
  console.log("wrote reader-response.json");
} finally {
  await browser.close();
}

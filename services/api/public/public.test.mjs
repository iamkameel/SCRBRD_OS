// The signed-out read path (SCRBRD-083 phase 1), without a database:
//
//   1. the projection (redact.mjs): the per-kind allowlist pinned; a log full
//      of reasons, notes, placement, typed names and ids comes out with none
//      of them; pseudonyms stable in a match and different across matches;
//      labels by publicName(); the projected log folds to the same scorecard;
//      db/59's selected payload keys and the allowlist in step; a ball's
//      shot and where it went as words (SCRBRD-139, db/78): the public line
//      the signed-in line, and no coordinate on the wire;
//   2. the router (public-api.mjs) over a fake pool: off unless enabled; one
//      404 for unpublished, unknown and malformed; the same bytes with a staff
//      token; always the anonymous principal; X-Robots-Tag and Cache-Control
//      on every answer; the rate limit; the cache and its invalidation;
//   3. the shell: noindex, the theme boot equal to index.html's.
//
// The same claims against the real database and a real browser are
// tools/smoke-public.mjs and tools/smoke-browser-public.mjs; the SQL is held
// by db/99 section 37 and by packages/policy/test/public.test.mjs.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  inningsStart, batters, bowler, ball, penalty, retire, voidEvent, revision, sealInnings, toRow,
  deriveMatch, BALL_TYPE, inningsSummary, deriveCommentary, placementFromTap, AREA_WORDS,
} from "@scrbrd/scoring";
import { PUBLIC_EVENT_FIELDS, PUBLIC_EVENT_COMMON, projectLog, playerPseudonym, eventPseudonym, nameFor, RETIRED_NOT_OUT, areasOf } from "./redact.mjs";
import {
  publicPages, PublicCache, RateLimit, clientAddress, shellHtml, THEME_BOOT, NOT_FOUND, LIVE_TTL_MS, SETTLED_TTL_MS, RATE,
} from "./public-api.mjs";
import { publicationRoutes } from "../write/publication-api.mjs";
import { signToken } from "../auth/auth.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let passes = 0, fails = 0;
/** @param {string} label @param {unknown} cond @param {unknown} [detail] */
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 400)}`}`);
  if (cond) passes++; else fails++;
};

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const M1 = "77777777-0000-0000-0000-0000000000a1";
/** A published competition (SCRBRD-114 phase 3a). */
const C_PUB = "99999999-0000-0000-0000-0000000000a1";
const M2 = "77777777-0000-0000-0000-0000000000a2";
const ON = "2026-09-28";

// ── The people ──────────────────────────────────────────────────
const P = {
  erasmus: "aaaaaaaa-0000-0000-0000-00000000e001",  // consented, published: named
  marked:  "aaaaaaaa-0000-0000-0000-00000000e002",  // consented, but never-public
  nobody:  "aaaaaaaa-0000-0000-0000-00000000e003",  // nothing recorded
  off:     "aaaaaaaa-0000-0000-0000-00000000e004",  // consented, names off for his age group
  unpub:   "aaaaaaaa-0000-0000-0000-00000000e005",  // consented, his side not published
  bare:    "aaaaaaaa-0000-0000-0000-00000000e006",  // facts missing altogether
  bowl1:   "aaaaaaaa-0000-0000-0000-00000000e007",  // the other side, consented, published
  bowl2:   "aaaaaaaa-0000-0000-0000-00000000e008",  // the other side, nothing recorded
};
const consented = [{ by: "guardian", competent: true, givenOn: "2026-01-10", endedOn: null }];
/** @type {Record<string, [string, string | null, string | null, any, boolean]>} full name, surname, known-as, facts, published */
const WHO = {
  [P.erasmus]: ["Daniel Johannes Erasmus", "Erasmus", null, { consents: consented, neverPublic: false, namesOff: false }, true],
  [P.marked]:  ["Pieter Markedly", null, null, { consents: consented, neverPublic: true, namesOff: false }, true],
  [P.nobody]:  ["Sipho Nobodyson", null, null, { consents: [], neverPublic: false, namesOff: false }, true],
  [P.off]:     ["Thabo Offington", null, "Tebza", { consents: consented, neverPublic: false, namesOff: true }, true],
  [P.unpub]:   ["Kyle Unpublishedsmith", null, null, { consents: consented, neverPublic: false, namesOff: false }, false],
  [P.bare]:    ["Liam Barefacts", null, null, {}, true],
  [P.bowl1]:   ["Ruan van der Bowlmerwe", null, null, { consents: consented, neverPublic: false, namesOff: false }, true],
  [P.bowl2]:   ["Musa Quietbowler", null, null, { consents: [], neverPublic: false, namesOff: false }, true],
};
/** public_match_people()'s rows. */
const PEOPLE = Object.entries(WHO).map(([id, [full, sur, known, facts, pub]]) => ({
  player_id: id, school_published: pub, facts, full_name: full, surname: sur, known_as: known, served_on: ON }));
const TYPED = "Warren Typedfielder";
/** Every name part that must never appear unless publicName() said so. */
const NAME_PARTS = ["Daniel", "Johannes", "Pieter", "Markedly", "Sipho", "Nobodyson", "Thabo", "Offington", "Tebza", "Kyle",
  "Unpublishedsmith", "Liam", "Barefacts", "Ruan", "Musa", "Quietbowler", "Warren", "Typedfielder"];

// ── A log with everything a public page must not carry ─────────
const DEVICE = "pad-device-4f2a9c";
let n = 0;
const at = (/** @type {any} */ ev, innings = 0) => ({ ...ev, innings, id: `${DEVICE}:${M1}:${++n}`, clientTs: Date.parse("2026-09-26T08:00:00Z") + n * 30000 });
const squad = [P.erasmus, P.marked, P.nobody, P.off, P.unpub, P.bare].map((id, i) => ({ id, name: WHO[id][0], batting_style: i % 2 ? "Left-hand bat" : "Right-hand bat" }));
const attack = [{ id: P.bowl1, name: WHO[P.bowl1][0] }, { id: P.bowl2, name: WHO[P.bowl2][0] }, { id: TYPED, name: TYPED }];
/** @type {any[]} */
const LOG = [
  at({ ...inningsStart({ battingTeam: "1XI", bowlingTeam: "Westville Boys' High 1XI", squad, bowlingSquad: attack, overs: 10, twelfthMan: "Twelfth Mansfield", captureProfile: "full" }) }),
  at(batters({ striker: P.erasmus, nonStriker: P.marked })),
  at(bowler({ bowler: P.bowl1 })),
  at(ball({ type: BALL_TYPE.RUN, value: 4, striker: P.erasmus, nonStriker: P.marked, bowler: P.bowl1, shot: "cover_drive", theta: 270, radius: 1, placementSource: "point", seg: 9, zone: "boundary", contact: "middled", trajectory: "ground" })),
  at(ball({ type: BALL_TYPE.RUN, value: 1, striker: P.erasmus, nonStriker: P.marked, bowler: P.bowl1 })),
  at(ball({ type: BALL_TYPE.WICKET, value: 0, striker: P.marked, nonStriker: P.erasmus, bowler: P.bowl1, dismissal: "caught", fielder: TYPED })),
  at(batters({ striker: P.nobody })),
  at(ball({ type: BALL_TYPE.RUN, value: 2, striker: P.nobody, nonStriker: P.erasmus, bowler: P.bowl1 })),
  at(ball({ type: BALL_TYPE.WIDE, value: 0, striker: P.nobody, nonStriker: P.erasmus, bowler: P.bowl1 })),
  at(ball({ type: BALL_TYPE.RUN, value: 0, striker: P.nobody, nonStriker: P.erasmus, bowler: P.bowl1 })),
  at(ball({ type: BALL_TYPE.RUN, value: 1, striker: P.nobody, nonStriker: P.erasmus, bowler: P.bowl1 })),
  // a bowler change mid-over, for an injury (N2)
  at(bowler({ bowler: P.bowl2, reason: "injury" })),
  at(ball({ type: BALL_TYPE.RUN, value: 1, striker: P.erasmus, nonStriker: P.nobody, bowler: P.bowl2 })),
  at(retire({ batter: P.erasmus, reason: "hurt" })),                    // N2: never says "hurt"
  at(batters({ striker: P.off })),
  at(ball({ type: BALL_TYPE.RUN, value: 6, striker: P.off, nonStriker: P.nobody, bowler: P.bowl2 })),
  at(penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" })),
  at(ball({ type: BALL_TYPE.RUN, value: 3, striker: P.off, nonStriker: P.nobody, bowler: P.bowl2 })),
  at(retire({ batter: P.nobody, reason: "out" })),                      // retired out: a dismissal
  at(batters({ nonStriker: P.unpub })),
  at(ball({ type: BALL_TYPE.RUN, value: 1, striker: P.off, nonStriker: P.unpub, bowler: TYPED })),
  at(revision({ overs: 8, reason: "rain" })),
  at(ball({ type: BALL_TYPE.RUN, value: 1, striker: P.unpub, nonStriker: P.off, bowler: TYPED })),
];
const undone = LOG[LOG.length - 1];
LOG.push(at(voidEvent({ target: undone.id, reason: "scorer: wrong batter, P Markedly's dad complained" })));
// A kind nobody listed, and one that is a conduct matter about one boy.
LOG.push({ kind: "bowler_suspended", innings: 0, id: `${DEVICE}:${M1}:${++n}`, clientTs: 0, bowler: P.bowl2, reason: "dangerous_bowling", scope: "innings" });
LOG.push({ kind: "note", innings: 0, id: `${DEVICE}:${M1}:${++n}`, clientTs: 0, text: "Sipho Nobodyson limping" });
const sealed = deriveMatch(LOG.filter((e) => e.kind !== "bowler_suspended" && e.kind !== "note"), {}).innings[0];
LOG.push(at({ ...sealInnings(sealed, "overs_complete") }));

/**
 * The SELECT public_match_log() makes: the typed columns, and from the
 * payload only the keys db/59 names — read out of db/59 itself, so a key
 * added there and not here (or here and not there) is a failure below.
 */
// The definition that runs: the last file that makes it (db/59's, then
// db/63's, which serves an innings_summary's card, SCRBRD-120; then db/71's,
// which serves a super over's marker, SCRBRD-114 phase 3b).
const LOG_FILE = readdirSync(join(ROOT, "db")).filter((f) => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort()
  .filter((f) => readFileSync(join(ROOT, "db", f), "utf8").includes("CREATE OR REPLACE FUNCTION public_match_log")).pop() ?? "";
const SQL = readFileSync(join(ROOT, "db", LOG_FILE), "utf8");
const logBody = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public_match_log"), SQL.indexOf("REVOKE ALL ON FUNCTION public_match_log"));
const DETAIL_KEYS = [
  ...[...logBody.matchAll(/'(\w+)',\s+b\.payload -> '(\w+)'/g)].map((m) => { if (m[1] !== m[2]) throw new Error(`${LOG_FILE} renames ${m[2]}`); return m[1]; }),
  // A key served for one kind only: 'card', CASE WHEN b.kind = '…' THEN (b.payload -> 'card') …
  ...[...logBody.matchAll(/'(\w+)',\s+CASE WHEN b\.kind = '\w+' THEN \(b\.payload -> '(\w+)'\)/g)]
    .map((m) => { if (m[1] !== m[2]) throw new Error(`${LOG_FILE} renames ${m[2]}`); return m[1]; }),
  // A ball's key as fromRow() reads it, the payload's else the column's (db/78): 'shot'
  ...[...logBody.matchAll(/'(\w+)',\s+CASE WHEN b\.kind = 'ball' THEN coalesce\(b\.payload -> '(\w+)', to_jsonb\(b\.\w+\)\)/g)]
    .map((m) => { if (m[1] !== m[2]) throw new Error(`${LOG_FILE} renames ${m[2]}`); return m[1]; }),
];
/**
 * db/78's `place`: what the words for where a ball went are made from, by
 * the API, which then drops it. Its four keys, read out of the file.
 */
const PLACE_BODY = logBody.match(/'place',\s+CASE WHEN b\.kind = 'ball' THEN ([\s\S]*?) END,/)?.[1] ?? "";
const PLACE_KEYS = [...PLACE_BODY.matchAll(/'(\w+)',\s+coalesce\(/g)].map((m) => m[1]);
/** The fields the API makes and the SQL does not select: the word for where a ball went. */
const MADE_HERE = new Set(["area"]);
/** @param {any} ev @param {number} seq */
const asLogRow = (ev, seq) => {
  const row = toRow(ev);
  // Each key as db/78 reads it: the payload's, else the column's.
  const from = (/** @type {string} */ k) => row.payload[k] ?? row[k];
  const detail = Object.fromEntries(DETAIL_KEYS.filter((k) => from(k) !== undefined && from(k) !== null).map((k) => [k, from(k)]));
  if (ev.kind === "ball") {
    const place = Object.fromEntries(/** @type {[string, any][]} */ ([["theta", row.theta], ["radius", row.radius], ["seg", row.seg],
      ["source", row.placement_source]]).filter(([, x]) => x != null));
    if (Object.keys(place).length) detail.place = place;
  }
  return {
    seq, innings: ev.innings ?? 0, kind: ev.kind, ball_type: row.ball_type ?? null, value: row.value ?? null,
    striker_id: row.striker_id, non_striker_id: row.non_striker_id, bowler_id: row.bowler_id, dismissed_id: row.dismissed_id,
    dismissal: row.dismissal ?? null, event_key: ev.id, client_ts: new Date(ev.clientTs).toISOString(), detail,
  };
};
const KINDS_SQL = (logBody.match(/b\.kind IN \(([^)]*)\)/)?.[1] ?? "").match(/'(\w+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
const ROWS = LOG.filter((e) => KINDS_SQL.includes(e.kind)).map((e, i) => asLogRow(e, i + 1));

// ═════════════════════════════════════════════════════════════════
console.log("\n── The allowlist, pinned ──");
ok("PUBLIC_EVENT_FIELDS is exactly the reviewed list", JSON.stringify(PUBLIC_EVENT_FIELDS) === JSON.stringify({
  innings_start: ["battingTeam", "bowlingTeam", "teamKey", "bowlingTeamKey", "squad", "bowlingSquad", "overs", "target", "superOver"],
  batters: ["striker", "nonStriker", "captainConsent"],
  bowler: ["bowler"],
  ball: ["type", "value", "striker", "nonStriker", "bowler", "dismissal", "fielder", "dismissed", "freeHit", "nbRuns", "nbType", "outAt", "facesNext", "notInOver",
         // SCRBRD-139 (db/78): the shot, and where it went as a word
         "shot", "area"],
  penalty: ["runs", "toBattingTeam", "reason"],
  retire: ["batter", "reason", "type", "dismissal"],
  innings_end: ["reason", "confirmed"],
  revision: ["overs", "target", "reason", "par"],
  void: ["target"],
  innings_summary: ["card"],
  // SCRBRD-130 R1 (db/73): rain — the reason code and the time, never the note.
  play_stopped: ["reason", "at"],
  play_resumed: ["at"],
}), PUBLIC_EVENT_FIELDS);
ok("db/59 returns exactly the kinds the allowlist lists", JSON.stringify([...KINDS_SQL].sort()) === JSON.stringify(Object.keys(PUBLIC_EVENT_FIELDS).sort()), KINDS_SQL);
const COLUMN_FIELDS = new Set(["type", "value", "dismissal", "striker", "nonStriker", "bowler", "dismissed"]);
const payloadFields = new Set(Object.values(PUBLIC_EVENT_FIELDS).flat().filter((f) => !["type", "value", "dismissal"].includes(f)));
ok("every payload key db/59 selects is a field some kind may keep", DETAIL_KEYS.every((k) => payloadFields.has(k)),
   DETAIL_KEYS.filter((k) => !payloadFields.has(k)));
ok("every field the allowlist keeps is a column, a key db/59 selects, or the word made here",
   [...new Set(Object.values(PUBLIC_EVENT_FIELDS).flat())].every((f) => COLUMN_FIELDS.has(f) || DETAIL_KEYS.includes(f) || MADE_HERE.has(f)),
   [...new Set(Object.values(PUBLIC_EVENT_FIELDS).flat())].filter((f) => !COLUMN_FIELDS.has(f) && !DETAIL_KEYS.includes(f) && !MADE_HERE.has(f)));
ok("db/78's `place` is exactly the four fields the words read, and no kind keeps it",
   JSON.stringify(PLACE_KEYS) === JSON.stringify(["theta", "radius", "seg", "source"])
   && Object.values(PUBLIC_EVENT_FIELDS).every((fs) => !fs.includes("place")), PLACE_KEYS);
ok("db/78 never selects a placement field the words do not read",
   !/b\.(zone|contact|trajectory|close_position|placement_null|capture_profile)\b|'(zone|contact|trajectory|closePosition|placementNull|captureProfile|bowlerApproach)'/.test(logBody));
ok("db/59 never selects the payload whole", !/b\.payload(?!\s*(->|->>|#>>))/.test(logBody));

console.log("\n── The projection ──");
const out = projectLog({ rows: ROWS, people: PEOPLE, secret: SECRET, matchId: M1, on: ON });
const wire = JSON.stringify({ events: out.events, people: out.people, last: out.last });
const leaks = (/** @type {string} */ s) => [
  ...Object.values(P).filter((id) => s.toLowerCase().includes(id.toLowerCase())),
  ...NAME_PARTS.filter((w) => s.includes(w)),
  ...["hurt", "injur", "suspend", "unavail", "limping", "complained", "dangerous", "Twelfth", "Mansfield",
      "cover_drive", "theta", "radius", "placement", "middled", "trajectory", "zone", "seg\"", "capture", DEVICE,
      "born", "dob", "photo", "avatar", "image", "age\""].filter((w) => s.toLowerCase().includes(w.toLowerCase())),
];
ok("no player id, no unconsented name part, no reason, no placement, no device in the projected log", leaks(wire).length === 0, leaks(wire));
ok("the consenting boy on a published side is 'D Erasmus'", wire.includes("\"D Erasmus\""));
ok("...and the consenting boy on the other side is 'R van der Bowlmerwe'", wire.includes("\"R van der Bowlmerwe\""));
const pE = playerPseudonym(SECRET, M1, P.erasmus);
ok("people names exactly the two named boys", JSON.stringify(Object.values(out.people).sort()) === JSON.stringify(["D Erasmus", "R van der Bowlmerwe"]), out.people);
ok("...under their pseudonyms", out.people[pE] === "D Erasmus");
const start = /** @type {any} */ (out.events.find((e) => e.kind === "innings_start"));
ok("the batting squad: named, then five 'Batter' (marked, nothing, names off, unpublished, no facts)",
   JSON.stringify(start.squad.map((/** @type {any} */ m) => m.label)) === JSON.stringify(["D Erasmus", "Batter", "Batter", "Batter", "Batter", "Batter"]), start.squad);
ok("the fielding squad: named, then 'Bowler' for the unconsented and the typed", JSON.stringify(start.bowlingSquad.map((/** @type {any} */ m) => m.label)) === JSON.stringify(["R van der Bowlmerwe", "Bowler", "Bowler"]), start.bowlingSquad);
ok("a squad member is {id, label, batHand} and nothing else", start.squad.every((/** @type {any} */ m) => Object.keys(m).every((k) => ["id", "label", "batHand"].includes(k))) && start.squad[1].batHand === "L" && start.squad[0].batHand === "R");
ok("every id is a 12-hex pseudonym", [...start.squad, ...start.bowlingSquad].every((/** @type {any} */ m) => /^[0-9a-f]{12}$/.test(m.id)));
ok("the innings_start keeps no twelfth man and no capture profile", !("twelfthMan" in start) && !("captureProfile" in start));
ok("every event carries only its kind's fields and the common five", out.events.every((e) =>
  Object.keys(e).every((k) => PUBLIC_EVENT_COMMON.includes(k) || PUBLIC_EVENT_FIELDS[e.kind].includes(k))));
ok("bowler_suspended and an unknown kind are dropped whole", !out.events.some((e) => e.kind === "bowler_suspended" || e.kind === "note"));
const change = out.events.filter((e) => e.kind === "bowler")[1];
ok("a mid-over bowler change keeps no reason", change && !("reason" in change));
const retires = out.events.filter((e) => e.kind === "retire");
ok(`retired hurt reads '${RETIRED_NOT_OUT}', retired out keeps 'out' and its wicket`, retires[0]?.reason === RETIRED_NOT_OUT && retires[1]?.reason === "out" && retires[1]?.type === "W" && retires[1]?.dismissal === "retired_out", retires);
ok("a penalty keeps its code", out.events.find((e) => e.kind === "penalty")?.reason === "helmet_struck");
ok("a revision keeps 'rain'", out.events.find((e) => e.kind === "revision")?.reason === "rain");
const w = out.events.find((e) => e.kind === "ball" && e.dismissal === "caught");
ok("the typed fielder is a pseudonym, and not named anywhere", w?.fielder === playerPseudonym(SECRET, M1, TYPED) && !(w.fielder in out.people));
const v = out.events.find((e) => e.kind === "void");
ok("a void keeps its target, pseudonymised as its target's id, and no reason", v && v.target === eventPseudonym(SECRET, M1, undone.id) && !("reason" in v)
   && out.events.some((e) => e.id === v.target));
ok("the real player ids behind it are kept for the cache, never on the wire", out.playerIds.has(P.erasmus) && !wire.includes(P.erasmus));

// An innings from a paper scorebook (SCRBRD-120): the card, its refs as
// pseudonyms, a typed opposition name nowhere, no source, no note.
{
  const card = {
    v: 1, innings: 1, battingSide: "away",
    batting: [{ order: 1, ref: "t:1", howOut: "caught", fielderRef: P.erasmus, bowlerRef: P.bowl1, runs: 20, balls: null, fours: 2, sixes: 0, name: "Warren Typedfielder" }],
    didNotBat: ["t:2"],
    bowling: [{ ref: P.bowl1, overs: "3.4", maidens: null, runs: 21, wickets: 1, wides: 1, noBalls: 0 }],
    extras: { byes: null, legByes: 0, wides: 1, noBalls: 0, penalty: 0 },
    total: 22, wickets: 1, overs: "3.4",
    fallOfWickets: [{ wicket: 1, score: 22, ref: "t:1", over: "3.4" }],
    endReason: "other", unreconciled: { runs: 1, note: "Pieter Markedly's dad kept the book" },
  };
  const ev = inningsSummary({ innings: 1, card: /** @type {any} */ (card), id: `scorebook:x:1:summary`, clientTs: 0,
                              typed: { "t:1": "Warren Typedfielder", "t:2": "Musa Quietbowler" },
                              source: { kind: "scorebook", import: "x", checkedBy: P.nobody, confirmedBy: P.marked } });
  const row = asLogRow(ev, 1);
  ok("db/63 serves the summary's card and nothing else of its payload", JSON.stringify(Object.keys(row.detail)) === JSON.stringify(["card"]), row.detail);
  const proj = projectLog({ rows: [row], people: PEOPLE, secret: SECRET, matchId: M1, on: ON });
  const s = /** @type {any} */ (proj.events[0]);
  const sWire = JSON.stringify({ events: proj.events, people: proj.people });
  ok("the summary reaches the page, as its card", s?.kind === "innings_summary" && s.card?.total === 22 && s.card?.overs === "3.4");
  ok("no typed name, no player id, no note, no source on the wire", leaks(sWire).length === 0 && !sWire.includes("kept the book")
     && !/checkedBy|confirmedBy|source|typed/.test(sWire), leaks(sWire));
  ok("a typed key is a pseudonym naming nobody", s.card.batting[0].ref === playerPseudonym(SECRET, M1, "t:1") && !(s.card.batting[0].ref in proj.people));
  ok("our consenting boy is his pseudonym, and named in people", s.card.batting[0].fielderRef === pE && proj.people[pE] === "D Erasmus");
  ok("a figure the book does not give stays null", s.card.batting[0].balls === null && s.card.extras.byes === null && s.card.bowling[0].maidens === null);
  ok("a stray field on a row is not copied", !("name" in s.card.batting[0]));
  ok("the recorded difference keeps its runs alone", JSON.stringify(s.card.unreconciled) === JSON.stringify({ runs: 1 }));
}

// Checks on odd values each field refuses.
const odd = projectLog({ secret: SECRET, matchId: M1, on: ON, people: [], rows: /** @type {any[]} */ ([
  { ...ROWS[3], seq: 1, dismissal: "c Smith b Jones", ball_type: "Wd; drop table", value: /** @type {any} */ ("4") },
  { ...ROWS.find((r) => r.kind === "penalty"), seq: 2, detail: { runs: 5, toBattingTeam: true, reason: "Coach Smith swore at the umpire" } },
  { ...ROWS.find((r) => r.kind === "revision"), seq: 3, detail: { overs: 8, reason: "Dave's boy got hit" } },
  { ...ROWS.find((r) => r.kind === "innings_end"), seq: 4, detail: { reason: "Tired", confirmed: { runs: 50, wickets: "x", balls: 60, note: "n" } } },
]) });
const o = odd.events;
// A super over's marker (db/71): a whole number from 1, or nothing.
const sos = projectLog({ secret: SECRET, matchId: M1, on: ON, people: [], rows: /** @type {any[]} */ ([
  { ...ROWS.find((r) => r.kind === "innings_start"), seq: 1, innings: 2, detail: { battingTeam: "Hilton", superOver: 1 } },
  { ...ROWS.find((r) => r.kind === "innings_start"), seq: 2, innings: 3, detail: { battingTeam: "Hilton", superOver: "1 or more" } },
  { ...ROWS.find((r) => r.kind === "innings_start"), seq: 3, innings: 4, detail: { battingTeam: "Hilton", superOver: 1.5 } },
]) }).events;
ok("a super over's marker is kept as its number, and anything else is dropped",
   sos[0].superOver === 1 && !("superOver" in sos[1]) && !("superOver" in sos[2]), sos);
ok("a free-text dismissal, a bad ball type and a string value are dropped", !("dismissal" in o[0]) && !("type" in o[0]) && !("value" in o[0]), o[0]);
ok("a free-text penalty reason becomes null", o[1].reason === null);
ok("a revision reason off the sheet's list is dropped", !("reason" in o[2]));
ok("an innings end keeps only a code and three numbers", o[3].reason === null && JSON.stringify(o[3].confirmed) === JSON.stringify({ runs: 50, wickets: null, balls: 60 }));

console.log("\n── The shot and where it went (SCRBRD-139, db/78) ──");
{
  // The fixture's four went to deep point off an id the commentary has no
  // words for (cover_drive): the place is a word, the id is dropped.
  const four = /** @type {any} */ (out.events.find((e) => e.kind === "ball" && e.value === 4));
  ok("a ball's place reaches the page as the word its line says", four?.area === "deep point" && !("shot" in four), four);
  ok("...and nothing it was made from: no theta, radius, seg, zone, source or place",
     out.events.every((e) => ["theta", "radius", "seg", "zone", "placementSource", "placement", "place", "closePosition", "captureProfile",
                              "contact", "trajectory", "bowlerApproach"].every((k) => !(k in e))));
  // A log of every kind of ball, through the whole path: rows as db/78 hands
  // them over, the projection, and the page's own generator over the result.
  const hands = [
    { id: P.erasmus, name: WHO[P.erasmus][0], batting_style: "Right-hand bat" },
    { id: P.marked, name: WHO[P.marked][0], batting_style: "Left-hand bat" },
    { id: P.nobody, name: WHO[P.nobody][0], batting_style: "Right-hand bat" },
  ];
  let k = 0;
  const T = (/** @type {any} */ ev) => ({ ...ev, innings: 0, id: `${DEVICE}:${M2}:${++k}`, clientTs: Date.parse("2026-09-26T08:00:00Z") + k * 30000 });
  const tap = (/** @type {number} */ angle, /** @type {number} */ radius, hand = "R") => placementFromTap({ angle, radius, batHand: hand });
  const LOG2 = [
    T(inningsStart({ battingTeam: "1XI", bowlingTeam: "Westville Boys' High 1XI", squad: hands, bowlingSquad: attack, overs: 5 })),
    T(batters({ striker: P.erasmus, nonStriker: P.marked })),
    T(bowler({ bowler: P.bowl1 })),
    T(ball({ type: BALL_TYPE.RUN, value: 4, shot: "drive", ...tap(235, 0.35), contact: "middle", trajectory: "ground" })),
    T(ball({ type: BALL_TYPE.RUN, value: 1, shot: "cut", ...tap(265, 0.35) })),
    // the left-hander's sector-era tap at the screen's 90°: HIS point, which
    // only the fold knows (it is his strike now)
    T(ball({ type: BALL_TYPE.RUN, value: 4, shot: "drive", seg: 3, zone: "boundary", placementSource: "sector" })),
    T(ball({ type: BALL_TYPE.RUN, value: 0 })),
    T(ball({ type: BALL_TYPE.LEG_BYE, value: 1, shot: "padded", ...tap(30, 0.7) })),
    T(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: TYPED, shot: "outside_edge", ...tap(348, 0.06) })),
    T(batters({ striker: P.nobody })),
    T(ball({ type: BALL_TYPE.RUN, value: 6, shot: "loft", ...tap(170, 1) })),
  ];
  const rows2 = LOG2.map((e, i) => asLogRow(e, i + 1));
  ok("the rows carry the shot and `place`, as db/78 builds them", rows2[3].detail.shot === "drive"
     && JSON.stringify(rows2[3].detail.place) === JSON.stringify({ theta: 235, radius: 0.35, seg: 8, source: "point" })
     && !("place" in rows2[6].detail) && !("shot" in rows2[6].detail), rows2[3].detail);
  const proj = projectLog({ rows: rows2, people: PEOPLE, secret: SECRET, matchId: M2, on: ON });
  const wire2 = JSON.stringify({ events: proj.events, people: proj.people });
  ok("no coordinate, no place, no contact on the wire", !/theta|radius|"seg"|zone|placement|"place"|contact|trajectory|"source"/.test(wire2), wire2.match(/theta|radius|"seg"|zone|placement|"place"|contact|trajectory|"source"/g));
  ok("every area is one of AREA_WORDS", proj.events.every((e) => !("area" in e) || AREA_WORDS.has(e.area)));
  // The page names by `people` (pseudonym → name); the signed-in reader, for
  // the comparison, by the same rule over the real ids.
  const realName = new Map(Object.entries(proj.people).map(([pseudo, name]) => [Object.values(P).find((id) => playerPseudonym(SECRET, M2, id) === pseudo), name]));
  // The same ball is the same event: a line's choice of words is seeded by the
  // event's id, which the page holds as its pseudonym.
  const sameIds = LOG2.map((e) => ({ ...e, id: eventPseudonym(SECRET, M2, e.id) }));
  const signedIn = deriveCommentary(sameIds, { nameOf: (ref) => realName.get(ref) ?? null }).map((x) => x.text);
  const page = deriveCommentary(/** @type {any[]} */ (proj.events), { nameOf: (ref) => proj.people[ref] ?? null }).map((x) => x.text);
  ok("the public line is the signed-in line, for every line of the log", JSON.stringify(page) === JSON.stringify(signedIn),
     page.map((t, i) => (t === signedIn[i] ? null : `${t} ≠ ${signedIn[i]}`)).filter(Boolean).join(" | "));
  const said = page.join("\n");
  ok("...and names the shot and where it went: 'driven through cover for four'", /D Erasmus, driven through cover for four\./.test(said), said);
  ok("...the left-hander's sector tap through his own point, unnamed (never-public)", /to the striker, driven through point for four\./.test(said), said);
  ok("...a catch at first slip by a typed fielder, who is a role word", /off the outside edge and caught by a fielder at first slip/.test(said), said);
  ok("...lofted over long on for six by a boy with nothing recorded, unnamed", /to the striker, lofted over long on for six\./.test(said), said);
  ok("...and a ball with nothing recorded says only the outcome", page.some((t) => /^R van der Bowlmerwe to the striker, (no run|dot ball)\.$/.test(t)), said);
  ok("no name the rule did not give, nothing else that must not be said", leaks(said).length === 0, leaks(said));
  // A log the fold cannot read gives no words, and no error.
  ok("a log the fold cannot read gives no words, never an error",
     areasOf(/** @type {any[]} */ ([{ ...rows2[3], detail: { ...rows2[3].detail, squad: 7 } }, { seq: 2, kind: "ball", detail: null }])).every((x) => x === null || typeof x === "string"));
}

console.log("\n── Pseudonyms ──");
const again = projectLog({ rows: ROWS, people: PEOPLE, secret: SECRET, matchId: M1, on: ON });
ok("stable within a match: the same log projects to the same bytes", JSON.stringify(again.events) === JSON.stringify(out.events));
const other = projectLog({ rows: ROWS, people: PEOPLE, secret: SECRET, matchId: M2, on: ON });
const idsOf = (/** @type {any[]} */ evs) => new Set(evs.flatMap((e) => [e.striker, e.bowler, e.fielder, ...(e.squad ?? []).map((/** @type {any} */ m) => m.id)]).filter(Boolean));
const shared = [...idsOf(out.events)].filter((id) => idsOf(other.events).has(id));
ok("different in another match: no pseudonym is shared between two matches", shared.length === 0, shared);
ok("different under another secret", playerPseudonym("another-secret-of-thirty-two-chars!!", M1, P.erasmus) !== pE);
ok("a typed name gets one too, and two typed names two", playerPseudonym(SECRET, M1, "A Smith") !== playerPseudonym(SECRET, M1, "B Smith"));
ok("a pseudonym needs the secret", (() => { try { playerPseudonym("", M1, P.erasmus); return false; } catch { return true; } })());

console.log("\n── The same fold ──");
// Folding the projected log (labels as names, as the public page does) gives
// the scorecard the signed-in fold gives: every figure, only the names differ.
const pub = /** @type {any[]} */ (out.events.map((e) => (e.kind === "innings_start"
  ? { ...e, squad: e.squad.map((/** @type {any} */ m) => ({ id: m.id, name: m.label })), bowlingSquad: e.bowlingSquad.map((/** @type {any} */ m) => ({ id: m.id, name: m.label })) } : e)));
const a = deriveMatch(LOG, {}).innings[0], b = deriveMatch(pub, {}).innings[0];
const figs = (/** @type {any} */ inn) => JSON.stringify([inn.runs, inn.wickets, inn.balls, inn.extras, inn.batsmen.map((/** @type {any} */ x) => [x.runs, x.balls, x.fours, x.sixes, x.status]), inn.bowlers.map((/** @type {any} */ x) => [x.balls, x.runs, x.wickets, x.maidens]), inn.fow.map((/** @type {any} */ f) => [f.runs, f.wickets, f.overs])]);
ok("the public fold's figures are the signed-in fold's", figs(a) === figs(b), `${figs(a)}\n    ${figs(b)}`);
ok("...and it has a wicket, a retirement and the void applied", a.wickets >= 2 && b.batsmen.some((x) => x.status === "retired"));

console.log("\n── nameFor() fails closed ──");
ok("no row: a position", nameFor(undefined, ON) === null);
ok("facts missing: a position", nameFor({ ...PEOPLE[5] }, ON) === null);
ok("unpublished side: a position", nameFor(PEOPLE[4], ON) === null);
ok("consented and published: named", nameFor(PEOPLE[0], ON) === "D Erasmus");
ok("a known-as gives the initial, never the known-as", nameFor({ ...PEOPLE[3], facts: { ...PEOPLE[3].facts, namesOff: false } }, ON) === "T Offington");

// ═════════════════════════════════════════════════════════════════
console.log("\n── The router, over a fake database ──");
/**
 * A pool whose one client answers db/59's four reads for two fixtures:
 * M1 published, M2 not (the header answers nothing, as db/59 does). It
 * records every app.user_id set, and counts reads.
 */
const seen = { users: /** @type {string[]} */ ([]), reads: 0, status: "complete", alsoServed: new Set(), awayOnly: new Set() };
const fakePool = {
  query: async () => ({ rows: [] }),
  connect: async () => ({
    release() {},
    /** @param {string} text @param {any[]} [params] */
    async query(text, params = []) {
      if (/set_config\('app\.user_id'/.test(text)) { seen.users.push(params[0]); return { rows: [] }; }
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text) || /set_config/.test(text)) return { rows: [] };
      const served = params[0] === M1 || seen.alsoServed.has(params[0]);
      seen.reads++;
      if (/public_match_header/.test(text)) return { rows: served ? [{
        home_label: "Hilton College 1XI", home_code: "HIL", home_team: "1XI", away_label: "Westville Boys' High 1XI", away_code: "WES",
        away_team: "1XI", away_on_platform: true, sport: "cricket", format: "T10", overs: 10, starts_at: "2026-09-26T08:00:00Z",
        ground: "Gordon Sherwood Oval", status: seen.status, toss_won_by: "home", toss_decision: "bat", home_published: !seen.awayOnly.has(params[0]),
        away_published: true, scores: [{ innings: 0, runs: 25, wickets: 2, balls: 12 }], served_on: ON }] : [] };
      // The match's frozen playing conditions (SCRBRD-114, db/61): this one has none.
      if (/public_match_conditions/.test(text)) return { rows: [] };
      // The result (SCRBRD-114 phase 3a, db/69), as structure, and a published competition's table.
      if (/public_match_result/.test(text)) return { rows: served ? [{ outcome: "home_win", margin_kind: "runs", margin: 12, decided_by: "play",
        winner_side: "home", play_outcome: "home_win", play_winner_side: "home", play_margin_kind: "runs", play_margin: 12,
        decision_applied: false, decision_kind: null, decision_side: null, decision_overrides_play: null }] : [] };
      if (/public_competition_standing/.test(text)) return { rows: params[0] === C_PUB ? [
        { rank: 1, division: null, side: "Hilton College 1XI", played: 2, won: 2, lost: 0, tied: 0, drawn: 0, no_result: 0, points: "8", nrr: "1.250", basis: "computed" },
        { rank: 2, division: null, side: "Westville Boys' High 1XI", played: 2, won: 0, lost: 2, tied: 0, drawn: 0, no_result: 0, points: "0", nrr: "-1.250", basis: "computed" },
      ] : [] };
      if (/public_match_people/.test(text)) return { rows: served ? PEOPLE : [] };
      if (/public_match_log/.test(text)) return { rows: served ? ROWS : [] };
      if (/public_shot_sectors/.test(text)) return { rows: served ? [{ innings: 0, sector: 9, shots: 1, runs: 4 }] : [] };
      throw new Error(`unexpected query ${text}`);
    },
  }),
};
let clock = 1_000_000;
/** @param {Partial<import("./public-api.mjs").PublicOptions>} o */
async function serve(o) {
  const site = publicPages({ pool: /** @type {any} */ (fakePool), enabled: true, secret: SECRET, trustProxyHops: 1, now: () => clock, ...o });
  const srv = createServer(async (req, res) => { if (!(await site.handle(req, res))) { res.writeHead(599); res.end("not public"); } });
  await new Promise((r) => srv.listen(0, "127.0.0.1", () => r(null)));
  const port = /** @type {any} */ (srv.address()).port;
  /** @param {string} path @param {{ip?: string, token?: string, method?: string}} [x] */
  const get = async (path, { ip = "203.0.113.1", token, method = "GET" } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "x-forwarded-for": `198.51.100.9, ${ip}`, ...(token ? { authorization: token } : {}) } });
    const headers = Object.fromEntries([...r.headers].filter(([k]) => !["date", "connection", "keep-alive"].includes(k)));
    return { status: r.status, headers, body: await r.text() };
  };
  return { site, get, close: () => new Promise((r) => { site.close(); srv.close(() => r(null)); }) };
}

{
  const off = await serve({ enabled: false, secret: null });
  const r = await off.get(`/api/public/matches/${M1}`);
  const s = await off.get(`/live/${M1}`);
  ok("off (the default): a published fixture's read is the one 404", r.status === 404 && r.body === NOT_FOUND);
  ok("off: its shell is a 404 too", s.status === 404 && /not available/.test(s.body));
  ok("off: nothing was read", seen.reads === 0);
  ok("a path that is not public is not answered", (await off.get("/api/health")).status === 599);
  await off.close();
}
ok("on without a secret refuses to start", (() => { try { publicPages({ pool: /** @type {any} */ (fakePool), enabled: true, secret: null }); return false; } catch { return true; } })());

const on = await serve({});
{
  const h = await on.get(`/api/public/matches/${M1}`);
  ok("the header answers 200, team level", h.status === 200 && JSON.parse(h.body).match.homeLabel === "Hilton College 1XI");
  ok("...and carries no day, no player", !/servedOn|served_on/.test(h.body) && leaks(h.body).length === 0, leaks(h.body));
  // SCRBRD-114 phase 3a: the result as the server reads it, in words, sides named, no reason.
  const hr = JSON.parse(h.body).match.result;
  ok("the header carries the result, in words, the side by its label", hr?.outcome === "home_win" && hr?.text === "Hilton College 1XI won by 12 runs", hr);
  ok("...and no reason a decision gave", !/reason/i.test(h.body));
  const st = await on.get(`/api/public/competitions/${C_PUB}/standings`);
  const sj = st.status === 200 ? JSON.parse(st.body) : null;
  ok("a published competition's table answers 200, team level: sides, figures, ranks",
     st.status === 200 && st.headers["cache-control"] === "public, max-age=30" && sj?.rows?.length === 2
     && sj.rows[0].side === "Hilton College 1XI" && sj.rows[0].points === 8 && sj.rows[1].nrr === -1.25, st.body);
  ok("...and nothing else: no reason, no player", !/reason|adjust/i.test(st.body) && leaks(st.body).length === 0);
  const st404 = await on.get(`/api/public/competitions/99999999-0000-0000-0000-0000000000ff/standings`);
  const stBad = await on.get(`/api/public/competitions/not-a-uuid/standings`);
  ok("an unpublished competition, and an id that is not one, are the one not found",
     st404.status === 404 && stBad.status === 404 && st404.body === stBad.body);
  const l = await on.get(`/api/public/matches/${M1}/log`);
  ok("the log answers 200 with the projection", l.status === 200 && JSON.parse(l.body).events.length === out.events.length);
  ok("...and leaks nothing", leaks(l.body).length === 0, leaks(l.body));
  const since = await on.get(`/api/public/matches/${M1}/log?since=20`);
  ok("?since= returns only what came after", JSON.parse(since.body).events.every((/** @type {any} */ e) => e.seq > 20) && JSON.parse(since.body).events.length > 0);
  const sh = await on.get(`/api/public/matches/${M1}/shots`);
  ok("the sectors answer 200, team level", sh.status === 200 && JSON.parse(sh.body).sectors[0].runs === 4);

  console.log("\n── One answer for nothing ──");
  const nf = [await on.get(`/api/public/matches/${M2}`), await on.get("/api/public/matches/77777777-0000-0000-0000-00000000dead"),
    await on.get("/api/public/matches/not-a-uuid"), await on.get(`/api/public/matches/${M2}/log`), await on.get(`/api/public/matches/${M2}/shots`),
    await on.get(`/api/public/matches/${M1}/players`), await on.get("/api/public/competitions/x")];
  ok("unpublished, unknown, malformed, and unmounted reads: one status, one body, one set of headers",
     nf.every((x) => x.status === 404 && x.body === nf[0].body && JSON.stringify(x.headers) === JSON.stringify(nf[0].headers)), nf.map((x) => [x.status, x.headers]));
  const ns = [await on.get(`/live/${M2}`), await on.get("/live/77777777-0000-0000-0000-00000000dead"), await on.get("/scorecard/nope"),
    await on.get(`/table/${M1}`), await on.get(`/fixtures/${M1}`),
    // SCRBRD-133 G1: the ground display is the same answer for an unpublished fixture (D2).
    await on.get(`/display/${M2}`), await on.get("/display/not-a-uuid")];
  ok("the shells: unpublished, unknown, malformed, phase 2's two and the ground display's answer one 404 page",
     ns.every((x) => x.status === 404 && x.body === ns[0].body && JSON.stringify(x.headers) === JSON.stringify(ns[0].headers)));
  ok("a POST is the same 404", (await on.get(`/api/public/matches/${M1}`, { method: "POST" })).status === 404);

  console.log("\n── Nobody, whatever the request carries ──");
  const users0 = seen.users.length;
  clock += SETTLED_TTL_MS + 1;
  const plain = await on.get(`/api/public/matches/${M1}/log`);
  clock += SETTLED_TTL_MS + 1;
  const staff = await on.get(`/api/public/matches/${M1}/log`, { token: "Bearer eyJhbGciOi.staff.token" });
  const pad = await on.get(`/api/public/matches/${M1}/log`, { token: "ScrbrdPad cred=x, sig=y" });
  ok("a staff token changes nothing: the same bytes and headers", staff.body === plain.body && JSON.stringify(staff.headers) === JSON.stringify(plain.headers));
  ok("a pad credential changes nothing either", pad.body === plain.body && pad.status === 200);
  ok("every read ran as the anonymous principal (app.user_id '')", seen.users.length > users0 && seen.users.every((u) => u === ""), seen.users);

  console.log("\n── Headers ──");
  const all = [h, l, sh, nf[0], ns[0], await on.get(`/live/${M1}`), await on.get(`/scorecard/${M1}`)];
  ok("every answer says X-Robots-Tag: noindex", all.every((x) => /noindex/.test(x.headers["x-robots-tag"] ?? "")), all.map((x) => x.headers["x-robots-tag"]));
  ok("the log (it carries labels) is no-store", l.headers["cache-control"] === "no-store");
  ok("the header and the sectors (team facts) are public, max-age=30", h.headers["cache-control"] === "public, max-age=30" && sh.headers["cache-control"] === "public, max-age=30");
  ok("a 404 and a shell are no-store", nf[0].headers["cache-control"] === "no-store" && all[5].headers["cache-control"] === "no-store");
  ok("the shell says noindex, nofollow in its header and its meta", all[5].headers["x-robots-tag"] === "noindex, nofollow" && /<meta name="robots" content="noindex, nofollow" \/>/.test(all[5].body));
  ok("the shell names the teams and the score, and nobody", /og:title" content="Hilton College 1XI v Westville Boys&#39; High 1XI · 25\/2"/.test(all[5].body) && leaks(all[5].body).length === 0);
  ok("the scorecard shell asks for the scorecard view", /data-view="scorecard"/.test(all[6].body) && /src="\/public-app.js"/.test(all[6].body));
  // SCRBRD-133 G1: the ground display's shell, served as the live page's is (D1, D2).
  const disp = await on.get(`/display/${M1}`);
  ok("the ground display's shell answers 200 for a published fixture, no-store", disp.status === 200 && disp.headers["cache-control"] === "no-store");
  ok("...noindex, nofollow in its header and its meta", disp.headers["x-robots-tag"] === "noindex, nofollow"
     && /<meta name="robots" content="noindex, nofollow" \/>/.test(disp.body));
  ok("...the same public bundle, asked for the display view", /data-view="display"/.test(disp.body) && /src="\/public-app.js"/.test(disp.body)
     && /og:description" content="Ground display · SCRBRD"/.test(disp.body));
  ok("...painted the board's black before the bundle loads", /documentElement\.style\.background = "#0b0e0b"/.test(disp.body)
     && !/#0b0e0b/.test(all[5].body));
  ok("...names the teams and the score, and nobody", leaks(disp.body).length === 0 && /Hilton College 1XI v /.test(disp.body));
  // D2: the display is the HOME side's to switch on. A fixture only the away side published.
  const M3 = "77777777-0000-0000-0000-0000000000a3";
  seen.alsoServed.add(M3); seen.awayOnly.add(M3);
  const awayLive = await on.get(`/live/${M3}`), awayDisp = await on.get(`/display/${M3}`);
  ok("published by the away side alone: its live page is served, its ground display is the one 404",
     awayLive.status === 200 && awayDisp.status === 404 && awayDisp.body === ns[0].body
     && JSON.stringify(awayDisp.headers) === JSON.stringify(ns[0].headers), `${awayLive.status} ${awayDisp.status}`);
  const head = await on.get(`/api/public/matches/${M1}`, { method: "HEAD" });
  ok("HEAD answers the headers and no body", head.status === 200 && head.body === "");
}

console.log("\n── The cache ──");
{
  clock += SETTLED_TTL_MS + 1;
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.50" });
  const r0 = seen.reads;
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.50" });
  ok("a second read inside the TTL touches no database", seen.reads === r0);
  on.site.cache.drop({ k: "player", id: P.nobody });
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.50" });
  ok("a change to a boy the log names drops it: the next read re-reads", seen.reads > r0);
  const r1 = seen.reads;
  on.site.cache.drop({ k: "player", id: "aaaaaaaa-0000-0000-0000-0000000fffff" });
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.50" });
  ok("a change to a boy it does not name drops nothing", seen.reads === r1);
  on.site.cache.drop({ k: "match", id: M1 });
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.50" });
  ok("a change to the fixture (a publication) drops it", seen.reads > r1);
  const r2 = seen.reads;
  on.site.cache.drop({ k: "school", id: "11111111-1111-1111-1111-111111111111" });
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.50" });
  ok("a school's names-off switch drops everything", seen.reads > r2);
  const r3 = seen.reads;
  clock += SETTLED_TTL_MS - 1000;
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.51" });
  ok("a finished fixture lives 60 s", seen.reads === r3);
  clock += 2000;
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.51" });
  ok("...and not longer", seen.reads > r3);
  seen.status = "live";
  on.site.cache.drop(null);
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.52" });
  const r4 = seen.reads;
  clock += LIVE_TTL_MS + 1;
  await on.get(`/api/public/matches/${M1}/log`, { ip: "203.0.113.52" });
  ok("a live fixture lives 5 s", seen.reads > r4);
  seen.status = "complete";
  const c = new PublicCache(() => clock);
  let loads = 0;
  const slow = () => new Promise((r) => setTimeout(() => { loads++; r("x"); }, 20));
  await Promise.all([c.get(M1, "log", 5000, slow), c.get(M1, "log", 5000, slow), c.get(M1, "log", 5000, slow)]);
  ok("three requests together make one read", loads === 1);
  const d = new PublicCache(() => clock);
  const p = d.get(M1, "header", 60_000, () => new Promise((r) => setTimeout(() => r("stale"), 20)));
  d.drop({ k: "match", id: M1 });
  await p;
  ok("a change that arrives mid-read is not undone by that read's answer", !d.entries.get(M1)?.header);
  const small = new PublicCache(() => clock, 3);
  for (const id of ["a", "b", "c", "d"]) small.entry(id);
  ok("the cache is bounded: past its size the oldest fixture goes", small.entries.size === 3 && !small.entries.has("a") && small.entries.has("d"));
  const hot = new PublicCache(() => clock);
  for (let i = 0; i < 2001; i++) hot.hit(M1);
  ok("past 2,000 requests a minute a fixture is hot", hot.hit(M1) === true);
  clock += 60_000;
  ok("...and the next minute starts cold, with last minute's counts forgotten", hot.hit(M1) === false && hot.hits.size === 1);
}

console.log("\n── A publish through this API is never served stale ──");
{
  // db/59's notification arrives on its own connection whenever the listening
  // backend sends it; under load that was after the publisher's next request
  // had been served from the old entry (tools/smoke-public.mjs, two runs in
  // five). Here it never arrives at all — no listener — so only the write
  // path's own drop can make the next read right.
  const site = await serve({});
  const SESSION = "session-secret-for-the-publication-route-0123456789";
  const token = `Bearer ${signToken({ userId: "bbbbbbbb-0000-0000-0000-00000000b001", deviceId: "t" }, SESSION)}`;
  let refuse = false;
  const writes = {
    connect: async () => ({
      release() {},
      /** @param {string} text @param {any[]} [params] */
      async query(text, params = []) {
        if (!/fixture_publish/.test(text)) return { rows: [] };
        if (refuse) return { rows: [{ ok: false, reason: "not_permitted" }] };
        if (params[2]) seen.alsoServed.add(params[0]); else seen.alsoServed.delete(params[0]);
        return { rows: [{ ok: true, reason: null }] };
      },
    }),
  };
  const routes = publicationRoutes({ pool: /** @type {any} */ (writes), secret: SESSION, onChange: site.site.changed });
  /** @param {boolean} published */
  const publish = async (published) => {
    /** @type {{status: number, body: any}} */
    const out = { status: 200, body: null };
    const res = /** @type {any} */ ({ status(/** @type {number} */ c) { out.status = c; return res; }, json(/** @type {any} */ b) { out.body = b; return res; } });
    await routes.set(/** @type {any} */ ({ params: { id: M2 }, body: { side: "home", published }, headers: { authorization: token } }), res);
    return out.status;
  };
  const ip = { ip: "203.0.113.90" };
  ok("unpublished: not found, and that answer is cached", (await site.get(`/api/public/matches/${M2}`, ip)).status === 404
     && site.site.cache.entries.get(M2)?.header?.value === null);
  ok("published through the route", await publish(true) === 200);
  ok("...and the very next read serves it, with no notification", (await site.get(`/api/public/matches/${M2}`, ip)).status === 200
     && (await site.get(`/api/public/matches/${M2}/log`, ip)).status === 200);
  ok("withdrawn through the route", await publish(false) === 200);
  ok("...and the very next read is not found, header and log", (await site.get(`/api/public/matches/${M2}`, ip)).status === 404
     && (await site.get(`/api/public/matches/${M2}/log`, ip)).status === 404);
  refuse = true;
  ok("a refused publish changes nothing and drops nothing", await publish(true) === 403 && site.site.cache.entries.get(M2)?.header?.value === null);
  ok("server.mjs hands the publication route the public cache",
     /publicationRoutes\(\{[^}]*onChange: \(note\) => publicSite\.changed\(note\)/.test(readFileSync(join(ROOT, "services", "api", "server.mjs"), "utf8")));
  await site.close();
}

console.log("\n── The rate limit ──");
{
  const codes = [];
  for (let i = 0; i < RATE.burst + 2; i++) codes.push((await on.get(`/api/public/matches/${M1}`, { ip: "192.0.2.77" })).status);
  const limited = await on.get(`/live/${M1}`, { ip: "192.0.2.77" });
  ok(`${RATE.burst} in a burst, then 429`, codes.slice(0, RATE.burst).every((s) => s === 200) && codes[RATE.burst] === 429 && codes[RATE.burst + 1] === 429, codes);
  ok("...with Retry-After, noindex and no-store", Number(limited.headers["retry-after"]) >= 1 && /noindex/.test(limited.headers["x-robots-tag"]) && limited.headers["cache-control"] === "no-store");
  ok("another address is not limited", (await on.get(`/api/public/matches/${M1}`, { ip: "192.0.2.78" })).status === 200);
  clock += 1000;
  ok(`a token comes back at ${RATE.perMinute / 60} a second`, (await on.get(`/api/public/matches/${M1}`, { ip: "192.0.2.77" })).status === 200);
  const rl = new RateLimit(() => clock, { perMinute: 120, burst: 30 });
  for (let i = 0; i < 30; i++) rl.take("x");
  ok("120 a minute is the steady rate", rl.take("x") === 1);
  clock += 60_000;
  ok("a minute later the whole burst is back", Array.from({ length: 30 }, () => rl.take("x")).every((w) => w === 0));
}
await on.close();

console.log("\n── A pavilion on one address (SCRBRD-133 A4) ──");
{
  // The ground display reads the log every 5 s and the header every 60 s
  // (public/reads.js); each phone on /live reads the header and the log
  // every 15 s (PublicMatch.jsx), after its shell, header and log on opening.
  // A school's wifi is one address for all of them.
  /** @param {{perMinute: number, burst: number}} rate @param {number} phones @param {number} arriveEveryMs @returns {number} 429s in ten minutes */
  const pavilion = (rate, phones, arriveEveryMs) => {
    let t = 0;
    const rl = new RateLimit(() => t, rate);
    /** @type {[number, number][]} when, how many */
    const asks = [];
    for (let at = 0; at < 600_000; at += 5_000) asks.push([at, 1]);                       // the display's log
    for (let at = 0; at < 600_000; at += 60_000) asks.push([at + 1, 1]);                  // ...and its header
    for (let p = 0; p < phones; p++) {
      const start = p * arriveEveryMs;
      asks.push([start, 3]);                                                              // shell, header, log
      for (let at = start + 15_000; at < 600_000; at += 15_000) asks.push([at, 2]);        // header and log
    }
    asks.sort((a, b) => a[0] - b[0]);
    let refused = 0;
    for (const [at, n] of asks) { t = at; for (let i = 0; i < n; i++) if (rl.take("pavilion")) refused++; }
    return refused;
  };
  ok(`${RATE.perMinute} a minute, burst ${RATE.burst}: the display and 40 phones arriving over two minutes, ten minutes, never a 429`,
     pavilion(RATE, 40, 3_000) === 0, String(pavilion(RATE, 40, 3_000)));
  ok("...and 19 phones opening the page in the same second beside the display", pavilion(RATE, 19, 0) === 0, String(pavilion(RATE, 19, 0)));
  ok("the 120 a minute, burst 30 it replaced refused that pavilion (why it moved)", pavilion({ perMinute: 120, burst: 30 }, 40, 3_000) > 0);
  ok("...though it carried the display and a dozen phones", pavilion({ perMinute: 120, burst: 30 }, 12, 3_000) === 0);
  ok("one address is still limited: a script at ten a second is refused within the minute", (() => {
    let t = 0, refused = 0;
    const rl = new RateLimit(() => t, RATE);
    for (; t < 60_000; t += 100) if (rl.take("script")) refused++;
    return refused > 0;
  })());
}

console.log("\n── The client's address ──");
{
  const req = (/** @type {string | undefined} */ xff) => /** @type {any} */ ({ socket: { remoteAddress: "10.0.0.1" }, headers: xff ? { "x-forwarded-for": xff } : {} });
  ok("no trusted proxy: the socket's, whatever the header says", clientAddress(req("1.2.3.4"), 0) === "10.0.0.1");
  ok("one trusted proxy: the rightmost entry", clientAddress(req("6.6.6.6, 1.2.3.4"), 1) === "1.2.3.4");
  ok("a client cannot choose its address by writing the header itself", clientAddress(req("6.6.6.6, 7.7.7.7, 1.2.3.4"), 1) === "1.2.3.4");
  ok("two trusted proxies: the second from the right", clientAddress(req("6.6.6.6, 1.2.3.4, 35.1.1.1"), 2) === "1.2.3.4");
}

console.log("\n── The shell ──");
{
  const index = readFileSync(join(ROOT, "apps", "web", "index.html"), "utf8");
  const boot = index.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1] ?? "";
  const norm = (/** @type {string} */ s) => s.replace(/\s+/g, " ").trim();
  ok("the shell's theme boot is index.html's, line for line", norm(boot) === norm(THEME_BOOT));
  const html = shellHtml({ view: "live", matchId: M1, header: { homeLabel: "<script>x</script>", awayLabel: "A\"B", scores: [] } });
  ok("a team name is escaped in the shell", !html.includes("<script>x</script>") && html.includes("&lt;script&gt;") && html.includes("A&quot;B"));
}

console.log(`\nPUBLIC: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

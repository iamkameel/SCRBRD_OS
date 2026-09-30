/**
 * What the Match Centre shows, worked out from a fixture row and the fold —
 * pure, so every rule here is tested without a browser
 * (apps/web/test/match-centre.test.mjs). The screens are views/matchcentre/.
 *
 * Nothing here invents a figure: every number is read off the fold
 * (@scrbrd/scoring's deriveMatch), and a thing the fold does not have is left
 * out rather than guessed.
 */
import { runsOffBat } from "@scrbrd/scoring";
import { parseTeam, teamLabel } from "@scrbrd/policy/teams";
import { humanDateTime } from "./format.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── A side's name: the whole of it where there is room, a code where not ──

/** A side's own label at the end of a name: "1st XI", "1XI", "U15A". */
const TEAM_TOKEN = /\s+((?:1st|2nd|3rd|\d+th)\s+XI|\d+XI|U\d{1,2}[A-Z]?)$/i;
const STOP = new Set(["of", "the", "and", "&"]);

/**
 * The short form of a school or club's name, when no code is on record: the
 * name itself when it is short, the first word of two, the initials of three
 * or more ("Westville Boys' High" → "WBH", as the prototype writes "WBHS").
 * @param {string} name
 */
export function nameCode(name) {
  const base = String(name ?? "").trim();
  if (base.length <= 12) return base;
  const words = base.split(/\s+/).filter((w) => !STOP.has(w.toLowerCase()));
  if (words.length >= 3) return words.map((w) => w[0]).join("").toUpperCase();
  return words[0];
}

/** "1st XI" → "1XI"; a code stays as it is. @param {string} t */
const teamShort = (t) => t.replace(/^(\d+)(?:st|nd|rd|th)\s+XI$/i, "$1XI");

/**
 * One side of a fixture, named both ways.
 * @param {{label?: string | null, schoolCode?: string | null, team?: string | null, fallback?: string | null}} s
 * @returns {{full: string, short: string}}
 */
export function sideName({ label, schoolCode, team, fallback }) {
  const full = (label ?? fallback ?? "").trim() || "—";
  const token = TEAM_TOKEN.exec(full);
  const teamPart = team ? teamShort(team) : token ? teamShort(token[1]) : "";
  const school = token ? full.slice(0, token.index) : full;
  const code = schoolCode || nameCode(school);
  const short = teamPart && code !== teamPart ? `${code} ${teamPart}` : code;
  return { full, short: short || full };
}

/**
 * Both sides of a fixture row (lib/live.js asMatch, or a demo match). The
 * full name is the school's own and the side ("Hilton College 1XI", from
 * fixture_side_label on the server); the short one is `school.code` and the
 * side ("HIL 1XI") where the reader's read returns the code, and the name's
 * own initials where it does not.
 * @param {any} m
 */
export function sidesOf(m) {
  return {
    home: sideName({ label: m?.homeLabel, schoolCode: m?.homeCode, team: m?.homeLabel ? m?.homeTeam : null, fallback: m?.homeTeam }),
    away: sideName({ label: m?.awayLabel, schoolCode: m?.awayCode, team: m?.awayLabel ? m?.awayTeamCode : null, fallback: m?.awayTeam }),
  };
}

/**
 * Which side of the fixture an innings' batting side is. The pad writes the
 * fixture's own names into innings_start (team1 is the home side's team code,
 * team2 the opponent), so they are compared as written; failing that, the
 * first innings' other side is the second's batting side.
 * @param {any} m  @param {string | null | undefined} name  @returns {"home" | "away" | null}
 */
export function sideOfTeam(m, name) {
  if (name == null) return null;
  const n = String(name).trim().toLowerCase();
  const eq = (/** @type {unknown} */ x) => x != null && String(x).trim().toLowerCase() === n;
  if (eq(m?.homeTeam) || eq(m?.homeLabel)) return "home";
  if (eq(m?.awayTeam) || eq(m?.awayLabel) || eq(m?.awayTeamCode)) return "away";
  return null;
}

/**
 * A side as the Match Centre names it, from the name an innings carries.
 * @param {any} m  @param {string | null | undefined} name
 * @returns {{full: string, short: string}}
 */
export function teamOf(m, name) {
  const s = sideOfTeam(m, name);
  if (s) return sidesOf(m)[s];
  const full = String(name ?? "").trim() || "—";
  return { full, short: sideName({ fallback: full }).short };
}

// ── The match line ──

/**
 * Where the match is, in words: "1st innings", "Innings break", "2nd
 * innings", "Result".
 * @param {any[]} innings  the fold's, in order  @param {any} [result]  deriveMatch's
 */
export function inningsPhase(innings = [], result = null) {
  const played = innings.filter(Boolean);
  if (result) return "Result";
  if (!played.length) return "Not started";
  const last = played[played.length - 1];
  if (played.length === 1) return last.complete ? "Innings break" : "1st innings";
  if (played.length === 2 && !last.complete && !(last.ballLog?.length)) return "Innings break";
  return played.length === 2 ? (last.complete ? "Result" : "2nd innings") : `Innings ${played.length}`;
}

/**
 * Which innings the board shows: the one in play — or, at the innings break,
 * the one just finished.
 * @param {any[]} innings  @param {any} [result]
 * @returns {{index: number, atBreak: boolean}}
 */
export function boardInnings(innings = [], result = null) {
  const atBreak = inningsPhase(innings, result) === "Innings break";
  return { index: atBreak ? 0 : Math.max(0, innings.length - 1), atBreak };
}

/** The age group of a side: "U16", or "1st XI" for an open side. @param {string | null | undefined} team */
export function ageGroupOf(team) {
  const t = parseTeam(team);
  if (!t) return null;
  return t.kind === "age" ? `U${t.age}` : teamLabel(team);
}

/**
 * The line under the board (§10 item 5): competition · age group · ground ·
 * start · weather · innings. One line of body text; a part the fixture does
 * not have is left out, never shown as a dash.
 * @param {{match: any, competition?: string | null, weather?: any, phase?: string | null}} o
 * @returns {string}
 */
export function matchLine({ match, competition = null, weather = null, phase = null }) {
  const team = match?.homeLabel ? match?.homeTeam : null;
  const parts = [
    competition,
    ageGroupOf(team ?? match?.homeTeam) ?? null,
    match?.venue ?? null,
    match?.date ? humanDateTime(match.date, match.time ?? null) : null,
    weather ? [weather.tempC != null ? `${weather.tempC}°` : null, weather.condition ? String(weather.condition).toLowerCase() : null].filter(Boolean).join(" ") || null : null,
    phase,
  ];
  return parts.filter((p) => p != null && String(p).trim() !== "").join(" · ");
}

// ── Names, for the commentary generator ──

/**
 * A reader's `nameOf` for deriveCommentary: the names the log itself carries
 * (the squads on innings_start, which is what the scorecard shows), then the
 * players this reader's own roster read returned, then a name the scorer
 * typed for someone SCRBRD holds no row for. An id nobody names is null, and
 * the generator says the role instead — never the id.
 * @param {any[]} innings  the fold's  @param {{id: string, name?: string | null}[]} [players]
 * @returns {(ref: string) => string | null}
 */
export function nameBook(innings = [], players = []) {
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const inn of innings) {
    if (!inn) continue;
    for (const p of [...(inn.squad ?? []), ...(inn.bowlingSquad ?? [])]) {
      const id = p?.id ?? p;
      if (typeof id === "string" && p?.name) names.set(id, p.name);
    }
  }
  const roster = new Map(players.filter((p) => p?.id && p?.name).map((p) => [p.id, /** @type {string} */ (p.name)]));
  return (ref) => names.get(ref) ?? roster.get(ref) ?? (UUID.test(ref) ? null : ref);
}

// ── The scorecard ──

/** Overs as a card writes them: "17.5", or "20" for a whole number. @param {number} balls */
export const oversOf = (balls) => (balls % 6 === 0 ? String(balls / 6) : `${Math.floor(balls / 6)}.${balls % 6}`);

/**
 * The fall of wickets as the prototype writes it: "43/3 · R Rickelton · 5.5".
 * @param {any} inn  @returns {string[]}
 */
export function fowLines(inn) {
  return (inn?.fow ?? []).map((f) => `${f.runs}/${f.wickets} · ${f.batsman} · ${f.overs}`);
}

/**
 * The squad members who did not bat, in squad order: everyone on the
 * innings' squad the fold has no batting line for.
 * @param {any} inn  @returns {{id: string, name: string}[]}
 */
export function didNotBat(inn) {
  const batted = new Set((inn?.batsmen ?? []).map((b) => b.id));
  return (inn?.squad ?? [])
    .map((p) => ({ id: p?.id ?? p, name: p?.name ?? null }))
    .filter((p) => p.id != null && p.name && !batted.has(p.id) && p.id !== inn?.twelfthMan);
}

/**
 * Extras broken out as the card has them: NB · WD · B · LB · PEN.
 * @param {any} inn
 */
export function extrasOf(inn) {
  const e = inn?.extras ?? {};
  // An innings from a paper scorebook (SCRBRD-120) records only the kinds the
  // book gave: the rest are null and stay null, never nought (D12).
  const none = inn?.summarised ? null : 0;
  const parts = { NB: e.noBall ?? none, WD: e.wide ?? none, B: e.bye ?? none, LB: e.legBye ?? none, PEN: e.penalty ?? none };
  const given = Object.values(parts).filter((v) => v !== null);
  return { total: given.length ? given.reduce((a, b) => a + b, 0) : (inn?.summarised ? null : 0), parts };
}

/**
 * A batter's scoring strokes, counted off the fold's own log: how many 1s,
 * 2s, 3s, 4s and 6s he took, off the bat.
 * @param {any} inn  @param {string} id
 */
export function runCounts(inn, id) {
  /** @type {Record<"1"|"2"|"3"|"4"|"6", number>} */
  const out = { 1: 0, 2: 0, 3: 0, 4: 0, 6: 0 };
  for (const b of inn?.ballLog ?? []) {
    if ((b.strikerId ?? b.striker) !== id) continue;
    const r = runsOffBat(b);
    if (r === 1 || r === 2 || r === 3 || r === 4 || r === 6) out[/** @type {"1"} */ (String(r))] += 1;
  }
  return out;
}

/**
 * The key of the commentary line that tells a batter's dismissal: the
 * delivery (or the retirement) that got him out, as deriveCommentary keys it.
 * @param {any} inn  @param {string} id  @param {any[]} [events]  the innings' log, for a wicket with no delivery
 * @returns {string | null}
 */
export function dismissalKey(inn, id, events = []) {
  const ball = (inn?.ballLog ?? []).find((b) => b.type === "W" && !b.freeHitSaved && (b.dismissed ?? b.strikerId) === id);
  if (ball?.id) return `e:${ball.id}`;
  const retired = events.filter((e) => e.kind === "retire" && e.type === "W" && e.batter === id).pop();
  return retired?.id ? `e:${retired.id}` : null;
}

// ── The innings break (§10 item 10) ──

/**
 * What the break says about the innings just played: its top scorers, its
 * best bowling, who hit the most boundaries, and the best strike rate (ten
 * balls or more, so a single ball does not top it).
 * @param {any} inn
 */
export function inningsBreak(inn) {
  const bats = [...(inn?.batsmen ?? [])];
  const topScorers = bats.filter((b) => b.balls > 0 || b.runs > 0)
    .sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, 3);
  const bestBowling = [...(inn?.bowlers ?? [])].filter((b) => b.balls > 0)
    .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, 2);
  const boundaries = bats.map((b) => ({ ...b, hits: b.fours + b.sixes })).filter((b) => b.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.sixes - a.sixes)[0] ?? null;
  const strikeRate = bats.filter((b) => b.balls >= 10)
    .map((b) => ({ ...b, sr: (b.runs / b.balls) * 100 }))
    .sort((a, b) => b.sr - a.sr)[0] ?? null;
  return { topScorers, bestBowling, boundaries, strikeRate };
}

// ── The result, in one clear moment (SCRBRD-100 item 3) ──

/**
 * The result, in the words the fold already gives ("Team X won by 23 runs",
 * "Team X won by 4 wickets", "Match tied"). Never a second guess at a winner
 * or a margin — `deriveMatch()`'s `result` is the only source, exactly as
 * `MatchView` and the post-match report already compose it.
 * @param {any} match  @param {{winner: string | null, margin: string} | null} result
 * @returns {string | null}
 */
export function resultText(match, result) {
  if (!result) return null;
  if (result.winner == null) return result.margin && result.margin !== "tie" ? `Match tied (${result.margin})` : "Match tied";
  return `${teamOf(match, result.winner).full} won by ${result.margin}`;
}

// ── A rain delay or interruption (SCRBRD-100 item 1) ──

/**
 * The umpires' own words for a revision's reason (mirrors the closed list on
 * the pad's RevisionSheet, `scorer/sheets.jsx`, and the label
 * `commentary.mjs`'s REVISION_REASON_WORDS carries for the same reasons — that
 * map is private to the generator, so this is its own copy of the same short
 * vocabulary, for a banner rather than a sentence).
 * @type {Readonly<Record<string, string>>}
 */
const REVISION_LABEL = Object.freeze({
  rain: "Rain delay", bad_light: "Bad light", "bad light": "Bad light",
  late_start: "Late start", "late start": "Late start",
  ground_unfit: "Ground unfit", "ground unfit": "Ground unfit",
});

/**
 * A clear status for an interrupted innings — the one signal the log
 * actually carries. There is no "play is stopped right now" event: only a
 * `revision` the umpires recorded, after the fact, cutting the overs and/or
 * resetting the target (`inn.revised`, replay.mjs). This reads honestly as
 * "the innings WAS revised", not "play is paused and will resume at…", which
 * nothing in the log says.
 * @param {any} inn  the fold's, or null
 * @returns {{label: string, text: string} | null}
 */
export function revisionNotice(inn) {
  const r = inn?.revised;
  if (!r || (r.overs == null && r.target == null)) return null;
  const text = r.overs != null && r.target != null ? `Overs revised to ${r.overs}; target ${r.target}`
    : r.overs != null ? `Overs revised to ${r.overs}`
      : `Target revised to ${r.target}`;
  return { label: REVISION_LABEL[String(r.reason ?? "").toLowerCase()] ?? "Play interrupted", text };
}

// ── No live matches (SCRBRD-100 item 1) ──

/**
 * The next few upcoming fixtures and the last few results, from the list's
 * own read — never a second fetch. Sorted properly rather than trusting the
 * read's own order, which is newest-first across every status.
 * @param {any[]} matches  @param {{limit?: number}} [o]
 */
export function upcomingAndRecent(matches = [], { limit = 3 } = {}) {
  const key = (m) => `${m.date ?? ""}T${m.time ?? "00:00"}`;
  const upcoming = matches.filter((m) => m.status === "upcoming" && m.date)
    .sort((a, b) => key(a).localeCompare(key(b))).slice(0, limit);
  const recent = matches.filter((m) => m.status === "complete" && m.date)
    .sort((a, b) => key(b).localeCompare(key(a))).slice(0, limit);
  return { upcoming, recent };
}

// ── The full-time screen links onward (SCRBRD-100 item 4) ──

/**
 * A side's own next fixture, from the SAME list read the Match Centre already
 * has — never a second one. Matched on its own home label
 * (`fixture_side_label()`'s output, which is the same string for the same
 * school and team every time), because the list read never carries the away
 * side's school id: only a side that is itself a SCRBRD tenant (whose label
 * therefore ever appears as somebody's HOME side) can be found this way. An
 * opponent typed in free text — not a tenant — has no fixture to find, and
 * this honestly returns null for one rather than guessing.
 * @param {any[]} matches  @param {{label: string | null, excludeId?: string | null, today?: string | null}} o
 * @returns {any | null}
 */
export function nextFixtureOf(matches = [], { label, excludeId = null, today = null } = {}) {
  if (!label) return null;
  const cands = matches.filter((m) => m.id !== excludeId && m.status === "upcoming" && m.homeLabel === label
    && (!today || (m.date ?? "") >= today));
  cands.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return cands[0] ?? null;
}

// ── The amendment flow's delivery picker (SCRBRD-100 item 5) ──

/**
 * The deliveries of one innings a coach or scorer could name in a correction
 * request — every commentary line that is a real delivery (its key is the
 * ball's own event id, `e:<id>`, unsuffixed: a milestone line pushed for the
 * same ball carries the same id with a `#n` suffix and is not a second
 * delivery to pick), oldest first, so a form reads the over as it was bowled.
 * `targetKey` is exactly what `POST /matches/:id/amendments` wants.
 * @param {{innings: number, over: number, ball: number, key: string, text: string}[]} commentary
 * @param {number} inningsIndex
 */
export function deliveryOptions(commentary = [], inningsIndex) {
  return commentary
    .filter((c) => c.innings === inningsIndex && /^e:[^#]+$/.test(c.key))
    .map((c) => ({ key: c.key, over: c.over, ball: c.ball, text: c.text, targetKey: c.key.slice(2) }))
    .sort((a, b) => a.over - b.over || a.ball - b.ball);
}

// ── The commentary, grouped (the Commentary tab) ──

/**
 * The commentary newest first, in overs: each group is one over of one
 * innings, its lines newest first, with the over's own summary line pulled
 * out to head it.
 * @param {{innings: number, over: number, kind: string, key: string, text: string, ball: number}[]} items  deriveCommentary's, in order
 */
export function commentaryByOver(items = []) {
  /** @type {{key: string, innings: number, over: number, end: any, lines: any[]}[]} */
  const groups = [];
  for (const it of items) {
    let g = groups[groups.length - 1];
    if (!g || g.innings !== it.innings || g.over !== it.over) {
      g = groups.find((x) => x.innings === it.innings && x.over === it.over);
      if (!g) { g = { key: `${it.innings}:${it.over}`, innings: it.innings, over: it.over, end: null, lines: [] }; groups.push(g); }
    }
    if (it.kind === "over_end") g.end = it; else g.lines.push(it);
  }
  groups.sort((a, b) => a.innings - b.innings || a.over - b.over);
  return groups.reverse().map((g) => ({ ...g, lines: [...g.lines].reverse() }));
}

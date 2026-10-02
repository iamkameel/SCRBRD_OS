/**
 * THE CAPTAIN'S VIEW — the plain parts (SCRBRD-138 phase A,
 * docs/design/SCRBRD-138_captains_view.md).
 *
 * A captain is a pupil who holds the captaincy honour; he is not a role
 * (ADR 0003), and nothing here is a capability he gains. The view is the pupil
 * app with three things switched on by one row of his own, and every figure on
 * it is one a team-mate may already read. NOTHING HERE DECIDES WHAT ANYBODY MAY
 * SEE: the server's reads do that, and this module only keeps the screen
 * honest about whom it is drawn for (§1.2) and about what it will not say (§4).
 *
 * Pure, so the rules are proved under plain node
 * (apps/web/test/family.test.mjs): no DOM, no database, no clock.
 */
import { commentaryByOver, oversOf, sideOfTeam } from "./matchCentre.js";
import { endOf } from "./family.js";

// ── The gate (§1.2) ────────────────────────────────────

/** The kinds that lead a side (D1): both get the view; the label is the honour's. */
export const CAPTAIN_LABEL = Object.freeze({ captain: "Captain", vice_captain: "Vice-captain" });

/**
 * The school season that is current today, by its label ("2026"): the
 * `seasons` read's own `current` flag at the school level, never a year worked
 * out here. Null when the read has not said, and the gate then refuses.
 * @param {{level: string, label: string, current: boolean}[]} seasons
 * @returns {string | null}
 */
export function currentSchoolSeason(seasons) {
  return (seasons ?? []).find((s) => s.level === "school" && s.current === true)?.label ?? null;
}

/**
 * Is he the captain (or vice-captain) of the side he is on, this season, at
 * his school? Five tests, stated once (§1.2), each of which refuses on its own:
 *
 *   the kind      captain or vice_captain (D1)
 *   live          not withdrawn (the `honours` read returns live rows only; a
 *                 row that says otherwise is refused here as well)
 *   this season   the honour's season is the one asked about: the fixture's
 *                 on a fixture or match screen, the current school season on Home
 *   this side     the honour's side is his CURRENT side: "an honour does not
 *                 move sides when he does" (db/08), so a captain moved down is
 *                 not the new side's captain (D2)
 *   his school    the honour's school is the school of his player assignment
 *
 * and it is HIS honour (the player). The client reads his own row and draws
 * (D11); nothing server-side is gated, because nothing he reads widens.
 * Fails closed: no player, no season, no honours — no view. When he holds both
 * kinds in a season the captain's label wins.
 *
 * @param {{playerId: string, school: string | null, team: string | null, kind: string, season: string | null,
 *          withdrawnAt?: string | null}[]} honours  the `honours` read, adapted
 * @param {{id: string, school: string | null, team: string | null} | null} me
 * @param {string | null} season  the season label asked about
 * @returns {{kind: string, label: string} | null}
 */
export function captaincyOf(honours, me, season) {
  if (!me?.id || !season || !me.team || !me.school) return null;
  const mine = (honours ?? []).filter((h) =>
    h.playerId === me.id
    && Object.hasOwn(CAPTAIN_LABEL, h.kind)
    && (h.withdrawnAt ?? null) == null
    && h.season === season
    && h.team === me.team
    && h.school === me.school);
  const h = mine.find((x) => x.kind === "captain") ?? mine[0];
  return h ? { kind: h.kind, label: CAPTAIN_LABEL[h.kind] } : null;
}

// ── His side, and the fixture's innings ────────────────

/**
 * The sheet for his end of the fixture, in batting order: the `match_squad`
 * read's rows for the side he is on, the twelfth man set apart, the unnumbered
 * last. The read already returns only what his policy lets him read.
 * @param {{playerId: string, side: string | null, battingNo: number | null, twelfth: boolean, name: string}[]} rows
 * @param {"home" | "away"} end
 */
export function sheetOf(rows, end) {
  return (rows ?? []).filter((r) => r.side === end)
    .sort((a, b) => (a.twelfth ? 1 : 0) - (b.twelfth ? 1 : 0) || (a.battingNo ?? 99) - (b.battingNo ?? 99) || a.name.localeCompare(b.name));
}

/**
 * Next in: the sheet's order minus those the fold says have batted — a pure
 * client reckoning (C3). The twelfth man does not bat.
 * @param {{playerId: string, twelfth: boolean, name: string, battingNo: number | null}[]} sheet  sheetOf()
 * @param {{id: string}[] | null | undefined} batted  the batting innings' batsmen
 */
export function nextIn(sheet, batted) {
  const gone = new Set((batted ?? []).map((b) => b.id));
  return (sheet ?? []).filter((r) => !r.twelfth && !gone.has(r.playerId));
}

/**
 * Which of the match's innings are his side's batting and which his side's
 * bowling. By the side the innings names (sideOfTeam), else by his own
 * players' ids; an innings that neither says is neither — the screen then
 * draws nothing "ours" from it, rather than put another school's children
 * under OUR BOWLERS.
 * @param {any} match
 * @param {{id: string, school: string | null, team: string | null}} me
 * @param {any[]} innings  the fold's, in order
 * @param {Set<string>} ours  the ids of his side's players (the sheet)
 * @returns {{inn: any, i: number, side: "batting" | "bowling" | null}[]}
 */
export function inningsOf(match, me, innings, ours) {
  const end = endOf(match, me);
  const ids = (/** @type {any[]} */ xs) => (xs ?? []).map((p) => p?.id ?? p);
  const has = (/** @type {any[]} */ xs) => ids(xs).some((id) => ours.has(id));
  return (innings ?? []).map((inn, i) => {
    if (!inn || inn.superOver != null) return { inn, i, side: null };
    const s = sideOfTeam(match, inn.battingTeam);
    const side = s ? (s === end ? "batting" : "bowling")
      : has(inn.batsmen) ? "batting" : has(inn.bowlers) ? "bowling" : null;
    return { inn, i, side };
  });
}

// ── Overs left, in the cap's own words (D4) ────────────

/**
 * His bowlers: the fold's figures, and the cap's sentence beside each. The
 * sentence is `capFor(balls)` — the pad's own `bowlerCapWords` over the frozen
 * conditions — and nothing else: no reason, no per-boy limit, no count of a
 * spell against a directive. Null where the document has no cap, or nothing
 * worth saying yet. `words` is drawn only while the innings is in play.
 * @param {any} inn  the innings his side fielded in
 * @param {(balls: number) => string | null} capFor
 * @param {boolean} inPlay
 * @returns {{id: string, name: string, figures: string, words: string | null}[]}
 */
export function bowlerRows(inn, capFor, inPlay) {
  return (inn?.bowlers ?? []).filter((b) => b.balls > 0 || b.runs > 0).map((b) => ({
    id: b.id, name: b.name,
    figures: `${oversOf(b.balls)}-${b.maidens ?? 0}-${b.runs}-${b.wickets}`,
    words: inPlay && typeof capFor === "function" ? capFor(b.balls) : null,
  }));
}

/** The sheet minus those who have bowled: "not yet bowled". @param {{playerId: string, twelfth: boolean, name: string}[]} sheet @param {{id: string}[]} bowlers */
export function notYetBowled(sheet, bowlers) {
  const done = new Set((bowlers ?? []).map((b) => b.id));
  return (sheet ?? []).filter((r) => !r.twelfth && !done.has(r.playerId));
}

// ── The band's one line (D4) ───────────────────────────

/**
 * The age band of a side, from its team code: "U15A" → "U15", a first, second
 * or third XI → "open". Null for a side the bands do not name (U12 and under,
 * a code nobody can read) — and the band line is then not drawn (A7).
 * @param {string | null | undefined} team
 * @returns {"U13" | "U14" | "U15" | "U16" | "open" | null}
 */
export function bandOfTeam(team) {
  const t = String(team ?? "").trim();
  const age = /^U(1[3-6])[A-Z]?$/i.exec(t);
  if (age) return /** @type {any} */ (`U${age[1]}`);
  if (/^\d+\s*XI$/i.test(t) || /^(?:1st|2nd|3rd|\d+th)\s+XI$/i.test(t)) return "open";
  return null;
}

/**
 * One line for the whole side: the competition's rule for the band where its
 * document names one, else the platform's directive for the band, in plain
 * words and the same for every bowler. Never a boy's own figure (D4).
 * @param {{spell: number | null, day: number | null} | null} fromDoc  bowlingLimit(conditions, band)
 * @param {{maxSpell: number | null, maxDay: number | null} | null} directive  the `bowling_directives` row for the band
 * @param {string | null} band
 * @returns {string | null}
 */
export function bandLine(fromDoc, directive, band) {
  if (!band) return null;
  const spell = fromDoc && (fromDoc.spell != null || fromDoc.day != null) ? fromDoc.spell : directive?.maxSpell ?? null;
  const day = fromDoc && (fromDoc.spell != null || fromDoc.day != null) ? fromDoc.day : directive?.maxDay ?? null;
  const bits = [spell != null ? `${spell}-over spells` : null, day != null ? `${day} a day` : null].filter(Boolean);
  return bits.length ? `${band === "open" ? "Open" : band} rule: ${bits.join(", ")}, for every bowler` : null;
}

// ── The day: pitch, in words ───────────────────────────

/**
 * The groundsman's report, in one line a captain reads on the bus: "firm,
 * green, even bounce, quick; helps seam". Null when it says nothing.
 * @param {{surface?: string | null, grass?: string | null, bounce?: string | null, pace?: string | null,
 *          favours?: string | null, notes?: string | null} | null | undefined} p
 */
export function pitchWords(p) {
  if (!p) return null;
  const grass = { bare: "bare", light: "light grass", covered: "good grass cover", green: "green" }[/** @type {string} */ (p.grass)] ?? null;
  const bits = [p.surface ?? null, grass, p.bounce ? `${p.bounce} bounce` : null, p.pace ? `${p.pace} pace` : null,
    p.favours && p.favours !== "even" ? `favours ${p.favours}` : p.favours === "even" ? "an even contest" : null];
  const line = bits.filter(Boolean).join(", ");
  return [line || null, p.notes?.trim() || null].filter(Boolean).join(". ") || null;
}

/** "1st", "2nd", "3rd", "4th" … @param {number} n */
export const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

// ── Matchups, by bowling type only (D8) ────────────────

/**
 * Pace or spin, from the bowling style a bowler's record carries ("Right-arm
 * fast-medium", "Left-arm orthodox", "S", "F"). Null where it cannot be said:
 * a row the screen cannot name a type for is a row it does not offer.
 * @param {string | null | undefined} style
 * @returns {"pace" | "spin" | null}
 */
export function bowlingType(style) {
  const s = String(style ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/spin|break|orthodox|googly|chinaman|wrist|finger/.test(s)) return "spin";
  if (/fast|medium|seam|pace|quick|swing/.test(s)) return "pace";
  if (s === "s") return "spin";
  if (s === "f" || s === "m" || s === "p") return "pace";
  return null;
}

/**
 * One batter against bowling like his: the `matchups` read's rows (which name
 * only bowlers the reader may read) folded by pace and spin, and nothing that
 * names a bowler. Types with no ball faced are not drawn.
 * @param {{bowlingStyle?: string | null, balls: number, runs: number, dismissals: number}[]} rows
 * @returns {{type: "pace" | "spin", balls: number, runs: number, out: number}[]}
 */
export function matchupTypes(rows) {
  /** @type {Record<string, {type: "pace" | "spin", balls: number, runs: number, out: number}>} */
  const by = {};
  for (const r of rows ?? []) {
    const type = bowlingType(r.bowlingStyle);
    if (!type || !(r.balls > 0)) continue;
    const t = (by[type] ??= { type, balls: 0, runs: 0, out: 0 });
    t.balls += r.balls; t.runs += r.runs; t.out += r.dismissals ?? 0;
  }
  return ["pace", "spin"].map((k) => by[k]).filter(Boolean);
}

/** "42 off 31 balls, out twice" @param {{balls: number, runs: number, out: number}} t */
export function matchupWords(t) {
  const out = t.out === 0 ? "not out" : t.out === 1 ? "out once" : `out ${t.out} times`;
  return `${t.runs} off ${t.balls} ball${t.balls === 1 ? "" : "s"}, ${out}`;
}

// ── What the tab never says (§4) ───────────────────────

/**
 * The words that would make the tab a leak: an injury, a fitness word, a
 * guideline, an availability, a reason, a win chance. The walk reads every
 * word of the tab against this; so does the unit test, against the screen's
 * own strings.
 */
export const NEVER_ON_THE_TAB =
  /injur|fitness|\bfit\b|physio|rehab|restrict|return date|guideline|workload|\bload\b|wellness|available|unavailable|doubtful|availability|\breason|because|\bwhy\b|threat|probab|win chance|chance of winning/i;

// ── The match's terms, and the over story ──────────────

/**
 * The play conditions the events read gave the fold, in the shape the pad's
 * own words take (scorer/conditionsLine.jsx): the frozen document's play
 * part, its sources and its version's title. Null where the match has no
 * document (every match before SCRBRD-114) — and no cap line is then drawn.
 * @param {any} fold  the `fold` of GET /api/matches/:id/events
 */
export function termsOf(fold) {
  if (!fold?.conditions || typeof fold.conditions !== "object") return null;
  return { conditions: fold.conditions, sources: fold.conditionsSources ?? null,
           title: fold.conditionsTitle ?? null, version: fold.conditionsVersion ?? null, fixed: fold.conditionsFixed === true };
}

/**
 * The over story: each finished over of one innings in the commentary
 * generator's own words (deterministic; the over's summary line), newest
 * first. `limit` the last N overs, or all of them.
 * @param {{innings: number, over: number, kind: string, key: string, text: string, ball: number}[]} commentary
 * @param {number} innings
 * @param {number | null} [limit]
 * @returns {{key: string, over: number, text: string}[]}
 */
export function overStory(commentary, innings, limit = null) {
  const rows = commentaryByOver(commentary ?? []).filter((g) => g.innings === innings && g.end?.text)
    .map((g) => ({ key: g.key, over: g.over + 1, text: String(g.end.text) }));
  return limit == null ? rows : rows.slice(0, limit);
}

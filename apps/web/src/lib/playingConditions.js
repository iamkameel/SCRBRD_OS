/**
 * A competition's playing conditions, in words (SCRBRD-114 §7, §8).
 *
 * The rules are the database's; the API passes each write to the function that
 * decides it (services/api/write/playing-conditions-api.mjs). This module holds
 * none of them. It only turns what the API answers into sentences a league
 * organiser can act on, and what she types into what the API takes: the label
 * for each key, a figure's value and unit, where it came from, how many are
 * confirmed, and a refusal's reason.
 *
 * No colour and no token in here, so the suite can run it under plain node.
 */

/** Each key's name for a person, and what the platform does with it until a league says. */
export const KEY_WORDS = {
  "format.kind":                          { label: "Format", byDefault: "as the match's own format says" },
  "format.overs_per_innings":             { label: "Overs an innings", byDefault: "the match's own overs, else 20" },
  "format.innings_per_side":              { label: "Innings a side", byDefault: "1; 2 for a two-day or longer match" },
  "format.free_hit":                      { label: "Free hit after a no-ball", byDefault: "as the match's format decides" },
  "bowling.max_overs_per_bowler_innings": { label: "Overs a bowler, an innings", byDefault: "no cap", none: "No cap", hint: "T20 leagues commonly use 4." },
  "bowling.limit":                        { label: "Bowling limit, by age band", byDefault: "the platform's junior bowling directive", none: "No limit" },
  "result.min_overs_per_side":            { label: "Fewest overs for a result", byDefault: "none: the umpires decide", none: "None" },
  "result.tie_break":                     { label: "Tie break", byDefault: "none: a tie is a tie" },
  "points.win":                           { label: "Points for a win", byDefault: "the ladder as the school types it" },
  "points.tie":                           { label: "Points for a tie", byDefault: "the ladder as the school types it" },
  "points.draw":                          { label: "Points for a draw", byDefault: "the ladder as the school types it" },
  "points.no_result":                     { label: "Points for no result", byDefault: "the ladder as the school types it" },
  "points.loss":                          { label: "Points for a loss", byDefault: "the ladder as the school types it" },
  "points.abandoned":                     { label: "Points for an abandoned match", byDefault: "the ladder as the school types it" },
  "bonus.kind":                           { label: "Bonus points", byDefault: "none" },
  "bonus.params":                         { label: "Bonus point settings", byDefault: "none", none: "None" },
  "nrr.method":                           { label: "Net run rate", byDefault: "standard" },
  "table.order":                          { label: "Ladder order", byDefault: "points, then wins, then net run rate" },
  "over_rate.kind":                       { label: "Over-rate penalty", byDefault: "none" },
  "eligibility.age_on":                   { label: "Age counted on", byDefault: "the season's cut-off date" },
  "eligibility.max_age_open":             { label: "Oldest player in an Open team", byDefault: "no limit", none: "No limit" },
  "eligibility.bona_fide_scholar":        { label: "Bona fide scholar attested", byDefault: "not asked" },
  "over.max_balls":                       { label: "Most balls in an over" },
  "over.free_hit_falls_away_on_last_ball": { label: "Free hit falls away on the last ball" },
  "batting.retire_at_runs":               { label: "Batter retires at" },
  "pitch.length_m":                       { label: "Pitch length" },
  "ball.weight_g":                        { label: "Ball weight" },
  "fielding.powerplay":                   { label: "Powerplay" },
  // SCRBRD-130: the rain rule. G50 has no platform figure: the league states one, with its source.
  "target.method":                        { label: "Rain rule: how a revised target is set", byDefault: "the umpires' revision, recorded as announced" },
  "target.g50":                           { label: "DLS G50 (average full-innings score)", byDefault: "not set: the DLS calculator answers only where it is not needed", none: "Not set", hint: "Enter the figure your league's document gives (the ICC's section 06 states one for lower levels of the game), and cite it." },
  "bowling.rest_overs_between_spells":    { label: "Rest between spells" },
  "eligibility.max_overage_players":      { label: "Overage players allowed" },
};

/** The three parts of the catalogue, in the order a reader wants them. */
export const PARTS = [
  { part: "play",  title: "Play",  sub: "How the match is played" },
  { part: "table", title: "Table", sub: "Points, bonus points and the ladder" },
  { part: "sheet", title: "Sheet", sub: "Who may be picked" },
];

/**
 * The platform's own spell and day for a band, as the two halves a table shows.
 * They arrive in the catalogue (platformDefault of bowling.limit: db/08's
 * bowling_directive, read by the API), so this screen holds no copy of them.
 * @param {{ platformDefault?: any }} entry @param {string} band
 * @returns {{ spell: number | null, day: number | null }}
 */
export const bandDefault = (entry, band) => entry.platformDefault?.[band] ?? { spell: null, day: null };

const ENUM_WORDS = {
  limited: "Limited overs", declaration: "Declaration", timed: "Timed",
  none: "None", super_over: "Super over",
  run_rate_ratio: "Run rate ratio", batting_bowling: "Batting and bowling",
  standard: "Standard", points: "Points", runs: "Runs",
  wins: "Wins", nrr: "Net run rate", head_to_head: "Head to head", fewer_losses: "Fewer losses",
  umpires_revision: "The umpires' revision", dls_standard: "DLS Standard Edition",
};

/** @param {string} key */
export const labelOf = (key) => KEY_WORDS[key]?.label ?? key;

/**
 * A date as the API sends it: a plain "YYYY-MM-DD" (the API casts every date
 * column in SQL), or nothing. Anything else is not a day.
 * @param {unknown} v @returns {string} "YYYY-MM-DD" or ""
 */
export function dayOf(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

/** "15 Sep 2026". @param {unknown} v */
export function formatDay(v) {
  const d = dayOf(v);
  return d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}

/** "15 Sep 2026, 14:03", in the reader's zone. @param {unknown} v */
export function formatWhen(v) {
  if (!v) return "";
  const t = new Date(String(v));
  return Number.isNaN(t.getTime()) ? "" : `${t.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}, ${t.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`;
}

const enumWord = (/** @type {string} */ v) => ENUM_WORDS[v] ?? String(v).replace(/_/g, " ");

/**
 * A figure's value, with its unit.
 * @param {{ key: string, type: string, unit: string | null }} entry
 * @param {any} value
 */
export function valueWords(entry, value) {
  if (value === null || value === undefined) return KEY_WORDS[entry.key]?.none ?? "None";
  switch (entry.type) {
    case "bool": return value ? "Yes" : "No";
    case "int": return entry.unit ? `${value} ${value === 1 && entry.unit === "overs" ? "over" : entry.unit}` : String(value);
    case "enum": return enumWord(value);
    case "date": return formatDay(value);
    case "list": return Array.isArray(value) ? value.map(enumWord).join(", then ") : String(value);
    case "object":
      if (entry.key === "bowling.limit" && typeof value === "object") return `${oversCell(value.spell)} a spell, ${oversCell(value.day)} a day`;
      return JSON.stringify(value);
    default: return String(value);
  }
}

/** One half of a bowling limit, for its table cell. @param {any} n */
export const oversCell = (n) => (n == null ? "no limit" : `${n} ${n === 1 ? "over" : "overs"}`);

/**
 * What the platform does for a figure nobody has entered.
 * @param {{ key: string, type: string, unit: string | null, platformDefault: any }} entry
 * @param {string | null} band
 */
export function platformDefaultWords(entry, band = null) {
  if (entry.key === "bowling.limit") {
    return band ? valueWords(entry, bandDefault(entry, band)) : "No limit";
  }
  if (entry.platformDefault != null) return valueWords(entry, entry.platformDefault);
  return KEY_WORDS[entry.key]?.byDefault ?? "nothing: not read yet";
}

/**
 * Where a confirmed figure comes from: "KZNCU Schools Bye-laws, clause 7.3, 15 Sep 2026".
 * @param {{ sourceDocument?: string | null, sourceClause?: string | null, sourceDate?: unknown }} v
 */
export function sourceWords(v) {
  return [v.sourceDocument, v.sourceClause ? `clause ${v.sourceClause}` : null, formatDay(v.sourceDate) || null].filter(Boolean).join(", ");
}

/**
 * The figures a version can state, one per key, and one per band for a key
 * given by band. The reserved keys (read by nothing) are recorded, not applied,
 * and are not counted.
 * @param {{ keys: any[], ageBands?: string[] }} catalogue
 * @returns {{ key: string, band: string | null }[]}
 */
export function figureSlots(catalogue) {
  const slots = [];
  for (const k of catalogue.keys) {
    if (k.reserved) continue;
    if (k.byAgeBand) for (const b of catalogue.ageBands ?? []) slots.push({ key: k.key, band: b });
    else slots.push({ key: k.key, band: null });
  }
  return slots;
}

/**
 * "N of M figures confirmed" for a version's values.
 * @param {{ keys: any[], ageBands?: string[] }} catalogue
 * @param {{ key: string, ageBand: string | null, status: string }[]} values
 */
export function confirmedCount(catalogue, values) {
  const slots = figureSlots(catalogue);
  const done = slots.filter((s) => values.some((v) => v.key === s.key && (v.ageBand ?? null) === s.band && v.status === "confirmed"));
  return { confirmed: done.length, total: slots.length };
}

/**
 * Where a version stands, in one word. The API says which one is in force
 * today; a published one that is not in force is either still to come (its
 * day is later than the one in force) or has been replaced.
 * @param {any} set @param {any[]} sets @param {string | null} inForceToday
 * @returns {"draft" | "in_force" | "scheduled" | "superseded" | "withdrawn"}
 */
export function standing(set, sets, inForceToday) {
  if (set.status === "draft") return "draft";
  if (set.status === "withdrawn") return "withdrawn";
  if (set.id === inForceToday) return "in_force";
  const inForce = sets.find((s) => s.id === inForceToday);
  if (!inForce) return "scheduled";
  return dayOf(set.effectiveFrom) > dayOf(inForce.effectiveFrom) ? "scheduled" : "superseded";
}

/** @type {Record<string, string>} */
export const STANDING_WORDS = { draft: "Draft", in_force: "In force today", scheduled: "Published, not yet in force", superseded: "Replaced", withdrawn: "Withdrawn" };

// ── What she types → what the API takes ────────────────────────────

/**
 * The editor's starting state for a figure: what is entered now, or blank.
 * @param {{ key: string, type: string, values?: string[] | null }} entry
 * @param {any | undefined} existing an entered figure, as the API sends it
 */
export function draftOf(entry, existing) {
  const v = existing?.value;
  const has = existing !== undefined;
  const base = {
    status: existing?.status ?? "unconfirmed",
    document: existing?.sourceDocument ?? "", clause: existing?.sourceClause ?? "",
    date: dayOf(existing?.sourceDate), note: existing?.sourceNote ?? "",
    none: has && v === null, text: "", bool: has && typeof v === "boolean" ? v : false,
    spell: "", day: "", picked: /** @type {string[]} */ ([]), json: "",
  };
  if (!has) return base;
  if (entry.type === "object" && entry.key === "bowling.limit" && v) return { ...base, spell: v.spell == null ? "" : String(v.spell), day: v.day == null ? "" : String(v.day) };
  if (entry.type === "object") return { ...base, json: v == null ? "" : JSON.stringify(v) };
  if (entry.type === "list") return { ...base, picked: Array.isArray(v) ? [...v] : [] };
  return { ...base, text: v == null || typeof v === "boolean" ? "" : String(v) };
}

/**
 * The value the API takes from the editor's state, or { problem } when what
 * she typed is not a value at all (a blank, a number that is not one). Whether
 * it is a good value for the key is the database's to say.
 * @param {{ key: string, type: string }} entry
 * @param {ReturnType<typeof draftOf>} d
 * @returns {{ value: any } | { problem: string }}
 */
export function valueOfDraft(entry, d) {
  if (d.none) return { value: null };
  const whole = (/** @type {string} */ s) => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : NaN);
  switch (entry.type) {
    case "bool": return { value: !!d.bool };
    case "int": { const n = whole(d.text); return Number.isNaN(n) ? { problem: "Type a whole number." } : { value: n }; }
    case "enum": return d.text ? { value: d.text } : { problem: "Choose one." };
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(d.text) ? { value: d.text } : { problem: "Choose a date." };
    case "list": return d.picked.length ? { value: d.picked } : { problem: "Choose at least one, in the order they count." };
    case "object": {
      if (entry.key === "bowling.limit") {
        const one = (/** @type {string} */ s) => (s.trim() === "" ? null : whole(s));
        const spell = one(d.spell), day = one(d.day);
        if (Number.isNaN(spell) || Number.isNaN(day)) return { problem: "Spell and day are whole numbers of overs, or blank for no limit." };
        return { value: { spell, day } };
      }
      try { const v = JSON.parse(d.json); return v && typeof v === "object" ? { value: v } : { problem: "Give the figures as { \"name\": value }." }; }
      catch { return { problem: "Give the figures as { \"name\": value }." }; }
    }
    default: return { problem: "Not a figure the screen can enter." };
  }
}

// ── A refusal, in words ────────────────────────────────────────────

/** @type {Record<string, string>} */
const REFUSAL = {
  not_permitted: "You cannot change this competition's playing conditions.",
  support_session: "A support session cannot publish or withdraw. Sign in as yourself to do it.",
  not_a_draft: "Only a draft can be published, and this one is not a draft.",
  effective_from_not_future: "A version can only be published for a day after today, so that no match already begun changes its rules. Move the date to tomorrow or later, then publish.",
  effective_from_behind_latest: "Another version is already published from a later day. Move this one's date to that day or after.",
  effective_from_required: "Choose the day this version starts.",
  effective_from_invalid: "That is not a date.",
  title_invalid: "Give it a title of 3 to 120 characters.",
  published_is_immutable: "A published version cannot be changed. Make a new version from it, and change that.",
  no_such_key: "That is not a playing condition.",
  status_invalid: "Choose confirmed or unconfirmed.",
  citation_required: "A confirmed figure must say where it comes from: the document, the clause and the date of it. Fill those in, or mark the figure unconfirmed.",
  source_date_invalid: "The date of the document is not a date.",
  key_required: "Choose which figure.",
  value_required: "Give the figure a value.",
  note_required: "Say why, in at least 10 characters.",
  already_withdrawn: "This version is already withdrawn.",
  in_force: "This version is in force today, so it cannot be withdrawn. Correct it with a new version.",
  malformed: "That was not understood. Nothing was changed.",
  not_found: "That version was not found.",
};

/**
 * @param {any} e an ApiError (status, code, detail), or anything a fetch threw
 * @param {{ keys?: { key: string }[] }} [catalogue] to name a key the way the screen does
 */
export function refusalWords(e, catalogue) {
  const code = e?.code;
  if (code === "value_invalid") {
    let d = typeof e.detail === "string" ? e.detail : "";
    for (const k of catalogue?.keys ?? []) d = d.split(k.key).join(labelOf(k.key));
    return d ? `${d.charAt(0).toUpperCase()}${d.slice(1)}.` : "That is not a figure this can be.";
  }
  if (code === "title_invalid" && typeof e.detail === "string") return `Give it ${e.detail}.`;
  if (code && REFUSAL[code]) return REFUSAL[code];
  return e?.status ? `Not changed. The server said ${code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was changed.";
}

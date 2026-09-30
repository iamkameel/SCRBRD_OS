/**
 * Making a league and planning its fixtures, in words (SCRBRD-123, SCRBRD-127;
 * docs/design/SCRBRD-123_planner.md §5.5 and §5.7).
 *
 * The rules are the database's and the API's: who may create a league, who may
 * answer an invitation, what a plan may place, what publishing refuses. This
 * module holds none of them. It turns what the API answers into sentences an
 * organiser or a school can act on (an entrant's standing, a refusal, the
 * reasons a fixture has no slot, the outcome of publishing one fixture) and
 * what she types into what the API takes (the rules' whole minutes, a slot's
 * instant). It also groups a plan for the two views of it: a list by round or
 * by day, and a bracket.
 *
 * South African time is UTC+2 all year (no daylight saving), so a day or a
 * clock time is worked out with a fixed two-hour offset rather than a zone
 * database; that is also how the server dates a day (`sa_today()`).
 *
 * No colour and no token in here, so the suite can run it under plain node.
 */

/** The formats the league route takes (db/67 competition_create). */
export const LEAGUE_FORMATS = [
  { value: "T20", label: "T20", hint: "Twenty overs an innings." },
  { value: "One-Day", label: "One-Day", hint: "Fifty overs an innings." },
  { value: "One-Day Declaration", label: "One-Day Declaration", hint: "Timed: each side declares. The planner needs the match length from you." },
  { value: "Two-Day", label: "Two-Day", hint: "Two innings a side over two days. The planner needs the match length from you." },
];

export const COMP_TYPES = [
  { value: "league", label: "League" },
  { value: "knockout", label: "Knockout cup" },
  { value: "festival", label: "Festival" },
];

export const LEVELS = [
  { value: "school", label: "School" },
  { value: "club", label: "Club" },
  { value: "provincial", label: "Provincial" },
  { value: "national", label: "National" },
];

export const GENDERS = [
  { value: "", label: "Not stated" },
  { value: "boys", label: "Boys" },
  { value: "girls", label: "Girls" },
  { value: "mixed", label: "Mixed" },
];

/** Suggestions for the age group / team level box; the API takes any label of up to 20 characters. */
export const AGE_GROUPS = ["1XI", "2XI", "3XI", "Open", "U19", "U16", "U15", "U14", "U13", "U12", "U11", "U10"];

/** The team codes a school is most often invited with; the API checks the rest. */
export const TEAM_CODES = ["1XI", "2XI", "3XI", "4XI", "U19A", "U16A", "U15A", "U14A", "U13A", "U12A", "U11A", "U10A"];

export const WIZARD_STEPS = [
  { n: 1, title: "The league", short: "League" },
  { n: 2, title: "Entrants", short: "Entrants" },
  { n: 3, title: "Playing conditions", short: "Conditions" },
  { n: 4, title: "Review and publish", short: "Publish" },
];

// ── Days and times (South African, UTC+2) ─────────────────────────

const SA_OFFSET_MS = 2 * 60 * 60 * 1000;

/** The South African day of an instant: "YYYY-MM-DD", or "". @param {unknown} iso */
export function saDay(iso) {
  const t = Date.parse(String(iso ?? ""));
  return Number.isNaN(t) ? "" : new Date(t + SA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The South African clock time of an instant: "HH:MM", or "". @param {unknown} iso */
export function saTime(iso) {
  const t = Date.parse(String(iso ?? ""));
  return Number.isNaN(t) ? "" : new Date(t + SA_OFFSET_MS).toISOString().slice(11, 16);
}

/** Today in South Africa, from this device's clock (the server decides what counts as today). @param {number} [now] */
export const saToday = (now = Date.now()) => saDay(new Date(now).toISOString());

/** A day some days on from another. @param {string} day @param {number} n */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Sat 8 Aug". @param {unknown} day */
export function dayWords(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    : "";
}

/** "Sat 8 Aug, 09:00 to 13:00" (or across two days). @param {unknown} startsAt @param {unknown} endsAt */
export function slotWords(startsAt, endsAt) {
  const d = saDay(startsAt);
  if (!d) return "";
  const end = saDay(endsAt);
  const to = !endsAt ? "" : end === d ? ` to ${saTime(endsAt)}` : ` to ${dayWords(end)}, ${saTime(endsAt)}`;
  return `${dayWords(d)}, ${saTime(startsAt)}${to}`;
}

/** The instant a day and a clock time make, in South Africa. @param {string} day @param {string} hhmm */
export const instantOf = (day, hhmm) => `${day}T${hhmm}:00+02:00`;

/** A day's first instant. @param {string} day */
export const startOfDay = (day) => instantOf(day, "00:00");

// ── An entrant's standing ─────────────────────────────────────────

/** @type {Record<string, string>} */
export const ENTRANT_STATUS = { invited: "Invited", accepted: "Accepted", declined: "Declined" };

/**
 * What an entrant's standing means for the organiser, in a sentence. The
 * organiser can never answer for a school: only someone who arranges that
 * school's fixtures can (the API says not_permitted, even to a platform-wide
 * league administrator), so the screen says so instead of offering a button.
 * @param {{ status: string, name?: string }} e @param {boolean} [forOrganiser]
 */
export function entrantWords(e, forOrganiser = true) {
  if (e.status === "accepted") return "Accepted. This side will be drawn in the fixtures.";
  if (e.status === "declined") return forOrganiser ? "Declined. It will not be drawn. You may invite it again." : "Declined.";
  return forOrganiser
    ? "Waiting for the school to answer. Only the school can accept for its own side: you run the league, so you cannot accept on its behalf."
    : "Waiting for your answer.";
}

/** @param {{ status: string }[]} entrants */
export function entrantCounts(entrants) {
  const n = { invited: 0, accepted: 0, declined: 0 };
  for (const e of entrants) if (e.status in n) n[/** @type {keyof typeof n} */ (e.status)] += 1;
  return n;
}

/** "3 accepted, 1 declined, 0 waiting". @param {{ status: string }[]} entrants */
export function entrantSummary(entrants) {
  const c = entrantCounts(entrants);
  return `${c.accepted} accepted, ${c.declined} declined, ${c.invited} waiting`;
}

// ── Where the wizard picks up ─────────────────────────────────────

/**
 * The step a league that already exists opens at: the first whose work is not
 * done. Everything the wizard makes is saved on the server as it goes, so
 * "come back" is this, from what is there.
 * @param {{ entrants: number, sets: { status: string }[] }} have
 * @returns {1 | 2 | 3 | 4}
 */
export function resumeStep({ entrants, sets }) {
  if (entrants === 0) return 2;
  if (!sets.length || sets.some((s) => s.status === "draft")) return 3;
  return 4;
}

// ── Checklist rows (wizard, step 3) ───────────────────────────────

const STARTED = /^(Platform default|Platform fast-bowling directive|From the competition's format)/;
const COPIED = /Copied from /;

/**
 * Where an entered figure of a started draft stands:
 *   none      nothing entered: the platform's default applies, unconfirmed
 *   default   pre-filled by "start from defaults": the platform's figure, unconfirmed
 *   copied    copied from another league (its citation with it, if it had one)
 *   own       the league's own figure
 * @param {{ status: string, sourceNote?: string | null } | undefined} entered
 * @returns {"none" | "default" | "copied" | "own"}
 */
export function figureKind(entered) {
  if (!entered) return "none";
  const note = entered.sourceNote ?? "";
  if (entered.status !== "confirmed" && STARTED.test(note)) return "default";
  if (COPIED.test(note)) return "copied";
  return "own";
}

/** The id of a row a tick belongs to. @param {string} key @param {string | null} band */
export const slotId = (key, band) => (band ? `${key}|${band}` : key);

/**
 * How the review counts a draft's figures.
 * @param {{ key: string, band: string | null }[]} slots
 * @param {{ key: string, ageBand: string | null, status: string, sourceNote?: string | null }[]} values
 * @param {Set<string>} ticked
 */
export function checklistCounts(slots, values, ticked) {
  const n = { total: slots.length, confirmed: 0, own: 0, ticked: 0, unchecked: 0 };
  for (const s of slots) {
    const v = values.find((x) => x.key === s.key && (x.ageBand ?? null) === s.band);
    const kind = figureKind(v);
    if (v?.status === "confirmed") n.confirmed += 1;
    else if (kind === "own" || kind === "copied") n.own += 1;
    else if (ticked.has(slotId(s.key, s.band))) n.ticked += 1;
    else n.unchecked += 1;
  }
  return n;
}

/**
 * The ticks a person has made on a draft are kept in this browser only: the
 * API has nowhere to store "I checked this default", and a tick changes no
 * figure. Reading and writing never throw (storage can be blocked).
 * @param {string} setId
 * @returns {Set<string>}
 */
export function loadTicks(setId) {
  try {
    const raw = globalThis.localStorage?.getItem(`scrbrd:league-ticks:${setId}`);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
  } catch { return new Set(); }
}

/** @param {string} setId @param {Set<string>} ticked */
export function saveTicks(setId, ticked) {
  try { globalThis.localStorage?.setItem(`scrbrd:league-ticks:${setId}`, JSON.stringify([...ticked])); } catch { /* storage blocked: the ticks are for this visit */ }
}

// ── The planner's rules (what she types → what the API takes) ─────

/** The rules, in the order the form shows them. Ranges are the engine's (docs §2). */
export const RULE_FIELDS = [
  { key: "durationMinutes", label: "Match length", unit: "minutes", min: 15, max: 10080, help: "From the first ball to the last. Left blank, the league's format decides (a T20 is 180 minutes)." },
  { key: "preparationMinutes", label: "Preparation before the match", unit: "minutes", min: 0, max: 720, help: "Time on the ground before the start, for the pitch and the toss." },
  { key: "recoveryMinutes", label: "Recovery after the match", unit: "minutes", min: 0, max: 720, help: "Time the ground is kept after the match, for the roller and the stumps." },
  { key: "restMinutes", label: "Rest between a side's matches", unit: "minutes", min: 0, max: 20160, help: "1440 is one day, 4320 is three." },
  { key: "travelMinutes", label: "Travel between different grounds", unit: "minutes", min: 0, max: 1440, help: "One figure for every pair of grounds: the planner does not guess distances." },
  { key: "maxPerDay", label: "Most matches a side plays in a day", unit: "matches", min: 1, max: 8, help: "" },
];

/**
 * The rules the API takes from the form's text: whole numbers, blanks left out.
 * Whether a figure is in range is the engine's to say; this only refuses what
 * is not a whole number.
 * @param {Record<string, string>} form
 * @returns {{ rules: Record<string, number>, problem?: string }}
 */
export function rulesOfForm(form) {
  /** @type {Record<string, number>} */ const rules = {};
  for (const f of RULE_FIELDS) {
    const s = String(form[f.key] ?? "").trim();
    if (s === "") continue;
    if (!/^\d+$/.test(s)) return { rules, problem: `${f.label}: type a whole number of ${f.unit}, or leave it blank.` };
    rules[f.key] = Number(s);
  }
  return { rules };
}

/** A plan's rules as the form's text. @param {Record<string, number | null | undefined> | null | undefined} rules */
export function formOfRules(rules) {
  /** @type {Record<string, string>} */ const out = {};
  for (const f of RULE_FIELDS) out[f.key] = rules?.[f.key] == null ? "" : String(rules[f.key]);
  return out;
}

export const PLAN_FORMATS = [
  { value: "round_robin", label: "Round robin", hint: "Every side plays every other once." },
  { value: "double_round_robin", label: "Double round robin", hint: "Every pair meets twice, with the home side reversed." },
  { value: "knockout", label: "Knockout", hint: "Seeded by the order below; a loser is out. Later rounds wait for their winners." },
];

/** @param {string} f */
export const planFormatWords = (f) => PLAN_FORMATS.find((x) => x.value === f)?.label ?? String(f).replace(/_/g, " ");

/** @type {Record<string, string>} */
export const PLAN_STATE_WORDS = { draft: "Draft", published: "Published", superseded: "Replaced" };

// ── A plan, for the two views ─────────────────────────────────────

/**
 * One side of a fixture: its name, or who it waits for ("Winner of R1 · Match 2").
 * @param {{ entrantId?: string, name?: string, winnerOf?: string } | null | undefined} side
 * @param {{ fixtures: { id: string, round: number, match: number }[] }} plan
 */
export function sideWords(side, plan) {
  if (!side) return "To be decided";
  if (side.winnerOf) {
    const f = plan.fixtures.find((x) => x.id === side.winnerOf);
    return f ? `Winner of R${f.round} · Match ${f.match}` : "Winner of an earlier match";
  }
  return side.name || "A side";
}

const byTime = (/** @type {any} */ a, /** @type {any} */ b) =>
  (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity) || (a.match ?? 0) - (b.match ?? 0);

/**
 * The fixtures in groups for a list: by round (each round's fixtures in time
 * order), or by day (fixtures with a slot, then those without one).
 * @param {{ fixtures: any[] }} plan @param {"round" | "day"} by
 * @returns {{ key: string, title: string, fixtures: any[] }[]}
 */
export function planGroups(plan, by) {
  const out = /** @type {Map<string, { key: string, title: string, fixtures: any[] }>} */ (new Map());
  const add = (/** @type {string} */ key, /** @type {string} */ title, /** @type {any} */ f) => {
    if (!out.has(key)) out.set(key, { key, title, fixtures: [] });
    /** @type {any} */ (out.get(key)).fixtures.push(f);
  };
  if (by === "round") {
    for (const f of [...plan.fixtures].sort((a, b) => a.round - b.round || byTime(a, b))) add(`r${f.round}`, `Round ${f.round}`, f);
  } else {
    for (const f of [...plan.fixtures].sort(byTime)) {
      const d = f.startsAt ? saDay(f.startsAt) : "";
      add(d || "none", d ? dayWords(d) : "No slot", f);
    }
  }
  return [...out.values()];
}

/** The rounds of a knockout, left to right. @param {{ fixtures: any[] }} plan */
export function bracketRounds(plan) {
  const rounds = [...new Set(plan.fixtures.map((f) => f.round))].sort((a, b) => a - b);
  const last = rounds.length ? rounds[rounds.length - 1] : 0;
  return rounds.map((r) => ({
    round: r,
    title: r === last ? "Final" : r === last - 1 ? "Semi-finals" : r === last - 2 ? "Quarter-finals" : `Round ${r}`,
    fixtures: plan.fixtures.filter((f) => f.round === r).sort((a, b) => a.match - b.match),
  }));
}

/**
 * The locks a click makes: every lock the draft holds, with this fixture's
 * added or taken off. The API replaces the whole list.
 * @param {{ fixtureId: string, windowId: string }[]} locks @param {{ id: string, windowId: string | null, locked: boolean }} f
 */
export function toggledLocks(locks, f) {
  const rest = locks.filter((l) => l.fixtureId !== f.id);
  return f.locked || !f.windowId ? rest : [...rest, { fixtureId: f.id, windowId: f.windowId }];
}

// ── Publishing, in words ──────────────────────────────────────────

/** @type {Record<string, string>} */
export const OUTCOME_WORDS = { created: "Created", already: "Already made", refused: "Refused", held: "Held back" };

/**
 * One fixture's result of publishing, in a sentence.
 * @param {{ outcome: string, error?: string, detail?: string, reasons?: { text: string }[], held?: string, text?: string, startsAt?: string, sharedWithOpponent?: boolean }} r
 */
export function outcomeWords(r) {
  if (r.outcome === "created") return `A match was made for ${slotWords(r.startsAt, null)}${r.sharedWithOpponent ? ". The opponent's school sees it too." : "."}`;
  if (r.outcome === "already") return "This fixture already has its match, from an earlier publish. Nothing was made twice.";
  if (r.outcome === "held") return r.text || "Held back: it will be made when it can be.";
  return refusedWords(r);
}

/** @type {Record<string, string>} */
const REFUSED = {
  clash: "The slot no longer fits: something was booked, closed or blacked out since this draft was made.",
  window_withdrawn: "The ground withdrew the slot this fixture was placed in.",
  match_not_in_competition: "The match this fixture made belongs to another competition.",
  not_permitted: "You may not arrange this school's fixture.",
  no_such_school_ground_or_sport: "The school, the ground or the sport could not be found.",
  invalid_fixture: "The fixture was not valid.",
};

/** @param {{ error?: string, detail?: string, reasons?: { text: string }[] }} r */
export function refusedWords(r) {
  const base = REFUSED[r.error ?? ""] ?? `The fixture was refused (${r.error || "no reason given"}).`;
  const why = r.reasons?.length ? ` ${r.reasons.map((x) => x.text).join(" ")}` : r.detail ? ` ${cap(String(r.detail))}${/[.!?]$/.test(String(r.detail)) ? "" : "."}` : "";
  return `${base}${why}`;
}

/** @param {string} s */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── A refusal, in words ───────────────────────────────────────────

/** @type {Record<string, string>} */
const REFUSAL = {
  not_permitted: "You may not do this.",
  support_session: "A support session cannot do this. Sign in as yourself.",
  organiser_invalid: "That organising school could not be found.",
  name_invalid: "Give the league a name of 3 to 120 characters.",
  comp_type_invalid: "Choose league, knockout cup or festival.",
  level_invalid: "Choose school, club, provincial or national.",
  format_invalid: "Choose one of the formats offered.",
  label_too_long: "The age group and gender are at most 20 characters each.",
  season_unknown: "No season with that name exists at that level. Choose one from the list.",
  nothing_to_change: "Nothing has changed.",
  has_fixtures: "This league already has a match or a published plan, so its name and season are fixed.",
  school_invalid: "That school could not be found.",
  team_invalid: "That is not a team. Use 1XI to 20XI, or U9 to U19 with a letter A to F (U15A).",
  display_name_invalid: "The name shown for the side is not valid.",
  not_invited: "That invitation has already been answered.",
  from_invalid: "Choose where to start from.",
  already_started: "The playing conditions are already started. Open them to change them.",
  source_invalid: "That league could not be found, or you may not read it.",
  source_has_no_conditions: "That league has no playing conditions in force today, so there is nothing to copy.",
  title_invalid: "Give the conditions a title of 3 to 120 characters.",
  effective_from_invalid: "That is not a date.",
  effective_from_not_future: "Conditions can only start on a day after today, so that no match already begun changes its rules. Choose tomorrow or later.",
  effective_from_behind_latest: "Another version already starts on a later day. Choose that day or after.",
  range_invalid: "Choose a first and last day, the first not after the last, no more than a year apart.",
  rules_invalid: "One of the rules is not a whole number of minutes.",
  locks_invalid: "That lock could not be made.",
  entrants_invalid: "The sides chosen are not all in this league, or one is repeated.",
  too_few_entrants: "A draw needs at least two sides that have accepted.",
  too_many_entrants: "A draw has at most 16 sides.",
  duration_required: "This format has no fixed length. Type the match length in minutes.",
  not_a_draft: "Only a draft can be changed. Generate a new version from this one.",
  superseded: "A newer version has replaced this one. Open the latest version.",
  day_invalid: "Choose a day.",
  reason_invalid: "The reason is not text.",
  reason_too_long: "The reason is at most 120 characters.",
  entrant_invalid: "That side is not in this league.",
  starts_at_invalid: "Choose a day and a start time.",
  ends_at_invalid: "Choose an end time.",
  window_invalid: "A slot must end after it starts, and last no more than a week.",
  competition_invalid: "That league could not be found.",
  to_invalid: "Choose the last day.",
  closure_invalid: "A closure must end after it starts.",
  reason_required: "Say why, in 3 to 120 characters.",
  ends_invalid: "Name both ends, 2 to 40 characters each and different, or clear both.",
  not_found: "That could not be found.",
  malformed: "That was not understood. Nothing was changed.",
};

/**
 * @param {any} e an ApiError (status, code, detail), or anything a fetch threw
 * @param {(e: any) => string} [fallback] for codes belonging to another screen (the playing conditions' own)
 */
export function leagueRefusal(e, fallback) {
  const code = e?.code;
  if (code === "plan_input_invalid") return typeof e.detail === "string" && e.detail ? `The planner cannot use these inputs: ${e.detail}${/[.!?]$/.test(e.detail) ? "" : "."}` : "The planner cannot use these inputs.";
  if (code === "not_a_draft" && typeof e.detail === "string") return `${REFUSAL.not_a_draft} (This one is ${e.detail}.)`;
  if (code === "window_invalid" && typeof e.detail === "string" && e.status === 422) return `A slot must end after it starts and last no more than a week. ${cap(e.detail)}`;
  if (code && REFUSAL[code]) return REFUSAL[code];
  if (fallback) return fallback(e);
  return e?.status ? `Not changed. The server said ${code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was changed.";
}

import { DISMISSAL_LABEL, REFUSAL_TEXT, foldName } from "@scrbrd/scoring";

/**
 * What the pad's prompts offer first, and what its undo says (SCRBRD-100
 * items 2 and 5). Pure: the sheets and the strip draw these; nothing here
 * records anything, and nothing here decides who MAY bowl — that is the
 * Laws check's, asked through `refuses` (lawsRefusal over the pad's own
 * fold), so a rule added to it is honoured here without a line changing.
 */

/** A squad row, as the sheets have always read one: a bare name or {id, name}. */
export const entry = (p) => (typeof p === "string" ? { id: p, name: p } : { id: p?.id ?? p?.name, name: p?.name ?? p?.id });

/** The bowler of an over (0-based), as the fold logged it: the one who finished it. */
function bowlerOfOver(inn, over) {
  const log = inn?.ballLog ?? [];
  for (let k = log.length - 1; k >= 0; k--) if (log[k].over === over) return log[k].bowlerId ?? null;
  return null;
}

/**
 * The new-over prompt's list, in the order it offers it:
 *
 *   1. THE LIKELY BOWLER — the one who bowled the over before last, when the
 *      Laws would let him bowl this one. A suggestion: he is marked and
 *      first, and one tap on him (or anyone) confirms.
 *   2. The rest of the rotation, in the order they first bowled.
 *   3. Those who have not bowled, in the squad's order.
 *
 * Anyone the Laws check refuses — the man who bowled the last over, and
 * whatever else lawsRefusal() refuses — stays in his place, unavailable,
 * with the reason in words. Mid-over (a bowler taking over) and before the
 * first over there is no likely bowler.
 *
 * @param {object} o
 * @param {object | null} o.inn       the folded innings
 * @param {Array} o.roster            the sheet's list: {id, name, role}
 * @param {(id: string) => string | null} [o.refuses]  lawsRefusal() for a bowler event naming `id`
 * @param {boolean} [o.midOver]
 * @returns {{likelyId: string | null, rows: {id: string, name: string, role: string | null,
 *   figures: {balls: number, runs: number, wickets: number} | null, refusal: string | null,
 *   likely: boolean, group: "likely" | "bowled" | "fresh"}[]}}
 */
export function bowlerChoices({ inn, roster = [], refuses, midOver = false }) {
  const refusal = (id) => (refuses ? refuses(id) ?? null : null);
  const byId = new Map(roster.map((p) => [p.id, p]));
  const bowled = (inn?.bowlers ?? []).map((b) => ({
    id: b.id, name: b.name, role: byId.get(b.id)?.role ?? null,
    figures: { balls: b.balls ?? 0, runs: b.runs ?? 0, wickets: b.wickets ?? 0 },
    refusal: refusal(b.id),
  }));
  const seen = new Set(bowled.map((b) => b.id));
  const fresh = roster.filter((p) => !seen.has(p.id)).map((p) => ({
    id: p.id, name: p.name, role: p.role ?? null, figures: null, refusal: refusal(p.id),
  }));
  const next = Math.floor((inn?.balls ?? 0) / 6);
  const candidate = !midOver && next >= 2 ? bowlerOfOver(inn, next - 2) : null;
  const likely = candidate != null ? bowled.find((b) => b.id === candidate && b.refusal == null) ?? null : null;
  const rows = [
    ...(likely ? [{ ...likely, likely: true, group: "likely" }] : []),
    ...bowled.filter((b) => b !== likely).map((b) => ({ ...b, likely: false, group: "bowled" })),
    ...fresh.map((b) => ({ ...b, likely: false, group: "fresh" })),
  ];
  return { likelyId: likely?.id ?? null, rows };
}

const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Words a screen shows carry no Law clause numbers (Kameel is checking them). */
export const noClause = (s) => String(s ?? "")
  .replace(/\s*\((?:Laws?)\s[^)]*\)/g, "")
  .replace(/[\s,—-]*\bLaws?\s+\d+(?:\.\d+)*\b/g, "")
  .trim();

/** Why a bowler cannot bowl this over, in words, from the Laws' refusal. */
export function unavailableWords(code) {
  if (!code) return null;
  if (code === "consecutive_overs") return "Bowled the last over";
  if (code === "mid_over_no_reason") return "Say injury or suspended first";
  const t = REFUSAL_TEXT[code];
  return t ? upperFirst(noClause(t)) : "Cannot bowl this over";
}

/**
 * The new-batter prompt's list: the batting order's next name first (the
 * squad's order is the batting order, as setup builds it), then the rest who
 * have not batted, in order. The first is marked Next: a suggestion — one tap
 * on any name sends him in.
 * @returns {{id: string, name: string, pos: number, next: boolean}[]}
 */
export function batterChoices({ squad = [], batsmen = [] }) {
  const roster = squad.map(entry);
  return roster
    .map((p, i) => ({ ...p, pos: i + 1 }))
    .filter((p) => {
      const played = batsmen.find((b) => b.id === p.id);
      return !played || played.status === "dnb";
    })
    .map((p, i) => ({ ...p, next: i === 0 }));
}

// ── Undo, in words ───────────────────────────────────────────────

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What undo will reverse, in words — "4 to R Pillay", "wide", "K Naidoo to
 * bowl" — from the event undo would take (lastUndoableIndex() of the innings
 * in play). Names from the fold's batters and bowlers, the board's own
 * source, and never an id (foldName). Null when there is nothing to undo.
 *
 * @param {object | null | undefined} ev   the event undo would reverse
 * @param {object | null | undefined} inn  the folded innings it is in
 * @returns {string | null}
 */
export function undoWords(ev, inn) {
  if (!ev) return null;
  const who = (id, role) => foldName(inn, id, role);
  // The striker who faced it: stamped on the event since SCRBRD-068's
  // follow-up; for an older one, the fold's own log of it.
  const faced = () => who(ev.striker ?? inn?.ballLog?.find((b) => b.id != null && b.id === ev.id)?.strikerId, "the batter");
  switch (ev.kind) {
    case "ball": {
      const v = Number(ev.value ?? 0);
      switch (ev.type ?? "run") {
        case "W": {
          const how = DISMISSAL_LABEL[ev.dismissal];
          const out = who(ev.dismissed ?? ev.striker, "the batter");
          return `wicket, ${out}${how ? ` ${how.toLowerCase()}` : " out"}`;
        }
        case "Wd": return v ? `wide and ${plural(v, "run")}` : "wide";
        case "Nb":
          if (!v) return "no ball";
          if (ev.nbRuns === "byes") return `no ball and ${plural(v, "bye")}`;
          if (ev.nbRuns === "leg_byes") return `no ball and ${plural(v, "leg bye")}`;
          return `no ball and ${v} to ${faced()}`;
        case "B": return plural(v, "bye");
        case "LB": return plural(v, "leg bye");
        default: return v ? `${v} to ${faced()}` : `dot ball to ${faced()}`;
      }
    }
    case "batters": {
      const names = [ev.striker, ev.nonStriker].filter((x) => x != null).map((id) => who(id, "a batter"));
      return names.length === 2 ? `${names[0]} and ${names[1]} in` : names.length ? `${names[0]} in` : "the batters";
    }
    case "bowler": return `${who(ev.bowler, "the bowler")} to bowl`;
    // SCRBRD-126: his name from the fold's own record of who kept, never an id.
    case "keeper": return `${foldName({ batsmen: inn?.keepers ?? [] }, ev.keeper, "the new keeper")} keeping wicket`;
    case "penalty": return `${plural(Number(ev.runs ?? 5), "penalty run")}${ev.toBattingTeam === false ? " to the fielding side" : ""}`;
    case "retire": {
      const n = who(ev.batter, "the batter");
      if (ev.type === "W") return ev.dismissal === "timed_out" || ev.reason === "timed_out" ? `${n} timed out` : `${n} retired out`;
      return ev.reason === "out" ? `${n} retired out` : `${n} retired hurt`;
    }
    case "revision": return "the revised overs or target";
    case "play_stopped": return "play stopped";      // SCRBRD-130 R1
    case "play_resumed": return "play resumed";      // SCRBRD-130 R1
    case "innings_end": return "closing the innings";
    default: return "the last entry";
  }
}

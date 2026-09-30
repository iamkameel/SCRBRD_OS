/**
 * The fixture planner's engine (SCRBRD-123): pairings, placement, drafts.
 *
 * docs/design/SCRBRD-123_planner.md. What this suite holds:
 *
 *   A. Round robins for 2–16 entrants, single and double: every pair once
 *      (twice, venues reversed), byes right for odd counts, a side at most
 *      once a round, venues balanced, ids stable under reordering
 *   B. Knockouts for 2–16: n − 1 fixtures, byes to the top seeds, 1 v 16 and
 *      8 v 9, every later side a winnerOf an earlier fixture (no cycles), no
 *      invented team
 *   C. Placement, rule by rule: a short window, no windows, an impossible
 *      timetable left partly unscheduled with the right reasons, blackout on
 *      a South African day that is another UTC day, rest and travel across
 *      two grounds, the daily cap counting known commitments, a closed parent
 *      field blocking its pitches, knockout rounds after their feeders
 *   D. Locks: held first, surviving regeneration, stale ones reported, a
 *      lock that now breaks a rule left unscheduled rather than moved
 *   E. Determinism and bounds: the same input twice deep-equal, window order
 *      irrelevant, the ceiling planned fast and checked by an independent
 *      validator, over-limit input refused
 *   F. Drafts: the fixture route's body, and what is held back and why
 *
 * The drafts are posted through the real route's validation in
 * services/api/write/planner-drafts.test.mjs.
 *
 *   node packages/scoring/test/planner.test.mjs
 */
import { deepStrictEqual } from "node:assert";
import {
  pairings, plan, toFixtureDrafts, PLAN_FORMAT, PLAN_REASON, PLAN_REASON_TEXT, LOCK_STALE, DRAFT_HELD,
} from "../src/planner.mjs";

/** @import { Pairings, PlanWindow, PlanRules, PlanKnown, PlanBlackout, PlanGround, PlanLock, Plan, PlanSide } from "../src/planner.mjs" */

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
/** @param {string} n @param {() => unknown} fn @param {RegExp} [match] */
const refused = (n, fn, match) => {
  try { fn(); ok(n, false, "not refused"); }
  catch (/** @type {any} */ e) { ok(n, e instanceof RangeError && (!match || match.test(e.message)), e.message); }
};

const ids = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);
const teams = (/** @type {number} */ n) => ids(n).map((id) => ({ id }));
const ent = (/** @type {PlanSide} */ s) => ("entrant" in s ? s.entrant : null);
const MIN = 60_000;

/**
 * A window on a South African wall clock: ("g1", "2026-10-03", "09:00", 4)
 * is 09:00–13:00 SAST on Saturday 3 October.
 * @param {string} id @param {string} groundId @param {string} day @param {string} hhmm @param {number} hours
 * @returns {PlanWindow}
 */
const win = (id, groundId, day, hhmm, hours) => {
  const from = Date.parse(`${day}T${hhmm}:00+02:00`);
  return { id, groundId, startsAt: new Date(from).toISOString(), endsAt: new Date(from + hours * 3_600_000).toISOString() };
};
/** An SAST wall-clock instant as ISO. */
const sast = (/** @type {string} */ day, /** @type {string} */ hhmm) => new Date(Date.parse(`${day}T${hhmm}:00+02:00`)).toISOString();
/** @type {PlanRules} */
const RULES = { durationMinutes: 180 };

// ════════════════════════════════════════════════════════════════════
group("A. Round robins, 2–16 entrants");
{
  for (const double of [false, true]) {
    for (let n = 2; n <= 16; n++) {
      const tag = `${double ? "double" : "single"} ${n}`;
      const p = pairings({ format: double ? PLAN_FORMAT.DOUBLE_ROUND_ROBIN : PLAN_FORMAT.ROUND_ROBIN, entrants: teams(n) });
      const legs = double ? 2 : 1;
      const perLeg = n % 2 ? n : n - 1;
      ok(`${tag}: ${perLeg * legs} rounds`, p.rounds === perLeg * legs, p.rounds);
      ok(`${tag}: n(n−1)/2 × legs fixtures`, p.fixtures.length === (n * (n - 1) / 2) * legs, p.fixtures.length);

      // Every ordered (home, away) and unordered pair.
      /** @type {Map<string, number>} */ const pairs = new Map();
      /** @type {Set<string>} */ const ordered = new Set();
      for (const f of p.fixtures) {
        const h = /** @type {string} */ (ent(f.home)), a = /** @type {string} */ (ent(f.away));
        const k = [h, a].sort().join("|");
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
        ordered.add(`${h}>${a}`);
      }
      ok(`${tag}: every pair meets exactly ${legs === 1 ? "once" : "twice"}`,
         pairs.size === n * (n - 1) / 2 && [...pairs.values()].every((c) => c === legs));
      if (double) ok(`${tag}: the return leg reverses the venue`, ordered.size === n * (n - 1));

      // A side at most once a round; a bye each round exactly when n is odd.
      let once = true, byeRight = true;
      for (let r = 1; r <= p.rounds; r++) {
        const inRound = p.fixtures.filter((f) => f.round === r).flatMap((f) => [ent(f.home), ent(f.away)]);
        if (new Set(inRound).size !== inRound.length) once = false;
        const byes = p.byes.filter((b) => b.round === r);
        if (byes.length !== n % 2) byeRight = false;
        if (byes.length && inRound.includes(byes[0].entrant)) byeRight = false;
      }
      ok(`${tag}: a side plays at most once a round`, once);
      ok(`${tag}: ${n % 2 ? "one bye a round, to a side not playing" : "no byes"}`, byeRight);
      if (n % 2) {
        const each = new Map(ids(n).map((id) => [id, p.byes.filter((b) => b.entrant === id).length]));
        ok(`${tag}: each side sits out ${legs} round(s)`, [...each.values()].every((c) => c === legs));
      }

      // Venues: as balanced as a round robin can be.
      const home = new Map(ids(n).map((id) => [id, 0])), away = new Map(ids(n).map((id) => [id, 0]));
      for (const f of p.fixtures) {
        home.set(/** @type {string} */ (ent(f.home)), (home.get(/** @type {string} */ (ent(f.home))) ?? 0) + 1);
        away.set(/** @type {string} */ (ent(f.away)), (away.get(/** @type {string} */ (ent(f.away))) ?? 0) + 1);
      }
      const spread = Math.max(...ids(n).map((id) => Math.abs((home.get(id) ?? 0) - (away.get(id) ?? 0))));
      ok(`${tag}: home and away ${double ? "equal" : "within one"}`, double ? spread === 0 : spread <= 1, spread);

      ok(`${tag}: ids unique`, new Set(p.fixtures.map((f) => f.id)).size === p.fixtures.length);
      ok(`${tag}: rounds numbered in order`, p.fixtures.every((f, i) => i === 0 || p.fixtures[i - 1].round <= f.round));
    }
  }
  const a = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(6) });
  const b = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(6).reverse() });
  ok("an id is the pair's: reordering the entrants keeps every id",
     JSON.stringify(a.fixtures.map((f) => f.id).sort()) === JSON.stringify(b.fixtures.map((f) => f.id).sort()));
  ok("a round-robin id reads as its pair and leg", a.fixtures.some((f) => f.id === "rr:t01:t02:1"));
  const one = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(1) });
  ok("one entrant: nothing to play", one.fixtures.length === 0 && one.byes.length === 0 && one.rounds === 0);
}

// ════════════════════════════════════════════════════════════════════
group("B. Knockouts, 2–16 entrants");
{
  for (let n = 2; n <= 16; n++) {
    const p = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(n) });
    let size = 1; while (size < n) size *= 2;
    const byId = new Map(p.fixtures.map((f) => [f.id, f]));
    ok(`${n}: n − 1 fixtures`, p.fixtures.length === n - 1, p.fixtures.length);
    ok(`${n}: log2(bracket) rounds`, p.rounds === Math.log2(size), p.rounds);
    ok(`${n}: ${size - n} byes, to seeds 1…${size - n}, all in round 1`,
       p.byes.length === size - n && p.byes.every((b) => b.round === 1)
       && JSON.stringify(p.byes.map((b) => b.entrant).sort()) === JSON.stringify(ids(n).slice(0, size - n)), p.byes);

    // Every winnerOf names an earlier-round fixture, each fixture feeds at
    // most one other, and exactly one (the final) feeds none.
    let earlier = true;
    /** @type {Map<string, number>} */ const fed = new Map();
    for (const f of p.fixtures) for (const s of [f.home, f.away]) {
      if ("winnerOf" in s) {
        const x = byId.get(s.winnerOf);
        if (!x || x.round >= f.round) earlier = false;
        fed.set(s.winnerOf, (fed.get(s.winnerOf) ?? 0) + 1);
      }
    }
    ok(`${n}: every winnerOf is an earlier round's fixture (no cycles)`, earlier);
    ok(`${n}: each fixture feeds at most one, and only the final feeds none`,
       [...fed.values()].every((c) => c === 1) && p.fixtures.filter((f) => !fed.has(f.id)).length === 1
       && p.fixtures.find((f) => !fed.has(f.id))?.round === p.rounds);

    // No invented team: every named side is an entrant; each entrant is
    // named once (its first match) or has a bye into round 2.
    const named = p.fixtures.flatMap((f) => [f.home, f.away]).flatMap((s) => ("entrant" in s ? [s.entrant] : []));
    ok(`${n}: every named side is an entrant, once`,
       named.every((e) => ids(n).includes(e)) && new Set(named).size === named.length);
    ok(`${n}: every entrant enters: a first match or a bye`,
       ids(n).every((e) => named.includes(e)) && p.byes.every((b) => named.includes(b.entrant) || n === 1));
    ok(`${n}: a bye is never a fixture: two sides, never one twice or none`,
       p.fixtures.every((f) => f.home && f.away && JSON.stringify(f.home) !== JSON.stringify(f.away)));
    ok(`${n}: ids unique`, byId.size === p.fixtures.length);
  }
  const p16 = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(16) });
  const r1 = p16.fixtures.filter((f) => f.round === 1).map((f) => `${ent(f.home)}v${ent(f.away)}`);
  ok("16: the standard draw, 1 v 16, 8 v 9, 4 v 13 … 6 v 11", JSON.stringify(r1) === JSON.stringify(
    ["t01vt16", "t08vt09", "t04vt13", "t05vt12", "t02vt15", "t07vt10", "t03vt14", "t06vt11"]), r1);
  const p5 = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(5) });
  const r2 = p5.fixtures.filter((f) => f.round === 2);
  ok("5: seed 1 meets the winner of 4 v 5; seeds 2 and 3 meet in round 2", r2.length === 2
     && ent(r2[0].home) === "t01" && "winnerOf" in r2[0].away && ent(r2[1].home) === "t02" && ent(r2[1].away) === "t03");
  const swapped = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: [...teams(4)].reverse() });
  const p4 = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(4) });
  ok("a redraw changes the knockout ids (a lock does not follow a different pair)",
     p4.fixtures.every((f) => !swapped.fixtures.some((g) => g.id === f.id && g.round === 1 && JSON.stringify(g.home) !== JSON.stringify(f.home))));
  ok("the final's id changes when who could reach it changes",
     pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: [...teams(3), { id: "x99" }] }).fixtures.at(-1)?.id !== p4.fixtures.at(-1)?.id);
  refused("an unknown format is refused", () => pairings({ format: /** @type {any} */ ("swiss"), entrants: teams(4) }), /unknown format/);
  refused("17 entrants are refused", () => pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(17) }), /at most 16/);
  refused("an entrant twice is refused", () => pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: [{ id: "a" }, { id: "a" }] }), /twice/);
  refused("an id with a colon is refused", () => pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: [{ id: "a:b" }, { id: "c" }] }), /usable id/);
}

// ════════════════════════════════════════════════════════════════════
group("C. Placement, rule by rule");
{
  const two = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(2) });
  const SAT = "2026-10-03", SUN = "2026-10-04";

  // A window long enough: preparation + duration + recovery.
  {
    const rules = { durationMinutes: 180, preparationMinutes: 30, recoveryMinutes: 30 };
    const short = plan({ pairings: two, rules, windows: [win("w1", "g1", SAT, "09:00", 3.5)] });
    ok("a window 30 minutes short: unscheduled, window_short", short.placed === 0
       && JSON.stringify(short.fixtures[0].reasons) === '["window_short"]', short.fixtures[0].reasons);
    const exact = plan({ pairings: two, rules, windows: [win("w1", "g1", SAT, "09:00", 4)] });
    ok("exactly long enough: placed, the match after its preparation", exact.placed === 1
       && exact.fixtures[0].startsAt === sast(SAT, "09:30") && exact.fixtures[0].endsAt === sast(SAT, "12:30"));
    const none = plan({ pairings: two, rules });
    ok("no windows: unscheduled, no_windows", JSON.stringify(none.fixtures[0].reasons) === '["no_windows"]');
    ok("every reason has words", Object.values(PLAN_REASON).every((r) => typeof PLAN_REASON_TEXT[r] === "string" && PLAN_REASON_TEXT[r].length > 10));
  }

  // An impossible timetable: four sides, six fixtures, one ground, one day,
  // two windows. Two are placed; four stay unscheduled with the reasons.
  {
    const four = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(4) });
    const r = plan({ pairings: four, rules: RULES, windows: [win("am", "g1", SAT, "09:00", 3), win("pm", "g1", SAT, "13:00", 3)] });
    ok("impossible: two placed, four unscheduled, not a full calendar", r.placed === 2 && r.unscheduled === 4, [r.placed, r.unscheduled]);
    const first = r.fixtures.filter((f) => f.round === 1);
    ok("round 1 fills the day, one fixture per window", first.every((f) => f.windowId) && first[0].windowId !== first[1].windowId);
    const left = r.fixtures.filter((f) => !f.windowId);
    ok("each left-over says: the ground is taken, and a side has played today",
       left.every((f) => f.reasons.includes(PLAN_REASON.GROUND_TAKEN) && f.reasons.includes(PLAN_REASON.DAILY_CAP)), left.map((f) => f.reasons));
    ok("no reason is invented: no blackout, no closure, no short window",
       left.every((f) => !f.reasons.some((x) => [PLAN_REASON.BLACKOUT, PLAN_REASON.GROUND_CLOSED, PLAN_REASON.WINDOW_SHORT].includes(/** @type {any} */ (x)))));
    ok("a placed fixture has no reasons; every unscheduled one has some",
       r.fixtures.every((f) => (f.windowId == null) === (f.reasons.length > 0)));
  }

  // Blackout on a South African day that is another UTC day. A day-night
  // match from 22:00 to 01:00 SAST is on Friday and Saturday in South
  // Africa, and wholly on Friday in UTC (20:00–23:00Z).
  {
    const late = win("late", "g1", "2026-10-02", "22:00", 3);
    ok("(the window really is all Friday in UTC)", late.startsAt === "2026-10-02T20:00:00.000Z" && late.endsAt === "2026-10-02T23:00:00.000Z");
    const blocked = plan({ pairings: two, rules: RULES, windows: [late], blackouts: [{ day: SAT, entrant: "t02" }] });
    ok("a side's Saturday blackout stops a match running past midnight SAST", blocked.placed === 0
       && JSON.stringify(blocked.fixtures[0].reasons) === '["blackout"]', blocked.fixtures[0].reasons);
    const early = win("early", "g1", SAT, "00:30", 3);
    ok("(a 00:30 SAST start is Friday in UTC)", early.startsAt.startsWith("2026-10-02T22:30"));
    ok("a Saturday blackout stops a 00:30 SAST start too",
       plan({ pairings: two, rules: RULES, windows: [early], blackouts: [{ day: SAT }] }).placed === 0);
    ok("a Friday blackout does not stop the 00:30 SAST start, though it is Friday in UTC",
       plan({ pairings: two, rules: RULES, windows: [early], blackouts: [{ day: "2026-10-02" }] }).placed === 1);
    ok("another side's blackout does not stop it",
       plan({ pairings: pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(3) }), rules: RULES,
              windows: [win("w", "g1", SAT, "09:00", 3)], blackouts: [{ day: SAT, entrant: "t02" }] })
         .fixtures.filter((f) => f.windowId).every((f) => ent(f.home) !== "t02" && ent(f.away) !== "t02"));
    refused("a blackout for an entrant not in the draw is refused",
            () => plan({ pairings: two, rules: RULES, blackouts: [{ day: SAT, entrant: "nobody" }] }), /not in this draw/);
    refused("a date that is not a date is refused", () => plan({ pairings: two, rules: RULES, blackouts: [{ day: "2026-02-30" }] }), /real calendar date/);
    refused("a window with no offset is refused (it would be read in the server's zone)",
            () => plan({ pairings: two, rules: RULES, windows: [{ id: "w", groundId: "g", startsAt: "2026-10-03T09:00:00", endsAt: "2026-10-03T12:00:00Z" }] }), /offset/);
  }

  // Rest and travel across two grounds. t01 has a known match on g1 from
  // 09:00 to 12:00; rest is an hour, travel ninety minutes more. Pitch g1b
  // lies on the same field as g1 (no travel); g2 is across town.
  {
    const rules = { durationMinutes: 180, restMinutes: 60, travelMinutes: 90, maxPerDay: 2 };
    /** @type {PlanGround[]} */
    const grounds = [{ id: "field" }, { id: "g1", parentId: "field" }, { id: "g1b", parentId: "field" }, { id: "g2" }];
    /** @type {PlanKnown[]} */
    const known = [{ entrants: ["t01"], groundId: "g1", startsAt: sast(SAT, "09:00"), endsAt: sast(SAT, "12:00") }];
    const across = plan({ pairings: two, rules, grounds, known, windows: [win("x1330", "g2", SAT, "13:30", 3), win("x1430", "g2", SAT, "14:30", 3)] });
    ok("across town: 13:30 is refused (rest + travel is 2½ hours), 14:30 is taken", across.fixtures[0].windowId === "x1430");
    const tooSoon = plan({ pairings: two, rules, grounds, known, windows: [win("x1330", "g2", SAT, "13:30", 3)] });
    ok("…and alone, 13:30 leaves it unscheduled for rest", JSON.stringify(tooSoon.fixtures[0].reasons) === '["rest"]', tooSoon.fixtures[0].reasons);
    const sameField = plan({ pairings: two, rules, grounds, known, windows: [win("p1300", "g1b", SAT, "13:00", 3), win("x1430", "g2", SAT, "14:30", 3)] });
    ok("on the next pitch of the same field, rest alone: 13:00", sameField.fixtures[0].windowId === "p1300");
    const nowhere = plan({ pairings: two, rules, grounds, known: [{ ...known[0], groundId: null }], windows: [win("p1300", "g1b", SAT, "13:00", 3)] });
    ok("a commitment with no ground is somewhere else: travel applies", nowhere.placed === 0 && nowhere.fixtures[0].reasons.includes(PLAN_REASON.REST));
    const noEnd = plan({ pairings: two, rules, grounds, known: [{ entrants: ["t01"], startsAt: sast(SAT, "09:00") }],
                         windows: [win("x1900", "g2", SAT, "19:00", 3), win("sun", "g2", SUN, "09:00", 3)] });
    ok("a commitment with no end takes its whole SA day: Saturday evening refused, Sunday taken", noEnd.fixtures[0].windowId === "sun");

    // Between two planned fixtures: three sides, g1 then g2 on one day.
    const three = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(3) });
    const chain = plan({ pairings: three, rules, grounds,
                         windows: [win("a", "g1", SAT, "09:00", 3), win("b", "g2", SAT, "13:00", 3), win("c", "g2", SAT, "14:30", 3), win("d", "g2", SAT, "18:00", 3)] });
    const at = new Map(chain.fixtures.map((f) => [f.windowId, f]));
    ok("two planned fixtures of one side across grounds keep rest + travel", !at.has("b") && at.has("a") && at.has("c"), chain.fixtures.map((f) => f.windowId));
  }

  // The daily cap, counting known commitments.
  {
    const legs = pairings({ format: PLAN_FORMAT.DOUBLE_ROUND_ROBIN, entrants: teams(2) });
    const rules = { durationMinutes: 180, maxPerDay: 2 };
    const windows = [win("s10", "g1", SAT, "10:00", 3), win("s13", "g1", SAT, "13:00", 3), win("u09", "g1", SUN, "09:00", 3)];
    const free = plan({ pairings: legs, rules, windows });
    ok("a festival day of two: both legs on Saturday, back to back", free.fixtures.map((f) => f.windowId).join() === "s10,s13");
    const busy = plan({ pairings: legs, rules, windows, known: [{ entrants: ["t01"], startsAt: sast(SAT, "07:00"), endsAt: sast(SAT, "10:00") }] });
    ok("a known match that morning counts: the second leg moves to Sunday", busy.fixtures.map((f) => f.windowId).join() === "s10,u09");
    const capped = plan({ pairings: legs, rules, windows: windows.slice(0, 2), known: [{ entrants: ["t01"], startsAt: sast(SAT, "07:00"), endsAt: sast(SAT, "10:00") }] });
    ok("…and with no Sunday, it is unscheduled, the afternoon refused for the cap",
       capped.fixtures[1].windowId == null && capped.fixtures[1].reasons.includes(PLAN_REASON.DAILY_CAP), capped.fixtures[1].reasons);
    const afternoonOnly = plan({ pairings: legs, rules, windows: [windows[1]], known: [{ entrants: ["t01"], startsAt: sast(SAT, "07:00"), endsAt: sast(SAT, "10:00") },
                                                                              { entrants: ["t01"], startsAt: sast(SAT, "10:00"), endsAt: sast(SAT, "12:00") }] });
    ok("two known matches that day and a cap of two: daily_cap alone", JSON.stringify(afternoonOnly.fixtures[0].reasons) === '["daily_cap"]', afternoonOnly.fixtures[0].reasons);
  }

  // A closed parent field blocks its pitches; a closed pitch blocks the
  // whole field; a closed pitch does not block its neighbour.
  {
    /** @type {PlanGround[]} */
    const closedField = [{ id: "field", closed: [{ from: sast(SAT, "00:00"), to: sast(SUN, "00:00") }] },
                         { id: "p1", parentId: "field" }, { id: "p2", parentId: "field" }, { id: "away" }];
    const r = plan({ pairings: two, rules: RULES, grounds: closedField, windows: [win("p1", "p1", SAT, "09:00", 3), win("p2", "p2", SAT, "09:00", 3)] });
    ok("the field closed on Saturday: neither of its pitches, ground_closed", r.placed === 0
       && JSON.stringify(r.fixtures[0].reasons) === '["ground_closed"]', r.fixtures[0].reasons);
    const elsewhere = plan({ pairings: two, rules: RULES, grounds: closedField,
                             windows: [win("p1", "p1", SAT, "09:00", 3), win("aw", "away", SAT, "11:00", 3)] });
    ok("…and a ground elsewhere is used instead", elsewhere.fixtures[0].windowId === "aw");
    ok("the field open again on Sunday", plan({ pairings: two, rules: RULES, grounds: closedField, windows: [win("p1s", "p1", SUN, "09:00", 3)] }).placed === 1);
    /** @type {PlanGround[]} */
    const closedPitch = [{ id: "field" }, { id: "p1", parentId: "field", closed: [{ from: sast(SAT, "08:00"), to: sast(SAT, "18:00") }] }, { id: "p2", parentId: "field" }];
    ok("a closed pitch blocks a window on the whole field",
       plan({ pairings: two, rules: RULES, grounds: closedPitch, windows: [win("f", "field", SAT, "09:00", 3)] }).fixtures[0].reasons.includes(PLAN_REASON.GROUND_CLOSED));
    ok("a closed pitch does not block the pitch beside it",
       plan({ pairings: two, rules: RULES, grounds: closedPitch, windows: [win("p1", "p1", SAT, "09:00", 3), win("p2", "p2", SAT, "09:00", 3)] }).fixtures[0].windowId === "p2");
    const closedGround = plan({ pairings: two, rules: { ...RULES, recoveryMinutes: 30 }, grounds: [{ id: "g1", closed: [{ from: sast(SAT, "12:00"), to: sast(SAT, "12:30") }] }],
                                windows: [win("w", "g1", SAT, "09:00", 4)] });
    ok("a closure during the ground's recovery or the match counts", closedGround.placed === 0);
    refused("a ground that lies on itself is refused",
            () => plan({ pairings: two, rules: RULES, grounds: [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], windows: [win("w", "a", SAT, "09:00", 3)] }), /lies on itself/);

    // Two pitches of one field at once are two fixtures; the field and its
    // pitch at once are one ground twice.
    const four = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(4) });
    const grounds = [{ id: "field" }, { id: "p1", parentId: "field" }, { id: "p2", parentId: "field" }];
    const side = plan({ pairings: four, rules: RULES, grounds, windows: [win("p1", "p1", SAT, "09:00", 3), win("p2", "p2", SAT, "09:00", 3)] });
    ok("two pitches of a field hold two fixtures at once", side.placed === 2);
    const whole = plan({ pairings: four, rules: RULES, grounds, windows: [win("p1", "p1", SAT, "09:00", 3), win("f", "field", SAT, "10:00", 3)] });
    ok("the whole field overlapping its pitch is taken", whole.placed === 1
       && whole.fixtures.filter((f) => !f.windowId && f.round === 1).every((f) => f.reasons.includes(PLAN_REASON.GROUND_TAKEN)));
    const booked = plan({ pairings: two, rules: RULES, grounds, known: [{ groundId: "field", startsAt: sast(SAT, "08:00"), endsAt: sast(SAT, "10:00") }],
                          windows: [win("p1", "p1", SAT, "09:00", 3)] });
    ok("a known booking of the field takes its pitches", JSON.stringify(booked.fixtures[0].reasons) === '["ground_taken"]');
  }

  // Knockout rounds after their feeders, plus rest; a later round is planned
  // for every side it could hold.
  {
    const ko = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(4) });
    const windows = [win("s1", "g1", SAT, "09:00", 3), win("s2", "g2", SAT, "09:00", 3), win("s3", "g1", SAT, "14:00", 3), win("u1", "g1", SUN, "10:00", 3)];
    const one = plan({ pairings: ko, rules: { durationMinutes: 180, restMinutes: 60 }, windows });
    ok("one a day: semis Saturday morning, the final Sunday (any of four could be in it)",
       one.fixtures.map((f) => f.windowId).join() === "s1,s2,u1", one.fixtures.map((f) => f.windowId));
    const twoADay = plan({ pairings: ko, rules: { durationMinutes: 180, restMinutes: 60, maxPerDay: 2 }, windows });
    ok("two a day: the final Saturday afternoon, an hour after the semis", twoADay.fixtures[2].windowId === "s3");
    const tight = plan({ pairings: ko, rules: { durationMinutes: 180, restMinutes: 180, maxPerDay: 2 }, windows: windows.slice(0, 3) });
    ok("rest of three hours: no final that day, and the reason is rest",
       tight.fixtures[2].windowId == null && tight.fixtures[2].reasons.includes(PLAN_REASON.REST), tight.fixtures[2].reasons);
    const early = plan({ pairings: ko, rules: { durationMinutes: 180, maxPerDay: 2 }, windows: [win("s1", "g1", SAT, "09:00", 3), win("u1", "g1", SUN, "09:00", 3)] });
    ok("the semis on two days: the final cannot come before the second, and says so (feeder)",
       early.fixtures[0].windowId === "s1" && early.fixtures[1].windowId === "u1" && early.fixtures[2].windowId == null
       && early.fixtures[2].reasons.includes(PLAN_REASON.FEEDER), early.fixtures.map((f) => f.reasons));
    const oneSemi = plan({ pairings: ko, rules: { durationMinutes: 180, maxPerDay: 2 }, windows: [win("s1", "g1", SAT, "09:00", 3)] });
    ok("…and a semi with none: the final waits for it, feeder_unscheduled",
       oneSemi.fixtures[0].windowId === "s1" && oneSemi.fixtures[1].windowId == null && JSON.stringify(oneSemi.fixtures[2].reasons) === '["feeder_unscheduled"]', oneSemi.fixtures.map((f) => f.reasons));
    const bl = plan({ pairings: ko, rules: { durationMinutes: 180, maxPerDay: 2 }, windows, blackouts: [{ day: SAT, entrant: "t04" }] });
    ok("a semi-finalist's blackout keeps its semi, and the final, off that day",
       bl.fixtures[0].windowId === "u1" && bl.fixtures[2].windowId == null, bl.fixtures.map((f) => [f.windowId, f.reasons]));
  }
}

// ════════════════════════════════════════════════════════════════════
group("D. Locks");
{
  const SAT = "2026-10-03";
  const four = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(4) });
  const windows = Array.from({ length: 6 }, (_, i) => win(`w${i}`, `g${i % 2}`, `2026-10-${String(3 + 7 * Math.floor(i / 2)).padStart(2, "0")}`, "10:00", 4));
  const first = plan({ pairings: four, rules: RULES, windows });
  ok("(the free plan places all six)", first.placed === 6);
  const target = first.fixtures[0];
  /** @type {PlanLock[]} */
  const locks = [{ fixtureId: target.id, windowId: "w5" }];
  const locked = plan({ pairings: four, rules: RULES, windows, locks });
  ok("a locked fixture goes to its window, not the first free one",
     locked.fixtures[0].windowId === "w5" && locked.fixtures[0].locked === true && locked.fixtures[1].locked === false);
  const more = plan({ pairings: four, rules: { ...RULES, restMinutes: 120 }, locks,
                      windows: [...windows, win("extra", "g9", "2026-10-01", "10:00", 4)].reverse() });
  ok("regenerated with new windows and rules: the lock holds", more.fixtures.find((f) => f.id === target.id)?.windowId === "w5");
  const reordered = plan({ pairings: pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants: teams(4).reverse() }), rules: RULES, windows, locks });
  ok("regenerated with the entrants reordered: the same fixture, the same window",
     reordered.fixtures.find((f) => f.id === target.id)?.windowId === "w5" && reordered.staleLocks.length === 0);
  const stale = plan({ pairings: four, rules: RULES, windows,
                       locks: [{ fixtureId: "rr:t01:t99:1", windowId: "w1" }, { fixtureId: target.id, windowId: "gone" }] });
  ok("stale locks are reported, not applied", JSON.stringify(stale.staleLocks.map((l) => l.reason))
     === JSON.stringify([LOCK_STALE.NO_SUCH_FIXTURE, LOCK_STALE.NO_SUCH_WINDOW]) && stale.placed === 6 && stale.fixtures.every((f) => !f.locked));
  const blacked = plan({ pairings: four, rules: RULES, windows, locks, blackouts: [{ day: "2026-10-17" }] });
  const held = blacked.fixtures.find((f) => f.id === target.id);
  ok("a lock whose window now breaks a rule: unscheduled with the reason, not moved",
     held?.windowId == null && held?.locked === true && JSON.stringify(held?.reasons) === '["blackout"]', held);
  refused("a fixture locked twice is refused",
          () => plan({ pairings: four, rules: RULES, windows, locks: [{ fixtureId: target.id, windowId: "w1" }, { fixtureId: target.id, windowId: "w2" }] }), /locked twice/);
  const clash = plan({ pairings: four, rules: RULES, windows,
                       locks: [{ fixtureId: first.fixtures[0].id, windowId: "w1" }, { fixtureId: first.fixtures[1].id, windowId: "w1" }] });
  ok("two locks on one window: the second is ground_taken", clash.fixtures[1].windowId == null
     && clash.fixtures[1].reasons.includes(PLAN_REASON.GROUND_TAKEN) && clash.fixtures[0].windowId === "w1");

  // A locked final before its unlocked semis: the semis cannot go after it,
  // so they stay unscheduled for the feeder rule, and the final waits.
  const ko = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(4) });
  const kw = [win("early", "g1", SAT, "09:00", 3), win("s1", "g1", "2026-10-10", "09:00", 3), win("s2", "g2", "2026-10-10", "09:00", 3)];
  const upside = plan({ pairings: ko, rules: RULES, windows: kw, locks: [{ fixtureId: ko.fixtures[2].id, windowId: "early" }] });
  ok("a final locked before its semis: semis refused for the feeder rule, the final waits",
     upside.placed === 0 && upside.fixtures[0].reasons.includes(PLAN_REASON.FEEDER)
     && JSON.stringify(upside.fixtures[2].reasons) === '["feeder_unscheduled"]' && upside.fixtures[2].locked, upside.fixtures.map((f) => f.reasons));
  const rightWay = plan({ pairings: ko, rules: RULES, windows: kw, locks: [{ fixtureId: ko.fixtures[0].id, windowId: "early" }] });
  ok("a semi locked early: the other semi and the final fill around it", rightWay.fixtures[0].windowId === "early" && rightWay.placed === 2);
}

// ════════════════════════════════════════════════════════════════════
group("E. Determinism, bounds, and an independent check");
{
  /**
   * Every required rule, checked from scratch over a finished plan: nothing
   * shared with the engine but the input. SA days here are UTC+2 by hand.
   * @param {Plan} r @param {Pairings} draw
   * @param {{ windows: PlanWindow[], rules: PlanRules, known?: PlanKnown[], blackouts?: PlanBlackout[], grounds?: PlanGround[] }} input
   */
  const violations = (r, draw, { windows, rules, known = [], blackouts = [], grounds = [] }) => {
    const out = [];
    const day = (/** @type {number} */ ms) => new Date(ms + 2 * 3_600_000).toISOString().slice(0, 10);
    const daysOf = (/** @type {number} */ a, /** @type {number} */ b) => { const s = new Set(); for (let t = a; t < b; t += 15 * MIN) s.add(day(t)); s.add(day(b - 1)); return s; };
    const parent = new Map(grounds.map((g) => [g.id, g.parentId ?? null]));
    const up = (/** @type {string} */ g) => { const c = [g]; let p = parent.get(g); while (p) { c.push(p); p = parent.get(p); } return c; };
    const rel = (/** @type {string} */ a, /** @type {string} */ b) => up(a).includes(b) || up(b).includes(a);
    const site = (/** @type {string} */ g) => up(g).at(-1);
    /** @type {Map<string, string[]>} */ const who = new Map();
    for (const f of draw.fixtures) who.set(f.id, [f.home, f.away].flatMap((s) => ("entrant" in s ? [s.entrant] : who.get(s.winnerOf) ?? [])));
    const prep = (rules.preparationMinutes ?? 0) * MIN, rec = (rules.recoveryMinutes ?? 0) * MIN;
    const rest = (rules.restMinutes ?? 0) * MIN, travel = (rules.travelMinutes ?? 0) * MIN, cap = rules.maxPerDay ?? 1;
    const P = r.fixtures.filter((f) => f.windowId).map((f) => {
      const w = /** @type {PlanWindow} */ (windows.find((x) => x.id === f.windowId));
      const start = Date.parse(/** @type {string} */ (f.startsAt)), end = Date.parse(/** @type {string} */ (f.endsAt));
      return { f, w, start, end, from: start - prep, to: end + rec, sides: /** @type {string[]} */ (who.get(f.id)) };
    });
    for (const p of P) {
      if (p.from !== Date.parse(p.w.startsAt) || p.to > Date.parse(p.w.endsAt) || p.end - p.start !== rules.durationMinutes * MIN) out.push(["window", p.f.id]);
      for (const b of blackouts) if ((b.entrant == null || p.sides.includes(b.entrant)) && daysOf(p.start, p.end).has(b.day)) out.push(["blackout", p.f.id]);
      for (const g of grounds) for (const c of g.closed ?? []) if (rel(g.id, p.w.groundId) && p.from < Date.parse(c.to) && Date.parse(c.from) < p.to) out.push(["closed", p.f.id]);
      for (const s of p.sides) {
        for (const d of daysOf(p.start, p.end)) {
          const n = P.filter((q) => q.sides.includes(s) && daysOf(q.start, q.end).has(d)).length
            + known.filter((k) => k.entrants?.includes(s) && daysOf(Date.parse(k.startsAt), Date.parse(/** @type {string} */ (k.endsAt))).has(d)).length;
          if (n > cap) out.push(["cap", p.f.id, s, d]);
        }
      }
      for (const x of [p.f.home, p.f.away]) {
        if ("winnerOf" in x) {
          const q = P.find((y) => y.f.id === x.winnerOf);
          if (!q || q.end + rest > p.start) out.push(["feeder", p.f.id]);
        }
      }
      for (const k of known) {
        const ks = Date.parse(k.startsAt), ke = Date.parse(/** @type {string} */ (k.endsAt));
        if (k.groundId && rel(k.groundId, p.w.groundId) && p.from < ke && ks < p.to) out.push(["booked", p.f.id]);
        if (k.entrants?.some((e) => p.sides.includes(e))) {
          const gap = rest + (k.groundId && site(k.groundId) === site(p.w.groundId) ? 0 : travel);
          if (p.start - gap < ke && ks < p.end + gap) out.push(["known-rest", p.f.id]);
        }
      }
    }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j];
      if (a.w.id === b.w.id || (rel(a.w.groundId, b.w.groundId) && a.from < b.to && b.from < a.to)) out.push(["ground", a.f.id, b.f.id]);
      if (a.sides.some((s) => b.sides.includes(s))) {
        const gap = rest + (site(a.w.groundId) === site(b.w.groundId) ? 0 : travel);
        if (a.start - gap < b.end && b.start < a.end + gap) out.push(["rest", a.f.id, b.f.id]);
      }
    }
    return out;
  };

  // The ceiling: 16 sides, a double round robin (240 fixtures), 256 windows:
  // eight grounds on two fields, every Wednesday and Saturday for sixteen
  // weeks. A side plays once a day, so a day holds eight fixtures at most
  // and 240 need thirty of the thirty-two days.
  const draw = pairings({ format: PLAN_FORMAT.DOUBLE_ROUND_ROBIN, entrants: teams(16) });
  /** @type {PlanWindow[]} */ const windows = [];
  const days = Array.from({ length: 32 }, (_, i) => new Date(Date.parse("2026-10-03T12:00:00Z") + (Math.floor(i / 2) * 7 + (i % 2) * 4) * 86_400_000).toISOString().slice(0, 10));
  ok("(thirty-two Saturdays and Wednesdays)", days[0] === "2026-10-03" && days[1] === "2026-10-07" && days[2] === "2026-10-10" && new Set(days).size === 32);
  for (const d of days) for (let g = 0; g < 8; g++) windows.push(win(`${d}-${g}`, `g${g}`, d, "08:00", 5));
  /** @type {PlanGround[]} */
  const grounds = [{ id: "north" }, { id: "south", closed: [{ from: sast("2026-10-14", "00:00"), to: sast("2026-10-15", "00:00") }] },
                   ...Array.from({ length: 8 }, (_, g) => ({ id: `g${g}`, parentId: g < 4 ? "north" : "south" }))];
  /** @type {PlanRules} */
  const rules = { durationMinutes: 240, preparationMinutes: 30, recoveryMinutes: 30, restMinutes: 60, travelMinutes: 45, maxPerDay: 1 };
  /** @type {PlanBlackout[]} */
  const blackouts = [{ day: "2026-10-10", entrant: "t03" }, { day: "2026-10-31" }];
  /** @type {PlanKnown[]} */
  const known = [{ entrants: ["t07"], groundId: "g1", startsAt: sast("2026-10-07", "09:00"), endsAt: sast("2026-10-07", "15:00") }];
  const input = { pairings: draw, windows, rules, grounds, blackouts, known };
  ok("(the ceiling: 240 fixtures, 256 windows)", draw.fixtures.length === 240 && windows.length === 256);

  const t0 = performance.now();
  const a = plan(input);
  const ms = performance.now() - t0;
  ok(`the ceiling is planned in well under two seconds (${Math.round(ms)} ms)`, ms < 2000, ms);
  console.log(`  (the ceiling: ${a.placed} of 240 placed in ${Math.round(ms)} ms)`);
  ok(`it places the season (${a.placed} of 240) around a blackout day, a closed field and a known match, and any it cannot has reasons`,
     a.placed >= 200 && a.fixtures.every((f) => (f.windowId == null) === (f.reasons.length > 0)), a.placed);
  const bad = violations(a, draw, input);
  ok("an independent check finds no broken rule", bad.length === 0, bad.slice(0, 5));
  // …and the check can fail: the second fixture moved into the first's window.
  const forged = structuredClone(a);
  const [x, y] = forged.fixtures.filter((f) => f.windowId);
  Object.assign(y, { windowId: x.windowId, groundId: x.groundId, startsAt: x.startsAt, endsAt: x.endsAt });
  ok("(the independent check catches a forged double booking)", violations(forged, draw, input).some((v) => v[0] === "ground"));

  const b = plan(input);
  let same = true;
  try { deepStrictEqual(b, a); } catch { same = false; }
  ok("run twice: deep-equal", same);
  const c = plan({ ...input, windows: [...windows].reverse(), known: [...known], blackouts: [...blackouts].reverse() });
  ok("the order windows arrive in makes no difference", JSON.stringify(c) === JSON.stringify(a));

  // The knockout, checked the same way.
  const ko = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants: teams(13) });
  const koInput = { pairings: ko, windows, rules: { ...rules, maxPerDay: 1 }, grounds, blackouts, known };
  const k = plan(koInput);
  ok(`a 13-side knockout is placed whole (${k.placed} of 12)`, k.placed === 12, k.fixtures.map((f) => f.reasons));
  ok("…and the independent check finds no broken rule", violations(k, ko, koInput).length === 0, violations(k, ko, koInput));

  refused("257 windows are refused", () => plan({ ...input, windows: [...windows, win("more", "g1", "2026-12-01", "09:00", 5)] }), /at most 256/);
  refused("rules without a duration are refused", () => plan({ pairings: draw, rules: /** @type {any} */ ({}) }), /durationMinutes/);
  refused("a pairings object that is not one is refused", () => plan({ pairings: /** @type {any} */ ({ format: "x" }), rules }), /pairings/);
  refused("a winnerOf naming nothing is refused (no cycles, no invented feeders)",
          () => plan({ pairings: { format: "knockout", rounds: 1, byes: [], fixtures: [{ id: "f", round: 1, leg: 1, match: 1, home: { winnerOf: "f" }, away: { entrant: "a" } }] }, rules }),
          /not an earlier fixture/);
}

// ════════════════════════════════════════════════════════════════════
group("F. Drafts for the fixture route");
{
  const COMP = "7c1c1f5e-9b1a-4b7e-8d0e-2f1f3f9b8a01";
  const school = (/** @type {number} */ i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const entrants = ids(4).map((id, i) => ({ id, schoolId: school(i + 1), teamCode: "1st XI" }));
  const draw = pairings({ format: PLAN_FORMAT.ROUND_ROBIN, entrants });
  const r = plan({ pairings: draw, rules: { durationMinutes: 180, preparationMinutes: 30 },
                   windows: [win("w1", "11111111-1111-4111-8111-111111111111", "2026-10-03", "09:00", 4)] });
  const d = toFixtureDrafts(r, { id: COMP, format: "T20", entrants });
  ok("one placed fixture, one draft; five held as unscheduled", d.drafts.length === 1
     && d.held.length === 5 && d.held.every((h) => h.reason === DRAFT_HELD.UNSCHEDULED));
  const f = r.fixtures[0], body = d.drafts[0].body;
  const home = entrants.find((e) => "entrant" in f.home && e.id === f.home.entrant);
  ok("the body: home school and team, away school and team, the match's start, the ground, the competition",
     body.schoolId === home?.schoolId && body.teamCode === "1st XI" && body.awaySchoolId !== body.schoolId
     && body.awayTeamCode === "1st XI" && body.startsAt === sast("2026-10-03", "09:30")
     && body.groundId === "11111111-1111-4111-8111-111111111111" && body.competitionId === COMP && body.sport === "cricket");
  ok("the competition's own format, overs left to the route's default", body.format === "T20" && !("overs" in body) && !("opponent" in body));
  const fifty = toFixtureDrafts(r, { id: COMP, format: "T20", conditions: { "format.overs_per_innings": 50 }, entrants });
  ok("the conditions' 50 overs: One-Day, 50", fifty.drafts[0].body.format === "One-Day" && fifty.drafts[0].body.overs === 50);
  const bare = toFixtureDrafts(r, { id: COMP, entrants });
  ok("nothing said about the format: neither field sent", !("format" in bare.drafts[0].body) && !("overs" in bare.drafts[0].body));
  const noCode = toFixtureDrafts(r, { id: COMP, entrants: entrants.map((e) => ({ ...e, teamCode: null })) });
  ok("an entrant with no team code is held, not guessed", noCode.drafts.length === 0 && noCode.held[0].reason === DRAFT_HELD.NO_TEAM_CODE);
  refused("an entrant the competition does not list is refused",
          () => toFixtureDrafts(r, { id: COMP, entrants: entrants.slice(2) }), /does not list/);

  const ko = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants });
  const kp = plan({ pairings: ko, rules: { durationMinutes: 180, maxPerDay: 2 },
                    windows: [win("a", "g1", "2026-10-03", "09:00", 3), win("b", "g2", "2026-10-03", "09:00", 3), win("c", "g1", "2026-10-03", "14:00", 3)] });
  const kd = toFixtureDrafts(kp, { id: COMP, entrants });
  ok("a knockout: the semis are drafts; the final is held until its sides are known",
     kp.placed === 3 && kd.drafts.length === 2 && JSON.stringify(kd.held) === JSON.stringify([{ fixtureId: ko.fixtures[2].id, reason: DRAFT_HELD.AWAITING_WINNER }]));
}

console.log("\n" + "─".repeat(52));
console.log(`PLANNER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * The public pages' fixtures (SCRBRD-083 phase 1), for tools/smoke-public.mjs
 * and tools/smoke-browser-public.mjs. Written as the database owner onto the
 * ball log through @scrbrd/scoring's own constructors and toRow()
 * (fixture-matchcentre.mjs's writeEvents), so every row is one a pad could
 * have sent.
 *
 * The people are chosen so that every branch of the name rule has a boy on
 * the page, each with a full first name a leak would show:
 *
 *   Hilton 1XI     Daniel Erasmus   consented                 → "D Erasmus"
 *                  Liam Botha       consented                 → "L Botha"
 *                  Pieter Markham   consented, never-public   → "Batter"
 *                  Sipho Ndaba      nothing recorded          → "Batter"
 *                  Thabo Nkosi      consented, U14 by birth, playing up,
 *                                   Hilton's U14 names off    → "Batter"
 *                  "Warren Guest"   typed in (a substitute fielder, L6)
 *   Westville 1XI  Ruan Visser      consented                 → "Bowler" until
 *                                   Westville publishes its side, then "R Visser"
 *                  Musa Zulu        nothing recorded          → "Bowler"
 *
 *   PUB   Hilton 1XI v Westville 1XI, live, both on SCRBRD: Hilton's innings
 *         with a wicket to a typed fielder, a bowler changed for an injury, a
 *         batter retired hurt, a penalty, a void; Westville's begun.
 *   PUB2  Hilton 1XI v Kearsney College 1XI (not on SCRBRD, typed names), a
 *         finished first innings with Daniel Erasmus in it again — for "no
 *         pseudonym is shared between two matches" and for a finished page's
 *         60-second cache.
 *
 * Consents go through public_name_consent_set() as each boy's own verified
 * guardian — the guardians and their links are inserted here as the owner,
 * the way db/99 section 25 makes its own.
 */
import {
  inningsStart, batters, bowler, ball, penalty, retire, voidEvent, sealInnings, deriveInnings, placementFromTap, BALL_TYPE,
} from "@scrbrd/scoring";
import { writeEvents, HIL, WES } from "./fixture-matchcentre.mjs";

export { HIL, WES };
const GROUND = "ffffffff-0000-0000-0000-000000000001";   // Gordon Sherwood Oval (db/98)

/** name, school, team, years old, consent? */
export const PEOPLE = {
  erasmus: ["Daniel Erasmus", HIL, "1XI", 17, true],
  botha:   ["Liam Botha", HIL, "1XI", 17, true],
  markham: ["Pieter Markham", HIL, "1XI", 16, true],
  ndaba:   ["Sipho Ndaba", HIL, "1XI", 17, false],
  nkosi:   ["Thabo Nkosi", HIL, "1XI", 13, true],
  visser:  ["Ruan Visser", WES, "1XI", 17, true],
  zulu:    ["Musa Zulu", WES, "1XI", 16, false],
};
export const TYPED_FIELDER = "Warren Guest";
export const KEARSNEY = ["Gareth Oakes", "Henry Bramwell"];
/** What each is shown as once the rule has been applied, both sides published. */
export const EXPECTED = { erasmus: "D Erasmus", botha: "L Botha", visser: "R Visser" };

/**
 * @param {(text: string, params?: any[]) => Promise<any[]>} q  SQL as the owner
 * @returns {Promise<{pub: string, pub2: string, ids: Record<string, string>, guardians: Record<string, string>}>}
 */
export async function buildPublicFixture(q) {
  /** @type {Record<string, string>} */
  const ids = {};
  /** @type {Record<string, string>} key → the guardian's app_user id */
  const guardians = {};
  for (const [key, [name, school, team, age, consent]] of Object.entries(PEOPLE)) {
    const [first, ...rest] = name.split(" ");
    ids[key] = (await q(
      `insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born, batting_style)
       values ($1, $2, $3, $4, $5, 'batter', current_date - make_interval(years => $6) - interval '40 days', $7) returning id`,
      [school, team, name, rest.join(" "), 70 + Object.keys(ids).length, age, key === "botha" ? "L" : "R"]))[0].id;
    if (!consent) continue;
    // A guardian of his own, verified, as db/08's link functions leave one.
    const uid = (await q(
      `insert into app_user (school_id, email, name, role) values ($1, $2, $3, 'guardian') returning id`,
      [school, `guardian.${key}@example.invalid`, `Parent of ${first}`]))[0].id;
    const asg = (await q(
      `insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [uid, school]))[0].id;
    await q(
      `insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                       consent_state, consent_version, consent_at, created_by, valid_from)
       values ($1, $2, 'parent', 'verified', $3, now() - interval '30 days', 'granted', 'popia-2026-01', now() - interval '30 days', $3,
               current_date - 30)`, [asg, ids[key], uid]);
    guardians[key] = uid;
  }
  // A Westville publisher (broadcast.publish at Westville), as db/99 §25 has one.
  const wesPub = (await q(
    `insert into app_user (school_id, email, name, role) values ($1, 'publisher.wes@example.invalid', 'W Publisher', 'sportsadmin') returning id`, [WES]))[0].id;
  await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'sportsadmin', $2)`, [wesPub, WES]);

  const pub = (await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3, now() - interval '2 hours', 'cricket', 'T10', 10, 'live') returning id`,
    [HIL, WES, GROUND]))[0].id;
  const pub2 = (await q(
    `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, '1XI', 'Kearsney College 1XI', $2, now() - interval '3 days', 'cricket', 'T5', 5, 'complete') returning id`,
    [HIL, GROUND]))[0].id;
  await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'home', 'bat')`, [pub, HIL]);

  const member = (/** @type {string} */ k) => ({ id: ids[k], name: PEOPLE[/** @type {keyof typeof PEOPLE} */ (k)][0],
    batting_style: k === "botha" ? "Left-hand bat" : "Right-hand bat" });
  const HILTON = ["erasmus", "markham", "ndaba", "nkosi", "botha"].map(member);
  const WESTVILLE = ["visser", "zulu"].map(member);
  const t0 = Date.parse("2026-09-26T08:00:00Z");

  // ── PUB, innings 1: Hilton ──
  let n = 0;
  /** @param {any} ev @param {number} innings @param {string} idp */
  const at = (ev, innings, idp) => ({ ...ev, innings, id: `${idp}-${innings}-${++n}`, clientTs: t0 + n * 30000 });
  const E = ids, H = (/** @type {any} */ ev) => at(ev, 0, "pub");
  const first = [
    H(inningsStart({ battingTeam: "1XI", bowlingTeam: "Westville Boys' High 1XI", teamKey: "1XI", bowlingTeamKey: "Westville Boys' High 1XI",
      squad: HILTON, bowlingSquad: WESTVILLE, overs: 10, twelfthMan: "Twelfth Mansfield", captureProfile: "full" })),
    H(batters({ striker: E.erasmus, nonStriker: E.markham })),
    H(bowler({ bowler: E.visser })),
    H(ball({ type: BALL_TYPE.RUN, value: 4, shot: "drive", ...placementFromTap({ angle: 270, radius: 1 }) })),
    H(ball({ type: BALL_TYPE.RUN, value: 1, ...placementFromTap({ angle: 60, radius: 0.5 }) })),
    H(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: TYPED_FIELDER, shot: "pull" })),
    H(batters({ striker: E.ndaba })),
    H(ball({ type: BALL_TYPE.RUN, value: 2, ...placementFromTap({ angle: 120, radius: 0.8 }) })),
    H(ball({ type: BALL_TYPE.WIDE, value: 0 })),
    H(ball({ type: BALL_TYPE.RUN, value: 0 })),
    H(bowler({ bowler: E.zulu, reason: "injury" })),                         // N2: the reason never leaves
    H(ball({ type: BALL_TYPE.RUN, value: 6, ...placementFromTap({ angle: 180, radius: 1 }) })),
    H(bowler({ bowler: E.visser })),
    H(ball({ type: BALL_TYPE.RUN, value: 1 })),
    H(ball({ type: BALL_TYPE.RUN, value: 0 })),
    H(retire({ batter: E.ndaba, reason: "hurt" })),                          // N2: "not out", never "hurt"
    H(batters({ striker: E.nkosi })),
    H(penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" })),
    H(ball({ type: BALL_TYPE.RUN, value: 4, ...placementFromTap({ angle: 300, radius: 1 }) })),
    H(ball({ type: BALL_TYPE.RUN, value: 1 })),
  ];
  const wrong = H(ball({ type: BALL_TYPE.RUN, value: 3 }));
  first.push(wrong, H(voidEvent({ target: wrong.id, reason: "scorer: the dad of Pieter Markham said it was two" })));
  first.push(H(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })));
  const fold = deriveInnings(first);
  first.push(H(batters(fold.striker == null ? { striker: E.botha } : { nonStriker: E.botha })));
  first.push(H(ball({ type: BALL_TYPE.RUN, value: 2 })), H(ball({ type: BALL_TYPE.RUN, value: 1 })));
  const sealed = deriveInnings(first);
  first.push({ ...sealInnings(sealed, "declared"), innings: 0, id: "pub-0-seal", clientTs: t0 + 99 * 30000 });
  // ── PUB, innings 2: Westville begun ──
  const W = (/** @type {any} */ ev) => at(ev, 1, "pub");
  const second = [
    W(inningsStart({ battingTeam: "Westville Boys' High 1XI", bowlingTeam: "1XI", teamKey: "Westville Boys' High 1XI", bowlingTeamKey: "1XI",
      squad: WESTVILLE, bowlingSquad: HILTON, overs: 10, target: sealed.runs + 1 })),
    W(batters({ striker: E.visser, nonStriker: E.zulu })),
    W(bowler({ bowler: E.botha })),
    W(ball({ type: BALL_TYPE.RUN, value: 1 })),
    W(ball({ type: BALL_TYPE.RUN, value: 4, ...placementFromTap({ angle: 90, radius: 1 }) })),
  ];

  // ── PUB2: Hilton against a side not on SCRBRD, finished ──
  const K = (/** @type {any} */ ev) => at(ev, 0, "pub2");
  const k = [
    K(inningsStart({ battingTeam: "1XI", bowlingTeam: "Kearsney College 1XI", teamKey: "1XI", bowlingTeamKey: "Kearsney College 1XI",
      squad: HILTON, bowlingSquad: KEARSNEY.map((nm) => ({ id: nm, name: nm })), overs: 5 })),
    K(batters({ striker: E.erasmus, nonStriker: E.botha })),
    K(bowler({ bowler: KEARSNEY[0] })),
    K(ball({ type: BALL_TYPE.RUN, value: 4 })), K(ball({ type: BALL_TYPE.RUN, value: 1 })),
    K(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: KEARSNEY[1] })),
  ];

  await writeEvents(q, pub, [...first, ...second]);
  await writeEvents(q, pub2, k);
  return { pub, pub2, ids, guardians };
}

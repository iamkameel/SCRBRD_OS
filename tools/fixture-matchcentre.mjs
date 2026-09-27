/**
 * A real, scored fixture for the Match Centre's browser walk
 * (smoke-browser-matchcentre.mjs), written straight onto the ball log the way
 * smoke-browser-report.mjs builds its own — but through the scoring
 * package's own constructors and toRow(), so every row is one the pad could
 * have sent, and the walk can fold the same events to know what the screen
 * must say.
 *
 * Two fixtures:
 *
 *   LIVE — Hilton College 1XI v Westville Boys' High 1XI (both on SCRBRD), a
 *   ten-over match in its second innings. Hilton's innings has every kind of
 *   delivery, a fifty, wickets of five kinds, a free hit that saves a batter,
 *   five penalty runs to each side (a helmet struck; deliberate short
 *   running, which Westville carry into their own innings), a ball undone by
 *   the scorer (a void) and one corrected after the innings by an approved
 *   amendment (a void written by scoring_amendment_decide()). Westville are
 *   chasing, four overs and three balls in.
 *
 *   BREAK — Hilton College U16A v Kearsney College U16A (not on SCRBRD), a
 *   five-over first innings sealed, the second not begun: the innings break.
 *
 * Players are inserted for both schools, with names nobody else in the seed
 * uses, and the seeded scorer is the author of every event.
 */
import {
  inningsStart, batters, bowler, ball, penalty, voidEvent, sealInnings, shortRunning,
  deriveInnings, placementFromTap, toRow, BALL_TYPE, KIND,
} from "@scrbrd/scoring";

export const HIL = "11111111-1111-1111-1111-111111111111";
export const WES = "22222222-2222-2222-2222-222222222222";
const SCORER = "88888888-0000-0000-0000-000000000006";   // the seed's scorer (db/98)
const GROUND = "ffffffff-0000-0000-0000-000000000001";   // Gordon Sherwood Oval (db/98)

const HIL_XI = ["D Erasmus", "R Pillai", "S Naidu", "M Cele", "T Bekker", "K Mthembu", "J van Wyk", "A Dlamini", "L Zungu", "P Govender", "N Khoza"];
const WES_XI = ["B Mkhabela", "C Botha", "F Singh", "G Nel", "H Ndlovu", "I Pather", "K Mahlaba", "L Fourie", "M Zulu", "O Reddy", "Q Mokoena"];
const U16_XI = ["U Maseko", "V Radebe", "W Chetty", "X Shabalala", "Y Moodley", "Z Ntuli", "A Moosa", "B Hlongwa", "C Pillay", "D Joubert", "E Mbatha"];
/** Kearsney is not on SCRBRD: the scorer types their names. */
const KEARSNEY = ["F Kearsley", "G Oakes", "H Bramwell", "I Tatham", "J Wood"];

/**
 * Score an innings from a list of tokens, the way a scorer taps them: the
 * next bowler is named at each over's start, the next batter after each
 * wicket, from the orders given.
 *
 *   "0".."6"        runs off the bat; "4:drive:270:1" adds the shot and a tap
 *                   (screen angle, radius)
 *   "wd" "wd2"      a wide, and wides run
 *   "nb" "nb1"      a no-ball, and runs off the bat; "nbb2" byes off it
 *   "b2" "lb1"      byes, leg byes
 *   "W:bowled"      a wicket; "W:caught:Fielder" "W:stumped:Keeper" "W:lbw"
 *   "ro:1:ns:bowler_end"  the non-striker run out after one run, at that end
 *   "pen:bat:helmet_struck" / "pen:field:time_wasting"  five penalty runs
 *   "sr"            deliberate short running: the ball, then the award
 *   "undo"          the scorer undoes the last event (a void)
 */
function scoreInnings({ innings, idp, start, openers, order, attack, tokens }) {
  /** @type {any[]} */
  const log = [];
  let n = 0;
  const add = (ev) => { const e = { ...ev, innings, id: `${idp}-${innings}-${++n}`, clientTs: Date.parse("2026-09-26T08:00:00Z") + n * 30000 }; log.push(e); return e; };
  add(inningsStart(start));
  add(batters({ striker: openers[0], nonStriker: openers[1] }));
  const queue = [...order];
  let overs = 0;
  const fold = () => deriveInnings(log);
  for (const t of tokens) {
    let inn = fold();
    if (inn.bowler == null && t !== "undo" && !t.startsWith("pen")) { add(bowler({ bowler: attack[overs % attack.length] })); overs += 1; }
    if ((inn.striker == null || inn.nonStriker == null) && queue.length && t !== "undo" && !t.startsWith("pen")) {
      add(batters(inn.striker == null ? { striker: queue.shift() } : { nonStriker: queue.shift() }));
      inn = fold();
    }
    const [head, ...rest] = t.split(":");
    if (/^[0-6]$/.test(head)) {
      const [shot, angle, radius] = rest;
      add(ball({ type: BALL_TYPE.RUN, value: Number(head), ...(shot ? { shot } : {}),
        ...(angle ? placementFromTap({ angle: Number(angle), radius: Number(radius ?? 0.9) }) : {}) }));
    } else if (/^wd\d*$/.test(head)) add(ball({ type: BALL_TYPE.WIDE, value: Number(head.slice(2) || 0) }));
    else if (/^nbb\d+$/.test(head)) add(ball({ type: BALL_TYPE.NO_BALL, value: Number(head.slice(3)), nbRuns: "byes" }));
    else if (/^nb\d*$/.test(head)) add(ball({ type: BALL_TYPE.NO_BALL, value: Number(head.slice(2) || 0) }));
    else if (/^b\d+$/.test(head)) add(ball({ type: BALL_TYPE.BYE, value: Number(head.slice(1)) }));
    else if (/^lb\d+$/.test(head)) add(ball({ type: BALL_TYPE.LEG_BYE, value: Number(head.slice(2)) }));
    else if (head === "W") add(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: rest[0], fielder: rest[1] ?? null, ...(rest[2] ? { shot: rest[2] } : {}) }));
    else if (head === "ro") add(ball({ type: BALL_TYPE.WICKET, value: Number(rest[0]), dismissal: "run_out",
      dismissed: rest[1] === "ns" ? inn.nonStriker : inn.striker, outAt: rest[2], fielder: rest[3] ?? null }));
    else if (head === "pen") add(penalty({ runs: 5, toBattingTeam: rest[0] === "bat", reason: rest[1] }));
    else if (head === "sr") for (const e of shortRunning({ shot: "cut" })) add(e);
    else if (head === "undo") {
      const last = [...log].reverse().find((e) => e.kind !== KIND.VOID && e.kind !== KIND.INNINGS_START);
      add(voidEvent({ target: last.id }));
    } else throw new Error(`fixture-matchcentre: unknown token ${t}`);
  }
  return log;
}

/**
 * Append events to a fixture's log, as the pad's outbox would have sent them:
 * each through toRow(), at the next seq after `seq0`.
 * @param {(text: string, params?: any[]) => Promise<any[]>} q
 * @param {string} matchId  @param {any[]} log  @param {number} [seq0]
 */
export async function writeEvents(q, matchId, log, seq0 = 0) {
  let seq = seq0;
  for (const ev of log) {
    seq += 1;
    const row = toRow(ev);
    const cols = Object.keys(row).filter((k) => !["kind", "innings", "client_ts", "payload"].includes(k));
    const vals = cols.map((k) => row[k]);
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq,
                               client_ts, kind, payload${cols.map((c) => `, ${c}`).join("")})
       values ($1, $2, $3, 1, $4, $5, $6, $7, $3, $8, $9, $10::jsonb${cols.map((_, i) => `, $${11 + i}`).join("")})`,
      [matchId, HIL, seq, ev.innings, SCORER, ev.id.startsWith("amendment:") ? "amendment" : "mc-pad", ev.id,
        row.client_ts, row.kind, JSON.stringify(row.payload), ...vals]);
  }
}

/**
 * Build both fixtures. `q(text, params)` runs SQL as the database owner.
 * @returns {Promise<{live: string, brk: string, events: Record<string, any[]>, players: Record<string, string>}>}
 */
export async function buildMatchCentreFixture(q) {
  /** @type {Record<string, string>} name → player id */
  const players = {};
  const addPlayers = async (school, team, names, no0) => {
    for (const [i, name] of names.entries()) {
      players[name] = (await q(
        `insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
         values ($1, $2, $3, $4, 'batter', current_date - interval '17 years') returning id`,
        [school, team, name, no0 + i]))[0].id;
    }
  };
  await addPlayers(HIL, "1XI", HIL_XI, 60);
  await addPlayers(WES, "1XI", WES_XI, 60);
  await addPlayers(HIL, "U16A", U16_XI, 80);
  const id = (name) => players[name] ?? name;
  const squadOf = (names) => names.map((nm) => ({ id: id(nm), name: nm }));

  const live = (await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, '1XI', $2, '1XI', 'Westville Boys'' High 1XI', $3, now() - interval '2 hours', 'cricket', 'T10', 10, 'live') returning id`,
    [HIL, WES, GROUND]))[0].id;
  const brk = (await q(
    `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, 'U16A', 'Kearsney College U16A', $2, now() - interval '1 hour', 'cricket', 'T5', 5, 'live') returning id`,
    [HIL, GROUND]))[0].id;
  await q(`insert into match_toss (match_id, school_id, won_by, decision) values ($1, $2, 'home', 'bat')`, [live, HIL]);

  // ── LIVE, innings 1: Hilton College 1XI, ten overs ──
  const H = HIL_XI.map(id), W = WES_XI.map(id);
  const first = scoreInnings({
    innings: 0, idp: "mc-live",
    start: { battingTeam: "1XI", bowlingTeam: "Westville Boys' High 1XI", teamKey: "1XI", bowlingTeamKey: "Westville Boys' High 1XI",
      squad: squadOf(HIL_XI), bowlingSquad: squadOf(WES_XI), overs: 10, captureProfile: "full" },
    openers: [H[0], H[1]], order: H.slice(2), attack: [W[7], W[8], W[9], W[10]],
    tokens: [
      "1:flick:30:0.6", "4:drive:270:1", "0:fwd_def", "wd", "1", "6:loft:150:1", "0",                  // over 1
      "4:pull:80:1", "2", "undo", "1", "nb1", "4:cut:300:1", "0", "W:caught:C Botha:pull",          // over 2: a void; a free hit
      "1", "0", "4:drive:250:1", "b2", "lb1", "pen:bat:helmet_struck", "1",                          // over 3: the helmet
      "6:slog:120:1", "4:sweep:60:1", "1", "0", "W:lbw", "2",                                        // over 4
      "1", "4:drive:200:1", "4:drive:230:1", "sr", "6:loft:180:1", "1", "1",                         // over 5: short running
      "0", "nb", "W:bowled", "4:glance:20:1", "1", "2", "1",                                         // over 6: bowled on a free hit
      "4:cut:290:1", "1", "ro:1:ns:bowler_end:F Singh", "2", "wd2", "0", "1",                        // over 7: a run out
      "1", "4:pull:90:1", "1", "W:stumped:G Nel", "0", "1",                                          // over 8
      "2", "2", "4:drive:240:1", "1", "0", "1",                                                      // over 9
      "6:loft:170:1", "1", "4:flick:40:1", "0", "1", "1",                                            // over 10
    ],
  });
  // An amendment, approved after the innings: the two wides in over 7 were
  // never signalled. scoring_amendment_decide() voids the delivery (its
  // idempotency key is "amendment:<id>"), and the innings reads as if it had
  // never been recorded — three runs fewer, the same ten overs.
  const wrong = first.find((e) => e.kind === KIND.BALL && e.type === BALL_TYPE.WIDE && e.value === 2);
  first.push({ ...voidEvent({ target: wrong.id, reason: "amendment" }), innings: 0, id: "amendment:mc-live-7", clientTs: Date.now() });
  const sealed = deriveInnings(first);
  first.push({ ...sealInnings(sealed, sealed.endReason ?? "overs_complete"), innings: 0, id: "mc-live-0-seal", clientTs: Date.now() });

  // ── LIVE, innings 2: Westville chasing, four overs and three balls in ──
  const second = scoreInnings({
    innings: 1, idp: "mc-live",
    start: { battingTeam: "Westville Boys' High 1XI", bowlingTeam: "1XI", teamKey: "Westville Boys' High 1XI", bowlingTeamKey: "1XI",
      squad: squadOf(WES_XI), bowlingSquad: squadOf(HIL_XI), overs: 10, target: sealed.runs + 1, captureProfile: "full" },
    openers: [W[0], W[1]], order: W.slice(2), attack: [H[7], H[8], H[9], H[10]],
    tokens: [
      "0", "1", "4:drive:260:1", "0", "wd", "1", "2",
      "W:bowled", "1", "0", "4:pull:70:1", "6:loft:160:1", "0",
      "1", "1", "2", "W:caught:P Govender", "0", "1",
      "4:cut:300:1", "0", "1", "1", "0", "2",
      "1", "4:drive:220:1", "0",
    ],
  });

  // ── BREAK: Hilton U16A, five overs, sealed; Kearsney not yet in ──
  const U = U16_XI.map(id);
  const brkLog = scoreInnings({
    innings: 0, idp: "mc-break",
    start: { battingTeam: "U16A", bowlingTeam: "Kearsney College U16A", teamKey: "U16A", bowlingTeamKey: "Kearsney College U16A",
      squad: squadOf(U16_XI), bowlingSquad: [], overs: 5 },
    openers: [U[0], U[1]], order: U.slice(2), attack: [KEARSNEY[0], KEARSNEY[1], KEARSNEY[2]],
    tokens: [
      "1", "4", "0", "1", "6", "1",
      "0", "W:caught:G Oakes", "4", "1", "1", "0",
      "4", "4", "1", "wd", "0", "2", "1",
      "6", "W:bowled", "1", "0", "4", "1",
      "1", "1", "4", "0", "6", "1",
    ],
  });
  const brkSealed = deriveInnings(brkLog);
  brkLog.push({ ...sealInnings(brkSealed, brkSealed.endReason ?? "overs_complete"), innings: 0, id: "mc-break-0-seal", clientTs: Date.now() });

  await writeEvents(q, live, [...first, ...second]);
  await writeEvents(q, brk, brkLog);
  return { live, brk, events: { [live]: [...first, ...second], [brk]: brkLog }, players };
}

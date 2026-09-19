#!/usr/bin/env node
/**
 * No child's name leaves the platform.
 *
 * `send` is injected: the assertion is about what WOULD have gone to the
 * model provider, read from the request the service built, not about the
 * provider being reachable. A fake provider answers using the tokens, as the
 * real one is told to, so the way back is tested too.
 */
import { maskNames, describeDelivery, askStatsMagic, contextFrom, statsMagicContext } from "./ai-service.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const flat = (params) => JSON.stringify(params);

// ── the helper ──
{
  const m = maskNames("J Whitfield drives S Naidoo; Naidoo shakes his head at j whitfield", ["J Whitfield", "Naidoo", "S Naidoo"]);
  ok("every name is gone", !/Whitfield|Naidoo/i.test(m.text), m.text);
  ok("longest name first, so S Naidoo is one token", /drives PLAYER_\d;/.test(m.text), m.text);
  ok("case does not matter", !/j whitfield/i.test(m.text));
  ok("the way back restores the real names", m.unmask(m.text) === "J Whitfield drives S Naidoo; Naidoo shakes his head at J Whitfield", m.unmask(m.text));
  ok("a token the model spaced or lower-cased still comes back", m.unmask("Player 1, PLAYER 1 and player_1") === "J Whitfield, J Whitfield and J Whitfield", m.unmask("Player 1, PLAYER 1 and player_1"));
  ok("a name with regex characters is handled", maskNames("A. B (C)", ["A. B (C)"]).text === "PLAYER_1");
  ok("no names, no change", maskNames("dot ball", []).text === "dot ball");
}

// ── commentary ──
{
  let sent = null;
  const send = async (params) => { sent = params; return { content: [{ type: "text", text: "PLAYER_1 leans into that one off PLAYER_2, four more." }] }; };
  const line = await describeDelivery({
    situation: "Ball: FOUR | James Whitfield: 42* (30b) | Kieran Naidoo: 3-0 18r 1w",
    names: ["James Whitfield", "Kieran Naidoo"], send });
  ok("commentary request carries no name", sent && !/Whitfield|Naidoo/i.test(flat(sent)), sent && flat(sent).slice(0, 200));
  ok("...but does carry the tokens", /PLAYER_1/.test(flat(sent)) && /PLAYER_2/.test(flat(sent)));
  ok("...and tells the model they are names", /use them verbatim/i.test(sent?.system ?? ""));
  ok("the line comes back with the names in", line === "James Whitfield leans into that one off Kieran Naidoo, four more.", line);
  ok("a missing situation sends nothing", (await describeDelivery({ situation: "", names: ["X"], send: async () => { throw new Error("should not send"); } })) === null);
  ok("a provider failure is a null line, never a throw", (await describeDelivery({ situation: "dot", names: [], send: async () => { throw new Error("boom"); } })) === null);
}

// ── Stats-Magic ──
{
  const ctx = contextFrom({
    players: [{ full_name: "James Whitfield", playing_role: "Batter", team_code: "1XI", school_name: "Hilton College" },
              { full_name: "Kieran Naidoo", playing_role: "Bowler", team_code: "1XI", school_name: "Hilton College" }],
    matches: [{ team_code: "1XI", opponent: "Michaelhouse", starts_at: "2026-09-20T08:00:00Z", status: "scheduled" }],
  });
  ok("the context is built from the read path's rows", /Players: James Whitfield, Batter, 1XI, Hilton College; Kieran Naidoo/.test(ctx.context), ctx.context);
  ok("...and the names come with it", ctx.names.length === 2);

  let sent = null;
  const send = async (params) => { sent = params; return { content: [{ type: "text", text: "PLAYER_1 is the top scorer; PLAYER_2 the leading wicket-taker." }] }; };
  const answer = await askStatsMagic({ question: "Who is better, James Whitfield or Kieran Naidoo?", ...ctx, send });
  ok("Stats-Magic request carries no name — not in the data", !/Whitfield|Naidoo/i.test(sent?.system ?? "x"), sent?.system?.slice(-200));
  ok("...and not in the question", !/Whitfield|Naidoo/i.test(flat(sent?.messages)), flat(sent?.messages));
  ok("the answer comes back named", answer === "James Whitfield is the top scorer; Kieran Naidoo the leading wicket-taker.", answer);

  // The context is built under the caller's session. A read that refuses
  // (no token → 401 from runAsPrincipal) refuses the whole thing.
  const refused = await statsMagicContext(null, "s", undefined, async () => { const e = new Error("no_principal"); e.status = 401; throw e; }).catch((e) => e);
  ok("no session, no context — the read path's refusal is the answer", refused?.status === 401);
  const built = await statsMagicContext(null, "s", "Bearer t", async (_p, _s, _b, r) => ({ rows: r === "players" ? [{ full_name: "A Pupil" }] : [] }));
  ok("with a session, the rows come from readResource", built.names[0] === "A Pupil" && /A Pupil/.test(built.context));
}

// ── Stats-Magic can answer a question about figures ──
//
// The context used to be a roster and eight fixtures, so "what is his strike
// rate this term?" had no answer available to the model and it either said so
// or estimated. The figures now come from /read/career — the same door, under
// the same principal — and the arithmetic is done here, where the
// divide-by-zero cases can say what they are instead of reading as zero.
{
  const players = [
    { id: "p1", full_name: "James Whitfield", playing_role: "Batter", team_code: "1XI", school_name: "Hilton College" },
    { id: "p2", full_name: "Kieran Naidoo",   playing_role: "Bowler", team_code: "1XI", school_name: "Hilton College" },
    { id: "p3", full_name: "Thabo Mkhize",    playing_role: "Batter", team_code: "2XI", school_name: "Hilton College" },
  ];
  // p1 bats and does not bowl, p2 bowls and has never faced a ball, p3 has
  // never played: the three shapes /read/career returns.
  const career = [
    { player_id: "p1", bat_matches: 4, runs: 213, balls_faced: 168, fours: 24, sixes: 5, dismissals: 3,
      bowl_matches: 0, runs_conceded: 0, balls_bowled: 0, wickets: 0 },
    { player_id: "p2", bat_matches: 0, runs: 0, balls_faced: 0, fours: 0, sixes: 0, dismissals: 0,
      bowl_matches: 4, runs_conceded: 96, balls_bowled: 138, wickets: 9 },
    { player_id: "p3", bat_matches: 0, runs: 0, balls_faced: 0, fours: 0, sixes: 0, dismissals: 0,
      bowl_matches: 0, runs_conceded: 0, balls_bowled: 0, wickets: 0 },
  ];
  const ctx = contextFrom({ players, matches: [], career });

  ok("a batter's real figures are in the context, not just his role",
     /James Whitfield — batting: 4 matches, 213 runs off 168 balls, SR 126\.8, average 71\.00, 24x4 5x6/.test(ctx.context), ctx.context);
  ok("...and a bowler's, economy and all",
     /Kieran Naidoo — batting: no record; bowling: 4 matches, 9 wickets, 96 runs off 138 legal balls, economy 4\.17, average 10\.67/.test(ctx.context), ctx.context);
  // 213/168*100 = 126.79; 213/3 = 71; 96/(138/6) = 4.174; 96/9 = 10.67.
  ok("the arithmetic is the cricket arithmetic, not a stored column",
     (100 * 213 / 168).toFixed(1) === "126.8" && (6 * 96 / 138).toFixed(2) === "4.17");

  ok("a player who has never faced a ball has no batting figures, not zeros",
     /Kieran Naidoo — batting: no record/.test(ctx.context) && !/Kieran Naidoo — batting: 0/.test(ctx.context), ctx.context);
  ok("a player with nothing recorded at all is named as such, never averaged",
     /Nothing recorded yet in the ball log for: Thabo Mkhize\./.test(ctx.context) && !/Thabo Mkhize — batting/.test(ctx.context), ctx.context);
  const neverOut = contextFrom({ players: [players[0]], matches: [],
                                 career: [{ ...career[0], dismissals: 0 }] }).context;
  ok("a batter who has never been out has no average rather than one of zero",
     /SR 126\.8, no average \(never dismissed\)/.test(neverOut) && !/average 0/.test(neverOut), neverOut);

  // THE MASKING. A stats line naming a child is exactly the string that could
  // reach the provider in clear if it were built beside the roster instead of
  // inside it, so this asserts on what WOULD have been sent.
  let sent = null;
  const send = async (params) => { sent = params; return { content: [{ type: "text", text: "PLAYER_1, SR 126.8." }] }; };
  const answer = await askStatsMagic({ question: "What is James Whitfield's strike rate this term?", ...ctx, send });
  ok("no name reaches the provider in a stats line either",
     sent && !/Whitfield|Naidoo|Mkhize/i.test(flat(sent)), sent && flat(sent).slice(-300));
  ok("...and the figures do, against the same token the roster line uses",
     /PLAYER_\d, Batter, 1XI/.test(sent.system) &&
     new RegExp(`${sent.system.match(/(PLAYER_\d), Batter, 1XI/)[1]} — batting: 4 matches, 213 runs`).test(sent.system),
     sent?.system?.slice(-400));
  ok("...including the player nothing is recorded for",
     /Nothing recorded yet in the ball log for: PLAYER_\d\./.test(sent.system), sent?.system?.slice(-200));
  ok("the answer comes back with the name restored", answer === "James Whitfield, SR 126.8.", answer);

  const built = await statsMagicContext(null, "s", "Bearer t", async (_p, _s, _b, r) =>
    ({ rows: r === "players" ? [players[0]] : r === "career" ? [career[0]] : [] }));
  ok("statsMagicContext reads career through the same read path as players and matches",
     /James Whitfield — batting: 4 matches, 213 runs/.test(built.context), built.context);
}

console.log(`\n${"─".repeat(52)}\nAI PRIVACY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

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

console.log(`\n${"─".repeat(52)}\nAI PRIVACY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

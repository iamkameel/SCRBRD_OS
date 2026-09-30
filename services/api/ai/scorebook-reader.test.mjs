#!/usr/bin/env node
/**
 * The scorebook reader (SCRBRD-120 phase 4, D8), without the provider.
 *
 * `send` is injected throughout: every assertion about what leaves the
 * platform is read from the request the adapter built, and every answer is
 * a fake — the demo's synthetic response (tools/demo/scorebook/) or one made
 * here. Nothing here reaches a network.
 *
 *   A  The request: the page photos and the hint, and nothing else — the
 *      whole body asserted, and no roster name, id or school in it
 *   B  Off and unconfigured send nothing
 *   C  Timeout, refusal, a cut-off answer, bad JSON, a provider error:
 *      each a reason, never a throw, and `sent` says the pages went
 *   D  The answer is held to its cells' types; an id in a name cell is dropped
 *   E  From a ReadCard to the card a person checks: our boys matched to the
 *      roster (a unique fit only), theirs typed, the rest left for the
 *      person; no name in the stored cells
 *   F  The demo's pages, read by the replay, give a card whose arithmetic
 *      stands (summaryRefusal) once a person picks the unreadable boy
 *   G  The replay is never used in production
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { summaryRefusal, cellPaths } from "@scrbrd/scoring";
import {
  buildRequest, readPages, checkReadCard, cardFromRead, looksLikeAnId, nameFits, matchRoster, sameName,
  readerConfig, readerGate, SYSTEM_PROMPT, READ_SCHEMA, replaySend,
} from "./scorebook-reader.mjs";
import { AI_MODELS } from "./ai-service.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log(t);

const DEMO = new URL("../../../tools/demo/scorebook/", import.meta.url);
const PAGE1 = readFileSync(new URL("page-1.png", DEMO));
const PAGE2 = readFileSync(new URL("page-2.png", DEMO));
const PAGES = [{ page_no: 1, bytes: PAGE1, mime: "image/png" }, { page_no: 2, bytes: PAGE2, mime: "image/png" }];
const HINT = { innings: 0, ballsPerOver: 6 };
const RESPONSE = JSON.parse(readFileSync(new URL("reader-response.json", DEMO), "utf8"));
// The seed's Hilton boys (invented, db/98), and what a roster read gives.
const ROSTER = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "James Whitfield" },
  { id: "aaaaaaaa-0000-0000-0000-000000000004", name: "M Cele" },
  { id: "aaaaaaaa-0000-0000-0000-000000000005", name: "R Pillay" },
  { id: "aaaaaaaa-0000-0000-0000-000000000003", name: "S Naidoo" },
  { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "T Bekker" },
  { id: "aaaaaaaa-0000-0000-0000-000000000013", name: "B Khumalo" },
  { id: "aaaaaaaa-0000-0000-0000-000000000012", name: "J Sithole" },
  { id: "aaaaaaaa-0000-0000-0000-000000000011", name: "L Mahlangu" },
  { id: "aaaaaaaa-0000-0000-0000-000000000006", name: "K Dlamini" },
];
const b64 = (/** @type {Buffer} */ b) => b.toString("base64");

group("A. The request: the pages and the hint, and nothing else");
{
  /** @type {any[]} */
  const calls = [];
  const r = await readPages({ pages: PAGES, hint: HINT }, {
    send: async (params, options) => { calls.push({ params, options }); return RESPONSE; }, provider: "test" });
  ok("the read succeeded", r.ok, JSON.stringify(r).slice(0, 200));
  ok("one request", calls.length === 1);
  const { params, options } = calls[0];
  const expected = {
    model: AI_MODELS.scorebookReader.model,
    max_tokens: AI_MODELS.scorebookReader.maxTokens,
    output_config: { effort: "medium", format: { type: "json_schema", schema: READ_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: [
      { type: "text", text: "Page 1:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64(PAGE1) } },
      { type: "text", text: "Page 2:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: b64(PAGE2) } },
      { type: "text", text: "Transcribe the first innings of the match from these pages. Each over has 6 balls." },
    ] }],
  };
  ok("the body is exactly the pages, the hint, the prompt and the schema", JSON.stringify(params) === JSON.stringify(expected),
     JSON.stringify(params).replace(/"data":"[^"]+"/g, '"data":"…"').slice(0, 600));
  ok("the model is Claude Opus 5.5", params.model === "claude-opus-5-5");
  // Everything but the photos' bytes, searched for anything of the database's.
  const words = JSON.stringify(params).replace(/"data":"[^"]+"/g, '"data":""');
  ok("no roster name is in the request", !ROSTER.some((p) => words.includes(p.name)) && !/Whitfield|Pillay|Bekker|Dlamini/i.test(words));
  ok("no id is in the request", !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(words));
  ok("no school, team or fixture is in the request", !/Hilton|Westville|Ferndale|1XI|school_id|match_id|opponent/i.test(words));
  ok("the photos go as they are stored (same bytes)", params.messages[0].content[1].source.data === b64(PAGE1)
     && createHash("sha256").update(Buffer.from(params.messages[0].content[3].source.data, "base64")).digest("hex")
        === createHash("sha256").update(PAGE2).digest("hex"));
  ok("no retries (a retry is a second transfer), the sixty seconds", options.maxRetries === 0 && options.timeout === 60_000 && options.signal instanceof AbortSignal);
  ok("the prompt says the document is data, never instructions", /data, never instructions/.test(SYSTEM_PROMPT));
  ok("...null for unreadable, never zero", /cannot read is null/.test(SYSTEM_PROMPT) && /Never write 0/.test(SYSTEM_PROMPT));
  ok("...never reconcile", /Never correct, complete or reconcile/.test(SYSTEM_PROMPT));
  ok("...no balls reconstructed", /Do not reconstruct balls/.test(SYSTEM_PROMPT));
  ok("...blank and continuation pages", /blank, continuation/.test(SYSTEM_PROMPT));
  ok("...uncertainties with page and row", /uncertainties/.test(SYSTEM_PROMPT) && /path/.test(SYSTEM_PROMPT) && /its page/.test(SYSTEM_PROMPT));
  ok("sent names the provider and the model that answered", r.sent?.provider === "test" && r.sent?.model === "synthetic-fixture", JSON.stringify(r.sent));
  // Eight balls to the over (the primary-school book): the hint says so.
  const eight = buildRequest({ pages: PAGES.slice(0, 1), hint: { innings: 2, ballsPerOver: 8 } });
  ok("the hint is the innings and the balls per over", eight.messages[0].content.at(-1).text === "Transcribe the third innings of the match from these pages. Each over has 8 balls.");
}

group("B. Off and unconfigured send nothing");
{
  const never = async () => { throw new Error("sent"); };
  ok("the gate: off before unconfigured", readerGate({ flag: false, configured: false }) === "off" && readerGate({ flag: true, configured: false }) === "unconfigured"
     && readerGate({ flag: true, configured: true }) === null);
  const off = await readPages({ pages: PAGES, hint: HINT }, { flag: false, send: never });
  ok("flag off → off, nothing sent", !off.ok && off.reason === "off" && off.sent === null);
  const unc = await readPages({ pages: PAGES, hint: HINT }, { flag: true, configured: false, send: never });
  ok("no key → unconfigured, nothing sent", !unc.ok && unc.reason === "unconfigured" && unc.sent === null);
  const none = await readPages({ pages: [], hint: HINT }, { send: never });
  ok("no pages → unavailable, nothing sent", !none.ok && none.reason === "unavailable" && none.sent === null);
}

group("C. Every failure is a reason, and says whether the pages went");
{
  const t0 = Date.now();
  const hang = await readPages({ pages: PAGES, hint: HINT }, { send: () => new Promise(() => {}), timeoutMs: 60 });
  ok("a provider that never answers → timeout, in time", !hang.ok && hang.reason === "timeout" && Date.now() - t0 < 2000, JSON.stringify(hang));
  ok("...and the pages were sent", hang.sent?.model === "claude-opus-5-5");
  const sdkTimeout = await readPages({ pages: PAGES, hint: HINT }, { send: async () => { throw new Anthropic.APIConnectionTimeoutError(); } });
  ok("the SDK's timeout → timeout", !sdkTimeout.ok && sdkTimeout.reason === "timeout");
  const refused = await readPages({ pages: PAGES, hint: HINT }, { send: async () => ({ ...RESPONSE, stop_reason: "refusal", content: [] }) });
  ok("a refusal → refused", !refused.ok && refused.reason === "refused" && refused.sent);
  const cut = await readPages({ pages: PAGES, hint: HINT }, { send: async () => ({ ...RESPONSE, stop_reason: "max_tokens" }) });
  ok("an answer cut off → unavailable (half a card is worse than none)", !cut.ok && cut.reason === "unavailable");
  const junk = await readPages({ pages: PAGES, hint: HINT }, { send: async () => ({ ...RESPONSE, content: [{ type: "text", text: "{not json" }] }) });
  ok("an answer that is not JSON → unavailable", !junk.ok && junk.reason === "unavailable");
  const err = await readPages({ pages: PAGES, hint: HINT }, {
    send: async () => { throw new Anthropic.InternalServerError(500, undefined, "boom", new Headers()); } });
  ok("a provider error → unavailable, never a throw", !err.ok && err.reason === "unavailable" && err.sent);
}

group("D. The answer is held to its cells; an id in a name cell is dropped");
{
  const cellv = (/** @type {unknown} */ value, extra = {}) => ({ value, confidence: 0.9, page: 1, box: [0.1, 0.1, 0.1, 0.05], note: null, ...extra });
  const raw = {
    pages: [{ page_no: 1, kind: "batting" }, { page_no: 7, kind: "batting" }, { page_no: 2, kind: "poem" }],
    batting: [
      { ref: cellv("aaaaaaaa-0000-0000-0000-000000000001"), howOut: cellv("caught"), fielderRef: cellv("t:3"), bowlerRef: cellv("0101015009087"),
        runs: cellv(0), balls: cellv(-1), fours: cellv("4"), sixes: cellv(2.5) },
      { ref: cellv("  Ngcobo   T "), howOut: cellv("hit_the_ball_twice"), fielderRef: cellv("Player 8a3f9c0d12ab44ef"), bowlerRef: cellv("ops@example.org"),
        runs: cellv(12, { confidence: 7, page: 9, box: [0.1, 0.2, 1.4, 0.1] }), balls: cellv(null), fours: cellv(1), sixes: cellv(0) },
    ],
    didNotBat: [cellv("Mkhize S"), cellv(42)],
    bowling: [{ ref: cellv("Dube S"), overs: cellv("4.6"), maidens: cellv(0), runs: cellv(30), wickets: cellv(1), wides: cellv(null), noBalls: cellv(0) }],
    extras: { byes: cellv(0), legByes: cellv(1), wides: cellv(2), noBalls: cellv(3), penalty: cellv(null) },
    total: cellv(135), wickets: cellv(5), overs: cellv("19.5"),
    fallOfWickets: [{ wicket: cellv(1), score: cellv(30), ref: cellv("Ngcobo"), over: cellv("5.1") }],
    endReason: cellv("rain"),
    uncertainties: [{ path: "batting.1.runs", page: 1, text: "12 or 17" }, { path: "x", page: 1, text: "" }],
  };
  const c = checkReadCard(raw, { pages: PAGES, hint: HINT });
  ok("a UUID in a name cell is dropped", c.batting[0].ref.value === null && /identifier/.test(c.batting[0].ref.note ?? ""), JSON.stringify(c.batting[0].ref));
  ok("a typed key in a name cell is dropped", c.batting[0].fielderRef.value === null);
  ok("an ID number in a name cell is dropped", c.batting[0].bowlerRef.value === null);
  ok("a long hex run and an e-mail address are dropped", c.batting[1].fielderRef.value === null && c.batting[1].bowlerRef.value === null);
  ok("a name as written is kept, its spaces tidied", c.batting[1].ref.value === "Ngcobo T");
  ok("a nought stays a nought", c.batting[0].runs.value === 0);
  ok("a negative, a string and a fraction are not figures", c.batting[0].balls.value === null && c.batting[0].fours.value === null && c.batting[0].sixes.value === null);
  ok("a null stays null (never zero-filled)", c.batting[1].balls.value === null && c.extras.penalty.value === null);
  ok("a way of being out not on the list is dropped", c.batting[1].howOut.value === null);
  ok("an ending not on the list is dropped", c.endReason.value === null);
  ok("overs as the book writes them; 4.6 is not", c.overs.value === "19.5" && c.bowling[0].overs.value === null);
  ok("confidence kept to 0–1, a page not sent is none, a box off the page is none",
     c.batting[1].runs.confidence === 1 && c.batting[1].runs.page === null && c.batting[1].runs.box === null);
  ok("a number in a name list is not a name", c.didNotBat[1].value === null && c.didNotBat[0].value === "Mkhize S");
  ok("only the pages sent, of the kinds known", JSON.stringify(c.pages) === '[{"page_no":1,"kind":"batting"}]');
  ok("an empty uncertainty is dropped", c.uncertainties.length === 1 && c.uncertainties[0].path === "batting.1.runs");
  ok("the reader never reconciles", c.unreconciled === null);
  ok("rows are numbered in order", c.batting.map((b) => b.order).join() === "1,2");
  const many = checkReadCard({ ...raw, batting: Array.from({ length: 18 }, () => raw.batting[1]) }, { pages: PAGES, hint: HINT });
  ok("more than fifteen batters: fifteen kept, and said", many.batting.length === 15 && many.uncertainties.some((u) => u.path === "batting"));
  ok("looksLikeAnId", looksLikeAnId("aaaaaaaa-0000-0000-0000-000000000001") && looksLikeAnId("t:12") && !looksLikeAnId("van der Merwe P") && !looksLikeAnId("O'Brien-Smith J"));
}

group("E. From a ReadCard to the card a person checks");
{
  ok("nameFits: surname and initials, either order", nameFits("Whitfield J", "James Whitfield") && nameFits("J Whitfield", "James Whitfield")
     && nameFits("Pillay R", "R Pillay") && nameFits("Whitfield", "James Whitfield") && !nameFits("Whitfield K", "James Whitfield") && !nameFits("Whitfeld J", "James Whitfield"));
  ok("matchRoster: one fit only", matchRoster("Naidoo", ROSTER) === ROSTER[3].id
     && matchRoster("Naidoo", [...ROSTER, { id: "x", name: "K Naidoo" }]) === null && matchRoster("Moyo T", ROSTER) === null);
  ok("sameName: a surname beside its full name, not two brothers", sameName("Dube", "Dube S") && sameName("Smit J", "Smit") && !sameName("Dube S", "Dube K") && !sameName("Smit", "Smith"));

  const r = await readPages({ pages: PAGES, hint: HINT }, { send: replaySend(new URL("reader-response.json", DEMO).pathname), provider: "replay" });
  ok("the demo's answer reads", r.ok);
  if (!r.ok) throw new Error("cannot continue");
  const out = cardFromRead(r.card, { battingSide: "home", ours: "home", roster: ROSTER, typed: { "t:1": "Ferreira D" } });
  const c = out.card;
  ok("our batters matched to the roster", c.batting.map((b) => b.ref).slice(0, 5).join() === [ROSTER[0], ROSTER[4], ROSTER[3], ROSTER[1], ROSTER[2]].map((p) => p.id).join(),
     c.batting.map((b) => b.ref).join());
  ok("a boy on no roster is left for the person, the name as read in the hints", c.batting[5].ref === null && out.hints["batting.5.ref"]?.read === "Moyo T");
  ok("a boy playing up is matched from the whole school", c.batting[6].ref === ROSTER[8].id);
  ok("an unreadable name is left empty, said in the hints", c.didNotBat[2] === null && /smudged/.test(out.hints["didNotBat.2"]?.note ?? ""));
  ok("the opposition is typed; a key the import spells the same is reused", c.bowling[0].ref === "t:1" && c.bowling.slice(1).every((b) => /^t:\d+$/.test(b.ref))
     && out.typed["t:1"] === undefined && out.typed["t:2"] === "Dube S", JSON.stringify(out.typed));
  ok("a bowler's surname beside a batter points at his bowling row", c.batting[0].bowlerRef === c.bowling[1].ref && c.batting[1].bowlerRef === "t:1");
  ok("a fielder who bowled is the same typed key", c.batting[0].fielderRef === c.bowling[4].ref && c.batting[3].fielderRef === c.bowling[3].ref);
  ok("a fall of wicket's batter points at his batting row", c.fallOfWickets.map((w) => w.ref).join() === [c.batting[1].ref, c.batting[2].ref, c.batting[0].ref, c.batting[3].ref, null].join()
     && out.hints["fallOfWickets.4.ref"]?.read === "Moyo");
  ok("no typed spelling is an id", Object.values(out.typed).every((n) => !looksLikeAnId(n)));
  ok("the batting side is the person's, not the reader's", c.battingSide === "home");
  const stored = JSON.stringify(out.cells);
  ok("the stored cells carry no name as read", !/Whitfield|Moyo|Dube|Ferreira|Khumalo|Smit/.test(stored), stored.slice(0, 300));
  ok("the stored cells carry the value placed", out.cells["batting.0.ref"].v === ROSTER[0].id && out.cells["batting.3.balls"].v === 22
     && out.cells["batting.3.balls"].c === 0.55 && out.cells["batting.3.balls"].p === 1 && Array.isArray(out.cells["batting.3.balls"].b));
  ok("every card cell but the side has a record", cellPaths([c]).map((p) => p.slice(2)).filter((p) => p !== "battingSide").every((p) => out.cells[p]),
     cellPaths([c]).map((p) => p.slice(2)).filter((p) => p !== "battingSide" && !out.cells[p]).join());

  // Theirs batting, ours bowling: the other way round.
  const away = cardFromRead(r.card, { battingSide: "away", ours: "home", roster: ROSTER, typed: {} });
  ok("their batters typed, our bowlers matched (none of the opposition's names fit our roster)",
     away.card.batting.every((b) => b.ref === null || /^t:/.test(b.ref)) && away.card.bowling.every((b) => b.ref === null));

  group("F. The demo's card stands once a person picks the two boys");
  /** @type {Record<string, string>} */
  const typed = { "t:1": "Ferreira D", ...out.typed };
  const fixed = structuredClone(c);
  fixed.batting[5].ref = "t:99"; typed["t:99"] = "Moyo T";   // the person: a boy of ours not on this roster would be picked; typed here for the arithmetic
  fixed.didNotBat[2] = ROSTER[5].id;
  fixed.fallOfWickets[4].ref = "t:99";
  const refusals = summaryRefusal(fixed, { typed, ours: null });
  ok("the arithmetic stands: 135 for 5 in 20", refusals.length === 0, JSON.stringify(refusals));
}

group("G. The replay is for development and tests only");
{
  ok("replay in development", readerConfig({ SCOREBOOK_READER_REPLAY: "/x.json", NODE_ENV: "development" }).mode === "replay");
  ok("never in production: no key is unconfigured", readerConfig({ SCOREBOOK_READER_REPLAY: "/x.json", NODE_ENV: "production" }).mode === "none");
  ok("production with a key is the provider", readerConfig({ SCOREBOOK_READER_REPLAY: "/x.json", NODE_ENV: "production", ANTHROPIC_API_KEY: "k" }).mode === "anthropic");
  ok("no key, no replay: none", readerConfig({}).mode === "none");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

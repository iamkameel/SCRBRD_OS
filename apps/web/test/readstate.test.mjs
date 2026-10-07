/**
 * One read-state contract (GA-I08).
 *
 * `useLive` handed a screen { rows, live, loading, error } and the screens read
 * it as "rows or nothing". Reading, none, not assessed, not yours to read,
 * switched off, could not be read, out of date and half-read all drew the same
 * blank, and a blank reads as "none". `useSkills` threw its state away
 * (`void live; void loading; void error`), so a failed skills read drew as "no
 * assessments" (audit R15).
 *
 * Held here:
 *
 *   - every state, each with its one sentence, "Reading …" / "Could not read …"
 *     / "No … on record", never "done", "ready" or a percentage, never a name
 *   - forbidden, failed and disabled told apart by status and code
 *   - "not assessed yet" is not "none on record", and is not a zero
 *   - partial: one of several reads failed, and the screen says which
 *   - retry runs the SAME read (same resource, same params) and is offered only
 *     where a second read could change the answer, at 44px
 *   - the hooks keep their state, and the screens draw it
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/readstate.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { setToken, resetApi } from "../src/lib/api.js";
import {
  READ_STATES, agoWords, combineReads, isForbidden, isModuleOff, readState, readStateFor, sentenceFor,
} from "../src/lib/readState.js";
import {
  readOnce, readQuery, useLive, usePlayersWithCareerState, useRatings, useSkills, useWeather, useWeatherState,
} from "../src/lib/live.js";
import { EmptyState, ReadState } from "../src/ui/primitives.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/** What useLive() holds, for a read that came back as `over` says. */
const read = (over = {}) => ({ rows: [], live: true, loading: false, error: null, status: null, ...over });
const WHAT = "skills assessments";
const state = (over, o) => readState(read(over), { what: WHAT, ...o });
/** The invented people of the seed. Never a real child. */
const ROWS = [{ id: "p1", name: "Bekker" }, { id: "p2", name: "Naidoo" }];

// ═════════════════════════════════════════════════════
group("Loading: the first fetch is not back");
{
  const r = state({ loading: true, live: false });
  ok("loading", r.state === "loading", r);
  ok("...says it is reading", r.sentence === "Reading skills assessments…", r.sentence);
  ok("...says nothing about the data, and offers no retry", r.retry === false);
  ok("a retry in flight (loading, the old error still set) is loading, not failed",
    state({ loading: true, error: "unreachable", status: null }).state === "loading");
  ok("a refresh that already has rows keeps them: ok, not a flash of loading",
    state({ loading: true, rows: ROWS }).state === "ok");
}

group("Empty: the server answered with nothing");
{
  const r = state({});
  ok("empty", r.state === "empty", r);
  ok("...No … on record", r.sentence === "No skills assessments on record.", r.sentence);
  ok("...no retry: the answer is the answer", r.retry === false);
  ok("empty is not loading, failed or unassessed", !["loading", "failed", "unassessed"].includes(r.state));
}

group("Unassessed: the player exists and has no assessment. Not a zero");
{
  const r = readStateFor(read(), [], { what: WHAT });
  ok("unassessed", r.state === "unassessed", r);
  ok("...says Not assessed yet", r.sentence === "Not assessed yet.", r.sentence);
  ok("...is not 'none on record': that is a different claim", r.state !== "empty" && !/on record/.test(r.sentence));
  ok("...carries no digit at all: not a 0, not a score", !/\d/.test(r.sentence) && !/\d/.test(JSON.stringify(r)));
  ok("a player who HAS an assessment is ok", readStateFor(read(), [{ technical: { footwork: 14 } }], { what: WHAT }).state === "ok");
  ok("unassessed is only said of a read that answered: failed stays failed",
    readStateFor(read({ error: "unreachable" }), [], { what: WHAT }).state === "failed");
  ok("...a read still coming stays loading", readStateFor(read({ loading: true, live: false }), [], { what: WHAT }).state === "loading");
  ok("...a refused read stays forbidden", readStateFor(read({ error: "not_permitted", status: 403 }), [], { what: WHAT }).state === "forbidden");
  ok("a reader without the capability gets nothing back from row-level security, which is not 'not assessed'",
    readStateFor(read(), [], { what: WHAT, mayRead: false }).state === "forbidden");
  ok("...but one who holds it is told Not assessed yet", readStateFor(read(), [], { what: WHAT, mayRead: true }).state === "unassessed");
}

group("Forbidden, disabled and failed are three different things");
{
  const f403 = state({ error: "not_permitted", status: 403, live: false });
  ok("403 not_permitted is forbidden", f403.state === "forbidden", f403);
  ok("...Your role may not read …", f403.sentence === "Your role may not read skills assessments.", f403.sentence);
  ok("...and no retry: asking again cannot change a refusal", f403.retry === false);
  ok("any 403 that is not module_disabled is forbidden (pad_scope)", state({ error: "pad_scope", status: 403 }).state === "forbidden");
  ok("...even a 403 with a code nobody has seen", state({ error: "some_new_reason", status: 403 }).state === "forbidden");
  ok("a Postgres privilege error (42501) is forbidden, however the route dressed it",
    state({ error: "42501", status: 500 }).state === "forbidden" && state({ error: "42501", status: null }).state === "forbidden");

  const off = state({ disabled: "skills", error: null, status: 403 });
  ok("the module switched off is disabled", off.state === "disabled", off);
  ok("...Your school has switched off …", off.sentence === "Your school has switched off skills assessments.", off.sentence);
  ok("...no retry", off.retry === false);
  ok("module_disabled by code alone is disabled, never forbidden or failed",
    state({ error: "module_disabled", status: 403 }).state === "disabled" && !isForbidden({ error: "module_disabled", status: 403 }));
  ok("isModuleOff reads the flag and the code", isModuleOff({ disabled: "skills" }) && isModuleOff({ error: "module_disabled" }) && !isModuleOff({ error: "unreachable" }));

  const failed = state({ error: "unreachable", status: null, live: false });
  ok("unreachable is failed", failed.state === "failed", failed);
  ok("...Could not read …", failed.sentence === "Could not read skills assessments.", failed.sentence);
  ok("...and retry is offered: a second read could answer", failed.retry === true);
  ok("a 500 is failed, not forbidden", state({ error: "boom", status: 500 }).state === "failed");
  ok("a 502, 503 and 504 are failed", [502, 503, 504].every((s) => state({ error: "bad_gateway", status: s }).state === "failed"));
  ok("a timeout (the client aborts: no status at all) is failed", state({ error: "unreachable", status: null }).state === "failed");
  ok("a 404 unknown_resource and a missing adapter are failed", state({ error: "unknown_resource", status: 404 }).state === "failed" && state({ error: "no_adapter" }).state === "failed");
  ok("a refusal code alone, with a 500 status, is NOT forbidden: not_permitted at 500 is a fault",
    state({ error: "not_permitted", status: 500 }).state === "failed");
  ok("a sign-in that has ended (401) is failed, says so, and offers no retry that would be refused the same way",
    (() => { const r = state({ error: "missing_token", status: 401 }); return r.state === "failed" && /sign in again/i.test(r.sentence) && r.retry === false; })());
  ok("the three sentences differ", new Set([f403.sentence, off.sentence, failed.sentence]).size === 3);
}

group("Stale: an observation older than the given age");
{
  const NOW = Date.parse("2026-10-07T12:00:00Z");
  const H = 3600e3;
  const at = (hoursAgo) => new Date(NOW - hoursAgo * H).toISOString();
  const w = (hoursAgo, extra) => readState(read({ rows: [{ matchId: "m1" }] }), { what: "weather", observedAt: at(hoursAgo), maxAgeMs: 6 * H, now: NOW, ...extra });
  ok("older than the age: stale", w(9).state === "stale", w(9));
  ok("...says how long ago, and that it may be out of date", w(9).sentence === "Weather last observed 9 hours ago; it may be out of date.", w(9).sentence);
  ok("...and retry is offered: a re-read may find a newer one", w(9).retry === true);
  ok("within the age: ok", w(2).state === "ok");
  ok("exactly at the age is not stale", w(6).state === "ok");
  ok("no age given, nothing is stale", w(100, { maxAgeMs: undefined }).state === "ok");
  ok("no observation time, nothing to call stale", w(9, { observedAt: null }).state === "ok");
  ok("an unreadable time is not stale either", w(9, { observedAt: "yesterday-ish" }).state === "ok");
  ok("the read's own observedAt is used when none is passed",
    readState(read({ rows: [{}], observedAt: at(9) }), { what: "weather", maxAgeMs: 6 * H, now: NOW }).state === "stale");
  ok("stale never hides a failure: a failed read is failed whatever its age", w(9, {}) && readState(read({ error: "unreachable", observedAt: at(9) }), { what: "weather", maxAgeMs: H, now: NOW }).state === "failed");
  ok("minutes, hours and days are said in whole units", agoWords(5 * 60e3) === "5 minutes ago" && agoWords(60 * 60e3) === "1 hour ago" && agoWords(3 * 24 * H) === "3 days ago" && agoWords(10e3) === "under a minute ago");
}

group("Partial: some of several reads failed");
{
  const players = read({ rows: ROWS });
  const careerFailed = read({ error: "unreachable", status: null, live: false });
  const parts = (p, c) => [{ what: "players", read: p }, { what: "career figures", read: c }];
  const r = combineReads(parts(players, careerFailed));
  ok("players arrived, career did not: partial", r.state === "partial", r);
  ok("...says which, in the reader's words", r.sentence === "Could not read career figures, so what is shown is incomplete.", r.sentence);
  ok("...lists what failed", JSON.stringify(r.failed) === JSON.stringify(["career figures"]));
  ok("...retry is offered", r.retry === true);
  ok("...is not 'ok' and not 'empty': the players with blank figures are not players who have not played", r.state !== "ok" && r.state !== "empty");
  ok("both answered: ok", combineReads(parts(players, read({ rows: [{ id: "p1" }] }))).state === "ok");
  ok("both failed: failed, naming both", (() => { const x = combineReads(parts(careerFailed, careerFailed)); return x.state === "failed" && /players and career figures/.test(x.sentence); })());
  ok("one still coming: loading", combineReads(parts(players, read({ loading: true, live: false }))).state === "loading");
  ok("a read the reader may not see is not a failure: players alone are ok, not partial",
    combineReads(parts(players, read({ error: "not_permitted", status: 403 }))).state === "ok");
  ok("a module switched off is not a failure either", combineReads(parts(players, read({ disabled: "career" }))).state === "ok");
  ok("every read refused: forbidden", combineReads(parts(read({ error: "not_permitted", status: 403 }), read({ error: "not_permitted", status: 403 }))).state === "forbidden");
  ok("nothing anywhere: empty", combineReads(parts(read(), read())).state === "empty");
  ok("an empty career beside real players is ok: a season with no completed match", combineReads(parts(players, read())).state === "ok");
  ok("each part's own state is kept for a screen that wants it", r.parts.length === 2 && r.parts[1].state === "failed" && r.parts[0].state === "ok");
}

group("Ok");
{
  const r = state({ rows: ROWS });
  ok("rows and no trouble: ok", r.state === "ok");
  ok("...nothing to say, so no sentence", r.sentence === null && r.retry === false);
}

group("Exactly one state, and one plain sentence for each");
{
  const shapes = [];
  for (const rows of [[], ROWS]) for (const loading of [false, true]) for (const error of [null, "unreachable", "not_permitted", "module_disabled", "42501", "boom"])
    for (const status of [null, 401, 403, 500]) for (const disabled of [null, "skills"]) shapes.push({ rows, loading, error, status, disabled, live: true });
  let one = true, known = true, said = true;
  for (const sh of shapes) for (const subject of [false, true]) {
    const r = readState(sh, { what: WHAT, subject });
    if (typeof r.state !== "string") one = false;
    if (!READ_STATES.includes(r.state)) known = false;
    if ((r.state === "ok") !== (r.sentence === null)) said = false;
  }
  ok(`${shapes.length * 2} shapes of useLive(): each is exactly one known state`, one && known);
  ok("...every state but ok has a sentence, and ok has none", said);
  ok("the states are the nine", READ_STATES.length === 9 && ["loading", "empty", "unassessed", "forbidden", "disabled", "failed", "stale", "partial", "ok"].every((s) => READ_STATES.includes(s)));
  ok("it never throws on a missing or odd read", (() => { try { readState(undefined); readState(null, {}); readState({}); readState({ rows: "x" }); return true; } catch { return false; } })());
}

group("The sentences: the reader's words, no name, no 'done', no percentage");
{
  const all = [];
  for (const what of ["skills assessments", "the injury list", "career figures", "weather"]) {
    for (const st of ["loading", "empty", "unassessed", "forbidden", "disabled", "failed", "stale", "partial"]) all.push(sentenceFor(st, what, { ageMs: 9 * 3600e3, failed: [what] }));
  }
  ok("none says done or ready", all.every((s) => !/\b(done|ready|complete|completed)\b/i.test(s)), all.find((s) => /\b(done|ready)\b/i.test(s)));
  ok("none prints a percentage", all.every((s) => !/%|percent/i.test(s)));
  ok("each is one sentence (no second full stop inside)", all.every((s) => (s.match(/[.…]/g) ?? []).length <= 1 || /;/.test(s)), all.filter((s) => (s.match(/\./g) ?? []).length > 1));
  ok("loading begins Reading, failure begins Could not read, empty begins No … on record",
    sentenceFor("loading", "x") === "Reading x…" && sentenceFor("failed", "x") === "Could not read x." && sentenceFor("empty", "x") === "No x on record.");
  const withNames = [state({ rows: ROWS }), state({}), readStateFor(read(), []), state({ error: "unreachable" }), combineReads([{ what: "players", read: read({ rows: ROWS }) }, { what: "career figures", read: read({ error: "x" }) }])];
  ok("a child's name in the rows never reaches a sentence", withNames.every((r) => !/Bekker|Naidoo/.test(JSON.stringify(r))));
  ok("without a name for the thing, the sentences still read", sentenceFor("loading") === "Reading…" && sentenceFor("failed") === "Could not read this." && sentenceFor("empty") === "Nothing on record.");
}

group("Pure: no React, no DOM, no clock of its own");
{
  const code = src("../src/lib/readState.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("imports nothing", !/^\s*import\b/m.test(code));
  ok("no React, no DOM, no storage, no fetch", !/\b(react|document|window|localStorage|sessionStorage|fetch)\b/i.test(code));
  ok("the clock is passed in (Date.now only as the default for `now`)", (code.match(/Date\.now\(\)/g) ?? []).length === 1 && /o\.now \?\? Date\.now\(\)/.test(code));
}

// ═════════════════════════════════════════════════════
group("useLive keeps the refusal's status, and the retry asks the same question");
{
  /** Renders a hook once, signed in or out, and hands back what it returned. */
  const probe = (fn, signedIn) => {
    if (signedIn) setToken("test-token"); else resetApi();
    let out;
    const C = () => { out = fn(); return null; };
    renderToStaticMarkup(h(C));
    resetApi();
    return out;
  };

  const first = probe(() => useLive("skills", "coach"), true);
  ok("a signed-in read starts loading, with a status field (null until something answers)", first.loading === true && "status" in first && first.status === null, first);
  ok("...every other field is as it was", first.live === false && first.error === null && Array.isArray(first.rows) && first.rows.length === 0 && !("disabled" in first));
  const demo = probe(() => useLive("skills", "coach"), false);
  ok("a demonstration read carries the field too", "status" in demo && demo.loading === false);

  // The retry: readOnce is the read, and a retry is the same call again.
  const urls = [];
  const real = globalThis.fetch;
  const answer = (status, body) => async (url) => { urls.push(String(url)); return { ok: status < 400, status, json: async () => body }; };
  setToken("test-token");
  try {
    globalThis.fetch = answer(503, { error: "db_down" });
    const bad = await readOnce("match_duties", readQuery({ matchId: "m-1", team: "", skip: null }));
    ok("a 503 comes back failed, with its status", bad.error === "db_down" && bad.status === 503 && bad.live === false && bad.rows.length === 0, bad);
    ok("...and the shared decision calls it failed", readState(bad, { what: "duty rows" }).state === "failed");

    globalThis.fetch = answer(200, { rows: [{ id: "d1", match_id: "m-1", duty: "scorer", person_id: "x", name: "Bekker" }] });
    const good = await readOnce("match_duties", readQuery({ matchId: "m-1", team: "", skip: null }));
    ok("the second read, the same call, answers", good.error === null && good.status === null && good.live === true && good.rows.length === 1, good);
    ok("RETRY KEEPS PARAMS: the second request is the first, byte for byte", urls.length === 2 && urls[0] === urls[1], urls);
    ok("...with the matchId still in it, and nothing wider", /match_duties\?matchId=m-1$/.test(urls[1]) && !/team|skip/.test(urls[1]), urls[1]);
    ok("an empty or null param is dropped, never sent as a wider read", readQuery({ a: "", b: null, c: undefined }) === "" && readQuery(null) === "" && readQuery({}) === "");
    ok("a param is encoded, not trusted", readQuery({ q: "a b&c=d" }) === "?q=a+b%26c%3Dd");

    globalThis.fetch = answer(403, { error: "not_permitted" });
    const refused = await readOnce("skills", "");
    ok("a 403 not_permitted keeps its status and is forbidden", refused.status === 403 && readState(refused, { what: "skills" }).state === "forbidden", refused);
    globalThis.fetch = answer(403, { error: "module_disabled", module: "skills" });
    const off = await readOnce("skills", "");
    ok("a 403 module_disabled is disabled with no error, and the server did answer", off.error === null && off.disabled === "skills" && off.live === true && readState(off, { what: "skills" }).state === "disabled", off);
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    const down = await readOnce("skills", "");
    ok("no network is failed, with no status", down.error === "unreachable" && down.status === null && readState(down, { what: "skills" }).state === "failed", down);
    globalThis.fetch = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    const slow = await readOnce("skills", "");
    ok("a timeout (the client's own abort) is failed", readState(slow, { what: "skills" }).state === "failed");
  } finally { globalThis.fetch = real; resetApi(); }

  const live = src("../src/lib/live.js");
  ok("the hook's effect re-runs on the nonce, with the same resource and query, and calls readOnce",
    /readOnce\(resource, query\)/.test(live) && /\}, \[resource, role, nonce, query\]\);/.test(live));
  ok("useLive and readLive build the query with the one function", (live.match(/readQuery\(params\)/g) ?? []).length >= 2);
}

group("The hooks keep their state (audit R15)");
{
  const probe = (fn, signedIn) => {
    if (signedIn) setToken("test-token"); else resetApi();
    let out;
    const C = () => { out = fn(); return null; };
    renderToStaticMarkup(h(C));
    resetApi();
    return out;
  };
  const sk = probe(() => useSkills("coach"), true);
  ok("useSkills returns the pivot AND the read's state", sk && typeof sk.skills === "object" && "loading" in sk && "error" in sk && "status" in sk && "live" in sk && "disabled" in sk, Object.keys(sk ?? {}));
  ok("...a signed-in skills read that has not come back is loading, not 'no assessments'",
    sk.loading === true && readStateFor(sk, [], { what: "skills assessments" }).state === "loading");
  ok("...and the pivot is empty, as it was", Object.keys(sk.skills).length === 0);
  const skDemo = probe(() => useSkills("coach"), false);
  ok("the demonstration still pivots the seeded matrix, with nothing to say about a read that never ran",
    Object.keys(skDemo.skills).length > 0 && skDemo.loading === false && skDemo.error === null);
  ok("...and a demo player with none is unassessed, not failed", readStateFor(skDemo, [], { what: "skills assessments" }).state === "unassessed");

  const wx = probe(() => useWeatherState("coach"), true);
  ok("useWeatherState exposes the weather read's state beside the map", wx && typeof wx.weather === "object" && wx.loading === true && "error" in wx && "status" in wx);
  const wmap = probe(() => useWeather("coach"), false);
  ok("useWeather keeps its shape for the callers that only want the map", wmap && typeof wmap === "object" && !("weather" in wmap) && !("loading" in wmap));
  const wmapLive = probe(() => useWeather("coach"), true);
  ok("...signed in too: keyed by match id, nothing else", wmapLive && Object.keys(wmapLive).length === 0 && !("loading" in wmapLive));

  const rt = probe(() => useRatings("coach"), true);
  ok("useRatings carries status and disabled too", "status" in rt && "disabled" in rt && rt.loading === true);
  const pc = probe(() => usePlayersWithCareerState("coach"), true);
  ok("usePlayersWithCareerState gives each read's whole state, so a refusal and a failure can be told apart",
    ["loading", "error", "status", "disabled", "rows"].every((k) => k in pc.players && k in pc.career), Object.keys(pc.career));
  ok("...and a career read that has not answered beside players is the screen's `partial`-to-be, not blank figures",
    combineReads([{ what: "players", read: { ...pc.players, loading: false, rows: ROWS } }, { what: "career figures", read: { ...pc.career, loading: false, error: "unreachable" } }]).state === "partial");

  const live = src("../src/lib/live.js");
  ok("the line that threw the state away is gone", !/void live; void loading; void error;/.test(live));
}

// ═════════════════════════════════════════════════════
group("The UI piece: ReadState, and EmptyState on top of it");
{
  const html = (el) => renderToStaticMarkup(el);
  const failed = readState(read({ error: "unreachable" }), { what: WHAT });
  const m = html(h(ReadState, { read: failed, onRetry: () => {} }));
  ok("a failed read draws its sentence and says it is an alert", m.includes("Could not read skills assessments.") && /role="alert"/.test(m) && /data-state="failed"/.test(m));
  ok("...with a Retry button at least 44px tall", /<button[^>]*data-testid="read-state-retry"[^>]*>Retry<\/button>/.test(m) && /min-height:44px/.test(m));
  ok("no Retry without somewhere to retry to", !/<button/.test(html(h(ReadState, { read: failed }))));
  const forbidden = readState(read({ error: "not_permitted", status: 403 }), { what: WHAT });
  const off = readState(read({ disabled: "skills" }), { what: WHAT });
  ok("forbidden gets no retry button, even when one is offered", !/<button/.test(html(h(ReadState, { read: forbidden, onRetry: () => {} }))));
  ok("disabled gets no retry button, even when one is offered", !/<button/.test(html(h(ReadState, { read: off, onRetry: () => {} }))));
  ok("loading, empty and unassessed get none either", ["loading", "empty", "unassessed"].every((s) => {
    const r = { loading: readState(read({ loading: true, live: false }), { what: "x" }), empty: readState(read(), { what: "x" }), unassessed: readStateFor(read(), [], { what: "x" }) }[s];
    return !/<button/.test(html(h(ReadState, { read: r, onRetry: () => {} })));
  }));
  ok("partial and stale offer it", ["partial", "stale"].every((s) => {
    const r = s === "partial"
      ? combineReads([{ what: "players", read: read({ rows: ROWS }) }, { what: "career figures", read: read({ error: "x" }) }])
      : readState(read({ rows: ROWS }), { what: "weather", observedAt: "2026-10-01T00:00:00Z", maxAgeMs: 1000, now: Date.parse("2026-10-07T00:00:00Z") });
    return /Retry<\/button>/.test(html(h(ReadState, { read: r, onRetry: () => {} })));
  }));
  ok("ok draws nothing", html(h(ReadState, { read: { state: "ok", sentence: null, retry: false } })) === "");
  ok("loading says it is a status for a screen reader, and draws Reading", /role="status"/.test(html(h(ReadState, { read: readState(read({ loading: true, live: false }), { what: "players" }) }))) );

  const un = html(h(ReadState, { read: readStateFor(read(), [], { what: WHAT }), icon: "target" }));
  ok("unassessed says Not assessed yet and draws no radar and no zero", /Not assessed yet\./.test(un) && !/data-testid="radar"/.test(un) && !/<svg[^>]*role="img"/.test(un) && !/>\s*0\s*</.test(un));

  const sizes = [m, un, html(h(ReadState, { read: forbidden })), html(h(ReadState, { read: failed, compact: true }))]
    .flatMap((x) => [...x.matchAll(/font-size:\s*([\d.]+)px/g)].map((y) => Number(y[1])));
  ok("nothing is set under 12px", sizes.length > 0 && sizes.every((n) => n >= 12), sizes);
  const code = src("../src/ui/primitives.jsx");
  const block = code.slice(code.indexOf("const ReadState"), code.indexOf("export {"));
  ok("no motion: nothing to hold to prefers-reduced-motion", !/animation|transition|@keyframes/i.test(block));

  // EmptyState, which 69 call sites already use, speaks the same vocabulary.
  ok("EmptyState: error now says Could not read, not the old 'server did not answer'",
    /Could not read this\./.test(html(h(EmptyState, { error: "unreachable" }))) && !/did not answer/.test(html(h(EmptyState, { error: "unreachable" }))));
  ok("EmptyState: a 403 is forbidden, not a failure", /Your role may not read this\./.test(html(h(EmptyState, { error: "not_permitted", status: 403 }))));
  ok("EmptyState: a switched-off module is said as that", /switched this off/.test(html(h(EmptyState, { disabled: "analytics" }))));
  ok("EmptyState: loading says Reading", /Reading…/.test(html(h(EmptyState, { loading: true }))) && !/Loading…/.test(html(h(EmptyState, { loading: true }))));
  ok("EmptyState: empty still draws the caller's own message", /No players are in scope for you\./.test(html(h(EmptyState, { message: "No players are in scope for you." }))));
  ok("EmptyState: a failure with `what` and `onRetry` names it and offers Retry",
    (() => { const x = html(h(EmptyState, { error: true, what: "the injury list", onRetry: () => {} })); return /Could not read the injury list\./.test(x) && /Retry<\/button>/.test(x); })());
  ok("EmptyState: no Retry on a failure unless the screen gives one", !/<button/.test(html(h(EmptyState, { error: "unreachable" }))));
}

// ═════════════════════════════════════════════════════
group("The screens draw it");
{
  const skills = src("../src/views/SkillsView.jsx");
  ok("Skills: reads the skills pivot AND its state", /const skillsRead = useSkills\(role, nonce\)/.test(skills) && /const SKILLS_MATRIX = skillsRead\.skills/.test(skills));
  ok("Skills: the old line that answered every failure with 'no assessment available' is gone", !/No skills assessment available for this player yet/.test(skills));
  ok("Skills: a player with none is said as Not assessed yet, in the list and in the detail", /Not assessed yet/.test(skills) && /readStateFor\(skillsRead/.test(skills) && /data-testid=\{`unassessed-\$\{p\.id\}`\}/.test(skills));
  ok("Skills: no overall figure is made for him (null, not 0)", /const overall=s\?/.test(skills));
  ok("Skills: Retry bumps the screen's nonce, which every read on it carries", /const retry = \(\) => setNonce\(n => n \+ 1\)/.test(skills) && /useLive\("players", role, nonce\)/.test(skills));
  ok("Skills: a failed rating or notes read is said, not hidden as none", /rating-read-state/.test(skills) && /notes-read-state/.test(skills));

  const squad = src("../src/views/SquadView.jsx");
  ok("Squad: reads the roster and its career figures as two reads, and says when one failed", /usePlayersWithCareerState\(role, rosterNonce\)/.test(squad) && /combineReads\(\[/.test(squad) && /squad-read-state/.test(squad));
  ok("Squad: a player with no assessment is said, beside where the radar would be", /squad-skills-read-state/.test(squad) && /readStateFor\(skillsRead/.test(squad));
  ok("Squad: the skills read carries the roster's nonce", /useSkills\(role, rosterNonce\)/.test(squad));

  const prof = src("../src/views/ProfilesView.jsx");
  ok("Profiles: the radar and the development tab say Not assessed yet, never an empty radar", /profile-skills-read-state/.test(prof) && /profile-development-read-state/.test(prof) && !/No skills assessment on file/.test(prof));
  ok("Profiles: a roster whose career figures did not come is partial", /combineReads\(\[/.test(prof) && /profiles-read-state/.test(prof));

  const lg = src("../src/views/LeagueView.jsx");
  ok("Awards: a failed career read beside players is `partial`, in the figures' own words, with the old Retry",
    /combineReads\(\[/.test(lg) && /awards-read-sentence/.test(lg) && /data-testid="awards-retry"/.test(lg));
  ok("Awards: a role refused the figures is not told they 'could not be loaded', and gets no Retry", /const refused = read\.state === "forbidden"/.test(lg));

  const dash = src("../src/views/DashboardView.jsx");
  ok("Day sheet: 'Nobody is out', 'Nothing scheduled' and 'Nothing unread' are said only of reads that answered",
    /draw\(reads\?\.out/.test(dash) && /draw\(reads\?\.week/.test(dash) && /draw\(reads\?\.alerts/.test(dash) && /draw\(reads\?\.matches/.test(dash));
  ok("Day sheet: its Retry bumps the nonce every one of those reads carries", /useLive\("injuries", role, nonce\)/.test(dash) && /useLive\("notifications", role, nonce\)/.test(dash) && /useLive\("training", role, nonce\)/.test(dash));
  ok("Notifications, Injuries, Calendar, Training and Readiness keep their reads' state",
    [["NotificationsView", "notifications-read-state"], ["InjuryView", "injuries-read-state"], ["CalendarView", "calendar-read-state"], ["TrainingView", "training-read-state"], ["ReadinessOverview", "readiness-read-state"], ["MatchCentreView", "mc-read-state"]]
      .every(([f, id]) => src(`../src/views/${f}.jsx`).includes(id)));
  ok("Injuries: a count is drawn only of a read that answered", /const n = \(answered, v\) => \(answered \? v : "—"\)/.test(src("../src/views/InjuryView.jsx")));
  ok("Family and pupil: the next-fixture 'none' and the passport's zero are said only of reads that answered",
    /said=\{matchesSaid\}/.test(src("../src/views/family/family.jsx")) && /careerAnswered \? 0 : "—"/.test(src("../src/views/family/pupil.jsx")) && /!loading && !error && <Line quiet>/.test(src("../src/views/family/matches.jsx")));
}

console.log(`\n${"─".repeat(52)}\nREAD STATE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

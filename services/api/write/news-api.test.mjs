#!/usr/bin/env node
/**
 * A post's urgency and its withdrawal door: notifications slice S2
 * (docs/design/NOTIFICATIONS.md D9, D10, D11), with no database.
 *
 * The route validates shape and hands the row to Postgres; db/91's trigger
 * writes the notice and news_post_withdraw() decides who may take a post
 * back. So this holds what the route itself owes: an urgency that is never
 * "high" reaches no connection, the one it accepts is the one it inserts,
 * and a withdrawal asks the function, with the post's id and nothing else.
 * db/99 §70 and tools/smoke-push.mjs walk the rest against a real database.
 *
 * And the coach's plan (SCRBRD-138 phase B, db/96; group C): its shape, the
 * 1 000 limit, its words as the gate at publish and at send — a hit returns
 * the refusal with the words named and writes no row — and the index's
 * refusal said with who wrote the live plan. db/99 §76 proves the audience.
 * Falsified once each by editing the route: the check removed at send (C
 * names the draft sent with "hamstring"), removed at publish (C names the
 * plan sent and the draft saved with "physio"), and the plan's limit set to
 * the post's 4 000 (C names the 1 001-character body).
 *
 * And changing and throwing away an unsent plan (db/110; group D): the edit
 * reads the plan as its author's, refuses one out with the side in words,
 * checks the words, sends in the same go; the delete asks news_plan_discard()
 * and writes no DELETE of its own. db/99 §87 proves the rules.
 *
 *   node services/api/write/news-api.test.mjs
 */
import { newsRoutes, URGENCY, KINDS, PLAN_BODY_MAX } from "./news-api.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {string} [d] what was seen, on a failure */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SECRET = "news-api-test-secret";
const USER = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-0000000000aa";
const BEARER = `Bearer ${signToken({ userId: USER, deviceId: "test-device", sessionId: SESSION, epoch: 0 }, SECRET)}`;
const SCHOOL = "11111111-1111-1111-1111-111111111111";
const POST = "33333333-3333-4333-8333-333333333333";

/** A pool that fails the test if anything takes a connection from it. */
const untouchable = {
  touched: false,
  async connect() { this.touched = true; throw new Error("the pool was touched"); },
  async query() { this.touched = true; throw new Error("the pool was touched"); },
};

/**
 * @param {{ withdraw?: any, writeError?: any, draft?: any, live?: any }} o
 *   writeError: what the INSERT (or a send's UPDATE) throws; draft: the row
 *   a send reads; live: the live plan the index's refusal names
 */
function fakePool({ withdraw = null, writeError = null, draft = null, live = null } = {}) {
  /** @type {{ sql: string, params: any[] }[]} */
  const asked = [];
  const client = {
    async query(/** @type {string} */ sql, /** @type {any[]} */ params = []) {
      asked.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
      if (/savepoint/i.test(sql)) return { rows: [] };
      if (sql.includes("app_session_begin")) return { rows: [{}] };
      if (sql.includes("insert into news_post")) {
        if (writeError) throw writeError;
        return { rows: [{ id: POST, scope: params[0], published_at: params[6] ? new Date(0) : null, urgency: params[7],
                          kind: params[8], fixture_id: params[9] }] };
      }
      if (/select kind, title, body, fixture_id/.test(sql)) return { rows: draft ? [draft] : [] };
      if (/update news_post set published_at = now\(\)/.test(sql)) {
        if (writeError) throw writeError;
        return { rows: [{ id: params[0] }] };
      }
      if (/where n\.kind = 'plan' and n\.fixture_id = \$1/.test(sql)) return { rows: live ? [live] : [] };
      if (sql.includes("news_post_withdraw(")) return { rows: withdraw ? [withdraw] : [] };
      throw new Error("unexpected statement: " + sql.slice(0, 60));
    },
    release() {},
  };
  return { asked, async connect() { return client; }, async query() { throw new Error("pool.query"); } };
}

/** Run a handler as the server would, and keep what it answered. */
async function call(/** @type {any} */ handler, /** @type {any} */ body, headers = {}, params = {}) {
  const out = { status: 200, body: /** @type {any} */ (null) };
  const res = {
    status(/** @type {number} */ s) { out.status = s; return res; },
    json(/** @type {any} */ b) { out.body = b; return res; },
  };
  await handler({ body, headers, params }, res);
  return out;
}

const post = (/** @type {Record<string, unknown>} */ extra = {}) => ({
  scope: "school", schoolId: SCHOOL, title: "Nets moved", body: "Nets are on the B field this week.", ...extra });

group("A. How loud a post is (D9)");
{
  ok("low and medium, never high", URGENCY.join() === "low,medium");
  const routes = newsRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
  for (const urgency of ["high", "HIGH", "screaming", 2]) {
    const r = await call(routes.publish, post({ urgency }), { authorization: BEARER });
    ok(`urgency ${JSON.stringify(urgency)} is refused`, r.status === 400 && r.body?.error === "urgency_invalid");
  }
  ok("...before any connection", untouchable.touched === false);

  for (const [given, stored] of /** @type {[unknown, string][]} */ ([[undefined, "low"], [null, "low"], ["", "low"], ["low", "low"], ["medium", "medium"]])) {
    const pool = fakePool();
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish,
                         post(given === undefined ? {} : { urgency: given }), { authorization: BEARER });
    const ins = pool.asked.find((a) => a.sql.includes("insert into news_post"));
    ok(`urgency ${JSON.stringify(given)} is inserted as ${stored}`, r.status === 200 && ins?.params[7] === stored && r.body?.urgency === stored);
  }
  // The route writes no notice: the post's trigger does (db/91).
  const pool = fakePool();
  await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish, post({ urgency: "medium" }), { authorization: BEARER });
  ok("the route itself writes no notice", !pool.asked.some((a) => /notification/.test(a.sql)));
}

group("B. Withdrawing a post asks news_post_withdraw() (D11)");
{
  const routes = newsRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
  const bad = await call(routes.withdraw, undefined, { authorization: BEARER }, { id: "x'; drop table news_post; --" });
  ok("an id that is no uuid is no notice, before any connection", bad.status === 404 && bad.body?.error === "no_such_notice" && untouchable.touched === false);

  /** @type {any[]} */
  const changed = [];
  const taken = fakePool({ withdraw: { ok: true, reason: null } });
  const r = await call(newsRoutes({ pool: /** @type {any} */ (taken), secret: SECRET, onChange: (n) => changed.push(n) }).withdraw,
                       undefined, { authorization: BEARER }, { id: POST.toUpperCase() });
  ok("a withdrawal the function allows is taken", r.status === 200 && r.body?.id === POST && r.body?.published === false);
  const asked = taken.asked.find((a) => a.sql.includes("news_post_withdraw("));
  ok("...asked of the function, with the post's id", !!asked && asked.params.join() === POST);
  ok("...not by an UPDATE of its own", !taken.asked.some((a) => /update news_post/i.test(a.sql)));
  ok("...and the public cache is told", changed.length === 1 && changed[0].k === "news" && changed[0].id === POST);

  const refused = fakePool({ withdraw: { ok: false, reason: "no_such_notice" } });
  /** @type {any[]} */
  const quiet = [];
  const x = await call(newsRoutes({ pool: /** @type {any} */ (refused), secret: SECRET, onChange: (n) => quiet.push(n) }).withdraw,
                       undefined, { authorization: BEARER }, { id: POST });
  ok("somebody who may not is told there is no such notice", x.status === 404 && x.body?.error === "no_such_notice");
  ok("...and nothing is told it changed", quiet.length === 0);
}

group("C. The coach's plan (db/96, SCRBRD-138 phase B)");
{
  const FIXTURE = "44444444-4444-4444-8444-444444444444";
  const plan = (/** @type {Record<string, unknown>} */ extra = {}) => ({
    scope: "team", schoolId: SCHOOL, teamCode: "U15A", kind: "plan", fixtureId: FIXTURE,
    title: "The plan: v Westville U15A, Sat 3 Oct", body: "Bat first if we win it. Captain and Mate open.", ...extra });
  const written = (/** @type {any} */ pool) => pool.asked.filter((/** @type {any} */ a) => /insert into news_post|update news_post/i.test(a.sql));

  ok("two kinds, post and plan", KINDS.join() === "post,plan" && PLAN_BODY_MAX === 1000);

  // Shape, before any connection.
  {
    const routes = newsRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
    /** @type {[Record<string, unknown>, string][]} */
    const bad = [
      [{ kind: "note" }, "kind_invalid"],
      [{ scope: "school", teamCode: undefined }, "plan_needs_team_and_fixture"],
      [{ fixtureId: undefined }, "fixture_required"],
      [{ fixtureId: "not-a-uuid" }, "fixture_required"],
      [{ kind: undefined }, "fixture_only_for_plan"],
      [{ body: "x".repeat(PLAN_BODY_MAX + 1) }, "body_too_long"],
    ];
    for (const [extra, code] of bad) {
      const r = await call(routes.publish, plan(extra), { authorization: BEARER });
      ok(`${JSON.stringify(extra).slice(0, 60)} is refused ${code}`, r.status === 400 && r.body?.error === code, JSON.stringify(r.body));
    }
    ok("...a long plan is refused, not cut, and says the limit",
       (await call(routes.publish, plan({ body: "y".repeat(1200) }), { authorization: BEARER })).body?.max === 1000);
    ok("...all before any connection", untouchable.touched === false);
  }

  // The words, at publish: refused, named, nothing written, no connection.
  for (const publish of [true, false]) {
    const pool = fakePool();
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish,
                         plan({ publish, body: "Naidoo is on four overs, physio. Smith had a shocker." }), { authorization: BEARER });
    const what = publish ? "sent" : "saved as a draft";
    ok(`a plan ${what} with refused words is refused 422`, r.status === 422 && r.body?.error === "refused_words", JSON.stringify(r.body));
    ok(`...the words named, with their classes (${what})`,
       JSON.stringify(r.body?.words) === JSON.stringify([{ word: "physio", cls: "health" }, { word: "shocker", cls: "derisive" }]));
    ok(`...in the design's words (${what})`, typeof r.body?.message === "string"
       && r.body.message.startsWith("This can't go to the side with physio and shocker in it.")
       && r.body.message.includes("A boy's health is not for it."));
    ok(`...and the text is not in the answer (${what})`, !JSON.stringify(r.body).includes("Naidoo") && !JSON.stringify(r.body).includes("four overs"));
    ok(`...and no row is written: no connection at all (${what})`, pool.asked.length === 0);
  }
  {
    const pool = fakePool();
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish,
                         plan({ title: "The plan: injured list", body: "Bat first." }), { authorization: BEARER });
    ok("the title is checked as well as the body", r.status === 422 && r.body?.words?.[0]?.word === "injured" && pool.asked.length === 0);
  }

  // A clean plan is written, under a savepoint, with its kind and fixture.
  {
    const pool = fakePool();
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish, plan(), { authorization: BEARER });
    const ins = pool.asked.find((a) => a.sql.includes("insert into news_post"));
    ok("a clean plan is written", r.status === 200 && r.body?.kind === "plan" && r.body?.fixtureId === FIXTURE && r.body?.published === true,
       JSON.stringify(r.body));
    ok("...as kind plan, with the fixture", ins?.params[8] === "plan" && ins?.params[9] === FIXTURE);
    ok("...inside a savepoint", pool.asked.findIndex((a) => /^savepoint news_plan_write$/.test(a.sql)) < pool.asked.indexOf(/** @type {any} */ (ins))
       && pool.asked.some((a) => /^release savepoint news_plan_write$/.test(a.sql)));
  }

  // An ordinary post is not checked (PB-D8), keeps its 4 000, and carries no fixture.
  {
    const pool = fakePool();
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish,
                         post({ body: "Physio clinic on Tuesday. " + "x".repeat(1100) }), { authorization: BEARER });
    const ins = pool.asked.find((a) => a.sql.includes("insert into news_post"));
    ok("an ordinary post is not word-checked, and keeps its 4 000", r.status === 200 && ins?.params[8] === "post" && ins?.params[9] === null
       && String(ins?.params[5]).length > 1000);
  }

  // The index's refusal, in words.
  {
    const pool = fakePool({ writeError: Object.assign(new Error("duplicate key"), { code: "23505", constraint: "news_post_plan_live" }),
                            live: { id: POST, author_name: "V96 Coach", mine: false, published_at: new Date(0), at: "Thu 20:10" } });
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish, plan(), { authorization: BEARER });
    ok("a second live plan is refused 409, with who wrote the first",
       r.status === 409 && r.body?.error === "plan_exists"
       && r.body?.message === "The side already has a plan for this fixture, by V96 Coach, Thu 20:10."
       && r.body?.plan?.id === POST && r.body?.plan?.mine === false, JSON.stringify(r.body));
    ok("...after rolling back to its savepoint", pool.asked.some((a) => /^rollback to savepoint news_plan_write$/.test(a.sql)));
    const hidden = fakePool({ writeError: Object.assign(new Error("duplicate key"), { code: "23505", constraint: "news_post_plan_live" }) });
    const h = await call(newsRoutes({ pool: /** @type {any} */ (hidden), secret: SECRET }).publish, plan(), { authorization: BEARER });
    ok("...and a live plan the writer cannot read is said without a byline",
       h.status === 409 && h.body?.message === "The side already has a plan for this fixture." && h.body?.plan === null);
  }

  // The guard's refusals, by name.
  for (const [constraint, code] of [["news_post_plan_side", "fixture_not_this_side"], ["news_post_plan_fixed", "plan_fixed"],
                                    ["news_post_plan_anchored", "plan_needs_team_and_fixture"]]) {
    const pool = fakePool({ writeError: Object.assign(new Error("guard"), { code: "23514", constraint }) });
    const r = await call(newsRoutes({ pool: /** @type {any} */ (pool), secret: SECRET }).publish, plan(), { authorization: BEARER });
    ok(`db/96's ${constraint} answers 422 ${code}`, r.status === 422 && r.body?.error === code && !r.body?.detail, JSON.stringify(r.body));
  }

  // At send: the draft is read as its author and checked again.
  {
    const dirty = fakePool({ draft: { kind: "plan", title: "The plan", body: "Rest Naidoo, his hamstring.", fixture_id: FIXTURE, school_id: SCHOOL, team_code: "U15A" } });
    const r = await call(newsRoutes({ pool: /** @type {any} */ (dirty), secret: SECRET }).send, undefined, { authorization: BEARER }, { id: POST });
    ok("sending a draft plan with a refused word is refused 422, the word named",
       r.status === 422 && r.body?.error === "refused_words" && r.body?.words?.map((/** @type {any} */ w) => w.word).join() === "hamstring",
       JSON.stringify(r.body));
    ok("...and nothing is changed: no UPDATE", written(dirty).length === 0);
    ok("...the draft read as its author's", dirty.asked.some((a) => /author_id = app_user_id\(\)/.test(a.sql) && a.params[0] === POST));

    const clean = fakePool({ draft: { kind: "plan", title: "The plan", body: "Rest of the order as on the sheet.", fixture_id: FIXTURE, school_id: SCHOOL, team_code: "U15A" } });
    const c = await call(newsRoutes({ pool: /** @type {any} */ (clean), secret: SECRET }).send, undefined, { authorization: BEARER }, { id: POST });
    ok("a clean draft plan is sent, inside a savepoint", c.status === 200 && c.body?.published === true && written(clean).length === 1
       && clean.asked.some((a) => /^savepoint news_plan_write$/.test(a.sql)));

    const twice = fakePool({ draft: { kind: "plan", title: "The plan", body: "Bowl first.", fixture_id: FIXTURE, school_id: SCHOOL, team_code: "U15A" },
                             writeError: Object.assign(new Error("duplicate key"), { code: "23505", constraint: "news_post_plan_live" }),
                             live: { id: "55555555-5555-4555-8555-555555555555", author_name: "V96 Manager", mine: false, published_at: new Date(0), at: "Fri 07:05" } });
    const t = await call(newsRoutes({ pool: /** @type {any} */ (twice), secret: SECRET }).send, undefined, { authorization: BEARER }, { id: POST });
    ok("a draft plan sent beside a live one is refused 409, with the byline", t.status === 409
       && t.body?.message === "The side already has a plan for this fixture, by V96 Manager, Fri 07:05.");

    const ordinary = fakePool({ draft: { kind: "post", title: "Clinic", body: "Physio clinic Tuesday.", fixture_id: null, school_id: SCHOOL, team_code: "U15A" } });
    const o = await call(newsRoutes({ pool: /** @type {any} */ (ordinary), secret: SECRET }).send, undefined, { authorization: BEARER }, { id: POST });
    ok("an ordinary draft is sent unchecked (PB-D8)", o.status === 200 && written(ordinary).length === 1
       && !ordinary.asked.some((a) => /savepoint news_plan_write/.test(a.sql)));

    const none = fakePool();
    const n = await call(newsRoutes({ pool: /** @type {any} */ (none), secret: SECRET }).send, undefined, { authorization: BEARER }, { id: POST });
    ok("a draft that is not the caller's is no draft", n.status === 404 && n.body?.error === "no_such_draft" && written(none).length === 0);
    const routes = newsRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
    const bad = await call(routes.send, undefined, { authorization: BEARER }, { id: "x'; --" });
    ok("an id that is no uuid is no draft, before any connection", bad.status === 404 && untouchable.touched === false);
  }
}

group("D. Changing and throwing away an unsent plan (db/110, Kameel 15 Oct)");
{
  // db/99 §87 proves the rules against Postgres (author only, a sent plan
  // kept and not changed while out); tools/smoke-plan-drafts.mjs walks them
  // over HTTP. This holds what the two routes owe on their own.
  const FIXTURE = "44444444-4444-4444-8444-444444444444";
  /**
   * @param {{ plan?: any, discard?: any, writeError?: any, live?: any }} o
   *   plan: the row the edit reads as its author; discard: what news_plan_discard() answers
   */
  const editPool = ({ plan = null, discard = null, writeError = null, live = null } = {}) => {
    /** @type {{ sql: string, params: any[] }[]} */
    const asked = [];
    const client = {
      async query(/** @type {string} */ sql, /** @type {any[]} */ params = []) {
        asked.push({ sql, params });
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim()) || /savepoint/i.test(sql)) return { rows: [] };
        if (sql.includes("app_session_begin")) return { rows: [{}] };
        if (/select kind, title, published_at, first_sent_at/.test(sql)) return { rows: plan ? [plan] : [] };
        if (/update news_post set body = \$2/.test(sql)) return { rows: plan && plan.published_at == null ? [{ id: params[0] }] : [] };
        if (/update news_post set published_at = now\(\)/.test(sql)) {
          if (writeError) throw writeError;
          return { rows: [{ id: params[0] }] };
        }
        if (/where n\.kind = 'plan' and n\.fixture_id = \$1/.test(sql)) return { rows: live ? [live] : [] };
        if (sql.includes("news_plan_discard(")) return { rows: discard ? [discard] : [] };
        throw new Error("unexpected statement: " + sql.slice(0, 60));
      },
      release() {},
    };
    return { asked, async connect() { return client; }, async query() { throw new Error("pool.query"); } };
  };
  const draftRow = (/** @type {Record<string, unknown>} */ x = {}) => ({ kind: "plan", title: "The plan: v Kearsney, Sat 3 Oct", published_at: null,
    first_sent_at: null, fixture_id: FIXTURE, school_id: SCHOOL, team_code: "U15A", ...x });
  const edits = (/** @type {any} */ p) => p.asked.filter((/** @type {any} */ a) => /update news_post set body/.test(a.sql));
  const sends = (/** @type {any} */ p) => p.asked.filter((/** @type {any} */ a) => /update news_post set published_at = now\(\)/.test(a.sql));
  const edit = async (/** @type {any} */ pool, /** @type {any} */ body, id = POST) =>
    call(newsRoutes({ pool, secret: SECRET }).edit, body, { authorization: BEARER }, { id });

  const p1 = editPool({ plan: draftRow() });
  const r1 = await edit(p1, { body: "  Bowl first if we win it.  ", urgency: "medium" });
  ok("a draft plan is changed: its words trimmed, its urgency as asked, not sent", r1.status === 200 && r1.body?.published === false
     && r1.body?.wasSent === false && JSON.stringify(edits(p1)[0]?.params) === JSON.stringify([POST, "Bowl first if we win it.", "medium"])
     && sends(p1).length === 0, JSON.stringify(r1.body));
  ok("...read first as its author's", p1.asked.some((a) => /author_id = app_user_id\(\)/.test(a.sql) && a.params[0] === POST));
  const p1b = editPool({ plan: draftRow() });
  await edit(p1b, { body: "Bowl first." });
  ok("...no urgency asked leaves the stored one (coalesce)", edits(p1b)[0]?.params[2] === null);

  const p2 = editPool({ plan: draftRow({ first_sent_at: new Date(0) }) });
  const r2 = await edit(p2, { body: "Bowl first after all.", send: true });
  ok("a withdrawn plan is changed and sent again in one go, inside the savepoint", r2.status === 200 && r2.body?.published === true
     && r2.body?.wasSent === true && edits(p2).length === 1 && sends(p2).length === 1 && p2.asked.some((a) => /^savepoint news_plan_write$/.test(a.sql)));

  const p3 = editPool({ plan: draftRow({ published_at: new Date(0), first_sent_at: new Date(0) }) });
  const r3 = await edit(p3, { body: "Bowl first after all." });
  ok("a plan out with the side is refused 409 plan_sent, in words, and nothing written", r3.status === 409 && r3.body?.error === "plan_sent"
     && /Withdraw it first/.test(r3.body?.message ?? "") && edits(p3).length === 0, JSON.stringify(r3.body));

  const p4 = editPool({ plan: draftRow() });
  const r4 = await edit(p4, { body: "Rest Naidoo, his hamstring." });
  ok("a change with a refused word is refused 422, the word named, nothing written", r4.status === 422 && r4.body?.error === "refused_words"
     && r4.body?.words?.map((/** @type {any} */ w) => w.word).join() === "hamstring" && edits(p4).length === 0);

  const p5 = editPool();
  const r5 = await edit(p5, { body: "Bowl first." });
  ok("somebody else's plan, or none, is no draft (404), nothing written", r5.status === 404 && r5.body?.error === "no_such_draft" && edits(p5).length === 0);
  const p6 = editPool({ plan: draftRow({ kind: "post" }) });
  const r6 = await edit(p6, { body: "Bowl first." });
  ok("...nor is an ordinary post: the route changes plans only", r6.status === 404 && edits(p6).length === 0);

  const p7 = editPool({ plan: draftRow({ first_sent_at: new Date(0) }), writeError: Object.assign(new Error("duplicate key"), { code: "23505", constraint: "news_post_plan_live" }),
                        live: { id: "55555555-5555-4555-8555-555555555555", author_name: "V110 Manager", mine: false, published_at: new Date(0), at: "Fri 07:05" } });
  const r7 = await edit(p7, { body: "Bowl first.", send: true });
  ok("sent again beside a live plan: 409, with the byline", r7.status === 409 && r7.body?.message === "The side already has a plan for this fixture, by V110 Manager, Fri 07:05.");

  const guard = editPool({ plan: draftRow() });
  guard.connect = async () => ({ async query(/** @type {string} */ sql) {
    if (/update news_post set body/.test(sql)) throw Object.assign(new Error("sent"), { code: "23514", constraint: "news_post_plan_sent" });
    if (/select kind, title, published_at/.test(sql)) return { rows: [draftRow()] };
    return { rows: [{}] };
  }, release() {} });
  const rg = await edit(guard, { body: "Bowl first." });
  ok("db/110's guard, if it refuses (the plan was sent meanwhile), answers 422 plan_sent", rg.status === 422 && rg.body?.error === "plan_sent", JSON.stringify(rg.body));

  const routes = newsRoutes({ pool: /** @type {any} */ (untouchable), secret: SECRET });
  for (const [body, code] of [[{ body: "" }, "body_required"], [{ body: "x".repeat(PLAN_BODY_MAX + 1) }, "body_too_long"],
                              [{ body: "Bowl first.", urgency: "high" }, "urgency_invalid"]]) {
    const r = await call(routes.edit, body, { authorization: BEARER }, { id: POST });
    ok(`a change ${code === "urgency_invalid" ? "to urgency high" : code} is refused 400 ${code} before any connection`, r.status === 400 && r.body?.error === code && untouchable.touched === false);
  }
  const badId = await call(routes.edit, { body: "Bowl first." }, { authorization: BEARER }, { id: "x'; --" });
  ok("an id that is no uuid is no draft, before any connection", badId.status === 404 && untouchable.touched === false);

  // Throwing away: news_plan_discard() decides.
  /** @param {any} answer */
  const discard = async (answer, id = POST) => {
    const p = editPool({ discard: answer });
    const r = await call(newsRoutes({ pool: /** @type {any} */ (p), secret: SECRET }).discard, undefined, { authorization: BEARER }, { id });
    return { r, p };
  };
  const d1 = await discard({ ok: true, reason: null });
  ok("a plan never sent is thrown away by the function, with the post's id and nothing else", d1.r.status === 200 && d1.r.body?.deleted === true
     && d1.p.asked.some((a) => /select ok, reason from news_plan_discard\(\$1\)/.test(a.sql) && JSON.stringify(a.params) === JSON.stringify([POST]))
     && !d1.p.asked.some((a) => /delete from/i.test(a.sql)));
  const d2 = await discard({ ok: false, reason: "plan_kept" });
  ok("a plan sent, now or before, is kept: 409 plan_kept, in words", d2.r.status === 409 && d2.r.body?.error === "plan_kept" && /cannot be deleted/.test(d2.r.body?.message ?? ""));
  const d3 = await discard({ ok: false, reason: "no_such_draft" });
  ok("anything else is no draft: 404", d3.r.status === 404 && d3.r.body?.error === "no_such_draft");
  const d4 = await discard({ ok: false, reason: "not_permitted" });
  ok("...and nobody signed in is 403", d4.r.status === 403 && d4.r.body?.error === "not_permitted");
  const badDiscard = await call(routes.discard, undefined, { authorization: BEARER }, { id: "nope" });
  ok("an id that is no uuid is no draft, before any connection", badDiscard.status === 404 && untouchable.touched === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * Publishing a notice.
 *
 * Four capabilities — news.read and three publish tiers — have been in the
 * model since the first migration with nothing behind them. This is the write
 * half of giving them something to govern.
 *
 * THE ROUTE DECIDES NOTHING. The tier is the SCOPE, and the INSERT policy on
 * news_post reads the anchor to pick which capability to demand: a coach with
 * news.publish.team cannot post to a whole school by sending scope "school",
 * because the policy asks app_can('news.publish.school', …) for that row and
 * gets no. So this validates shape, hands the row to Postgres, and reports
 * what came back — a refusal here is the database's, not a second opinion.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { refusedWords, refusalMessage } from "@scrbrd/policy/words";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How loud a post's notice is (db/91): never "high", which is the system's. */
export const URGENCY = Object.freeze(["low", "medium"]);
const clean = (/** @type {unknown} */ v, /** @type {number} */ max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

/** What a post may be (db/96): an ordinary post, or the coach's plan for one fixture. */
export const KINDS = Object.freeze(["post", "plan"]);
/** A plan is read on a bus (SCRBRD-138 phase B §5.1, PB-D13); an ordinary post keeps db/12's 4 000. */
export const PLAN_BODY_MAX = 1000;

/**
 * THE PLAN'S WORDS ARE CHECKED HERE, AND ONLY HERE ON THE SERVER (§3.4,
 * PB-D7, PB-D8). Before a plan is written, saved or sent, and before a draft
 * plan is sent, its title and body go through refusedWords()
 * (packages/policy/src/words.mjs, the one list). A hit throws the refusal,
 * with the words named, before any row is written: nothing of it is stored,
 * logged or told to the side (PB-D10). The refusal's body carries the words
 * and the sentence, never the text; write/replay.mjs keeps no receipt of it.
 * An ordinary post is not checked (PB-D8).
 * @param {string | null} title @param {string | null} body
 */
function checkPlanWords(title, body) {
  const words = refusedWords(`${title ?? ""}\n${body ?? ""}`);
  if (words.length) throw Object.assign(err("refused_words", 422), { extra: { words, message: refusalMessage(words) } });
}

/** The index's refusal (db/96 news_post_plan_live), as the route says it (§1.3). */
const PLAN_LIVE = "news_post_plan_live";
/**
 * The guard's refusals (db/96), by the constraint name each is raised under.
 * @type {Record<string, string>}
 */
const GUARD = {
  news_post_kind_known: "kind_invalid",
  news_post_plan_anchored: "plan_needs_team_and_fixture",
  news_post_post_unanchored: "fixture_only_for_plan",
  news_post_plan_side: "fixture_not_this_side",
  news_post_plan_fixed: "plan_fixed",
  news_post_public_not_plan: "plan_not_public",
};

/**
 * The three doors to the public home page (SCRBRD-142 §3, db/83), each a
 * function that decides who may: request (the author), approve (a
 * school-wide broadcast.publish holder at the post's school who is neither
 * author nor requester, and not for a post naming a pupil), withdraw (the
 * author, or any broadcast.publish holder at the school — a decline too).
 * A refusal's code becomes its status; `names_pupils` carries the scan's
 * count and never a name.
 */
const PUBLIC_DOOR = /** @type {const} */ ({ request: "news_public_request", approve: "news_public_approve", withdraw: "news_public_withdraw" });
/** @type {Record<string, number>} */
const PUBLIC_STATUS = { no_such_post: 404, not_permitted: 403, own_post: 403, names_pupils: 422 };

/**
 * @param {RouteDeps & {onChange?: (note: {k: string, id: string}) => void}} deps
 *   `onChange`: what a committed change that can move the public home page
 *   is told to (public-api.mjs's changed(), wired in server.mjs), before the
 *   answer is written — as listing-api.mjs does
 * @returns {Record<string, Handler>}
 */
export function newsRoutes({ pool, secret, onChange }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "23514" && GUARD[e.constraint]) return res.status(422).json({ error: GUARD[e.constraint] });
      if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school_or_competition" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error"),
                                ...(typeof e.count === "number" ? { count: e.count } : {}),
                                ...(e.extra && typeof e.extra === "object" ? e.extra : {}) });
    }
  };

  /**
   * Write a plan row (an INSERT, or a send's UPDATE) under a savepoint, so
   * the index's refusal can be said in words: which plan is live for the
   * side, by whom and when (§1.3), as this writer may read it. `mine` tells
   * the screen to offer the author his own; a live plan the writer may not
   * read is said without a byline.
   * @param {any} client @param {string} sql @param {unknown[]} params
   * @param {{ fixture: string, school: string, team: string }} side
   */
  const writePlan = async (client, sql, params, side) => {
    await client.query("savepoint news_plan_write");
    try {
      const r = await client.query(sql, params);
      await client.query("release savepoint news_plan_write");
      return r;
    } catch (/** @type {any} */ e) {
      if (e.code !== "23505" || e.constraint !== PLAN_LIVE) throw e;
      await client.query("rollback to savepoint news_plan_write");
      const live = (await client.query(
        `select n.id, u.name as author_name, (n.author_id = app_user_id()) as mine, n.published_at,
                to_char(n.published_at at time zone 'Africa/Johannesburg', 'Dy HH24:MI') as at
           from news_post n left join app_user u on u.id = n.author_id
          where n.kind = 'plan' and n.fixture_id = $1 and n.school_id = $2 and n.team_code = $3
            and n.published_at is not null
          limit 1`, [side.fixture, side.school, side.team])).rows[0];
      const by = live ? [live.author_name ? `by ${live.author_name}` : null, live.at].filter(Boolean).join(", ") : "";
      throw Object.assign(err("plan_exists", 409), { extra: {
        message: `The side already has a plan for this fixture${by ? `, ${by}` : ""}.`,
        plan: live ? { id: live.id, authorName: live.author_name ?? null, mine: live.mine === true, publishedAt: live.published_at } : null,
      } });
    }
  };

  return {
    // POST /api/news { scope, schoolId?, teamCode?, competitionId?, title, body, publish?, urgency?, kind?, fixtureId? }
    //
    // Sending a post writes its one notice (db/91, NOTIFICATIONS.md D10): the
    // post's trigger, not this route. `urgency` is how loud that notice is:
    // "low" (the default) stays in the app; "medium" is "Send to phones too".
    // Never "high": that is the system's, and the column's CHECK says so too.
    //
    // A PLAN (db/96, SCRBRD-138 phase B): kind "plan" with the fixture's id,
    // to one side (scope "team"). Its body is at most 1 000 characters, and
    // more is refused, not cut; its words are checked before it is written,
    // saved or sent (checkPlanWords above); a second live plan for the
    // fixture and side is refused with who wrote the first. The fixture must
    // have the side at one end, or db/96's guard refuses it. Who may write it
    // is db/12's insert policy: news.publish.team at the side (PB-D4).
    publish: handle(async (req) => {
      const b = req.body || {};
      const scope = String(b.scope ?? "").trim();
      if (!["team", "school", "competition"].includes(scope)) throw err("scope_invalid");
      const kind = b.kind == null || b.kind === "" ? "post" : String(b.kind);
      if (!KINDS.includes(kind)) throw err("kind_invalid");
      let fixture = null;
      if (kind === "plan") {
        if (scope !== "team") throw err("plan_needs_team_and_fixture");
        fixture = String(b.fixtureId ?? "").toLowerCase();
        if (!UUID.test(fixture)) throw err("fixture_required");
      } else if (b.fixtureId != null && b.fixtureId !== "") {
        throw err("fixture_only_for_plan");
      }

      const title = clean(b.title, 140);
      if (!title || title.length < 3) throw err("title_required");
      if (kind === "plan" && b.body != null && String(b.body).trim().length > PLAN_BODY_MAX) {
        throw Object.assign(err("body_too_long"), { extra: { max: PLAN_BODY_MAX } });
      }
      const body = clean(b.body, kind === "plan" ? PLAN_BODY_MAX : 4000);
      if (!body) throw err("body_required");
      if (kind === "plan") checkPlanWords(title, body);
      const urgency = b.urgency == null || b.urgency === "" ? "low" : String(b.urgency);
      if (!URGENCY.includes(urgency)) throw err("urgency_invalid");

      // The anchor each scope needs, checked here so the refusal names the
      // missing field rather than arriving as a constraint violation.
      let school = null, team = null, competition = null;
      if (scope === "competition") {
        competition = String(b.competitionId ?? "");
        if (!UUID.test(competition)) throw err("competition_required");
      } else {
        school = String(b.schoolId ?? "");
        if (!UUID.test(school)) throw err("school_required");
        if (scope === "team") {
          team = clean(b.teamCode, 8);
          if (!team || !/^[A-Z0-9]{2,8}$/.test(team)) throw err("team_code_required");
        }
      }

      // Saved unsent by default. A notice goes out when somebody says so, and
      // the read policy refuses a draft to everyone but its author.
      const publish = b.publish !== false;

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const sql = `insert into news_post (scope, school_id, team_code, competition_id, title, body, published_at, urgency, kind, fixture_id)
           values ($1, $2, $3, $4, $5, $6, case when $7 then now() else null end, $8, $9, $10)
           returning id, scope, published_at, urgency, kind, fixture_id`;
        const params = [scope, school, team, competition, title, body, publish, urgency, kind, fixture];
        const { rows } = kind === "plan"
          ? await writePlan(client, sql, params, { fixture: String(fixture), school: String(school), team: String(team) })
          : await client.query(sql, params);
        // No row and no error is the policy declining: this person does not
        // hold the tier this scope demands.
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id, scope: rows[0].scope, published: rows[0].published_at != null, urgency: rows[0].urgency,
                 kind: rows[0].kind ?? kind, fixtureId: rows[0].fixture_id ?? fixture };
      });
    }),

    // POST /api/news/:id/publish — send a draft. Its notice is written by the
    // post's trigger (db/91), at the urgency the draft was saved with.
    //
    // A draft PLAN is read first, as its author (db/12: a draft is his
    // alone), and its words checked again before it goes (§3.4): the list
    // may have grown since it was saved, and sending is the moment it reaches
    // the side. A hit refuses and changes nothing; so does a live plan
    // already on the fixture for the side. There is no edit route: a sent
    // plan is changed by withdrawing it (it is a draft again) and sending it.
    send: handle(async (req) => {
      const id = String(req.params?.id ?? "").toLowerCase();
      if (!UUID.test(id)) throw err("no_such_draft", 404);
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const draft = (await client.query(
          `select kind, title, body, fixture_id, school_id, team_code from news_post
            where id = $1 and published_at is null and author_id = app_user_id()`, [id])).rows[0];
        if (!draft) throw err("no_such_draft", 404);
        const sql = `update news_post set published_at = now()
            where id = $1 and published_at is null returning id`;
        let rows;
        if (draft.kind === "plan") {
          checkPlanWords(draft.title, draft.body);
          ({ rows } = await writePlan(client, sql, [id], { fixture: draft.fixture_id, school: draft.school_id, team: draft.team_code }));
        } else {
          ({ rows } = await client.query(sql, [id]));
        }
        if (!rows.length) throw err("no_such_draft", 404);
        return { id: rows[0].id, published: true };
      });
    }),

    // POST /api/news/:id/withdraw — take one back. The row stays, so a
    // disputed notice can still be shown to have existed; it stops being read.
    // news_post_withdraw() (db/91, D11) decides who: the author, or a
    // news.publish.school holder at the post's school; anybody else is told
    // there is no such notice, as before. Its notice is retracted by the
    // post's trigger, and its readers told it was withdrawn.
    withdraw: handle(async (req) => {
      const raw = String(req.params?.id ?? "").toLowerCase();
      if (!UUID.test(raw)) throw err("no_such_notice", 404);
      const id = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const r = (await client.query(`select ok, reason from news_post_withdraw($1)`, [raw])).rows[0];
        if (!r?.ok) throw err(r?.reason === "not_permitted" ? "not_permitted" : "no_such_notice", r?.reason === "not_permitted" ? 403 : 404);
        return raw;
      });
      // Committed (runAsPrincipal has returned): a notice withdrawn here
      // leaves the home page too (public_news() requires published_at), so
      // the public cache drops now rather than when the notification arrives.
      onChange?.({ k: "news", id });
      return { id, published: false };
    }),

    // POST /api/news/:id/public/request · …/approve · …/withdraw
    ...Object.fromEntries(Object.entries(PUBLIC_DOOR).map(([door, fn]) => [`public_${door}`, handle(async (req) => {
      const id = String(req.params.id ?? "").toLowerCase();
      if (!UUID.test(id)) throw err("no_such_post", 404);
      const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
        (await client.query(`select * from ${fn}($1)`, [id])).rows[0]);
      if (!r?.ok) {
        const reason = r?.reason ?? "refused";
        throw Object.assign(err(reason, PUBLIC_STATUS[reason] ?? 409), r?.names != null ? { count: Number(r.names) } : {});
      }
      // Committed: drop the public news before answering, as listing does.
      onChange?.({ k: "news", id });
      return { ok: true, id };
    })])),
  };
}

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

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

export function newsRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school_or_competition" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /api/news { scope, schoolId?, teamCode?, competitionId?, title, body, publish? }
    publish: handle(async (req) => {
      const b = req.body || {};
      const scope = String(b.scope ?? "").trim();
      if (!["team", "school", "competition"].includes(scope)) throw err("scope_invalid");

      const title = clean(b.title, 140);
      if (!title || title.length < 3) throw err("title_required");
      const body = clean(b.body, 4000);
      if (!body) throw err("body_required");

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
        const { rows } = await client.query(
          `insert into news_post (scope, school_id, team_code, competition_id, title, body, published_at)
           values ($1, $2, $3, $4, $5, $6, case when $7 then now() else null end)
           returning id, scope, published_at`,
          [scope, school, team, competition, title, body, publish]);
        // No row and no error is the policy declining: this person does not
        // hold the tier this scope demands.
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id, scope: rows[0].scope, published: rows[0].published_at != null };
      });
    }),

    // POST /api/news/:id/publish — send a draft.
    send: handle(async (req) =>
      runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `update news_post set published_at = now()
            where id = $1 and published_at is null returning id`, [req.params.id]);
        if (!rows.length) throw err("no_such_draft", 404);
        return { id: rows[0].id, published: true };
      })),

    // POST /api/news/:id/withdraw — take one back. The row stays, so a
    // disputed notice can still be shown to have existed; it stops being read.
    withdraw: handle(async (req) =>
      runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `update news_post set published_at = null
            where id = $1 and published_at is not null returning id`, [req.params.id]);
        if (!rows.length) throw err("no_such_notice", 404);
        return { id: rows[0].id, published: false };
      })),
  };
}

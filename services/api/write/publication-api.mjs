/**
 * SCRBRD — publishing a side of a fixture (SCRBRD-083 phase 1).
 *
 * fixture_publish() (db/47) has existed since the records did; this is its
 * button's route. Signed in, as the caller: the function checks that he holds
 * broadcast.publish at THAT side's school and team, so the away school's
 * publisher cannot publish the home side, nor the home school's the away
 * (L5, each school speaks for its own children). Nothing here decides who may.
 *
 *   GET  /api/matches/:id/publication   each side's state as this reader may
 *                                       read it (fixture_publication's own
 *                                       policy: fixture.read at that side),
 *                                       whether he may change it, and for a
 *                                       side he may: how many of it the public
 *                                       surfaces name (SCRBRD-133 D3, counts)
 *   POST /api/matches/:id/publication   { side: "home" | "away", published: bool }
 *
 * NEVER SERVED STALE AFTER IT ANSWERS. The public pages' cache is dropped by
 * db/59's notification, which arrives on its own connection whenever the
 * listening backend gets to it — under load, after this route has answered
 * and after the publisher's next request has been served from the old entry.
 * So once fixture_publish() has committed, `onChange` (public-api.mjs's
 * changed(), wired in server.mjs) drops this fixture's entry before the
 * answer is written: the next public read anywhere in this process reads the
 * new state. The notification still drops it too, and is what reaches every
 * other API instance and every change made outside this route.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { nameFor } from "../public/redact.mjs";
/** @import { RouteDeps, IdHandler } from "../api-types.mjs" */

/**
 * SCRBRD-133 G1 (D3): how many of a side are named on the public surfaces —
 * the live page and the ground display — and how many shown by position, for
 * the setup section's "8 of 11 named on public surfaces · 3 shown by
 * position". Counts only, never a name, and only for a side the reader may
 * publish (his own school's boys, whom he can read anyway).
 *
 * The side is the team sheet (match_squad: not withdrawn, not twelfth) and
 * every boy of that side's school the log names. For a boy in the log the
 * facts are public_match_people()'s own — the row the public projection
 * names him from — so the count is the display's, not a second reading of
 * the rule; a boy on the sheet and not yet in the log is asked the same
 * question through public_name_facts() for the side's team, published as the
 * side is. Each through nameFor(), redact.mjs's: publicName() and nothing else.
 */
const NAMES_SQL = `
  with m as (
    select id, case when $2 = 'home' then school_id else away_school_id end as school,
           case when $2 = 'home' then team_code else away_team_code end as team
      from match where id = $1),
  logged as (
    select x.player_id, x.school_published, x.facts, x.full_name, x.surname, x.known_as, x.served_on
      from public_match_people($1) x
      join player p on p.id = x.player_id
      join m on p.school_id = m.school),
  sheet as (
    select p.id as player_id, fixture_side_published(m.id, $2) as school_published,
           public_name_facts(p.id, m.team, sa_today()) as facts,
           p.full_name, p.surname, p.known_as, to_char(sa_today(), 'YYYY-MM-DD') as served_on
      from match_squad q
      join m on q.match_id = m.id
      join player p on p.id = q.player_id and p.school_id = m.school
     where q.side = $2 and not q.withdrawn and not q.twelfth
       and not exists (select 1 from logged l where l.player_id = p.id))
  select * from logged union all select * from sheet`;

/**
 * @param {RouteDeps & {onChange?: (note: {k: string, id: string}) => void}} deps
 *   `onChange`: what a committed change is told to, before the answer
 * @returns {Record<string, IdHandler>}
 */
export function publicationRoutes({ pool, secret, onChange }) {
  return {
    read: async (req, res) => {
      try {
        const rows = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select s.side,
                  coalesce(f.published, false) as published,
                  s.school_id is not null as on_platform,
                  s.school_id is not null
                    and app_can('broadcast.publish', s.school_id, s.team_code,
                                '00000000-0000-0000-0000-000000000000'::uuid, m.id) as may_publish
             from match m
             cross join lateral (values ('home', m.school_id, m.team_code),
                                        ('away', m.away_school_id, m.away_team_code)) as s(side, school_id, team_code)
             left join fixture_publication f on f.match_id = m.id and f.side = s.side
            where m.id = $1
            order by s.side desc`, [req.params.id])).rows);
        // D3: the count for each side this reader may publish, as the public
        // projection names it today.
        for (const r of rows) {
          r.names = null;
          if (!r.on_platform || !r.may_publish) continue;
          const people = await runAsPrincipal(pool, secret, req.headers?.authorization,
            async (client) => (await client.query(NAMES_SQL, [req.params.id, r.side])).rows);
          const named = people.filter((p) => nameFor(p, p.served_on) != null).length;
          r.names = { named, positions: people.length - named, total: people.length };
        }
        res.json({ matchId: req.params.id, sides: rows });
      } catch (/** @type {any} */ e) {
        if (e.code === "22P02") return res.status(404).json({ error: "not_found" });
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
    set: async (req, res) => {
      const { side, published } = req.body ?? {};
      if (side !== "home" && side !== "away") return res.status(400).json({ error: "unknown_side" });
      if (typeof published !== "boolean") return res.status(400).json({ error: "no_answer" });
      try {
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => (await client.query(
          `select ok, reason from fixture_publish($1, $2, $3)`, [req.params.id, side, published])).rows[0]);
        if (!r?.ok) {
          const status = r?.reason === "not_permitted" ? 403 : r?.reason === "no_such_fixture" ? 404 : 422;
          return res.status(status).json({ error: r?.reason ?? "refused" });
        }
        // Committed (runAsPrincipal has returned): drop the public entry now,
        // not when the notification gets here.
        onChange?.({ k: "match", id: String(req.params.id).toLowerCase() });
        res.json({ ok: true, side, published });
      } catch (/** @type {any} */ e) {
        if (e.code === "22P02") return res.status(404).json({ error: "no_such_fixture" });
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
  };
}

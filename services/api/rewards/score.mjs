/**
 * SCRBRD — the rewards figure. Private; see weights.mjs for why this
 * directory must never be reachable from apps/web.
 *
 * One number per boy, 0 to 100, from four terms and two controls, all named
 * in WEIGHT_KEYS and weighted by reward_weight. What leaves this module is
 * the figure and a rank. Not the terms, not the weights, not which term
 * moved: a breakdown with the weights known is the algorithm, and the
 * weights are inferable from enough breakdowns.
 *
 *   performance  capped cricket units over the last 90 days
 *   rating       where he is now on the 1-20 rubric, latest per attribute
 *   evidence     how many attributes were rated recently, decayed by age
 *   growth       latest minus earliest per attribute over 180 days
 *   windowCap    the most one match may contribute (anti-farming)
 *   teamGate     how much the side's win ratio this season scales him
 *
 * Inputs are read AS THE PRINCIPAL: player rows pass app_can on
 * player.development.read, so a coach computes his own side, a director the
 * school, a boy himself, and a parent nobody. The ball log and the ratings
 * come through the same views every screen reads.
 */
import { weightsFor } from "./weights.mjs";

const NIL = "00000000-0000-0000-0000-000000000000";
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const INPUTS = `
with boys as (
  select p.id, p.full_name, p.team_code, p.school_id
    from player p
   where ($1::text is null or p.team_code = $1)
     and app_can('player.development.read', p.school_id, p.team_code, p.id, '${NIL}'::uuid)),
bat as (
  select i.player_id, i.match_id, sum(i.runs)::int as runs
    from player_innings i join match m on m.id = i.match_id
   where m.starts_at > now() - interval '90 days' group by 1, 2),
bowl as (
  select f.player_id, f.match_id, sum(f.wickets)::int as wickets
    from bowler_innings_figures f join match m on m.id = f.match_id
   where m.starts_at > now() - interval '90 days' group by 1, 2),
per_match as (
  select coalesce(a.player_id, b.player_id) as player_id, coalesce(a.runs, 0) as runs, coalesce(b.wickets, 0) as wickets
    from bat a full join bowl b on a.player_id = b.player_id and a.match_id = b.match_id),
latest as (
  select distinct on (player_id, category, metric) player_id, category, metric, score, assessed_on
    from player_skill order by player_id, category, metric, assessed_on desc),
earliest as (
  select distinct on (player_id, category, metric) player_id, category, metric, score, assessed_on
    from player_skill where assessed_on > sa_today() - 180 order by player_id, category, metric, assessed_on asc),
gate as (
  select e.school_id, e.team_code, sum(e.won)::numeric / nullif(sum(e.played), 0) as win_ratio
    from competition_entrant e join competition c on c.id = e.competition_id
   where c.season_id = (select id from season_for(sa_today(), 'school')) group by 1, 2)
select b.id, b.full_name, b.team_code,
       coalesce((select json_agg(json_build_object('runs', pm.runs, 'wickets', pm.wickets)) from per_match pm where pm.player_id = b.id), '[]') as matches,
       (select avg(l.score) from latest l where l.player_id = b.id) as rating,
       (select count(*) from latest l where l.player_id = b.id and l.assessed_on > sa_today() - 90) as rated_metrics,
       (select sa_today() - max(l.assessed_on) from latest l where l.player_id = b.id) as days_since_rated,
       (select avg(l.score - e.score) from latest l join earliest e using (player_id, category, metric)
         where l.player_id = b.id and l.assessed_on > e.assessed_on) as growth,
       g.win_ratio
  from boys b left join gate g on g.school_id = b.school_id and g.team_code = b.team_code
 order by b.full_name`;

/** Cricket units for one match: runs and wickets on one scale, then capped. */
const units = (m) => m.runs / 20 + 1.5 * m.wickets;

/** The figure for every boy the principal may read, ranked. */
export async function rewardFigures(client, { teamCode = null } = {}) {
  const w = await weightsFor(client);
  if (!w.ok) return { ok: false };
  const W = w.weights;
  const { rows } = await client.query(INPUTS, [teamCode]);
  const out = rows.map((r) => {
    const matches = typeof r.matches === "string" ? JSON.parse(r.matches) : r.matches;
    // Three capped matches fill the term; more do not overflow it.
    const performance = clamp01(matches.reduce((s, m) => s + Math.min(W.windowCap, units(m)), 0) / (3 * W.windowCap || 1));
    const rating = r.rating == null ? 0 : clamp01(Number(r.rating) / 20);
    const evidence = r.rating == null ? 0
      : clamp01(Number(r.rated_metrics) / 8) * Math.exp(-Number(r.days_since_rated ?? 0) / 60);
    const growth = r.growth == null ? 0.5 : clamp01(0.5 + Number(r.growth) / 10);   // ±5 points on the rubric spans the term
    const sumW = W.performance + W.rating + W.evidence + W.growth;
    const core = sumW > 0
      ? (W.performance * performance + W.rating * rating + W.evidence * evidence + W.growth * growth) / sumW : 0;
    const gate = (1 - W.teamGate) + W.teamGate * (r.win_ratio == null ? 0.5 : Number(r.win_ratio));
    return { playerId: r.id, name: r.full_name, team: r.team_code, figure: Math.round(1000 * clamp01(core * gate)) / 10 };
  });
  out.sort((a, b) => b.figure - a.figure || a.name.localeCompare(b.name));
  out.forEach((r, i) => { r.rank = i + 1; });
  return { ok: true, rows: out };
}

/**
 * SCRBRD-130: the rain rule's reads (docs/design/SCRBRD-130_rain_and_par.md
 * §3.5, §6). Nothing here writes: the umpires' figures are the scorer's
 * events, and every figure below is derived on the read.
 *
 *   GET /api/grounds/:id/venue-par?overs=20&band=U15[&on=YYYY-MM-DD]
 *       → venue par at a ground (R3, db/74 venue_par()): the figure, its
 *         evidence and the words. For whoever may read the ground.
 *   GET /api/matches/:id/venue-par[?on=YYYY-MM-DD]
 *       → the par of the ground a match is played on, at its overs and band
 *         (db/74 venue_par_for_match()), and par at the point the current
 *         innings has reached (venue.mjs parAt(): the proportion of overs, or
 *         — R2 — the DLS table's resources). For whoever may read the result.
 *
 * Every refusal is { error: <reason> }: 403 not_permitted (which never says
 * whether the thing exists), 404 for an id that is not one.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { deriveMatch, fromRow, parAt, parAtWords, venueParWords } from "@scrbrd/scoring";
import { EVENT_COLUMNS } from "../write/events-api.mjs";
/** @import { RouteDeps, Handler, IdHandler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BANDS = new Set(["U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18", "U19", "open"]);
const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });

/** A venue_par() row as the screens read it. @param {any} r */
export function venueOut(r) {
  if (!r) return null;
  const v = {
    groundId: r.ground_id, pooledGroundId: r.pooled_ground_id, overs: r.overs, ageBand: r.age_band,
    n: r.n, floor: r.floor, sufficient: r.sufficient === true, par: r.par ?? null,
    median: r.median == null ? null : Number(r.median), low: r.low ?? null, high: r.high ?? null,
    firstSeason: r.first_season ?? null, lastSeason: r.last_season ?? null, fromBooks: r.from_books ?? 0,
    innings: (Array.isArray(r.innings) ? r.innings : []).map((/** @type {any} */ i) => ({
      matchId: i.match_id, date: i.date, home: i.home, away: i.away, runs: i.runs, groundId: i.ground_id, fromBook: i.from_book === true })),
    breakdown: (Array.isArray(r.breakdown) ? r.breakdown : []).map((/** @type {any} */ b) => ({ groundId: b.ground_id, name: b.name, n: b.n, mean: b.mean })),
  };
  return { ...v, words: venueParWords(v) };
}

/** @param {RouteDeps} deps @returns {Record<string, Handler | IdHandler>} */
export function rainRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      const status = e.status || 500;
      if (status >= 500) console.error("rain →", e.code || "", e.message);
      res.status(status).json({ error: e.message || "error" });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {any} req */
  const idOf = (req) => { const id = String(req.params?.id ?? ""); if (!UUID.test(id)) throw err("not_found", 404); return id; };
  /** @param {any} req */
  const onOf = (req) => { const on = req.query?.on; if (on == null || on === "") return null; if (!DAY.test(String(on))) throw err("on_invalid"); return String(on); };

  return {
    // GET /api/grounds/:id/venue-par?overs=&band=&on=
    groundVenuePar: handle(async (req) => {
      const id = idOf(req);
      const overs = Number(req.query?.overs ?? 20);
      if (!Number.isInteger(overs) || overs < 1 || overs > 100) throw err("overs_invalid");
      const band = String(req.query?.band ?? "open");
      if (!BANDS.has(band)) throw err("band_invalid");
      const on = onOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from venue_par($1, $2, $3, coalesce($4::date, sa_today()))`, [id, overs, band, on]);
        if (!rows.length) throw err("not_permitted", 403);
        return { venuePar: venueOut(rows[0]) };
      });
    }),

    // GET /api/matches/:id/venue-par?on=
    //   → { venuePar, parAt: {runs, wickets, method, label} | null, words }
    //   parAt is at the point the current innings has reached, folded from
    //   the log the reader may read (a visitor who reads only the result
    //   gets the ground's par and no point in an innings he cannot read).
    matchVenuePar: handle(async (req) => {
      const id = idOf(req);
      const on = onOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from venue_par_for_match($1, coalesce($2::date, sa_today()))`, [id, on]);
        if (!rows.length) return { venuePar: null, parAt: null, words: null };
        const venue = venueOut(rows[0]);
        const { rows: log } = await client.query(`select ${EVENT_COLUMNS} from ball_event_live where match_id = $1 order by seq`, [id]);
        const innings = log.length ? deriveMatch(log.map(fromRow)).innings : [];
        const inn = innings[innings.length - 1] ?? null;
        const at = inn && !inn.complete && venue?.sufficient
          ? parAt(venue.par, { allottedBalls: (inn.overs ?? 20) * 6, balls: inn.balls, wickets: inn.wickets })
          : null;
        return { venuePar: venue, parAt: at, words: parAtWords(venue, at) };
      });
    }),
  };
}

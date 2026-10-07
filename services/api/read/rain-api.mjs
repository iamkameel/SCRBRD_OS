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
 *   GET /api/matches/:id/par
 *       → SCRBRD-133 G2: par and pressure for the innings in play, the same
 *         report the public read serves (@scrbrd/scoring parReport()), for a
 *         reader of the match's result over the log he may read — the Match
 *         Centre's Summary and its big screen. The table stays here (D6).
 *
 *   GET /api/matches/:id/dls[?chaseOvers=&resumeOvers=&terminate=1]
 *       → the DLS Standard calculator's proposal (R2, dls.mjs dlsTarget()):
 *         the target (or, terminated, the par) beside the umpires' announced
 *         figure, with the difference, the case, the table's version and the
 *         words. Over the table the match's document names (db/75
 *         dls_table_for_match()), else the current one, said so. NEVER A CELL:
 *         the table is read here, on the server, and goes no further (D6).
 *   GET  /api/admin/dls-tables                 the tables and their provenance (no cell)
 *   POST /api/admin/dls-tables                 { csv, title, grain, maxBalls, sourcePublisher,
 *                                                sourceDocument, sourceEditionDate, permissionNote,
 *                                                version?, units? } → a draft and its structural report
 *   POST /api/admin/dls-tables/:id/publish     → published (refused for a SYNTHETIC title)
 *   POST /api/admin/dls-tables/:id/withdraw    { note } → withdrawn; its rows kept
 *       Under platform.reference.manage (db/75 dls_operator()).
 *
 * Every refusal is { error: <reason> }: 403 not_permitted (which never says
 * whether the thing exists), 404 for an id that is not one.
 */

// ── SCRBRD-130 R2: reading a CSV the operator posts ──
/**
 * The operator's CSV as cells: either long rows "b,w,R" or wide rows
 * "b,R0,…,R9" (balls remaining, then wickets 0–9), a header line allowed.
 * `units` "percent" (one decimal, as the source prints them: 100.0) or
 * "tenths" (1000); absent, read off the full innings (100 → percent, 1000 →
 * tenths). Never logged, never echoed.
 * @param {string} csv  @param {string | null | undefined} units
 * @returns {{cells: [number, number, number][], units: string} | {error: string}}
 */
export function cellsFromCsv(csv, units) {
  /** @type {[number, number, string][]} */
  const raw = [];
  for (const line of String(csv ?? "").split(/\r?\n/)) {
    const f = line.split(/[,;\t]/).map((x) => x.trim()).filter((x) => x !== "");
    if (!f.length || f.some((x) => !/^\d+(\.\d+)?$/.test(x))) continue;   // a header, a blank
    if (f.length === 3) raw.push([Number(f[0]), Number(f[1]), f[2]]);
    else if (f.length === 11) for (let w = 0; w < 10; w++) raw.push([Number(f[0]), w, f[w + 1]]);
    else return { error: "csv_shape" };
  }
  if (!raw.length) return { error: "csv_empty" };
  const top = Math.max(...raw.map((r) => Number(r[2])));
  const u = units === "percent" || units === "tenths" ? units : top <= 100 ? "percent" : "tenths";
  /** One decimal of a percent, exactly, as tenths. @param {string} s */
  const tenths = (s) => {
    if (u === "tenths") return Number(s);
    const [i, d = "0"] = s.split(".");
    return d.length > 1 ? NaN : Number(i) * 10 + Number(d);
  };
  const cells = raw.map(([b, w, s]) => /** @type {[number, number, number]} */ ([b, w, tenths(s)]));
  if (cells.some((c) => !Number.isInteger(c[2]))) return { error: "csv_precision" };
  return { cells, units: u };
}
// ── end SCRBRD-130 R2 ──
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { deriveMatch, fromRow, parAt, parAtWords, venueParWords, parReport, formatKind } from "@scrbrd/scoring";
import { dlsTable, dlsTarget, dlsWords, differenceWords, resourcesOf, structuralProblems, DLS_STATUS } from "@scrbrd/scoring";
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
      res.status(status).json({ error: e.message || "error", ...(e.detail !== undefined ? { detail: e.detail } : {}) });
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
        // SCRBRD-130 R2: with a table, the resources used; without, the proportion.
        const table = await tableFor(client, id);
        const at = inn && !inn.complete && venue?.sufficient
          ? parAt(venue.par, { allottedBalls: (inn.overs ?? 20) * 6, balls: inn.balls, wickets: inn.wickets },
                  { resources: table ? (b, w) => resourcesOf(table, b, w) : null })
          : null;
        return { venuePar: venue, parAt: at, words: parAtWords(venue, at) };
      });
    }),

    // ── SCRBRD-133 G2: par and pressure, signed in ──
    // GET /api/matches/:id/par → { matchId, at, venue, dls, track, trackOf, rrr }
    //   For whoever may read the match's result (venue_par_for_match() and
    //   dls_table_for_match() both ask match_result_readable()), folded from
    //   the log he may read under the match's frozen conditions — the fold the
    //   Match Centre runs, so the report's `at` is the position its board shows.
    matchPar: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: m } = await client.query(`select format, starts_at from match where id = $1`, [id]);
        if (!m.length) throw err("not_permitted", 403);
        const { rows: pc } = await client.query(`select doc, applies from match_playing_conditions($1)`, [id]);
        const play = pc[0]?.applies && pc[0].doc?.play && typeof pc[0].doc.play === "object" ? pc[0].doc.play : null;
        const ctx = { startsAt: m[0].starts_at ? new Date(m[0].starts_at).toISOString() : null, format: m[0].format,
                      ...(play ? { conditions: play } : {}) };
        const { rows: v } = await client.query(`select * from venue_par_for_match($1)`, [id]);
        const venue = v[0] ? venueOut(v[0]) : null;
        const table = await tableFor(client, id);
        const { rows: log } = await client.query(`select ${EVENT_COLUMNS} from ball_event_live where match_id = $1 order by seq`, [id]);
        const limited = play?.["format.kind"] != null ? play["format.kind"] === "limited" && play["format.innings_per_side"] !== 2
          : formatKind(m[0].format) !== "declaration";
        const g50 = Number.isInteger(play?.["target.g50"]) ? play["target.g50"] : null;
        return { matchId: id, ...parReport({ events: log.map(fromRow), ctx, venue, table, g50, limited }) };
      });
    }),
    // ── end SCRBRD-133 G2 ──

    // ── SCRBRD-130 R2: the DLS proposal, and the operator's routes ──
    // GET /api/matches/:id/dls?chaseOvers=&resumeOvers=&terminate=1
    matchDls: handle(async (req) => {
      const id = idOf(req);
      const whole = (/** @type {unknown} */ v, /** @type {string} */ code) => {
        if (v == null || v === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 100) throw err(code);
        return n;
      };
      const chaseOvers = whole(req.query?.chaseOvers, "chase_overs_invalid");
      const resumeOvers = whole(req.query?.resumeOvers, "resume_overs_invalid");
      const terminate = req.query?.terminate === "1" || req.query?.terminate === "true";
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows: pc } = await client.query(`select doc, applies from match_playing_conditions($1)`, [id]);
        if (!pc.length) throw err("not_permitted", 403);
        const play = pc[0].applies && pc[0].doc?.play && typeof pc[0].doc.play === "object" ? pc[0].doc.play : {};
        const meta = await tableMetaFor(client, id);
        const table = meta?.table ?? null;
        const { rows: log } = await client.query(`select ${EVENT_COLUMNS} from ball_event_live where match_id = $1 order by seq`, [id]);
        const innings = log.length ? deriveMatch(log.map(fromRow), { conditions: play }).innings : [];
        const g50 = Number.isInteger(play["target.g50"]) ? play["target.g50"] : null;
        const r = dlsTarget(innings, { table, g50, conditions: play, chaseOvers, resumeOvers, terminate });
        const chase = innings[1] ?? null;
        const calculated = r.status !== DLS_STATUS.OK ? null : r.kind === "par" ? r.par : r.target;
        const announced = r.kind === "par" ? chase?.par ?? null : chase?.target ?? null;
        return {
          status: r.status, kind: r.kind, calculated, case: r.case, line: r.line,
          method: play["target.method"] === "dls_standard" ? "dls_standard" : "umpires_revision",
          table: meta ? { id: meta.id, version: meta.version, title: meta.title, grain: meta.grain, status: meta.status, current: meta.current } : null,
          g50Set: g50 != null,
          words: dlsWords(r, { current: meta?.current === true, withdrawn: meta?.status === "withdrawn" }),
          announced, difference: calculated != null && announced != null ? announced - calculated : null,
          differenceWords: differenceWords(announced, calculated),
        };
      });
    }),

    // GET /api/admin/dls-tables → { tables: [...] } (provenance; never a cell)
    dlsTables: handle(async (req) => runAsPrincipal(pool, secret, as(req), async (client) => {
      const { rows: may } = await client.query(`select dls_operator() as ok`);
      if (!may[0]?.ok) throw err("not_permitted", 403);
      const { rows } = await client.query(`select * from dls_tables()`);
      return { tables: rows.map((t) => ({ id: t.id, version: t.version, title: t.title, grain: t.grain, maxBalls: t.max_balls,
        status: t.status, sourcePublisher: t.source_publisher, sourceDocument: t.source_document,
        sourceEditionDate: t.source_edition_date, permissionNote: t.permission_note, contentHash: t.content_hash,
        rowCount: t.row_count, supersedes: t.supersedes, loadedAt: t.loaded_at, publishedAt: t.published_at,
        withdrawnAt: t.withdrawn_at, withdrawnNote: t.withdrawn_note })) };
    })),

    // POST /api/admin/dls-tables → { ok, id, contentHash, rowCount, report } or a refusal
    //   with the structural report (§4.3): which checks failed. The cells go to
    //   db/75's loader and nowhere else; the answer carries none.
    dlsLoad: handle(async (req) => {
      const b = req.body ?? {};
      const parsed = cellsFromCsv(b.csv, b.units);
      if ("error" in parsed) throw err(parsed.error);
      const grain = b.grain === "over" ? "over" : b.grain === "ball" ? "ball" : null;
      if (!grain) throw err("grain_invalid");
      const maxBalls = Number(b.maxBalls ?? 300);
      const report = structuralProblems(dlsTable({ grain, maxBalls, rows: parsed.cells }));
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const meta = { title: b.title, version: b.version ?? undefined, grain, maxBalls, sourcePublisher: b.sourcePublisher,
                       sourceDocument: b.sourceDocument, sourceEditionDate: b.sourceEditionDate, permissionNote: b.permissionNote };
        const { rows } = await client.query(`select * from dls_table_load($1::jsonb, $2::jsonb)`, [JSON.stringify(meta), JSON.stringify(parsed.cells)]);
        const r = rows[0];
        if (!r?.ok) {
          const e = err(r?.reason ?? "refused", r?.reason === "not_permitted" ? 403 : 422);
          return Promise.reject(Object.assign(e, { detail: { problems: r?.problems ?? report, detail: r?.detail ?? null } }));
        }
        return { ok: true, id: r.table_id, contentHash: r.content_hash, rowCount: r.row_count, units: parsed.units, report };
      });
    }),

    // POST /api/admin/dls-tables/:id/publish
    dlsPublish: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from dls_table_publish($1)`, [id]);
        if (!rows[0]?.ok) throw err(rows[0]?.reason ?? "refused", rows[0]?.reason === "not_permitted" ? 403 : 422);
        return { ok: true };
      });
    }),

    // POST /api/admin/dls-tables/:id/withdraw { note }
    dlsWithdraw: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from dls_table_withdraw($1, $2)`, [id, req.body?.note ?? null]);
        if (!rows[0]?.ok) throw err(rows[0]?.reason ?? "refused", rows[0]?.reason === "not_permitted" ? 403 : 422);
        return { ok: true };
      });
    }),
    // ── end SCRBRD-130 R2 ──
  };
}

// ── SCRBRD-130 R2 ──
/**
 * The table a match's calculator reads (db/75 dls_table_for_match()): the
 * one its document names, else the current one; null when none is loaded or
 * the reader may not read the match. The cells stay in this process.
 * @param {any} client  @param {string} matchId
 */
async function tableMetaFor(client, matchId) {
  const { rows } = await client.query(`select * from dls_table_for_match($1)`, [matchId]);
  const t = rows[0];
  if (!t) return null;
  const table = dlsTable({ id: t.id, version: t.version, title: t.title, grain: t.grain, maxBalls: t.max_balls, rows: t.cells ?? [] });
  return { table, id: t.id, version: t.version, title: t.title, grain: t.grain, status: t.status, current: t.current === true };
}
/** The table alone. @param {any} client  @param {string} matchId */
async function tableFor(client, matchId) {
  return (await tableMetaFor(client, matchId))?.table ?? null;
}
// ── end SCRBRD-130 R2 ──

/**
 * SCRBRD — importing a paper scorebook (SCRBRD-120, phase 1: the record, by hand).
 *
 * The design is docs/design/SCRBRD-120_scorebook_importer.md; the schema and
 * every rule of who may do what are db/63_scorebook_import.sql. A scorer
 * photographs the book's pages, types the card beside them (one per innings),
 * ticks every cell, submits; a second person confirms (or returns it with a
 * note), and the card becomes three events per innings in the match's log.
 * The API contract for the screens is §9.2 of the design.
 *
 * This layer does four things the database cannot:
 *
 *   1. THE PHOTOS. It checks each upload is a JPEG or PNG of at most 8 MB,
 *      strips its metadata (io/page-image.mjs), stores it privately under a
 *      key naming the school and the import (io/object-store.mjs), and
 *      records the key through scorebook_import_page_add(). It proxies every
 *      read — no URL to a photo ever leaves this process — after
 *      scorebook_page_open() has decided who and written access_log. It
 *      deletes the photos the purge names.
 *   2. THE TICKS. Every cell of every card ticked by a person before a
 *      submit (uncheckedCells(), the same list the screen shows).
 *   3. THE ARITHMETIC, in words per cell (summaryRefusal()); the database
 *      asks the same questions again (summary_reconciles()).
 *   4. THE LAWS, at the commit, in the amendment route's shape
 *      (events-api.mjs amendmentRoutes, db/38): scorebook_import_commit()
 *      inside a savepoint decides who, takes the live path's lock, fixes the
 *      playing conditions and writes the events; the log is then folded and
 *      every written event asked lawsRefusal() in turn, and each summarised
 *      innings' seal asked whether it stood; any refusal rolls the savepoint
 *      back — no events, the import still submitted — and says why in words.
 *
 * Everything else — who may, the two-person rule, the module, the states —
 * is the definer functions', and a check here would be a second opinion that
 * could drift. Every refusal is { error: <reason>, detail? }: 403
 * not_permitted (never saying whether the import exists) and module_disabled,
 * 409 version_conflict and import_open, 413/415 for a photo, 503 when the
 * store is not there, 422 for the rest.
 */
import { createHash, randomUUID } from "node:crypto";
import { runAsPrincipal } from "../auth/auth-db.mjs";
import {
  fromRow, MatchFold, lawsRefusal, REFUSAL_TEXT, SEAL_REFUSAL, KIND,
  summaryRefusal, normaliseCard, normaliseTyped, uncheckedCells, cellPaths,
} from "@scrbrd/scoring";
import { EVENT_COLUMNS, matchFoldContext } from "./events-api.mjs";
import { sanitisePage } from "../io/page-image.mjs";
/** @import { RouteDeps, IdHandler, IdRequest, RawResponse } from "../api-types.mjs" */
/** @import { ObjectStore } from "../io/object-store.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @param {string} code @param {number} [status] @param {unknown} [detail] */
const err = (code, status = 422, detail = undefined) => Object.assign(new Error(code), { status, detail });

/** Words for a seal a card's figures did not stand behind (replay.mjs SEAL_REFUSAL). */
const SEAL_TEXT = Object.freeze({
  [SEAL_REFUSAL.NOT_THE_LAWS_REASON]: "the card's ending is not the one its figures give — all out, the overs or the target",
  [SEAL_REFUSAL.FIGURES_MOVED]: "the card's figures are not the innings' — penalty runs from another innings were credited to it",
  [SEAL_REFUSAL.UNCONFIRMED]: "the card has no figures to confirm",
  [SEAL_REFUSAL.NO_REASON]: "the card does not say how the innings ended",
});

/** The HTTP status a definer function's refusal is answered with. @param {string | null | undefined} reason */
const statusOf = (reason) => (reason === "not_permitted" || reason === "module_disabled" ? 403
  : reason === "version_conflict" || reason === "import_open" ? 409 : 422);

/**
 * A definer function's row, as the route's answer: itself when ok, else a
 * refusal with its reason and detail.
 * @param {any} r
 */
function answer(r) {
  if (!r) throw err("no_result", 500);
  if (r.ok) return r;
  throw err(r.reason ?? "refused", statusOf(r.reason), r.detail ?? undefined);
}

/** @param {unknown} id */
const uuid = (id) => { if (typeof id !== "string" || !UUID.test(id)) throw err("not_permitted", 403); return id; };

/**
 * Which side of its fixture is the importing school's (summary.mjs
 * SummaryContext.ours): the home side, or both sides of a fixture between
 * two of its own teams.
 * @param {{ school_id: string, away_school_id: string | null }} m
 * @returns {"home" | "both"}
 */
const oursOf = (m) => (m.away_school_id && m.away_school_id === m.school_id ? "both" : "home");

/**
 * The innings of a match as a screen needs them before the first cell is
 * typed (§2.6, §6.3): which have deliveries (scored live: a book cannot
 * replace them), which are already from a book, which are over.
 * @param {{ query: Function }} client @param {string} matchId
 */
async function inningsState(client, matchId) {
  const { rows } = await client.query(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [matchId]);
  const view = new MatchFold(rows.map(fromRow), await matchFoldContext(client, matchId)).view();
  return view.innings.map((inn, i) => inn && ({
    innings: i, battingTeam: inn.battingTeam ?? null,
    deliveries: inn.ballLog.length, summarised: inn.summarised != null, complete: inn.complete === true,
    runs: inn.runs, wickets: inn.wickets, balls: inn.balls,
  })).filter(Boolean);
}

/** An import row, as the screens read it. @param {any} i @param {any} checked */
const importOut = (i, checked) => ({
  id: i.id, matchId: i.match_id, schoolId: i.school_id, teamCode: i.team_code, state: i.state, version: i.version,
  cards: i.card, typed: i.typed, checked: checked ?? {},
  createdBy: i.created_by, createdAt: i.created_at, touchedAt: i.touched_at,
  submittedBy: i.submitted_by, submittedAt: i.submitted_at,
  returnedBy: i.returned_by, returnedAt: i.returned_at, returnedNote: i.returned_note,
  confirmedBy: i.confirmed_by, confirmedAt: i.confirmed_at, confirmNote: i.confirm_note,
  unreconciledAcknowledged: i.unreconciled_acknowledged,
  abandonedBy: i.abandoned_by, abandonedAt: i.abandoned_at,
  appliedKeys: i.applied_keys, pagesPurgedAt: i.pages_purged_at,
});

/**
 * @param {RouteDeps & { store: ObjectStore }} deps
 */
export function scorebookRoutes({ pool, secret, store }) {
  /** @param {(req: IdRequest) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      const status = e.status || 500;
      if (status >= 500) console.error("scorebook →", e.code || "", e.message, e.detail || "");
      res.status(status).json({ error: status >= 500 && !e.status ? "internal_error" : e.message, ...(e.detail !== undefined ? { detail: e.detail } : {}) });
    }
  };
  /** @param {string | undefined} bearer @param {(client: any) => Promise<any>} fn */
  const as = (bearer, fn) => runAsPrincipal(pool, secret, bearer, fn);

  /** The import, read under the caller's own policies, or a 403. @param {any} client @param {string} id */
  const readImport = async (client, id) => {
    const { rows } = await client.query(`select * from scorebook_import where id = $1`, [uuid(id)]);
    if (!rows[0]) throw err("not_permitted", 403);
    return rows[0];
  };
  /**
   * The module, for the fixture's own school (a read is gated as the
   * definer functions gate every write: feature_enabled(), per school).
   * @param {any} client @param {string | null | undefined} school
   */
  const moduleOn = async (client, school) => {
    const { rows } = await client.query(`select feature_enabled('scorebook_import', $1, app_user_id()) as on`, [school ?? null]);
    if (rows[0]?.on !== true) throw err("module_disabled", 403);
  };
  /** The latest revision's ticks. @param {any} client @param {string} id */
  const readChecked = async (client, id) => (await client.query(
    `select checked from scorebook_import_revision where import_id = $1 order by version desc limit 1`, [id])).rows[0]?.checked ?? {};
  /** The fixture's two schools, for the rule of sides. @param {any} client @param {string} matchId */
  const readMatch = async (client, matchId) => (await client.query(
    `select id, school_id, away_school_id from match where id = $1`, [matchId])).rows[0] ?? null;

  /** @param {string | undefined} bearer @param {string | null} importId */
  const purge = (bearer, importId) => purgeDue(as, store, bearer, importId);

  return {
    // POST /api/matches/:id/scorebook  {}  → { id }
    //   refusals: not_permitted, module_disabled, not_cricket, not_yet_played,
    //   match_abandoned, match_complete, import_open (detail: the open one)
    open: handle(async (req) => as(req.headers?.authorization, async (c) => {
      const r = answer((await c.query(`select * from scorebook_import_open($1)`, [uuid(req.params.id)])).rows[0]);
      return { id: r.import_id };
    })),

    // GET /api/matches/:id/scorebook  → { imports: [...], innings: [...] }
    list: handle(async (req) => as(req.headers?.authorization, async (c) => {
      const { rows: fx } = await c.query(`select school_id from match where id = $1`, [uuid(req.params.id)]);
      if (!fx[0]) throw err("not_permitted", 403);
      await moduleOn(c, fx[0].school_id);
      const { rows } = await c.query(
        `select i.id, i.state, i.version, i.created_by, i.created_at, i.submitted_at, i.confirmed_at, i.abandoned_at,
                (select count(*)::int from scorebook_import_page p where p.import_id = i.id and p.deleted_at is null) as pages
           from scorebook_import i where i.match_id = $1 order by i.created_at`, [uuid(req.params.id)]);
      return {
        imports: rows.map((/** @type {any} */ i) => ({ id: i.id, state: i.state, version: i.version, pages: i.pages, createdBy: i.created_by,
                                    createdAt: i.created_at, submittedAt: i.submitted_at, confirmedAt: i.confirmed_at,
                                    abandonedAt: i.abandoned_at })),
        innings: await inningsState(c, req.params.id),
      };
    })),

    // GET /api/scorebook/:id  → { import, pages, revisions, innings, refusals, unchecked }
    get: handle(async (req) => as(req.headers?.authorization, async (c) => {
      const i = await readImport(c, req.params.id);
      await moduleOn(c, i.school_id);
      const checked = await readChecked(c, i.id);
      const { rows: pages } = await c.query(
        `select page_no, mime, bytes, width, height, sha256, added_by, added_at, deleted_at
           from scorebook_import_page where import_id = $1 order by page_no`, [i.id]);
      const { rows: revisions } = await c.query(
        `select version, action, note, actor_id, at from scorebook_import_revision where import_id = $1 order by version`, [i.id]);
      const m = await readMatch(c, i.match_id);
      const ctx = { typed: i.typed, ours: m ? oursOf(m) : null };
      return {
        import: importOut(i, checked),
        pages: pages.map((/** @type {any} */ p) => ({ pageNo: p.page_no, mime: p.mime, bytes: p.bytes, width: p.width, height: p.height,
                                   sha256: p.sha256, addedBy: p.added_by, addedAt: p.added_at, deletedAt: p.deleted_at })),
        revisions: revisions.map((/** @type {any} */ r) => ({ version: r.version, action: r.action, note: r.note, actorId: r.actor_id, at: r.at })),
        innings: await inningsState(c, i.match_id),
        refusals: (Array.isArray(i.card) ? i.card : []).map((/** @type {unknown} */ card) => summaryRefusal(card, ctx)),
        unchecked: uncheckedCells(i.card, checked),
        cells: cellPaths(i.card).length,
      };
    })),

    // POST /api/scorebook/:id/save  { cards, typed, checked, version }  → { version, refusals }
    //   Each card is kept to a card's fields (normaliseCard); the typed
    //   names to t:<n> → a name (normaliseTyped); the ticks to path → true.
    //   refusals: not_permitted, module_disabled, not_editable, version_conflict,
    //   card_shape, typed_invalid
    save: handle(async (req) => {
      const b = req.body ?? {};
      if (!Array.isArray(b.cards) || b.cards.length > 4) throw err("card_shape", 422, "a list of at most four cards");
      const cards = b.cards.map(normaliseCard);
      const typed = normaliseTyped(b.typed);
      /** @type {Record<string, true>} */
      const checked = {};
      for (const [k, v] of Object.entries(b.checked ?? {})) if (v === true && typeof k === "string" && k.length <= 64) checked[k] = true;
      if (!Number.isInteger(b.version)) throw err("version_required");
      return as(req.headers?.authorization, async (c) => {
        const r = answer((await c.query(`select * from scorebook_import_save($1, $2, $3, $4, $5)`,
          [uuid(req.params.id), JSON.stringify(cards), JSON.stringify(typed), JSON.stringify(checked), b.version])).rows[0]);
        const i = await readImport(c, req.params.id);
        const m = await readMatch(c, i.match_id);
        const ctx = { typed, ours: m ? oursOf(m) : null };
        return { version: r.version, refusals: cards.map((/** @type {unknown} */ card) => summaryRefusal(card, ctx)), unchecked: uncheckedCells(cards, checked) };
      });
    }),

    // POST /api/scorebook/:id/submit  { version }  → { version }
    //   refusals: cells_unchecked (detail: the paths), card_refused (detail:
    //   per card, the refusals by cell), and the function's: not_permitted,
    //   module_disabled, not_submittable, version_conflict, no_card,
    //   innings_twice, not_our_player
    submit: handle(async (req) => as(req.headers?.authorization, async (c) => {
      const i = await readImport(c, req.params.id);
      const version = req.body?.version;
      if (!Number.isInteger(version)) throw err("version_required");
      const checked = await readChecked(c, i.id);
      const unchecked = uncheckedCells(i.card, checked);
      if (unchecked.length) throw err("cells_unchecked", 422, unchecked);
      const m = await readMatch(c, i.match_id);
      const refusals = (Array.isArray(i.card) ? i.card : []).map((/** @type {unknown} */ card) => summaryRefusal(card, { typed: i.typed, ours: m ? oursOf(m) : null }));
      if (refusals.some((/** @type {unknown[]} */ r) => r.length)) throw err("card_refused", 422, refusals);
      const r = answer((await c.query(`select * from scorebook_import_submit($1, $2)`, [i.id, version])).rows[0]);
      return { version: r.version };
    })),

    // POST /api/scorebook/:id/return  { note }  → { ok: true }
    //   refusals: not_permitted, cannot_confirm_your_own, not_submitted, note_required
    return: handle(async (req) => as(req.headers?.authorization, async (c) => {
      answer((await c.query(`select * from scorebook_import_return($1, $2)`, [uuid(req.params.id), req.body?.note ?? null])).rows[0]);
      return { ok: true };
    })),

    // POST /api/scorebook/:id/confirm  { acknowledgeUnreconciled?, note? }  → { ok: true, keys }
    //   refusals: laws_refused {law, text, key}, seal_refused {seal, text, innings},
    //   card_refused, and the function's: not_permitted, cannot_confirm_your_own,
    //   module_disabled, not_submitted, match_complete, unreconciled_not_acknowledged,
    //   no_card, innings_twice, not_our_player, not_in_this_phase
    confirm: handle(async (req) => as(req.headers?.authorization, async (c) => {
      const id = uuid(req.params.id);
      if (Array.isArray(req.body?.resolveEntries) && req.body.resolveEntries.length) {
        throw err("not_in_this_phase", 422, "retiring a coach's workload estimate at the commit is SCRBRD-120 phase 3");
      }
      await c.query("savepoint scorebook_commit");
      const out = (await c.query(`select * from scorebook_import_commit($1, $2, $3, $4)`,
        [id, [], req.body?.acknowledgeUnreconciled === true, req.body?.note ?? null])).rows[0];
      // Refused: whatever the function did before it refused (a lock, the
      // playing conditions fixed) goes with the savepoint.
      if (!out?.ok) { await c.query("rollback to savepoint scorebook_commit"); return answer(out); }

      // Written, under the per-match lock. Now the Laws, over the log the
      // events landed on, each asked in turn against the fold before it.
      const refuse = async (/** @type {Error} */ e) => { await c.query("rollback to savepoint scorebook_commit"); throw e; };
      const { rows: imp } = await c.query(`select match_id, card, typed from scorebook_import where id = $1`, [id]);
      const matchId = imp[0]?.match_id;
      /** @type {{ rows: any[] }} */
      const { rows: log } = matchId
        ? await c.query(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [matchId])
        : { rows: [] };
      const keys = /** @type {string[]} */ (out.keys ?? []);
      const written = log.filter((r) => keys.includes(r.idempotency_key));
      // The confirmer cannot read the log they would be writing to: nothing
      // can be judged, so nothing is written.
      if (!matchId || written.length !== keys.length) return refuse(err("not_permitted", 403));
      const firstSeq = Math.min(...written.map((r) => r.seq));
      const fold = new MatchFold(log.filter((r) => r.seq < firstSeq).map(fromRow), await matchFoldContext(c, matchId));
      for (const row of written) {
        const ev = fromRow(row);
        const why = lawsRefusal(fold.view(), ev);
        if (why) return refuse(err("laws_refused", 422, { law: why, text: REFUSAL_TEXT[why] ?? why, key: row.idempotency_key, innings: row.innings }));
        fold.push(ev);
      }
      // Each innings a card became: sealed on its own figures, or refused
      // at the seal (a card whose ending disagrees with its figures, §2.3).
      const after = fold.view().innings;
      for (const row of written.filter((r) => r.kind === KIND.INNINGS_SUMMARY)) {
        const inn = after[row.innings];
        if (!inn?.sealed) {
          const seal = inn?.sealRefused ?? SEAL_REFUSAL.UNCONFIRMED;
          return refuse(err("seal_refused", 422, { seal, text: SEAL_TEXT[/** @type {keyof typeof SEAL_TEXT} */ (seal)] ?? seal, innings: row.innings }));
        }
      }
      // The arithmetic once more, in the screen's own words.
      const m = await readMatch(c, matchId);
      const refusals = (imp[0].card ?? []).map((/** @type {unknown} */ card) => summaryRefusal(card, { typed: imp[0].typed, ours: m ? oursOf(m) : null }));
      if (refusals.some((/** @type {unknown[]} */ r) => r.length)) return refuse(err("card_refused", 422, refusals));
      await c.query("release savepoint scorebook_commit");
      return { ok: true, keys };
    })),

    // POST /api/scorebook/:id/abandon  → { ok: true, purged: {due, deleted, failed} }
    //   refusals: not_permitted, not_abandonable
    abandon: handle(async (req) => {
      const bearer = req.headers?.authorization;
      await as(bearer, async (c) => answer((await c.query(`select * from scorebook_import_abandon($1)`, [uuid(req.params.id)])).rows[0]));
      return { ok: true, purged: await purge(bearer, req.params.id) };
    }),
  };
}

/**
 * Delete the photos the database says are due (scorebook_import_purge_due():
 * one import's, or with none named the platform's daily run), and tell it
 * each one went. A photo the store would not delete stays due, and is tried
 * again on the next run.
 * @param {(bearer: string | undefined, fn: (client: any) => Promise<any>) => Promise<any>} as
 * @param {ObjectStore} store @param {string | undefined} bearer @param {string | null} importId
 */
async function purgeDue(as, store, bearer, importId) {
  /** @type {{page_id: string, object_key: string}[]} */
  const due = await as(bearer, async (c) =>
    (await c.query(`select page_id, object_key from scorebook_import_purge_due($1)`, [importId])).rows);
  let deleted = 0, failed = 0;
  for (const p of due) {
    try {
      await store.del(p.object_key);
      const ok = await as(bearer, async (c) => (await c.query(`select scorebook_page_purged($1) as ok`, [p.page_id])).rows[0]?.ok);
      if (ok) deleted += 1; else failed += 1;
    } catch (/** @type {any} */ e) {
      failed += 1;
      console.error("scorebook purge →", e.message, e.detail || "");
    }
  }
  return { due: due.length, deleted, failed };
}

/**
 * The routes that carry a photo's bytes, and the purge: dispatched by
 * server.mjs itself, because a photo is not JSON and is larger than every
 * JSON body (PAGE_MAX_BYTES, io/page-image.mjs).
 * @param {RouteDeps & { store: ObjectStore }} deps
 */
export function scorebookFileRoutes({ pool, secret, store }) {
  /** @param {string | undefined} bearer @param {(client: any) => Promise<any>} fn */
  const as = (bearer, fn) => runAsPrincipal(pool, secret, bearer, fn);
  /** @param {RawResponse} res @param {any} e */
  const fail = (res, e) => {
    if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
    const status = e.status || 500;
    if (status >= 500) console.error("scorebook page →", e.code || "", e.message, e.detail || "");
    return res.status(status).json({ error: status >= 500 && !e.status ? "internal_error" : e.message,
                                      ...(e.detail !== undefined && status < 500 ? { detail: e.detail } : {}) });
  };

  return {
    /**
     * POST /api/scorebook/:id/pages  (body: the photo's bytes; image/jpeg or image/png)
     *   → { pageNo, bytes, width, height, sha256, removed }
     * refusals: 413 page_too_large, 415 not_an_image / image_unreadable /
     * image_size, 503 store_unconfigured, and the function's: not_permitted,
     * module_disabled, not_editable, too_many_pages, duplicate_page
     * @param {{ id: string, bytes: Buffer, authorization: string | undefined }} req @param {RawResponse} res
     */
    async upload({ id, bytes, authorization }, res) {
      let storedKey = null;
      try {
        const img = sanitisePage(bytes);
        if (!img.ok) throw err(img.reason, img.reason === "page_too_large" ? 413 : 415);
        if (store.kind === "unconfigured") throw err("store_unconfigured", 503);
        const sha256 = createHash("sha256").update(img.bytes).digest("hex");
        const out = await as(authorization, async (c) => {
          const { rows } = await c.query(`select school_id from scorebook_import where id = $1`, [uuid(id)]);
          if (!rows[0]) throw err("not_permitted", 403);
          const key = `${rows[0].school_id}/${id}/${randomUUID()}.${img.ext}`;
          const r = answer((await c.query(`select * from scorebook_import_page_add($1, $2, $3, $4, $5, $6, $7)`,
            [id, key, sha256, img.bytes.length, img.width, img.height, img.mime])).rows[0]);
          // Stored inside the transaction: a refusal above stores nothing,
          // and a store that fails rolls the row back.
          await store.put(key, img.bytes, img.mime);
          storedKey = key;
          return { pageNo: r.page_no, bytes: img.bytes.length, width: img.width, height: img.height, sha256, removed: img.removed };
        });
        return res.json(out);
      } catch (/** @type {any} */ e) {
        // The row did not commit: the photo it named must not outlive it.
        if (storedKey) await store.del(storedKey).catch(() => {});
        return fail(res, e);
      }
    },

    /**
     * GET /api/scorebook/:id/pages/:n  → the photo's bytes, never cached.
     * The access_log row is committed before the photo is fetched.
     * refusals: not_permitted, module_disabled, no_such_page, page_deleted,
     * 404 page_missing (the store has no such object), 503 store_*
     * @param {{ id: string, pageNo: number, authorization: string | undefined }} req @param {RawResponse} res
     */
    async read({ id, pageNo, authorization }, res) {
      try {
        const p = await as(authorization, async (c) =>
          answer((await c.query(`select * from scorebook_page_open($1, $2)`, [uuid(id), pageNo])).rows[0]));
        const bytes = await store.get(p.object_key);
        if (!bytes) throw err("page_missing", 404);
        if (createHash("sha256").update(bytes).digest("hex") !== p.sha256) throw err("page_altered", 500);
        res.writeHead(200, {
          "content-type": p.mime,
          "content-length": bytes.length,
          "cache-control": "no-store, private",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
          "content-disposition": `inline; filename="page-${pageNo}.${p.mime === "image/png" ? "png" : "jpg"}"`,
        });
        return res.end(bytes);
      } catch (/** @type {any} */ e) {
        return fail(res, e);
      }
    },

    /**
     * POST /api/scorebook/purge  → { due, deleted, failed }
     * The daily run (§5.3): by the platform's key (platform.feature.manage,
     * platform-wide); for anybody else the database names nothing due.
     * @param {{ authorization: string | undefined }} req @param {RawResponse} res
     */
    async purge({ authorization }, res) {
      try { return res.json(await purgeDue(as, store, authorization, null)); }
      catch (/** @type {any} */ e) { return fail(res, e); }
    },
  };
}

/**
 * SCRBRD — the family list (SCRBRD-140 honesty model, Migration C, db/174).
 *
 * The office lists, in advance, a child (by his roster id), an address and
 * a kind: a parent or guardian, or the pupil's own address. A parent who
 * signs in with Google, asks to be linked to her child and types his date
 * of birth is linked at once when the address Google verified and the date
 * agree with a row, the uploader can still make the link, and the school
 * has switched it on (Q1). Every decision is a db/174 function's, run under
 * the caller's identity; this module turns their codes into the sentences
 * the screens show.
 *
 *   POST /api/family-list/:schoolId { rows, commit?, acknowledged? }
 *        Check (the default) or upload (commit: true), all or nothing. Each
 *        row { playerId, email, kind, relationship?, validUntil? }, the child
 *        picked from the roster by id, never a typed name. 200 { ok,
 *        committed, uploadId, rows: [{ line, ok, problem, detail, words,
 *        warning, warningWords, endedOn, ack, rowId }] }.
 *   GET  /api/family-list/:schoolId?state=open|claimed|expired|withdrawn
 *        The list, for the office and the principal (guardian.link.manage),
 *        with whether a match links at once here (linksAtOnce).
 *   POST /api/family-list/rows/:id/withdraw         an open row taken back
 *   GET  /api/family-list/:schoolId/redact          the rows due to be cleared
 *   POST /api/family-list/:schoolId/redact          "Clear N expired rows"
 *
 * The claim itself has no route of its own: POST /api/requests tries the
 * list right after it files a guardian request (or a pupil's own `player`
 * request) that carries `born` (familyClaim(), below), and POST
 * /api/pupil/claim passes his `born` to pupil_claim_send(). The date is
 * compared in the database and dropped: never stored, never logged, never
 * put in a note.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiResponse, Handler } from "../api-types.mjs" */

const err = (/** @type {string} */ code, status = 400, /** @type {string | undefined} */ detail = undefined) =>
  Object.assign(new Error(code), { status, detail });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATES = new Set(["open", "claimed", "expired", "withdrawn"]);
const KINDS = new Set(["guardian", "pupil"]);
const RELATIONSHIPS = new Set(["parent", "mother", "father", "guardian", "grandparent", "other"]);

const dayWords = (/** @type {string | null | undefined} */ d) => {
  if (!d) return "";
  const t = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/**
 * A date of birth as typed, or null: YYYY-MM-DD and a real day, nothing
 * else. Never returned, never logged.
 * @param {unknown} v
 */
export function bornOf(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!ISO_DAY.test(s)) return null;
  const t = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
}

/** A row's problem, in words. `detail` is the database's particular. @type {Record<string, (detail: string | null) => string>} */
export const FAMILY_PROBLEM_WORDS = {
  player_unknown:           () => "choose the child from your school's list.",
  email_invalid:            () => "that does not look like an email address.",
  kind_invalid:             () => "say whether this is a parent's or guardian's address, or the pupil's own.",
  relationship_invalid:     () => "a parent's or guardian's row says how they are related; a pupil's own row says nothing.",
  not_grantable_here:       () => "you cannot link a parent, or open a pupil's account, at this school.",
  born_required:            () => "the child has no date of birth on your list. Add it on his profile first: the match compares it.",
  player_is_an_adult:       () => "the child is 18 or older. A parent is not linked to an adult.",
  player_has_an_account:    () => "this pupil already has an account. Nothing merges: match any new claim by hand.",
  already_linked:           () => "that address is already linked to this child.",
  link_revoked:             () => "that address's link to this child was ended, so it cannot be listed again.",
  valid_until_invalid:      () => "the claim-by date must be a date like 2026-12-31.",
  valid_until_past:         () => "the claim-by date has already passed.",
  valid_until_too_far:      () => "the claim-by date is more than eighteen months away.",
  valid_until_required:     () => "give a claim-by date: there is no current season to default to.",
  duplicate_in_file:        (d) => `the same child, address and kind is on row ${d}.`,
  already_listed:           (d) => `already listed, open until ${dayWords(d)}.`,
  warning_not_acknowledged: () => "tick the warning to list this row anyway.",
};

/** The call's own refusals (line 0). @type {Record<string, [number, string]>} */
const CALL_REFUSALS = {
  not_permitted: [403, "Only the school office and the principal can use its family list."],
  no_rows:       [422, "There are no rows to check."],
  too_many_rows: [422, "At most 200 rows at a time."],
};

/** family_register_withdraw()'s refusals. @type {Record<string, [number, string]>} */
const REFUSALS = {
  not_signed_in:     [401, "Sign in again."],
  not_permitted:     [403, "You cannot do that here."],
  already_claimed:   [409, "This row has been claimed. End the link instead."],
  already_withdrawn: [409, "This row has already been withdrawn."],
};

/**
 * After a request is filed (POST /api/requests), try the family list with
 * the date she typed, in the same transaction. 'linked' · 'in' · 'sent'.
 * Nothing is tried without a date, and nothing for any other role.
 * @param {any} client  @param {string} requestId  @param {string} role  @param {string | null} born
 */
export async function familyClaim(client, requestId, role, born) {
  if (!born || (role !== "guardian" && role !== "player")) return "sent";
  const { rows } = await client.query(`select outcome from family_register_claim($1, $2::date)`, [requestId, born]);
  const o = rows[0]?.outcome;
  return o === "linked" || o === "in" ? o : "sent";
}

/** @param {ApiResponse} res @param {any} e */
const fail = (res, e) => {
  if (e.code === "22P02" || e.code === "22007" || e.code === "22008") return res.status(400).json({ error: "bad_request" });
  // Two uploads of the same row at once: the second meets the open-row index.
  if (e.code === "23505") return res.status(409).json({ error: "already_listed", detail: "Somebody listed the same row a moment ago. Check again." });
  // Only this module's own errors (err(), which sets `status`) carry words
  // for the screen. A Postgres error's own `detail` and message can hold the
  // row it failed on, addresses included: it is answered as a bare code.
  const own = typeof e.status === "number" && !e.severity;
  const status = e.code === "42501" ? 403 : (own ? e.status : 500);
  res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (own ? e.message : "error"),
                            ...(own && e.detail ? { detail: e.detail } : {}) });
};

export { fail as familyRegisterFail };

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function familyRegisterRoutes({ pool, secret }) {
  /** @param {(client: any, req: any) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await runAsPrincipal(pool, secret, req.headers?.authorization, (client) => fn(client, req)));
    } catch (/** @type {any} */ e) { fail(res, e); }
  };
  const school = (/** @type {any} */ req) => {
    const id = String(req.params?.id ?? "");
    if (!UUID.test(id)) throw err("school_required", 400);
    return id;
  };

  return {
    // POST /api/family-list/:schoolId
    upload: handle(async (client, req) => {
      const s = school(req);
      const b = req.body || {};
      if (!Array.isArray(b.rows)) throw err("rows_required", 400, "Send the rows as `rows`.");
      const rows = b.rows.slice(0, 201).map((/** @type {any} */ r, /** @type {number} */ i) => {
        const kind = String(r?.kind ?? "").trim().toLowerCase();
        const rel = String(r?.relationship ?? "").trim().toLowerCase();
        return {
          line: Number.isInteger(r?.line) ? r.line : i + 1,
          player_id: UUID.test(String(r?.playerId ?? "")) ? String(r.playerId) : "",
          email: String(r?.email ?? "").slice(0, 400),
          kind: KINDS.has(kind) ? kind : kind.slice(0, 20),
          ...(rel ? { relationship: RELATIONSHIPS.has(rel) ? rel : rel.slice(0, 20) } : {}),
          ...(r?.validUntil ? { valid_until: String(r.validUntil).slice(0, 20) } : {}),
        };
      });
      const ack = Array.isArray(b.acknowledged) ? b.acknowledged.filter((/** @type {unknown} */ a) => UUID.test(String(a))) : [];
      const commit = b.commit === true;
      const { rows: out } = await client.query(
        `select line, ok, problem, detail, warning, ended_on::text as ended_on, ack, row_id, upload_id
           from family_register_upload($1, $2::jsonb, $3, $4::uuid[])`, [s, JSON.stringify(rows), commit, ack]);
      if (out.length === 1 && out[0].line === 0) {
        const code = out[0].problem || "not_permitted";
        const [status, words] = CALL_REFUSALS[code] ?? CALL_REFUSALS.not_permitted;
        throw err(code, status, words);
      }
      const shaped = out.map((/** @type {any} */ r) => ({
        line: r.line, ok: r.ok, problem: r.problem, detail: r.detail,
        words: r.problem ? `Row ${r.line}: ${(FAMILY_PROBLEM_WORDS[r.problem] ?? (() => r.problem))(r.detail)}` : null,
        warning: r.warning,
        warningWords: r.warning === "link_ended" ? `A guardian link to this child ended on ${dayWords(r.ended_on)}. List this row anyway?` : null,
        endedOn: r.ended_on, ack: r.ack, rowId: r.row_id,
      }));
      const uploadId = out.find((/** @type {any} */ r) => r.upload_id)?.upload_id ?? null;
      return { ok: shaped.every((/** @type {any} */ r) => r.ok), committed: !!uploadId, uploadId, rows: shaped };
    }),

    // GET /api/family-list/:schoolId?state=
    list: handle(async (client, req) => {
      const s = school(req);
      const state = req.query?.state ? String(req.query.state) : null;
      if (state && !STATES.has(state)) throw err("state_invalid", 400);
      const { rows: [st] } = await client.query(`select links_at_once from family_register_status($1)`, [s]);
      if (!st) throw err("not_permitted", 403, CALL_REFUSALS.not_permitted[1]);
      const { rows } = await client.query(
        `select r.id, r.player_id, r.player_name, r.team_code, r.email, r.kind, r.relationship,
                r.valid_until::text as valid_until, r.state, r.uploaded_by_name, r.uploaded_at, r.upload_id,
                r.warned_ended_on::text as warned_ended_on, r.claimed_at, r.claimed_by_name, r.outcome, r.outcome_reason,
                r.live_assignment, r.withdrawn_at, r.withdrawn_by_name, r.redacted_at
           from family_register_rows($1, $2) r`, [s, state]);
      return { linksAtOnce: st.links_at_once === true, rows };
    }),

    // POST /api/family-list/rows/:id/withdraw
    withdraw: handle(async (client, req) => {
      const id = String(req.params?.id ?? "");
      if (!UUID.test(id)) throw err("not_permitted", 403, REFUSALS.not_permitted[1]);
      const r = (await client.query(`select * from family_register_withdraw($1)`, [id])).rows[0] ?? { ok: false, reason: "not_permitted" };
      if (!r.ok) {
        const [status, words] = REFUSALS[r.reason] ?? REFUSALS.not_permitted;
        throw err(r.reason || "not_permitted", status, words);
      }
      return { id, withdrawn: true };
    }),

    // GET /api/family-list/:schoolId/redact
    redactDue: handle(async (client, req) => {
      const { rows } = await client.query(
        `select d.id, d.kind, d.valid_until::text as valid_until, d.withdrawn_at, d.due_on::text as due_on
           from family_register_redact_due($1) d`, [school(req)]);
      return { rows, count: rows.length };
    }),

    // POST /api/family-list/:schoolId/redact
    redact: handle(async (client, req) => {
      const { rows } = await client.query(`select family_register_redact($1) as n`, [school(req)]);
      return { cleared: rows[0]?.n ?? 0 };
    }),
  };
}

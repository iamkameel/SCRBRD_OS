/**
 * SCRBRD — the school staff register (SCRBRD-140 phase 2, db/92), and the
 * request cooldown's lift (db/93).
 *
 * The office lists its staff in advance; a staff member who signs in with
 * Google and chooses the school is granted what the office listed for the
 * address Google verified. docs/design/SCRBRD-140_phase2_register.md is the
 * design; every decision here is a db/92 or db/93 function's, run under the
 * caller's identity. This module turns their codes into the sentences the
 * screens show.
 *
 *   POST /api/register/:schoolId { csv | rows, commit?, acknowledged? }
 *        Check (the default) or import (commit: true), all or nothing.
 *        `csv` is the staff.csv columns (name, email, role, team_code,
 *        valid_until); `rows` is the same as objects, for the one-row form.
 *        The file is parsed here and never stored: only rows reach the
 *        database. 200 { ok, committed, uploadId, rows: [...] }, each row
 *        { line, ok, problem, detail, words, warning, warningWords, endedOn,
 *        ack, rowId }. A warned row commits only with its `ack` in
 *        `acknowledged`.
 *   GET  /api/register/:schoolId?state=open|claimed|expired|withdrawn
 *        The register, for the office (and an auditor who is not the DSO).
 *   POST /api/register/rows/:id/withdraw          an open row taken back
 *   GET  /api/register/:schoolId/redact           the rows due to be cleared
 *   POST /api/register/:schoolId/redact           "Clear N expired rows"
 *   POST /api/join/register-claim { schoolId }    the signing-in staff member
 *        200 { granted: [...], requested: [...], words }. Nothing granted and
 *        no row at all read the same sentence, so a refused claimant learns
 *        nothing from it (design §2.2). Under a cooldown: 409 request_cooldown.
 *   POST /api/cooldowns/:id/lift { note? }         a DSO at one of its schools
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { parseCsv } from "../io/csv.mjs";
/** @import { RouteDeps, ApiResponse, Handler } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400, /** @type {string | undefined} */ detail = undefined) =>
  Object.assign(new Error(code), { status, detail });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns of docs/pilot/templates/staff.csv, in its order. */
export const REGISTER_COLUMNS = Object.freeze(["name", "email", "role", "team_code", "valid_until"]);
const REQUIRED = ["name", "email", "role"];
const STATES = new Set(["open", "claimed", "expired", "withdrawn"]);

/** The sentence a person reads under a cooldown (design §4.2). Their own state; nobody else's. */
export const COOLDOWN_WORDS = "You can't send a request right now. Ask the school office.";

// The same words the screens use for a role (apps/web/src/design/roles.js,
// db/77's role_words()); a role not here is shown as stored.
/** @type {Record<string, string>} */
const ROLE_WORDS = {
  principal: "Principal", directorofsport: "Director of Sport", schooladmin: "School Admin",
  sportsadmin: "Sports Admin", coach: "Coach", assistantcoach: "Assistant Coach", teammanager: "Team Manager",
  player: "Player", guardian: "Parent / Guardian", spectator: "Spectator", scorer: "Scorer",
  official: "Match Official", analyst: "Performance Analyst", scout: "Scout", medical: "Medical Staff",
  fitness: "Strength & Conditioning", transportcoordinator: "Transport Coordinator", driver: "Driver",
  facilities: "Groundskeeper", finance: "Finance Admin", sponsorship: "Sponsorship", media: "Media",
  competitionadmin: "Competition Admin", unionselector: "Union Selector", dso: "Safeguarding Officer", superadmin: "Super Admin",
  platformadmin: "Platform Admin", selfaccess: "My Record", enquiry: "Enquiry Access",
};
const roleWords = (/** @type {string} */ role, /** @type {string | null | undefined} */ team) =>
  (ROLE_WORDS[role] ?? role) + (team ? ` (${team})` : "");
const typedRole = (/** @type {any} */ r) => String(r?.role ?? "").trim();
const dayWords = (/** @type {string | null | undefined} */ d) => {
  if (!d) return "";
  const t = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
};

/**
 * A row's problem, in words (design §5). `input` is what the person typed on
 * that line; `detail` is the database's particular (a role, a line, a date).
 * @type {Record<string, (input: any, detail: string | null) => string>}
 */
export const PROBLEM_WORDS = {
  name_invalid:         () => "a name needs two to 120 characters.",
  email_invalid:        () => "that does not look like an email address.",
  guardian_row:         () => "a parent is linked by the office from a request, never from a list.",
  child_role:           (r) => `'${typedRole(r)}' is a pupil's role. Adults who work at the school only.`,
  dso_row:              () => "the safeguarding officer is appointed by the principal, not from the register.",
  role_unknown:         (r) => `'${typedRole(r)}' is not a SCRBRD role.`,
  not_grantable_here:   (r) => `'${ROLE_WORDS[typedRole(r).toLowerCase()] ?? typedRole(r)}' is not a role you can list here.`,
  sensitive_role:       (r) => `${ROLE_WORDS[typedRole(r).toLowerCase()] ?? typedRole(r)} is added from People, not from the register.`,
  team_required:        (r) => `a ${(ROLE_WORDS[typedRole(r).toLowerCase()] ?? typedRole(r)).toLowerCase()} needs a side.`,
  team_invalid:         (_r, d) => `${d ?? "that"} is not a school side (U14A, 1XI…).`,
  team_unknown:         (_r, d) => `${d ?? "that side"} is not a side at this school.`,
  valid_until_invalid:  () => "the claim-by date must be a date like 2026-12-31.",
  valid_until_past:     () => "the claim-by date has already passed.",
  valid_until_too_far:  () => "the claim-by date is more than eighteen months away.",
  valid_until_required: () => "give a claim-by date: there is no current season to default to.",
  duplicate_in_file:    (_r, d) => `the same person, role and side is on line ${d}.`,
  already_listed:       (_r, d) => `already listed, open until ${dayWords(d)}.`,
  too_many_for_email:   () => "at most five open rows per email address.",
  already_holds_role:   (_r, d) => `already ${d ?? "on the staff"} here — add a role from People.`,
  warning_not_acknowledged: () => "tick the warning to list this person anyway.",
};

/** The call's own refusals (line 0). @type {Record<string, [number, string]>} */
const CALL_REFUSALS = {
  not_permitted: [403, "Only somebody who may appoint staff at this school can use its register."],
  no_rows:       [422, "There are no rows to check."],
  too_many_rows: [422, "At most 200 rows at a time."],
};

/** register_withdraw()'s and request_cooldown_lift()'s refusals. @type {Record<string, [number, string]>} */
const REFUSALS = {
  not_signed_in:     [401, "Sign in again."],
  not_permitted:     [403, "You cannot do that here."],
  already_claimed:   [409, "This row has been claimed. End the role on People instead."],
  already_withdrawn: [409, "This row has already been withdrawn."],
  already_lifted:    [409, "This pause has already been lifted."],
  already_ended:     [409, "This pause has already ended."],
};

/**
 * staff.csv's text into the rows register_upload() takes, each with the line
 * the person sees in their spreadsheet. Unknown columns are ignored; a
 * missing required one is the whole file's problem.
 * @param {string} text
 */
export function registerRowsFromCsv(text) {
  const { header, rows } = parseCsv(text);
  const cols = header.map((h) => String(h).trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length) throw err("csv_columns", 422, `The file has no ${missing.join(", ")} column. The columns are ${REGISTER_COLUMNS.join(", ")}.`);
  return rows
    .map((cells, n) => ({ cells, line: n + 2 }))
    .filter(({ cells }) => cells.some((c) => String(c).trim() !== ""))
    .map(({ cells, line }) => {
      /** @type {Record<string, string | number>} */
      const o = { line };
      for (const c of REGISTER_COLUMNS) {
        const i = cols.indexOf(c);
        if (i >= 0 && cells[i] != null && String(cells[i]).trim() !== "") o[c] = String(cells[i]);
      }
      return o;
    });
}

/** @param {ApiResponse} res @param {any} e */
const fail = (res, e) => {
  if (e.code === "23514" && e.constraint === "request_cooldown") {
    return res.status(409).json({ error: "request_cooldown", detail: COOLDOWN_WORDS });
  }
  if (e.code === "22P02") return res.status(400).json({ error: "bad_request" });
  // Two imports of the same row at once: the second meets the open-row index.
  if (e.code === "23505") return res.status(409).json({ error: "already_listed", detail: "Somebody listed the same row a moment ago. Check again." });
  const status = e.code === "42501" ? 403 : (e.status || 500);
  res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error"),
                            ...(e.detail ? { detail: e.detail } : {}) });
};

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function registerRoutes({ pool, secret }) {
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
    // POST /api/register/:schoolId
    upload: handle(async (client, req) => {
      const s = school(req);
      const b = req.body || {};
      /** @type {any[]} */
      let rows;
      if (typeof b.csv === "string") rows = registerRowsFromCsv(b.csv);
      else if (Array.isArray(b.rows)) rows = b.rows.map((/** @type {any} */ r, /** @type {number} */ i) => ({
        line: Number.isInteger(r?.line) ? r.line : i + 1,
        ...Object.fromEntries(REGISTER_COLUMNS.filter((c) => r?.[c] != null && String(r[c]).trim() !== "")
                                              .map((c) => [c, String(r[c]).slice(0, 400)])),
      }));
      else throw err("rows_required", 400, "Send the staff.csv text as `csv`, or the rows as `rows`.");
      const ack = Array.isArray(b.acknowledged) ? b.acknowledged.filter((/** @type {unknown} */ a) => UUID.test(String(a))) : [];
      const commit = b.commit === true;
      // Dates as the database writes them (YYYY-MM-DD), never a JS Date.
      const { rows: out } = await client.query(
        `select line, ok, problem, detail, warning, ended_on::text as ended_on, ack, row_id, upload_id
           from register_upload($1, $2::jsonb, $3, $4::uuid[])`, [s, JSON.stringify(rows), commit, ack]);
      if (out.length === 1 && out[0].line === 0) {
        const code = out[0].problem || "not_permitted";
        const [status, words] = CALL_REFUSALS[code] ?? CALL_REFUSALS.not_permitted;
        throw err(code, status, words);
      }
      const byLine = new Map(rows.map((r) => [r.line, r]));
      const shaped = out.map((/** @type {any} */ r) => {
        const input = byLine.get(r.line) ?? {};
        return {
          line: r.line, ok: r.ok, problem: r.problem, detail: r.detail,
          words: r.problem ? `Row ${r.line}: ${(PROBLEM_WORDS[r.problem] ?? (() => r.problem))(input, r.detail)}` : null,
          warning: r.warning,
          warningWords: r.warning === "recently_ended" ? `Ended ${dayWords(r.ended_on)} (${r.detail}). List anyway?` : null,
          endedOn: r.ended_on, ack: r.ack, rowId: r.row_id,
        };
      });
      const uploadId = out.find((/** @type {any} */ r) => r.upload_id)?.upload_id ?? null;
      return { ok: shaped.every((/** @type {any} */ r) => r.ok), committed: !!uploadId, uploadId, rows: shaped };
    }),

    // GET /api/register/:schoolId?state=
    list: handle(async (client, req) => {
      const s = school(req);
      const state = req.query?.state ? String(req.query.state) : null;
      if (state && !STATES.has(state)) throw err("state_invalid", 400);
      const { rows } = await client.query(
        `select r.id, r.name, r.email, r.role, r.team_code, r.valid_until::text as valid_until, r.state,
                r.uploaded_by, r.uploaded_by_name, r.uploaded_at, r.upload_id,
                r.warned_ended_on::text as warned_ended_on, r.claimed_at, r.claimed_by, r.claimed_by_name,
                r.outcome, r.outcome_reason, r.claimed_request, r.withdrawn_at, r.withdrawn_by_name, r.redacted_at
           from school_register_rows($1, $2) r`, [s, state]);
      return { rows };
    }),

    // POST /api/register/rows/:id/withdraw
    withdraw: handle(async (client, req) => {
      const id = String(req.params?.id ?? "");
      if (!UUID.test(id)) throw err("not_permitted", 403, REFUSALS.not_permitted[1]);
      const r = (await client.query(`select * from register_withdraw($1)`, [id])).rows[0] ?? { ok: false, reason: "not_permitted" };
      if (!r.ok) {
        const [status, words] = REFUSALS[r.reason] ?? REFUSALS.not_permitted;
        throw err(r.reason || "not_permitted", status, words);
      }
      return { id, withdrawn: true };
    }),

    // GET /api/register/:schoolId/redact
    redactDue: handle(async (client, req) => {
      const { rows } = await client.query(
        `select d.id, d.name, d.email, d.role, d.team_code, d.valid_until::text as valid_until, d.withdrawn_at,
                d.due_on::text as due_on
           from register_redact_due($1) d`, [school(req)]);
      return { rows, count: rows.length };
    }),

    // POST /api/register/:schoolId/redact
    redact: handle(async (client, req) => {
      const { rows } = await client.query(`select register_redact($1) as n`, [school(req)]);
      return { cleared: rows[0]?.n ?? 0 };
    }),

    // POST /api/join/register-claim { schoolId }
    claim: handle(async (client, req) => {
      const s = String(req.body?.schoolId ?? "");
      if (!UUID.test(s)) throw err("school_required", 400);
      const { rows } = await client.query(`select * from register_claim($1)`, [s]);
      const granted = rows.filter((/** @type {any} */ r) => r.outcome === "granted").map((/** @type {any} */ r) => ({ role: r.role, teamCode: r.team_code }));
      const requested = rows.filter((/** @type {any} */ r) => r.outcome === "requested").map((/** @type {any} */ r) => ({ role: r.role, teamCode: r.team_code }));
      const list = (/** @type {{role: string, teamCode: string | null}[]} */ xs) => {
        const w = xs.map((x) => roleWords(x.role, x.teamCode));
        return w.length <= 1 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
      };
      // Three sentences (design §5). Nothing granted reads exactly as no row
      // at all: the request form follows, and "Your request has gone to the
      // school office." is the screen's on sending.
      const words = granted.length === 0 ? null
        : requested.length === 0 ? `You're in. The office listed you as ${list(granted)}.`
        : `You're in as ${list(granted)}. Your ${list(requested)} request has gone to the school office.`;
      return { granted, requested: granted.length ? requested : [], words };
    }),

    // POST /api/cooldowns/:id/lift { note? }
    liftCooldown: handle(async (client, req) => {
      const id = String(req.params?.id ?? "");
      if (!UUID.test(id)) throw err("not_permitted", 403, REFUSALS.not_permitted[1]);
      const note = req.body?.note == null ? null : String(req.body.note).slice(0, 500);
      const r = (await client.query(`select * from request_cooldown_lift($1, $2)`, [id, note])).rows[0] ?? { ok: false, reason: "not_permitted" };
      if (!r.ok) {
        const [status, words] = REFUSALS[r.reason] ?? REFUSALS.not_permitted;
        throw err(r.reason || "not_permitted", status, words);
      }
      return { id, lifted: true };
    }),
  };
}

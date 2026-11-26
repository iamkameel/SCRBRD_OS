/**
 * SCRBRD — "Allow his own sign-in": the yes for a pupil's own sign-in, and
 * the office's form on file (SCRBRD-140, the honesty model, Migration B;
 * db/169).
 *
 * A boy under 18 with his own account reads his own page only while a yes
 * is in force: a guardian's "Allow his own sign-in", or the office's record
 * that the school's signed form is on file (Kameel, 18 Nov, Q5). One yes
 * opens it; only its giver or the office closes it (Q6). The database works
 * it out on every read (pupil_signin_in_force(), asked by app_can()); these
 * routes only record the yes and the no, and read what the family and the
 * office may see of it.
 *
 * WHAT THIS FILE DECIDES: nothing. Each route calls one db/169 function
 * under the caller's own identity; the function decides who may and answers
 * a code, which becomes a status here and words on the screen
 * (apps/web/src/lib/ownSignin.js).
 *
 * Routes (all signed in; a pad's resume credential reaches nothing here):
 *   GET  /api/players/:id/own-signin            the family's and the office's read; for her
 *                                               yes, `account`: what the recognised account typed (db/173)
 *   POST /api/players/:id/own-signin { allow }  the guardian's own tap (true: allow, false: stop)
 *   POST /api/players/:id/own-signin/office { formOnFile: true, formSignedBy, formSignedOn } | { withdrawn: true } | { retry: true }
 *                                               the office: the signed form on file, with who signed
 *                                               it and the day (D); a withdrawal; or opening a
 *                                               recognised boy a yes already allows, again (S5)
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { safeErr } from "../log-safe.mjs";
/** @import { RouteDeps, Handler } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Each answer of the sign-in doors, with its status. @type {Record<string, number>} */
export const OWN_SIGNIN_STATUS = Object.freeze({
  not_signed_in: 401,
  not_permitted: 403,
  answer_required: 422,
  player_is_an_adult: 409,
  terms_not_agreed: 409,
  no_date_of_birth: 409,
  not_yours_to_stop: 409,
  not_in_force: 409,
  form_signer_invalid: 422,
  form_date_invalid: 422,
  // db/176 (Kameel, 26 Nov 2026, Q7): the office's signed form for his own child.
  own_child: 403,
});

/**
 * "The signed consent form is on file" (Q12), with who signed it and the
 * day it was signed (Kameel, 20 Nov, D: optional now, required once counsel
 * has read it): from a request body's formSignedBy and formSignedOn, each
 * null when not given. Shape only; the database decides the rest.
 * @param {any} b @returns {{ signedBy: string | null, signedOn: string | null }}
 */
export function formOf(b) {
  const signedBy = typeof b?.formSignedBy === "string" ? b.formSignedBy.trim().slice(0, 200) : "";
  const on = typeof b?.formSignedOn === "string" ? b.formSignedOn.trim() : "";
  return { signedBy: signedBy || null, signedOn: /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null };
}

/**
 * A DATE as the database wrote it (YYYY-MM-DD). pg hands a DATE back as a
 * Date at local midnight, so its local parts are the day. @param {unknown} v
 */
const dayOf = (v) => {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};

/** A pupil_signin_state() row, as Family and the office read it. @param {any} r */
export const ownSigninState = (r) => (r ? {
  agreed: r.agreed === true,
  inForce: r.in_force === true,
  adult: r.adult === true,
  bornKnown: r.born_known === true,
  yesHow: r.yes_how == null ? null : String(r.yes_how),
  yesBy: r.yes_by == null ? null : String(r.yes_by),
  yesAt: r.yes_at ? new Date(r.yes_at).toISOString() : null,
  formSignedBy: r.form_signed_by == null ? null : String(r.form_signed_by),
  formSignedOn: dayOf(r.form_signed_on),
  yours: r.yours === true,
  canAllow: r.can_allow === true,
  canStop: r.can_stop === true,
  held: r.held === true,
  office: r.office === true,
} : null);

/**
 * The office's tick in the same transaction as a grant (Q12): the signed
 * form on file for this boy, with who signed it and the day where given (D), recorded
 * under the office person's name AFTER the grant has written his roles (his
 * own link 'pending'), so the yes stamps it and opens him. A refusal is an
 * error, and rolls the grant back: the office ticked the box believing it
 * would open him. An adult needs no form, and the tick is quietly not
 * recorded.
 * @param {any} client @param {string} player @param {{ signedBy: string | null, signedOn: string | null }} form
 */
export async function recordFormOnFile(client, player, form) {
  const { rows: [r] } = await client.query(`select * from pupil_signin_office_set($1, true, $2, $3::date)`,
                                           [player, form.signedBy, form.signedOn]);
  if (r?.ok || r?.reason === "player_is_an_adult") return;
  const code = r?.reason || "refused";
  // The message is the code too: the requests routes answer { error: e.message }.
  throw Object.assign(new Error(`form_${code}`), { code: `form_${code}`, status: OWN_SIGNIN_STATUS[code] ?? 422 });
}

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function pupilSigninRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, /** @type {number} */ status) => Object.assign(new Error(code), { code, status });
  /** @param {(client: any, req: any) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await runAsPrincipal(pool, secret, req.headers?.authorization, (client) => fn(client, req)));
    } catch (/** @type {any} */ e) {
      if (e.code === "22P02") return res.status(400).json({ error: "bad_request" });
      if (e.status && typeof e.code === "string") return res.status(e.status).json({ error: e.code });
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      console.error("own sign-in →", safeErr(e));
      res.status(500).json({ error: "error" });
    }
  };
  const playerOf = (/** @type {any} */ req) => {
    const id = String(req.params?.id ?? "");
    if (!UUID.test(id)) throw err("not_permitted", 403);
    return id;
  };
  /** (ok, reason, in_force) → the answer, or a refusal with its status. @param {any} r */
  const verdict = (r) => {
    // held: a yes is in force but his recognised account could not be opened by it, and why (S5).
    if (r?.ok) return { ok: true, inForce: r.in_force === true, held: r.held == null ? null : String(r.held) };
    const code = r?.reason || "refused";
    throw err(code, OWN_SIGNIN_STATUS[code] ?? 422);
  };

  return {
    state: handle(async (client, req) => {
      const { rows } = await client.query(`select * from pupil_signin_state($1)`, [playerOf(req)]);
      // Nothing for anybody but his family and the office: the same as an id that is no boy.
      if (!rows[0]) throw err("not_permitted", 403);
      // Q3 (Kameel, 25 Nov 2026; db/173): for her yes, what the account the
      // office recognised as him typed, and the day it did. Nothing else of
      // it; null when there is none she may be shown.
      const { rows: [a] } = await client.query(
        `select typed_name, typed_year, to_char(recognised_on, 'YYYY-MM-DD') as recognised_on
           from pupil_signin_account($1)`, [playerOf(req)]);
      return { ownSignIn: ownSigninState(rows[0]),
               account: a ? { typedName: a.typed_name, typedYear: a.typed_year ?? null, recognisedOn: a.recognised_on } : null };
    }),

    set: handle(async (client, req) => {
      const allow = req.body?.allow;
      if (typeof allow !== "boolean") throw err("answer_required", 422);
      const { rows } = await client.query(`select * from pupil_signin_consent_set($1, $2)`, [playerOf(req), allow]);
      return verdict(rows[0]);
    }),

    office: handle(async (client, req) => {
      const b = req.body || {};
      if (b.retry === true) {
        const { rows } = await client.query(`select * from pupil_signin_retry($1)`, [playerOf(req)]);
        return verdict(rows[0]);
      }
      const yes = b.formOnFile === true ? true : b.withdrawn === true ? false : null;
      if (yes === null) throw err("answer_required", 422);
      const f = formOf(b);
      const { rows } = await client.query(`select * from pupil_signin_office_set($1, $2, $3, $4::date)`,
                                          [playerOf(req), yes, yes ? f.signedBy : null, yes ? f.signedOn : null]);
      return verdict(rows[0]);
    }),
  };
}

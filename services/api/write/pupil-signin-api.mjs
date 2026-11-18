/**
 * SCRBRD — "Allow his own sign-in": the yes for a pupil's own sign-in, and
 * the office's form on file (SCRBRD-140, the honesty model, Migration B;
 * db/164).
 *
 * A boy under 18 with his own account reads his own page only while a yes
 * is in force: a guardian's "Allow his own sign-in", or the office's record
 * that the school's signed form is on file (Kameel, 18 Nov, Q5). One yes
 * opens it; only its giver or the office closes it (Q6). The database works
 * it out on every read (pupil_signin_in_force(), asked by app_can()); these
 * routes only record the yes and the no, and read what the family and the
 * office may see of it.
 *
 * WHAT THIS FILE DECIDES: nothing. Each route calls one db/164 function
 * under the caller's own identity; the function decides who may and answers
 * a code, which becomes a status here and words on the screen
 * (apps/web/src/lib/ownSignin.js).
 *
 * Routes (all signed in; a pad's resume credential reaches nothing here):
 *   GET  /api/players/:id/own-signin            the family's and the office's read
 *   POST /api/players/:id/own-signin { allow }  the guardian's own tap (true: allow, false: stop)
 *   POST /api/players/:id/own-signin/office { formOnFile: true } | { withdrawn: true }
 *                                               the office: the signed form on file, or a withdrawal
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
});

/** A pupil_signin_state() row, as Family and the office read it. @param {any} r */
export const ownSigninState = (r) => (r ? {
  inForce: r.in_force === true,
  adult: r.adult === true,
  bornKnown: r.born_known === true,
  yesHow: r.yes_how == null ? null : String(r.yes_how),
  yesBy: r.yes_by == null ? null : String(r.yes_by),
  yesAt: r.yes_at ? new Date(r.yes_at).toISOString() : null,
  yours: r.yours === true,
  canAllow: r.can_allow === true,
  canStop: r.can_stop === true,
  office: r.office === true,
} : null);

/**
 * The office's tick in the same transaction as a grant (Q12): the signed
 * form on file for this boy, recorded under the office person's name before
 * the grant writes his roles, so the grant door finds the yes. A refusal is
 * an error: the office ticked the box believing it would open him. An adult
 * needs no form, and the tick is quietly not recorded.
 * @param {any} client @param {string} player
 */
export async function recordFormOnFile(client, player) {
  const { rows: [r] } = await client.query(`select * from pupil_signin_office_set($1, true)`, [player]);
  if (r?.ok || r?.reason === "player_is_an_adult") return;
  const code = r?.reason || "refused";
  throw Object.assign(new Error(code), { code: `form_${code}`, status: OWN_SIGNIN_STATUS[code] ?? 422 });
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
    if (r?.ok) return { ok: true, inForce: r.in_force === true };
    const code = r?.reason || "refused";
    throw err(code, OWN_SIGNIN_STATUS[code] ?? 422);
  };

  return {
    state: handle(async (client, req) => {
      const { rows } = await client.query(`select * from pupil_signin_state($1)`, [playerOf(req)]);
      // Nothing for anybody but his family and the office: the same as an id that is no boy.
      if (!rows[0]) throw err("not_permitted", 403);
      return { ownSignIn: ownSigninState(rows[0]) };
    }),

    set: handle(async (client, req) => {
      const allow = req.body?.allow;
      if (typeof allow !== "boolean") throw err("answer_required", 422);
      const { rows } = await client.query(`select * from pupil_signin_consent_set($1, $2)`, [playerOf(req), allow]);
      return verdict(rows[0]);
    }),

    office: handle(async (client, req) => {
      const b = req.body || {};
      const yes = b.formOnFile === true ? true : b.withdrawn === true ? false : null;
      if (yes === null) throw err("answer_required", 422);
      const { rows } = await client.query(`select * from pupil_signin_office_set($1, $2)`, [playerOf(req), yes]);
      return verdict(rows[0]);
    }),
  };
}

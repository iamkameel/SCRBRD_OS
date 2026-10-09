/**
 * SCRBRD — delivering a notice to a phone, without re-deciding who may have it.
 *
 * THE WHOLE SHAPE OF THIS FILE IS ONE SENTENCE: a cached notification is not
 * permission. A device that received a notice last week has no standing to
 * receive the next one, and a subscription list is not an authorization model.
 *
 * So there is no recipient table, no topic, no cached audience. The fan-out
 * enumerates DEVICES, and then asks the notification's own policy — news.read
 * AND the capability the row declares, in the row's scope — once per person, at
 * send time, by SETTING THE PRINCIPAL TO THAT PERSON and selecting the row. If
 * it comes back, they may have it. If their assignment was withdrawn an hour
 * ago, it does not, and the phone stays silent with nothing to invalidate.
 *
 * That is deliberately the most expensive correct design available: one short
 * transaction per person rather than one query for the lot. The cheap version
 * is a capability filter in SQL, which means the authorization question is
 * answered in two places, and the second one drifts. A school with four hundred
 * families sends a few hundred tiny transactions and gets an answer that cannot
 * disagree with what the app would show.
 *
 * WHAT TRAVELS is the second decision, and it is not the same as who. See
 * buildPayload().
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { withPrincipal, AuthError } from "../auth/auth.mjs";
import { transportFromEnv } from "./fcm.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, Pool } from "../api-types.mjs" */
/** @import { PushTransport } from "./fcm.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

/** @param {string} code @param {number} [status] @param {string} [detail]  the words a screen may show */
const err = (code, status = 400, detail = undefined) =>
  Object.assign(new Error(code), { status, ...(detail ? { detail } : {}) });

const PLATFORMS = ["web", "android", "ios"];

// ── THE CLOSURE (docs/design/NOTIFICATIONS.md D9, slice S2) ──
//
// People write posts; the system writes notices. A person's words become a
// `notice` only through news_post (POST /api/news), whose trigger writes the
// one notice row (db/91, D10); the database refuses the application a notice
// of its own. So the hand-written publish route and the manual push route
// are gone, said as 410 with the words a caller can act on. Pushing becomes
// the worker's, after commit, without a button (S3).
/** @type {Readonly<Record<"publish" | "push", string>>} */
export const CLOSED = Object.freeze({
  publish: "Notices are not published here any more. Write a post (POST /api/news): its notice is written for you, to the people its side, school or league admits.",
  push: "Notices are not pushed by hand any more. A notice reaches phones by itself once it is published.",
});

/** The status for each reason notification_report() (db/91) refuses with. @type {Readonly<Record<string, number>>} */
const REPORT_STATUS = Object.freeze({ no_such_notice: 404, not_reportable: 422, already_reported: 409, not_permitted: 403 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a notice says on a lock screen, which is: almost nothing.
 *
 * A push payload is handed to Google, cached on the device, and rendered
 * without anybody signing in. At a school gate on a Saturday the person
 * holding the phone is not reliably the parent, and a child's name and a
 * diagnosis on a lock screen has disclosed his medical information to a
 * bystander — one screen after every masking view in this codebase prevented
 * exactly that.
 *
 * So EVERY notice travels as a POINTER (docs/design/NOTIFICATIONS.md D6, D14):
 * a generic line and an id, with the content fetched through the governed
 * read when the app opens and the person is authenticated again. A second
 * branch used to send the full text of a row marked `is_public`; it is gone,
 * and `is_public` chooses nothing here whatever the row says.
 *
 * The pointer carries the id and NOTHING else — not the kind, not the urgency.
 * "You have a notice" is safe; "you have an INJURY notice" names the subject
 * matter, and a lock screen reading `injury` about a school a bystander can
 * see is most of the disclosure with none of the words.
 * @param {any} notice  a notification row
 */
export function buildPayload(notice) {
  return {
    kind: "pointer",
    message: {
      notification: { title: "SCRBRD", body: "You have a new notice." },
      data: { notificationId: String(notice.id) },
    },
  };
}

/**
 * A test and development transport that never leaves the building.
 *
 * Guarded on NODE_ENV exactly as the dev login is: a production deployment
 * that set this would be reporting sends that never happened, and a delivery
 * log of pretend attempts is worse than an empty one because it reads later as
 * evidence that a parent was told.
 *
 * It records what it was handed so a walk can assert that a restricted notice
 * travelled as a pointer — in memory, on the server, never in the database.
 */
/** @returns {PushTransport & { sent: unknown[] }} */
export function echoTransport() {
  /** @type {unknown[]} */
  const sent = [];
  return {
    name: "echo",
    sent,
    async send({ token, payload }) { sent.push({ token, payload }); return { ok: true }; },
  };
}

/**
 * The transport this process will use, or null when push is not configured.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {PushTransport | null}
 */
export function transportFor(env = process.env) {
  if (env.NODE_ENV !== "production" && env.PUSH_TRANSPORT === "echo") {
    // One instance per process, so a walk can read back what was sent. It
    // hangs off the function itself, which the checker cannot see from inside
    // the function it is assigned on — hence the alias.
    const self = /** @type {typeof transportFor & { _echo?: PushTransport }} */ (transportFor);
    if (!self._echo) self._echo = echoTransport();
    return self._echo;
  }
  return transportFromEnv(env);
}

/**
 * Send one notice to every device whose owner may read it.
 *
 * Returns COUNTS AND NEVER NAMES. "Did it reach the parents" is a reasonable
 * question with an unreasonable answer attached — which families have the app,
 * on how many devices — and a publisher does not get that list back from here
 * any more than they can read it from the table.
 * @param {object} args
 * @param {Pool} args.pool
 * @param {string} args.secret
 * @param {string | undefined} args.bearer  the Authorization header, as sent
 * @param {string | undefined} args.notificationId
 * @param {PushTransport | null | undefined} args.transport
 */
export async function fanOut({ pool, secret, bearer, notificationId, transport }) {
  if (!transport) throw err("push_not_configured", 503);

  // ── 1. As the CALLER: may they read this notice, and may they publish it? ──
  const notice = await runAsPrincipal(pool, secret, bearer, async (client) => {
    const { rows } = await client.query(
      `select id, school_id, team_code, scope_level, kind, urgency, title, body,
              is_public, subject_person_id, expires_at,
              -- The database's clock decides, not this process's.
              coalesce(expires_at <= now(), false) as expired
         from notification where id = $1`, [notificationId]);
    const n = rows[0];
    if (!n) throw err("no_such_notification", 404);
    // Pushing is publishing: it is the act of putting the notice in front of
    // people. So it takes the publish capability for the notice's own scope,
    // which is the same capability that created the row — asked here rather
    // than inferred, because a notice may be readable by far more people than
    // may broadcast one.
    const { rows: [gate] } = await client.query(
      `select app_can('news.publish.' || $1, $2, coalesce($3, '*'),
                      coalesce($4, '00000000-0000-0000-0000-000000000000'::uuid),
                      '00000000-0000-0000-0000-000000000000'::uuid) as ok`,
      [n.scope_level, n.school_id, n.team_code, n.subject_person_id]);
    if (!gate?.ok) throw err("not_permitted", 403);
    // An expired notice is not sent (S0). Asked after the gate, so a caller
    // who may not publish it learns nothing more about it here.
    if (n.expired) throw err("notice_expired", 410, "This notice has expired. Nothing was sent.");
    return n;
  });

  const payload = buildPayload(notice);

  // ── 2. The address book. An enumeration, not a decision. ──
  const client = await pool.connect();
  /** @type {any[]} */
  let candidates;
  try {
    const { rows } = await client.query(
      `select token_id, person_id, token, platform from push_candidates($1)`,
      [notice.school_id]);
    candidates = rows;
  } finally { client.release(); }

  // Grouped per person, because the authorization question is asked once per
  // person and not once per phone.
  /** @type {Map<string, any[]>} */
  const byPerson = new Map();
  for (const c of candidates) {
    if (!byPerson.has(c.person_id)) byPerson.set(c.person_id, []);
    /** @type {any[]} */ (byPerson.get(c.person_id)).push(c);   // set just above when absent
  }

  let delivered = 0, refused = 0, failed = 0, retired = 0;

  for (const [personId, devices] of byPerson) {
    const principal = { userId: personId, deviceId: null };

    // ── 3. THE QUESTION, asked as them, through the notice's own policy. ──
    const conn = await pool.connect();
    // No initial value: the try either assigns it or throws past the check.
    let visible;
    try {
      visible = await withPrincipal(conn, principal, async (c) => {
        const { rows } = await c.query(
          `select 1 from notification where id = $1`, [notificationId]);
        return rows.length === 1;
      });
    } catch (/** @type {any} */ e) {
      // A disabled account is nobody (db/85's app_session_begin() refuses
      // it): told nothing, like anybody else the notice is not for.
      if (!(e instanceof AuthError)) throw e;
      visible = false;
    } finally { conn.release(); }

    if (!visible) { refused += devices.length; continue; }

    // ── 4. The wire. Outside any transaction: a slow network must not hold a
    // connection open, and a dead token must not roll back the others. ──
    for (const d of devices) {
      const verdict = await transport.send({ token: d.token, platform: d.platform,
                                             payload: payload.message });

      const rec = await pool.connect();
      try {
        await withPrincipal(rec, principal, async (c) => {
          // Written AS THE RECIPIENT, which is what makes it impossible to
          // record a delivery to somebody who could not read the notice: the
          // insert re-enters the same policy that just answered yes.
          await c.query(
            `insert into notification_delivery
               (notification_id, token_id, person_id, payload_kind, state, detail)
             values ($1, $2, app_user_id(), $3, $4, $5)
             on conflict (notification_id, token_id) do update
               set state = excluded.state, detail = excluded.detail,
                   payload_kind = excluded.payload_kind,
                   attempts = least(notification_delivery.attempts + 1, 100),
                   attempted_at = now()
             -- A device already told is not told twice. Only a row that has
             -- not succeeded is attempted again, so running a fan-out twice
             -- sends once.
             where notification_delivery.state <> 'sent'`,
            [notificationId, d.token_id, payload.kind,
             verdict.ok ? "sent" : (verdict.rejected ? "rejected" : "failed"),
             verdict.ok ? null : String(verdict.detail || "").slice(0, 500)]);

          // A token FCM has disowned is retired, so the next fan-out does not
          // carry a dead phone. Only on the DEVICE's own verdict — a 401 from
          // a misconfigured key would otherwise quietly empty a school.
          if (verdict.rejected) {
            await c.query(
              `update device_push_token
                  set retired_at = now(), retired_reason = 'rejected'
                where id = $1 and retired_at is null`, [d.token_id]);
          }
        });
      } finally { rec.release(); }

      if (verdict.ok) delivered++;
      else if (verdict.rejected) { failed++; retired++; }
      else failed++;
    }
  }

  return { considered: candidates.length, delivered, refused, failed, retired };
}

/**
 * A person's own phones.
 *
 * No capability anywhere in this file, and that is the design: registering a
 * device is not an authorization act. It can only ever REDUCE what somebody
 * receives — a subscription narrows delivery and can never widen what a person
 * may know — so there is nothing here for a role to govern, and no
 * administrative path to enrol somebody else's phone.
 */
/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function deviceRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "23514") return res.status(422).json({ error: "invalid_device", detail: e.message });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /api/devices { token, platform, label? }
    register: handle(async (req) => {
      const b = req.body || {};
      const token = String(b.token ?? "").trim();
      if (token.length < 16) throw err("token_invalid");
      if (!PLATFORMS.includes(b.platform)) throw err("platform_invalid");
      const label = b.label == null || String(b.label).trim() === ""
        ? null : String(b.label).trim().slice(0, 60);

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client, principal) => {
        const { rows } = await client.query(
          // person_id and device_id come from the PRINCIPAL, never the body.
          // The same lesson as declared_by on an availability row: the person
          // who typed it is the person the platform can stand behind.
          `insert into device_push_token (person_id, token, platform, device_id, label)
           values (app_user_id(), $1, $2, $3, $4)
           -- Only ever my OWN live row: another person's registration of the
           -- same token has already been retired by the BEFORE INSERT trigger,
           -- so by the time the index is consulted there is nothing of theirs
           -- to collide with.
           on conflict (token) where retired_at is null do update
             set last_seen_at = now(), platform = excluded.platform,
                 device_id = excluded.device_id,
                 label = coalesce(excluded.label, device_push_token.label)
           returning id, platform, registered_at, last_seen_at`,
          [token, b.platform, principal.deviceId ?? null, label]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id, platform: rows[0].platform,
                 registeredAt: rows[0].registered_at, lastSeenAt: rows[0].last_seen_at };
      });
    }),

    // POST /api/devices/retire { token } | { id }
    //
    // TWO WAYS IN, because there are two situations and only one of them has a
    // token to hand. A phone signing itself out knows its own registration
    // token. A person whose phone was LOST OR STOLEN is on a different device
    // and has only the row in their settings list — and without an id path
    // that phone keeps receiving the school's alerts until the token happens
    // to be rejected by FCM. Which is exactly the situation a retire button
    // exists for.
    //
    // Both are safe for the same reason: the UPDATE is bounded by the table's
    // policy (person_id = app_user_id()), so neither form can reach a
    // registration that is not the caller's own. The id is not a capability.
    retire: handle(async (req) => {
      const token = String(req.body?.token ?? "").trim();
      const id = String(req.body?.id ?? "").trim();
      if (!token && !id) throw err("token_or_id_required");
      if (token && id) throw err("name_the_device_once");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        // Retired, not deleted — this database grants no DELETE anywhere, and
        // the row saying a device was registered and then signed out is the
        // only record that a registration happened.
        const { rowCount } = await client.query(
          `update device_push_token
              set retired_at = now(), retired_reason = 'signed_out'
            where retired_at is null
              and ($1::text is null or token = $1)
              and ($2::uuid is null or id = $2)`,
          [token || null, id || null]);
        // Not an error when nothing matched. A sign-out on a phone whose
        // registration somebody already retired is a successful sign-out, and
        // saying "no such device" would answer whether one exists to whoever
        // asked — which for the id form would be a way to probe other
        // people's registrations one uuid at a time.
        return { retired: rowCount };
      });
    }),
  };
}

/**
 * What is left of the notices' own write routes: two closed doors, and the
 * one-tap report (D11, CSA SG-9 rule 4).
 *
 * The report decides nothing here. notification_report() (db/91) asks the
 * notice's own policy whether the caller may read it, refuses a second
 * report of the same notice by the same person, writes the DSOs' notice
 * (naming nobody) and the record of who reported it, and answers `unheld`
 * when the school has no DSO, so the screen can say to tell the school.
 * The answer carries no id and no name: a reporter is told it was taken.
 */
/**
 * @param {{ pool: Pool, secret: string, transport?: PushTransport | null }} deps
 *   `transport` is accepted for the server's wiring and unused: nothing is
 *   pushed from a route since S2
 * @returns {Record<string, Handler>}
 */
export function notificationRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error"),
                                ...(e.status && e.detail ? { detail: e.detail } : {}) });
    }
  };
  /** @param {"publish" | "push"} door @returns {Handler} */
  const closed = (door) => async (_req, res) => { res.status(410).json({ error: "gone", detail: CLOSED[door] }); };

  return {
    // POST /api/notifications — closed (D9). 410 whoever asks and whatever
    // the body: nothing is read, no connection is taken.
    publish: closed("publish"),

    // POST /api/notifications/:id/push — closed (D9; S3 pushes after commit).
    push: closed("push"),

    // POST /api/notifications/:id/report — one tap, no body.
    report: handle(async (req) => {
      const id = String(req.params?.id ?? "").toLowerCase();
      // Not a uuid: the same answer as a notice that is not there.
      if (!UUID.test(id)) throw err("no_such_notice", 404);
      const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
        (await client.query(`select ok, reason, unheld from notification_report($1)`, [id])).rows[0]);
      if (!r?.ok) {
        const reason = r?.reason ?? "refused";
        throw err(reason, REPORT_STATUS[reason] ?? 409);
      }
      return { reported: true, unheld: !!r.unheld };
    }),
  };
}

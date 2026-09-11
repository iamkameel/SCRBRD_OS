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
import { withPrincipal } from "../auth/auth.mjs";
import { transportFromEnv } from "./fcm.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });

const PLATFORMS = ["web", "android", "ios"];
const SCOPES = ["school", "team", "competition"];
const URGENCY = ["low", "medium", "high"];
const SUBJECT_KINDS = ["match", "injury", "training", "transport", "facility",
                       "skills", "system", "competition", "selection"];

/**
 * What a restricted notice says on a lock screen, which is: almost nothing.
 *
 * A push payload is handed to Google, cached on the device, and rendered
 * without anybody signing in. At a school gate on a Saturday the person
 * holding the phone is not reliably the parent, and "R Pillay is out with a
 * hamstring strain" on a lock screen has disclosed a child's medical
 * information to a bystander — one screen after every masking view in this
 * codebase prevented exactly that.
 *
 * So the real text travels ONLY for a notice the school has already marked
 * public, and `notification_public_is_general` guarantees such a row requires
 * nothing beyond news.read. Everything else travels as a POINTER: a generic
 * line and an id, with the content fetched through the governed read when the
 * app opens and the person is authenticated again.
 *
 * The pointer carries the id and NOTHING else — not the kind, not the urgency.
 * "You have a notice" is safe; "you have an INJURY notice" names the subject
 * matter, and a lock screen reading `injury` about a school a bystander can
 * see is most of the disclosure with none of the words.
 */
export function buildPayload(notice) {
  const id = String(notice.id);
  if (notice.is_public) {
    return {
      kind: "full",
      message: {
        notification: { title: notice.title, body: notice.body },
        data: { notificationId: id, kind: String(notice.kind || ""),
                urgency: String(notice.urgency || "low") },
      },
    };
  }
  return {
    kind: "pointer",
    message: {
      notification: { title: "SCRBRD", body: "You have a new notice." },
      data: { notificationId: id },
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
export function echoTransport() {
  const sent = [];
  return {
    name: "echo",
    sent,
    async send({ token, payload }) { sent.push({ token, payload }); return { ok: true }; },
  };
}

/** The transport this process will use, or null when push is not configured. */
export function transportFor(env = process.env) {
  if (env.NODE_ENV !== "production" && env.PUSH_TRANSPORT === "echo") {
    // One instance per process, so a walk can read back what was sent.
    if (!transportFor._echo) transportFor._echo = echoTransport();
    return transportFor._echo;
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
 */
export async function fanOut({ pool, secret, bearer, notificationId, transport }) {
  if (!transport) throw err("push_not_configured", 503);

  // ── 1. As the CALLER: may they read this notice, and may they publish it? ──
  const notice = await runAsPrincipal(pool, secret, bearer, async (client) => {
    const { rows } = await client.query(
      `select id, school_id, team_code, scope_level, kind, urgency, title, body,
              is_public, subject_person_id
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
    return n;
  });

  const payload = buildPayload(notice);

  // ── 2. The address book. An enumeration, not a decision. ──
  const client = await pool.connect();
  let candidates;
  try {
    const { rows } = await client.query(
      `select token_id, person_id, token, platform from push_candidates($1)`,
      [notice.school_id]);
    candidates = rows;
  } finally { client.release(); }

  // Grouped per person, because the authorization question is asked once per
  // person and not once per phone.
  const byPerson = new Map();
  for (const c of candidates) {
    if (!byPerson.has(c.person_id)) byPerson.set(c.person_id, []);
    byPerson.get(c.person_id).push(c);
  }

  let delivered = 0, refused = 0, failed = 0, retired = 0;

  for (const [personId, devices] of byPerson) {
    const principal = { userId: personId, deviceId: null };

    // ── 3. THE QUESTION, asked as them, through the notice's own policy. ──
    const conn = await pool.connect();
    let visible = false;
    try {
      visible = await withPrincipal(conn, principal, async (c) => {
        const { rows } = await c.query(
          `select 1 from notification where id = $1`, [notificationId]);
        return rows.length === 1;
      });
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
export function deviceRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
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

    // POST /api/devices/retire { token }
    retire: handle(async (req) => {
      const token = String(req.body?.token ?? "").trim();
      if (!token) throw err("token_required");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        // Retired, not deleted — this database grants no DELETE anywhere, and
        // the row saying a device was registered and then signed out is the
        // only record that a registration happened.
        const { rowCount } = await client.query(
          `update device_push_token
              set retired_at = now(), retired_reason = 'signed_out'
            where token = $1 and retired_at is null`, [token]);
        // Not an error when nothing matched. A sign-out on a phone whose
        // registration somebody already retired is a successful sign-out, and
        // saying "no such token" would answer whether a token exists to
        // whoever asked.
        return { retired: rowCount };
      });
    }),
  };
}

/**
 * Publishing a notice, and then putting it in front of people.
 *
 * The publish had no route at all: notices existed only in the seed, so a
 * capability-gated publish policy governed something nobody could do. RLS
 * decides here as everywhere — this validates the vocabulary and stamps the
 * publisher, and a caller without news.publish for the scope gets 403 from the
 * database rather than from a branch in this file.
 */
export function notificationRoutes({ pool, secret, transport = transportFor() }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (e.code === "23514") return res.status(422).json({ error: "invalid_notice", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_school_or_subject" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /api/notifications { … }
    publish: handle(async (req) => {
      const b = req.body || {};
      if (!b.schoolId) throw err("school_required");
      if (!SCOPES.includes(b.scopeLevel)) throw err("scope_level_invalid");
      if (b.scopeLevel === "team" && !b.teamCode) throw err("team_required_for_team_scope");
      if (!b.kind || !String(b.kind).trim()) throw err("kind_required");
      if (!b.title || !String(b.title).trim()) throw err("title_required");
      if (!b.body || !String(b.body).trim()) throw err("body_required");
      const urgency = b.urgency ?? "low";
      if (!URGENCY.includes(urgency)) throw err("urgency_invalid");
      const subjectKind = b.subjectKind == null || b.subjectKind === "" ? null : String(b.subjectKind);
      if (subjectKind && !SUBJECT_KINDS.includes(subjectKind)) throw err("subject_kind_invalid");

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into notification
             (school_id, team_code, scope_level, kind, urgency, title, body,
              required_capability, is_public, subject_kind, subject_id,
              subject_person_id, published_by, expires_at)
           values ($1, $2, $3, $4, $5, btrim($6), btrim($7),
                   coalesce($8, 'news.read'), coalesce($9, false), $10, $11,
                   $12, app_user_id(), $13)
           returning id, school_id, scope_level, required_capability, is_public,
                     published_at`,
          [b.schoolId, b.teamCode ?? null, b.scopeLevel, String(b.kind).trim(),
           urgency, b.title, b.body, b.requiredCapability ?? null,
           b.isPublic ?? false, subjectKind, b.subjectId ?? null,
           b.subjectPersonId ?? null, b.expiresAt ?? null]);
        if (!rows.length) throw err("not_permitted", 403);
        const n = rows[0];
        return { id: n.id, school: n.school_id, scopeLevel: n.scope_level,
                 requiredCapability: n.required_capability, isPublic: n.is_public,
                 publishedAt: n.published_at };
      });
    }),

    // POST /api/notifications/:id/push
    push: handle(async (req) =>
      fanOut({ pool, secret, bearer: req.headers?.authorization,
               notificationId: req.params.id, transport })),
  };
}

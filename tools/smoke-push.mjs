#!/usr/bin/env node
/**
 * Getting a notice onto a phone without re-deciding who may have it.
 *
 * `notification` and `notification_read` were here from the start, with a
 * capability-gated publish policy, a feed the dashboard reads — and no way to
 * publish and no way to deliver. A notice sat in the database until somebody
 * opened the app, which for "your son has been taken to hospital" is not a
 * notification system.
 *
 *   1. A CACHED NOTIFICATION IS NOT PERMISSION. The fan-out asks the notice's
 *      own policy, per person, as that person, at send time. A role withdrawn
 *      an hour ago means the phone stays silent.
 *   2. REGISTERING A DEVICE GRANTS NOTHING. A subscription can only reduce
 *      what somebody receives; it can never widen what they may know.
 *   3. WHAT TRAVELS IS AS LITTLE AS POSSIBLE. Only an already-public notice
 *      goes out in clear text. Everything else is a pointer and an id.
 *   4. A PHONE THAT CHANGES HANDS stops receiving the last person's alerts.
 *   5. NOBODY ENROLS SOMEBODY ELSE'S PHONE, and nobody reads their list.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-push.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { fanOut, buildPayload } from "../services/api/notify/push-api.mjs";

const PORT = 8845;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const CHILD = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-push-secret",
         // The transport that never leaves the building. Guarded on NODE_ENV
         // in transportFor(), exactly as the dev login is.
         PUSH_TRANSPORT: "echo" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: `device-${email.split("@")[0]}` } })).body?.token;

const register = (token, tok, extra = {}) =>
  api("/api/devices", { method: "POST", token: tok,
                        body: { token, platform: "web", ...extra } });
const retire = (token, tok) =>
  api("/api/devices/retire", { method: "POST", token: tok, body: { token } });
const retireById = (id, tok) =>
  api("/api/devices/retire", { method: "POST", token: tok, body: { id } });
const publish = (tok, body) => api("/api/notifications", { method: "POST", token: tok, body });
const push = (id, tok) => api(`/api/notifications/${id}/push`, { method: "POST", token: tok });
const myDevices = async (tok) => (await api("/api/read/my_devices", { token: tok })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/**
 * One statement under a person's own policies, rolled back.
 *
 * SET LOCAL ROLE is the load-bearing line: the migration role OWNS these
 * tables, and row-level security does not apply to a table's owner, so the
 * same statement run without it proves nothing at all.
 */
async function asPerson(personId, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [personId]);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK");
    return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, code: e.code, message: e.message };
  } finally { c.release(); }
}
const deliveries = (noticeId) => q(
  `select d.payload_kind, d.state, d.attempts, u.email
     from notification_delivery d join app_user u on u.id = d.person_id
    where d.notification_id = $1 order by u.email`, [noticeId]);

// Long enough to pass the token CHECK, and distinguishable BY ITS LAST SIX
// CHARACTERS — the padding goes in the middle, because token_tail is the tail
// and a first draft that padded the end gave every device the same one, which
// made an assertion about telling two people's devices apart pass by accident.
const tk = (who) => `fcm-token-${"x".repeat(20)}-${who.padStart(6, ".")}`;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach   = await login("coach@example.invalid");     // 1XI, medical.status.read
  const head    = await login("sarah@example.invalid");     // directorofsport: news.publish.school
  const parent  = await login("parent@example.invalid");    // guardian of R Pillay
  const watcher = await login("watcher@example.invalid");   // spectator: news.read only
  const medic   = await login("medical@example.invalid");   // medical, no news.publish

  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

  group("A phone registers itself, and nobody else's");
  {
    const r = await register(tk("coach"), coach);
    ok("a person can register their own device", r.status === 200);
    ok("...and gets the registration back", !!r.body?.id);
    const row = (await q(`select person_id, device_id, platform from device_push_token
                           where token = $1`, [tk("coach")]))[0];
    ok("...owned by the caller", row?.person_id === await idOf("coach@example.invalid"));
    // The device id comes from the session token, not the body — so signing
    // out of one phone retires that phone and not the person's other one.
    ok("...with the device id taken from the session", row?.device_id === "device-coach");

    // There is no field for somebody else, and supplying one changes nothing.
    const spoof = await register(tk("spoof"), coach, { personId: await idOf("parent@example.invalid") });
    ok("a device cannot be enrolled for another person", spoof.status === 200);
    ok("...it is always the caller's",
       (await q(`select person_id from device_push_token where token = $1`, [tk("spoof")]))[0]
         .person_id === await idOf("coach@example.invalid"));

    // Re-registering is the ordinary case: a browser hands back the same token
    // every time it starts.
    const again = await register(tk("coach"), coach, { label: "Coach's phone" });
    ok("re-registering the same token does not add a row",
       (await q(`select count(*)::int c from device_push_token where token = $1`,
                [tk("coach")]))[0].c === 1);
    ok("...it is the same registration", again.body?.id === r.body?.id);
    ok("...and the label is kept",
       (await q(`select label from device_push_token where token=$1`, [tk("coach")]))[0].label
         === "Coach's phone");
  }

  group("Nobody reads somebody else's device list");
  {
    await register(tk("parent"), parent);
    const mine = await myDevices(coach);
    ok("a person sees their own devices", mine.length >= 1);
    ok("...and not another person's",
       !mine.some((d) => String(d.token_tail) === tk("parent").slice(-6)));
    // The token is the bearer credential for pushing to that phone. It is
    // useless to somebody reading their own settings and dangerous in a cache.
    ok("the token itself is never returned", mine.every((d) => d.token === undefined));
    ok("...only its tail", mine.every((d) => typeof d.token_tail === "string"));
    ok("a parent's list is their own", (await myDevices(parent)).length === 1);
  }

  group("A phone that changes hands stops receiving the last person's alerts");
  {
    // The family tablet: one parent signs in, then the other, and FCM hands
    // the browser the same registration token both times.
    const TABLET = tk("tablet");
    await register(TABLET, parent);
    await register(TABLET, coach);
    const rows = await q(
      `select u.email, t.retired_at is null as live, t.retired_reason
         from device_push_token t join app_user u on u.id = t.person_id
        where t.token = $1 order by u.email`, [TABLET]);
    ok("both registrations are on record", rows.length === 2);
    ok("...exactly one is live", rows.filter((r) => r.live).length === 1);
    ok("...the live one belongs to whoever signed in last",
       rows.find((r) => r.live)?.email === "coach@example.invalid");
    // Retired, not reassigned. Who held a device and when is not something to
    // overwrite.
    ok("...and the earlier one says why it went",
       rows.find((r) => !r.live)?.retired_reason === "replaced");
  }

  group("Publishing, which had a policy and no route at all");
  {
    const good = await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "fixture",
      title: "Saturday's fixtures", body: "All age groups at home.", isPublic: true });
    ok("somebody holding news.publish.school can publish", good.status === 200);
    ok("...and it is stamped with the publisher",
       (await q(`select published_by from notification where id = $1`, [good.body.id]))[0]
         .published_by === await idOf("sarah@example.invalid"));

    // published_by is never taken from the request, exactly as declared_by on
    // an availability row is not.
    const spoofed = await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "fixture", title: "T", body: "B",
      publishedBy: await idOf("coach@example.invalid") });
    ok("published_by cannot be spoofed",
       (await q(`select published_by from notification where id = $1`, [spoofed.body.id]))[0]
         .published_by === await idOf("sarah@example.invalid"));

    ok("a spectator cannot publish", [403, 401].includes((await publish(watcher, {
      schoolId: HIL, scopeLevel: "school", kind: "fixture", title: "T", body: "B" })).status));
    // The medical officer holds every medical capability and no publishing one.
    ok("holding a subject-matter capability is not holding a publishing one",
       [403, 401].includes((await publish(medic, {
         schoolId: HIL, scopeLevel: "school", kind: "injury", title: "T", body: "B" })).status));

    ok("an unknown scope is refused", (await publish(head, {
      schoolId: HIL, scopeLevel: "province", kind: "x", title: "T", body: "B" })).status === 400);
    ok("a team notice with no team is refused", (await publish(head, {
      schoolId: HIL, scopeLevel: "team", kind: "x", title: "T", body: "B" })).status === 400);
    ok("an unknown urgency is refused", (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "x", title: "T", body: "B",
      urgency: "screaming" })).status === 400);
    ok("an unknown subject kind is refused", (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "x", title: "T", body: "B",
      subjectKind: "gossip" })).status === 400);
    // The database's own belt-and-braces: a notice going on a public screen
    // may not also declare a restricted capability.
    ok("a public notice may not carry a restricted capability",
       (await publish(head, {
         schoolId: HIL, scopeLevel: "school", kind: "injury", title: "T", body: "B",
         isPublic: true, requiredCapability: "medical.status.read" })).status === 422);
  }

  group("A cached notification is not permission");
  {
    await register(tk("watcher"), watcher);
    // A notice about ONE CHILD, requiring a medical capability. The person
    // anchor is what keeps it off every other family's phone.
    const notice = (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "injury",
      title: "Player update", body: "R Pillay is out with a hamstring strain.",
      requiredCapability: "medical.status.read",
      subjectKind: "injury", subjectPersonId: CHILD })).body;
    ok("the notice was published", !!notice?.id);

    const out = (await push(notice.id, head)).body;
    ok("the fan-out ran", typeof out?.considered === "number");
    // Counts and never names: "which families have the app, on how many
    // devices" is not a reporting line this product offers.
    ok("...and returns counts, not names",
       Object.values(out).every((v) => typeof v === "number"));
    ok("...it considered more devices than it delivered to",
       out.considered > out.delivered && out.refused > 0);

    const got = await deliveries(notice.id);
    const emails = got.map((r) => r.email);
    ok("the coach of the boy's side was told", emails.includes("coach@example.invalid"));
    // A spectator holds news.read and nothing else. A registered device did
    // not buy them a notice — which is the whole assertion.
    ok("a spectator with a registered phone was not", !emails.includes("watcher@example.invalid"));
    ok("...and has no delivery row at all",
       (await q(`select count(*)::int c from notification_delivery d
                  where d.notification_id = $1 and d.person_id = $2`,
                [notice.id, await idOf("watcher@example.invalid")]))[0].c === 0);

    // ── THE ONE THAT MATTERS. Withdraw the coach's assignment and send the
    // next notice. Nothing is cached, so nothing has to be invalidated.
    await q(`update role_assignment set active = false
              where person_id = $1 and role = 'coach'`, [await idOf("coach@example.invalid")]);
    const second = (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "injury",
      title: "Player update", body: "Still out.",
      requiredCapability: "medical.status.read",
      subjectKind: "injury", subjectPersonId: CHILD })).body;
    await push(second.id, head);
    const after = (await deliveries(second.id)).map((r) => r.email);
    ok("a role withdrawn an hour ago means the phone stays silent",
       !after.includes("coach@example.invalid"));
    // And the history of what was already sent is untouched: a delivery row is
    // a record of a disclosure, not a standing permission.
    ok("...while what was already delivered stays on record",
       (await deliveries(notice.id)).some((r) => r.email === "coach@example.invalid"));

    // ── THE SECOND GATE, and it is structural rather than defensive.
    //
    // The delivery row is written BY THE RECIPIENT, under their own principal,
    // inside the same step that checked visibility. So the sender cannot
    // record a delivery to somebody who could not read the notice even if the
    // per-person check above were removed — which is exactly what happened
    // when that check was taken out to falsify it: nothing leaked, the insert
    // was refused, and the fan-out failed loudly instead.
    const tokenOf = async (email) => (await q(
      `select t.id from device_push_token t join app_user u on u.id = t.person_id
        where u.email = $1 and t.retired_at is null limit 1`, [email]))[0]?.id;
    const spectatorToken = await tokenOf("watcher@example.invalid");
    const asPublisher = await asPerson(await idOf("sarah@example.invalid"),
      `insert into notification_delivery
         (notification_id, token_id, person_id, payload_kind, state)
       values ($1, $2, $3, 'full', 'sent')`,
      [notice.id, spectatorToken, await idOf("watcher@example.invalid")]);
    ok("a publisher cannot record a delivery in somebody else's name",
       !asPublisher.ok && asPublisher.code === "42501");
    // Nor can the spectator record one for themselves: the policy re-enters
    // the notification's own, so this table cannot be used to probe which
    // notification ids exist either.
    const asSpectator = await asPerson(await idOf("watcher@example.invalid"),
      `insert into notification_delivery
         (notification_id, token_id, person_id, payload_kind, state)
       values ($1, $2, app_user_id(), 'full', 'sent')`,
      [notice.id, spectatorToken]);
    ok("...and nobody can record one for a notice they cannot read",
       !asSpectator.ok && asSpectator.code === "42501");
    // Reading the log is the same rule: your own deliveries and nobody else's.
    const peek = await asPerson(await idOf("watcher@example.invalid"),
      `select count(*)::int c from notification_delivery`);
    ok("...and a person's delivery history is their own",
       peek.ok && peek.rows[0].c === 0);
  }

  group("What travels is as little as possible");
  {
    const restricted = (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "injury",
      title: "Player update", body: "A hamstring strain, grade 2.",
      requiredCapability: "medical.status.read",
      subjectKind: "injury", subjectPersonId: CHILD })).body;
    await push(restricted.id, head);
    const r1 = await deliveries(restricted.id);
    ok("a restricted notice reached somebody", r1.length > 0);
    // A push payload is cached by Google and rendered on a lock screen
    // without anybody signing in.
    ok("...and every device got a pointer, not the text",
       r1.every((d) => d.payload_kind === "pointer"));

    const open = (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "fixture",
      title: "Fixtures", body: "All age groups at home on Saturday.",
      isPublic: true })).body;
    await push(open.id, head);
    const r2 = await deliveries(open.id);
    ok("a public notice reached more people than the restricted one", r2.length > r1.length);
    ok("...and travels in full, because the school already made it public",
       r2.every((d) => d.payload_kind === "full"));

    // The payload builder, asserted directly: the pointer carries the id and
    // nothing else — not the kind, because "you have an INJURY notice" on a
    // lock screen is most of the disclosure with none of the words.
    const p = buildPayload({ id: "abc", is_public: false, kind: "injury",
                             urgency: "high", title: "Player update", body: "secret" });
    ok("a pointer names no subject matter", JSON.stringify(p.message).includes("injury") === false);
    ok("...and carries no body of the notice", !JSON.stringify(p.message).includes("secret"));
    ok("...only the id to fetch it with", p.message.data.notificationId === "abc");
  }

  group("Told once, and only when there is a wire");
  {
    const n = (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "fixture",
      title: "Reminder", body: "Kit inspection Friday.", isPublic: true })).body;
    const first = (await push(n.id, head)).body;
    const before = (await deliveries(n.id)).length;
    await push(n.id, head);
    const rows = await deliveries(n.id);
    ok("running the fan-out twice adds no rows", rows.length === before && before > 0);
    ok("...and does not re-attempt a device already told",
       rows.every((d) => d.state === "sent" && d.attempts === 1));
    ok("the first run delivered something", first.delivered > 0);

    // With nothing configured the fan-out refuses rather than writing a log of
    // sends that never happened — a log of pretend attempts reads later as
    // evidence that a parent was told.
    let refusedCode = null;
    try {
      await fanOut({ pool, secret: "smoke-push-secret", bearer: `Bearer ${head}`,
                     notificationId: n.id, transport: null });
    } catch (e) { refusedCode = e.message; }
    ok("an unconfigured transport refuses the fan-out", refusedCode === "push_not_configured");
  }

  group("Signing out is a retirement, not a deletion");
  {
    ok("a person can retire their own device", (await retire(tk("coach"), coach)).body?.retired === 1);
    ok("...the row stays, marked",
       (await q(`select retired_reason from device_push_token where token = $1`,
                [tk("coach")]))[0].retired_reason === "signed_out");
    // Saying "no such token" would answer whether a token exists to whoever
    // asked. A sign-out of something already gone is a successful sign-out.
    ok("retiring another person's token does nothing and says nothing",
       (await retire(tk("parent"), coach)).body?.retired === 0);
    ok("...and their registration is untouched",
       (await q(`select retired_at from device_push_token where token = $1`,
                [tk("parent")]))[0].retired_at === null);
    // ── THE LOST PHONE. ──
    //
    // A person whose phone was lost or stolen is on a different device and has
    // only the row in their settings list, not the registration token — so
    // without an id path that phone keeps receiving the school's alerts until
    // FCM happens to reject it, which may be never. Which is exactly the
    // situation a sign-out button exists for.
    const mine = (await q(
      `select t.id from device_push_token t join app_user u on u.id = t.person_id
        where u.email = 'parent@example.invalid' and t.retired_at is null limit 1`))[0];
    ok("there is a live registration to lose", !!mine);
    ok("a person can sign out a device they are not holding",
       (await retireById(mine.id, parent)).body?.retired === 1);
    ok("...and it is retired, not removed",
       (await q(`select retired_reason from device_push_token where id = $1`,
                [mine.id]))[0].retired_reason === "signed_out");

    // An id is not a capability: the UPDATE is bounded by the table's own
    // policy, so naming somebody else's row reaches nothing.
    await register(tk("watcher2"), watcher);
    const theirs = (await q(
      `select t.id from device_push_token t join app_user u on u.id = t.person_id
        where u.email = 'watcher@example.invalid' and t.retired_at is null limit 1`))[0];
    ok("one person cannot sign out another person's device",
       (await retireById(theirs.id, parent)).body?.retired === 0);
    ok("...and it is still live",
       (await q(`select retired_at from device_push_token where id = $1`,
                [theirs.id]))[0].retired_at === null);
    // Saying "no such device" would let somebody probe other people's
    // registrations one uuid at a time.
    ok("...and the refusal is indistinguishable from nothing to do",
       (await retireById("00000000-0000-0000-0000-000000000000", parent)).body?.retired === 0);
    ok("naming a device two ways at once is refused",
       (await api("/api/devices/retire", { method: "POST", token: parent,
          body: { id: theirs.id, token: tk("parent") } })).status === 400);
    ok("naming it no way at all is refused",
       (await api("/api/devices/retire", { method: "POST", token: parent, body: {} })).status === 400);

    // A retired phone is not in the address book any more.
    const n = (await publish(head, {
      schoolId: HIL, scopeLevel: "school", kind: "fixture",
      title: "Later", body: "Bus leaves at seven.", isPublic: true })).body;
    await push(n.id, head);
    ok("a retired device receives nothing",
       (await q(`select count(*)::int c from notification_delivery
                  where notification_id = $1 and token_id =
                    (select id from device_push_token where token = $2)`,
                [n.id, tk("coach")]))[0].c === 0);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`PUSH SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

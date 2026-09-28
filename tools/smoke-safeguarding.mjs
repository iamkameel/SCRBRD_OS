#!/usr/bin/env node
/**
 * Safeguarding, phase 1, over HTTP (db/57; docs/design/SAFEGUARDING_DSO.md §9.1).
 *
 * db/99 section 35 proves the policies as the application role. This walks
 * the routes a person actually reaches, as the seeded people:
 *
 *   1. Anybody signed in raises a concern — a pupil, a parent, a coach, an
 *      umpire — and gets back a reference and a time and NOTHING else.
 *   2. The card names the school's DSO, and The Guardian's app link is the
 *      platform's setting, https only.
 *   3. The DSO's inbox holds all four; the principal's, the office's, the
 *      coach's, the parent's, the owner's key's and the platform's hold none.
 *   4. The record opens to the DSO, with the account and who raised it, and
 *      to nobody else; the audit log the principal reads does not say it
 *      exists, and the one the DSO reads does.
 *   5. A share opens to its person for exactly the parts named, never the
 *      reporter, and ends when revoked; the NDSO informed stops the clock;
 *      the close keeps it three years.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-safeguarding.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8859);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const P_PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";
const GUARDIAN = "https://guardian.example.invalid/report";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-safeguarding-secret", GUARDIAN_APP_URL: GUARDIAN },
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
  method: "POST", body: { email, deviceId: "device-safeguarding" } })).body?.token;
const read = async (r, token) => (await api(`/api/read/${r}`, { token })).body?.rows ?? [];
const raise = (token, body) => api("/api/safeguarding/concerns", { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: ownerUrl() });

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const who = {};
  for (const [k, email] of Object.entries({
    pupil: "pillay@example.invalid", parent: "parent@example.invalid", coach: "coach@example.invalid",
    umpire: "e.ndlovu@example.invalid", dso: "dso@example.invalid", head: "principal@example.invalid",
    office: "registrar@example.invalid", sarah: "sarah@example.invalid", owner: "owner@example.invalid",
    platform: "platform@example.invalid", league: "league@example.invalid", medical: "medical@example.invalid",
  })) who[k] = await login(email);
  ok("every account signs in", Object.values(who).every(Boolean));

  group("Anybody signed in raises a concern, and gets a reference back and nothing else");
  const account = "He said the older boys lock him in the kit room after nets and he is scared to go.";
  const raised = {};
  for (const [k, body] of Object.entries({
    pupil:  { schoolId: HIL, aboutKind: "child", nature: ["bullying"], certainty: "recognised", howLearned: "victim", account },
    parent: { schoolId: HIL, aboutKind: "child", nature: ["bullying", "psychological"], certainty: "suspicion", howLearned: "told",
              account, subjectPlayerId: P_PILLAY, occurredWhere: "Kit room" },
    coach:  { schoolId: HIL, aboutKind: "adult", nature: ["physical"], certainty: "suspicion", howLearned: "witness",
              account: "A parent grabbed a U13 boy by the collar at the boundary and shouted in his face.", subjectText: "A parent on the boundary" },
    umpire: { schoolId: HIL, aboutKind: "unknown", nature: ["other"], certainty: "suspicion", howLearned: "witness",
              account: "A boy was crying in the change room after the match and would not say why." },
  })) {
    const r = await raise(who[k], body);
    raised[k] = r.body?.reference;
    ok(`the ${k} raises one (200, SG-reference)`, r.status === 200 && /^SG-[0-9A-Z]{4}-\d{4}$/.test(r.body?.reference ?? ""), JSON.stringify(r.body));
    ok(`...and is told the reference, the time and whether it is held — nothing else`,
       r.body && Object.keys(r.body).sort().join() === "raisedAt,reference,unheld" && r.body.unheld === false);
  }
  const refused = [
    ["with no session", null, { schoolId: HIL }, 401],
    ["too short an account", who.parent, { schoolId: HIL, aboutKind: "child", nature: ["other"], certainty: "suspicion", howLearned: "told", account: "Too short." }, 422, "account_length"],
    ["at a school he does not belong to", who.parent, { schoolId: WES, aboutKind: "child", nature: ["other"], certainty: "suspicion", howLearned: "told", account }, 403, "not_your_school"],
    ["naming a pupil he cannot see", who.parent, { schoolId: HIL, aboutKind: "child", nature: ["other"], certainty: "suspicion", howLearned: "told", account, subjectPlayerId: "aaaaaaaa-0000-0000-0000-000000000006" }, 404, "child_not_visible"],
    ["as The Guardian's app, by a parent", who.parent, { schoolId: HIL, aboutKind: "child", nature: ["other"], certainty: "suspicion", howLearned: "anonymous_app", account }, 422, "anonymous_app_is_recorded_by_a_dso"],
  ];
  for (const [what, token, body, status, error] of refused) {
    const r = await raise(token, body);
    ok(`a concern ${what} is refused (${status}${error ? ` ${error}` : ""})`, r.status === status && (!error || r.body?.error === error), JSON.stringify(r.body));
  }

  group("The card: the school's DSO, and the anonymous route");
  const card = (await api("/api/safeguarding/contacts", { token: who.parent })).body;
  ok("a parent is shown Hilton's DSO by name", card?.rows?.some((c) => c.schoolId === HIL && c.name === "N Dube" && c.heldAt === "school"));
  ok("...and The Guardian's app, as the platform set it", card?.guardianAppUrl === GUARDIAN);
  ok("...and no other school's DSOs", card?.rows?.every((c) => c.schoolId === HIL));

  group("Receipts: his own references, and nothing about what happened next");
  for (const k of ["pupil", "parent", "coach", "umpire"]) {
    const rows = (await api("/api/safeguarding/receipts", { token: who[k] })).body?.rows ?? [];
    ok(`the ${k} holds exactly his own receipt`, rows.length === 1 && rows[0].reference === raised[k]
       && Object.keys(rows[0]).sort().join() === "raisedAt,reference");
  }

  group("The inbox: the DSO holds all four; nobody else holds any");
  const inbox = (await api("/api/safeguarding/inbox", { token: who.dso })).body?.rows ?? [];
  ok("the DSO's inbox holds the four", Object.values(raised).every((ref) => inbox.some((c) => c.reference === ref)), `${inbox.length} rows`);
  ok("...each on a 24-hour clock, none overdue", inbox.every((c) => c.clockHours === 24 && c.overdue === false));
  ok("...with no name and no account in the list", inbox.every((c) => !("account" in c) && !JSON.stringify(c).includes("Pillay")));
  for (const k of ["head", "office", "sarah", "coach", "parent", "pupil", "medical", "league", "owner", "platform"]) {
    const rows = (await api("/api/safeguarding/inbox", { token: who[k] })).body?.rows;
    ok(`the ${k}'s inbox is empty`, Array.isArray(rows) && rows.length === 0);
  }

  group("Opening the record: the DSO, and only the DSO");
  const parentsId = inbox.find((c) => c.reference === raised.parent)?.id;
  const opened = await api(`/api/safeguarding/concerns/${parentsId}`, { token: who.dso });
  ok("the DSO opens it: the account, the child, and who raised it",
     opened.status === 200 && opened.body?.account === account && opened.body?.subjectPlayer?.name === "R Pillay"
     && opened.body?.reporter?.name === "D Pillay", JSON.stringify(opened.body)?.slice(0, 200));
  ok("...and never a date of birth or an address", !/"born"|address/i.test(JSON.stringify(opened.body)));
  for (const k of ["head", "office", "sarah", "parent", "owner", "platform"]) {
    const r = await api(`/api/safeguarding/concerns/${parentsId}`, { token: who[k] });
    ok(`the ${k} cannot open it (404)`, r.status === 404);
  }
  const fam = await api(`/api/safeguarding/concerns/${parentsId}/family`, { token: who.dso });
  ok("the DSO reaches the child's parent through the concern", fam.status === 200 && fam.body?.guardians?.some((g) => g.name === "D Pillay"));
  ok("...and the principal does not", (await api(`/api/safeguarding/concerns/${parentsId}/family`, { token: who.head })).status === 404);

  group("The log: the DSO sees the reads; the school's other auditors see nothing");
  const dsoLog = await read("access_log", who.dso);
  ok("the DSO's log shows the raises and the open", dsoLog.some((l) => l.resource === "safeguarding_concern_raise")
     && dsoLog.some((l) => l.resource === "safeguarding_concern"));
  for (const k of ["head", "office", "sarah", "owner", "platform"]) {
    const log = await read("access_log", who[k]);
    ok(`the ${k}'s log says nothing of it`, !log.some((l) => /^safeguarding/.test(l.resource)), `${log.length} rows`);
  }
  for (const k of ["head", "office", "sarah", "coach", "parent", "pupil", "owner", "platform"]) {
    const n = (await read("notifications", who[k])).filter((x) => x.kind === "safeguarding").length;
    ok(`the ${k} has no safeguarding notice`, n === 0);
  }
  ok("the DSO has hers", (await read("notifications", who.dso)).some((x) => x.kind === "safeguarding"
     && !/Pillay|kit room/i.test(x.body)));

  group("Need to know: a share, the parts named, until revoked");
  const [{ id: SARAH }] = (await pool.query(`select id from app_user where email = 'sarah@example.invalid'`)).rows;
  const shared = await api(`/api/safeguarding/concerns/${parentsId}/shares`, { method: "POST", token: who.dso,
    body: { withPersonId: SARAH, what: ["summary", "child"], openUntil: new Date(Date.now() + 86400000).toISOString(),
            reason: "The director of sport is changing the kit-room keys this week" } });
  ok("the DSO shares the summary and the child's name with the director of sport", shared.status === 200 && shared.body?.id);
  const mine = (await api("/api/safeguarding/shares", { token: who.sarah })).body?.rows ?? [];
  ok("...who finds it", mine.length === 1 && mine[0].id === shared.body?.id);
  const s = await api(`/api/safeguarding/shares/${shared.body?.id}`, { token: who.sarah });
  ok("...and opens exactly those parts: no account, no actions, no reporter",
     s.status === 200 && s.body?.summary && s.body?.child === "R Pillay" && !("account" in s.body) && !("actions" in s.body)
     && !JSON.stringify(s.body).includes("D Pillay"), JSON.stringify(s.body));
  ok("...a notice told her, naming nobody", (await read("notifications", who.sarah)).some((x) => x.kind === "safeguarding" && !/Pillay/.test(x.body)));
  ok("the principal cannot open her share", (await api(`/api/safeguarding/shares/${shared.body?.id}`, { token: who.head })).status === 404);
  ok("...nor sees its notice", !(await read("notifications", who.head)).some((x) => x.kind === "safeguarding"));
  const [{ id: PUPIL }] = (await pool.query(`select id from app_user where email = 'pillay@example.invalid'`)).rows;
  const toPupil = await api(`/api/safeguarding/concerns/${parentsId}/shares`, { method: "POST", token: who.dso,
    body: { withPersonId: PUPIL, what: ["summary"], openUntil: new Date(Date.now() + 86400000).toISOString(), reason: "So he knows it is being handled" } });
  ok("a share to a pupil is refused", toPupil.status === 422 && toPupil.body?.error === "recipient_is_pupil");
  ok("the principal cannot share it", (await api(`/api/safeguarding/concerns/${parentsId}/shares`, { method: "POST", token: who.head,
    body: { withPersonId: SARAH, what: ["account"], openUntil: new Date(Date.now() + 86400000).toISOString(), reason: "I am the head of the school" } })).status === 404);
  ok("the DSO revokes it", (await api(`/api/safeguarding/shares/${shared.body?.id}/revoke`, { method: "POST", token: who.dso })).status === 200);
  ok("...and it no longer opens", (await api(`/api/safeguarding/shares/${shared.body?.id}`, { token: who.sarah })).status === 404);

  group("The record grows by notes; the NDSO informed stops the clock; the close keeps it");
  ok("the DSO notes that the NDSO was told", (await api(`/api/safeguarding/concerns/${parentsId}/notes`, { method: "POST", token: who.dso,
    body: { kind: "ndso_informed", body: "NDSO told by phone" } })).status === 200);
  const after = (await api("/api/safeguarding/inbox", { token: who.dso })).body?.rows?.find((c) => c.id === parentsId);
  ok("...and its clock has stopped", after?.clockStopped === true && after?.overdue === false);
  ok("the principal cannot add a note", (await api(`/api/safeguarding/concerns/${parentsId}/notes`, { method: "POST", token: who.head,
    body: { kind: "note", body: "Looking into it" } })).status === 404);
  const closed = await api(`/api/safeguarding/concerns/${parentsId}/close`, { method: "POST", token: who.dso,
    body: { outcome: "supported", positionOfTrust: false, note: "Kit room locked; the boys spoken to" } });
  const three = new Date(); three.setFullYear(three.getFullYear() + 3);
  ok("the DSO closes it, kept three years", closed.status === 200 && closed.body?.retainUntil?.slice(0, 4) === String(three.getFullYear()), JSON.stringify(closed.body));

  group("Support may not take the DSO's role, and a session reads nothing of it");
  const sup = await api("/api/support/access", { method: "POST", token: who.platform,
    body: { schoolId: HIL, role: "dso", reason: "ticket 5757: read the concerns" } });
  ok("a support session as dso is refused", sup.status === 422 && sup.body?.error === "role_not_supportable");
  const sess = await api("/api/support/access", { method: "POST", token: who.platform,
    body: { schoolId: HIL, role: "schooladmin", reason: "ticket 5758: roster import failing" } });
  ok("a session as the office begins", sess.status === 200);
  ok("...and its inbox, log and notices hold nothing of safeguarding",
     ((await api("/api/safeguarding/inbox", { token: who.platform })).body?.rows ?? []).length === 0
     && !(await read("access_log", who.platform)).some((l) => /^safeguarding/.test(l.resource))
     && !(await read("notifications", who.platform)).some((x) => x.kind === "safeguarding"));
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e.message);
} finally {
  server.kill();
  await pool.end();
}

if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nSAFEGUARDING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

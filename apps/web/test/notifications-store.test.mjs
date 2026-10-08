/**
 * One store for a person's notices (docs/design/NOTIFICATIONS.md D17).
 *
 * Held here, with a fake fetch and no server:
 *
 *   - the count is the server's (the summary's unread_alerts, over the same
 *     view as the list), never the length of a list that has a LIMIT on it
 *   - opening a notice POSTs its receipt, takes its body, and the count falls
 *     at once and then is the server's; a refusal puts it back; a notice gone
 *     says D16's one sentence and leaves the list
 *   - "Mark all read" marks every row, and a refusal puts them back
 *   - two screens mounting together share one read
 *   - A CACHED NOTICE IS NOT PERMISSION: another session's store starts from
 *     nothing, and sign-out forgets everything
 *   - signed out, the demo: scoped mock rows, read in memory, nothing sent
 *   - every badge, Notices, the day sheet, Family and its card read the store,
 *     and no screen keeps read state of its own
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/notifications-store.test.mjs
 */
import { readFileSync } from "node:fs";
import { setToken, resetApi } from "../src/lib/api.js";
import {
  GONE, asNotification, asOpened, markAll, open, refresh, resetNotifications, sessionKey, snapshot, withdrawnWords,
} from "../src/lib/notifications.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── A fake server ───────────────────────────────────────────────────
/** The invented notices of the seed. Never a real child. */
const ROW = (id, over = {}) => ({ id, kind: "notice", urgency: "low", title: `Notice ${id}`, body: `Body ${id}`, tiered: false,
  published_at: "2026-10-07T08:00:00Z", read: false, team_code: null, school_id: "s1", subject_kind: null, subject_id: null,
  subject_person_id: null, retracts_id: null, ...over });
let server;
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, "");
  calls.push({ path, method: init.method ?? "GET", auth: init.headers?.authorization ?? null });
  const answer = server(path, init.method ?? "GET");
  return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
};
const reply = (status, body) => ({ status, body });
const tick = () => new Promise((r) => setTimeout(r, 0));
const signIn = (t) => { setToken(t); };

// ═════════════════════════════════════════════════════
group("The count is the server's, never the list's length");
{
  resetNotifications(); calls.length = 0; signIn("token-a");
  // Two unread rows in the list the server sent, but the server counts five:
  // the list is the newest 200, the count is every unread notice.
  server = (path) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("n1"), ROW("n2"), ROW("n3", { read: true })] })
    : path === "/api/read/summary" ? reply(200, { rows: [{ unread_alerts: 5 }] }) : reply(404, {});
  await refresh("coach");
  const s = snapshot();
  ok("the list arrived", s.list.live && s.list.rows.length === 3, s.list);
  ok("the count is the server's 5, not the list's 2", s.unread === 5, s.unread);
  ok("both reads were made, once each",
    calls.filter((c) => c.path === "/api/read/notifications").length === 1 && calls.filter((c) => c.path === "/api/read/summary").length === 1);
  await refresh("coach");
  ok("a second screen mounting shares the read: nothing asked again", calls.length === 2, calls.length);
  await refresh("coach", { force: true });
  ok("a Retry reads both again", calls.length === 4, calls.length);
}

group("A count that could not be read is not a number");
{
  resetNotifications(); signIn("token-a");
  server = (path) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("n1")] }) : reply(500, { error: "x" });
  await refresh("coach");
  ok("the list stands", snapshot().list.rows.length === 1);
  ok("...and the count is null, not the list's 1", snapshot().unread === null);
}

group("Opening a notice: its receipt, its body, the count");
{
  resetNotifications(); signIn("token-a");
  let unreadAfter = 4;
  server = (path, method) => {
    if (path === "/api/read/notifications") return reply(200, { rows: [ROW("t1", { tiered: true, body: null, kind: "injury" }), ROW("n2")] });
    if (path === "/api/read/summary") return reply(200, { rows: [{ unread_alerts: 5 }] });
    if (path === "/api/notifications/t1/read" && method === "POST")
      return reply(200, { notice: { ...ROW("t1", { kind: "injury", tiered: true, body: "The tiered body." }), withdrawn: false }, unread: unreadAfter });
    return reply(404, {});
  };
  await refresh("coach");
  calls.length = 0;
  const p = open("coach", "t1");
  ok("at once: the row reads as read", snapshot().list.rows.find((n) => n.id === "t1").read === true);
  ok("...and the count fell by one", snapshot().unread === 4, snapshot().unread);
  const got = await p;
  ok("the receipt is a POST to the notice's own route", calls.some((c) => c.path === "/api/notifications/t1/read" && c.method === "POST"));
  ok("...carrying this session's token", calls.every((c) => c.auth === "Bearer token-a"));
  ok("the tiered body arrives on open", got.body === "The tiered body." && got.read === true, got);
  ok("...kept for the session", snapshot().opened.t1?.body === "The tiered body.");
  ok("the count is then the server's", snapshot().unread === 4);
}

group("A refusal puts the optimistic change back");
{
  resetNotifications(); signIn("token-a");
  server = (path) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("n1"), ROW("n2")] })
    : path === "/api/read/summary" ? reply(200, { rows: [{ unread_alerts: 2 }] }) : reply(500, { error: "boom" });
  await refresh("coach");
  const r = await open("coach", "n1");
  ok("the open failed and says so", r.failed === true && /Could not open/.test(r.sentence), r);
  ok("...the row is unread again", snapshot().list.rows.find((n) => n.id === "n1").read === false);
  ok("...and the count is back to 2", snapshot().unread === 2);
  const m = await markAll("coach");
  ok("mark all failed", m === false);
  ok("...and every row is unread again, the count back", snapshot().list.rows.every((n) => !n.read) && snapshot().unread === 2);
}

group("Gone: D16's one sentence, and the row leaves");
{
  resetNotifications(); signIn("token-a");
  server = (path) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("n1"), ROW("n2")] })
    : path === "/api/read/summary" ? reply(200, { rows: [{ unread_alerts: 2 }] })
    : reply(404, { error: "no_such_notification", detail: GONE });
  await refresh("coach");
  const r = await open("coach", "n1");
  ok("gone, in the one sentence", r.gone === true && r.sentence === "This notice is no longer available.", r);
  ok("...and the row left the list", !snapshot().list.rows.some((n) => n.id === "n1"));
}

group("A withdrawn notice opens as a stub (D19)");
{
  const stub = asOpened({ id: "x", withdrawn: true, retracted_at: "2026-10-03T08:00:00Z", withdrawal_id: "w" });
  ok("withdrawn, with the day", stub.withdrawn && stub.sentence === "This notice was withdrawn on 3 October.", stub.sentence);
  ok("...and no title or body", !("title" in stub) && !("body" in stub));
  ok("a time that cannot be read still says it", withdrawnWords(null) === "This notice was withdrawn.");
  ok("nothing at all is gone", asOpened(null).gone === true && asOpened(null).sentence === GONE);
}

group("Mark all read");
{
  resetNotifications(); signIn("token-a");
  server = (path, method) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("n1"), ROW("n2"), ROW("n3", { read: true })] })
    : path === "/api/read/summary" ? reply(200, { rows: [{ unread_alerts: 7 }] })
    : path === "/api/notifications/read-all" && method === "POST" ? reply(200, { marked: 7, unread: 0 }) : reply(404, {});
  await refresh("coach");
  calls.length = 0;
  ok("marked", await markAll("coach"));
  ok("one POST to read-all", calls.length === 1 && calls[0].path === "/api/notifications/read-all" && calls[0].method === "POST");
  ok("every row is read and the count is the server's 0", snapshot().list.rows.every((n) => n.read) && snapshot().unread === 0);
}

group("A cached notice is not permission");
{
  resetNotifications(); signIn("token-a");
  server = (path) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("mine-a")] })
    : path === "/api/read/summary" ? reply(200, { rows: [{ unread_alerts: 1 }] }) : reply(404, {});
  await refresh("parent");
  ok("person A's notice is held for A", snapshot().list.rows[0]?.id === "mine-a");
  const keyA = sessionKey("parent");
  // Somebody else signs in on the same tab, in the same role.
  signIn("token-b");
  ok("the session's key changed with the person", sessionKey("parent") !== keyA);
  let seen = null;
  server = (path) => {
    if (path === "/api/read/notifications") { seen = snapshot().list.rows.map((n) => n.id); return reply(200, { rows: [ROW("mine-b")] }); }
    return path === "/api/read/summary" ? reply(200, { rows: [{ unread_alerts: 1 }] }) : reply(404, {});
  };
  const p = refresh("parent");
  ok("B's store starts from nothing: no row of A's while B's read is on its way",
    snapshot().list.rows.length === 0 && snapshot().unread === null && snapshot().list.loading === true, snapshot());
  await p;
  ok("...not even inside the request", Array.isArray(seen) && seen.length === 0, seen);
  ok("...and B holds only B's", snapshot().list.rows.map((n) => n.id).join() === "mine-b");
  ok("opening A's notice in B's session asks the server, as B",
    (await open("parent", "mine-a")).gone === true || calls.at(-1)?.auth === "Bearer token-b");
  // A late answer to A's read must not land in B's store.
  resetNotifications(); signIn("token-a");
  const held = [];
  server = (path) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("late-a")] }) : reply(200, { rows: [{ unread_alerts: 1 }] });
  const slow = globalThis.fetch;
  globalThis.fetch = (url, init) => new Promise((r) => { held.push(() => r(slow(url, init))); });
  const pa = refresh("parent");
  signIn("token-b");
  globalThis.fetch = slow;
  server = (path) => path === "/api/read/notifications" ? reply(200, { rows: [ROW("now-b")] }) : reply(200, { rows: [{ unread_alerts: 1 }] });
  await refresh("parent");
  for (const go of held) go();
  await pa; await tick();
  ok("A's read was held until B's had answered", held.length === 2, held.length);
  ok("a late answer to A's read never lands in B's store", snapshot().list.rows.map((n) => n.id).join() === "now-b", snapshot().list.rows);
  // Sign-out forgets everything.
  resetNotifications();
  ok("reset: nothing held", snapshot().key === null && snapshot().list.rows.length === 0 && snapshot().unread === null);
  ok("signOut() resets the store", /resetNotifications\(\)/.test(src("../src/lib/session.js")));
}

group("Signed out: the demo, read in memory, nothing sent");
{
  resetApi(); resetNotifications(); calls.length = 0;
  server = () => { throw new Error("the demo fetched"); };
  await refresh("directorofsport");
  const rows = snapshot().list.rows;
  ok("the demo has scoped mock notices", rows.length > 0 && snapshot().list.live === false, rows.length);
  ok("...and counts them from what it holds", snapshot().unread === rows.filter((n) => !n.read).length);
  const first = rows.find((n) => !n.read);
  if (first) {
    const before = snapshot().unread;
    await open("directorofsport", first.id);
    ok("opening one marks it read in memory", snapshot().list.rows.find((n) => n.id === first.id).read && snapshot().unread === before - 1);
  }
  await markAll("directorofsport");
  ok("mark all, in memory", snapshot().unread === 0);
  ok("nothing was sent", calls.length === 0, calls);
}

group("Every badge and notice screen reads the store; none keeps its own read state");
{
  const sites = {
    "TopBar": "../src/shell/TopBar.jsx", "App": "../src/App.jsx", "Notifications": "../src/views/NotificationsView.jsx",
    "Day sheet": "../src/views/DashboardView.jsx", "Family notices": "../src/views/family/family.jsx",
    "Family card": "../src/views/family/cards.jsx", "Pitch deck": "../src/views/PitchDeckView.jsx",
  };
  for (const [name, path] of Object.entries(sites)) {
    const text = src(path);
    ok(`${name} reads useNotifications()`, /useNotifications\(role/.test(text));
    ok(`...and not its own read of "notifications"`, !/use(Live|Rows)\("notifications"/.test(text));
  }
  ok("no screen counts a badge from the list's length",
    !/NOTIFICATIONS\.filter\(n=>!n\.read\)\.length/.test(src("../src/shell/TopBar.jsx"))
    && !/notifications\.filter\(n=>!n\.read\)\.length/.test(src("../src/App.jsx")));
  ok("Notices keeps no read state of its own (readIds is gone)", !/readIds/.test(src("../src/views/NotificationsView.jsx")));
  ok("the Sidebar and MobileNav badges are handed the store's count by App",
    /notifCount=\{unreadCount\}/.test(src("../src/App.jsx")) && /useNotifications\(role\)/.test(src("../src/App.jsx")));
  ok("the adapter keeps a tiered row's body back until it is opened",
    asNotification(ROW("t", { tiered: true, body: null })).body === null && asNotification(ROW("t", { tiered: true, body: null })).tiered === true);
}

globalThis.fetch = realFetch;
resetApi();
console.log(`\nNOTIFICATIONS STORE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

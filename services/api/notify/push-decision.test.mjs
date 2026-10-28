#!/usr/bin/env node
/**
 * D13 step 5, D3, D20, D21 (NOTIFICATIONS S4): whether a phone is told now,
 * at 06:00, or not at all — and that a preference never hides a notice.
 *
 * Pure, with no database: the clock is an argument. db/99 §95 proves the
 * table's rules (own rows, locked kinds, a child only his family's) and that
 * a muted notice is still in my_notifications; tools/smoke-notification-prefs.mjs
 * walks the two routes.
 *
 *   node services/api/notify/push-decision.test.mjs
 */
import { readFileSync } from "node:fs";
import { pushDecision, quietHoursEnd, governingPref, recipientAs } from "./push-decision.mjs";
import { KINDS, MUTABLE_KINDS } from "@scrbrd/policy/notifications";
import { READ_QUERIES } from "../read/read-api.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : JSON.stringify(d)); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

// Two boys, and the clock in South African time (UTC+2) written as UTC.
const ROHAN = "aaaaaaaa-0000-4000-8000-000000000001";
const SIPHO = "aaaaaaaa-0000-4000-8000-000000000002";
const sast = (/** @type {string} */ wall) => new Date(`${wall}+02:00`);
const NOON = sast("2026-10-28T12:00:00");
const adult = { prefs: [], quietHours: false };
const pupil = { prefs: [], quietHours: true };
/** @param {string} kind @param {string | null} [about] */
const medium = (kind, about = null) => ({ kind, urgency: /** @type {const} */ ("medium"), subject_person_id: about });
/** @param {string} kind @param {string | null} [about] */
const high = (kind, about = null) => ({ kind, urgency: /** @type {const} */ ("high"), subject_person_id: about });

// ═══════════════════════════════════════════════════════════════════
group("D3 — urgency first: low never, high always");
// ═══════════════════════════════════════════════════════════════════
ok("a low notice is not pushed", pushDecision({ kind: "fixture", urgency: "low" }, adult, NOON).action === "skip");
ok("a medium notice with no preference is sent", pushDecision(medium("fixture"), adult, NOON).action === "send");
for (const kind of KINDS) {
  const muted = { prefs: [{ kind, subject_player_id: null, push: false }, { kind, subject_player_id: ROHAN, push: false }], quietHours: true };
  ok(`a high ${kind} notice is sent at 02:00 to a pupil who muted the kind`,
     pushDecision(high(kind, ROHAN), muted, sast("2026-10-28T02:00:00")).action === "send");
}

// ═══════════════════════════════════════════════════════════════════
group("D20 — a preference mutes medium, per kind and per child");
// ═══════════════════════════════════════════════════════════════════
{
  const off = { prefs: [{ kind: "notice", subject_player_id: null, push: false }], quietHours: false };
  ok("medium muted: a notice of a kind switched off is skipped",
     JSON.stringify(pushDecision(medium("notice"), off, NOON)) === JSON.stringify({ action: "skip", reason: "muted" }));
  ok("...and another kind is still sent", pushDecision(medium("fixture"), off, NOON).action === "send");
  ok("high not muted: the same kind at high is sent", pushDecision(high("notice"), off, NOON).action === "send");
  const on = { prefs: [{ kind: "notice", subject_player_id: null, push: true }], quietHours: false };
  ok("a row switched back on sends", pushDecision(medium("notice"), on, NOON).action === "send");
}
{
  // A parent of two: recognition switched off for Rohan only.
  const parent = { prefs: [{ kind: "recognition", subject_player_id: ROHAN, push: false }], quietHours: false };
  ok("a parent's per-child row mutes Rohan's recognition notice",
     pushDecision(medium("recognition", ROHAN), parent, NOON).action === "skip");
  ok("...and not Sipho's", pushDecision(medium("recognition", SIPHO), parent, NOON).action === "send");
  ok("...nor a recognition notice about nobody (a per-child row is about that child)",
     pushDecision(medium("recognition"), parent, NOON).action === "send");
  ok("...nor Rohan's lift notice (another kind)", pushDecision(medium("lift", ROHAN), parent, NOON).action === "send");
  // The whole kind off, Sipho's back on: the row about the child is the one that counts.
  const mixed = { prefs: [{ kind: "lift", subject_player_id: null, push: false },
                          { kind: "lift", subject_player_id: SIPHO, push: true }], quietHours: false };
  ok("a kind switched off mutes every child's notice of it", pushDecision(medium("lift", ROHAN), mixed, NOON).action === "skip");
  ok("...except the child whose own row says on", pushDecision(medium("lift", SIPHO), mixed, NOON).action === "send");
  ok("governingPref picks the child's row over the kind's",
     governingPref(medium("lift", SIPHO), mixed.prefs)?.subject_player_id === SIPHO
     && governingPref(medium("lift", ROHAN), mixed.prefs)?.subject_player_id === null);
}
for (const kind of KINDS.filter((k) => !MUTABLE_KINDS.includes(k))) {
  // A row that the CHECK refuses cannot exist; if one did, it still mutes nothing.
  const rogue = { prefs: [{ kind, subject_player_id: null, push: false }, { kind, subject_player_id: ROHAN, push: false }], quietHours: false };
  ok(`a ${kind} notice is never muted, even by a row that should not exist`,
     pushDecision(medium(kind, ROHAN), rogue, NOON).action === "send");
}
ok("safeguarding, welfare and system are among the never-muted kinds",
   ["safeguarding", "welfare", "system"].every((k) => !MUTABLE_KINDS.includes(k)));

// ═══════════════════════════════════════════════════════════════════
group("D21 — a pupil's quiet hours, 21:00 to 06:00 Africa/Johannesburg");
// ═══════════════════════════════════════════════════════════════════
{
  const at22 = sast("2026-10-28T22:00:00");
  const held = pushDecision(medium("fixture"), pupil, at22);
  ok("a pupil's medium notice at 22:00 SAST is held", held.action === "hold", held);
  ok("...until 06:00 SAST the next morning (04:00 UTC)",
     held.action === "hold" && held.until.toISOString() === "2026-10-29T04:00:00.000Z", held);
  ok("...and at 06:00 it is sent", pushDecision(medium("fixture"), pupil, sast("2026-10-29T06:00:00")).action === "send");
  ok("an adult's medium notice at 22:00 is sent", pushDecision(medium("fixture"), adult, at22).action === "send");
  ok("a pupil's high notice at 22:00 is sent", pushDecision(high("lift"), pupil, at22).action === "send");
  const at0230 = pushDecision(medium("notice"), pupil, sast("2026-10-29T02:30:00"));
  ok("after midnight the hold ends the same morning",
     at0230.action === "hold" && at0230.until.toISOString() === "2026-10-29T04:00:00.000Z", at0230);
  ok("21:00 is quiet; 20:59 is not",
     pushDecision(medium("notice"), pupil, sast("2026-10-28T21:00:00")).action === "hold"
     && pushDecision(medium("notice"), pupil, sast("2026-10-28T20:59:59")).action === "send");
  ok("05:59 is quiet; 06:00 is not",
     quietHoursEnd(sast("2026-10-29T05:59:59")) !== null && quietHoursEnd(sast("2026-10-29T06:00:00")) === null);
  const monthEnd = quietHoursEnd(sast("2026-10-31T23:15:00"));
  ok("a hold at the month's end ends on the 1st", monthEnd?.toISOString() === "2026-11-01T04:00:00.000Z", monthEnd);
  const yearEnd = quietHoursEnd(sast("2026-12-31T21:30:00"));
  ok("...and at the year's end on 1 January", yearEnd?.toISOString() === "2027-01-01T04:00:00.000Z", yearEnd);
  const mutedPupil = { prefs: [{ kind: "fixture", subject_player_id: null, push: false }], quietHours: true };
  ok("a muted notice is skipped, not held, in the quiet hours",
     pushDecision(medium("fixture"), mutedPupil, at22).action === "skip");
  ok("the hours are read on the Johannesburg clock, not the machine's: 19:30 UTC is 21:30 there",
     pushDecision(medium("notice"), pupil, new Date("2026-10-28T19:30:00Z")).action === "hold");
}

// ═══════════════════════════════════════════════════════════════════
group("D20 — a preference never hides a notice");
// ═══════════════════════════════════════════════════════════════════
{
  // Notices, the badge and the summary read my_notifications and nothing
  // else; none of them reads notification_pref, so a muted kind is still listed.
  for (const name of ["notifications", "summary"]) {
    const text = READ_QUERIES[name]?.text ?? "";
    ok(`the ${name} read is over my_notifications and never reads a preference`,
       /my_notifications/.test(text) && !/notification_pref|my_alert_choices/.test(text));
  }
  const receipts = readFileSync(new URL("./receipts-api.mjs", import.meta.url), "utf8");
  ok("opening and marking read never read a preference", !/notification_pref/.test(receipts));
  // The parent's action list (GA-I20) is built from its sources, not from notices.
  const mentions = Object.entries(READ_QUERIES)
    .filter(([, q]) => /notification_pref|my_alert_choices/.test(q.text)).map(([name]) => name);
  ok("one read in the API reads a preference: the person's own settings",
     mentions.length === 1 && mentions[0] === "my_notification_prefs"
     && /from my_alert_choices\(\)/.test(READ_QUERIES.my_notification_prefs?.text ?? ""), mentions);
  const v89 = readFileSync(new URL("../../../db/89_notification_contract.sql", import.meta.url), "utf8");
  ok("my_notifications (db/89) is not built over a preference", !/notification_pref/.test(v89));
  // pushDecision returns one of three actions and none of them is "hide".
  const answers = new Set();
  for (const u of ["low", "medium", "high"]) for (const q of [true, false]) for (const p of [true, false])
    answers.add(pushDecision({ kind: "notice", urgency: /** @type {any} */ (u) },
                             { prefs: [{ kind: "notice", subject_player_id: null, push: p }], quietHours: q },
                             sast("2026-10-28T23:00:00")).action);
  ok("the decision is about the phone only: send, hold or skip", [...answers].every((a) => ["send", "hold", "skip"].includes(a)));
}

// ═══════════════════════════════════════════════════════════════════
group("recipientAs — read as the person, nothing named");
// ═══════════════════════════════════════════════════════════════════
{
  /** @type {string[]} */
  const said = [];
  const client = { async query(/** @type {string} */ text) {
    said.push(text);
    return /my_push_quiet_hours/.test(text) ? { rows: [{ quiet: true }] }
      : { rows: [{ kind: "notice", subject_player_id: null, push: false }] };
  } };
  const r = await recipientAs(client);
  ok("it returns the caller's rows and the quiet-hours answer", r.quietHours === true && r.prefs.length === 1 && r.prefs[0].push === false);
  ok("it names nobody: every statement is the caller's own (app_user_id(), no parameter)",
     said.length === 2 && said.every((t) => !/\$1/.test(t)) && /app_user_id\(\)/.test(said[0]));
}

console.log("\n" + "─".repeat(52));
console.log(`PUSH DECISION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

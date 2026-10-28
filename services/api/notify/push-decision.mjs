/**
 * SCRBRD — whether one person's phone is told about one notice now, at
 * 06:00, or not at all (NOTIFICATIONS.md D13 step 5, D3, D20, D21; slice S4).
 *
 * The push worker (S3, not built yet) calls this per person, after it has
 * asked the notice's own policy AS THAT PERSON whether they may have it at
 * all. This decides nothing about visibility and cannot: a notice it skips
 * is still the person's in Notices, on the badge and in a parent's action
 * list (D20). It only answers the phone question.
 *
 *   low     never pushed (in-app only, D3)
 *   high    always pushed, at any hour, whatever a preference says (D3)
 *   medium  skipped when a matching preference says off (D20); otherwise,
 *           for a pupil between 21:00 and 06:00 Africa/Johannesburg, held
 *           and sent at 06:00 (D21), except a welfare referral or a
 *           safeguarding share, which D2 gives no quiet hours; otherwise
 *           sent now
 *
 * A muted notice is skipped, not held: a preference outranks the hours. A
 * row about one child applies only to notices about that child; a row for
 * the whole kind applies to the rest; where both exist for a child, the row
 * about him is the one that counts (the narrower word wins). A kind that may
 * never be muted (anything outside MUTABLE_KINDS) ignores every row, so a
 * row that should not exist still mutes nothing.
 *
 * Pure: the clock is an argument, nothing is read. recipientAs() is the one
 * read, made by the caller inside the recipient's own principal.
 */
import { MUTABLE_KINDS, NO_QUIET_HOURS_KINDS, QUIET_HOURS } from "@scrbrd/policy/notifications";

/**
 * @typedef {{ kind: string, urgency: "low" | "medium" | "high", subject_person_id?: string | null }} PushNotice
 * @typedef {{ kind: string, subject_player_id?: string | null, push: boolean }} PushPref
 * @typedef {{ prefs: readonly PushPref[], quietHours: boolean }} PushRecipient
 * @typedef {{ action: "send" } | { action: "skip", reason: "low" | "muted" } | { action: "hold", until: Date }} PushDecision
 */

/** The wall clock in Johannesburg for an instant: its date, hour and offset. */
function wallClock(/** @type {Date} */ at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: QUIET_HOURS.timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  const y = +parts.year, m = +parts.month, d = +parts.day, h = +parts.hour;
  // The zone's offset at this instant, so 06:00 is that clock's 06:00 (no
  // daylight saving there since 1944, and no assumption that it stays so).
  const asIfUtc = Date.UTC(y, m - 1, d, h, +parts.minute, +parts.second);
  const offset = asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
  return { y, m, d, h, offset };
}

/**
 * When the quiet hours this instant falls in end, or null when it falls in
 * none. 21:00 counts as quiet; 06:00 does not.
 * @param {Date} at
 * @returns {Date | null}
 */
export function quietHoursEnd(at) {
  const { y, m, d, h, offset } = wallClock(at);
  if (h >= QUIET_HOURS.to && h < QUIET_HOURS.from) return null;
  const day = h >= QUIET_HOURS.from ? d + 1 : d;          // Date.UTC rolls the month over
  return new Date(Date.UTC(y, m - 1, day, QUIET_HOURS.to, 0, 0) - offset);
}

/**
 * The preference that governs this notice for this person, if any.
 * @param {PushNotice} notice @param {readonly PushPref[]} prefs
 */
export function governingPref(notice, prefs) {
  if (!MUTABLE_KINDS.includes(notice.kind)) return null;
  const about = notice.subject_person_id ?? null;
  const mine = prefs.filter((p) => p.kind === notice.kind);
  const aboutHim = about ? mine.find((p) => p.subject_player_id === about) : undefined;
  return aboutHim ?? mine.find((p) => (p.subject_player_id ?? null) === null) ?? null;
}

/**
 * D13 step 5, after the visibility check: send now, hold until a time, or skip.
 * @param {PushNotice} notice
 * @param {PushRecipient} recipient
 * @param {Date} [now]
 * @returns {PushDecision}
 */
export function pushDecision(notice, recipient, now = new Date()) {
  if (notice.urgency === "high") return { action: "send" };
  if (notice.urgency !== "medium") return { action: "skip", reason: "low" };
  if (governingPref(notice, recipient.prefs)?.push === false) return { action: "skip", reason: "muted" };
  if (recipient.quietHours && !NO_QUIET_HOURS_KINDS.includes(notice.kind)) {
    const until = quietHoursEnd(now);
    if (until) return { action: "hold", until };
  }
  return { action: "send" };
}

/**
 * The recipient as pushDecision() wants them, read AS THEM: the client must
 * be inside that person's principal (withPrincipal / runAsPrincipal), so the
 * table's own policy returns their rows and no one else's, and
 * my_push_quiet_hours() answers for them alone (db/120).
 * @param {{ query: (text: string) => Promise<{ rows: any[] }> }} client
 * @returns {Promise<PushRecipient>}
 */
export async function recipientAs(client) {
  const { rows: prefs } = await client.query(
    `select kind, subject_player_id, push from notification_pref where person_id = app_user_id()`);
  const { rows: [q] } = await client.query(`select my_push_quiet_hours() as quiet`);
  return { prefs, quietHours: q?.quiet === true };
}

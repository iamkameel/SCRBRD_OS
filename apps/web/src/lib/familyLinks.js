/**
 * SCRBRD — a child's family links, for the office (Squad → a pupil → Family
 * links; account lifecycle slice 3, db/109; ACCOUNT_LIFECYCLE.md §4.4, D12–D14).
 *
 * The pure half of views/familylinks.jsx: the standing line, what each link's
 * state and ending are called, what revoking takes with it, and what a refusal
 * is called. Nothing here decides anything. The `child_links` read says who may
 * see the links (user.role.assign or guardian.link.manage at the school), and
 * guardian_link_revoke(link, kind, reason) says who may end one and when.
 *
 *   GET  /api/read/child_links?playerId=…
 *   POST /api/players/:id/guardians/:link/revoke  { kind, reason }
 */

/** The kinds the office may choose, in the order the sheet offers them. */
export const REVOKE_KINDS = Object.freeze([
  { id: "custody", label: "Custody changed" },
  { id: "family_left", label: "The family asked, or left" },
  { id: "guardian_asked", label: "The guardian asked to end it" },
  { id: "office", label: "The office ended it" },
]);

/** Every kind an ending row may carry, as the list says it. */
const KIND_WORDS = {
  custody: "custody changed",
  family_left: "the family asked, or left",
  guardian_asked: "the guardian asked",
  office: "ended by the office",
  role_ended: "the guardian role ended",
  majority: "ends on his eighteenth birthday, after he left",
  left_school: "ended when he left the school",
};

/** The shortest reason the server takes (db/109). */
export const REASON_MIN = 10;
/** The longest. */
export const REASON_MAX = 2000;

/** Is the reason long enough to send? The server decides again. */
export function reasonOk(text) {
  const t = String(text ?? "").trim();
  return t.length >= REASON_MIN && t.length <= REASON_MAX;
}

/**
 * The adapter for the `child_links` read (lib/live.js ADAPT).
 * @param {any} r  one row as the read returns it
 */
export function asChildLink(r) {
  const day = (v) => (v ? String(v).slice(0, 10) : null);
  return {
    id: r.link_id, playerId: r.player_id, school: r.school_id,
    guardianId: r.guardian_id, guardianName: r.guardian_name ?? null, guardianEmail: r.guardian_email ?? null,
    accountActive: r.account_active !== false, roleLive: r.role_live === true,
    relationship: r.relationship ?? null, state: r.verification_state,
    verifiedBy: r.verified_by_name ?? null, verifiedAt: day(r.verified_at), verifiedNote: r.verified_note ?? null,
    consent: r.consent_state ?? null, consentVersion: r.consent_version ?? null, consentAt: day(r.consent_at),
    validFrom: day(r.valid_from), validUntil: day(r.valid_until),
    createdBy: r.created_by_name ?? null, createdAt: day(r.created_at),
    live: r.live === true,
    endingKind: r.ending_kind ?? null, endingOn: day(r.ending_on), endedBy: r.ended_by_name ?? null,
    // Only to guardian.link.manage, or audit.read without the DSO's standing (D13).
    endingReason: r.ending_reason ?? null,
    standing: r.standing ?? null, isMinor: r.is_minor === true,
    liveLinks: Number(r.live_links ?? 0), consentedLinks: Number(r.consented_links ?? 0),
  };
}

const STANDING = {
  active: "Active",
  pending_consent: "Waiting for the family's agreement",
  pending_verification: "Waiting for a link to be verified",
  unlinked: "No guardian linked",
};

/**
 * The line on top: the child's standing, his verified links, and the
 * agreement on them. From the first row (every row carries the same standing).
 * @param {ReturnType<typeof asChildLink>[]} links
 */
export function standingLine(links) {
  const first = links?.[0];
  if (!first) return "No guardian has ever been linked to him.";
  const n = first.liveLinks;
  const verified = `${n} verified link${n === 1 ? "" : "s"}`;
  const consent = n === 0 ? "" : first.consentedLinks === n
    ? (n === 1 ? " · terms agreed" : " · terms agreed on both") : ` · terms agreed on ${first.consentedLinks}`;
  return `${STANDING[first.standing] ?? "Unknown"} · ${verified}${consent}`;
}

/**
 * What one link is, in a few words: its state and, once ended, how.
 * @param {ReturnType<typeof asChildLink>} l
 */
export function linkStateWords(l) {
  if (l.live) {
    const base = l.state === "verified" ? "Verified" : "Waiting to be verified";
    if (l.endingKind) return `${base} · ${KIND_WORDS[l.endingKind] ?? l.endingKind}${l.endingOn ? ` (${l.endingOn})` : ""}`;
    return l.validUntil ? `${base} · until ${l.validUntil}` : base;
  }
  const how = l.endingKind ? KIND_WORDS[l.endingKind] ?? l.endingKind
    : l.state === "revoked" ? "revoked, no reason recorded"
    : l.state === "rejected" ? "not accepted" : "ended";
  const on = l.endingOn ?? l.validUntil;
  return `Ended${on ? ` ${on}` : ""} · ${how}`;
}

/** May the office be offered "Revoke…" on this link? The server decides again. */
export function mayOfferRevoke(l) {
  return !!l && l.live === true && (l.state === "verified" || l.state === "pending");
}

/**
 * Is this the last verified link of a minor? Then "Revoke…" is not offered
 * as a button that will fail: the sheet says what to do first (link the new
 * guardian). The server's rule is the same (last_verified_link).
 */
export function isLastVerified(l) {
  return !!l && l.live && l.state === "verified" && l.isMinor && l.liveLinks <= 1;
}

/**
 * What revoking takes with it (D14), said in the sheet before the tap.
 * @param {{ guardian: string }} who
 */
export function consequenceWords({ guardian }) {
  return [
    "His name comes off public pages until another guardian answers.",
    `Health monitoring consent given by ${guardian} lapses.`,
    `${guardian}'s lift seats for him are voided, and the drivers are told.`,
    "His emergency contacts stay: check them.",
    `${guardian} is told that a link to a child at the school ended, and the date. Not his name, and not the reason.`,
  ];
}

/**
 * The sentence for a refusal or a failure, and which of the two it is.
 * Nothing was changed either way.
 * @param {any} e  an ApiError, or whatever was thrown
 * @returns {{ kind: "refused" | "failed", text: string }}
 */
export function revokeWords(e) {
  const status = e?.status;
  if (status === undefined || status === null) {
    return { kind: "failed", text: "Could not reach SCRBRD. Check your connection and try again. Nothing was changed." };
  }
  const SAY = {
    not_signed_in: "Your session has ended. Sign in again. Nothing was changed.",
    not_permitted: "You may not end this link. Only the people at his school who look after guardian links may. Nothing was changed.",
    own_link: "You cannot end a link of your own. Ask a colleague at the office. Nothing was changed.",
    no_such_link: "That link could not be found for him. Nothing was changed.",
    no_open_link: "That link has already ended. Nothing was changed.",
    last_verified_link: "He is under 18 and this is his only verified guardian. Link the new guardian first.",
    kind_required: "Choose how the link ended. Nothing was changed.",
    kind_not_allowed: "Choose how the link ended from the list. Nothing was changed.",
    reason_required: `Say why, in ${REASON_MIN} characters or more. Nothing was changed.`,
    reason_too_long: `The reason is longer than ${REASON_MAX.toLocaleString("en-ZA")} characters. Nothing was changed.`,
  };
  const code = e?.code;
  if (status === 401) return { kind: "refused", text: SAY.not_signed_in };
  if (code && SAY[code]) return { kind: "refused", text: SAY[code] };
  return { kind: "failed", text: `That did not go through (${code || `HTTP ${status}`}). Nothing was changed.` };
}

/**
 * SCRBRD — the office verifying a parent's link, and recording the family's
 * agreement to the terms (Squad → Edit Profile → Guardian links).
 *
 * The pure half of views/guardianlink.jsx: who may be offered, what the office
 * is asked to confirm, and what a refusal is called. Nothing here decides
 * anything. guardian_link_verify() and guardian_consent_record() (db/08) check
 * the office's authority at the child's school, that the link exists in the
 * right state, and that nobody verifies themselves; this only turns the
 * answers into sentences.
 *
 *   POST /api/players/:id/guardians/verify   { guardianId }
 *   POST /api/players/:id/guardians/consent  { guardianId, consentVersion }
 */

/**
 * The wording a family agrees to, as db/98 and db/62 record it on every link
 * that is already agreed. A new wording is a new version here, and a new
 * record per family. The office is shown it, never asked to type it.
 */
export const GUARDIAN_TERMS_VERSION = "popia-2026-01";

/**
 * Who the office may pick as the parent: one entry per person holding a guardian
 * appointment at the child's school that is live today, by the `assignments`
 * read. The email comes from the `users` read where there is one, so two
 * parents with one name can be told apart.
 *
 * It is a list of PEOPLE, not of links: no read says which child each is linked
 * to, so the office picks, and the server answers whether that link is there.
 *
 * @param {{ assignments: any[], users: any[], schoolId: string | null | undefined, today: string }} a  today is YYYY-MM-DD
 * @returns {{ id: string, name: string, email: string | null, label: string }[]}
 */
export function guardianCandidates({ assignments, users, schoolId, today }) {
  const emails = new Map((users ?? []).map((u) => [u.id, u.email ?? null]));
  const seen = new Map();
  for (const a of assignments ?? []) {
    if (a.role !== "guardian" || a.active !== true || a.suspended === true) continue;
    if (schoolId && a.school !== schoolId) continue;
    if (a.validUntil && a.validUntil <= today) continue;
    if (!a.personId || seen.has(a.personId)) continue;
    const name = a.personName || emails.get(a.personId) || "A parent";
    const email = emails.get(a.personId) ?? null;
    seen.set(a.personId, { id: a.personId, name, email, label: email ? `${name} · ${email}` : name });
  }
  return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name) || String(x.email).localeCompare(String(y.email)));
}

/**
 * What the office is asked to confirm. It names the child and the parent, and
 * says what the act is: both are checks a person makes on paper, kept against
 * the office's name.
 * @param {"verify" | "consent"} act
 * @param {{ child: string, guardian: string, version?: string }} who
 */
export function confirmWords(act, { child, guardian, version = GUARDIAN_TERMS_VERSION }) {
  return act === "verify"
    ? `Verify that ${guardian} is a parent or guardian of ${child}? You are saying the school's paperwork has been checked. It is kept against your name.`
    : `Record that ${guardian} agrees, for ${child}, to the school's terms, version ${version}? The version and the time are kept against your name.`;
}

/**
 * What is said once the server has answered OK, and only then.
 * @param {"verify" | "consent"} act
 * @param {{ child: string, guardian: string, version?: string }} who
 */
export function doneWords(act, { child, guardian, version = GUARDIAN_TERMS_VERSION }) {
  return act === "verify"
    ? `Verified. ${guardian}'s link to ${child} is checked.`
    : `Recorded. ${guardian} agrees to the school's terms for ${child}, version ${version}.`;
}

/**
 * The sentence for a refusal or a failure, and which of the two it is.
 *
 * "refused": the server answered and said no, with a reason it can name.
 * "failed": it did not answer, or answered something unexpected. Either way
 * nothing was changed, and the form stays as it was.
 *
 * @param {any} e  an ApiError, or whatever was thrown
 * @param {{ child: string, guardian: string }} who
 * @returns {{ kind: "refused" | "failed", text: string }}
 */
export function guardianLinkWords(e, { child, guardian }) {
  const code = e?.code;
  const status = e?.status;
  if (status === undefined || status === null) {
    return { kind: "failed", text: "Could not reach SCRBRD. Check your connection and try again. Nothing was changed." };
  }
  if (status === 401) return { kind: "refused", text: "Your session has ended. Sign in again. Nothing was changed." };
  const REFUSED = {
    not_permitted: `You may not do this for ${child}. Only the people at his school who look after guardian links may. Nothing was changed.`,
    self_verified: "You cannot verify your own link. Ask a colleague at the office. Nothing was changed.",
    no_pending_link: `${guardian} has no link to ${child} waiting to be verified. It may already be verified, or ${guardian} was never linked to ${child}. Nothing was changed.`,
    no_verified_link: `${guardian}'s link to ${child} is not verified yet. Verify the link first, then record the agreement. Nothing was changed.`,
    no_such_player: `${child} could not be found at this school. Nothing was changed.`,
    no_consent_version: "The terms version is missing, so the agreement was not recorded. Nothing was changed.",
  };
  if (code && REFUSED[code]) return { kind: "refused", text: REFUSED[code] };
  return { kind: "failed", text: `That did not go through (${code || `HTTP ${status}`}). Nothing was changed.` };
}

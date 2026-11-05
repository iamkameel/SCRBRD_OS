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
 * THE TEXT OF THAT VERSION (GA-I20 D7, N6), as Kameel approved it on 5 Nov
 * 2026 (docs/design/GUARDIAN_TERMS.md §1, with his Q2 and Q5 lines). The
 * record keeps the version only; this is what the version says, shown to the
 * parent before she agrees and to the office before it records her agreement.
 *
 * CHANGING A SENTENCE IS A NEW VERSION: a new constant beside this one (kept,
 * for reading past agreements) and a new `popia-YYYY-NN`. guardian-terms.test
 * hashes the text against the version and holds it equal to the design doc's
 * §1, so an edit here alone fails. `**bold**` and `*italic*` are the only
 * marks; `{school contact}` and `{SCRBRD contact}` the only placeholders.
 */
export const GUARDIAN_TERMS = Object.freeze({
  version: GUARDIAN_TERMS_VERSION,
  title: "The school's terms for your child on SCRBRD",
  sections: Object.freeze([
    { heading: null,
      paragraphs: [
        "You agree for **one child, at one school**, on your own link to him. The school is responsible for his record; SCRBRD runs the app for it. His other parent agrees for herself.",
      ] },
    { heading: "What we keep about him",
      paragraphs: [
        "His name, date of birth, team, playing role and age group. His ID number, address, phone, email, boarding house, height and weight, where the school records them. Every ball he faces or bowls. His availability answers and the reason given. Team sheets, honours, injuries and treatment, bowling load, coaches' skill ratings and notes, conduct records, the people to ring if he is hurt, lifts, notices about him, and who has looked at his record. A photo of a paper scorebook page naming him is kept 30 days to check the import.",
      ] },
    { heading: "Why",
      paragraphs: [
        "To run the school's cricket: pick sides, score matches, keep him safe and well, and keep in touch with you. If he has his own sign-in, the same agreement covers his account.",
      ] },
    { heading: "Who can see it, and who never can",
      paragraphs: [
        "You, his other parent and the boy himself. His coaches and team staff: his side's details, whether he is fit and what is wrong, his bowling load. The office, director of sport and principal: his file. The physio: his health in full. The coach, team manager, physio and, on the day, a lift driver: the numbers to ring. Team-mates and their parents: his name on the sheet and scorecard, nothing more. The other school's coaches: his named squad and figures for five days before a fixture, logged. Scouts: only with your yes. Neither you nor he sees his coaches' notes; he sees his ratings and you do not; conduct matters reach you the school's own way, not in the app. SCRBRD's support staff read him only to help the school, as a school role, an hour at a time, logged.",
      ] },
    { heading: "What is public, and what never is",
      paragraphs: [
        "Nothing until the school publishes a match; then team scores and results. His name on a public scorecard is an initial and surname, only if you separately say yes; until then he is \"Batter\" or \"Bowler\". From twelve he may say no himself, and his no stands. Never public, whatever anyone agrees: his full name, a photo, his date of birth, his health or why he is not playing, conduct, contact details, ratings, notes, a page about him, or any figure of his across matches. A no takes effect at once, on past scorecards too.",
      ] },
    { heading: "Health",
      paragraphs: [
        "Injuries are never public. If the school runs health monitoring (daily check-ins, training load) it asks you separately; you read his check-ins only when the school shares them by a recorded act. His match overs are outside it.",
      ] },
    { heading: "Safeguarding",
      paragraphs: [
        "The school's Designated Safeguarding Officer keeps safeguarding records under the school's Safeguarding Policy. They are not shown in the app, and the Officer decides what a family is told. You may raise a concern from any screen.",
      ] },
    { heading: "Your phone",
      paragraphs: [
        "A lock-screen notification never carries his name; it only says there is a notice to read.",
      ] },
    { heading: "How long",
      paragraphs: [
        "Match scores are the shared record of those matches and are kept for good. Everything that says who he is is removed from them after the school's retention period once he leaves, by a dated, logged act. Lift records are kept one season.",
      ] },
    { heading: "Eighteen, and leaving",
      paragraphs: [
        "Your link stays open while he is at school. From eighteen his consents are his; you may still say no, never a new yes. The link ends on the later of his eighteenth birthday and the day he leaves the school system; his record is then his own.",
      ] },
    { heading: "Your rights",
      paragraphs: [
        "*See it:* Family shows his file; ask the office in writing for everything, answered within 30 days (aim: ten working days), free. *Correct it:* contacts yourself; the record through the office, with evidence; a wrong score by amendment, both versions kept. *Ask who looked:* the office can tell you. *Withdraw this agreement* by telling the office: you keep sight of his record, but he cannot be selected, and lifts and health monitoring stop, until it is agreed again. *Complain* to the Information Regulator of South Africa.",
        "The Information Regulator of South Africa (inforegulator.org.za).",
      ] },
    { heading: "If something goes wrong",
      paragraphs: [
        "If his data is seen by someone who should not have seen it, the school's information officer emails you: what happened, what has been done, what to do, and who it was if known.",
      ] },
    { heading: "Contact",
      paragraphs: [
        "The school's information officer: {school contact}. For your sign-in account, SCRBRD's information officer: {SCRBRD contact}. Google sign-in is covered by the privacy notice.",
      ] },
  ]),
});

/**
 * The two contacts the text names (Kameel, Q1): per school, and the platform's.
 * No school column names an information officer yet, so the school's is
 * POPIA's default, its head, reached through the office the parent already
 * deals with; SCRBRD's is a platform constant. Neither is a person's address.
 * @param {string | null | undefined} schoolName
 */
export function termsContacts(schoolName) {
  return {
    school: `the principal of ${schoolName || "the school"}, through the school office`,
    scrbrd: "the SCRBRD information officer, via the school office",
  };
}

/**
 * The terms with the two contacts filled in: the same sections, nothing else
 * changed. Any other `{…}` in the text would be a placeholder nobody fills.
 * @param {{ school: string, scrbrd: string }} contacts
 * @returns {{ heading: string | null, paragraphs: string[] }[]}
 */
export function renderTerms(contacts) {
  return GUARDIAN_TERMS.sections.map((s) => ({
    heading: s.heading,
    paragraphs: s.paragraphs.map((t) => t.replaceAll("{school contact}", contacts.school).replaceAll("{SCRBRD contact}", contacts.scrbrd)),
  }));
}

/**
 * A paragraph split on its marks, for a screen to draw: plain text, `**strong**`
 * and `*em*`. Nothing else is markup.
 * @param {string} text
 * @returns {{ kind: "text" | "strong" | "em", text: string }[]}
 */
export function termsRuns(text) {
  /** @type {{ kind: "text" | "strong" | "em", text: string }[]} */
  const out = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    out.push(m[1] != null ? { kind: "strong", text: m[1] } : { kind: "em", text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The parent's twin of confirmWords: what is kept when she agrees. */
export const AGREE_KEPT_WORDS = "Your agreement, this version and the time are kept against your name.";

/**
 * The record's own words once the server has answered OK: "Agreed · 5 Nov 2026, 16:02 · popia-2026-01".
 * @param {string | null | undefined} at  consent_at, ISO
 * @param {string | null | undefined} version
 */
export function agreedWords(at, version) {
  const d = at ? new Date(at) : null;
  let when = null;
  if (d && !Number.isNaN(d.getTime())) {
    const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }).split("-").map(Number);
    const hm = d.toLocaleTimeString("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
    const month = MONTHS[m - 1];
    when = `${day} ${month} ${y}, ${hm}`;
  }
  return ["Agreed", when, version].filter(Boolean).join(" · ");
}

/**
 * A refusal of HER OWN agreement, in words for a parent (the office's are
 * guardianLinkWords' below). Nothing is changed by any of them.
 * @param {any} e
 * @param {string} child  his first name
 * @returns {{ kind: "refused" | "failed", text: string }}
 */
export function agreeRefusalWords(e, child) {
  const status = e?.status;
  if (status === undefined || status === null) {
    return { kind: "failed", text: "Could not reach SCRBRD. Check your connection and try again. Nothing was recorded." };
  }
  if (status === 401) return { kind: "refused", text: "Your session has ended. Sign in again. Nothing was recorded." };
  const REFUSED = {
    no_verified_link: `The school has not verified your link to ${child} yet, or it has ended. Nothing was recorded.`,
    not_permitted: `You may agree only for your own link to ${child}. Nothing was recorded.`,
    no_consent_version: "The terms version is missing, so your agreement was not recorded.",
    no_such_player: `${child} could not be found at the school. Nothing was recorded.`,
  };
  if (e?.code && REFUSED[e.code]) return { kind: "refused", text: REFUSED[e.code] };
  return { kind: "failed", text: `That did not go through (${e?.code || `HTTP ${status}`}). Nothing was recorded.` };
}

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

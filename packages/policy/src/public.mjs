/**
 * SCRBRD — what a signed-out page may show about a pupil (SCRBRD-083).
 *
 * docs/policy/PUBLIC_DATA.md is the decision, made by the product owner
 * scenario by scenario. This file is that decision in code, and the only
 * place it is made: every public read asks here, and no screen decides for
 * itself. It is §6 step 1 of that document, and nothing else — no table, no
 * route, no screen.
 *
 *   SURFACES, surface(id)    §2. What each public surface may carry, as data,
 *                            so a read asks surface("A3") and is told "not
 *                            public" rather than restating the decision.
 *   NEVER_PUBLIC             §3. Table columns, and whole tables, that no
 *                            public read may select, whatever the consent.
 *   publicName(facts)        §1.2–1.4 and §4. What a public page shows for one
 *                            player: "D Erasmus", or his position.
 *   initialAndSurname(name, stored)
 *                            §1.4. The "D Erasmus" formatter: the stored
 *                            surname and known-as when the office recorded
 *                            them (db/47), a heuristic over the full name
 *                            when it did not.
 *
 * PURE. No database, no network, no clock. The facts a decision needs are
 * gathered on the server by the read that serves the page (§6 step 3) and
 * passed in; the only date is the one the caller passes. That is what lets
 * every branch of the rule be proved by a unit suite rather than by a walk.
 *
 * "Public" means signed out: anyone with the link, including people the
 * platform does not know. Adults doing a public job — umpires, scorers,
 * coaches named on a fixture — are outside this rule.
 */

// ═══════════════════════════════════════════════════════════════════
//  §2 — Surface by surface
// ═══════════════════════════════════════════════════════════════════

/**
 * How a surface is decided.
 *
 *   public      shown to anyone with the link, once its `needs` hold
 *   name_rule   shown, and every pupil on it is named by publicName()
 *   team_level  shown, aggregated to the team: no pupil is picked out
 *   signed_in   not public; signed-in users, under their own capabilities
 *   never       on no public page
 *
 * @typedef {"public"|"name_rule"|"team_level"|"signed_in"|"never"} Decision
 */

/** @type {readonly Decision[]} */
export const DECISIONS = Object.freeze(["public", "name_rule", "team_level", "signed_in", "never"]);

/** The decisions under which a surface appears on a signed-out page at all. */
const SHOWN = new Set(["public", "name_rule", "team_level"]);

/**
 * @typedef {object} Surface
 * @property {string}   id        L1…L7, A1…A8, D1…D4
 * @property {string}   what      the surface, in the document's words
 * @property {Decision} decision
 * @property {boolean}  public    whether it may appear on a signed-out page at all
 * @property {readonly string[]} needs
 *   what must hold before it shows. "published": the fixture, competition page
 *   or overlay it belongs to has been published by its school (§1.1 — off
 *   until switched on). "honour.is_public": the honour is marked public (A5).
 * @property {string}   rule      the decision, in the document's words
 */

/** @type {Record<string, [what: string, decision: Decision, rule: string, needs?: string[]]>} */
const DECIDED = {
  L1: ["Team names, score, result on the live page", "public",
       "Public once the school publishes the fixture", ["published"]],
  L2: ["Batters' and bowler's names on the live board", "name_rule",
       "Initial and surname, only for a child with consent; otherwise \"Batter\" / \"Bowler\"", ["published"]],
  L3: ["Ground and time while the match is on", "public", "Shown; names follow L2", ["published"]],
  L4: ["Ball-by-ball commentary and dismissals", "name_rule", "Same rule as L2", ["published"]],
  L5: ["The other school's players", "name_rule",
       "Each side named only by its own school's rule; a side not on the platform is never named", ["published"]],
  // The NAME is never shown; the player still appears, as a position.
  // publicName() answers that for a typed name whatever else is true.
  L6: ["A name the scorer typed in", "never", "Never named publicly: shown as a position"],
  L7: ["Shot maps and wagon wheels", "team_level", "Team-level only on public pages", ["published"]],
  A1: ["Results and standings", "public", "Public", ["published"]],
  A2: ["Full scorecards after the match", "name_rule", "Same name rule as L2", ["published"]],
  A3: ["Leaderboards across a competition", "signed_in", "Not public"],
  A4: ["A public page per player", "never", "Never"],
  A5: ["The honours board", "name_rule",
       "Only honours marked public (honour.is_public), names by the L2 rule", ["honour.is_public"]],
  A6: ["Milestones (fifty, five-for)", "name_rule",
       "Automatically on the live page, under the L2 rule", ["published"]],
  A7: ["Team sheets before the match", "signed_in", "Not public; the school's own channels"],
  // "Photo and video sharing will come later, for registered users only" —
  // later, and signed in. On a public page: none.
  A8: ["Photographs of pupils", "never", "None on public pages"],
  D1: ["Search engines", "never", "Public pages are not indexed"],
  D2: ["The stream overlay", "name_rule", "Brought under the L2 consent rule", ["published"]],
  // The link travelling is expected. What it opens is whatever the other
  // surfaces allow, and nothing more.
  D3: ["A live link shared on WhatsApp", "public", "Expected; the page shows only what this rule allows"],
  D4: ["News posts naming pupils", "signed_in", "News stays signed-in for now"],
};

/** @type {Readonly<Record<string, Readonly<Surface>>>} */
export const SURFACES = Object.freeze(Object.fromEntries(
  Object.entries(DECIDED).map(([id, [what, decision, rule, needs = []]]) => [id, Object.freeze({
    id, what, decision, public: SHOWN.has(decision), needs: Object.freeze([...needs]), rule,
  })])));

/**
 * The decision for one surface.
 *
 * An id the document does not decide is refused, loudly, rather than answered:
 * a typo'd id must not come back as anything a page could show.
 *
 * @param {string} id  "L1" … "D4", exactly
 * @returns {Readonly<Surface>}
 */
export function surface(id) {
  if (typeof id !== "string" || !Object.hasOwn(SURFACES, id)) {
    throw new RangeError(`no public surface "${String(id)}" is decided — PUBLIC_DATA.md §2 decides L1–L7, A1–A8 and D1–D4`);
  }
  return SURFACES[id];
}

/**
 * D1, as the value a public page sends: the X-Robots-Tag header and the
 * robots meta tag. Findable by link, not by search (§1.7).
 */
export const ROBOTS = "noindex";

// ═══════════════════════════════════════════════════════════════════
//  §3 — Never public (N1–N5)
// ═══════════════════════════════════════════════════════════════════

/**
 * §3's five, in the document's order. The document numbers them only as a
 * range, "N1–N5"; the numbers here are the bullets' order, which §1.4's
 * "(L2, A8, N1)" — N1 for a date of birth — agrees with.
 */
export const NEVER_PUBLIC_RULES = Object.freeze({
  N1: "Date of birth and exact age. The age group (\"U15\") stays.",
  N2: "Health: injury, illness, and why a boy is not playing, including the bare word \"unavailable\".",
  N3: "Discipline: any reference to a conduct matter.",
  N4: "Contact, home and identity: address, phone, email, guardian, ID number, hometown, boarding house, height, weight.",
  N5: "Judgements: coaches' notes, skill ratings, scouting interest.",
});

/** @typedef {keyof typeof NEVER_PUBLIC_RULES} NeverRule */

/**
 * What no public read may select, whatever the consent: `table` for a whole
 * table, `table.column` for one column. Column names as Postgres holds them,
 * lower case (player.houseAtSchool is `houseatschool`).
 *
 * A WHOLE TABLE where the row's existence is itself the disclosure. That an
 * injury row exists for a boy says he is hurt, whichever of its columns are
 * left out; so does a disciplinary row, a coach's note, a scouting consent.
 * For those there is no safe column to select.
 *
 * packages/policy/test/public.test.mjs holds this against tables.mjs: every
 * column masked on a table about a pupil is here, or on PUBLIC_DESPITE_MASK
 * with the surface that permits it, or the suite fails. It also holds every
 * entry to the schema in db/, because a typo'd column protects nothing.
 *
 * @type {Readonly<Record<string, NeverRule>>}
 */
export const NEVER_PUBLIC = Object.freeze({
  // ── Whole tables ──
  // N2. The injury record: availability, diagnosis and the clinical notes,
  // every tier of it (tables.mjs masks two of three; here all three).
  injury: "N2",
  // N2. A family's statement about one Saturday — "unavailable, family" — is
  // "why a boy is not playing", and its status column is the bare word.
  match_availability: "N2",
  // N2, and a reading rather than a quotation: a bowler's overs against the
  // directive for his age is an injury-prevention record about his body
  // (player.workload.read, level 2). The overs themselves are on the scorecard.
  bowling_breach: "N2",
  // N3. A conduct matter, open, concluded or withdrawn.
  disciplinary_record: "N3",
  // N4. Who to ring about a child, and their numbers.
  emergency_contact: "N4",
  // N4. The guardian link: who a child's guardian is, and the processing
  // consent that sits on the link.
  assignment_subject: "N4",
  // N5. A coach's candid prose about a child.
  development_note: "N5",
  // N5. A coach's numeric judgement of a child.
  player_skill: "N5",
  // N5. That a family was asked about scouting, and what it said, is
  // scouting interest.
  player_scouting_consent: "N5",

  // ── Columns ──
  "player.born": "N1",
  // N2. fit / injured / rehab / unavailable: the bare word, and worse.
  "player.fitness": "N2",
  "player.id_number": "N4",
  "player.email": "N4",
  "player.phone": "N4",
  "player.address": "N4",
  "player.guardian": "N4",
  "player.hometown": "N4",
  "player.houseatschool": "N4",
  "player.height": "N4",
  "player.weight": "N4",
  // N3. Colours are withdrawn with a reason, and the reason can be a conduct
  // matter. A public honours board (A5) shows live honours; never why one went.
  "honour.withdrawn_reason": "N3",
  // N4. A pupil who signs in has a login address here, and a guardian's row
  // lists whose guardian they are.
  "app_user.email": "N4",
  "app_user.child_ids": "N4",

  // ── db/47, the records this rule reads (§6 step 2) ──
  // N4, and the rule's own words (C5): "no page shows or records the
  // reason". The never-public mark is a WHOLE table: its reason is a
  // safeguarding matter — a court order, a custody dispute, a protection
  // order, which is a child's home and who he must be kept from — and the
  // row's existence is itself the disclosure a stranger must not be able to
  // tell from "no consent yet". A public read learns the mark only as the
  // boolean public_name_facts() returns, and only publicName() sees that.
  player_never_public: "N4",
  // N4: who a child's guardian is. The consent's giver is a guardian's link
  // (or the pupil's own account), and whoever recorded or ended it is the
  // guardian, the pupil, or the office acting for them.
  "public_name_consent.giver_assignment_id": "N4",
  "public_name_consent.giver_link_id": "N4",
  "public_name_consent.recorded_by": "N4",
  "public_name_consent.ended_by": "N4",
});

/**
 * Columns tables.mjs masks on a pupil's table that a public read MAY select,
 * each with the §2 surface that permits it.
 *
 * EMPTY, and that is the finding rather than an oversight: every column masked
 * about a pupil today is on NEVER_PUBLIC. An entry here is a decision that a
 * column one capability hides from signed-in staff may nonetheless reach a
 * stranger, so it names the surface that decided so, and the suite checks the
 * surface is one a public page shows.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PUBLIC_DESPITE_MASK = Object.freeze({});

/** @param {unknown} s */
const ident = (s) => String(s).trim().replace(/^"(.*)"$/, "$1").toLowerCase();

/**
 * The §3 rule that keeps a table, or one of its columns, off every public page.
 *
 * @param {string} table
 * @param {string} [column]  omitted: asks about the table as a whole
 * @returns {NeverRule|null}  null when nothing in §3 forbids it
 */
export function neverPublicRule(table, column) {
  const t = ident(table);
  if (Object.hasOwn(NEVER_PUBLIC, t)) return NEVER_PUBLIC[t];
  if (column == null) return null;
  const tc = `${t}.${ident(column)}`;
  return Object.hasOwn(NEVER_PUBLIC, tc) ? NEVER_PUBLIC[tc] : null;
}

/**
 * Refuse a public read that would select something §3 forbids. Called by the
 * read, with the columns it is about to select, before it runs.
 *
 * `*` is refused too: a public read names its columns, so that a column added
 * to the table later does not reach a stranger by default.
 *
 * @param {string} table
 * @param {readonly string[]} columns
 * @throws {Error} naming every refused column and the rule that refuses it
 */
export function assertPublicSelect(table, columns) {
  /** @type {string[]} */
  const refused = [];
  const whole = neverPublicRule(table);
  if (whole) refused.push(`${ident(table)} (${whole}, the whole table)`);
  for (const c of columns) {
    if (ident(c) === "*") { refused.push("* (a public read names its columns)"); continue; }
    const rule = whole ? null : neverPublicRule(table, c);
    if (rule) refused.push(`${ident(table)}.${ident(c)} (${rule})`);
  }
  if (refused.length) {
    throw new Error(`a public read may not select ${refused.join(", ")} — PUBLIC_DATA.md §3`);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  §1.2–1.4, §4 — The name rule
// ═══════════════════════════════════════════════════════════════════

/**
 * What a page shows instead of a name. The caller's context may supply its own
 * ("Striker", "Wicketkeeper"); "Player" is what is shown when it supplies none.
 */
export const POSITION_LABELS = Object.freeze({
  batter: "Batter", bowler: "Bowler", fielder: "Fielder", player: "Player",
});

/**
 * One recorded public-name consent (C1), as the read serving the page found
 * it. Records are end-dated, never deleted (C3), so a withdrawn one is still
 * passed, with `endedOn` set.
 *
 * @typedef {object} NameConsent
 * @property {"guardian"|"pupil"} by  who gave it
 * @property {boolean} competent
 *   Whether the giver could give it, on the day he did — the document's
 *   "competent person". For a guardian: he held a VERIFIED guardian link to
 *   this child that day, not since rejected or revoked as untrue (a link that
 *   simply ended at the child's majority still counts: C6, "his guardian's
 *   stands"). For the pupil: he was eighteen that day (C6). Computed where
 *   the date of birth lives — `majority_on(born) <= given_on` in SQL — so no
 *   date of birth reaches a public read (N1), and none reaches this module.
 *   public_name_facts() (db/47) computes it on every read. The schema records
 *   no reason for a revocation, so every revoked link counts as untrue there:
 *   it fails closed.
 * @property {string} givenOn  YYYY-MM-DD, the day it began to count
 * @property {string|null} [endedOn]
 *   YYYY-MM-DD, the day it stopped: withdrawn, or superseded by a newer
 *   version. A recorded "no" is a record that ends the day it begins.
 */

/**
 * Everything the name rule needs about one player, gathered by the read that
 * serves the page. All of it about HIS OWN side's school — the away school's
 * settings and consents for an away player, never the host's (L5: each school
 * speaks for its own children).
 *
 * Every yes/no fact must be exactly `true` or `false`. One that is missing, or
 * anything else, is a fact nobody established, and an unestablished fact never
 * names a child: a read that forgets to look up the never-public mark gets a
 * position back, not a name.
 *
 * @typedef {object} NameFacts
 * @property {string} on
 *   YYYY-MM-DD: the day the page is SERVED (sa_today() on the server), never
 *   the day the match was played. See "C3" below.
 * @property {string|null} [fullName]  player.full_name, or the name the scorer typed
 * @property {boolean} [typed]
 *   L6: a name typed in with no player record behind it. Never named.
 * @property {boolean} [schoolOnPlatform]
 *   L5: his side's school is on the platform. A side that is not is never named.
 * @property {boolean} [schoolPublished]
 *   §1.1: his side's school has published this fixture, competition page or overlay.
 * @property {boolean} [neverPublic]
 *   C5: he carries a never-public mark. The mark only — its reason is never
 *   passed here, so it cannot come back out.
 * @property {boolean} [namesOff]
 *   C4: his school has switched names off for this age group — or, for the
 *   overlay, set this fixture's name_display to 'none'. When a boy plays up,
 *   true if the switch is off for either the side's age group or his own
 *   (§5a). public_name_facts(player, side) (db/47) answers it, asking his
 *   age group by birth, the side he is registered in, and the side passed.
 * @property {readonly NameConsent[]} [consents]
 *   his consent records, current and ended. public_name_facts() passes each
 *   giver's most recent act: one person's own acts are ordered, and a
 *   same-day withdrawal and re-consent must not tie with each other.
 * @property {string|null} [surname]  player.surname, when the office recorded one (db/47)
 * @property {string|null} [knownAs]  player.known_as: the name he goes by, which gives the initial
 * @property {string} [label]  shown instead of a name: "Batter", "Bowler", "Fielder" …
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} s @returns {s is string} */
const isDay = (s) => {
  if (typeof s !== "string" || !DAY.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  // Round-tripped, so 2026-02-30 is not a day.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/**
 * What a public page shows for one player: his initial and surname, or the
 * label for where he is on the field. Nothing else, ever — in particular never
 * a reason. "Batter" for a boy with no consent yet and "Batter" for a boy the
 * school has marked never-public are the same string, so a stranger cannot
 * tell which is which.
 *
 * The order is the document's, and it does not change the answer — every
 * branch but one ends at the same label:
 *
 *   C5  a never-public mark overrides everything, consent included
 *   L6  a typed name, with no record behind it: never named
 *   L5  his school is not on the platform: never named
 *   §1.1 his school has not published: nothing of his is public yet
 *   C4  his school has switched names off for his age group
 *   C1–C3, C6  a consent that counts, live on the day the page is served
 *   C2  and with nothing recorded, no name
 *
 * C3 — A "NO" REACHES THE PAST, WHICH IS WHY THERE IS NO MATCH DATE HERE.
 * Consent is judged on `on`, the day the page is served, for every page,
 * finished scorecards included. Judged on the day the match was played, a
 * consent withdrawn since would go on naming him on every scorecard from
 * before the withdrawal, which is exactly what C3 and §1.6 forbid. The same
 * reading names him on an old scorecard once consent is recorded now; that is
 * §1.3 as written ("named in public only when consent is recorded for him"),
 * because a scorecard served today is published today. A match date passed in
 * by mistake is ignored.
 *
 * It follows that a page carrying names cannot be cached past the day, nor for
 * long within it: a withdrawal has to reach it "at once" (§1.6).
 *
 * @param {NameFacts} facts
 * @returns {string}  "D Erasmus", or the label
 * @throws {TypeError} when `on` is not a YYYY-MM-DD day — there is no default,
 *   because a default "today" is a clock, and the wrong day is a wrong answer
 */
export function publicName(facts) {
  const { on } = facts;
  if (!isDay(on)) throw new TypeError(`publicName needs the day the page is served as YYYY-MM-DD, not ${JSON.stringify(on)}`);
  const label = typeof facts.label === "string" && facts.label.trim() ? facts.label.trim() : POSITION_LABELS.player;

  const named = facts.neverPublic === false        // C5
    && facts.typed === false                        // L6
    && facts.schoolOnPlatform === true              // L5
    && facts.schoolPublished === true               // §1.1
    && facts.namesOff === false                     // C4
    && consentStands(facts.consents, on);           // C1, C2, C3, C6

  // A consenting boy whose record has no usable name is still a position.
  return (named && initialAndSurname(facts.fullName, { surname: facts.surname, knownAs: facts.knownAs })) || label;
}

/**
 * Whether a consent that counts is live on the day `on`.
 *
 * C6 — TURNING EIGHTEEN. From his eighteenth birthday his own consent counts;
 * until he gives it, his guardian's stands. So: once there is a record from
 * him that counts, his records alone govern and his guardian's are set aside —
 * his own "no" outweighs a guardian's "yes" still on file. Until then his
 * guardian's records govern, including the one given while he was a minor,
 * which carries on past his birthday. A record he made before eighteen is not
 * a competent consent: it names nobody, and it does not displace his
 * guardian's either. (A child who must never appear, at any age, is C5's
 * business, not a consent record's.)
 *
 * THE LATEST RECORD GOVERNS. Consent is versioned: a new version starts as the
 * last one ends. When two records disagree — one guardian's consent still
 * open, the other's since withdrawn — the later one decides, so a "no" given
 * after a "yes" is never outvoted by it. A tie on the day goes to the one that
 * has ended. A record that begins after `on` has not begun.
 *
 * @param {readonly NameConsent[]|undefined} consents
 * @param {string} on  YYYY-MM-DD
 */
function consentStands(consents, on) {
  const counting = (Array.isArray(consents) ? consents : []).filter((c) =>
    c != null && c.competent === true && (c.by === "guardian" || c.by === "pupil")
    && isDay(c.givenOn) && c.givenOn <= on);

  const his = counting.filter((c) => c.by === "pupil");
  const governing = his.length ? his : counting.filter((c) => c.by === "guardian");
  if (!governing.length) return false;                                  // C2

  const latest = governing.reduce((d, c) => (c.givenOn > d ? c.givenOn : d), "");
  return governing.filter((c) => c.givenOn === latest).every((c) => liveOn(c, on));
}

/**
 * Live on `on`: begun (checked above) and not yet ended. An end on the day
 * itself is an end — a withdrawal takes effect the day it is made (C3). An end
 * that is not a readable day is an end too.
 *
 * @param {NameConsent} c
 * @param {string} on
 */
const liveOn = (c, on) => c.endedOn == null || (isDay(c.endedOn) && on < c.endedOn);

// ═══════════════════════════════════════════════════════════════════
//  §1.4 — Initial and surname
// ═══════════════════════════════════════════════════════════════════

/**
 * Lower-case particles that belong to the surname they precede: Afrikaans,
 * Dutch and French, and the Portuguese ones common in South Africa. Compounds
 * ("van der", "van den", "de la") are runs of these. "vd" is a register's
 * short "van der".
 */
const PARTICLES = new Set([
  "van", "der", "den", "de", "du", "le", "la", "von", "te", "ter", "ten", "'t", "vd",
  "da", "das", "dos", "des",
]);

/** Generational suffixes, which are not the surname. */
const SUFFIX = /^(jnr|jr|snr|sr|ii|iii|iv)\.?$/i;

/** @param {string} s */
const words = (s) => s.split(/[\s,]+/u).filter(Boolean);

/** Brackets and quotes set aside: a known-as written into the full name. @param {string} s */
const unbracket = (s) => s.normalize("NFC").replace(/\([^)]*\)|\[[^\]]*\]|"[^"]*"|“[^”]*”/gu, " ");

/** A stored name as a display string, or "" when nothing usable is stored. @param {unknown} s */
const stored = (s) => (typeof s === "string" ? s.normalize("NFC").replace(/\s+/gu, " ").trim() : "");

/** @param {string[]} ws */
const dropSuffix = (ws) => {
  while (ws.length > 1 && SUFFIX.test(ws[ws.length - 1])) ws.pop();
  return ws;
};

/** The first letter of a word, capitalised: "Mary-Anne" → "M", "A.B." → "A". @param {string} w */
const initialOf = (w) => (w.match(/\p{L}/u)?.[0] ?? "").toUpperCase();

/** @param {string[]} given @param {string[]} surname */
const compose = (given, surname) =>
  [given.length ? initialOf(given[0]) : "", surname.join(" ")].filter(Boolean).join(" ");

/**
 * "D Erasmus": the first given name's initial and the surname. Never more —
 * not a second initial, not a first name.
 *
 * THE STORED SURNAME FIRST. db/47 gave player a `surname` and a `known_as`,
 * filled by the office. When the surname is there it is used as stored, and
 * nothing about it is guessed: "Maria Santos Silva" with surname "Santos
 * Silva" is "M Santos Silva", "Khumalo Sipho" with surname "Khumalo" is
 * "S Khumalo". The initial is then the known-as's, when there is one (a boy
 * registered "Johannes" and known as "Hannes" is "H Botha" — still one
 * letter), or else the first word of the full name once the surname is taken
 * out of it, wherever it stood.
 *
 * THE HEURISTIC, when no surname is stored. `full_name` has no split between
 * given names and surname, so the surname is guessed:
 *
 *   - the last word, with any lower-case particles before it ("van der
 *     Merwe", "de la Rey", "du Plessis"), and a capitalised particle heading
 *     such a run ("Van der Merwe");
 *   - "Surname, Given names" — a register's form — read the other way round;
 *   - a known-as in brackets or quotes, and a Jnr/Snr/II, set aside;
 *   - a name of one word shows its initial alone: "Sipho" → "S", because it
 *     cannot tell a first name from a surname, and a first name alone is
 *     never shown (§1.4);
 *   - a name that is all surname ("van der Merwe") shows the surname alone.
 *
 * A stored known-as gives the initial here too, once a surname has been
 * found. The heuristic cannot know that "Andile" in "Sipho Andile Khumalo" is
 * a second given name rather than part of the surname — it guesses,
 * correctly there, that the surname is one word — and without a stored
 * surname it gets these wrong:
 *
 *   "Pieter De Villiers"   → "P Villiers"   capitalised particle, no run after it
 *   "Maria Santos Silva"   → "M Silva"      a two-word surname with no particle
 *   "Khumalo Sipho"        → "K Sipho"      surname first with no comma: a first
 *                                           name shown, the one real leak
 *   "Jan VAN DER MERWE"    → "J MERWE"      particles in capitals
 *
 * @param {string|null|undefined} fullName
 * @param {{surname?: string|null, knownAs?: string|null}} [names]
 *   player.surname and player.known_as, as stored; either may be absent
 * @returns {string}  "" when there is no name to show
 */
export function initialAndSurname(fullName, names = {}) {
  const surname = stored(names?.surname);
  const knownAs = stored(names?.knownAs);
  const alias = knownAs ? initialOf(words(unbracket(knownAs))[0] ?? "") : "";

  if (surname) {
    return [alias || initialOf(givenOutside(fullName, surname)), surname].filter(Boolean).join(" ");
  }

  if (typeof fullName !== "string") return "";
  const s = unbracket(fullName);

  const comma = s.indexOf(",");
  if (comma >= 0) {
    const sur = dropSuffix(words(s.slice(0, comma)));
    if (sur.length) return alias ? compose([alias], sur) : compose(words(s.slice(comma + 1)), sur);
  }

  const ws = dropSuffix(words(s));
  if (!ws.length) return "";
  if (ws.length === 1) return initialOf(ws[0]);

  const isParticle = (/** @type {string} */ w) => PARTICLES.has(w.toLowerCase());
  let i = ws.length - 1;
  while (i > 0 && isParticle(ws[i - 1]) && ws[i - 1] === ws[i - 1].toLowerCase()) i--;
  // "Van der Merwe": a capitalised particle that heads a lower-case run.
  if (i > 0 && i < ws.length - 1 && isParticle(ws[i - 1])) i--;
  return compose(alias ? [alias] : ws.slice(0, i), ws.slice(i));
}

/**
 * The first given name in a full name, once a stored surname is taken out of
 * it — wherever it stands, and whatever its capitals. "" when nothing is left.
 *
 * @param {string|null|undefined} fullName
 * @param {string} surname  as stored, non-empty
 */
function givenOutside(fullName, surname) {
  if (typeof fullName !== "string") return "";
  const s = unbracket(fullName);
  const comma = s.indexOf(",");
  // "Surname, Given names": the given names are after the comma.
  const ws = dropSuffix(words(comma >= 0 ? s.slice(comma + 1) : s));
  const sur = words(surname).map((w) => w.toLowerCase());
  if (comma < 0 && sur.length) {
    for (let at = 0; at + sur.length <= ws.length; at++) {
      if (sur.every((w, k) => ws[at + k].toLowerCase() === w)) {
        ws.splice(at, sur.length);
        break;
      }
    }
  }
  return ws[0] ?? "";
}

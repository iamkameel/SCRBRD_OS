/**
 * SCRBRD — the words a coach's plan to the side may not carry (SG-10's list).
 *
 * docs/design/SCRBRD-138_phaseB.md §3 (decided, Kameel 2026-10-14: PB-D6 to
 * PB-D10). A plan is a post read by every boy in the side and by their
 * parents, so before one goes out its words are checked against this one
 * list, and on a hit it is refused back to its writer with the words named.
 * docs/policy/CSA_SAFEGUARDING_CHECK.md SG-10 held the derisive half as prose;
 * this is the list in code, and the only copy of it. The news publish route
 * (services/api/write/news-api.mjs) is the gate; the composer runs the same
 * function as a courtesy; SG-10's AI discard filter imports it when it is
 * built (§3.7). No table, no setting, no list per school: a school must not
 * be able to loosen a safeguarding rule. It changes by pull request, reviewed
 * by the lead; a DSO or a coach proposes a word through the backlog.
 *
 *   WORDS               the list: each entry a word or a stem, and its class
 *   CLASSES             the four classes, in the order a refusal names them
 *   refusedWords(text)  every listed word in the text: [{ word, cls }]
 *   refusalMessage(hits)  the refusal, in words, for the writer alone
 *
 * HOW AN ENTRY MATCHES. Whole words only, and case-blind. A plain entry
 * ("howler") matches itself and its plural ("howlers"); an entry ending in
 * "*" is a stem ("injur*") and matches every word that starts with it
 * (injury, injured, injuries). Two-word entries ("sick note") match across
 * any run of spaces. The edges are lookarounds rather than \b, as maskNames()
 * has them (services/api/ai/ai-service.mjs): "(physio)", "physio." and
 * "R.physio" each have the word in clear, and a full stop or a bracket must
 * hide nothing. Letters are Unicode letters, so "Naidoo’s" and an accented
 * name are words like any other.
 *
 * WHAT IS NOT ON IT, ON PURPOSE (§3.3). Words a true plan needs: "away",
 * "rest" (the rest of the order), "out", "load" (the off side), "limit",
 * "four overs". A stem is chosen so that it does not swallow one of them, or
 * another everyday word: "exam" is a word and not a stem, because "exam*"
 * would refuse "for example"; "hospital" likewise, for "hospitality". A list
 * that cries wolf is switched off in the coach's head.
 *
 * WHAT THIS NEVER DOES (§3.5, PB-D10). It reads the string and nothing else:
 * no roster, no injury, no availability. It returns the words; it never
 * alters the text, and it keeps nothing.
 *
 * ITS LIMITS (§3.6). A list catches words, not meaning. "He bowled like a
 * drain" passes. The honesty line on the composer, the DSO's reach, the
 * withdrawal and the one-tap report stand beside it, and are the real check.
 *
 * PURE. No database, no network, no clock. Imported by the server and by the
 * web client alike, so it stays small.
 */

/** The classes, in the order a refusal names them. */
export const CLASSES = Object.freeze(["health", "absence", "discipline", "derisive"]);

/**
 * The list. `w` is the word or stem (lower case; "*" ends a stem), `cls` its
 * class. Kept in class order so a reviewer reads one class at a time.
 * @type {ReadonlyArray<Readonly<{ w: string, cls: string }>>}
 */
export const WORDS = Object.freeze((/** @type {[string, string][]} */ ([
  // ── health · K3: a pupil holds no medical tier at all (db/55), and
  //    PUBLIC_DATA N2 treats even "unavailable" as health ──
  ["physio*", "health"], ["injur*", "health"], ["hamstring*", "health"], ["concuss*", "health"],
  ["sick*", "health"], ["ill", "health"], ["illness", "health"], ["unwell", "health"],
  ["niggl*", "health"], ["rehab*", "health"], ["doctor*", "health"], ["medic*", "health"],
  ["workload*", "health"], ["restricted", "health"], ["restriction", "health"],
  ["unavailab*", "health"], ["unfit", "health"], ["hospital", "health"], ["hospitalis*", "health"],
  ["hospitaliz*", "health"], ["fractur*", "health"], ["sprain*", "health"], ["diagnos*", "health"],
  ["asthma*", "health"], ["inhaler", "health"], ["surgery", "health"],
  // ── absence · no reason for anybody's absence (138 §5.2): the sheet is
  //    the answer ──
  //    Not "grounded" or "suspended", and "disciplinary" rather than the
  //    stem "disciplin*": each has a cricket sense a true plan needs (a bat
  //    grounded behind the crease, play suspended for rain, bowling with
  //    discipline). Kameel, 14 Oct 2026: "Drop the cricket senses".
  ["excused", "absence"], ["sick note", "absence"],
  ["exam", "absence"], ["examination", "absence"], ["suspension", "absence"],
  // ── discipline · another boy's conduct is never in front of children
  //    (PUBLIC_DATA N3; SAFEGUARDING_DSO §1) ──
  ["detention", "discipline"], ["disciplinary", "discipline"], ["conduct matter", "discipline"],
  ["misconduct", "discipline"], ["expelled", "discipline"], ["expulsion", "discipline"], ["demerit*", "discipline"],
  // ── derisive · mocking is bullying (CSA p39; SG-10) ──
  ["shocker", "derisive"], ["howler", "derisive"], ["embarrass*", "derisive"], ["useless", "derisive"],
  ["pathetic", "derisive"], ["hopeless", "derisive"], ["disgrace*", "derisive"], ["clown*", "derisive"],
  ["laughing stock", "derisive"], ["butterfingers", "derisive"],
])).map(([w, cls]) => Object.freeze({ w, cls })));

const LETTER = "[\\p{L}\\p{N}_]";
const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One entry as a pattern: a stem takes any ending; a word takes its plural. */
const patternOf = (/** @type {string} */ w) => {
  const stem = w.endsWith("*");
  const body = (stem ? w.slice(0, -1) : w).split(" ").map(escapeRe).join("\\s+");
  return stem ? `${body}${LETTER}*` : `${body}(?:e?s)?`;
};

// Longest first, so "sick note" is read as the absence it is and not as the
// "sick" inside it; one alternation, scanned left to right, so each stretch of
// text is one hit.
const ORDERED = [...WORDS].sort((a, b) => b.w.length - a.w.length);
const MATCHER = new RegExp(
  `(?<!${LETTER})(?:${ORDERED.map((e, i) => `(?<e${i}>${patternOf(e.w)})`).join("|")})(?!${LETTER})`, "giu");

/**
 * Every listed word in the text, once each, in the order it first appears:
 * the word as the writer spelt it, and its class. An empty list is a pass.
 * @param {unknown} text  anything that is not a string is read as no text
 * @returns {{ word: string, cls: string }[]}
 */
export function refusedWords(text) {
  if (typeof text !== "string" || !text) return [];
  /** @type {Map<string, { word: string, cls: string }>} */
  const seen = new Map();
  for (const m of text.matchAll(MATCHER)) {
    const key = Object.keys(m.groups ?? {}).find((k) => m.groups?.[k] !== undefined);
    if (!key) continue;
    const entry = ORDERED[Number(key.slice(1))];
    const word = m[0].replace(/\s+/g, " ");
    if (!seen.has(word.toLowerCase())) seen.set(word.toLowerCase(), { word, cls: entry.cls });
  }
  return [...seen.values()];
}

/** One sentence per class (§3.4). */
export const CLASS_SENTENCE = Object.freeze({
  health: "A boy's health is not for it.",
  absence: "Why a boy is not playing is not for it.",
  discipline: "A boy's conduct is not for it.",
  derisive: "The side reads this about a team-mate.",
});

/** "a", "a and b", "a, b and c" */
const listed = (/** @type {string[]} */ xs) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * The refusal, in words (§3.4): every refused word named, one sentence for
 * each class hit, and what to do. For the writer's screen and nobody else's.
 * @param {{ word: string, cls: string }[]} hits  refusedWords()'s answer
 * @returns {string | null}  null when there is nothing to refuse
 */
export function refusalMessage(hits) {
  if (!hits?.length) return null;
  const classes = CLASSES.filter((c) => hits.some((h) => h.cls === c));
  return [
    `This can't go to the side with ${listed(hits.map((h) => h.word))} in it.`,
    "A plan is read by every boy in the side and their parents.",
    ...classes.map((c) => CLASS_SENTENCE[/** @type {keyof typeof CLASS_SENTENCE} */ (c)]),
    "Change the words and send again.",
  ].join(" ");
}

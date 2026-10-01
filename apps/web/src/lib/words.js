/**
 * The nouns a family or pupil screen uses, from the tenant and the sport —
 * never from the code (step 4 G15, docs/design/STEP4_parent_pupil.md §7).
 *
 * A school's junior section, a club, an academy, a provincial programme and a
 * union are all `school.kind` (db/00); a pupil at a club is a player; a
 * guardian who is not a parent is a guardian. The bar's four labels ("Home ·
 * Matches · Notices · Family", "Home · Matches · Passport · Me") read the same
 * everywhere (§9 Q11) and are not here; the nouns inside the screens are.
 *
 * Presentation only. Nothing here is a fact about a child, and nothing is
 * decided by it.
 */

/** school.kind (db/00's CHECK list) → the word for the place, as a person there says it. */
const PLACE = Object.freeze({
  school:      "school",
  club:        "club",
  academy:     "academy",
  union:       "union",
  federation:  "federation",
  league:      "league",
  association: "association",
});

/** A sport's own word for a fixture and for one appearance in it. */
const SPORT = Object.freeze({
  cricket:   { match: "match", side: "side", record: "cricket record" },
  rugby:     { match: "match", side: "side", record: "rugby record" },
  hockey:    { match: "match", side: "team", record: "hockey record" },
  netball:   { match: "match", side: "team", record: "netball record" },
  football:  { match: "match", side: "team", record: "football record" },
  athletics: { match: "meeting", side: "team", record: "athletics record" },
  swimming:  { match: "gala", side: "team", record: "swimming record" },
});

/**
 * @param {{ kind?: string | null, sport?: string | null, relationship?: string | null }} [of]
 *   `kind` is school.kind, `sport` a sport code, `relationship` the link's own
 *   (assignment_subject.relationship) when the words are about a guardian.
 */
export function tenantWords({ kind = null, sport = null, relationship = null } = {}) {
  const place = PLACE[kind ?? "school"] ?? "school";
  const atSchool = place === "school";
  const s = SPORT[sport ?? "cricket"] ?? { match: "match", side: "team", record: "record" };
  return {
    place,                                           // "school", "club", "academy"…
    Place: place[0].toUpperCase() + place.slice(1),
    member: atSchool ? "pupil" : "player",           // the child, as the place calls him
    Member: atSchool ? "Pupil" : "Player",
    guardian: relationship && relationship !== "parent" ? "guardian" : "parent",
    match: s.match,
    side: s.side,
    record: s.record,
  };
}

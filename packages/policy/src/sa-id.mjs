/**
 * SCRBRD — the South African ID number, and the date of birth inside it.
 *
 * An SA ID number is not an opaque string. It is thirteen digits with meaning:
 *
 *     YYMMDD  SSSS  C  A  Z
 *     └────┘  └──┘  │  │  └─ Luhn check digit over the first twelve
 *       │      │    │  └──── historically a race classification; always 8 now
 *       │      │    └─────── citizenship: 0 South African, 1 permanent resident
 *       │      └──────────── sequence, and it encodes sex: 0000-4999 female,
 *       │                    5000-9999 male
 *       └─────────────────── the date of birth
 *
 * WHY THIS MODULE EXISTS. `db/00_schema_core.sql` says of player.id_number:
 * "Format is checked but the number is NOT validated against its Luhn digit
 * here … Validate on the way in, store what the school gives you." Nothing on
 * the way in did. The database checked thirteen digits and no more, so a
 * transposed pair — the single most common way a number is mistyped off a
 * form — was accepted silently, and the date of birth typed beside it was
 * never compared against the one the number already contained.
 *
 * That comparison is the point. A date of birth and an ID number are two
 * statements of the SAME fact, so a school that supplies both has, without
 * meaning to, handed over a checkable claim. Age here is not decoration: it
 * decides which side a boy may be picked for, when a guardian's access ends,
 * and whether a bowler falls under the fast-bowling directive. Catching a
 * wrong birthday at the moment it is typed is worth more than every downstream
 * screen that would otherwise quietly compute from it.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not refuse a number whose check digit
 * fails — it REPORTS that, and the caller decides. The schema's reasoning
 * holds: a constraint that rejects a real child's real number because it was
 * mistyped upstream blocks a registration at the worst possible moment. So the
 * write paths refuse a MISMATCH between the number and the date (two sources
 * disagreeing is a question somebody must answer) while a bad check digit is
 * surfaced for a human to look at.
 */

/** Digits only, and exactly thirteen of them. */
const WELL_FORMED = /^[0-9]{13}$/;

/**
 * The Luhn check digit over the first twelve digits.
 *
 * Standard Luhn, right to left over the body, doubling every second digit and
 * casting out nines. Kept as its own function so the tests can check the
 * algorithm against known-good numbers rather than only through a validator
 * that might be wrong in the same direction twice.
 */
export function luhnCheckDigit(body) {
  let sum = 0;
  let double = true;                       // the rightmost body digit doubles
  for (let i = body.length - 1; i >= 0; i--, double = !double) {
    let d = body.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return null;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * The century a two-digit year belongs to, resolved by plausibility.
 *
 * `YY` of 09 is 2009 for a schoolboy and 1909 for nobody alive. The rule is
 * the ordinary one: take the reading that lands inside a living human's
 * lifetime, preferring the most recent. A person of 120 is not represented
 * here and does not need to be.
 *
 * Deliberately takes `today` rather than reading the clock, so the boundary
 * cases are testable rather than only reachable on the right calendar day.
 */
export function resolveCentury(yy, mm, dd, today = new Date()) {
  const thisYear = today.getUTCFullYear();
  for (const century of [2000, 1900]) {
    const year = century + yy;
    if (year > thisYear) continue;                 // not born yet
    if (thisYear - year > 120) continue;           // nobody is that old
    const d = new Date(Date.UTC(year, mm - 1, dd));
    // Rejects 31 February and friends: Date rolls them forward, so a date
    // that survives the round trip is one that genuinely exists.
    if (d.getUTCFullYear() === year && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd) return d;
  }
  return null;
}

/**
 * Read an ID number.
 *
 * @returns {{ok: boolean, reason?: string, born?: Date, sex?: "male"|"female",
 *             citizen?: boolean, checkDigitValid?: boolean}}
 *
 * `ok` false means the number could not be read at all — the wrong length, a
 * non-digit, or six leading digits that are not a date anybody could have been
 * born on. A number that reads perfectly well but whose check digit does not
 * match comes back ok:true with checkDigitValid:false, because it is still a
 * number a person can act on and the caller is the one who decides.
 */
export function readSaId(value, today = new Date()) {
  const s = String(value ?? "").trim();
  if (!WELL_FORMED.test(s)) return { ok: false, reason: "must be thirteen digits" };

  const yy = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  const born = resolveCentury(yy, mm, dd, today);
  if (!born) return { ok: false, reason: "the first six digits are not a date of birth" };

  return {
    ok: true,
    born,
    sex: Number(s.slice(6, 10)) >= 5000 ? "male" : "female",
    citizen: s[10] === "0",
    checkDigitValid: luhnCheckDigit(s.slice(0, 12)) === Number(s[12]),
  };
}

/** The date of birth an ID number carries, as YYYY-MM-DD, or null. */
export function bornFromSaId(value, today = new Date()) {
  const r = readSaId(value, today);
  return r.ok ? r.born.toISOString().slice(0, 10) : null;
}

/**
 * Does a typed date of birth agree with the one inside the ID number?
 *
 * The answer that matters on a write path. Either side being absent is not a
 * disagreement — it is simply nothing to check — so this reports `agree: true`
 * with `checked: false`, and requiring the fields at all is a separate
 * decision the caller makes.
 */
export function bornAgreesWithSaId(born, idNumber, today = new Date()) {
  if (born == null || born === "" || idNumber == null || idNumber === "") {
    return { checked: false, agree: true };
  }
  const fromId = bornFromSaId(idNumber, today);
  if (fromId == null) return { checked: false, agree: true, unreadable: true };
  const typed = String(born).slice(0, 10);
  return { checked: true, agree: typed === fromId, fromId, typed };
}

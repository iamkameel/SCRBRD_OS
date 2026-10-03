/**
 * Bulk import, which is a thousand ordinary writes and not a bypass.
 *
 * THE RULE THIS WHOLE FILE EXISTS TO KEEP: every row goes in under the
 * CALLER'S OWN PRINCIPAL, through the same row-level policy a form would meet.
 * A school administrator importing a roster that names another school's id
 * gets refused on that row, by the same predicate that refuses them on the
 * screen. There is no service account here and no elevated path, because the
 * import is exactly where somebody would reach for one.
 *
 * DRY RUN IS THE DEFAULT, and it is the difference between a usable tool and a
 * dangerous one. A four-hundred-row roster will have three typos in it. The
 * person sending it needs all three at once, with the line numbers from their
 * own spreadsheet, before anything is written — not one per attempt, and never
 * a half-imported school.
 *
 * A COMMIT IS ALL OR NOTHING. One transaction, and any refused row rolls the
 * whole file back. A partially imported roster is worse than none: nobody can
 * tell which boys made it, and running the file again duplicates the ones that
 * did.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { resolveBirthDate, BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";
import { parseCsv, mapRows, asText, asDate, asInt, asOneOf, asEmail, asPhone } from "./csv.mjs";
/** @import { Pool, Db, Handler, ApiRequest, RawResponse, DressedError } from "../api-types.mjs" */
/** @import { ColumnSpec, RowError } from "./csv.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs).

/**
 * One kind of file a school may send. Row values are `any`: they are what the
 * column parsers returned, keyed by column.
 * @typedef {object} ImportDef
 * @property {string} table
 * @property {string} label
 * @property {boolean} [needsSchool]
 * @property {Record<string, ColumnSpec>} spec
 * @property {string[]} template
 * @property {string} [example]
 * @property {string} find
 * @property {string} [insert]
 * @property {string} [update]
 * @property {(school: string | undefined, v: Record<string, any>) => unknown[]} [params]
 * @property {(v: Record<string, any>, existing: any) => ({ ok: true, warning?: string, column?: undefined, message?: undefined }
 *                                                          | { ok: false, column: string, message: string, warning?: undefined })} [resolve]
 * @property {string} [mayImport]  SQL answering one boolean `ok` for the school ($1): may this
 *                                 caller import this kind at all. Asked once, before any row.
 * @property {(client: Db, school: string | undefined, v: Record<string, any>,
 *             file: Map<string, any>, line: number) => Promise<RowOutcome>} [apply]
 *                                 One row, written its own way. Used instead of find/insert/update.
 */

/**
 * What one row came to. `did` is what was (or, on a dry run, would be) done.
 * @typedef {{ ok: true, did: "insert" | "update" | "unchanged", warning?: RowError }
 *         | { ok: false, column: string | null, message: string }} RowOutcome
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The link vocabulary for a guardian (assignment_subject.relationship, db/00), less 'self' and 'enquiry'. */
export const GUARDIAN_RELATIONSHIPS = Object.freeze(["parent", "guardian", "grandparent", "sibling", "other"]);

/** A name as the import compares two: trimmed, runs of spaces closed, case ignored. */
const norm = (/** @type {unknown} */ s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** enrol_person()'s refusals (db/08, db/62), in the office's words. */
/** @type {Record<string, string>} */
export const ENROL_REFUSAL = {
  not_permitted: "not permitted at this school",
  player_is_an_adult: "he is eighteen; guardian access ends at eighteen and a new link is never made for an adult",
  player_date_of_birth_required: "his date of birth is not on his record; add it in Squad, then import this line",
  email_belongs_to_another_school: "this email is an account at another school",
  email_invalid: "does not look like an email address",
  name_required: "guardian_name is required",
  player_not_at_that_school: "no player at this school is called that",
  no_such_player: "no player at this school is called that",
};
/** @type {Record<string, string>} */
const ENROL_REFUSAL_COLUMN = {
  player_is_an_adult: "player_full_name", player_date_of_birth_required: "player_full_name",
  player_not_at_that_school: "player_full_name", no_such_player: "player_full_name",
  email_belongs_to_another_school: "guardian_email", email_invalid: "guardian_email",
  name_required: "guardian_name",
};

/**
 * What may be imported, and how each column is read.
 *
 * A DECLARATION RATHER THAN A HANDLER PER KIND, so adding fixtures later is a
 * spec and a template and no new code path — and so the columns a school is
 * told to send are the columns the parser actually reads. Two lists would
 * drift, and the symptom is a support conversation about a column that is
 * spelled right.
 *
 * Note what is NOT here: id_number, address, guardian, height, weight. Those
 * are on the player table and importable in principle, and they are left out
 * of the first cut deliberately — a school's first bulk load should be the
 * roster, not every sensitive field about four hundred children in one
 * unvalidated file. Adding them is a decision with a name on it.
 */
/** @type {Record<string, ImportDef>} */
export const IMPORTS = {
  players: {
    table: "player",
    label: "Players",
    // The school is NOT a column. It comes from the request, once, and the
    // policy checks it once — a per-row school would let one file write into
    // several tenants and would make the refusal message per-row noise.
    needsSchool: true,
    spec: {
      full_name:     { required: true, parse: asText(120) },
      team_code:     { parse: asText(8) },
      squad_no:      { parse: asInt({ min: 1, max: 99 }) },
      // The vocabulary the rest of the system uses, not a plausible-looking
      // one. The first version of this line said "wicketkeeper", which no
      // other file in the repository has ever said — the schema comment and
      // the seeded rows both say "keeper", and a round trip through export and
      // import reported every keeper in the school as invalid. An import is
      // the one place that reads a vocabulary back in, so it is the place that
      // discovers when the vocabulary was guessed.
      playing_role:  { parse: asOneOf(["batter", "bowler", "allrounder", "keeper"]) },
      // Closed, the same way playing_role is: R/L is what every screen that
      // renders a hand or an arm compares against, and 'RHB'/'right-handed'
      // read plausibly here and broke every one of those comparisons
      // silently once before. asOneOf fails loud on a spreadsheet's own
      // spelling rather than guessing at it.
      batting_style: { parse: asOneOf(["R", "L"]) },
      bowling_arm:   { parse: asOneOf(["R", "L"]) },
      // Pace or spin, not the arm — a left-arm quick and a left-arm spinner
      // share bowling_arm and differ only here.
      bowling_style: { parse: asOneOf(["F", "M", "S"]) },
      // A date of birth is REQUIRED for a new player, and either column can
      // supply it — an SA ID number's first six digits are the birthday, so a
      // school working from a class list that carries ID numbers does not have
      // to type it twice. Enforced per row below, not here, because the rule
      // is "one of these two", which a per-column `required` cannot say.
      born:          { parse: asDate },
      id_number:     { parse: asText(20) },
      email:         { parse: asEmail },
      phone:         { parse: asPhone },
      hometown:      { parse: asText(80) },
    },
    // The template a school is given. Exactly the columns above, in an order
    // that reads like a team sheet rather than like a table definition.
    template: ["full_name", "team_code", "squad_no", "playing_role",
               "batting_style", "bowling_arm", "bowling_style", "born", "id_number",
               "email", "phone", "hometown"],
    // One value per template column, each one the parser accepts. The route's
    // old fallback row had ten values for twelve columns and spelled the hand
    // "right", so a school that copied it got four errors on its first line.
    // csv.test.mjs reads this row through the spec, so the two cannot drift.
    example: "A Botha,1XI,7,batter,R,R,M,2011-04-07,,,,",
    /**
     * One row, matched on the name — and refusing to guess when it cannot.
     *
     * A school's spreadsheet has no SCRBRD id in it; that is the point of an
     * import. So the only key available is the name, and re-running a file has
     * to update the boys already there rather than duplicate them.
     *
     * WHAT THIS DOES NOT DO IS ADD A UNIQUE CONSTRAINT ON THE NAME. That was
     * the first version and it is a claim about the world that is not true:
     * two boys called A Botha at one school is unusual and it happens, and a
     * schema that forbade it would make the second one unenterable by any
     * route — a bulk-import convenience deciding who may exist.
     *
     * Instead the match is explicit and ambiguity is an ERROR ON THAT ROW.
     * Nought found is an insert, one found is an update, two found is a
     * refusal naming the problem: the import cannot tell them apart and
     * neither could a person reading the file.
     */
    // `born` comes back too, because the birth-date rule differs between an
    // insert and an update: a file that carries only names and teams must not
    // be refused for a boy whose birthday was typed in by hand last term.
    find: `select id, born from player
            where school_id = $1 and lower(btrim(full_name)) = lower(btrim($2))`,
    insert: `insert into player (school_id, full_name, team_code, squad_no, playing_role,
                                 batting_style, bowling_arm, bowling_style, born, id_number,
                                 email, phone, hometown)
             values ($1, btrim($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             returning id`,
    // coalesce on every column, so a file that carries only names and teams
    // does not blank the birthdays somebody typed in by hand last term. A
    // blank cell in a CSV means "not in this file", never "delete this".
    update: `update player
                -- full_name and school_id are both referenced deliberately.
                -- Postgres infers a parameter's type from its use, so an
                -- UPDATE that took the same eleven parameters and mentioned
                -- only nine of them failed with "could not determine data
                -- type of parameter $1" — on the SECOND run of a file, which
                -- is the run a school actually does.
                --
                -- Both earn their place. Rewriting full_name to the file's
                -- spelling is what makes the import canonical: the match is on
                -- the lowered, trimmed name, so "a botha" and "A Botha" find
                -- the same boy and the file decides how it is written. And the
                -- school_id in the WHERE is a tenancy guard on a statement
                -- that would otherwise trust an id from a lookup.
                set full_name = btrim($2),
                    team_code = coalesce($3, team_code),
                    squad_no = coalesce($4, squad_no),
                    playing_role = coalesce($5, playing_role),
                    batting_style = coalesce($6, batting_style),
                    bowling_arm = coalesce($7, bowling_arm),
                    bowling_style = coalesce($8, bowling_style),
                    born = coalesce($9, born),
                    id_number = coalesce($10, id_number),
                    email = coalesce($11, email),
                    phone = coalesce($12, phone),
                    hometown = coalesce($13, hometown)
              where id = $14 and school_id = $1 returning id`,
    params: (school, v) => [school, v.full_name, v.team_code, v.squad_no, v.playing_role,
                            v.batting_style, v.bowling_arm, v.bowling_style, v.born, v.id_number,
                            v.email, v.phone, v.hometown],

    /**
     * The one rule a per-column spec cannot express: born OR id_number, and
     * they must agree when both arrive.
     *
     * Per row rather than per file, so a load of four hundred children reports
     * "line 84: a date of birth is required" for the twelve rows missing one
     * and commits nothing — the office fixes twelve cells rather than being
     * told the file is bad.
     *
     * `existing` is the row already on the books, or null. A boy who already
     * has a birthday is not re-asked for it: the update coalesces, so a file
     * carrying only names and teams is a legitimate thing to send.
     */
    resolve: (v, existing) => {
      const dob = resolveBirthDate({ born: v.born, idNumber: v.id_number });
      if (!dob.ok) {
        if (dob.reason === "date_of_birth_required" && existing?.born) return { ok: true };
        return { ok: false, column: dob.field,
                 message: BIRTH_DATE_MESSAGE[dob.reason] ?? dob.reason };
      }
      v.born = dob.born;
      v.id_number = dob.idNumber;
      return { ok: true, warning: dob.warning };
    },
  },

  /**
   * Parents, against the boys already loaded (PILOT_LOAD.md gap 3). Kameel's
   * decision, 3 October 2026: the office vouches for every parent–child link
   * in the file, exactly as it vouches for one typed on Settings → People.
   *
   * SO EACH ROW IS POST /api/users, NOT A SHORTCUT ROUND IT. The write is
   * enrol_person(email, name, 'guardian', school, null, child) under the
   * importer's own identity: the same capability check (user.role.assign at
   * this school, and app_may_grant('guardian')), the same majority and
   * date-of-birth refusals, the same link — verified by the person importing,
   * consent pending, ended at eighteen where he has left school — and the
   * same record of who decided it (role_request.decided_by, the link's
   * verified_by and created_by). Consent stays the family's to give.
   *
   * THE ROLE IS NOT A COLUMN. Every row grants `guardian` and nothing else; a
   * file carrying a `role` column has it reported as a column not read.
   *
   * What the import adds to the one-at-a-time path is only what a file needs
   * and a screen does not: the child found by name (the players import's own
   * rule, and two boys of one name refused rather than guessed), the same
   * line twice refused, one email under two names refused, an email that is
   * already somebody else's account (another name, or a pupil's own) refused,
   * and a link already in place left alone, so the file can be sent again.
   *
   * A CHILD UNDER A NEVER-PUBLIC MARK, or the subject of a safeguarding
   * concern, is linked exactly as the one-at-a-time path links him: enrolment
   * reads neither (the mark governs public pages, db/47; a concern is the
   * DSO's, db/57), and the importer, which may not read them either, does not
   * learn from a refusal that they exist.
   */
  guardians: {
    table: "assignment_subject",
    label: "Guardians",
    needsSchool: true,
    spec: {
      player_full_name: { required: true, parse: asText(120) },
      guardian_name:    { required: true, parse: asText(120) },
      guardian_email:   { required: true, parse: asEmail },
      // Required, so the office says what it is vouching for rather than the
      // import assuming it. Enrolment records every link as 'parent' today
      // (decide_role_request(), db/62), so that is the one value it can
      // write truthfully; the rest of the link vocabulary (db/00) is read,
      // and refused on its line rather than recorded as something it is not.
      relationship:     { required: true, parse: asOneOf(GUARDIAN_RELATIONSHIPS) },
    },
    template: ["player_full_name", "guardian_name", "guardian_email", "relationship"],
    example: "A Botha,B Botha,b.botha@example.invalid,parent",
    // The players import's own match on the name.
    find: `select id, born from player
            where school_id = $1 and lower(btrim(full_name)) = lower(btrim($2))`,
    // enrol_person()'s own first check, asked once for the file: a coach, or
    // another school's office, is told no once rather than on every line.
    // enrol_person() asks it again on every row and remains the authority.
    mayImport: `select (app_can('user.role.assign', $1::uuid, '*',
                                '00000000-0000-0000-0000-000000000000'::uuid,
                                '00000000-0000-0000-0000-000000000000'::uuid)
                        and app_may_grant('guardian')) as ok`,
    apply: async (client, school, v, file, line) => {
      if (v.relationship !== "parent") {
        return { ok: false, column: "relationship",
          message: `enrolment records a parent link only, so a ${v.relationship} cannot be imported yet. ` +
                   "Leave this line out and raise it with Kameel." };
      }
      const email = /** @type {string} */ (v.guardian_email);
      const name = norm(v.guardian_name);

      // Within the file: the same line twice, and one email under two names.
      const pair = `${email}|${norm(v.player_full_name)}`;
      if (file.has(pair)) {
        return { ok: false, column: null, message: `the same guardian and child is on line ${file.get(pair)}` };
      }
      const named = file.get(`email:${email}`);
      if (named && named.name !== name) {
        return { ok: false, column: "guardian_email",
          message: `${email} is ${named.as}'s on line ${named.line}; one email is one person` };
      }
      file.set(pair, line);
      if (!named) file.set(`email:${email}`, { name, as: v.guardian_name, line });

      // The child, matched as the players import matches.
      const found = await client.query(IMPORTS.guardians.find, [school, v.player_full_name]);
      if (!found.rowCount) {
        return { ok: false, column: "player_full_name",
          message: `no player at this school is called ${v.player_full_name}; ` +
                   "the name has to match his row in Squad, letter for letter" };
      }
      if (/** @type {number} */ (found.rowCount) > 1) {
        return { ok: false, column: "player_full_name",
          message: `more than one player at this school is called ${v.player_full_name}; ` +
                   "the import cannot tell them apart. Link this one on Settings → People" };
      }
      const child = found.rows[0].id;

      // The account this email already opens, if the importer may see it
      // (People shows the same). One at another school is enrolment's own
      // refusal below.
      const acct = (await client.query(
        `select id, name, player_id from app_user where lower(email) = $1`, [email])).rows[0];
      if (acct?.player_id) {
        return { ok: false, column: "guardian_email",
          message: `${email} is a pupil's own account, not a guardian's` };
      }
      if (acct && norm(acct.name) !== name) {
        return { ok: false, column: "guardian_email",
          message: `${email} is already ${acct.name}'s account; one email is one person` };
      }
      if (acct) {
        // A link already in place is left as it is, so the file can be sent
        // twice. enrolment would write a second one beside it.
        const link = (await client.query(
          `select s.verification_state from assignment_subject s
             join role_assignment a on a.id = s.assignment_id
            where a.person_id = $1 and a.school_id = $2 and a.role = 'guardian' and a.active
              and s.player_id = $3 and s.verification_state in ('pending', 'verified')
              and (s.valid_until is null or s.valid_until > current_date)
            limit 1`, [acct.id, school, child])).rows[0];
        if (link?.verification_state === "verified") return { ok: true, did: "unchanged" };
        if (link) {
          return { ok: false, column: null,
            message: `${v.guardian_name} has asked to be linked to ${v.player_full_name} and is waiting; ` +
                     "verify that request on Settings → People rather than importing a second link" };
        }
      }

      const r = (await client.query(`select * from enrol_person($1, $2, 'guardian', $3, null, $4, $5)`,
        [email, v.guardian_name, school, child, "guardians import"])).rows[0];
      if (!r?.ok) {
        const reason = r?.reason || "refused";
        return { ok: false, column: ENROL_REFUSAL_COLUMN[reason] ?? null,
                 message: ENROL_REFUSAL[reason] ?? reason };
      }
      return { ok: true, did: "insert" };
    },
  },
};


/**
 * Read a file and say what would happen, or make it happen.
 *
 * Returns the same shape either way — counts, per-row errors, unknown columns —
 * so a client renders one report and the only difference is a word.
 * @param {Pool} pool @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 * @param {string | undefined} kind
 * @param {{ csv?: unknown, schoolId?: string, commit?: unknown }} body  the request body as sent
 */
export async function runImport(pool, secret, bearer, kind, { csv, schoolId, commit }) {
  const def = Object.hasOwn(IMPORTS, /** @type {string} */ (kind)) ? IMPORTS[/** @type {string} */ (kind)] : undefined;   // an absent kind finds nothing, as "undefined"
  if (!def) { const e = /** @type {DressedError} */ (new Error("unknown_import")); e.status = 404; throw e; }
  if (def.needsSchool && !(typeof schoolId === "string" && UUID.test(schoolId))) {
    const e = /** @type {DressedError} */ (new Error("school_required")); e.status = 400; throw e;
  }
  if (typeof csv !== "string" || !csv.trim()) {
    const e = /** @type {DressedError} */ (new Error("csv_required")); e.status = 400; throw e;
  }

  const parsed = parseCsv(csv);
  const { rows, errors, unknown } = mapRows(parsed, def.spec);

  // A FILE WITH ANY ERROR IS NEVER COMMITTED, even when asked. The caller
  // cannot opt into a partial load — that is the whole safety property, and
  // making it a flag would mean somebody sets the flag.

  return runAsPrincipal(pool, secret, bearer, async (client) => {
    // A kind that says who may import it asks once, before any row: a caller
    // with no authority at this school is refused the file, not every line.
    if (def.mayImport) {
      const may = (await client.query(def.mayImport, [schoolId])).rows[0];
      if (!may?.ok) { const e = /** @type {DressedError} */ (new Error("not_permitted")); e.status = 403; throw e; }
    }
    let inserted = 0, updated = 0, unchanged = 0;
    // What a kind's apply() remembers across the file's rows.
    /** @type {Map<string, any>} */
    const file = new Map();
    /** @type {RowError[]} */
    const refused = [];
    // Not refusals: a row that went in and is worth a second look. Kept apart
    // from `refused` so a warning can never be mistaken for a rejected row.
    /** @type {RowError[]} */
    const warnings = [];

    await client.query("SAVEPOINT bulk");
    for (const { line, values } of rows) {
      try {
        if (def.apply) {
          const out = await def.apply(client, schoolId, values, file, line);
          if (!out.ok) refused.push({ line, column: out.column, message: out.message });
          else {
            if (out.warning) warnings.push(out.warning);
            if (out.did === "insert") inserted += 1;
            else if (out.did === "update") updated += 1;
            else unchanged += 1;
          }
          await client.query("RELEASE SAVEPOINT bulk");
          await client.query("SAVEPOINT bulk");
          continue;
        }
        // The lookup runs under the caller's own row-level security too, so a
        // name they may not read comes back as "none found" and they attempt
        // an insert — which the INSERT policy then refuses. That is the right
        // order: the refusal comes from the policy, and this path never learns
        // whether the row it could not see exists.
        const found = await client.query(def.find, [schoolId, values.full_name]);
        // A SELECT's command tag always carries a count.
        if (/** @type {number} */ (found.rowCount) > 1) {
          refused.push({ line, column: "full_name",
            message: `more than one player at this school is called ${values.full_name}; ` +
                     "the import cannot tell them apart" });
          continue;
        }
        // The per-row rule runs HERE rather than at parse time, because it
        // needs to know whether this boy is already on the books: an update
        // coalesces, so a file carrying only names must not be refused for a
        // birthday that was typed in last term.
        //
        // It mutates `values`, so def.params() runs only afterwards — a copy
        // taken before the birthday was resolved from an ID number would
        // write the row without one.
        const checked = def.resolve ? def.resolve(values, found.rows[0] ?? null) : /** @type {{ ok: true, warning?: undefined }} */ ({ ok: true });
        if (!checked.ok) {
          refused.push({ line, column: checked.column, message: checked.message });
          continue;
        }
        if (checked.warning) {
          warnings.push({ line, column: "id_number",
                          message: BIRTH_DATE_MESSAGE[checked.warning] ?? checked.warning });
        }
        const resolved = /** @type {NonNullable<ImportDef["params"]>} */ (def.params)(schoolId, values);
        const r = found.rowCount === 1
          ? await client.query(/** @type {string} */ (def.update), [...resolved, found.rows[0].id])
          : await client.query(/** @type {string} */ (def.insert), resolved);
        if (!r.rowCount) {
          // No row and no error is the policy declining silently.
          refused.push({ line, column: null, message: "not permitted at this school" });
        } else if (found.rowCount === 1) updated += 1;
        else inserted += 1;
      } catch (/** @type {any} */ e) {
        // 42501 is the policy; everything else is a constraint the CSV could
        // not know about. Both are reported against the line in their file.
        refused.push({ line, column: null,
          message: e.code === "42501" ? "not permitted at this school"
                 : (e.detail || e.message || "refused") });
        // The savepoint has to be rolled back before the transaction will
        // accept another statement — without this, one bad row aborts the rest
        // and every subsequent line reports the same useless error.
        await client.query("ROLLBACK TO SAVEPOINT bulk");
      }
      await client.query("RELEASE SAVEPOINT bulk").catch(() => {});
      await client.query("SAVEPOINT bulk");
    }

    const allErrors = [...errors, ...refused];
    const committed = commit === true && allErrors.length === 0;
    // The dry run and a failed commit both unwind. runAsPrincipal owns the
    // outer transaction, so raising is how this refuses to keep the writes —
    // and a report has to come back either way, so the error carries it.
    if (!committed) {
      const e = /** @type {Error & { report?: unknown, rollback?: boolean }} */ (new Error("dry_run"));
      e.report = { kind, committed: false, rows: rows.length, wouldInsert: inserted,
                   wouldUpdate: updated, unchanged, errors: allErrors, unknownColumns: unknown,
                   warnings, clean: allErrors.length === 0 };
      e.rollback = true;
      throw e;
    }
    return { kind, committed: true, rows: rows.length, inserted, updated, unchanged,
             errors: [], unknownColumns: unknown, warnings, clean: true };
  }).catch((e) => {
    if (e?.rollback && e.report) return e.report;
    throw e;
  });
}

/**
 * @param {{ pool: Pool, secret: string }} deps
 * @returns {{ run: Handler, template: (req: ApiRequest, res: RawResponse) => unknown }}
 */
export function importRoutes({ pool, secret }) {
  return {
    // POST /import/:kind { csv, schoolId, commit }
    run: async (req, res) => {
      try {
        const out = await runImport(pool, secret, req.headers?.authorization,
                                    req.params.id, req.body || {});
        // 200 for a dry run as well as a commit: a report is a successful
        // answer to "what would this do", and a 4xx would make a client treat
        // a perfectly good validation pass as a failure.
        res.json(out);
      } catch (/** @type {any} */ e) {
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },

    // GET /import/:kind/template — the columns to fill in, as a file.
    //
    // Given rather than documented. A school that is told to send
    // "full_name, team_code, born" will send "Name, Team, DOB", and the
    // support conversation that follows costs more than this route.
    template: async (req, res) => {
      const id = String(req.params.id);
      const def = Object.hasOwn(IMPORTS, id) ? IMPORTS[id] : undefined;   // an absent id finds nothing, as "undefined"
      if (!def) return res.status(404).json({ error: "unknown_import" });
      const name = `scrbrd-${req.params.id}-template.csv`;
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      });
      // A header and one example row. An empty template teaches nothing about
      // the date format, which is the field schools get wrong.
      res.end("﻿" + def.template.join(",") + "\r\n" +
              (def.example ?? "") + "\r\n");
    },
  };
}

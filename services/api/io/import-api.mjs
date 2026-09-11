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
import { parseCsv, mapRows, asText, asDate, asInt, asOneOf, asEmail, asPhone } from "./csv.mjs";

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
      // Free text, deliberately. Nothing in this codebase has ever written a
      // batting_style, so there is no vocabulary to agree with — and inventing
      // one here would repeat the mistake above with nothing to catch it.
      batting_style: { parse: asText(20) },
      bowling_style: { parse: asText(40) },
      born:          { parse: asDate },
      email:         { parse: asEmail },
      phone:         { parse: asPhone },
      hometown:      { parse: asText(80) },
    },
    // The template a school is given. Exactly the columns above, in an order
    // that reads like a team sheet rather than like a table definition.
    template: ["full_name", "team_code", "squad_no", "playing_role",
               "batting_style", "bowling_style", "born", "email", "phone", "hometown"],
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
    find: `select id from player
            where school_id = $1 and lower(btrim(full_name)) = lower(btrim($2))`,
    insert: `insert into player (school_id, full_name, team_code, squad_no, playing_role,
                                 batting_style, bowling_style, born, email, phone, hometown)
             values ($1, btrim($2), $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
                    bowling_style = coalesce($7, bowling_style),
                    born = coalesce($8, born),
                    email = coalesce($9, email),
                    phone = coalesce($10, phone),
                    hometown = coalesce($11, hometown)
              where id = $12 and school_id = $1 returning id`,
    params: (school, v) => [school, v.full_name, v.team_code, v.squad_no, v.playing_role,
                            v.batting_style, v.bowling_style, v.born, v.email, v.phone, v.hometown],
  },
};

/**
 * Read a file and say what would happen, or make it happen.
 *
 * Returns the same shape either way — counts, per-row errors, unknown columns —
 * so a client renders one report and the only difference is a word.
 */
export async function runImport(pool, secret, bearer, kind, { csv, schoolId, commit }) {
  const def = IMPORTS[kind];
  if (!def) { const e = new Error("unknown_import"); e.status = 404; throw e; }
  if (def.needsSchool && !schoolId) {
    const e = new Error("school_required"); e.status = 400; throw e;
  }
  if (typeof csv !== "string" || !csv.trim()) {
    const e = new Error("csv_required"); e.status = 400; throw e;
  }

  const parsed = parseCsv(csv);
  const { rows, errors, unknown } = mapRows(parsed, def.spec);

  // A FILE WITH ANY ERROR IS NEVER COMMITTED, even when asked. The caller
  // cannot opt into a partial load — that is the whole safety property, and
  // making it a flag would mean somebody sets the flag.
  const clean = errors.length === 0;

  return runAsPrincipal(pool, secret, bearer, async (client) => {
    let inserted = 0, updated = 0;
    const refused = [];

    await client.query("SAVEPOINT bulk");
    for (const { line, values } of rows) {
      try {
        const p = def.params(schoolId, values);
        // The lookup runs under the caller's own row-level security too, so a
        // name they may not read comes back as "none found" and they attempt
        // an insert — which the INSERT policy then refuses. That is the right
        // order: the refusal comes from the policy, and this path never learns
        // whether the row it could not see exists.
        const found = await client.query(def.find, [schoolId, values.full_name]);
        if (found.rowCount > 1) {
          refused.push({ line, column: "full_name",
            message: `more than one player at this school is called ${values.full_name}; ` +
                     "the import cannot tell them apart" });
          continue;
        }
        const r = found.rowCount === 1
          ? await client.query(def.update, [...p, found.rows[0].id])
          : await client.query(def.insert, p);
        if (!r.rowCount) {
          // No row and no error is the policy declining silently.
          refused.push({ line, column: null, message: "not permitted at this school" });
        } else if (found.rowCount === 1) updated += 1;
        else inserted += 1;
      } catch (e) {
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
      const e = new Error("dry_run");
      e.report = { kind, committed: false, rows: rows.length, wouldInsert: inserted,
                   wouldUpdate: updated, errors: allErrors, unknownColumns: unknown,
                   clean: allErrors.length === 0 };
      e.rollback = true;
      throw e;
    }
    return { kind, committed: true, rows: rows.length, inserted, updated,
             errors: [], unknownColumns: unknown, clean: true };
  }).catch((e) => {
    if (e?.rollback && e.report) return e.report;
    throw e;
  });
}

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
      } catch (e) {
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
      const def = IMPORTS[req.params.id];
      if (!def) return res.status(404).json({ error: "unknown_import" });
      const name = `scrbrd-${req.params.id}-template.csv`;
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      });
      // A header and one example row. An empty template teaches nothing about
      // the date format, which is the field schools get wrong.
      res.end("﻿" + def.template.join(",") + "\r\n" +
              (def.example ?? "A Botha,1XI,7,batter,right,right-arm medium,2011-04-07,,,Hilton") +
              "\r\n");
    },
  };
}

/**
 * What `--reset-objects` may drop, and the statement that drops it (GA-I02).
 *
 * The teardown used to drop every view, table, routine and enum in `public`
 * that did not belong to an extension — on a managed host, anything any
 * other application had put there too. A filter on owner would not save
 * them: on Supabase everything in `public` is owned by `postgres`.
 *
 * So it drops by NAME, from an allowlist read out of this repository's own
 * migrations: every table, view, routine, type and sequence a db/NN_*.sql
 * file CREATEs, and the migrator's ledger. An object that is not named there
 * is not ours, and survives. tools/migrate.mjs (--reset-objects) and
 * tools/bundle-sql.mjs (section 1 of scrbrd-supabase-rebuild.sql) both take
 * the statement from here, so the two cannot drift.
 *
 * Read from the files rather than kept as a list here, for the reason the
 * catalogue version gave: a hand-kept list is wrong the first time somebody
 * adds a table and does not update it. A name the reader misses fails LOUDLY
 * — the object is left behind and the next migration's CREATE refuses — and
 * tools/smoke-reset-objects.mjs fails first, by checking that a reset leaves
 * nothing of ours behind.
 *
 * What a name cannot tell apart: another application's object with exactly
 * the name of one of ours (a `player` table of its own) is taken for ours.
 * Routines go by name with every overload. Nothing short of a separate
 * schema closes that, and the rule above still stands: neither reset ever
 * runs against a database holding a real record.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The migrations, as tools/migrate.mjs selects them. */
export const migrationFiles = (/** @type {string} */ dbDir) =>
  readdirSync(dbDir).filter((f) => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort();

// An identifier, optionally schema-qualified, quoted or bare.
const ID = String.raw`((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)`;
const KINDS = /** @type {const} */ ({
  // TEMP and TEMPORARY tables are not matched: nothing persists to drop.
  tables: new RegExp(String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${ID}`, "gi"),
  views: new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+|RECURSIVE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?${ID}`, "gi"),
  routines: new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|AGGREGATE)\s+${ID}\s*\(`, "gi"),
  types: new RegExp(String.raw`\bCREATE\s+(?:TYPE|DOMAIN)\s+${ID}`, "gi"),
  sequences: new RegExp(String.raw`\bCREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?${ID}`, "gi"),
  // A rename makes a name of ours that no CREATE spelled.
  renamed: new RegExp(String.raw`\bALTER\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TYPE|DOMAIN|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?[^;]*?\bRENAME\s+TO\s+${ID}`, "gi"),
});

/** `public.foo` → foo; `"Foo"` → Foo; bare → lower case; another schema → null. */
const nameOf = (/** @type {string} */ raw) => {
  const parts = raw.split(/\s*\.\s*/);
  if (parts.length === 2 && parts[0].replace(/"/g, "").toLowerCase() !== "public") return null;
  const n = parts[parts.length - 1];
  return n.startsWith('"') ? n.slice(1, -1) : n.toLowerCase();
};

/** Comments out, so a sentence that mentions CREATE TABLE names nothing. */
const stripComments = (/** @type {string} */ sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/**
 * Every object this repository's migrations create in `public`, by kind.
 * @param {string} dbDir
 * @returns {{ tables: string[], views: string[], routines: string[], types: string[], sequences: string[] }}
 */
export function projectObjects(dbDir) {
  /** @type {Record<string, Set<string>>} */
  const found = { tables: new Set(["schema_migration"]), views: new Set(), routines: new Set(), types: new Set(), sequences: new Set() };
  for (const f of migrationFiles(dbDir)) {
    const sql = stripComments(readFileSync(join(dbDir, f), "utf8"));
    for (const [kind, re] of Object.entries(KINDS)) {
      for (const m of sql.matchAll(re)) {
        if (kind === "renamed") {
          const target = /VIEW/i.test(m[1]) ? "views" : /FUNCTION|PROCEDURE/i.test(m[1]) ? "routines"
            : /TYPE|DOMAIN/i.test(m[1]) ? "types" : /SEQUENCE/i.test(m[1]) ? "sequences" : "tables";
          const n = nameOf(m[2]);
          if (n) found[target].add(n);
          continue;
        }
        const n = nameOf(m[1]);
        if (n) found[kind].add(n);
      }
    }
  }
  const sorted = (/** @type {Set<string>} */ s) => [...s].sort();
  return { tables: sorted(found.tables), views: sorted(found.views), routines: sorted(found.routines),
           types: sorted(found.types), sequences: sorted(found.sequences) };
}

const arr = (/** @type {string[]} */ xs) => xs.length
  ? `ARRAY[\n    ${xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(", ").replace(/(.{1,96})(, |$)/g, "$1$2\n    ").trimEnd()}\n  ]::text[]`
  : "'{}'::text[]";

/**
 * The teardown, as one DO block: drops, in `public`, exactly the objects
 * named, and never one that belongs to an extension.
 * @param {ReturnType<typeof projectObjects>} o
 */
export function teardownSql(o) {
  // pg_depend with deptype 'e' is "this object belongs to an extension".
  // Excluding it is what keeps pgcrypto, pgjwt and friends alive.
  const notExtension = (/** @type {string} */ oid) => `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = ${oid} AND d.deptype = 'e')`;
  return `DO $reset_objects$
DECLARE
  r record; rt text; sigs text[]; n int := 0;
  -- This repository's objects, read from its migrations (tools/reset-objects.mjs).
  -- Anything in public NOT named here is somebody else's and is left alone.
  ours_tables    text[] := ${arr(o.tables)};
  ours_views     text[] := ${arr(o.views)};
  ours_routines  text[] := ${arr(o.routines)};
  ours_types     text[] := ${arr(o.types)};
  ours_sequences text[] := ${arr(o.sequences)};
  foreign_deps   text;
BEGIN
  -- FIRST, A REFUSAL. CASCADE on one of ours would take with it anything of
  -- somebody else's built on it: their view over our table, their function
  -- taking our type, their table with a column of our enum or a foreign key
  -- into ours. So before anything is dropped: if an object that is NOT ours
  -- depends on one that is, stop, and name it. Nothing has been touched.
  WITH ours AS (
    SELECT c.oid, 'pg_class'::regclass AS cls FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND (c.relname = ANY (ours_tables) OR c.relname = ANY (ours_views) OR c.relname = ANY (ours_sequences))
    UNION ALL
    SELECT p.oid, 'pg_proc'::regclass FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = ANY (ours_routines)
    UNION ALL
    SELECT t.oid, 'pg_type'::regclass FROM pg_type t
      JOIN pg_namespace ns ON ns.oid = t.typnamespace
     WHERE ns.nspname = 'public' AND t.typname = ANY (ours_types)
  ), dependent AS (
    -- Each dependent, by what it hangs off: the relation a view's rule, a
    -- constraint, a default, a trigger or a policy belongs to; the routine;
    -- the type (a domain's constraint belongs to its domain).
    SELECT d.classid, d.objid, d.objsubid,
           CASE d.classid
             WHEN 'pg_rewrite'::regclass    THEN (SELECT ev_class FROM pg_rewrite WHERE oid = d.objid)
             WHEN 'pg_class'::regclass      THEN d.objid
             WHEN 'pg_constraint'::regclass THEN (SELECT nullif(conrelid, 0) FROM pg_constraint WHERE oid = d.objid)
             WHEN 'pg_attrdef'::regclass    THEN (SELECT adrelid FROM pg_attrdef WHERE oid = d.objid)
             WHEN 'pg_trigger'::regclass    THEN (SELECT tgrelid FROM pg_trigger WHERE oid = d.objid)
             WHEN 'pg_policy'::regclass     THEN (SELECT polrelid FROM pg_policy WHERE oid = d.objid)
           END AS rel,
           CASE d.classid WHEN 'pg_proc'::regclass THEN d.objid END AS proc,
           CASE d.classid
             WHEN 'pg_type'::regclass       THEN d.objid
             WHEN 'pg_constraint'::regclass THEN (SELECT nullif(contypid, 0) FROM pg_constraint WHERE oid = d.objid)
           END AS typ
      FROM pg_depend d
      JOIN ours o ON o.oid = d.refobjid AND o.cls = d.refclassid
     WHERE d.deptype = 'n'
  )
  SELECT string_agg(DISTINCT pg_describe_object(x.classid, x.objid, x.objsubid), '; ')
    INTO foreign_deps
    FROM dependent x
   WHERE NOT coalesce(x.rel  IN (SELECT oid FROM ours WHERE cls = 'pg_class'::regclass), false)
     AND NOT coalesce(x.proc IN (SELECT oid FROM ours WHERE cls = 'pg_proc'::regclass), false)
     AND NOT coalesce(x.typ  IN (SELECT oid FROM ours WHERE cls = 'pg_type'::regclass), false)
     AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = x.classid AND e.objid = x.objid AND e.deptype = 'e');
  IF foreign_deps IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to reset: these are not this project''s, and depend on its objects: %', foreign_deps
      USING HINT = 'Nothing was dropped. Remove or detach them first: the reset drops only what db/ creates.';
  END IF;

  -- Views first: a view over a table we are about to drop would go with it
  -- under CASCADE anyway, but dropping them explicitly keeps the count honest.
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind IN ('v','m')
             AND c.relname = ANY (ours_views) AND ${notExtension("c.oid")}
  LOOP
    EXECUTE format(CASE r.relkind WHEN 'm' THEN 'DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE'
                                  ELSE 'DROP VIEW IF EXISTS public.%I CASCADE' END, r.relname);
    n := n + 1;
  END LOOP;

  FOR r IN SELECT c.relname FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind IN ('r','p')
             AND c.relname = ANY (ours_tables) AND ${notExtension("c.oid")}
  LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname); n := n + 1; END LOOP;

  FOR r IN SELECT c.relname FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind = 'S'
             AND c.relname = ANY (ours_sequences) AND ${notExtension("c.oid")}
  LOOP EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.relname); n := n + 1; END LOOP;

  -- Routines, by identity rather than by name: this schema overloads
  -- (app_can has defaults, official_level takes one argument or two), and
  -- dropping by name alone is ambiguous and fails. Every overload of a name
  -- of ours goes.
  --
  -- The signatures are collected as TEXT up front, before anything is
  -- dropped. Read lazily from a cursor instead, a routine already taken by
  -- an earlier CASCADE no longer resolves, and oid::regprocedure renders
  -- it as a bare number — which then reaches DROP FUNCTION as a syntax
  -- error and takes the whole teardown down with it. to_regprocedure() on
  -- the way back in is the matching half: it returns NULL for a signature
  -- that has since gone, rather than raising.
  --
  -- The extension exclusion is what lets this FINISH: Postgres refuses to
  -- drop an extension member on its own ("cannot drop function
  -- pgp_pub_decrypt_bytea(...) because extension pgcrypto requires it"), so
  -- without it the teardown ABORTS half-way rather than destroying pgcrypto.
  SELECT coalesce(array_agg(p.oid::regprocedure::text), '{}')
      INTO sigs
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = ANY (ours_routines)
       AND ${notExtension("p.oid")};
  FOREACH rt IN ARRAY sigs LOOP
    IF to_regprocedure(rt) IS NOT NULL THEN
      EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', rt);
      n := n + 1;
    END IF;
  END LOOP;

  -- Enums, domains and stand-alone composite types; never a table's own row type.
  FOR r IN SELECT t.typname, t.typtype FROM pg_type t
            JOIN pg_namespace ns ON ns.oid = t.typnamespace
           WHERE ns.nspname = 'public' AND t.typname = ANY (ours_types)
             AND (t.typtype IN ('e','d','r','m')
                  OR (t.typtype = 'c' AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c')))
             AND ${notExtension("t.oid")}
  LOOP
    EXECUTE format(CASE r.typtype WHEN 'd' THEN 'DROP DOMAIN IF EXISTS public.%I CASCADE'
                                  ELSE 'DROP TYPE IF EXISTS public.%I CASCADE' END, r.typname);
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'dropped % object(s) of this project in public', n;
END
$reset_objects$;`;
}

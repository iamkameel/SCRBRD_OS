#!/usr/bin/env node
/**
 * The scorebook reader, set up for a demonstration (SCRBRD-120 phase 4) —
 * on the pilot seed's invented schools, and nowhere else.
 *
 * It grants the `scorebook_import` module and the `scorebook_reader` feature
 * to the seed's Hilton College and adds a played fixture against an invented
 * opposition, so that the demo's two synthetic pages (page-1.png, page-2.png:
 * the seed's invented Hilton boys and an invented Ferndale High) can be
 * imported and read. It refuses:
 *
 *   - with NODE_ENV=production;
 *   - on any database that is not the pilot seed (the seed's development
 *     accounts at example.invalid and its Hilton College must be there — a
 *     school's real database has neither).
 *
 * The switch it turns on is the one D8 keeps off in production until the
 * information officer signs (docs/policy/SCOREBOOK_READER_SIGNOFF.md). A
 * demonstration sends no real child's page anywhere: its pages are invented,
 * and with SCOREBOOK_READER_REPLAY set the API does not call the provider at
 * all — it replays reader-response.json.
 *
 *   node tools/migrate.mjs --reset --seed                 (a local demo database)
 *   node tools/demo/scorebook/demo.mjs                    grant, and a fixture
 *   SCOREBOOK_READER_REPLAY=tools/demo/scorebook/reader-response.json pnpm dev
 *   node tools/demo/scorebook/demo.mjs --off              take the grants back
 *
 * Then: sign in as scorer@example.invalid → Matches → "Hilton 1st XI v
 * Ferndale High (demo)" → Import from a scorebook → add page-1.png and
 * page-2.png → Next: the card → Read the pages (Innings 1, Hilton batted).
 * To read the demo pages with the real provider instead, start the API with
 * ANTHROPIC_API_KEY set and SCOREBOOK_READER_REPLAY unset (invented pages
 * only, never a real book, until the sign-off).
 */
import pg from "pg";
import { ownerUrl } from "../../db-url.mjs";

const HIL = "11111111-1111-1111-1111-111111111111";
const OPPONENT = "Ferndale High (demo)";
const off = process.argv.includes("--off");

if (process.env.NODE_ENV === "production") {
  console.error("✗ refusing: NODE_ENV=production. The reader is switched on in production only by the platform, after the sign-off.");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: ownerUrl() });
try {
  const seed = (await pool.query(
    `select (select count(*) from app_user where email like '%@example.invalid')::int as dev,
            (select name from school where id = $1) as school`, [HIL])).rows[0];
  if (!seed.dev || !seed.school) {
    console.error("✗ refusing: this is not the pilot seed's database (no example.invalid accounts, or no seeded Hilton).");
    process.exit(2);
  }
  if (off) {
    await pool.query(`delete from feature_grant where school_id = $1 and key in ('scorebook_reader', 'scorebook_import') and note like 'demo:%'`, [HIL]);
    console.log(`The demo's grants are taken back from ${seed.school}.`);
  } else {
    for (const key of ["scorebook_import", "scorebook_reader"]) {
      await pool.query(`insert into feature_grant (key, school_id, granted, note) values ($1, $2, true, 'demo: tools/demo/scorebook/demo.mjs')
                        on conflict (key, school_id) do update set granted = true, note = excluded.note`, [key, HIL]);
    }
    const had = (await pool.query(`select id from match where school_id = $1 and opponent = $2 and status <> 'complete' limit 1`, [HIL, OPPONENT])).rows[0];
    const match = had ?? (await pool.query(
      `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
       values ($1, '1XI', $2, now() - interval '2 days', 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, OPPONENT])).rows[0];
    console.log(`${seed.school}: scorebook_import and scorebook_reader granted (demo), fixture ${match.id} v ${OPPONENT}.`);
    console.log("Start the API with SCOREBOOK_READER_REPLAY=tools/demo/scorebook/reader-response.json, sign in as scorer@example.invalid,");
    console.log("and import tools/demo/scorebook/page-1.png and page-2.png into that fixture. `--off` takes the grants back.");
  }
} finally {
  await pool.end();
}

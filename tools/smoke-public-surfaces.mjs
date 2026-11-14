#!/usr/bin/env node
/**
 * Public by terms, slice 3 (db/155): the naming decision with the
 * per-surface switch ON, over the database's own facts.
 *
 * db/99 §133 proves the facts public_name_facts() returns for a surface. This
 * walk proves what the public page then decides from them: it makes the
 * API's own people read (public-api.mjs's log: public_name_surface() and
 * public_match_people() through the application role, signed out) and asks
 * redact.mjs nameFor(), the one rule, for every boy on every fixture, with
 * the switch off and then on. Fable's red-team of db/155 (14 Nov 2026, N-9)
 * asked for it before the switch is ever turned on:
 *
 *   1. off: no fixture has a surface, and the page names as it did before
 *   2. on: a fixture in play is live, a scheduled one with balls synced is
 *      live too (SF-3), a completed one is card
 *   3. on: TL's mother said yes through one of her two verified links to
 *      him, and the office revoked that one. She still holds the other. He
 *      stays a position (SF-1); OK's mother's yes, on her live link, still
 *      names him (the case is not vacuous)
 *   4. on names nobody off does not: for every boy on every fixture in the
 *      database, named with the switch on implies named with it off
 *
 * Falsified (14 Nov 2026) against db/155's bodies as they were before the
 * red-team: a yes live whenever the person is (SF-1) → 3 and 4, TL named;
 * live only while the status is live (SF-3) → 2, the scheduled fixture card.
 *
 * The switch is turned back off at the end. Written as the owner, as the
 * office's doors and the scorer's pad would; read as the application.
 */
import pg from "pg";
import { ownerUrl, appUrl } from "./db-url.mjs";
import { nameFor } from "../services/api/public/redact.mjs";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;

const HIL = "11111111-1111-1111-1111-111111111111";
const OFFICE = "88888888-0000-0000-0000-00000000000c";
const SCORER = "88888888-0000-0000-0000-000000000006";

/** The public log's people read, exactly as public-api.mjs makes it, signed out. */
const PEOPLE_SQL = `select x.*, s.surface from public_name_surface($1) s(surface) cross join lateral public_match_people($1, s.surface) x`;
async function people(/** @type {string} */ match) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', '', true)");
    const rows = (await c.query(PEOPLE_SQL, [match])).rows;
    await c.query("COMMIT");
    return rows;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
/** player id → the name the page shows, or null for a position, and the surface. */
async function names(/** @type {string} */ match) {
  const rows = await people(match);
  return { surface: rows[0]?.surface ?? null,
           by: Object.fromEntries(rows.map((r) => [r.player_id, nameFor(r, r.served_on)])) };
}
const switchOn = (/** @type {boolean} */ on) =>
  q(`update feature_flag set enabled = $1, changed_by = $2, changed_at = now(), reason = reason
      where key = 'public_name_surfaces'`, [on, on ? OFFICE : null]);

/** A boy of 14 at Hilton's U16B, and a guardian with one verified link to him, made long ago. */
async function boyAndMother(/** @type {string} */ tag, /** @type {number} */ squadNo) {
  const [p] = await q(`insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
                       values ($1, 'U16B', $2, $3, $4, 'batter', (sa_today() - interval '14 years 30 days')::date) returning id`,
    [HIL, `Smoke Surfaces ${tag}`, `Surfaces${tag}`, squadNo]);
  const [u] = await q(`insert into app_user (school_id, email, name, role) values ($1, $2, $3, 'guardian') returning id`,
    [HIL, `smoke.surfaces.${tag.toLowerCase()}@example.invalid`, `Smoke ${tag} Mother`]);
  const [a] = await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [u.id, HIL]);
  const [l] = await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                                       consent_state, consent_version, consent_at, created_by, valid_from, created_at)
                       values ($1, $2, 'parent', 'verified', $3, now() - interval '400 days', 'granted', 'popia-2026-01',
                               now() - interval '400 days', $3, sa_today() - 400, now() - interval '400 days') returning id`,
    [a.id, p.id, OFFICE]);
  return { player: p.id, person: u.id, assignment: a.id, link: l.id };
}
/** Her yes to the old wording, given twenty days ago through `link`. */
const yes = (/** @type {any} */ b, /** @type {string} */ link) =>
  q(`insert into public_name_consent (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, recorded_by)
     values ($1, 'guardian', $2, $3, 'public-names-2026-10', sa_today() - 20, $4)`, [b.player, b.assignment, link, OFFICE]);

/** A fixture of the U16B at home, published, its first innings_start carrying `squad`. */
async function fixture(/** @type {string} */ status, /** @type {string[]} */ squad) {
  const [m] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                       values ($1, 'U16B', 'Smoke Surfaces XI', now() - interval '1 hour', 'cricket', 'T20', 20, $2) returning id`, [HIL, status]);
  await q(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by) values ($1, 'home', $2, 'U16B', true, $3)`,
    [m.id, HIL, OFFICE]);
  await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq,
                                   client_ts, kind, payload)
           values ($1, $2, 1, 1, 0, $3, 'smoke-surfaces', $5, 1, now(), 'innings_start',
                   jsonb_build_object('battingTeam', 'U16B', 'teamKey', 'U16B', 'bowlingTeam', 'Smoke Surfaces XI',
                                      'squad', (select jsonb_agg(jsonb_build_object('id', x)) from unnest($4::uuid[]) x)))`,
    [m.id, HIL, SCORER, squad, `smoke-surfaces-${m.id}-1`]);
  return m.id;
}

try {
  group("Staging");
  const tl = await boyAndMother("TL", 1561);
  const okb = await boyAndMother("OK", 1562);
  // TL's mother's second link, on the same assignment, verified before the
  // first and dated to end in a year (the one-open-link index allows it).
  const [l2] = await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                                        consent_state, consent_version, consent_at, created_by, valid_from, valid_until, created_at)
                        values ($1, $2, 'parent', 'verified', $3, now() - interval '500 days', 'granted', 'popia-2026-01',
                                now() - interval '500 days', $3, sa_today() - 500, sa_today() + 365, now() - interval '500 days') returning id`,
    [tl.assignment, tl.player, OFFICE]);
  await yes(tl, tl.link);
  await yes(okb, okb.link);
  // The office revokes the link she answered through, ten days ago.
  await q(`update assignment_subject set verification_state = 'revoked', valid_until = sa_today() - 10 where id = $1`, [tl.link]);
  const [{ live: tlLive }] = await q(`select consent_giver_live($1, $2, now()) as live`, [tl.person, tl.player]);
  ok("TL's mother still holds a live link to him (her second), so the case tests the link, not the person", tlLive === true && !!l2.id);
  const squad = [tl.player, okb.player];
  const LIVE = await fixture("live", squad);
  const SCHED = await fixture("scheduled", squad);   // balls synced, the status not yet moved
  const DONE = await fixture("complete", squad);
  const all = (await q(`select id from match order by id`)).map((r) => r.id);
  ok(`${all.length} fixtures in the database, three of them this walk's`, all.length >= 3);

  group("1. Off: no surface, the page as before");
  await switchOn(false);
  /** @type {Record<string, {surface: string|null, by: Record<string, string|null>}>} */
  const off = {};
  for (const m of all) off[m] = await names(m);
  ok("no fixture has a surface", Object.values(off).every((n) => n.surface == null), JSON.stringify(Object.values(off).map((n) => n.surface)));
  ok("OK's mother's yes names him on every fixture of his", [LIVE, SCHED, DONE].every((m) => off[m].by[okb.player] === "S SurfacesOK"),
     JSON.stringify([LIVE, SCHED, DONE].map((m) => off[m].by[okb.player])));
  ok("TL is a position: his mother's link is revoked (db/116's rule)", [LIVE, SCHED, DONE].every((m) => off[m].by[tl.player] === null));

  group("2. On: live while not over, scheduled included (SF-3); card once over");
  await switchOn(true);
  /** @type {Record<string, {surface: string|null, by: Record<string, string|null>}>} */
  const on = {};
  for (const m of all) on[m] = await names(m);
  ok("the fixture in play is live", on[LIVE].surface === "live", on[LIVE].surface);
  ok("the scheduled fixture with balls synced is live, not a scorecard", on[SCHED].surface === "live", on[SCHED].surface);
  ok("the completed fixture is card", on[DONE].surface === "card", on[DONE].surface);
  const statuses = await q(`select id, status from match`);
  const want = (/** @type {string} */ s) => (s === "complete" || s === "abandoned" ? "card" : "live");
  ok("every fixture with people has the surface its status gives",
     statuses.every((r) => on[r.id].surface == null || on[r.id].surface === want(r.status)),
     JSON.stringify(statuses.filter((r) => on[r.id].surface != null && on[r.id].surface !== want(r.status))));

  group("3. On: a yes through a revoked link names nobody, whatever other link she holds (SF-1)");
  ok("TL stays a position on live, scheduled and card", [LIVE, SCHED, DONE].every((m) => on[m].by[tl.player] === null),
     JSON.stringify([LIVE, SCHED, DONE].map((m) => on[m].by[tl.player])));
  ok("...and OK, his mother's link live, is still named on each (not vacuous)",
     [LIVE, SCHED, DONE].every((m) => on[m].by[okb.player] === "S SurfacesOK"));

  group("4. On names nobody off does not");
  const widened = [];
  let boys = 0;
  for (const m of all) for (const [id, name] of Object.entries(on[m].by)) {
    boys++;
    if (name != null && off[m].by[id] == null) widened.push(`${m}/${id}`);
  }
  ok(`over ${boys} boys on ${all.length} fixtures, every one named with the switch on is named with it off`,
     boys >= 6 && widened.length === 0, widened.slice(0, 5).join(", "));
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", /** @type {any} */ (e)?.stack ?? e);
} finally {
  try { await switchOn(false); } catch { /* the reset after the walk puts it back too */ }
  await owner.end();
  await app.end();
}

console.log(`\nPUBLIC SURFACES (switch on): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

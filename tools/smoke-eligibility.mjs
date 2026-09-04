#!/usr/bin/env node
/**
 * A fifteen-year-old cannot be selected for a U13 match.
 *
 * "U13" means thirteen AND UNDER. Getting it wrong is a safeguarding failure
 * before it is a competitive one — it is a fifteen-year-old bowling at
 * thirteen-year-olds — and it is the kind of thing a school is answerable for.
 *
 * Enforced by a trigger rather than by a selection screen, because there are
 * already three ways a squad row gets written and "remember to check the age"
 * survives exactly as long as the person who knew about it. This walk drives
 * the real database and checks the boundaries, which are where an age rule
 * actually goes wrong.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-eligibility.mjs
 */
import pg from "pg";
import { ageAtCutoff, isEligible, cutoffFor } from "@scrbrd/policy/teams";

const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** Try to select a player of this birth date into a team; did it stick? */
async function select(born, team, matchYear = 2026) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const [m] = (await c.query(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1,$2,'Michaelhouse', make_date($3,6,1), 'T20', 20, 'scheduled') returning id`,
      [HIL, team, matchYear])).rows;
    const [p] = (await c.query(
      `insert into player (school_id, team_code, full_name, born)
       values ($1,$2,'Test Player',$3::date) returning id`,
      [HIL, team, born])).rows;
    // A verified, consented guardian link, because a squad row is also refused
    // for a child who has none. That rule is the subject of smoke-guardian;
    // here it is scaffolding, and it has to be real scaffolding — the first run
    // of this walk after the registration trigger landed failed eleven
    // assertions, every one of them because a synthetic child had no parent.
    const [g] = (await c.query(
      `insert into role_assignment (person_id, role, school_id)
       values ('88888888-0000-0000-0000-000000000005','guardian',$1) returning id`,
      [HIL])).rows;
    await c.query(
      `insert into assignment_subject
         (assignment_id, player_id, relationship, verification_state, verified_by,
          verified_at, consent_state, consent_version, consent_at)
       values ($1,$2,'parent','verified','88888888-0000-0000-0000-000000000007',
               now(),'granted','popia-2026-01',now())`,
      [g.id, p.id]);
    await c.query(`insert into match_squad (match_id, player_id, side) values ($1,$2,'home')`,
                  [m.id, p.id]);
    await c.query("rollback");
    return { accepted: true, error: null };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { accepted: false, error: e.message };
  } finally { c.release(); }
}

try {
  group("The case this exists to prevent");
  const tooOld = await select("2011-03-14", "U13A");
  ok("a fourteen-year-old is refused a U13 match", tooOld.accepted === false);
  ok("...and the message names the player, the age and the limit",
     /is 14 on 1 January and cannot play U13A: the limit is 13/.test(tooOld.error ?? ""));

  group("The boundaries, which is where an age rule goes wrong");
  // Age is measured at 1 JANUARY of the season, not on match day: otherwise a
  // side is legal in February and illegal in April, and a player changes age
  // group mid-season.
  ok("exactly 13 on the cut-off is eligible for U13",
     (await select("2013-01-01", "U13A")).accepted === true);
  ok("a birthday one day AFTER the cut-off is still eligible",
     (await select("2013-01-02", "U13A")).accepted === true);
  // Born 31 December 2012: they turned 13 on 31 Dec 2025, so they are 13 on the
  // cut-off and eligible. The first draft of this assertion expected a refusal
  // and was simply wrong about the arithmetic.
  ok("a birthday the day before the cut-off leaves them 13, so eligible",
     (await select("2012-12-31", "U13A")).accepted === true);
  // A year earlier: 14 on the cut-off, and refused.
  ok("...and a year earlier they are 14, so refused",
     (await select("2011-12-31", "U13A")).accepted === false);

  // The whole point of the 1 January rule. Both of these boys turn 14 during
  // the 2026 season and both stay eligible for the side they started it in —
  // otherwise a squad is legal in February and illegal in April.
  //
  // The first draft asserted a REFUSAL here while the assertion's own name said
  // "does not make a player ineligible". The name was right.
  ok("turning 14 in March does not make a U13 player ineligible mid-season",
     (await select("2012-03-14", "U13A")).accepted === true);
  ok("...nor turning 14 in June", (await select("2012-06-14", "U13A")).accepted === true);

  group("Playing up is normal; playing down is not");
  ok("a twelve-year-old may play U15", (await select("2013-06-01", "U15A")).accepted === true);
  ok("a sixteen-year-old may not play U15", (await select("2009-06-01", "U15A")).accepted === false);
  ok("an open side has no age limit at all", (await select("2007-06-01", "1XI")).accepted === true);
  ok("...and a young player may be picked for it",
     (await select("2013-06-01", "1XI")).accepted === true);

  group("An unknown age is not a pass");
  const noDob = await select(null, "U13A");
  ok("a player with no date of birth cannot be selected", noDob.accepted === false);
  ok("...and is told why, rather than silently allowed",
     /no date of birth on record/.test(noDob.error ?? ""));

  group("The client agrees with the database");
  // Two implementations of one age rule, which is one more than anybody wants
  // and unavoidable: the selection screen has to grey out an ineligible player
  // before the write, and the database has to refuse it regardless.
  for (const [born, team] of [
    ["2011-03-14", "U13A"], ["2013-01-01", "U13A"], ["2012-12-31", "U13A"],
    ["2011-12-31", "U13A"], ["2012-03-14", "U13A"],
    ["2013-06-01", "U15A"], ["2009-06-01", "U15A"], ["2007-06-01", "1XI"],
  ]) {
    const client = isEligible(ageAtCutoff(born, new Date("2026-06-01")), team);
    const db = (await select(born, team)).accepted;
    ok(`${born} for ${team}: client says ${client}, database says ${db}`, client === db);
  }
  ok("the cut-off is 1 January", cutoffFor(2026).toISOString().startsWith("2026-01-01"));
} catch (e) {
  ok(`the eligibility walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  await pool.end().catch(() => {});
}

console.log(`\n${"─".repeat(52)}\nELIGIBILITY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * A verified guardian link, and what happens without one.
 *
 * POPIA does not let a school process a minor's information because somebody
 * said they were the parent. §12.2 of the permissions scope puts it as a hard
 * rule — every minor has a VERIFIED guardian link — and until this landed, a
 * relationship typed into a form was indistinguishable from one an
 * administrator had checked against a birth certificate.
 *
 * The assertions worth reading are the ones about FAILURE MODES, because a
 * safeguarding control that fails open is worse than none:
 *
 *   an unverified link reaches nothing, and does not fall back to the school
 *   a revoked link NARROWS to nothing; it must never widen
 *   a guardian assignment naming nobody reaches nothing at all
 *   nobody creates or verifies a link that grants themselves access
 *   a coach cannot become the guardian of a child in their own side
 *   the last verified link of a minor cannot be taken away
 *   withdrawing consent does not blind the parent — it unregisters the child
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-guardian.mjs
 */
import pg from "pg";

const OWNER = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const APP   = process.env.APP_DATABASE_URL || "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";

const HIL        = "11111111-1111-1111-1111-111111111111";
const REGISTRAR  = "88888888-0000-0000-0000-00000000000c";  // schooladmin, Hilton
const REG_WES    = "88888888-0000-0000-0000-00000000000d";  // schooladmin, Westville
const SARAH      = "88888888-0000-0000-0000-000000000007";  // head of sport, U16B coach, guardian ×2
const COACH_1XI  = "88888888-0000-0000-0000-000000000004";
const COACH_U14A = "88888888-0000-0000-0000-00000000000b";
const PARENT     = "88888888-0000-0000-0000-000000000005";  // D Pillay
const P_INJURED  = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay, 1XI
const P_DLAMINI  = "aaaaaaaa-0000-0000-0000-000000000006";  // K Dlamini, U16B — a minor
const P_MKHIZE   = "bbbbbbbb-0000-0000-0000-000000000001";  // D Mkhize, Westville
const P_U13      = "aaaaaaaa-0000-0000-0000-000000000011";  // L Mahlangu, U13A — unlinked
const P_CELE     = "aaaaaaaa-0000-0000-0000-000000000004";  // M Cele — verified, not consented
const NEW_PARENT = "88888888-0000-0000-0000-0000000000f1";
const LONE_GUARD = "88888888-0000-0000-0000-0000000000f2";
const SECOND_GUA = "88888888-0000-0000-0000-0000000000f3";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const owner = new pg.Pool({ connectionString: OWNER });
const app   = new pg.Pool({ connectionString: APP });
const q = async (t, p) => (await owner.query(t, p)).rows;

/** Run a statement AS a person, through the unprivileged application role. */
async function act(uid, text, params) {
  const c = await app.connect();
  try {
    await c.query("select set_config('app.user_id', $1, false)", [uid]);
    return (await c.query(text, params)).rows;
  } finally {
    await c.query("select set_config('app.user_id', '', false)").catch(() => {});
    c.release();
  }
}
async function actErr(uid, text, params) {
  try { await act(uid, text, params); return null; } catch (e) { return e.message; }
}
const players  = async (uid) => (await act(uid, "select id from player")).map((r) => r.id);
const fixtures = async (uid) => (await act(uid, "select id from match")).length;
const call = async (uid, sql, params) => (await act(uid, sql, params))[0];
const state = async (player) =>
  (await q("select registration_state from player_guardian_status where player_id = $1", [player]))[0]?.registration_state;

try {
  group("A link nobody verified reaches nothing");
  ok("the parent of the injured player reads their own child",
     (await players(PARENT)).includes(P_INJURED));
  await q(`update assignment_subject set verification_state = 'pending',
             verified_by = null, verified_at = null
            where player_id = $1 and relationship = 'parent'`, [P_INJURED]);
  const whilePending = await players(PARENT);
  ok("...and reads nothing once the link is only CLAIMED", whilePending.length === 0);
  // The dangerous failure is not "reads nothing". It is "reads everything":
  // an assignment that names nobody is school-scoped, so a naive liveness
  // filter would turn an unverified parent into a school-wide one.
  ok("...and specifically does not fall back to the whole school",
     !whilePending.includes(P_DLAMINI));
  await q(`update assignment_subject set verification_state = 'verified',
             verified_by = $2, verified_at = now()
            where player_id = $1 and relationship = 'parent'`, [P_INJURED, REGISTRAR]);
  ok("...and reads their child again once it is verified",
     (await players(PARENT)).includes(P_INJURED));

  group("Revocation narrows. It can never widen");
  await q(`update assignment_subject set verification_state = 'revoked',
             valid_until = current_date
            where player_id = $1 and relationship = 'parent'`, [P_INJURED]);
  const afterRevoke = await players(PARENT);
  ok("a revoked link reaches no child at all", afterRevoke.length === 0);
  ok("...not even the fixtures the assignment used to carry",
     (await fixtures(PARENT)) === 0);
  await q(`update assignment_subject set verification_state = 'verified', valid_until = null
            where player_id = $1 and relationship = 'parent'`, [P_INJURED]);
  ok("...and the parent is restored when it is", (await players(PARENT)).length === 1);

  // A guardian of TWO children, one link ended. The outer "does this assignment
  // name anybody live" gate is satisfied by the child who remains, so the only
  // thing standing between this parent and the other family's child is the
  // per-child liveness test. Removing that test leaves every earlier assertion
  // in this file passing, which is why this group exists.
  group("One ended link does not travel on the back of another");
  await q(`insert into assignment_subject
             (assignment_id, player_id, relationship, verification_state, verified_by,
              verified_at, consent_state, consent_version, consent_at)
           values ('a5510000-0000-0000-0000-000000000005',$1,'parent','verified',$2,
                   now(),'granted','popia-2026-01',now())`, [P_U13, REGISTRAR]);
  const twoChildren = await players(PARENT);
  ok("a parent of two children reads both",
     twoChildren.includes(P_INJURED) && twoChildren.includes(P_U13));
  await q(`update assignment_subject set verification_state = 'revoked', valid_until = current_date
            where assignment_id = 'a5510000-0000-0000-0000-000000000005' and player_id = $1`, [P_U13]);
  const oneChild = await players(PARENT);
  ok("...and only the remaining one once the other link is ended",
     oneChild.length === 1 && oneChild[0] === P_INJURED);
  await q(`delete from assignment_subject
            where assignment_id = 'a5510000-0000-0000-0000-000000000005' and player_id = $1`, [P_U13]);

  group("A guardian who is guardian of nobody");
  await q(`insert into app_user (id, school_id, email, name, role)
           values ($1,$2,'nobody@example.invalid','A Stranger','parent')`, [LONE_GUARD, HIL]);
  await q(`insert into role_assignment (person_id, role, school_id) values ($1,'guardian',$2)`,
          [LONE_GUARD, HIL]);
  ok("an assignment naming no child reads no children", (await players(LONE_GUARD)).length === 0);
  ok("...and no fixtures either", (await fixtures(LONE_GUARD)) === 0);

  group("Who may create a link");
  ok("a coach may not establish one",
     (await call(COACH_1XI, "select * from guardian_link_establish($1,$2,'parent')",
                 [PARENT, P_U13])).reason === "not_permitted");
  ok("nobody may create a link to themselves",
     (await call(REGISTRAR, "select * from guardian_link_establish($1,$2,'parent')",
                 [REGISTRAR, P_U13])).reason === "self_created");
  // The 1st XI coach coaches R Pillay. A coach who becomes the "guardian" of a
  // boy they already coach converts a scoped, revocable coaching relationship
  // into a standing personal one over that child's whole record.
  ok("a coach may not be linked to a child in their own side",
     (await call(REGISTRAR, "select * from guardian_link_establish($1,$2,'parent')",
                 [COACH_1XI, P_INJURED])).reason === "coaches_this_player");
  // ...and the same coach CAN be linked to a child they do not coach, so the
  // refusal above is about the side and not about being a coach.
  ok("...but may be linked to a child in another side",
     (await call(REGISTRAR, "select * from guardian_link_establish($1,$2,'parent')",
                 [COACH_1XI, P_U13])).ok === true);
  await q(`update assignment_subject g set verification_state = 'revoked', valid_until = current_date
            from role_assignment a
           where a.id = g.assignment_id and a.person_id = $1 and g.player_id = $2`,
          [COACH_1XI, P_U13]);

  group("Establishing, then verifying");
  await q(`insert into app_user (id, school_id, email, name, role)
           values ($1,$2,'newparent@example.invalid','R Mahlangu','parent')`, [NEW_PARENT, HIL]);
  const est = await call(REGISTRAR, "select * from guardian_link_establish($1,$2,'parent')",
                         [NEW_PARENT, P_U13]);
  ok("the office establishes a link", est.ok === true);
  ok("...and it is created PENDING, so it reaches nothing yet",
     (await players(NEW_PARENT)).length === 0);
  ok("...and the child is not yet registered", (await state(P_U13)) === "pending_verification");
  ok("a guardian cannot verify their own link",
     (await call(NEW_PARENT, "select * from guardian_link_verify($1,$2,'popia-2026-01')",
                 [NEW_PARENT, P_U13])).reason === "not_permitted");
  const ver = await call(REGISTRAR, "select * from guardian_link_verify($1,$2,'popia-2026-01')",
                         [NEW_PARENT, P_U13]);
  ok("the office verifies it", ver.ok === true);
  ok("...and now the parent reads their child",
     (await players(NEW_PARENT)).includes(P_U13));
  ok("...and the child is registered", (await state(P_U13)) === "active");
  const link = (await q(`select g.* from assignment_subject g join role_assignment a on a.id = g.assignment_id
                          where a.person_id = $1 and g.player_id = $2 and g.valid_until is null`,
                        [NEW_PARENT, P_U13]))[0];
  ok("...and the record names who verified it and when",
     link.verified_by === REGISTRAR && link.verified_at != null);
  ok("...and which consent version was taken", link.consent_version === "popia-2026-01");
  ok("verifying twice is not a second verification",
     (await call(REGISTRAR, "select * from guardian_link_verify($1,$2,'popia-2026-02')",
                 [NEW_PARENT, P_U13])).reason === "no_pending_link");
  ok("establishing the same link twice is refused",
     (await call(REGISTRAR, "select * from guardian_link_establish($1,$2,'parent')",
                 [NEW_PARENT, P_U13])).reason === "already_linked");

  group("Nobody verifies their own link, including the office");
  // Arranged directly, because guardian_link_establish() refuses to create it.
  const [regAssign] = await q(
    `insert into role_assignment (person_id, role, school_id) values ($1,'guardian',$2) returning id`,
    [REGISTRAR, HIL]);
  await q(`insert into assignment_subject (assignment_id, player_id, relationship)
           values ($1,$2,'parent')`, [regAssign.id, P_U13]);
  ok("an administrator cannot verify a link naming themselves",
     (await call(REGISTRAR, "select * from guardian_link_verify($1,$2,'popia-2026-01')",
                 [REGISTRAR, P_U13])).reason === "self_verified");
  const regSees = await act(REGISTRAR,
    `select count(*)::int n from assignment_subject g join role_assignment a on a.id = g.assignment_id
      where a.person_id = $1 and g.verification_state = 'verified'`, [REGISTRAR]);
  ok("...and it is still not verified", regSees[0].n === 0);
  await q(`delete from assignment_subject where assignment_id = $1`, [regAssign.id]);
  await q(`delete from role_assignment where id = $1`, [regAssign.id]);

  group("The last verified link of a minor cannot be taken away");
  ok("K Dlamini is a minor with exactly one guardian",
     (await q("select is_minor, live_links from player_guardian_status where player_id=$1", [P_DLAMINI]))
       .every((r) => r.is_minor === true && r.live_links === 1));
  ok("revoking it is refused",
     (await call(REGISTRAR, "select * from guardian_link_revoke($1,$2)",
                 [SARAH, P_DLAMINI])).reason === "last_verified_link");
  await q(`insert into app_user (id, school_id, email, name, role)
           values ($1,$2,'second@example.invalid','P Dlamini','parent')`, [SECOND_GUA, HIL]);
  await call(REGISTRAR, "select * from guardian_link_establish($1,$2,'parent')", [SECOND_GUA, P_DLAMINI]);
  await call(REGISTRAR, "select * from guardian_link_verify($1,$2,'popia-2026-01')", [SECOND_GUA, P_DLAMINI]);
  const rev = await call(REGISTRAR, "select * from guardian_link_revoke($1,$2,'moved out')",
                         [SARAH, P_DLAMINI]);
  ok("...and permitted once a second guardian is in place", rev.ok === true);
  const revoked = (await q(`select g.* from assignment_subject g join role_assignment a on a.id=g.assignment_id
                             where a.person_id=$1 and g.player_id=$2 and g.verification_state='revoked'`,
                           [SARAH, P_DLAMINI]))[0];
  ok("...and the revoked link is KEPT, end-dated", !!revoked && revoked.valid_until != null);
  ok("...and the child stays registered through the remaining guardian",
     (await state(P_DLAMINI)) === "active");
  // Sarah is ALSO the U16B coach, and K Dlamini is U16B. Revoking the family
  // relationship must not touch the professional one.
  ok("...and Sarah still reaches him as his coach",
     (await players(SARAH)).includes(P_DLAMINI));
  // Her guardianship at the OTHER school is a separate assignment and untouched.
  ok("...and her child at Westville is unaffected",
     (await players(SARAH)).includes(P_MKHIZE));

  group("Consent is the parent's, and it is not the same thing as access");
  // On a MINOR. R Pillay would have been the obvious subject and is the wrong
  // one: he turned eighteen, so his registration is 'active' whatever anybody
  // consents to, and every assertion here would have passed without the rule
  // doing anything.
  ok("a stranger cannot withdraw somebody else's consent",
     (await call(COACH_1XI, "select * from guardian_consent_withdraw($1,$2)",
                 [NEW_PARENT, P_U13])).reason === "not_permitted");
  ok("the parent withdraws their own",
     (await call(NEW_PARENT, "select * from guardian_consent_withdraw($1,$2)",
                 [NEW_PARENT, P_U13])).ok === true);
  ok("...and still reads their own child's record",
     (await players(NEW_PARENT)).includes(P_U13));
  ok("...but the school may no longer treat him as registered",
     (await state(P_U13)) === "pending_consent");
  ok("...and consent can be given again, by version",
     (await call(REGISTRAR, "select * from guardian_consent_record($1,$2,'popia-2026-02')",
                 [NEW_PARENT, P_U13])).ok === true);
  ok("...which registers him again", (await state(P_U13)) === "active");
  ok("consent with no version recorded is not consent",
     (await call(REGISTRAR, "select * from guardian_consent_record($1,$2,'')",
                 [NEW_PARENT, P_U13])).reason === "no_consent_version");

  group("An unregistered child is not selected");
  const [m] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'U13A','Michaelhouse', now() + interval '7 days', 'T20', 20, 'scheduled') returning id`,
    [HIL]);
  const [m1] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() + interval '7 days', 'T20', 20, 'scheduled') returning id`,
    [HIL]);
  ok("M Cele's parent has not consented", (await state(P_CELE)) === "pending_consent");
  const celeRefused = await actErr(SARAH,
    `insert into match_squad (match_id, player_id, side) values ($1,$2,'home')`, [m1.id, P_CELE]);
  ok("...so he cannot be picked", /not registered to play \(pending_consent\)/.test(celeRefused ?? ""));
  ok("...and the message says a guardian link is what is missing",
     /verified guardian link and consent/.test(celeRefused ?? ""));
  await call(REGISTRAR, "select * from guardian_consent_record($1,$2,'popia-2026-01')",
             ["88888888-0000-0000-0000-000000000013", P_CELE]);
  ok("...and can, once his parent consents", (await state(P_CELE)) === "active");
  const celeOk = await actErr(SARAH,
    `insert into match_squad (match_id, player_id, side) values ($1,$2,'home')`, [m1.id, P_CELE]);
  ok("...with the squad row now accepted", celeOk === null);

  // A child with no guardian at all is the case the rule exists for.
  await q(`update assignment_subject g set verification_state='revoked', valid_until=current_date
            from role_assignment a
           where a.id = g.assignment_id and a.person_id = $1 and g.player_id = $2`,
          [NEW_PARENT, P_U13]);
  ok("an unlinked child is unregistered", (await state(P_U13)) === "unlinked");
  const u13Refused = await actErr(SARAH,
    `insert into match_squad (match_id, player_id, side) values ($1,$2,'home')`, [m.id, P_U13]);
  ok("...and cannot be picked either", /not registered to play \(unlinked\)/.test(u13Refused ?? ""));

  group("The link table cannot be written directly");
  const [anyAssign] = await q(`select id from role_assignment where role = 'guardian' limit 1`);
  ok("the office cannot INSERT a link, only call the function",
     (await actErr(REGISTRAR,
        `insert into assignment_subject (assignment_id, player_id, relationship)
         values ($1,$2,'parent')`, [anyAssign.id, P_U13])) !== null);
  // Not an error: with no UPDATE policy the rows are invisible to the
  // statement, so it succeeds having changed nothing. Counting is the only way
  // to tell the difference between "refused" and "quietly did it".
  const touched = await act(REGISTRAR,
     `update assignment_subject set verification_state = 'verified'
       where player_id = $1 returning 1`, [P_U13]);
  ok("...nor UPDATE one into a verified state", touched.length === 0);
  ok("...nor DELETE one, so a link cannot be made to have never existed",
     (await actErr(REGISTRAR, `delete from assignment_subject where player_id = $1`, [P_U13])) !== null);

  group("Who may read a child's links");
  const regLinks = await act(REGISTRAR, `select count(*)::int n from assignment_subject`);
  ok("the office reads the links of the children it administers", regLinks[0].n > 0);
  // The U14A coach, not the 1st XI coach: this walk gave the latter a guardian
  // link of his own two groups ago, and a coach reading HIS OWN link would have
  // made this assertion fail for the right reason at the wrong time.
  const coachLinks = await act(COACH_U14A, `select count(*)::int n from assignment_subject`);
  ok("a coach reads none of them", coachLinks[0].n === 0);
  const wesLinks = await act(REG_WES,
    `select count(*)::int n from assignment_subject g join player p on p.id = g.player_id
      where p.school_id = $1`, [HIL]);
  ok("another school's office reads none of them either", wesLinks[0].n === 0);
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message);
} finally {
  await owner.end().catch(() => {});
  await app.end().catch(() => {});
}

console.log("\n" + "─".repeat(52));
console.log(`GUARDIAN LINK SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

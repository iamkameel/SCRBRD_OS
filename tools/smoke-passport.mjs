#!/usr/bin/env node
/** A boy's cricket record travels on the family's say-so, and says where each line came from. */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
const PORT = port(8872), BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const WES = "22222222-2222-2222-2222-222222222222";
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005", WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);
const server = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-passport" }, stdio: ["ignore", "pipe", "pipe"] });
const serverErr = []; server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-passport" } })).body?.token;
const passport = async (id, tok) => (await api(`/api/read/passport?playerId=${id}`, { token: tok })).body?.rows ?? [];
const consent = (tok, playerId, schoolId) => api("/api/passport/consent", { method: "POST", token: tok, body: { playerId, schoolId } });
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const parent = await login("parent@example.invalid"), coach = await login("coach@example.invalid"), wes = await login("coach.wes@example.invalid");
  const otherMum = await login("parent.whitfield@example.invalid"), boy = await login("pillay@example.invalid"), watcher = await login("watcher@example.invalid");
  const wesOffice = await login("registrar.wes@example.invalid");
  // A pupil of his own side (the seed's spectator@ account holds `player` on the 1st XI).
  const mate = await login("spectator@example.invalid");

  group("The record stays home until the family says otherwise");
  {
    ok("a coach at another school reads nothing of the boy", (await passport(PILLAY, wes)).length === 0);
    ok("his own coach reads his passport", (await passport(PILLAY, coach)).length > 0);
    ok("his family reads it", (await passport(PILLAY, parent)).length > 0 && (await passport(PILLAY, boy)).length > 0);
    ok("a spectator reads none", (await passport(PILLAY, watcher)).length === 0);
    // db/116 (the red-team's A1): a team-mate holds player.profile.read over
    // him and no coach's or office's capability, so the passport stays shut.
    ok("a team-mate reads none", !!mate && (await passport(PILLAY, mate)).length === 0);
    ok("a coach cannot consent for a boy", [403, 401].includes((await consent(coach, PILLAY, WES)).status));
    // db/122 (Kameel, 29 Oct 2026): "Under eighteen, only his guardian; at
    // eighteen, he does it himself". R Pillay is sixteen.
    ok("nor, at sixteen, the boy himself: his guardian decides until he is eighteen",
       (await consent(boy, PILLAY, WES)).status === 403);
    ok("another family cannot consent for him", [403, 401].includes((await consent(otherMum, PILLAY, WES)).status));
    ok("the other school cannot help itself", [403, 401].includes((await consent(wes, PILLAY, WES)).status));
    const c = await consent(parent, PILLAY, WES);
    ok("his mother names Westville", c.status === 200);
    ok("...stamped from her session", (await q(`select granted_by from passport_consent where id = $1`, [c.body.id]))[0].granted_by === (await q(`select id from app_user where email = 'parent@example.invalid'`))[0].id);
    ok("...naming it twice is once", (await consent(parent, PILLAY, WES)).status === 422);
    const seen = await passport(PILLAY, wes);
    ok("and now Westville's coach reads his cricket record", seen.length > 0);
    ok("...every line says where it came from", seen.every((l) => l.source_school === "Hilton College" && l.recorded_by));
    ok("...and how sure to be", seen.every((l) => ["derived", "verified", "asserted", "seeded"].includes(l.confidence)));
    ok("...a cap and a milestone are derived", seen.some((l) => l.family === "cap" && l.confidence === "derived"));
    ok("...nothing medical, nothing from his file, no note", !JSON.stringify(seen).match(/injur|address|id_number|note/i));
    ok("...and Whitfield's stays home", (await passport(WHITFIELD, wes)).length === 0);
    ok("the family sees what it has granted", (await api("/api/read/passport_consents", { token: parent })).body?.rows?.some((x) => x.to_school_id === WES && x.withdrawn_at === null));
    // REACH R-B, db/115 (Kameel, 16 Oct 2026: "office only"). The consent row
    // is the family's and the named school's office's. Westville's coach no
    // longer reads it; he reads the passport itself, above, through passport().
    const officeSees = (await api("/api/read/passport_consents", { token: wesOffice })).body?.rows ?? [];
    ok("...and so does the office of the school named", officeSees.length === 1 && officeSees[0].to_school_id === WES && officeSees[0].withdrawn_at === null);
    ok("...by the boy's name, which the family's word opens to it", officeSees[0]?.full_name === "R Pillay");
    ok("...not the named school's coach, who reads the passport and not the consent", (await api("/api/read/passport_consents", { token: wes })).body?.rows?.length === 0);
    ok("...nor his own coach at home", (await api("/api/read/passport_consents", { token: coach })).body?.rows?.length === 0);
    // Nothing withdrawn is a 403, not a quiet 200 (db/122 §1d), so a screen can say why.
    const wWes = await api(`/api/passport/consent/${c.body.id}/withdraw`, { method: "POST", token: wes });
    ok("Westville cannot withdraw it, and is told so", wWes.status === 403 && wWes.body?.error === "not_permitted");
    ok("...nor can its office, which reads it", (await api(`/api/passport/consent/${c.body.id}/withdraw`, { method: "POST", token: wesOffice })).status === 403);
    ok("his mother withdraws it", (await api(`/api/passport/consent/${c.body.id}/withdraw`, { method: "POST", token: parent })).body?.withdrawn === 1);
    ok("...and Westville reads nothing again", (await passport(PILLAY, wes)).length === 0);
    ok("...a withdrawn consent is not revived", !(await q(`set local role scrbrd_app; update passport_consent set withdrawn_at = null where id = $1`, [c.body.id]).then(() => true).catch(() => false)));
    const again = await consent(parent, PILLAY, WES);
    ok("...but may be granted again", again.status === 200 && (await passport(PILLAY, wes)).length > 0);
    // db/122 §1d (Kameel, 29 Oct 2026): under eighteen the boy may still take
    // a name back; naming stays with his guardian.
    const mine = await api(`/api/passport/consent/${again.body?.id}/withdraw`, { method: "POST", token: boy });
    ok("the boy, at sixteen, takes Westville's name back himself", mine.status === 200 && mine.body?.withdrawn === 1);
    ok("...and Westville reads nothing", (await passport(PILLAY, wes)).length === 0);
    ok("...taking it back twice is a 403, said, not a quiet nothing",
       (await api(`/api/passport/consent/${again.body?.id}/withdraw`, { method: "POST", token: boy })).status === 403);
    ok("...and the withdrawal is stamped as his", (await q(`select u.email from passport_consent c join app_user u on u.id = c.withdrawn_by where c.id = $1`, [again.body?.id]))[0]?.email === "pillay@example.invalid");
  }
  // db/124 (Kameel, 29 Oct 2026): "CSA Schools/Provincial Union will be able
  // to access a child's full passport", "With his guardian's consent, as the
  // receiving school's is", "Named selectors and the schools cricket manager
  // only, every read logged", so his family can see who looked.
  group("His union reads his passport on his family's word, named selectors only, every read logged");
  {
    const kzn = (await q(`insert into school (code, name, kind, province) values ('WALKKZN', 'Walk KZN Cricket Union', 'union', 'KwaZulu-Natal')
                           on conflict do nothing returning id`))[0]?.id
             ?? (await q(`select id from school where kind = 'union' and lower(btrim(province)) = 'kwazulu-natal'`))[0].id;
    const far = (await q(`insert into school (code, name, kind, province) values ('WALKFAR', 'Walk Far Union', 'union', 'Walk Province') returning id`))[0].id;
    const person = async (email, name, role, school) => {
      const id = (await q(`insert into app_user (school_id, email, name, role) values ($1, $2, $3, $4) returning id`, [school, email, name, role]))[0].id;
      await q(`insert into role_assignment (person_id, role, school_id) values ($1, $2, $3)`, [id, role, school]);
      return login(email);
    };
    const sel = await person("selector.walk@example.invalid", "Walk Selector", "unionselector", kzn);
    const org = await person("organiser.walk@example.invalid", "Walk Organiser", "competitionadmin", kzn);
    ok("the union's selector reads nothing of the boy before his family says so", (await passport(PILLAY, sel)).length === 0);
    const notHis = await consent(parent, PILLAY, far);
    ok("his mother cannot name another province's union, and is told why", notHis.status === 422 && notHis.body?.error === "not_his_union");
    ok("...nor, at sixteen, can the boy name his own", (await consent(boy, PILLAY, kzn)).status === 403);
    // db/124 §6 Q4 (Kameel, 30 Oct 2026): a school, his union or CSA Schools;
    // a club or an academy is refused until Kameel decides on them.
    const club = (await q(`insert into school (code, name, kind) values ('WALKCLUB', 'Walk Cricket Club', 'club') returning id`))[0].id;
    const asClub = await consent(parent, PILLAY, club);
    ok("his mother cannot name a club, and is told why", asClub.status === 422 && asClub.body?.error === "not_a_school");
    const offered = (await api(`/api/read/passport_recipients?playerId=${PILLAY}`, { token: parent })).body?.rows ?? [];
    ok("what she may name is every school, his union and CSA Schools: not the far union, not the club",
       offered.some((s) => s.id === WES && s.kind === "school") && offered.some((s) => s.id === kzn)
       && !offered.some((s) => s.id === far || s.id === club) && offered.every((s) => ["school", "union", "federation"].includes(s.kind)));
    ok("...and nobody but his family is told which union is his",
       ((await api(`/api/read/passport_recipients?playerId=${PILLAY}`, { token: otherMum })).body?.rows ?? []).length === 0
       && ((await api(`/api/read/passport_recipients?playerId=${PILLAY}`, { token: wes })).body?.rows ?? []).length === 0);
    const u = await consent(parent, PILLAY, kzn);
    ok("his mother names his union", u.status === 200);
    const seen = await passport(PILLAY, sel);
    ok("...and its named selector reads his full passport, each line with its source", seen.length > 0 && seen.some((l) => l.family === "cap") && seen.every((l) => l.source_school === "Hilton College" && l.confidence));
    ok("...the cricket record only", !JSON.stringify(seen).match(/injur|address|id_number|note|rating/i));
    ok("a competition organiser at the union reads none", (await passport(PILLAY, org)).length === 0);
    ok("...nor the consent naming the union", ((await api("/api/read/passport_consents", { token: org })).body?.rows ?? []).length === 0);
    ok("the selector reads none of his profile", ((await api("/api/read/players", { token: sel })).body?.rows ?? []).every((p) => p.id !== PILLAY));
    const reads = (await api("/api/read/passport_union_reads", { token: parent })).body?.rows ?? [];
    ok("his mother sees who at which union looked, and when",
       reads.length === 1 && reads[0].player_id === PILLAY && reads[0].reader_name === "Walk Selector"
       && reads[0].reader_role === "Union Selector" && reads[0].organisation === "Walk KZN Cricket Union" && !!reads[0].read_at);
    ok("...and so does the boy himself", ((await api("/api/read/passport_union_reads", { token: boy })).body?.rows ?? []).length === 1);
    ok("...not another family", ((await api("/api/read/passport_union_reads", { token: otherMum })).body?.rows ?? []).length === 0);
    ok("...nor the selector, nor his own coach",
       ((await api("/api/read/passport_union_reads", { token: sel })).body?.rows ?? []).length === 0
       && ((await api("/api/read/passport_union_reads", { token: coach })).body?.rows ?? []).length === 0);
    ok("...and the read is in his school's access log",
       (await q(`select count(*)::int as n from access_log where resource = 'passport_union' and $1 = any (record_ids)`, [PILLAY]))[0].n === 1);
    {
      // db/124 §6 Q2 (Kameel, 30 Oct 2026): a selector who is also his coach
      // reads as his coach, and nothing is written to the union's log.
      const side = (await q(`select school_id, team_code from player where id = $1`, [PILLAY]))[0];
      const both = (await q(`insert into app_user (school_id, email, name, role) values ($1, 'coach.selector.walk@example.invalid', 'Walk Coach Selector', 'coach') returning id`, [side.school_id]))[0].id;
      await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'coach', $2, $3)`, [both, side.school_id, side.team_code]);
      await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'unionselector', $2)`, [both, kzn]);
      const bothTok = await login("coach.selector.walk@example.invalid");
      ok("a union selector who is also his coach reads his passport", (await passport(PILLAY, bothTok)).length > 0);
      ok("...as his coach: no union read is written, and his family's list is unchanged",
         (await q(`select count(*)::int as n from passport_union_read where player_id = $1`, [PILLAY]))[0].n === 1
         && (await q(`select count(*)::int as n from access_log where resource = 'passport_union' and $1 = any (record_ids)`, [PILLAY]))[0].n === 1
         && ((await api("/api/read/passport_union_reads", { token: parent })).body?.rows ?? []).length === 1);
    }
    {
      // db/125, the union selector's list (docs/design/UNION_SELECTOR_FIND.md
      // S2; Kameel, 30 Oct 2026, all six as recommended): the boys whose
      // consent to his union is in force, by school or age group, each row a
      // logged read his family sees; kept nowhere, and never a file.
      const hil = (await q(`select school_id from player where id = $1`, [PILLAY]))[0].school_id;
      const listed = (tok, qs) => api(`/api/read/passport_union_list?${qs}`, { token: tok });
      const noStore = (r) => /no-store/.test(r.headers?.get("cache-control") ?? "");
      const what = async () => {
        const rows = (await api("/api/read/passport_union_reads", { token: parent })).body?.rows ?? [];
        return { list: rows.filter((r) => r.what === "list").length, passport: rows.filter((r) => r.what === "passport").length };
      };
      const orgs = await api("/api/read/passport_union_orgs", { token: sel });
      ok("the selector reads as a union at his union, and only there, not kept",
         orgs.status === 200 && orgs.body?.rows?.length === 1 && orgs.body.rows[0].org_id === kzn && noStore(orgs));
      ok("...the union's organiser at none",
         ((await api("/api/read/passport_union_orgs", { token: org })).body?.rows ?? []).length === 0);
      const schools = await api(`/api/read/passport_union_schools?org=${kzn}`, { token: sel });
      ok("he may filter by his province's schools, not kept",
         schools.status === 200 && schools.body.rows.some((r) => r.school_id === hil) && !schools.body.rows.some((r) => r.school_id === far) && noStore(schools));
      const everyone = await listed(sel, `org=${kzn}`);
      ok("a list of everyone is refused, in words", everyone.status === 422 && everyone.body?.error === "choose_a_school_or_age_group" && noStore(everyone));
      ok("...and a name alone is no filter", (await listed(sel, `org=${kzn}&q=pillay`)).status === 422);
      ok("...nor a malformed school", (await listed(sel, `org=${kzn}&school=not-a-uuid`)).status === 400);
      const before = await what();
      const l1 = await listed(sel, `org=${kzn}&school=${hil}`);
      const row = (l1.body?.rows ?? []).find((r) => r.player_id === PILLAY);
      const name = (await q(`select full_name from player where id = $1`, [PILLAY]))[0].full_name;
      ok("the selector lists the boy at his school, not kept", l1.status === 200 && !!row && noStore(l1));
      ok("...his name is passport_name()'s, his school and side, and the union that admits him",
         row?.name === name && row?.school_name === "Hilton College" && !!row?.team_code && row?.org_id === kzn && !!row?.consent_id);
      ok("...and no figure: the row is six columns",
         !!row && Object.keys(row).sort().join(",") === "consent_id,name,org_id,player_id,school_name,team_code");
      ok("his mother's list of who looked gains the list, and nothing else yet",
         (await what()).list === before.list + 1 && (await what()).passport === before.passport);
      ok("...his school's auditors see one list row naming him",
         (await q(`select count(*)::int as n from access_log where resource = 'passport_union' and fields = '{list}' and $1 = any (record_ids)`, [PILLAY]))[0].n === 1);
      await passport(PILLAY, sel);
      ok("opening the passport from the row adds a passport read", (await what()).passport === before.passport + 1);
      await listed(sel, `org=${kzn}&school=${hil}`);
      ok("a second list writes a second set of rows", (await what()).list === before.list + 2);
      ok("a name fragment narrows within the list",
         ((await listed(sel, `org=${kzn}&school=${hil}&q=pillay`)).body?.rows ?? []).some((r) => r.player_id === PILLAY)
         && ((await listed(sel, `org=${kzn}&school=${hil}&q=nobody-by-this-name`)).body?.rows ?? []).length === 0);
      const afterQ = await what();
      ok("the organiser lists nobody, and nothing is logged",
         ((await listed(org, `org=${kzn}&school=${hil}`)).body?.rows ?? []).length === 0 && (await what()).list === afterQ.list);
      const ex = await api(`/api/export/passport_union_list?org=${kzn}&school=${hil}`, { token: sel });
      ok("the list never leaves as a file", ex.status === 403 && ex.body?.error === "not_exported");
      ok("...nor the passport", (await api(`/api/export/passport?playerId=${PILLAY}`, { token: sel })).status === 403);
      ok("...and refusing the file logged no list", (await what()).list === afterQ.list);
    }
    ok("the family's consents list the union by name",
       ((await api("/api/read/passport_consents", { token: parent })).body?.rows ?? []).some((x) => x.to_school_id === kzn && x.to_school === "Walk KZN Cricket Union" && x.in_force === true));
    ok("the boy, at sixteen, takes the union's name back", (await api(`/api/passport/consent/${u.body?.id}/withdraw`, { method: "POST", token: boy })).body?.withdrawn === 1);
    ok("...and the selector reads nothing again", (await passport(PILLAY, sel)).length === 0);
    const hilAfter = (await q(`select school_id from player where id = $1`, [PILLAY]))[0].school_id;
    ok("...nor lists him", !((await api(`/api/read/passport_union_list?org=${kzn}&school=${hilAfter}`, { token: sel })).body?.rows ?? []).some((r) => r.player_id === PILLAY));
  }
  // db/125 §5 (1) (Kameel, 30 Oct 2026, the seams audit's call 1; READERS Q1):
  // from his eighteenth birthday his guardian gives no new yes, for his record
  // or for scouts; her "no" still counts. Said in words on both routes.
  group("From his eighteenth birthday the yes is his");
  {
    const hil = (await q(`select school_id from player where id = $1`, [PILLAY]))[0].school_id;
    const office = (await q(`select id from app_user where email = 'registrar@example.invalid'`))[0]?.id
                ?? (await q(`select person_id as id from role_assignment where role = 'schooladmin' and school_id = $1 limit 1`, [hil]))[0].id;
    const adult = (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                            values ($1, '1XI', 'Walk Of Age', 1259, 'batter', ((now() at time zone 'Africa/Johannesburg')::date - interval '18 years 1 month')::date)
                            returning id`, [hil]))[0].id;
    const mumId = (await q(`insert into app_user (school_id, email, name, role) values ($1, 'mum.ofage.walk@example.invalid', 'Walk Of Age Mum', 'guardian') returning id`, [hil]))[0].id;
    const asg = (await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [mumId, hil]))[0].id;
    await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                             consent_state, consent_version, consent_at, created_by, valid_from)
             values ($1, $2, 'parent', 'verified', $3, now(), 'granted', 'popia-2026-01', now(), $3, current_date - 30)`, [asg, adult, office]);
    const mum = await login("mum.ofage.walk@example.invalid");
    const named = await consent(mum, adult, WES);
    ok("his mother cannot name a school for him at eighteen, and is told why", named.status === 422 && named.body?.error === "he_is_of_age");
    const yes = await api(`/api/players/${adult}/scouting-consent`, { method: "POST", token: mum, body: { granted: true } });
    ok("...nor say yes to scouts, told the same", yes.status === 403 && yes.body?.error === "he_is_of_age");
    const no = await api(`/api/players/${adult}/scouting-consent`, { method: "POST", token: mum, body: { granted: false } });
    ok("...her no still counts", no.status === 200);
    ok("...and a boy of sixteen's mother still names a school as before", (await consent(parent, PILLAY, WES)).status === 200);
  }
  group("Provenance is honest about who stood behind a line");
  {
    const lines = await passport(WHITFIELD, coach);
    ok("a seeded honour with nobody's signature says so", lines.some((l) => l.family === "honour" && l.confidence === "seeded" && /nobody on record/.test(l.recorded_by)));
    const head = await login("sarah@example.invalid");
    await api("/api/honours", { method: "POST", token: head, body: { playerId: WHITFIELD, kind: "honours", season: "2026" } });
    ok("an honour signed by a named person is verified, and names her", (await passport(WHITFIELD, coach)).some((l) => l.family === "honour" && l.confidence === "verified" && /Sarah Mokoena/.test(l.recorded_by)));
    await api(`/api/players/${WHITFIELD}/assessment`, { method: "POST", token: coach, body: { scores: { mental: { composure: 12 } } } });
    // db/116 (A1; GA-I26a): a coach's score and his name are a judgement, and
    // never travel on the passport, to his own coach or anybody else.
    ok("a rating never rides on the passport, nor the coach who gave it",
       !(await passport(WHITFIELD, coach)).some((l) => l.family === "rating"));
  }
  ok("the server logged no errors", serverErr.join("").trim() === "");
} catch (e) { fail++; console.log("  ✗ threw:", e.message); }
finally { server.kill(); await pool.end(); }
console.log(`\n${"─".repeat(52)}\nPASSPORT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

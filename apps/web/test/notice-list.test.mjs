/**
 * Notices as a list a person reads (redesign slice 17, DESIGN_DIRECTION Flow C; lib/noticeList.js), held here
 * without a server:
 *
 *   - THE DAY IS JOHANNESBURG'S. "Today", "Yesterday", "Mon 23 Nov", by the SA day, on either side of midnight
 *     SAST (22:00 UTC), whatever zone the device is set to; the year when it is not this one;
 *   - the subject's link, per reader: a parent's and a pupil's only ever their own app's destinations, never a
 *     staff screen; a pupil's health link only for his own injury; none on a withdrawn notice, a safeguarding
 *     notice, a "confirm the result" notice or a subject with no screen; and following one only navigates;
 *   - the school: named only when the reader's notices come from more than one, never by its id;
 *   - the two screens draw the parts from one place, and keep the hooks the walks hold.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/notice-list.test.mjs
 */
import { readFileSync } from "node:fs";
import { byDay, dayBefore, dayWords, followSubject, schoolNames, schoolOf, subjectLink, timeWords } from "../src/lib/noticeList.js";
import { fixtureDoorTo, peekFixtureDoor, takeDoor, takeFixtureDoor } from "../src/lib/family.js";
import { clearCoach, peekCoach } from "../src/lib/cockpitNav.js";
import { peekFix, requestFix } from "../src/lib/fixNote.js";
import { NAV_META } from "../src/design/roles.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const at = (iso) => Date.parse(iso);

group("Day groups: Johannesburg's day, either side of midnight SAST");
{
  // 00:30 on Thursday 26 Nov in Johannesburg is 22:30 on Wednesday 25 Nov in UTC.
  const now = at("2026-11-25T22:30:00Z");
  const rows = [
    { id: "a", time: "2026-11-25T22:10:00Z" },   // 00:10 SAST, Thu 26 Nov: today
    { id: "b", time: "2026-11-25T21:50:00Z" },   // 23:50 SAST, Wed 25 Nov: yesterday, though UTC's day is the same as a's
    { id: "c", time: "2026-11-24T22:00:00Z" },   // 00:00 SAST, Wed 25 Nov: yesterday too, though UTC calls it the 24th
    { id: "d", time: "2026-11-24T21:59:59Z" },   // 23:59:59 SAST, Tue 24 Nov
    { id: "e", time: "2026-11-23T08:00:00Z" },   // Mon 23 Nov
  ];
  const g = byDay(rows, now);
  ok("five notices, four SA days, newest first", g.map((x) => x.day).join() === "2026-11-26,2026-11-25,2026-11-24,2026-11-23", g.map((x) => x.day));
  ok("...Today, Yesterday, then the weekday and the date in words", g.map((x) => x.words).join("|") === "Today|Yesterday|Tue 24 Nov|Mon 23 Nov", g.map((x) => x.words));
  ok("a notice at 00:10 SAST is today's, though UTC still says yesterday", g[0].rows.map((r) => r.id).join() === "a");
  ok("one at 23:50 SAST, and one at 00:00 SAST the day before, are both yesterday's", g[1].rows.map((r) => r.id).join() === "b,c", g[1].rows.map((r) => r.id));
  ok("one second before midnight SAST is the day before that", g[2].rows.map((r) => r.id).join() === "d");
  ok("...its time on the SA clock: 23:59, and 00:10 for the first", timeWords(rows[3].time) === "23:59" && timeWords(rows[0].time) === "00:10", [timeWords(rows[3].time), timeWords(rows[0].time)]);

  // One minute to midnight SAST on the Thursday: 21:59 UTC. Everything since 22:00 UTC on Wednesday is today's.
  const late = at("2026-11-26T21:59:00Z");
  const h = byDay([{ id: "x", time: "2026-11-26T21:58:00Z" }, { id: "y", time: "2026-11-25T22:00:00Z" }, { id: "z", time: "2026-11-25T21:59:00Z" }], late);
  ok("at 23:59 SAST, 23:58 and 00:00 are today's and 23:59 the night before is yesterday's",
     h.map((x) => `${x.words}:${x.rows.map((r) => r.id).join("")}`).join() === "Today:xy,Yesterday:z", h.map((x) => `${x.words}:${x.rows.map((r) => r.id).join("")}`));
  // ...and a minute later it is Friday in Johannesburg: Thursday's notices are yesterday's.
  const next = at("2026-11-26T22:01:00Z");
  ok("at 00:01 SAST on Friday, Thursday's notices are yesterday's", byDay([{ id: "x", time: "2026-11-26T21:58:00Z" }], next)[0].words === "Yesterday");

  // The device's zone changes nothing: the same instants, the same groups.
  const before = process.env.TZ;
  const seen = [];
  for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Africa/Johannesburg", "Asia/Kolkata"]) {
    process.env.TZ = tz;
    seen.push(byDay(rows, now).map((x) => `${x.words}:${x.rows.map((r) => r.id).join("")}`).join());
  }
  if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  ok("the device's zone changes nothing (UTC, Los Angeles, Kiritimati, Johannesburg, Kolkata)", new Set(seen).size === 1, seen);
}

group("Day words");
{
  const now = at("2026-11-26T10:00:00Z");
  ok("Today and Yesterday", dayWords("2026-11-26", now) === "Today" && dayWords("2026-11-25", now) === "Yesterday");
  ok("then the weekday and the date in words, three letters each", dayWords("2026-11-23", now) === "Mon 23 Nov" && dayWords("2026-09-05", now) === "Sat 5 Sep", [dayWords("2026-11-23", now), dayWords("2026-09-05", now)]);
  ok("...with the year when it is not this one", dayWords("2025-12-30", now) === "Tue 30 Dec 2025", dayWords("2025-12-30", now));
  ok("New Year's Day: yesterday is last year's 31 December", dayWords("2026-12-31", at("2027-01-01T08:00:00Z")) === "Yesterday");
  ok("the day before, across a month and a leap day", dayBefore("2026-03-01") === "2026-02-28" && dayBefore("2028-03-01") === "2028-02-29" && dayBefore("2027-01-01") === "2026-12-31");
}

group("Rows the day cannot be read from, and the order inside a day");
{
  const g = byDay([
    { id: "demo", time: "2h ago" },
    { id: "new", time: "2026-11-26T09:00:00Z" },
    { id: "old", time: "2026-11-20T09:00:00Z" },
    { id: "new2", time: "2026-11-26T07:00:00Z" },
    { id: "none", time: null },
  ], at("2026-11-26T10:00:00Z"));
  ok("undated rows (the demonstration's \"2h ago\") are last, with no heading", g.at(-1).day === null && g.at(-1).words === null && g.at(-1).rows.map((r) => r.id).join() === "demo,none");
  ok("...and newest day first, each day's rows in the order they came", g[0].rows.map((r) => r.id).join() === "new,new2" && g[1].words === "Fri 20 Nov", g.map((x) => x.words));
  ok("a time the demonstration wrote in words is said as written", timeWords("2h ago") === "2h ago" && timeWords(null) === "" && timeWords("2026-11-26") === "");
  ok("an empty list is no groups", byDay([], Date.now()).length === 0 && byDay(null).length === 0);
  ok("a row's own field can be named", byDay([{ at: "2026-11-26T09:00:00Z" }], at("2026-11-26T10:00:00Z"), (r) => r.at)[0].words === "Today");
}

// ── The subject ─────────────────────────────────────────────────────
const N = (over = {}) => ({ id: "n1", type: "fixture", title: "Fixture moved", subjectKind: "match", subjectId: "m1", subjectPerson: null, retracts: null, ...over });
const STAFF_NAV = ["dashboard", "matches", "squad", "injuries", "news", "readiness"];
const FAMILY_NAV = ["children", "fixtures", "notices", "family"];
const PUPIL_NAV = ["myhome", "mymatches", "passport", "me"];
const FAMILY_APP = new Set(FAMILY_NAV), PUPIL_APP = new Set(PUPIL_NAV);
const KINDS = ["match", "injury", "news", "training", "transport", "facility", "skills", "system", "competition", "selection", "welfare"];

group("The subject's link: staff");
{
  const coach = { persona: null, nav: STAFF_NAV };
  const m = subjectLink(N(), coach);
  ok("a fixture's notice: See the fixture, in the Match Centre", m?.to === "matches" && m.words === "See the fixture" && m.match === "m1", m);
  const i = subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj1", subjectPerson: "p1" }), coach);
  ok("an injury: Injuries, landed on that injury's row", i?.to === "injuries" && i.find === '[data-testid="injury-inj1"]', i);
  ok("a post's notice: the Newsfeed", subjectLink(N({ type: "notice", subjectKind: "news", subjectId: "post1" }), coach)?.to === "news");
  ok("a reader whose menu has no Injuries is offered no injury link", subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj1" }), { persona: null, nav: ["dashboard", "matches"] }) === null);
  ok("...and one with no Match Centre no fixture link", subjectLink(N(), { persona: null, nav: ["dashboard"] }) === null);
  ok("no link for a subject with no one screen (training, transport, a facility, skills, the system, a competition, a selection, welfare)",
     ["training", "transport", "facility", "skills", "system", "competition", "selection", "welfare"].every((k) => subjectLink(N({ subjectKind: k }), coach) === null));
}

group("The subject's link: never on a withdrawn notice, a safeguarding notice, or one with its own door");
{
  const coach = { persona: null, nav: STAFF_NAV };
  ok("the system's \"A notice was withdrawn\" has none", subjectLink(N({ retracts: "n0", title: "A notice was withdrawn" }), coach) === null);
  ok("a safeguarding notice has none (a DSO's has Open the inbox)", subjectLink(N({ type: "safeguarding", subjectKind: "match" }), coach) === null);
  ok("\"…is decided. Confirm the result.\" has none (it has Confirm the result)",
     subjectLink(N({ title: "U13E v Westville Boys' High 1XI is decided. Confirm the result." }), coach) === null);
  ok("a notice with no subject, or a subject with no id, has none", subjectLink(N({ subjectKind: null }), coach) === null && subjectLink(N({ subjectId: null }), coach) === null);
  ok("nothing at all for no notice", subjectLink(null, coach) === null);
  const views = ["../src/views/NotificationsView.jsx", "../src/views/family/family.jsx"].map(src);
  ok("both screens offer it only once the open answered with the notice itself (never a withdrawn stub, gone or failed)",
     views.every((v) => /const settled = (got|o) \? !\(\w+\.gone \|\| \w+\.withdrawn \|\| \w+\.failed\)/.test(v) && /isOpen && settled/.test(v)));
}

group("The subject's link: a parent sees no staff destination, and only her own child's health");
{
  const kids = [{ id: "k1" }, { id: "k2" }];
  const her = { persona: "family", nav: FAMILY_NAV, kids };
  const m = subjectLink(N({ subjectPerson: "k2" }), her);
  ok("a fixture's notice about her child: See the fixture, on her Matches, for him", m?.to === "fixtures" && m.words === "See the fixture" && m.match === "m1" && m.child === "k2", m);
  ok("...a side's notice about nobody: her Matches, the child she has chosen", subjectLink(N(), her)?.child === null);
  const i = subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj1", subjectPerson: "k1" }), her);
  ok("an injury to her child: See his health history, on Family, his Health opened and landed on",
     i?.to === "family" && i.words === "See his health history" && i.door?.child === "k1" && i.door.panel === "health" && i.find === '[data-testid="family-open-health-k1"]', i);
  ok("an injury notice about somebody else's child is offered nothing", subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj9", subjectPerson: "k9" }), her) === null);
  ok("a post's notice: nothing (her app has no Newsfeed)", subjectLink(N({ type: "notice", subjectKind: "news", subjectId: "post1" }), her) === null);
  // Even a menu that somehow listed staff screens: a family reader is never sent to one.
  const wide = { persona: "family", nav: [...FAMILY_NAV, ...STAFF_NAV], kids };
  const to = KINDS.flatMap((k) => [subjectLink(N({ subjectKind: k, subjectPerson: "k1" }), wide)?.to]).filter(Boolean);
  ok("...whatever her menu held, every link is to her own app (Matches, Family)", to.length > 0 && to.every((t) => FAMILY_APP.has(t)), to);
  ok("...and with no Family on her menu, no health link", subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj1", subjectPerson: "k1" }), { persona: "family", nav: ["children", "fixtures", "notices"], kids }) === null);
}

group("The subject's link: a pupil sees only his own");
{
  const him = { persona: "pupil", nav: PUPIL_NAV, self: "p1" };
  const m = subjectLink(N(), him);
  ok("a fixture's notice: See the fixture, on his Matches", m?.to === "mymatches" && m.words === "See the fixture" && m.match === "m1", m);
  const i = subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj1", subjectPerson: "p1" }), him);
  ok("his own injury: See your health history, on his Me", i?.to === "me" && i.words === "See your health history", i);
  ok("an injury notice about a team-mate is offered nothing", subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj2", subjectPerson: "p2" }), him) === null);
  ok("...nor one about nobody", subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj3" }), him) === null);
  ok("...nor any, when his own record is not known", subjectLink(N({ type: "injury", subjectKind: "injury", subjectId: "inj1", subjectPerson: "p1" }), { ...him, self: null }) === null);
  ok("a post's notice: nothing (his app has no Newsfeed)", subjectLink(N({ type: "notice", subjectKind: "news", subjectId: "post1" }), him) === null);
  const wide = { persona: "pupil", nav: [...PUPIL_NAV, ...STAFF_NAV], self: "p1" };
  const to = KINDS.flatMap((k) => [subjectLink(N({ subjectKind: k, subjectPerson: "p1" }), wide)?.to]).filter(Boolean);
  ok("...whatever his menu held, every link is to his own app (Matches, Me)", to.length > 0 && to.every((t) => PUPIL_APP.has(t)), to);
}

group("Following a link only navigates; the screen it opens decides");
{
  /** @type {string[]} */
  const went = [];
  const go = (/** @type {string} */ p) => went.push(p);
  clearCoach();
  followSubject({ to: "matches", words: "See the fixture", match: "m1" }, go);
  ok("staff: the Match Centre is asked for the fixture, and opened", peekCoach()?.matchId === "m1" && peekCoach()?.view === "result" && went.at(-1) === "matches");
  clearCoach();
  followSubject({ to: "injuries", words: "See the injury", find: '[data-testid="injury-inj1"]' }, go);
  ok("...Injuries, with a note to land on the row (found only if the screen draws it)", peekFix()?.page === "injuries" && peekFix()?.find[0] === '[data-testid="injury-inj1"]' && went.at(-1) === "injuries");
  requestFix(/** @type {any} */ (null));
  followSubject({ to: "family", words: "See his health history", door: { child: "k1", panel: "health" }, find: '[data-testid="family-open-health-k1"]' }, go);
  ok("a parent: Family, his card's Health opened", takeDoor("k1") === "health" && went.at(-1) === "family");
  requestFix(/** @type {any} */ (null));
  followSubject({ to: "fixtures", words: "See the fixture", match: "m2", child: "k2" }, go);
  ok("a parent: her Matches, the door naming the fixture and her child", peekFixtureDoor()?.match === "m2" && peekFixtureDoor()?.child === "k2" && went.at(-1) === "fixtures");

  const KID = { id: "k2", school: "s1", team: "1XI" };
  const NOW = at("2026-11-26T10:00:00Z");
  const M = [
    { id: "m2", schoolId: "s1", homeTeam: "1XI", status: "upcoming", startsAt: "2026-11-28T07:00:00Z" },
    { id: "m3", schoolId: "s1", homeTeam: "1XI", status: "complete", startsAt: "2026-11-21T07:00:00Z" },
    { id: "m4", schoolId: "s1", homeTeam: "U15A", status: "upcoming", startsAt: "2026-11-28T07:00:00Z" },
  ];
  ok("his Matches takes the door: a fixture to come opens its detail", takeFixtureDoor(M, KID, NOW)?.kind === "fixture");
  ok("...once: the door is spent", takeFixtureDoor(M, KID, NOW) === null);
  fixtureDoorTo("m3", "k2");
  ok("...a played one opens its match", takeFixtureDoor(M, KID, NOW)?.match?.id === "m3");
  fixtureDoorTo("m4", "k2");
  ok("...a fixture not among his own is not opened", takeFixtureDoor(M, KID, NOW) === null && peekFixtureDoor() === null);
  fixtureDoorTo("m2", "k1");
  ok("...nor is a door left for another of her children", takeFixtureDoor(M, KID, NOW) === null);
  fixtureDoorTo("m2", null);
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  ok("...and a door the next screen did not take within seconds is not taken later", peekFixtureDoor() === null && takeFixtureDoor(M, KID, NOW) === null);
  Date.now = realNow;
  ok("nothing the follow did is a grant: it leaves notes and calls the shell's navigation, and the views hand it only setPage",
     !/api\(|fetch\(/.test(src("../src/lib/noticeList.js")) && /notices:\s*<FamilyNotices\s+role=\{role\} onNav=\{setPage\}\/>/.test(src("../src/App.jsx")));
}

group("The school: named only when her notices come from two");
{
  const names = new Map([["s1", "Hilton College"], ["s2", "St Anne's"]]);
  const one = [{ id: 1, school: "s1" }, { id: 2, school: "s1" }, { id: 3, school: null }];
  ok("one school: no notice names it", one.every((n) => schoolOf(one, names)(n) === null));
  const two = [{ id: 1, school: "s1" }, { id: 2, school: "s2" }, { id: 3, school: "s1" }];
  const named = two.map((n) => schoolOf(two, names)(n));
  ok("two schools: each notice names its own", named.join("|") === "Hilton College|St Anne's|Hilton College", named);
  ok("...a school whose name is not held is not named at all, never by its id",
     schoolOf([...two, { id: 4, school: "s3" }], names)({ school: "s3" }) === null);
  ok("...and the rows are not joined, summed or reordered: the list is drawn as it came", JSON.stringify(two) === JSON.stringify([{ id: 1, school: "s1" }, { id: 2, school: "s2" }, { id: 3, school: "s1" }]));
  const fromKids = schoolNames([{ school: "s1", schoolName: "Hilton College" }, { school: "s2", schoolName: "Westville Boys' High" }, { school: "s1", schoolName: "Other" }, { school: null, schoolName: "None" }]);
  ok("her children's schools give their names (the first word for a school stands)", fromKids.get("s1") === "Hilton College" && fromKids.get("s2") === "Westville Boys' High" && fromKids.size === 2, [...fromKids]);
  const fam = src("../src/views/family/family.jsx");
  ok("Family's Notices names schools from her own children's rows, and the count stays the server's",
     /schoolOf\(notes, schoolNames\(kids\)\)/.test(fam) && /counted \? `\$\{counted\} unread` : "Nothing unread"/.test(fam));
}

group("One word, one set of parts, the walks' hooks kept");
{
  ok("the bell's destination is named Notices for everyone", NAV_META.notifications.label === "Notices" && NAV_META.notices.label === "Notices");
  const staff = src("../src/views/NotificationsView.jsx"), fam = src("../src/views/family/family.jsx"), parts = src("../src/views/noticeParts.jsx");
  ok("the screen's title is Notices", /<SectionHeader title="Notices"/.test(staff) && /<Title>Notices<\/Title>/.test(fam));
  ok("both screens group by the one helper and draw the one set of parts",
     [staff, fam].every((v) => /byDay\(/.test(v) && /<DayHeading/.test(v) && /<UnreadDot\/>/.test(v) && /<UnreadWord\/>/.test(v) && /<ReportButton/.test(v) && /<SubjectLink/.test(v) && /<SchoolLine/.test(v)));
  ok("the unread word is in the title's own button, so a screen reader hears it with the title",
     /\{n\.title\}\{!n\.read && <UnreadWord\/>\}/.test(staff) && /\{i\.title\}\{i\.unread && <UnreadWord\/>\}/.test(fam) && /className="sr-only"[^>]*>\. Unread</.test(parts));
  ok("the dot is hidden from a screen reader (the word says it)", /aria-hidden="true" data-testid="notice-dot"/.test(parts));
  ok("Report: still notice-report, one tap, only where reportable() says, a quiet text button (no border, no pill)",
     /data-testid="notice-report"/.test(parts) && /border: "none"/.test(parts) && !/radius\.pill/.test(parts)
     && /reportable\(n\) && !reported\[n\.id\]\?\.done && \(\s*<ReportButton/.test(staff) && /i\.reportable && !reported\[i\.id\]\?\.done && \(\s*<ReportButton/.test(fam)
     && [staff, fam].every((v) => /data-testid="notice-reported"/.test(v)));
  ok("every part's control is at least 44 by 44", (parts.match(/min(Height|Width): "(\d+)px"/g) ?? []).every((m) => parseInt(m.split('"')[1], 10) >= 44) && /minHeight: "44px", minWidth: "44px"/.test(parts));
  ok("nothing in the parts is set under 12px", (parts.match(/fontSize: "(\d+)px"/g) ?? []).every((m) => parseInt(m.split('"')[1], 10) >= 12));
  ok("the rows keep their hooks", ["notice-row", "notice-open", "notice-body", "notice-sentence", "notifications-read-state", "notifications-mark-all"].every((t) => staff.includes(`"${t}"`))
     && ["family-notices", "notice", "notice-open", "notice-about", "notice-body", "family-notices-mark-all"].every((t) => fam.includes(`"${t}"`)));
}

console.log(`\nNOTICE LIST: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

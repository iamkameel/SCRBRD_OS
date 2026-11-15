/**
 * "Ask SCRBRD to add my school" (EXPERIENCE_PASS §2.7, Q22; db/158).
 *
 *   - Every refusal either door of db/158 can give has a status in the route
 *     (services/api/write/requests-api.mjs) and a plain sentence on the screen
 *     (lib/schoolAsk.js), by code; no sentence is a code.
 *   - The job list is db/158's CHECK, the route's and the screen's, the same
 *     seven, and "pupil" is none of them.
 *   - The note is the school's name and town and a job: no other free text.
 *   - Every state the read can give says what happens next.
 *   - The no-school home offers the note where the join list has no school,
 *     and shows the asker's notes under "Your requests"; the platform's list
 *     is drawn only for platform.tenant.manage.
 *
 *   node apps/web/test/school-ask.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  ASK_STATE_WORDS, ASK_WORDS, DECIDE_WORDS, JOBS, NAME_MAX, OPEN_DAYS, OPEN_MAX, TOWN_MAX,
  askSentWords, askWords, buildAsk, schoolDecideWords, schoolDecidedWords,
} from "../src/lib/schoolAsk.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const apiError = (status, code) => Object.assign(new Error(code), { status, code });
const plain = (w) => typeof w === "string" && /\s/.test(w) && !/_/.test(w) && /[.!?]$/.test(w.trim());

const SQL = read("../../../db/158_school_add_request.sql");
const API = read("../../../services/api/write/requests-api.mjs");
const fnBody = (name) => {
  const at = SQL.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  return at < 0 ? "" : SQL.slice(at, SQL.indexOf("$$ LANGUAGE", SQL.indexOf("$$", at) + 2));
};
const reasons = (body) => [...body.matchAll(/SELECT (?:true|false), '([a-z_]+)'::text/g)].map((m) => m[1]);
const statusMap = (name) => {
  const m = API.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\};`));
  return Object.fromEntries([...(m?.[1] ?? "").matchAll(/([a-z_]+):\s*(\d{3})/g)].map((x) => [x[1], Number(x[2])]));
};

group("Every refusal of the asker's door has a status and a sentence");
{
  const codes = reasons(fnBody("school_add_request_ask"));
  const status = statusMap("SCHOOL_ASK_STATUS");
  ok("the door's refusals were read (seven)", codes.length === 7, codes);
  for (const c of codes) {
    ok(`${c}: a status in the route`, Number.isInteger(status[c]) && status[c] >= 400 && status[c] < 500, status[c]);
    ok(`${c}: a plain sentence`, plain(ASK_WORDS[c]), ASK_WORDS[c]);
    ok(`${c}: askWords says it`, askWords(apiError(status[c], c)) === ASK_WORDS[c]);
  }
  ok("an unknown refusal is a plain sentence, not the code", plain(askWords(apiError(422, "who_knows"))) && !/who_knows/.test(askWords(apiError(422, "who_knows"))));
  ok("no answer at all says nothing was sent", /nothing was sent/.test(askWords(new Error("offline"))));
}

group("Every refusal of the platform's door has a status and a sentence");
{
  const codes = reasons(fnBody("school_add_request_decide"));
  const status = statusMap("SCHOOL_DECIDE_STATUS");
  ok("the door's refusals were read (five)", codes.length === 5, codes);
  for (const c of codes) {
    ok(`${c}: a status in the route`, Number.isInteger(status[c]) && status[c] >= 400 && status[c] < 500, status[c]);
    ok(`${c}: a plain sentence`, plain(DECIDE_WORDS[c]), DECIDE_WORDS[c]);
    ok(`${c}: schoolDecideWords says it`, schoolDecideWords(apiError(status[c], c)) === DECIDE_WORDS[c]);
  }
  ok("after an answer: added says the person can join, declined says it was not added",
     /can ask to join/.test(schoolDecidedWords("added", "Verify High")) && /has not added Verify High/.test(schoolDecidedWords("declined", "Verify High")));
}

group("One job list, and no pupil on it");
{
  const check = SQL.match(/school_add_request_job CHECK \(job IN \(([^)]*)\)\)/)?.[1] ?? "";
  const inSql = [...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const inDoor = [...(fnBody("school_add_request_ask").match(/p_job NOT IN \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const inApi = [...(API.match(/SCHOOL_ASK_JOBS = Object\.freeze\(\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  const inScreen = JOBS.map((j) => j.id);
  ok("db/158's CHECK, its door, the route and the screen list the same jobs",
     inSql.length === 7 && [inDoor, inApi, inScreen].every((l) => JSON.stringify(l) === JSON.stringify(inSql)), { inSql, inDoor, inApi, inScreen });
  ok("no pupil, player or child on it", !inScreen.some((j) => /pupil|player|child/.test(j)));
  ok("each job reads as a sentence about the person", JOBS.every((j) => /^(I|My|Something)/.test(j.label)));
}

group("The note a form becomes");
{
  const r = buildAsk({ name: "  Verify   High ", town: " Howick ", job: "coach" });
  ok("trimmed, spaces folded", r.ok && r.body.schoolName === "Verify High" && r.body.town === "Howick" && r.body.job === "coach", r);
  ok("only the three fields", r.ok && JSON.stringify(Object.keys(r.body).sort()) === JSON.stringify(["job", "schoolName", "town"]));
  ok("no name", !buildAsk({ name: " V ", town: "Howick", job: "coach" }).ok);
  ok("a long name", !buildAsk({ name: "V".repeat(NAME_MAX + 1), town: "Howick", job: "coach" }).ok);
  ok("no town", !buildAsk({ name: "Verify High", town: "H", job: "coach" }).ok);
  ok("a long town", !buildAsk({ name: "Verify High", town: "H".repeat(TOWN_MAX + 1), job: "coach" }).ok);
  ok("a job not on the list", !buildAsk({ name: "Verify High", town: "Howick", job: "pupil" }).ok);
  ok("the limits are db/158's", SQL.includes(`BETWEEN 2 AND ${NAME_MAX}`) && SQL.includes(`BETWEEN 2 AND ${TOWN_MAX}`));
  ok("the cap and the ninety days are db/158's", SQL.includes(`>= ${OPEN_MAX} THEN`) && SQL.includes(`interval '${OPEN_DAYS} days'`));
  ok("sent: names the school, says a person answers here and how to join after", /Verify High/.test(askSentWords(" Verify High ")) && /answer here/.test(askSentWords("x")) && /ask to join/.test(askSentWords("x")));
}

group("Every state says what happens next");
{
  const states = new Set(["open", "added", "declined", "lapsed"]);
  const stored = (SQL.match(/school_add_request_state CHECK \(state IN \(([^)]*)\)\)/)?.[1] ?? "").match(/'([a-z]+)'/g)?.map((x) => x.slice(1, -1)) ?? [];
  ok("the stored states and lapsed, the read's own", stored.length === 3 && stored.every((s) => states.has(s)) && /THEN 'lapsed'/.test(SQL), stored);
  for (const s of states) ok(`${s}: a plain sentence`, plain(ASK_STATE_WORDS[s]), ASK_STATE_WORDS[s]);
  ok("added sends the person to the list to join", /Join a school/.test(ASK_STATE_WORDS.added));
  ok("lapsed says they can ask again", /ask again/.test(ASK_STATE_WORDS.lapsed));
}

group("The screens");
{
  const form = read("../src/auth/schoolAsk.jsx");
  ok("the note has two text fields and a list, nothing else typed", (form.match(/<input /g) ?? []).length === 2 && /<select /.test(form) && !/<textarea/.test(form));
  ok("it posts to /api/school-requests and nowhere else", /post\("\/api\/school-requests"/.test(form) && !/\/api\/requests/.test(form));
  ok("its refusal is an alert", /role="alert" data-testid="school-ask-problem"/.test(form));
  const ns = read("../src/auth/NoSchool.jsx");
  ok("the empty search offers the note", /data-testid="join-school-none"/.test(ns) && /shown\.length === 0 && onAskSchool && <AskSchoolLink/.test(ns));
  ok("...and so does a list with no school in it, and the foot of a list", /schools\.length === 0 && onAskSchool && <AskSchoolLink/.test(ns) && /testId="join-school-missing"/.test(ns));
  ok("the no-school home reads its own notes and shows them under Your requests",
     /useLive\("school_add_requests"/.test(ns) && /\.filter\(\(r\) => r\.mine\)/.test(ns) && /<SchoolAskRows rows=\{askRows\}\/>/.test(ns));
  const mgmt = read("../src/views/ManagementView.jsx");
  ok("the platform's list only for platform.tenant.manage", /holdsCapability\(role,"platform\.tenant\.manage"\)&&<SchoolRequestsPanel\/>/.test(mgmt));
  const panel = read("../src/views/schoolRequests.jsx");
  ok("...with Added and Decline only on what the server calls decidable", /all\.filter\(\(r\) => r\.decidable\)/.test(panel)
     && /school-request-added-/.test(panel) && /school-request-decline-/.test(panel));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

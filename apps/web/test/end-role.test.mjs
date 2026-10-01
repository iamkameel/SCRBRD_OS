/**
 * "End this role" (SCRBRD-132 C1, db/77): EndRoleButton and its helpers.
 *
 *   - The reason's ten characters are asked for before the round trip, and a
 *     short one never reaches the server.
 *   - It posts { reason } to /api/assignments/:id/end, trimmed.
 *   - A refusal is shown in the server's own words (`detail`); a code with no
 *     words still says something; no answer at all says so.
 *   - Every code role_assignment_end() can answer has words at the route,
 *     and none of them is a raw code.
 *   - Drawn: the button for a live role, nothing for an ended one; the form
 *     with its refusal as an alert, and its busy state.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/end-role.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  EndRoleButton, EndRoleForm, END_ROLE_WORDS, REASON_MIN, endRole, reasonProblem, refusalWords, roleLine,
} from "../src/views/endrole.jsx";
import { END_ROLE_REFUSALS } from "../../../services/api/write/requests-api.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const COACH = { id: "5a1b2c3d-0000-4000-8000-000000000001", role: "coach", team_code: "U15A", person_name: "T Ndlovu", active: true };
const WHY = "Left the school at the end of term 3";

/** A stand-in for api(): records the call and answers as told. */
const fakePost = (answer) => {
  const calls = [];
  const post = async (path, opts) => {
    calls.push({ path, opts });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { post, calls };
};
const refusal = (status, code, detail) => Object.assign(new Error(code), { status, code, detail });

group("The reason, asked for before the round trip");
{
  ok("ten characters is the floor", REASON_MIN === 10);
  ok("an empty reason is a problem", reasonProblem("") === END_ROLE_WORDS.reason_required);
  ok("...and nine characters", reasonProblem("123456789") === END_ROLE_WORDS.reason_required);
  ok("...and padding around a short one", reasonProblem("   left   ") === END_ROLE_WORDS.reason_required);
  ok("ten will do", reasonProblem("1234567890") === null);
  const f = fakePost({ id: COACH.id, ended: true });
  const r = await endRole(COACH.id, "short", f.post);
  ok("a short reason is refused in words", !r.ok && r.code === "reason_required" && r.words === END_ROLE_WORDS.reason_required);
  ok("...and never reaches the server", f.calls.length === 0);
}

group("Posting, and the answer");
{
  const f = fakePost({ id: COACH.id, ended: true });
  const r = await endRole(COACH.id, `  ${WHY}  `, f.post);
  ok("an accepted end answers ok", r.ok === true);
  ok("...after one POST to the assignment's own route",
     f.calls.length === 1 && f.calls[0].path === `/api/assignments/${COACH.id}/end` && f.calls[0].opts.method === "POST");
  ok("...carrying the reason, trimmed", f.calls[0].opts.body.reason === WHY, JSON.stringify(f.calls[0].opts.body));

  const words = END_ROLE_REFUSALS.last_admin[1];
  const said = await endRole(COACH.id, WHY, fakePost(refusal(409, "last_admin", words)).post);
  ok("a refusal is shown in the server's own words", !said.ok && said.code === "last_admin" && said.words === words);
  const bare = await endRole(COACH.id, WHY, fakePost(refusal(500, "error", null)).post);
  ok("a refusal with no words still says it was not ended, and why", !bare.ok && /not ended \(error\)/.test(bare.words), bare.words);
  const gone = await endRole(COACH.id, WHY, fakePost(new TypeError("fetch failed")).post);
  ok("no answer at all says so, and to look again", !gone.ok && gone.words === END_ROLE_WORDS.unreachable);
  ok("refusalWords prefers detail over the code", refusalWords({ status: 403, code: "not_permitted", detail: "Words." }) === "Words.");
}

group("Every answer role_assignment_end() gives has words at the route");
{
  const sql = readFileSync(new URL("../../../db/77_role_assignment_end.sql", import.meta.url), "utf8");
  const codes = new Set([...sql.matchAll(/SELECT false, '([a-z_]+)'/g)].map((m) => m[1]));
  for (const m of sql.matchAll(/THEN '([a-z_]+)' ELSE '([a-z_]+)'/g)) { codes.add(m[1]); codes.add(m[2]); }
  ok("the file answers at least the ten refusals the design names", codes.size >= 10, [...codes].join(" "));
  const missing = [...codes].filter((c) => !END_ROLE_REFUSALS[c]);
  ok("each has a status and a sentence", missing.length === 0, missing.join(" "));
  const raw = Object.entries(END_ROLE_REFUSALS).filter(([, [s, w]]) => !(s >= 400 && s < 500) || !/\s/.test(w) || /_/.test(w));
  ok("...a 4xx, and words rather than a code", raw.length === 0, raw.map(([c]) => c).join(" "));
  const leak = Object.values(END_ROLE_REFUSALS).filter(([, w]) => /\{|\$|%s/.test(w));
  ok("...with nothing interpolated into them", leak.length === 0);
}

group("Drawn");
{
  ok("roleLine says the role and the side", roleLine(COACH) === "Coach, U15A", roleLine(COACH));
  ok("...and a role with no side alone", roleLine({ role: "schooladmin" }) === "School Admin");
  const live = renderToStaticMarkup(h(EndRoleButton, { assignment: COACH }));
  ok("a live role shows the button", /data-testid="end-role"/.test(live) && />End role</.test(live), live);
  ok("...named for the role it ends", /aria-label="End Coach, U15A"/.test(live));
  ok("an ended role shows nothing", renderToStaticMarkup(h(EndRoleButton, { assignment: { ...COACH, active: false } })) === "");
  ok("no assignment shows nothing", renderToStaticMarkup(h(EndRoleButton, { assignment: null })) === "");

  const words = END_ROLE_REFUSALS.last_verified_link[1];
  const form = renderToStaticMarkup(h(EndRoleForm, {
    assignment: COACH, reason: WHY, onReason() {}, busy: false, refusal: words, onConfirm() {}, onCancel() {} }));
  ok("the form says whose role and which", /End T Ndlovu(&#x27;|')s role: Coach, U15A/.test(form), form.slice(0, 300));
  ok("...that they are not told why", /not why/.test(form));
  ok("...asks for the reason", /data-testid="end-role-reason"/.test(form));
  ok("...and shows a refusal as an alert, in words", /role="alert"[^>]*data-testid="end-role-refused"/.test(form) && form.includes("Link and verify the new guardian first"));
  ok("...with a way to keep the role", /data-testid="end-role-cancel"/.test(form));
  const quiet = renderToStaticMarkup(h(EndRoleForm, { assignment: COACH, reason: "", onReason() {}, busy: false, refusal: "", onConfirm() {}, onCancel() {} }));
  ok("no refusal, no alert", !/end-role-refused/.test(quiet));
  const busy = renderToStaticMarkup(h(EndRoleForm, { assignment: COACH, reason: WHY, onReason() {}, busy: true, refusal: "", onConfirm() {}, onCancel() {} }));
  ok("busy: it says so and cannot be pressed twice", /Ending…/.test(busy) && /<button[^>]*disabled=""[^>]*data-testid="end-role-confirm"/.test(busy), busy);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

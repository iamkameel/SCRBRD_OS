/**
 * Signing in with Google and joining a school: the screens' state handling
 * (SCRBRD-140 phase 1; docs/design/SCRBRD-140_signup_and_school_linking.md).
 *
 *   - THE EXCHANGE: every answer POST /api/auth/firebase gives (a token for a
 *     signed-in, new and linked account; claim_required; a revoked or inactive
 *     account; the verifier's refusals; 429; 503 with the office-code fallback;
 *     no answer at all) becomes the one state the sign-in screen draws, and
 *     every refusal has a sentence. claim_required says nothing about what the
 *     account holds.
 *   - GOOGLE'S SIDE: the config comes from the environment only, a build
 *     without it has no Google; Firebase's errors have our words; the SDK is a
 *     dynamic import, never a static one; no key is written in the file.
 *   - THE PRIVACY PARAGRAPH on the sign-in screen is the one Kameel signed.
 *   - JOINING A SCHOOL: every kind ends in a request and never a role; a
 *     parent's child is free text that is never looked up; nothing on the
 *     screen says "found" or "not found"; a pupil under eighteen is sent to
 *     the office and sends nothing; the staff roles are ones the policy lets
 *     an office grant.
 *   - THE WAYS TO SIGN IN and THE CLAIMS LIST: what a row says, what a refusal
 *     is called, the screens as drawn.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/signin.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { GRANTABLE_ROLES, SUBJECT_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { exchangeGoogle, exchangeState, EXCHANGE_WORDS, CLAIM_STEPS } from "../src/lib/signin.js";
import { googleConfig, googleFailure, GOOGLE_FAILURE_WORDS, addSignIn, authReady } from "../src/lib/google.js";
import { SIGNIN_NOTICE, SIGNIN_NOTICE_TITLE } from "../src/lib/signinNotice.js";
import {
  KINDS, STAFF_ROLES, RELATIONSHIPS, JOIN_WORDS, PUPIL_UNDER_18, NOTE_MAX, buildRequest, joinWords, parentNote, sentWords,
} from "../src/lib/joinSchool.js";
import { describeSignIn, describeClaim, isLastLive, ordered, signInWords, HOW_WORDS, CLAIM_DONE } from "../src/lib/signins.js";
import { JoinSchool } from "../src/auth/NoSchool.jsx";
import { SignInRow } from "../src/views/signins.jsx";
import { ClaimRow } from "../src/views/claims.jsx";
import { SIGN_IN_REFUSALS } from "../../../services/api/auth/signin-api.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 260)}` : ""); } };
const group = (t) => console.log("\n" + t);
const apiError = (status, code, detail) => Object.assign(new Error(code), { status, code, detail });
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const FOUND = /\bnot found\b|\bfound\b|couldn.t find|could not find|no such (child|pupil|player|learner)|not on (the|our|a) (list|roll|register)|doesn.t exist|does not exist|isn.t on|is not on/i;

group("The exchange: each answer is one state");
{
  let a = exchangeState({ ok: true, body: { token: "t.k.n", outcome: "signed_in" } });
  ok("a signed-in account is a token", a.state === "token" && a.token === "t.k.n" && a.outcome === "signed_in", a);
  a = exchangeState({ ok: true, body: { token: "t.k.n", outcome: "new_account" } });
  ok("a new account is a token, and says so", a.state === "token" && a.outcome === "new_account", a);
  a = exchangeState({ ok: true, body: { token: "t.k.n", outcome: "linked" } });
  ok("an auto-linked stub is a token, and says so", a.state === "token" && a.outcome === "linked", a);
  a = exchangeState({ ok: true, body: { token: "t.k.n", outcome: "something else" } });
  ok("an outcome it does not know is read as a plain sign-in", a.state === "token" && a.outcome === "signed_in", a);
  a = exchangeState({ ok: true, body: { outcome: "signed_in" } });
  ok("a 200 with no token is not a sign-in", a.state === "refused", a);
  a = exchangeState({ ok: true, body: null });
  ok("...nor is an empty one", a.state === "refused", a);

  a = exchangeState({ ok: false, error: apiError(409, "claim_required") });
  ok("claim_required is its own state, with no token", a.state === "claim_required" && !("token" in a), a);
  ok("...whose words say the office checks, and nothing of what the account holds",
     /school office/.test(EXCHANGE_WORDS.claim_required) && !/parent|child|pupil|player|guardian|coach|account of|belongs to/i.test(EXCHANGE_WORDS.claim_required + CLAIM_STEPS.join(" ")), EXCHANGE_WORDS.claim_required);
  ok("...and offers the code as the other way", CLAIM_STEPS.some((s) => /code/.test(s)), CLAIM_STEPS);

  a = exchangeState({ ok: false, error: apiError(401, "identity_revoked") });
  ok("a revoked Google account is refused in words", a.state === "refused" && a.code === "identity_revoked" && /removed/.test(a.words) && /code/.test(a.words), a);
  a = exchangeState({ ok: false, error: apiError(403, "account_inactive") });
  ok("an inactive account is refused in words", a.state === "refused" && a.code === "account_inactive" && /not active/.test(a.words), a);
  a = exchangeState({ ok: false, error: apiError(401, "email_unverified") });
  ok("an unverified email is refused in words", a.state === "refused" && /verified/.test(a.words), a);
  a = exchangeState({ ok: false, error: apiError(401, "missing_device") });
  ok("a missing device is refused in words", a.state === "refused" && /Reload/.test(a.words), a);
  for (const code of ["bad_signature", "bad_issuer", "bad_audience", "token_expired", "malformed_token", "bad_algorithm", "unknown_kid", "provider_not_allowed", "stale_sign_in"]) {
    const r = exchangeState({ ok: false, error: apiError(401, code) });
    ok(`the verifier's ${code} is a refusal with a sentence, not a code`, r.state === "refused" && /\s/.test(r.words) && !r.words.includes(code), r);
  }
  a = exchangeState({ ok: false, error: apiError(429, "rate_limited") });
  ok("429 is 'slow down', and offers the code", a.state === "slow_down" && /minute/.test(a.words) && /code/.test(a.words), a);
  a = exchangeState({ ok: false, error: apiError(503, "keys_unavailable") });
  ok("503 is 'use the code', in words", a.state === "use_code" && /code/.test(a.words) && /not available/.test(a.words), a);
  a = exchangeState({ ok: false, error: apiError(500, "internal_error") });
  ok("a 500 is the server being unreachable, not a refusal", a.state === "unreachable", a);
  a = exchangeState({ ok: false, error: new TypeError("Failed to fetch") });
  ok("no answer at all is unreachable", a.state === "unreachable" && /Check your connection/.test(a.words), a);
  a = exchangeState({ ok: false, error: apiError(400, "refused") });
  ok("a code nobody has words for still says something", a.state === "refused" && /\s/.test(a.words) && !a.words.includes("refused:"), a);
}

group("The exchange posts the token and the device, and returns the state");
{
  const calls = [];
  const post = async (path, opts) => { calls.push({ path, opts }); return { token: "x.y.z", outcome: "new_account" }; };
  const a = await exchangeGoogle("ID.TOKEN.HERE", { post, device: () => "dev-1" });
  ok("it posts to /api/auth/firebase", calls.length === 1 && calls[0].path === "/api/auth/firebase" && calls[0].opts.method === "POST", calls);
  ok("...with the ID token and this device, and nothing else", JSON.stringify(calls[0].opts.body) === JSON.stringify({ idToken: "ID.TOKEN.HERE", deviceId: "dev-1" }), calls[0].opts.body);
  ok("...and answers the state", a.state === "token" && a.outcome === "new_account", a);
  const b = await exchangeGoogle("t", { post: async () => { throw apiError(409, "claim_required"); }, device: () => "d" });
  ok("a thrown claim_required is the claim state", b.state === "claim_required", b);
  const c = await exchangeGoogle("t", { post: async () => { throw apiError(503, "keys_unavailable"); }, device: () => "d" });
  ok("a thrown 503 is use_code", c.state === "use_code", c);
}

group("Google's side: config from the environment, failures in words");
{
  ok("no environment, no Google", googleConfig(undefined) === null);
  ok("an empty one, no Google", googleConfig({}) === null);
  ok("a key without a domain is no Google", googleConfig({ VITE_FIREBASE_API_KEY: "k", VITE_FIREBASE_PROJECT_ID: "p" }) === null);
  const cfg = googleConfig({ VITE_FIREBASE_API_KEY: " k ", VITE_FIREBASE_AUTH_DOMAIN: "d.example", VITE_FIREBASE_PROJECT_ID: "p" });
  ok("the three it needs are enough, trimmed", cfg?.apiKey === "k" && cfg.authDomain === "d.example" && cfg.projectId === "p" && !("appId" in cfg), cfg);
  ok("an app id rides along when given", googleConfig({ VITE_FIREBASE_API_KEY: "k", VITE_FIREBASE_AUTH_DOMAIN: "d", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "a" })?.appId === "a");
  let e = await authReady().catch((x) => x);
  ok("with no config the SDK is never asked for", e?.message === "not_configured");
  const map = { "auth/popup-closed-by-user": "cancelled", "auth/cancelled-popup-request": "cancelled", "auth/popup-blocked": "popup_blocked",
    "auth/network-request-failed": "network", "auth/unauthorized-domain": "not_set_up", "auth/operation-not-allowed": "not_set_up",
    "auth/too-many-requests": "too_many", "auth/user-disabled": "google_disabled", "auth/internal-error": "google_failed" };
  for (const [code, want] of Object.entries(map)) ok(`${code} is ${want}`, googleFailure({ code }) === want, googleFailure({ code }));
  ok("anything else is google_failed", googleFailure(new Error("x")) === "google_failed");
  ok("every failure has a sentence and none is a Firebase code",
     Object.values(GOOGLE_FAILURE_WORDS).every((w) => /\s/.test(w) && !/auth\//.test(w)), GOOGLE_FAILURE_WORDS);
  ok("a popup that was blocked tells the person what to do", /pop-ups/.test(GOOGLE_FAILURE_WORDS.popup_blocked));
  const calls = [];
  await addSignIn("ID", async (p, o) => { calls.push({ p, o }); return { ok: true }; });
  ok("adding a way to sign in posts the ID token to /api/auth/sign-ins", calls[0]?.p === "/api/auth/sign-ins" && calls[0].o.body.idToken === "ID", calls);

  const g = src("../src/lib/google.js");
  const code = g.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("the SDK is a dynamic import and never a static one", /import\(\s*"firebase\/auth"\s*\)/.test(code) && !/^\s*import\s[^;]*from\s+"firebase/m.test(code));
  ok("no key is written in the file", !/AIza|apiKey:\s*"/.test(g));
  ok("the Firebase session is held in memory only", /inMemoryPersistence/.test(code) && !/browserLocalPersistence|indexedDBLocalPersistence/.test(code));
  ok("...and ended once the token is in hand", /signOut\(auth\)/.test(code));
  ok("the account chooser is always asked", /select_account/.test(code));
  ok("the test hook is gated on the build-time constant", /TEST_HOOKS\s*&&[^;]*__SCRBRD_TEST_GOOGLE__/.test(code));
}

group("The privacy paragraph is the one Kameel signed");
{
  const md = readFileSync(new URL("../../../docs/policy/SIGNIN_PRIVACY_NOTICE.md", import.meta.url), "utf8");
  const quoted = md.split("## The paragraph (goes into the privacy notice as written)")[1].split("## Why this wording")[0]
    .split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^>\s?/, "")).join(" ").trim();
  ok("title and body are the signed words, exactly", quoted === `**${SIGNIN_NOTICE_TITLE}** ${SIGNIN_NOTICE}`, quoted.slice(0, 80));
  ok("it still says under 13 sign in with a code", /Pupils under 13 sign in with a code/.test(SIGNIN_NOTICE));
  const login = src("../src/auth/LoginPage.jsx");
  ok("the sign-in screen draws it", /SIGNIN_NOTICE/.test(login) && /SIGNIN_NOTICE_TITLE/.test(login));
  ok("...and so does Me", /SIGNIN_NOTICE/.test(src("../src/views/signins.jsx")));
  ok("...but the Google button is drawn only against a live server with Google configured", /googleOn\s*=\s*live\s*===\s*true\s*&&\s*googleAvailable\(\)/.test(login));
}

group("Joining a school: every kind ends in a request, never a role");
{
  const S = "11111111-1111-1111-1111-111111111111";
  ok("four kinds of person", KINDS.map((k) => k.id).join() === "staff,parent,pupil,follower");
  ok("no school, no request", buildRequest("follower", null).ok === false && buildRequest("staff", "", { role: "coach" }).ok === false);
  let r = buildRequest("follower", S);
  ok("a follower asks for spectator, with no note", r.ok && r.body.role === "spectator" && r.body.schoolId === S && r.body.note === null, r);
  r = buildRequest("staff", S, { role: "coach", extra: "  the U15A side  " });
  ok("a coach asks for coach, with her note trimmed", r.ok && r.body.role === "coach" && r.body.note === "the U15A side", r);
  ok("staff must say what they do", buildRequest("staff", S, {}).ok === false && buildRequest("staff", S, { role: "principal" }).ok === false && buildRequest("staff", S, { role: "guardian" }).ok === false);
  ok("...and a staff request never carries a child or a player", !("playerId" in buildRequest("staff", S, { role: "coach" }).body));
  ok("every staff role is one an office can be asked to grant",
     STAFF_ROLES.every((x) => Object.values(GRANTABLE_ROLES).some((l) => l.includes(x))),
     STAFF_ROLES.filter((x) => !Object.values(GRANTABLE_ROLES).some((l) => l.includes(x))));
  ok("...and none is a subject-scoped role (a register or a form cannot name a child)", STAFF_ROLES.every((x) => !SUBJECT_SCOPED_ROLES.includes(x) && x !== "dso" && x !== "player"));

  r = buildRequest("parent", S, { child: "  Test   Child  ", relationship: "Mother", year: "Grade 8" });
  ok("a parent asks for guardian", r.ok && r.body.role === "guardian", r);
  ok("...with the child as free text in the note, exactly as typed (spaces tidied)", r.body.note === "Child: Test Child · Relationship: Mother · Year: Grade 8", r.body.note);
  ok("...and no player id: the office matches by hand", !("playerId" in r.body) && JSON.stringify(Object.keys(r.body).sort()) === JSON.stringify(["note", "role", "schoolId"]), Object.keys(r.body));
  ok("the year is optional", buildRequest("parent", S, { child: "Test Child", relationship: "Father" }).body.note === "Child: Test Child · Relationship: Father");
  ok("a parent must type a name and a relationship", buildRequest("parent", S, { child: "T", relationship: "Mother" }).ok === false && buildRequest("parent", S, { child: "Test Child", relationship: "Friend" }).ok === false);
  ok("the note stays under the column's 300", parentNote({ child: "x".repeat(500), relationship: "Mother", year: "y".repeat(500) }).length <= NOTE_MAX);
  ok("every relationship on offer is accepted", RELATIONSHIPS.every((x) => buildRequest("parent", S, { child: "Test Child", relationship: x }).ok));

  ok("a pupil under 18 sends nothing, and is told whom to ask", buildRequest("pupil", S, { adult: "no" }).ok === false && /office/.test(buildRequest("pupil", S, { adult: "no" }).problem) && buildRequest("pupil", S, {}).ok === false);
  r = buildRequest("pupil", S, { adult: "yes", extra: "1st XI" });
  ok("an eighteen-year-old at school asks for player himself", r.ok && r.body.role === "player" && r.body.note === "1st XI", r);
  ok("...and no kind can ask for an owner's, platform or safeguarding role from here",
     ["staff", "parent", "pupil", "follower"].every((k) => { const x = buildRequest(k, S, { role: "coach", child: "Test Child", relationship: "Mother", adult: "yes" }); return x.ok && !["superadmin", "platformadmin", "dso", "selfaccess"].includes(x.body.role); }));
  ok("the pupil under 18 sees the office, a code and the Google floor of 13",
     /office/.test(PUPIL_UNDER_18.lines.join(" ")) && /under 13/.test(PUPIL_UNDER_18.lines.join(" ")) && /code/.test(PUPIL_UNDER_18.lines.join(" ")));
}

group("Joining a school never says found or not found, and never looks a child up");
{
  const all = [
    ...Object.values(JOIN_WORDS), ...PUPIL_UNDER_18.lines, PUPIL_UNDER_18.title,
    ...["parent", "pupil", "staff", "follower"].map((k) => sentWords(k, "Test School")),
    ...KINDS.flatMap((k) => [k.label, k.hint]),
    joinWords(apiError(422, "already_pending")), joinWords(apiError(500, "x")), joinWords(new TypeError("x")),
  ];
  ok("none of the words is an oracle", all.every((w) => !FOUND.test(w)), all.filter((w) => FOUND.test(w)));
  ok("a parent hears the same sentence whoever the child is", sentWords("parent", "Test School") === sentWords("parent", "Test School")
     && !/Test Child|Child:/.test(sentWords("parent", "Test School")));
  ok("...which says nothing is linked automatically", /nothing is linked automatically/.test(sentWords("parent", "Test School")));
  ok("a request the server refused is told in words", joinWords(apiError(422, "already_pending")) === JOIN_WORDS.already_pending);
  ok("a request that never arrived says nothing was sent", /nothing was sent/.test(joinWords(new TypeError("x"))));
  ok("a code nobody wrote words for still says something", /\s/.test(joinWords(apiError(422, "weird_code"))) && !joinWords(apiError(422, "weird_code")).includes("weird_code"));

  const screen = src("../src/auth/NoSchool.jsx");
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("the screen reads no list of pupils, children or players", !/\/api\/read\/(players|children|pupils|squad|roster|users|guardians)/.test(code) && !/useRows|useLive\("players/.test(code));
  ok("...and asks only for schools, its own requests and the help link",
     [...code.matchAll(/api\(\s*[`"]([^`"]+)[`"]/g)].every((m) => /^\/api\/(schools|safeguarding\/contacts|requests\/\$\{id\}\/withdraw)$/.test(m[1])),
     [...code.matchAll(/api\(\s*[`"]([^`"]+)[`"]/g)].map((m) => m[1]));
  ok("...and the request goes to /api/requests, the ordinary door", /"\/api\/requests"/.test(code));
  ok("the parent's field is a plain input, not a datalist or a picker", !/datalist|autocomplete=|role="combobox"|listbox/.test(code.replace(/autoComplete="off"/g, "")));
  ok("no 'Child's name' suggestions: the input is autoComplete off", /data-testid="join-child"/.test(code) && /autoComplete="off"[^>]*data-testid="join-child"/.test(code));
}

group("The join screen as drawn");
{
  const two = [{ id: "s1", name: "Test School One" }, { id: "s2", name: "Test School Two" }];
  let html = renderToStaticMarkup(h(JoinSchool, { schools: two, onSent() {} }));
  ok("with two schools, both are offered", html.includes("Test School One") && html.includes("Test School Two") && html.includes('data-testid="join-school-s1"'));
  ok("...and who you are is not asked until a school is chosen", !html.includes('data-testid="join-kind-staff"'));
  html = renderToStaticMarkup(h(JoinSchool, { schools: [two[0]], onSent() {} }));
  ok("with one school it is not a choice: it is named, and the kinds follow", html.includes('data-testid="join-only-school"') && html.includes('data-testid="join-kind-parent"') && !html.includes('data-testid="join-school-s1"'), html.slice(0, 200));
  ok("all four kinds are offered, as buttons", ["staff", "parent", "pupil", "follower"].every((k) => html.includes(`data-testid="join-kind-${k}"`)));
  ok("nothing is sent from here until a kind is chosen", !html.includes('data-testid="join-send"'));
  ok("no list of pupils is drawn", !/pupil-list|child-list|Whitfield|Pillay/.test(html));
  ok("none of the screen's words is an oracle", !FOUND.test(html.replace(/<[^>]+>/g, " ")), html.replace(/<[^>]+>/g, " ").match(FOUND)?.[0]);
  html = renderToStaticMarkup(h(JoinSchool, { schools: [], onSent() {} }));
  ok("with no schools it says so", /No school is listed/.test(html));
}

group("The ways to sign in");
{
  const base = { id: "i1", provider: "google.com", email_at_link: "a.person@example.invalid", linked_at: "2026-10-01T08:00:00Z", linked_how: "self_added", last_sign_in_at: null, revoked_at: null };
  let d = describeSignIn(base, "a.person@example.invalid");
  ok("a Google row is Google, live, and not used yet", d.provider === "Google" && d.live && d.lastUsed === null && d.how === HOW_WORDS.self_added, d);
  ok("...with Google's address equal to the school's, nothing is said of a difference", d.differs === false);
  d = describeSignIn(base, "Old.Address@example.invalid");
  ok("...with a different one, it is flagged (§3.5)", d.differs === true);
  d = describeSignIn({ ...base, revoked_at: "2026-10-02T08:00:00Z" });
  ok("a removed row is not live, and says when", d.live === false && !!d.removed, d);
  ok("every way a row can come to be has words", ["new_account", "office_confirmed", "code", "self_added", "register"].every((k) => /\s|\w{5,}/.test(HOW_WORDS[k] ?? "")));
  const rows = [{ ...base, id: "a", linked_at: "2026-09-01T00:00:00Z", revoked_at: "2026-09-05T00:00:00Z" }, { ...base, id: "b", linked_at: "2026-08-01T00:00:00Z" }, { ...base, id: "c", linked_at: "2026-10-01T00:00:00Z" }];
  ok("live ones come first, newest first", ordered(rows).map((r) => r.id).join() === "c,b,a", ordered(rows).map((r) => r.id));
  ok("the last live one is known", isLastLive([rows[0], rows[1]], "b") === true && isLastLive(rows, "b") === false);
  ok("no uid is read or drawn anywhere", !/provider_uid|\buid\b/i.test(src("../src/lib/signins.js").replace(/\/\*[\s\S]*?\*\//g, "")) && !/provider_uid/.test(src("../src/views/signins.jsx")));

  ok("a refusal shows the server's own sentence", signInWords(apiError(409, "identity_in_use", SIGN_IN_REFUSALS.identity_in_use[1])) === SIGN_IN_REFUSALS.identity_in_use[1]);
  ok("...for every code the signed-in routes can give", Object.entries(SIGN_IN_REFUSALS).every(([c, [, w]]) => signInWords(apiError(409, c, w)) === w && /\s/.test(w)));
  ok("an old session's stale Google sign-in is told in words", /sign in with Google again/.test(SIGN_IN_REFUSALS.stale_sign_in[1]));
  ok("no answer says nothing was changed", /nothing was changed/.test(signInWords(new TypeError("x"))));

  let html = renderToStaticMarkup(h(SignInRow, { row: base, accountEmail: "a.person@example.invalid", confirming: false, last: true, busy: false }));
  ok("a live row has a Remove button, named for what it removes", html.includes('data-testid="sign-in-remove"') && /aria-label="Remove Google a\.person@example\.invalid"/.test(html), html);
  ok("...and shows the address and when it was added", html.includes("a.person@example.invalid") && /since/.test(html));
  html = renderToStaticMarkup(h(SignInRow, { row: base, accountEmail: "x@example.invalid", confirming: true, last: true, busy: false }));
  ok("asked to remove, it says the session stays, that a code always works, and asks again", html.includes('data-testid="sign-in-remove-confirm"') && /stay signed in/.test(html) && /only Google sign-in/.test(html) && html.includes("sign-in-remove-yes") && html.includes("sign-in-remove-no"), html);
  ok("...and says the school holds another address", html.includes('data-testid="sign-in-differs"') && html.includes("x@example.invalid"));
  html = renderToStaticMarkup(h(SignInRow, { row: { ...base, revoked_at: "2026-10-02T08:00:00Z" }, accountEmail: "a.person@example.invalid", confirming: false, last: false, busy: false }));
  ok("a removed row offers nothing to press", html.includes('data-testid="sign-in-removed"') && !html.includes("sign-in-remove\""), html);
}

group("The office's Claims list");
{
  const claim = { id: "c1", user_id: "u1", account_name: "Test Teacher", account_email: "teacher@example.invalid", account_active: true, school_id: "s1",
    presented_email: "teacher@example.invalid", provider: "google.com", requested_at: "2026-10-01T08:00:00Z", last_requested_at: "2026-10-01T08:00:00Z" };
  let d = describeClaim(claim);
  ok("a claim reads as the enrolled account beside Google's address", d.name === "Test Teacher" && d.enrolledAs === "teacher@example.invalid" && d.google === "teacher@example.invalid" && d.sameAddress, d);
  ok("a second ask is shown", describeClaim({ ...claim, last_requested_at: "2026-10-02T09:00:00Z" }).askedAgain !== null && d.askedAgain === null);
  ok("a different address is marked", describeClaim({ ...claim, presented_email: "someone.else@example.invalid" }).sameAddress === false);
  let html = renderToStaticMarkup(h(ClaimRow, { claim, busy: false }));
  ok("the row has the three actions, each named for the person", ["claim-confirm", "claim-code", "claim-decline"].every((t) => html.includes(`data-testid="${t}"`)) && /aria-label="Confirm Test Teacher/.test(html), html);
  ok("...and shows both addresses and no uid", html.includes("claim-enrolled") && html.includes("claim-google") && !/provider_uid|uid/i.test(html));
  html = renderToStaticMarkup(h(ClaimRow, { claim: { ...claim, presented_email: "someone.else@example.invalid", account_active: false }, busy: false }));
  ok("a different address and a deactivated account are both marked for a second look", /check before you confirm/.test(html) && html.includes('data-testid="claim-inactive"'), html);
  html = renderToStaticMarkup(h(ClaimRow, { claim, busy: true }));
  ok("while it works the buttons are off (one tap, once)", (html.match(/disabled=""/g) ?? []).length === 3, html);
  ok("the office is told what happened", /Confirmed/.test(CLAIM_DONE.confirmed) && /Declined/.test(CLAIM_DONE.declined));
}

group("Where it sits in the app");
{
  const settings = src("../src/views/SettingsView.jsx");
  ok("Me carries the ways to sign in only when signed in for real", /\{live && <Panel><WaysToSignIn\/><\/Panel>\}/.test(settings));
  ok("People carries the Claims list only for those who may issue a code", /canClaims\s*=\s*holdsCapability\(role,\s*"user\.invite"\)/.test(settings) && /tab === "users" && canClaims && signedIn\(\)/.test(settings));
  ok("...and counts it on the People tab", /\(canClaims \? claims\.rows\.length : 0\)/.test(settings));
  const app = src("../src/App.jsx");
  ok("a signed-in account with no assignment goes to the no-school screen", /assignments\.length === 0/.test(app) && /<NoSchool /.test(app) && !/PendingRequests/.test(app));
}

console.log(`\n${"─".repeat(52)}\nSIGN-IN SCREENS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

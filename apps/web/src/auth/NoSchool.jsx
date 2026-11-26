import { Suspense, lazy, useEffect, useId, useState } from "react";
import { PERSONA_NAV, ROLES } from "../design/roles.js";
import { T, clr, px } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { profile } from "../lib/session.js";
import {
  KINDS, RELATIONSHIPS, REQUEST_STATE_WORDS, STAFF_ROLES,
  EXTRA_MAX, CHILD_MAX, YEAR_MAX, BORN_FIELD, buildRequest, familyWords, joinWords, sentWords, spectatorAsk, withdrawWords, withdrew,
} from "../lib/joinSchool.js";
// "I am a pupil here" (SCRBRD-140 honesty model, Migration A; db/168): the claim form, and the basic view.
import { CLAIM_FORM, NAME_MAX, YEAR_MAX as CLAIM_YEAR_MAX, buildClaim, claimWords } from "../lib/pupilClaim.js";
import { followProblem } from "../lib/follow.js";
import { PupilBasic } from "./PupilBasic.jsx";
import { claimFailure, claimResult } from "../lib/registerClaim.js";
import { AskSchool, AskSchoolLink, SchoolAskRows } from "./schoolAsk.jsx";
// The follow list (EXPERIENCE_PASS Q8, slice 3b; db/160): the Followed schools block.
import { useFollowed } from "../lib/follow.js";
import { FollowedSchools } from "../follow/Followed.jsx";
import { useNotifications } from "../lib/notifications.js";
import { linkWords } from "../lib/linkWords.js";

// "Start a match", what this phone holds, and the last match's plain record
// (views/ScoringBlock.jsx): fetched with the screen, in a chunk of its own.
// Q15: the terms, for a parent waiting on the office. Their own chunk, loaded only when she is waiting,
// so the no-school home (and its signed-out screen) loads no faster or slower for anybody else.
const WaitingTerms = lazy(() => import("../views/terms.jsx").then((m) => ({ default: m.WaitingTerms })));
const ScoringBlock = lazy(() => import("../views/ScoringBlock.jsx").then((m) => ({ default: m.ScoringBlock })));

// ══════════════════════════════════════════════════════
//  AN ACCOUNT WITH NO SCHOOL  (SCRBRD-140 §4, §5)
//
//  Where somebody lands who has signed in and holds nothing yet: a new Google
//  account, or an account whose requests are still with the school. They can
//  see their own name, their own requests, the list of schools, and a way to
//  ask. Nothing else — the database proves that table by table (db/99 §60) —
//  and this screen asks for nothing it could not safely hear.
//
//  AND A MATCH OF THEIR OWN (EXPERIENCE_PASS slice 1; Q3, 13 Nov 2026):
//  "Start a match" first, the pad's own setup, a Practice Match for anyone
//  signed in (it never leaves the phone) and a Pilot Match only where SCRBRD
//  has granted the account, which the server decides. The scoring block
//  (views/ScoringBlock.jsx) reads this phone's own matches and the account's
//  own Pilot status, nothing of a school's or a child's. Opening the pad
//  grants no role (App.jsx openPadNoSchool).
//
//  WHAT IT WILL NOT DO, and the tests hold it to it (signin.test.mjs):
//    - assign a role. Every path here ends in a REQUEST that a person at the
//      school answers.
//    - look a child up. A parent types a name, a relationship and a year as
//      free text; there is no list of pupils on this screen, no autocomplete,
//      and the answer is the same sentence whoever the child is (§5.3).
//    - say "found" or "not found" about anything.
//
//  The test ids `pending-requests` and `request-<state>` are the ones the
//  earlier holding page carried (smoke-browser-read.mjs), kept.
// ══════════════════════════════════════════════════════

const FONT = { head: "'Syne',sans-serif", body: "'DM Sans',sans-serif" };
const text = (size = 14, color = T.content.secondary) => ({ fontFamily: FONT.body, fontSize: `${size}px`, lineHeight: 1.5, color });
const card = () => ({ borderRadius: "16px", border: `1px solid ${T.line.normal}`, background: T.fill.panel, padding: "20px", marginBottom: "16px" });

/** A button at the floors: 12px type, 44px tall. */
function Btn({ children, kind = "quiet", style, ...rest }) {
  const main = kind === "primary";
  return (
    <button type="button" className="pressBtn" {...rest}
      style={{ minHeight: px(T.floor.target), padding: "10px 18px", borderRadius: "999px", boxSizing: "border-box",
        cursor: rest.disabled ? "not-allowed" : "pointer", opacity: rest.disabled ? 0.5 : 1,
        border: main ? "none" : `1px solid ${T.line.strong}`,
        background: main ? T.light.action : "transparent", color: main ? T.light.ink : T.content.secondary,
        fontFamily: FONT.head, fontSize: "13px", fontWeight: 700, ...style }}>{children}</button>
  );
}

/** One choice among several: a real button, announced as pressed or not. */
function Choice({ on, title, hint, onClick, ...rest }) {
  return (
    <button type="button" className="pressBtn" aria-pressed={on} onClick={onClick} {...rest}
      style={{ display: "block", width: "100%", textAlign: "left", minHeight: px(T.floor.target), padding: "12px 14px", marginBottom: "8px",
        borderRadius: "12px", cursor: "pointer", boxSizing: "border-box",
        border: `1px solid ${on ? T.brand.blueText : T.line.normal}`, background: on ? clr(T.brand.blue, 0.16) : T.fill.field }}>
      <span style={{ display: "block", fontFamily: FONT.head, fontSize: "14px", fontWeight: 700, color: T.content.primary }}>{title}</span>
      {hint && <span style={{ display: "block", ...text(13, T.content.secondary), marginTop: "2px" }}>{hint}</span>}
    </button>
  );
}

function Field({ label, hint, children }) {
  const id = useId();
  return (
    <div style={{ marginBottom: "14px" }}>
      <label htmlFor={id} style={{ display: "block", fontFamily: FONT.head, fontSize: "12px", fontWeight: 700, color: T.content.secondary, marginBottom: "6px" }}>{label}</label>
      {children(id)}
      {hint && <div style={{ ...text(12, T.content.tertiary), marginTop: "4px" }}>{hint}</div>}
    </div>
  );
}
const input = () => ({ width: "100%", minHeight: px(T.floor.target), boxSizing: "border-box", padding: "10px 12px", borderRadius: "10px",
  background: T.fill.field, border: `1px solid ${T.line.normal}`, color: T.content.primary, fontFamily: FONT.body, fontSize: T.role.control.fontSize });

/** The Guardian's anonymous link, as the safeguarding screens carry it (GET /api/safeguarding/contacts). */
function HelpLine() {
  const [url, setUrl] = useState(undefined);   // undefined = asking, null = not set
  useEffect(() => {
    let off = false;
    if (!signedIn()) return undefined;
    api("/api/safeguarding/contacts").then((r) => { if (!off) setUrl(r?.guardianAppUrl ?? null); }).catch(() => { if (!off) setUrl(undefined); });
    return () => { off = true; };
  }, []);
  if (url === undefined) return null;
  return (
    <div data-testid="no-school-help" style={{ ...card(), marginBottom: 0 }}>
      <div style={{ fontFamily: FONT.head, fontSize: "14px", fontWeight: 700, color: T.content.primary, marginBottom: "4px" }}>Worried about a child?</div>
      {url
        ? <div style={text(14)}>You do not need a school to speak up.
            <a href={url} target="_blank" rel="noopener noreferrer" data-testid="no-school-guardian"
               style={{ display: "flex", alignItems: "center", minHeight: px(T.floor.target), color: T.brand.blueText, fontWeight: 600, fontSize: "14px" }}>Report anonymously with The Guardian's app</a></div>
        : <div style={text(14)} data-testid="no-school-guardian-unset">The Guardian's app link has not been set on this platform yet.</div>}
    </div>
  );
}

/**
 * The join form. `post` is api() unless a test hands in another.
 *
 * A member of staff who chooses their school is first asked of the school's
 * staff register (POST /api/join/register-claim, SCRBRD-140 phase 2): if the
 * office listed the address Google verified, the server grants what was listed
 * and `onJoined` enters the school. If it grants nothing, the claim says
 * NOTHING: the request form below reads exactly as it would have if the office
 * had listed nobody, so a refused person learns nothing from the claim.
 *
 * `kindFirst` "parent" (the home page's "My child plays", EXPERIENCE_PASS §2.6
 * step 2) starts the form with "parent or guardian" chosen. Only that kind: a
 * member of staff is never sent to the register's check by a link.
 *
 * `onAskSchool(typed)` (Q22, db/158): the person's school is not in the list,
 * so the no-school home opens "Ask SCRBRD to add my school" (auth/schoolAsk.jsx)
 * with what they typed into the search.
 * @param {{ schools: { id: string, name: string }[], onSent: () => void, onJoined?: () => Promise<void>, post?: typeof api, kindFirst?: string | null, onAskSchool?: ((typed: string) => void) | null }} p
 */
export function JoinSchool({ schools, onSent, onJoined, post = api, kindFirst = null, onAskSchool = null, onClaimed = null, onFollowed = null }) {
  const [schoolId, setSchoolId] = useState(schools.length === 1 ? schools[0].id : null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(kindFirst === "parent" ? "parent" : null);
  const [form, setForm] = useState({ role: "", extra: "", child: "", relationship: "", year: "", adult: "", name: "", pyear: "", born: "", pborn: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(null);
  // The register's claim for a member of staff: idle | checking | granted | none | cooldown | error.
  const [claim, setClaim] = useState({ state: "idle", words: "" });
  const [claimTry, setClaimTry] = useState(0);
  const [entering, setEntering] = useState(false);
  const [enterProblem, setEnterProblem] = useState("");
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setProblem(""); };

  // A single school is not a choice (as the earlier sign-up flow already knew).
  useEffect(() => { if (schools.length === 1) setSchoolId(schools[0].id); }, [schools]);
  const school = schools.find((s) => s.id === schoolId) ?? null;

  // Before any role is offered to somebody who works at the school, ask the register.
  useEffect(() => {
    if (kind !== "staff" || !schoolId) { setClaim({ state: "idle", words: "" }); return undefined; }
    let off = false;
    setClaim({ state: "checking", words: "" });
    setEnterProblem("");
    post("/api/join/register-claim", { method: "POST", body: { schoolId } })
      .then((r) => {
        if (off) return;
        const c = claimResult(r);
        if (c.kind === "granted") { setClaim({ state: "granted", words: c.words }); onSent?.(); }
        else setClaim({ state: "none", words: "" });
      })
      .catch((e) => { if (!off) { const f = claimFailure(e); setClaim({ state: f.kind, words: f.words }); } });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, schoolId, claimTry]);

  const enter = async () => {
    setEntering(true); setEnterProblem("");
    try { await onJoined?.(); }
    catch { setEnterProblem("You're in, but the school page would not open. Sign out, then sign in again."); }
    setEntering(false);
  };
  const shown = schools.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const built = kind ? buildRequest(kind, schoolId, form) : null;

  const send = async () => {
    const r = buildRequest(kind, schoolId, form);
    if (!r.ok) { setProblem(r.problem); return; }
    setBusy(true); setProblem("");
    try {
      const out = await post("/api/requests", { method: "POST", body: r.body });
      // db/174: the family list linked her (or let a pupil of 18 in) at once.
      setSent({ kind, school: school?.name ?? "", linked: familyWords(out?.family) });
      onSent?.();
    } catch (e) { setProblem(joinWords(e)); }
    setBusy(false);
  };

  // Q3 (db/168): a pupil under 18 says who he is. It asks for nothing and opens nothing;
  // the screen becomes his basic view (onClaimed).
  const claimIt = async () => {
    const c = buildClaim(schoolId, { name: form.name, year: form.pyear, born: form.pborn });
    if (!c.ok) { setProblem(c.problem); return; }
    setBusy(true); setProblem("");
    try {
      await post("/api/pupil/claim", { method: "POST", body: c.body });
      setBusy(false);
      onClaimed?.();
      return;
    } catch (e) { setProblem(claimWords(e)); }
    setBusy(false);
  };

  // Q10 (db/168): "I just want to follow matches" follows the school, at once. No request.
  const followIt = async () => {
    if (!schoolId) { setProblem("Choose your school first."); return; }
    setBusy(true); setProblem("");
    try {
      const r = await post("/api/follows", { method: "POST", body: { schoolId } });
      setSent({ kind: "followed", school: r?.school?.name ?? school?.name ?? "" });
      onFollowed?.();
    } catch (e) { setProblem(followProblem(e)); }
    setBusy(false);
  };

  if (sent?.kind === "followed") {
    return (
      <div role="status" data-testid="join-followed" style={card()}>
        <div style={{ fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary, marginBottom: "6px" }}>You follow {sent.school}</div>
        <div style={text(14)}>Its public matches lead this page on match days. To see the school's signed-in view, ask from its card under Followed schools.</div>
        <Btn style={{ marginTop: "14px" }} data-testid="join-another" onClick={() => { setSent(null); setKind(null); }}>Join a school as well</Btn>
      </div>
    );
  }

  // db/174: linked from the family list. She reads the terms next; he opens the school.
  if (sent?.linked) {
    return (
      <div role="status" data-testid="join-linked" style={card()}>
        <div style={{ fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary, marginBottom: "6px" }}>{sent.linked.title}</div>
        <div style={text(14)}>{sent.linked.text}</div>
        <Btn kind="primary" data-testid="join-linked-continue" disabled={entering} onClick={enter} style={{ marginTop: "14px" }}>{entering ? "Opening the school…" : "Continue"}</Btn>
        {enterProblem && <div role="alert" data-testid="join-linked-problem" style={{ ...text(13, T.semantic.criticalText), marginTop: "8px" }}>{enterProblem}</div>}
      </div>
    );
  }

  if (sent) {
    return (
      <div role="status" data-testid="join-sent" style={card()}>
        <div style={{ fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary, marginBottom: "6px" }}>Request sent</div>
        <div style={text(14)}>{sentWords(sent.kind, sent.school)}</div>
        <Btn style={{ marginTop: "14px" }} data-testid="join-another" onClick={() => { setSent(null); setKind(null); setForm({ role: "", extra: "", child: "", relationship: "", year: "", adult: "", name: "", pyear: "", born: "", pborn: "" }); }}>Ask for something else</Btn>
      </div>
    );
  }

  return (
    <div data-testid="join-school" id="join-school" style={card()}>
      <h2 id="join-school-title" tabIndex={-1} style={{ margin: "0 0 4px", fontFamily: FONT.head, fontSize: "18px", fontWeight: 800, color: T.content.primary, outline: "none" }}>Join a school</h2>
      <div style={{ ...text(14), marginBottom: "16px" }}>Pick your school and say who you are. Someone at the school will answer. You won't get access until they do.</div>

      {/* 1 · The school */}
      <div role="group" aria-labelledby="join-school-h" style={{ marginBottom: "18px" }}>
        <div id="join-school-h" style={{ fontFamily: FONT.head, fontSize: "13px", fontWeight: 700, color: T.content.primary, marginBottom: "8px" }}>1 · Your school</div>
        {schools.length === 0 && <div style={text(14)}>No schools are on SCRBRD yet.</div>}
        {schools.length === 0 && onAskSchool && <AskSchoolLink onAsk={() => onAskSchool("")}/>}
        {schools.length === 1 && <div data-testid="join-only-school" style={text(14, T.content.primary)}>{schools[0].name}</div>}
        {schools.length > 1 && <>
          {schools.length > 6 && (
            <Field label="Search schools">{(id) => <input id={id} value={q} onChange={(e) => setQ(e.target.value)} style={input()} autoComplete="off" data-testid="join-school-search"/>}</Field>
          )}
          <div style={{ maxHeight: "260px", overflowY: "auto" }}>
            {shown.map((s) => <Choice key={s.id} on={s.id === schoolId} title={s.name} data-testid={`join-school-${s.id}`} onClick={() => { setSchoolId(s.id); setProblem(""); }}/>)}
            {shown.length === 0 && <div data-testid="join-school-none" style={text(14)}>No school matches what you typed.{onAskSchool && <> Is your school not on SCRBRD yet?</>}</div>}
            {shown.length === 0 && onAskSchool && <AskSchoolLink onAsk={() => onAskSchool(q.trim())}/>}
          </div>
        </>}
        {/* Q22: a school not on SCRBRD is not a dead end. */}
        {schools.length > 0 && !(schools.length > 1 && shown.length === 0) && onAskSchool && (
          <div style={{ ...text(13), marginTop: "6px" }}>Not in the list? <AskSchoolLink testId="join-school-missing" onAsk={() => onAskSchool(q.trim())}>Ask SCRBRD to add your school</AskSchoolLink></div>
        )}
      </div>

      {/* 2 · Who you are */}
      {schoolId && (
        <div role="group" aria-labelledby="join-kind-h" style={{ marginBottom: "18px" }}>
          <div id="join-kind-h" style={{ fontFamily: FONT.head, fontSize: "13px", fontWeight: 700, color: T.content.primary, marginBottom: "8px" }}>2 · Who you are</div>
          {KINDS.map((k) => <Choice key={k.id} on={kind === k.id} title={k.label} hint={k.hint} data-testid={`join-kind-${k.id}`} onClick={() => { setKind(k.id); setProblem(""); }}/>)}
        </div>
      )}

      {/* 3 · The details each kind needs, and no more */}
      {schoolId && kind === "staff" && claim.state === "checking" && (
        <div role="status" data-testid="join-claim-checking" style={{ ...text(14), marginBottom: "14px" }}>Checking the school's staff list…</div>
      )}

      {schoolId && kind === "staff" && claim.state === "granted" && (
        <div role="status" data-testid="join-claimed" style={{ ...text(14, T.content.primary), padding: "14px", borderRadius: "12px",
          border: `1px solid ${T.line.strong}`, background: T.surface.base, marginBottom: "14px" }}>
          <div style={{ fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, marginBottom: "6px" }}>{claim.words}</div>
          <Btn kind="primary" data-testid="join-claimed-continue" disabled={entering} onClick={enter} style={{ marginTop: "8px" }}>{entering ? "Opening the school…" : "Open the school"}</Btn>
          {enterProblem && <div role="alert" data-testid="join-claimed-problem" style={{ ...text(13, T.semantic.criticalText), marginTop: "8px" }}>{enterProblem}</div>}
        </div>
      )}

      {schoolId && kind === "staff" && claim.state === "cooldown" && (
        <div role="alert" data-testid="join-cooldown" style={{ ...text(14, T.content.primary), padding: "12px 14px", borderRadius: "10px",
          border: `1px solid ${T.line.normal}`, background: T.surface.base, marginBottom: "14px" }}>{claim.words}</div>
      )}

      {schoolId && kind === "staff" && claim.state === "error" && (
        <div role="alert" data-testid="join-claim-error" style={{ ...text(13, T.semantic.criticalText), padding: "10px 12px", borderRadius: "8px",
          background: clr(T.semantic.critical, 0.1), border: `1px solid ${clr(T.semantic.critical, 0.2)}`, marginBottom: "12px" }}>
          {claim.words}
          <div><Btn data-testid="join-claim-retry" style={{ marginTop: "8px" }} onClick={() => setClaimTry((n) => n + 1)}>Check again</Btn></div>
        </div>
      )}

      {schoolId && kind === "staff" && (claim.state === "none" || claim.state === "error") && (
        <div data-testid="join-form-staff">
          <Field label="What do you do at the school?">{(id) => (
            <select id={id} value={form.role} onChange={(e) => set("role", e.target.value)} style={input()} data-testid="join-staff-role">
              <option value="">Choose…</option>
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLES[r]?.label ?? r}</option>)}
            </select>)}</Field>
          <Field label="Anything the office should know (optional)" hint="For example, which side you coach.">{(id) => (
            <input id={id} value={form.extra} maxLength={EXTRA_MAX} onChange={(e) => set("extra", e.target.value)} style={input()} autoComplete="off"/>)}</Field>
        </div>
      )}

      {schoolId && kind === "parent" && (
        <div data-testid="join-form-parent">
          {/* Free text, on purpose (§5.3): this form never looks a child up. */}
          <Field label="Your child's name" hint="Type it as you would write it. The school office matches it by hand; nothing is looked up here.">{(id) => (
            <input id={id} value={form.child} maxLength={CHILD_MAX} onChange={(e) => set("child", e.target.value)} style={input()} autoComplete="off" data-testid="join-child"/>)}</Field>
          <Field label="How are you related to your child?">{(id) => (
            <select id={id} value={form.relationship} onChange={(e) => set("relationship", e.target.value)} style={input()} data-testid="join-relationship">
              <option value="">Choose…</option>
              {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>)}</Field>
          <Field label="Your child's year or team (optional)">{(id) => (
            <input id={id} value={form.year} maxLength={YEAR_MAX} onChange={(e) => set("year", e.target.value)} style={input()} autoComplete="off"/>)}</Field>
          {/* db/174 (Q2): optional. Sent beside the request, never in its note; checked and not kept. */}
          <Field label={BORN_FIELD.parent} hint={BORN_FIELD.hint}>{(id) => (
            <input id={id} type="date" value={form.born} onChange={(e) => set("born", e.target.value)} style={input()} autoComplete="off" data-testid="join-born"/>)}</Field>
          {/* SCRBRD-092 / SCRBRD-110 §7: health monitoring is a separate yes, given later. */}
          <div role="note" data-testid="join-health-note" style={{ ...text(13), padding: "12px 14px", borderRadius: "10px", border: `1px solid ${T.line.normal}`, background: T.surface.base, marginBottom: "14px" }}>
            <strong style={{ color: T.content.primary }}>Health monitoring is separate, and off.</strong> It is not part of joining. Once the school has checked that you are your child's parent, you can turn it on, or leave it off, on your child's file under Family.
          </div>
        </div>
      )}

      {schoolId && kind === "pupil" && (
        <div data-testid="join-form-pupil">
          <Choice on={form.adult === "yes"} title="I am 18 or older and still at school" data-testid="join-pupil-adult" onClick={() => set("adult", "yes")}/>
          <Choice on={form.adult === "no"} title="I am under 18" data-testid="join-pupil-minor" onClick={() => set("adult", "no")}/>
          {/* Q3 (db/168): he says who he is. It asks for nothing and opens nothing. */}
          {form.adult === "no" && (
            <div data-testid="join-pupil-under18">
              <div role="note" style={{ ...text(14), padding: "12px 14px", borderRadius: "10px", border: `1px solid ${T.line.normal}`, background: T.surface.base, marginBottom: "14px" }}>
                <div style={{ fontFamily: FONT.head, fontSize: "14px", fontWeight: 700, color: T.content.primary, marginBottom: "6px" }}>{CLAIM_FORM.title}</div>
                <div style={{ marginBottom: "6px" }}>{CLAIM_FORM.intro}</div>
                <div>{CLAIM_FORM.under13}</div>
              </div>
              <Field label="Your name" hint="As the school would have it on its list.">{(id) => (
                <input id={id} value={form.name} maxLength={NAME_MAX} onChange={(e) => set("name", e.target.value)} style={input()} autoComplete="name" data-testid="join-pupil-name"/>)}</Field>
              <Field label="Your year or team (optional)">{(id) => (
                <input id={id} value={form.pyear} maxLength={CLAIM_YEAR_MAX} onChange={(e) => set("pyear", e.target.value)} style={input()} autoComplete="off" data-testid="join-pupil-year"/>)}</Field>
              <Field label={BORN_FIELD.pupil} hint={BORN_FIELD.hint}>{(id) => (
                <input id={id} type="date" value={form.pborn} onChange={(e) => set("pborn", e.target.value)} style={input()} autoComplete="off" data-testid="join-pupil-born"/>)}</Field>
              <div role="note" data-testid="join-pupil-keep" style={{ ...text(13), marginBottom: "14px" }}>{CLAIM_FORM.keep}</div>
              <Btn kind="primary" data-testid="join-pupil-send" disabled={busy || !buildClaim(schoolId, { name: form.name, year: form.pyear, born: form.pborn }).ok} onClick={claimIt}>{busy ? "Sending…" : "Send to the school"}</Btn>
            </div>
          )}
          {form.adult === "yes" && (
            <Field label="Your year or team (optional)" hint="The office uses this to match you to the school's list.">{(id) => (
              <input id={id} value={form.extra} maxLength={EXTRA_MAX} onChange={(e) => set("extra", e.target.value)} style={input()} autoComplete="off"/>)}</Field>
          )}
          {form.adult === "yes" && (
            <Field label={BORN_FIELD.pupil} hint={BORN_FIELD.hint}>{(id) => (
              <input id={id} type="date" value={form.born} onChange={(e) => set("born", e.target.value)} style={input()} autoComplete="off" data-testid="join-adult-born"/>)}</Field>
          )}
        </div>
      )}

      {problem && <div role="alert" data-testid="join-problem" style={{ ...text(13, T.semantic.criticalText), padding: "10px 12px", borderRadius: "8px", background: clr(T.semantic.critical, 0.1), border: `1px solid ${clr(T.semantic.critical, 0.2)}`, marginBottom: "12px" }}>{problem}</div>}

      {schoolId && kind === "follower" && (
        <Btn kind="primary" data-testid="join-follow" disabled={busy} onClick={followIt}>{busy ? "Following…" : `Follow ${school?.name ?? "the school"}`}</Btn>
      )}
      {schoolId && kind && kind !== "follower" && !(kind === "pupil" && form.adult !== "yes")
        && !(kind === "staff" && claim.state !== "none" && claim.state !== "error") && (
        <Btn kind="primary" data-testid="join-send" disabled={busy || !built?.ok} onClick={send}>{busy ? "Sending…" : "Send my request"}</Btn>
      )}
    </div>
  );
}

/**
 * The screen. `name` is what the shell knows of the person; `onSignOut` is
 * the shell's sign-out (which clears the persisted session too).
 *
 * `onOpenPad` (Q3, Kameel 13 Nov 2026): the shell's way into the pad's own
 * setup, or to a Practice or Pilot Match this phone holds. With it, "Start a
 * match" leads the screen (§2.5 step 3). It grants nothing: a Practice Match
 * never leaves the phone, and a Pilot Match is the server's to allow.
 * `joinFirst` changes when the pad's "Scoring for a school? Join it" brought
 * the person back: the join form is scrolled to and focused. `kindFirst`
 * "parent" is the home page's "My child plays": the join form with the
 * parent's kind already chosen (JoinSchool).
 *
 * THE ORDER IS THE DAY SHEET'S (EXPERIENCE_PASS §2.2, slice 3a): Now (a match
 * this phone is scoring) and Start a match, from the scoring block; Join a
 * school; Your requests; and "Worried about a child?" last. Followed schools
 * (slice 3b, Q8) leads while one of its schools is live, and sits after Now
 * otherwise. An empty section says in one line what will appear there.
 */
/** db/161's title (school_answered_words()): the one notice this block draws. */
export const ANSWERED_TITLE = "The school has answered your request";

/**
 * The office's answer to her request (Q15, db/161): "The school has answered
 * your request", the same words for a yes and a no. Her requests list above
 * says which. That notice alone, unread; any other notice of hers is the
 * Notices screen's. "Mark as read" marks the ones shown, and nothing else.
 */
function AnsweredNotices() {
  const { rows, open } = useNotifications("spectator");
  const unread = rows.filter((n) => n.type === "system" && n.title === ANSWERED_TITLE && !n.read);
  if (!unread.length) return null;
  const markAll = async () => { for (const n of unread) await open(n.id); };
  return (
    <div data-testid="no-school-notices" role="status" style={{ marginTop: "8px", padding: "12px 14px", border: `1px solid ${T.line.normal}`, borderRadius: "12px", background: T.fill.panel }}>
      {unread.map((n) => (
        <div key={n.id} data-testid="no-school-notice" style={{ marginBottom: "8px" }}>
          <div style={{ ...text(14, T.content.primary), fontWeight: 600 }}>{n.title}</div>
          {n.body && <div style={text(13, T.content.secondary)}>{n.body}</div>}
        </div>
      ))}
      <Btn onClick={() => { void markAll(); }} data-testid="no-school-notices-read">Got it</Btn>
    </div>
  );
}

export function NoSchool({ name, onSignOut, onSignInAgain = null, onJoined, onOpenPad = null, joinFirst = 0, kindFirst = null }) {
  const [nudge, setNudge] = useState(0);
  const asked = useLive("role_requests", "spectator", nudge);
  const rows = asked.rows;
  // Q22 (db/158): the person's own notes asking SCRBRD to add a school, and the note's form when open.
  const schoolAsks = useLive("school_add_requests", "spectator", nudge);
  const askRows = schoolAsks.rows.filter((r) => r.mine);
  // Q15: her own requests to be linked to a child, still with the office (lib/family.js pendingWords's
  // rule, said here without importing it: that module draws the match centre and the scoring package
  // into this screen's first load, which a slow phone feels before the sign-in screen appears).
  const waiting = rows.filter((r) => r.mine && r.state === "pending" && PERSONA_NAV.family.roles.includes(r.role));
  // Red-team S4: a link the office set up itself (an offline form) and ended, or did not verify, has no
  // request on the list above; with her role gone with it she is here, and her answered notice must point at
  // something. Her own links, in Family's words (lib/familyLinks' rule, my_links), are said here too.
  const linksRead = useLive("my_links", "spectator", nudge);
  const linkLines = linkWords(linksRead.rows, Date.now()).filter((l) => l.kind !== "pending");
  const [askSchool, setAskSchool] = useState(null);
  const [schools, setSchools] = useState(null);
  const me = profile()?.user;
  const live = signedIn();
  const followed = useFollowed();
  // db/168: has this account said "I am a pupil here, and under 18"? Then it is his basic view
  // (PupilBasic), not this one. undefined = asking; null = no claim.
  const [pupil, setPupil] = useState(/** @type {any} */ (undefined));
  const [pupilNonce, setPupilNonce] = useState(0);
  useEffect(() => {
    if (!live) return undefined;
    let off = false;
    api("/api/pupil/state").then((r) => { if (!off) setPupil(r?.claim ?? null); }).catch(() => { if (!off) setPupil("failed"); });
    return () => { off = true; };
  }, [live, pupilNonce]);
  // Q10: "Ask the school for its signed-in view", from a followed school's card: the spectator request, as before.
  const [viewAsk, setViewAsk] = useState(/** @type {{ id: string, words: string, ok: boolean } | null} */ (null));
  const askView = async (/** @type {{ id: string, name: string }} */ s) => {
    try {
      await api("/api/requests", { method: "POST", body: spectatorAsk(s.id) });
      setViewAsk({ id: s.id, ok: true, words: sentWords("follower", s.name) });
      setNudge((n) => n + 1);
    } catch (e) { setViewAsk({ id: s.id, ok: false, words: joinWords(e) }); }
  };

  useEffect(() => {
    let off = false;
    api("/api/schools").then((r) => { if (!off) setSchools((r?.rows ?? []).map((x) => ({ id: x.id, name: x.name }))); }).catch(() => { if (!off) setSchools([]); });
    return () => { off = true; };
  }, []);

  // Back from the pad's "Join it", or the record's: the join form, scrolled to and focused.
  const [askJoin, setAskJoin] = useState(joinFirst);
  useEffect(() => { if (joinFirst) setAskJoin(joinFirst); }, [joinFirst]);
  // `pupil` too: until /api/pupil/state answers (db/168) the screen is "Reading
  // your account…" and the form is not drawn, so a focus tried while the
  // schools arrived first found no heading and was never tried again.
  useEffect(() => {
    if (!askJoin || schools === null || pupil === undefined) return;
    const h = document.getElementById("join-school-title");
    if (!h) return;
    const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    h.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    h.focus({ preventScroll: true });
  }, [askJoin, schools, pupil]);

  // A withdraw that did not happen is said in words, above the list, because a
  // request that was answered first leaves the pending row (and its words) behind.
  const [withdrawProblem, setWithdrawProblem] = useState("");
  const withdraw = async (id) => {
    setWithdrawProblem("");
    try {
      const r = await api(`/api/requests/${id}/withdraw`, { method: "POST" });
      if (!withdrew(r)) setWithdrawProblem(withdrawWords({ status: 200, code: "not_waiting" }));
    } catch (e) { setWithdrawProblem(withdrawWords(e)); }
    setNudge((n) => n + 1);
  };

  // A reload drops the session token on purpose (lib/api.js), and this screen
  // is restored from the saved shell state. Say so, rather than show an empty list.
  if (!live) {
    return (
      <div data-testid="pending-requests" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: T.surface.canvas }}>
        <div style={{ maxWidth: "480px", width: "100%" }} data-testid="no-school-signed-out">
          <h1 style={{ margin: "0 0 8px", fontFamily: FONT.head, fontSize: "22px", color: T.content.primary }}>You were signed out</h1>
          <div style={{ ...text(14), marginBottom: "16px" }}>SCRBRD signs you out when the page reloads, to keep your account safe. Sign in again to see your requests.</div>
          <Btn kind="primary" onClick={onSignInAgain ?? onSignOut} data-testid="no-school-sign-in-again">Sign in again</Btn>
        </div>
      </div>
    );
  }

  // A pupil's claim (db/168): his basic view, and nothing of this screen's asking.
  if (pupil === "failed") {
    return (
      <div data-testid="pending-requests" style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 16px", background: T.surface.canvas, boxSizing: "border-box" }}>
        <div role="alert" data-testid="no-school-state-failed" style={{ maxWidth: "520px", width: "100%", ...text(14, T.content.primary) }}>
          <div style={{ marginBottom: "12px" }}>Could not read your account. Try again.</div>
          <Btn kind="primary" data-testid="no-school-state-retry" onClick={() => { setPupil(undefined); setPupilNonce((n) => n + 1); }}>Try again</Btn>
          <Btn style={{ marginLeft: "8px" }} onClick={onSignOut}>Sign out</Btn>
        </div>
      </div>
    );
  }
  if (pupil === undefined) {
    return (
      <div data-testid="pending-requests" style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 16px", background: T.surface.canvas, boxSizing: "border-box" }}>
        <div role="status" style={text(14)}>Reading your account…</div>
      </div>
    );
  }
  if (pupil) {
    return <PupilBasic name={name} claim={pupil} onSignOut={onSignOut} onRemoved={onSignOut} onOpenPad={onOpenPad}/>;
  }

  return (
    <div data-testid="pending-requests" style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 16px", background: T.surface.canvas, boxSizing: "border-box" }}>
      <main style={{ maxWidth: "520px", width: "100%" }}>
        <h1 data-testid="no-school-title" style={{ margin: "0 0 4px", fontFamily: FONT.head, fontSize: "22px", fontWeight: 800, color: T.content.primary }}>Hello {name || me?.name || "there"}</h1>
        <div style={{ ...text(14), marginBottom: "4px" }}>You are signed in{me?.email ? <> as <span data-testid="no-school-email" style={{ color: T.content.primary }}>{me.email}</span></> : ""}. You are not at a school yet.</div>
        <div style={{ ...text(14), marginBottom: "20px" }}>Your account holds nothing of a school's until a school says yes.{onOpenPad ? " You can score a match on this phone meanwhile." : " Until then, this page is all you can see."}</div>

        {/* §2.2, Q8: Followed schools first while one of them is live, or a link's question waits. */}
        {(followed.live || followed.ask) && <FollowedSchools followed={followed} lead onAskView={askView} viewAsk={viewAsk}/>}

        {/* §2.5 step 3: "Start a match" first. Its own chunk: the scoring block draws the Board. */}
        {onOpenPad && (
          <Suspense fallback={<div role="status" style={{ ...text(14), marginBottom: "16px" }}>Loading scoring…</div>}>
            <ScoringBlock onOpenPad={onOpenPad} onJoin={() => setAskJoin((n) => n + 1)}/>
          </Suspense>
        )}

        {/* ...and after Now otherwise (§2.2). */}
        {!(followed.live || followed.ask) && <FollowedSchools followed={followed} onAskView={askView} viewAsk={viewAsk}/>}

        {schools === null ? <div style={text(14)}>Loading the schools…</div>
          : <JoinSchool schools={schools} onSent={() => setNudge((n) => n + 1)} onJoined={onJoined} kindFirst={kindFirst} onAskSchool={(typed) => setAskSchool(typed)}
              onClaimed={() => { setPupil(undefined); setPupilNonce((n) => n + 1); }} onFollowed={() => followed.reload()}/>}
        {askSchool !== null && <AskSchool key={askSchool} startName={askSchool} onSent={() => setNudge((n) => n + 1)} onClose={() => setAskSchool(null)}/>}

        <div style={{ marginBottom: "16px" }} data-testid="no-school-requests">
            <h2 style={{ margin: "0 0 8px", fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary }}>Your requests</h2>
            {withdrawProblem && <div role="alert" data-testid="withdraw-problem" style={{ ...text(13, T.semantic.criticalText), padding: "10px 12px", borderRadius: "8px", background: clr(T.semantic.critical, 0.1), border: `1px solid ${clr(T.semantic.critical, 0.2)}`, marginBottom: "8px" }}>{withdrawProblem}</div>}
            {rows.length === 0 && askRows.length === 0 && linkLines.length === 0 && !asked.loading && !schoolAsks.loading && <div data-testid="no-school-requests-none" style={text(14)}>A request you send to a school shows here, with the school's answer.</div>}
            {rows.map((r) => (
              <div key={r.id} data-testid={`request-${r.state}`} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "12px 14px", border: `1px solid ${T.line.normal}`, borderRadius: "12px", background: T.fill.panel, marginBottom: "8px" }}>
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <div style={{ ...text(14, T.content.primary), fontWeight: 600 }}>{ROLES[r.role]?.label ?? r.role}{r.team ? ` · ${r.team}` : ""}</div>
                  <div style={text(13, T.content.secondary)}>{r.schoolName ?? "School"} · {REQUEST_STATE_WORDS[r.state] ?? r.state}{r.decidedNote ? ` — ${r.decidedNote}` : ""}</div>
                </div>
                {r.state === "pending" && <Btn onClick={() => withdraw(r.id)} data-testid="request-withdraw">Withdraw</Btn>}
              </div>
            ))}
            <SchoolAskRows rows={askRows}/>
            {linkLines.map((l) => (
              <div key={l.id} data-testid="no-school-link" data-kind={l.kind} style={{ padding: "12px 14px", border: `1px solid ${T.line.normal}`, borderRadius: "12px", background: T.fill.panel, marginBottom: "8px", ...text(14, T.content.primary) }}>
                {l.words}
              </div>
            ))}
            {/* Q15: waiting to be linked to a child, she may read the school's terms now; agreeing comes after the office checks. */}
            {/* One per school she is waiting on: each school's terms name its own contact. */}
            {[...new Map(waiting.map((w) => rows.find((r) => r.id === w.id)).filter(Boolean)
                .map((r) => [r.school ?? r.schoolName, r.schoolName ?? null])).entries()].map(([k, schoolName]) => (
              <div key={String(k)} style={{ marginTop: "8px" }}>
                <Suspense fallback={null}><WaitingTerms schoolName={schoolName}/></Suspense>
              </div>
            ))}
            {/* Q15: the office's answer, said in a notice with the same words for yes and no; the list above says which. */}
            <AnsweredNotices/>
        </div>

        <HelpLine/>

        <Btn onClick={onSignOut} style={{ marginTop: "16px" }} data-testid="no-school-sign-out">Sign out</Btn>
      </main>
    </div>
  );
}

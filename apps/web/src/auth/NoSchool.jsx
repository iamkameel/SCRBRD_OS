import { useEffect, useId, useState } from "react";
import { ROLES } from "../design/roles.js";
import { T, clr } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { profile } from "../lib/session.js";
import {
  KINDS, PUPIL_UNDER_18, RELATIONSHIPS, REQUEST_STATE_WORDS, STAFF_ROLES,
  EXTRA_MAX, CHILD_MAX, YEAR_MAX, buildRequest, joinWords, sentWords,
} from "../lib/joinSchool.js";

// ══════════════════════════════════════════════════════
//  AN ACCOUNT WITH NO SCHOOL  (SCRBRD-140 §4, §5)
//
//  Where somebody lands who has signed in and holds nothing yet: a new Google
//  account, or an account whose requests are still with the school. They can
//  see their own name, their own requests, the list of schools, and a way to
//  ask. Nothing else — the database proves that table by table (db/99 §60) —
//  and this screen asks for nothing it could not safely hear.
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
const card = { borderRadius: "16px", border: `1px solid ${T.line.normal}`, background: T.fill.panel, padding: "20px", marginBottom: "16px" };

/** A button at the floors: 12px type, 44px tall. */
function Btn({ children, kind = "quiet", style, ...rest }) {
  const main = kind === "primary";
  return (
    <button type="button" className="pressBtn" {...rest}
      style={{ minHeight: "44px", padding: "10px 18px", borderRadius: "999px", boxSizing: "border-box",
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
      style={{ display: "block", width: "100%", textAlign: "left", minHeight: "44px", padding: "12px 14px", marginBottom: "8px",
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
const input = { width: "100%", minHeight: "44px", boxSizing: "border-box", padding: "10px 12px", borderRadius: "10px",
  background: T.fill.field, border: `1px solid ${T.line.normal}`, color: T.content.primary, fontFamily: FONT.body, fontSize: "16px" };

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
    <div data-testid="no-school-help" style={{ ...card, marginBottom: 0 }}>
      <div style={{ fontFamily: FONT.head, fontSize: "14px", fontWeight: 700, color: T.content.primary, marginBottom: "4px" }}>Worried about a child?</div>
      {url
        ? <div style={text(14)}>You do not need a school to speak up. <a href={url} target="_blank" rel="noopener noreferrer" data-testid="no-school-guardian"
            style={{ color: T.brand.blueText, fontWeight: 600 }}>Report anonymously with The Guardian's app</a>.</div>
        : <div style={text(14)} data-testid="no-school-guardian-unset">The Guardian's app link has not been set on this platform yet.</div>}
    </div>
  );
}

/**
 * The join form. `post` is api() unless a test hands in another.
 * @param {{ schools: { id: string, name: string }[], onSent: () => void, post?: typeof api }} p
 */
export function JoinSchool({ schools, onSent, post = api }) {
  const [schoolId, setSchoolId] = useState(schools.length === 1 ? schools[0].id : null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(null);
  const [form, setForm] = useState({ role: "", extra: "", child: "", relationship: "", year: "", adult: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(null);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setProblem(""); };

  // A single school is not a choice (as the earlier sign-up flow already knew).
  useEffect(() => { if (schools.length === 1) setSchoolId(schools[0].id); }, [schools]);
  const school = schools.find((s) => s.id === schoolId) ?? null;
  const shown = schools.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const built = kind ? buildRequest(kind, schoolId, form) : null;

  const send = async () => {
    const r = buildRequest(kind, schoolId, form);
    if (!r.ok) { setProblem(r.problem); return; }
    setBusy(true); setProblem("");
    try {
      await post("/api/requests", { method: "POST", body: r.body });
      setSent({ kind, school: school?.name ?? "" });
      onSent?.();
    } catch (e) { setProblem(joinWords(e)); }
    setBusy(false);
  };

  if (sent) {
    return (
      <div role="status" data-testid="join-sent" style={card}>
        <div style={{ fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary, marginBottom: "6px" }}>Request sent</div>
        <div style={text(14)}>{sentWords(sent.kind, sent.school)}</div>
        <Btn style={{ marginTop: "14px" }} data-testid="join-another" onClick={() => { setSent(null); setKind(null); setForm({ role: "", extra: "", child: "", relationship: "", year: "", adult: "" }); }}>Ask for something else</Btn>
      </div>
    );
  }

  return (
    <div data-testid="join-school" style={card}>
      <h2 style={{ margin: "0 0 4px", fontFamily: FONT.head, fontSize: "18px", fontWeight: 800, color: T.content.primary }}>Join a school</h2>
      <div style={{ ...text(14), marginBottom: "16px" }}>Say which school and who you are. Somebody at the school answers; nothing is given to you until they do.</div>

      {/* 1 · The school */}
      <div role="group" aria-labelledby="join-school-h" style={{ marginBottom: "18px" }}>
        <div id="join-school-h" style={{ fontFamily: FONT.head, fontSize: "13px", fontWeight: 700, color: T.content.primary, marginBottom: "8px" }}>1 · Your school</div>
        {schools.length === 0 && <div style={text(14)}>No school is listed on this platform yet.</div>}
        {schools.length === 1 && <div data-testid="join-only-school" style={text(14, T.content.primary)}>{schools[0].name}</div>}
        {schools.length > 1 && <>
          {schools.length > 6 && (
            <Field label="Search schools">{(id) => <input id={id} value={q} onChange={(e) => setQ(e.target.value)} style={input} autoComplete="off" data-testid="join-school-search"/>}</Field>
          )}
          <div style={{ maxHeight: "260px", overflowY: "auto" }}>
            {shown.map((s) => <Choice key={s.id} on={s.id === schoolId} title={s.name} data-testid={`join-school-${s.id}`} onClick={() => { setSchoolId(s.id); setProblem(""); }}/>)}
            {shown.length === 0 && <div style={text(14)}>No school's name has those letters in it.</div>}
          </div>
        </>}
      </div>

      {/* 2 · Who you are */}
      {schoolId && (
        <div role="group" aria-labelledby="join-kind-h" style={{ marginBottom: "18px" }}>
          <div id="join-kind-h" style={{ fontFamily: FONT.head, fontSize: "13px", fontWeight: 700, color: T.content.primary, marginBottom: "8px" }}>2 · Who you are</div>
          {KINDS.map((k) => <Choice key={k.id} on={kind === k.id} title={k.label} hint={k.hint} data-testid={`join-kind-${k.id}`} onClick={() => { setKind(k.id); setProblem(""); }}/>)}
        </div>
      )}

      {/* 3 · The details each kind needs, and no more */}
      {schoolId && kind === "staff" && (
        <div data-testid="join-form-staff">
          <Field label="What do you do at the school?">{(id) => (
            <select id={id} value={form.role} onChange={(e) => set("role", e.target.value)} style={input} data-testid="join-staff-role">
              <option value="">Choose…</option>
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLES[r]?.label ?? r}</option>)}
            </select>)}</Field>
          <Field label="Anything the office should know (optional)" hint="For example, which side you coach.">{(id) => (
            <input id={id} value={form.extra} maxLength={EXTRA_MAX} onChange={(e) => set("extra", e.target.value)} style={input} autoComplete="off"/>)}</Field>
        </div>
      )}

      {schoolId && kind === "parent" && (
        <div data-testid="join-form-parent">
          {/* Free text, on purpose (§5.3): this form never looks a child up. */}
          <Field label="Your child's name" hint="Type it as you would write it. The school office matches it by hand; nothing is looked up here.">{(id) => (
            <input id={id} value={form.child} maxLength={CHILD_MAX} onChange={(e) => set("child", e.target.value)} style={input} autoComplete="off" data-testid="join-child"/>)}</Field>
          <Field label="How are you related to your child?">{(id) => (
            <select id={id} value={form.relationship} onChange={(e) => set("relationship", e.target.value)} style={input} data-testid="join-relationship">
              <option value="">Choose…</option>
              {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>)}</Field>
          <Field label="Your child's year or team (optional)">{(id) => (
            <input id={id} value={form.year} maxLength={YEAR_MAX} onChange={(e) => set("year", e.target.value)} style={input} autoComplete="off"/>)}</Field>
          {/* SCRBRD-092 / SCRBRD-110 §7: health monitoring is a separate yes, given later. */}
          <div role="note" data-testid="join-health-note" style={{ ...text(13), padding: "12px 14px", borderRadius: "10px", border: `1px solid ${T.line.normal}`, background: T.surface.base, marginBottom: "14px" }}>
            <strong style={{ color: T.content.primary }}>Health monitoring is separate, and off.</strong> It is not part of joining. Once the school has checked that you are your child's parent, you can turn it on, or leave it off, under Settings, Me.
          </div>
        </div>
      )}

      {schoolId && kind === "pupil" && (
        <div data-testid="join-form-pupil">
          <Choice on={form.adult === "yes"} title="I am 18 or older and still at school" data-testid="join-pupil-adult" onClick={() => set("adult", "yes")}/>
          <Choice on={form.adult === "no"} title="I am under 18" data-testid="join-pupil-minor" onClick={() => set("adult", "no")}/>
          {form.adult === "no" && (
            <div role="note" data-testid="join-pupil-under18" style={{ ...text(14), padding: "12px 14px", borderRadius: "10px", border: `1px solid ${T.line.normal}`, background: T.surface.base, marginBottom: "14px" }}>
              <div style={{ fontFamily: FONT.head, fontSize: "14px", fontWeight: 700, color: T.content.primary, marginBottom: "6px" }}>{PUPIL_UNDER_18.title}</div>
              {PUPIL_UNDER_18.lines.map((l) => <div key={l} style={{ marginBottom: "4px" }}>{l}</div>)}
            </div>
          )}
          {form.adult === "yes" && (
            <Field label="Your year or team (optional)" hint="The office matches your request to your place on the school's list.">{(id) => (
              <input id={id} value={form.extra} maxLength={EXTRA_MAX} onChange={(e) => set("extra", e.target.value)} style={input} autoComplete="off"/>)}</Field>
          )}
        </div>
      )}

      {problem && <div role="alert" data-testid="join-problem" style={{ ...text(13, T.semantic.criticalText), padding: "10px 12px", borderRadius: "8px", background: clr(T.semantic.critical, 0.1), border: `1px solid ${clr(T.semantic.critical, 0.2)}`, marginBottom: "12px" }}>{problem}</div>}

      {schoolId && kind && !(kind === "pupil" && form.adult !== "yes") && (
        <Btn kind="primary" data-testid="join-send" disabled={busy || !built?.ok} onClick={send}>{busy ? "Sending…" : "Send my request"}</Btn>
      )}
    </div>
  );
}

/**
 * The screen. `name` is what the shell knows of the person; `onSignOut` is
 * the shell's sign-out (which clears the persisted session too).
 */
export function NoSchool({ name, onSignOut }) {
  const [nudge, setNudge] = useState(0);
  const rows = useLive("role_requests", "spectator", nudge).rows;
  const [schools, setSchools] = useState(null);
  const me = profile()?.user;
  const live = signedIn();

  useEffect(() => {
    let off = false;
    api("/api/schools").then((r) => { if (!off) setSchools((r?.rows ?? []).map((x) => ({ id: x.id, name: x.name }))); }).catch(() => { if (!off) setSchools([]); });
    return () => { off = true; };
  }, []);

  const withdraw = async (id) => { await api(`/api/requests/${id}/withdraw`, { method: "POST" }).catch(() => {}); setNudge((n) => n + 1); };

  // A reload drops the session token on purpose (lib/api.js), and this screen
  // is restored from the saved shell state. Say so, rather than show an empty list.
  if (!live) {
    return (
      <div data-testid="pending-requests" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: T.surface.canvas }}>
        <div style={{ maxWidth: "480px", width: "100%" }} data-testid="no-school-signed-out">
          <h1 style={{ margin: "0 0 8px", fontFamily: FONT.head, fontSize: "22px", color: T.content.primary }}>You were signed out</h1>
          <div style={{ ...text(14), marginBottom: "16px" }}>For your security SCRBRD does not keep you signed in when the page reloads. Sign in again to see your requests.</div>
          <Btn kind="primary" onClick={onSignOut} data-testid="no-school-sign-in-again">Sign in again</Btn>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="pending-requests" style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 16px", background: T.surface.canvas, boxSizing: "border-box" }}>
      <main style={{ maxWidth: "520px", width: "100%" }}>
        <h1 data-testid="no-school-title" style={{ margin: "0 0 4px", fontFamily: FONT.head, fontSize: "22px", fontWeight: 800, color: T.content.primary }}>Hello {name || me?.name || "there"}</h1>
        <div style={{ ...text(14), marginBottom: "4px" }}>You are signed in{me?.email ? <> as <span data-testid="no-school-email" style={{ color: T.content.primary }}>{me.email}</span></> : ""}, and not at a school yet.</div>
        <div style={{ ...text(14), marginBottom: "20px" }}>Your account holds nothing until a school says yes. Until then you can see this page and nothing else.</div>

        {rows.length > 0 && (
          <div style={{ marginBottom: "16px" }} data-testid="no-school-requests">
            <h2 style={{ margin: "0 0 8px", fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary }}>Your requests</h2>
            {rows.map((r) => (
              <div key={r.id} data-testid={`request-${r.state}`} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "12px 14px", border: `1px solid ${T.line.normal}`, borderRadius: "12px", background: T.fill.panel, marginBottom: "8px" }}>
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <div style={{ ...text(14, T.content.primary), fontWeight: 600 }}>{ROLES[r.role]?.label ?? r.role}{r.team ? ` · ${r.team}` : ""}</div>
                  <div style={text(13, T.content.secondary)}>{r.schoolName ?? "School"} · {REQUEST_STATE_WORDS[r.state] ?? r.state}{r.decidedNote ? ` — ${r.decidedNote}` : ""}</div>
                </div>
                {r.state === "pending" && <Btn onClick={() => withdraw(r.id)} data-testid="request-withdraw">Withdraw</Btn>}
              </div>
            ))}
          </div>
        )}

        {schools === null ? <div style={text(14)}>Loading the schools…</div>
          : <JoinSchool schools={schools} onSent={() => setNudge((n) => n + 1)}/>}

        <HelpLine/>

        <Btn onClick={onSignOut} style={{ marginTop: "16px" }} data-testid="no-school-sign-out">Sign out</Btn>
      </main>
    </div>
  );
}

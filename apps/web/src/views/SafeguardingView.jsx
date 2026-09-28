import { useCallback, useEffect, useMemo, useState } from "react";
import { T, inkOn } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { useRows } from "../lib/live.js";
import { Icon } from "../ui/icons.jsx";

/**
 * Safeguarding, phase 1 (db/57; docs/design/SAFEGUARDING_DSO.md §8).
 *
 * One destination, everyone's. For anybody signed in: who the school's
 * Designated Safeguarding Officers are, a way to raise a concern with them,
 * The Guardian's app for an anonymous report, and the references of what
 * they raised — and nothing else about it, ever (SG-2). For the DSO, beside
 * that: the inbox with its clocks, and a concern's own page.
 *
 * WHAT THIS SCREEN DECIDES: nothing. Every route runs one SECURITY DEFINER
 * function that checks who may, and logs every read of the record under the
 * institution that holds it. The inbox is drawn for whoever the server
 * returns rows to; a person who is not a DSO gets none, which is the same
 * answer a DSO with none gets.
 *
 * NO DEMONSTRATION FALLBACK. An invented concern about a named child would
 * read exactly like a real one, and a report typed into a demo would be a
 * child's words sent nowhere.
 *
 * Type is 12px at the smallest, every control is 44px tall, and every colour
 * is read from `T` when the component renders, so both themes are right.
 */

const ABOUT = [
  ["child", "A pupil"],
  ["adult", "An adult at this school"],
  ["leadership", "The school's leadership"],
  ["dso", "The DSO"],
  ["unknown", "I'm not sure"],
];
const NATURE = [
  ["physical", "Physical harm"],
  ["psychological", "Shouting, threats or humiliation"],
  ["bullying", "Bullying"],
  ["neglect", "Neglect"],
  ["sexual_harassment", "Sexual harassment"],
  ["sexual_abuse", "Sexual abuse"],
  ["other", "Something else"],
];
const HOW = [
  ["witness", "I saw or heard it"],
  ["told", "Someone told me"],
  ["victim", "It happened to me"],
  ["other", "Another way"],
];
// A report The Guardian's app passed on is recorded by a DSO (72-hour clock).
const HOW_DSO = [...HOW, ["anonymous_app", "Passed on by The Guardian's app"]];
const OUTCOME = [
  ["no_action", "No further action"],
  ["supported", "The child is being supported"],
  ["referred_saps", "Referred to SAPS"],
  ["referred_social_development", "Referred to Social Development"],
  ["disciplinary_enquiry", "A disciplinary enquiry"],
  ["handed_to_union", "Handed to the provincial DSO"],
  ["other", "Other"],
];
const NOTE_KIND = [
  ["note", "A note"],
  ["family_contacted", "Family contacted"],
  ["guardian_contacted", "Parent contacted"],
  ["saps_contacted", "SAPS contacted"],
  ["social_development_contacted", "Social Development contacted"],
  ["ndso_informed", "NDSO informed (stops the clock)"],
];
const SHARE_PART = [
  ["summary", "What kind of concern, and when"],
  ["child", "The child's name"],
  ["account", "The account"],
  ["actions", "What has been done"],
];
const label = (list, k) => list.find(([v]) => v === k)?.[1] ?? k;

const REFUSAL = {
  not_signed_in: "Your session has ended. Sign in again; nothing was sent.",
  not_your_school: "Choose a school you belong to.",
  about_kind_invalid: "Say who this is about.",
  nature_invalid: "Choose at least one kind of concern.",
  certainty_invalid: "Say whether you are worried it might be happening, or know it happened.",
  account_length: "Say what happened in at least a sentence (twenty characters or more).",
  how_learned_invalid: "Say how you know.",
  anonymous_app_is_recorded_by_a_dso: "Only a DSO records a report passed on by The Guardian's app.",
  too_long: "One of the answers is too long.",
  occurred_in_future: "The date cannot be in the future.",
  child_not_visible: "That pupil is not one you can name here. Describe who instead.",
  subject_unknown: "That person is not one you can name here. Describe who instead.",
  no_such_concern: "That concern is not one you can open.",
  concern_closed: "That concern is closed.",
  kind_invalid: "Choose what kind of note this is.",
  body_length: "A note needs a few words, and no more than 4,000 characters.",
  not_a_dso_here: "That person is not a DSO who holds this concern.",
  no_such_person: "Choose somebody to share it with.",
  recipient_is_subject: "Not the person the concern is about.",
  recipient_is_pupil: "Not a pupil: a DSO tells a child in person, not through a notice.",
  what_invalid: "Choose what to share.",
  no_child_named: "No child is named in this concern.",
  open_until_out_of_range: "Share it for at most thirty days, from now.",
  reason_required: "Say why they need to know, in at least ten characters.",
  link_invalid: "That is not a verified parent of this child.",
  outcome_invalid: "Choose the outcome.",
  position_of_trust_required: "Say whether this concerns somebody in a position of trust.",
  no_such_share: "That share has ended.",
};
const say = (e) => REFUSAL[e?.code]
  ?? (e?.status ? `Not done. The server said ${e.code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was sent.");
const when = (t) => (t ? new Date(t).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const day = (t) => (t ? new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "");

// ── Styles, built from T when a component renders ──────────────
function useStyles() {
  return {
    page: { maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", gap: T.space.lg,
            fontFamily: T.type.body, color: T.content.primary },
    title: { fontFamily: T.type.head, fontSize: "24px", fontWeight: 700, color: T.content.primary, margin: 0 },
    h2: { fontFamily: T.type.body, fontSize: "18px", fontWeight: 600, color: T.content.primary, margin: 0 },
    body: { fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.5, color: T.content.secondary, margin: 0 },
    small: { fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.5, color: T.content.secondary },
    meta: { fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.4, color: T.content.tertiary },
    mono: { fontFamily: T.type.mono, fontSize: "14px", color: T.content.primary },
    card: { background: T.surface.raised, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg,
            padding: T.space.lg, display: "flex", flexDirection: "column", gap: T.space.md },
    row: { display: "flex", gap: T.space.sm, flexWrap: "wrap", alignItems: "center" },
    field: { width: "100%", minHeight: "44px", padding: "10px 12px", borderRadius: T.radius.md, boxSizing: "border-box",
             background: T.surface.base, border: `1px solid ${T.line.strong}`, color: T.content.primary,
             fontFamily: T.type.body, fontSize: "16px" },
    fieldLabel: { fontFamily: T.type.body, fontSize: "13px", fontWeight: 600, color: T.content.primary, display: "block",
                  marginBottom: T.space.xs },
    choice: (on) => ({ minHeight: "44px", display: "flex", alignItems: "center", gap: T.space.sm, padding: "8px 12px",
                       borderRadius: T.radius.md, cursor: "pointer", boxSizing: "border-box",
                       border: `1px solid ${on ? T.content.primary : T.line.strong}`,
                       background: on ? T.surface.interactive : "transparent",
                       fontFamily: T.type.body, fontSize: "15px", color: T.content.primary }),
    primary: { minHeight: "44px", padding: "10px 18px", borderRadius: T.radius.pill, border: "none", cursor: "pointer",
               background: T.content.primary, color: inkOn(T.content.primary), fontFamily: T.type.body,
               fontSize: "15px", fontWeight: 600 },
    secondary: { minHeight: "44px", padding: "10px 18px", borderRadius: T.radius.pill, cursor: "pointer",
                 background: "transparent", color: T.content.primary, border: `1px solid ${T.line.strong}`,
                 fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, textDecoration: "none",
                 display: "inline-flex", alignItems: "center", gap: T.space.sm, boxSizing: "border-box" },
    listItem: { minHeight: "44px", width: "100%", textAlign: "left", display: "flex", gap: T.space.md,
                alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: "10px 12px",
                borderRadius: T.radius.md, border: `1px solid ${T.line.normal}`, background: T.surface.base,
                cursor: "pointer", color: T.content.primary, fontFamily: T.type.body, fontSize: "15px",
                boxSizing: "border-box" },
    alert: { fontFamily: T.type.body, fontSize: "14px", color: T.semantic.criticalText },
    pill: (tone) => ({ display: "inline-flex", alignItems: "center", minHeight: "24px", padding: "2px 10px",
                       borderRadius: T.radius.pill, border: `1px solid ${tone}`, color: tone,
                       fontFamily: T.type.body, fontSize: "12px", fontWeight: 600 }),
    pre: { whiteSpace: "pre-wrap", fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.6, color: T.content.primary,
           margin: 0, background: T.surface.base, borderRadius: T.radius.md, padding: T.space.md,
           border: `1px solid ${T.line.subtle}` },
  };
}

function Refused({ said }) {
  const s = useStyles();
  if (!said) return null;
  return <p role="alert" data-testid="sg-refused" style={{ ...s.alert, margin: 0 }}>{said}</p>;
}

/** A labelled control. */
function Field({ label: text, hint, children, htmlFor }) {
  const s = useStyles();
  return (
    <div>
      <label htmlFor={htmlFor} style={s.fieldLabel}>{text}</label>
      {hint && <div style={{ ...s.meta, marginBottom: T.space.xs }}>{hint}</div>}
      {children}
    </div>
  );
}

/** A set of choices drawn as large targets. One or many. */
function Choices({ name, options, value, onChange, many = false, testid }) {
  const s = useStyles();
  const on = (k) => (many ? value.includes(k) : value === k);
  const flip = (k) => onChange(many ? (value.includes(k) ? value.filter((x) => x !== k) : [...value, k]) : k);
  return (
    <div role={many ? "group" : "radiogroup"} aria-label={name} data-testid={testid}
         style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
      {options.map(([k, text]) => (
        <label key={k} style={s.choice(on(k))} data-testid={testid ? `${testid}-${k}` : undefined}>
          <input type={many ? "checkbox" : "radio"} name={name} checked={on(k)} onChange={() => flip(k)}
                 style={{ width: "20px", height: "20px", margin: 0, accentColor: T.content.primary }}/>
          {text}
        </label>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  The page
// ══════════════════════════════════════════════════════

export function SafeguardingView({ role }) {
  const s = useStyles();
  if (!signedIn()) {
    return (
      <div className="os-page" style={s.page} data-testid="safeguarding">
        <h1 style={s.title}>Safeguarding</h1>
        <div style={s.card}>
          <p style={s.body}>
            If you are worried about a child, or about how an adult is treating one, tell your school's
            Designated Safeguarding Officer. Sign in to the live platform to raise a concern: a demonstration
            sends nothing to anybody.
          </p>
          <p style={s.body}>
            To report anonymously, use The Guardian's app, Cricket South Africa's safeguarding partner.
            If a child is in danger now, phone SAPS on 10111 or Childline on 116.
          </p>
        </div>
      </div>
    );
  }
  return <SafeguardingLive role={role}/>;
}

function SafeguardingLive({ role }) {
  const s = useStyles();
  const [nonce, setNonce] = useState(0);
  const again = useCallback(() => setNonce((n) => n + 1), []);
  const [screen, setScreen] = useState({ at: "home" });
  const [contacts, setContacts] = useState({ rows: [], guardianAppUrl: null, loading: true, error: null });
  const [receipts, setReceipts] = useState([]);
  const [shares, setShares] = useState([]);
  const [inbox, setInbox] = useState({ rows: [], loaded: false });

  useEffect(() => {
    let off = false;
    api("/api/safeguarding/contacts")
      .then((r) => { if (!off) setContacts({ rows: r?.rows ?? [], guardianAppUrl: r?.guardianAppUrl ?? null, loading: false, error: null }); })
      .catch((e) => { if (!off) setContacts({ rows: [], guardianAppUrl: null, loading: false, error: say(e) }); });
    api("/api/safeguarding/receipts").then((r) => { if (!off) setReceipts(r?.rows ?? []); }).catch(() => {});
    api("/api/safeguarding/shares").then((r) => { if (!off) setShares(r?.rows ?? []); }).catch(() => {});
    api("/api/safeguarding/inbox").then((r) => { if (!off) setInbox({ rows: r?.rows ?? [], loaded: true }); }).catch(() => {});
    return () => { off = true; };
  }, [nonce]);

  // Courtesy only: whether to draw the inbox heading when it is empty.
  const isDso = (profile()?.assignments ?? []).some((a) => a.role === "dso");
  const home = () => { setScreen({ at: "home" }); again(); };

  if (screen.at === "raise") return <RaiseForm role={role} isDso={isDso} contacts={contacts} onSent={(r) => setScreen({ at: "sent", r })} onCancel={home}/>;
  if (screen.at === "sent") return <Receipt r={screen.r} guardianAppUrl={contacts.guardianAppUrl} onDone={home}/>;
  if (screen.at === "concern") return <Concern id={screen.id} role={role} onBack={home}/>;
  if (screen.at === "share") return <SharedWithMe id={screen.id} onBack={home}/>;

  const bySchool = contacts.rows.reduce((acc, c) => { (acc[c.schoolId] ??= { name: c.schoolName, rows: [] }).rows.push(c); return acc; }, {});
  return (
    <div className="os-page" style={s.page} data-testid="safeguarding">
      <div>
        <h1 style={s.title}>Safeguarding</h1>
        <p style={{ ...s.body, marginTop: T.space.sm }}>
          If you are worried about a child, or about how an adult is treating one, tell your school's
          Designated Safeguarding Officer (DSO). You do not need to be sure.
        </p>
      </div>

      <section style={s.card} aria-labelledby="sg-dso-h" data-testid="sg-dso-card">
        <h2 id="sg-dso-h" style={s.h2}>Your DSO</h2>
        {contacts.loading && <p style={s.meta}>Loading…</p>}
        {contacts.error && <Refused said={contacts.error}/>}
        {!contacts.loading && !contacts.rows.length && !contacts.error &&
          <p style={s.small}>You are not attached to a school yet, so there is no DSO to show.</p>}
        {Object.entries(bySchool).map(([id, sc]) => (
          <div key={id} data-testid="sg-dso-school">
            <div style={{ ...s.small, fontWeight: 600, color: T.content.primary }}>{sc.name}</div>
            {sc.rows[0].heldAt === "none"
              ? <p style={s.small}>This school has not yet appointed a DSO, and nobody above it has one either.
                  Please use The Guardian's app, or phone Childline on 116.</p>
              : <>
                  {sc.rows[0].heldAt !== "school" &&
                    <p style={s.small}>This school has not yet appointed a DSO. Concerns go to the
                      {sc.rows[0].heldAt === "federation" ? " national" : " provincial"} DSO instead:</p>}
                  <ul style={{ margin: `${T.space.xs} 0 0`, paddingLeft: "20px" }}>
                    {sc.rows.map((c) => <li key={c.personId} style={s.body} data-testid="sg-dso-name">{c.name}</li>)}
                  </ul>
                </>}
          </div>
        ))}
        <div style={s.row}>
          <button type="button" className="pressBtn" style={s.primary} data-testid="sg-raise"
                  onClick={() => setScreen({ at: "raise" })} disabled={!contacts.rows.length}>
            Raise a concern
          </button>
          <GuardianLink url={contacts.guardianAppUrl}/>
        </div>
        <p style={s.meta}>If a child is in danger now, phone SAPS on 10111 or Childline on 116.</p>
      </section>

      {(isDso || inbox.rows.length > 0) && (
        <section style={s.card} aria-labelledby="sg-inbox-h" data-testid="sg-inbox">
          <h2 id="sg-inbox-h" style={s.h2}>Inbox</h2>
          <p style={s.meta}>Only you and the other DSOs who hold these can see them. Every opening is on the record.</p>
          {inbox.loaded && !inbox.rows.length && <p style={s.small}>Nothing has been raised.</p>}
          {inbox.rows.map((c) => (
            <button key={c.id} type="button" style={s.listItem} data-testid="sg-inbox-row" data-reference={c.reference}
                    onClick={() => setScreen({ at: "concern", id: c.id })}>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={s.mono}>{c.reference}</span>
                <span style={s.meta}>
                  {label(ABOUT, c.aboutKind)} · {(c.nature ?? []).map((n) => label(NATURE, n)).join(", ")}
                  {c.tenantId !== c.schoolId ? ` · ${c.schoolName}` : ""}
                </span>
              </span>
              <Clock c={c}/>
            </button>
          ))}
        </section>
      )}

      {shares.length > 0 && (
        <section style={s.card} aria-labelledby="sg-shared-h" data-testid="sg-shared">
          <h2 id="sg-shared-h" style={s.h2}>Shared with you</h2>
          <p style={s.meta}>A DSO has shared part of a concern with you, because you need to know. Keep it to yourself.</p>
          {shares.map((sh) => (
            <button key={sh.id} type="button" style={s.listItem} data-testid="sg-shared-row"
                    onClick={() => setScreen({ at: "share", id: sh.id })}>
              <span>Shared {when(sh.sharedAt)}</span>
              <span style={s.meta}>until {when(sh.openUntil)}</span>
            </button>
          ))}
        </section>
      )}

      <section style={s.card} aria-labelledby="sg-mine-h" data-testid="sg-receipts">
        <h2 id="sg-mine-h" style={s.h2}>What you have raised</h2>
        {!receipts.length && <p style={s.small}>Nothing yet.</p>}
        {receipts.map((r) => (
          <div key={r.reference} style={{ ...s.row, justifyContent: "space-between" }} data-testid="sg-receipt">
            <span style={s.mono}>{r.reference}</span>
            <span style={s.meta}>{when(r.raisedAt)}</span>
          </div>
        ))}
        {receipts.length > 0 &&
          <p style={s.meta}>The DSO has each of these. What happens next is theirs to decide, and it is not shown here.</p>}
      </section>
    </div>
  );
}

function GuardianLink({ url }) {
  const s = useStyles();
  if (!url) return <span style={s.meta} data-testid="sg-guardian-unset">The Guardian's app link has not been set on this platform yet.</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={s.secondary} data-testid="sg-guardian">
      Report anonymously <Icon name="arrow-up-right"/>
    </a>
  );
}

/** Hours since it was raised, against its clock: 24 to the NDSO, 72 for The Guardian's app. */
function Clock({ c }) {
  const s = useStyles();
  if (c.state === "closed") return <span style={s.pill(T.content.tertiary)}>Closed</span>;
  const hours = Math.floor(c.hoursOpen ?? 0);
  if (c.clockStopped) return <span style={s.pill(T.semantic.positive)} data-testid="sg-clock">NDSO informed</span>;
  const tone = c.overdue ? T.semantic.criticalText : hours >= c.clockHours - 6 ? T.semantic.warning : T.content.secondary;
  return (
    <span style={s.pill(tone)} data-testid="sg-clock" data-overdue={c.overdue ? "true" : "false"}>
      {hours} h of {c.clockHours}{c.overdue ? " — overdue" : ""}
    </span>
  );
}

// ══════════════════════════════════════════════════════
//  Raising a concern
// ══════════════════════════════════════════════════════

function RaiseForm({ role, isDso, contacts, onSent, onCancel }) {
  const s = useStyles();
  const schools = useMemo(() => {
    const seen = new Map();
    for (const c of contacts.rows) if (!seen.has(c.schoolId)) seen.set(c.schoolId, c.schoolName);
    return [...seen.entries()];
  }, [contacts.rows]);
  const players = useRows("players", role);
  const [f, setF] = useState({
    schoolId: schools[0]?.[0] ?? "", aboutKind: "", subjectPlayerId: "", subjectText: "", nature: [],
    certainty: "", howLearned: "", occurredOn: "", occurredWhere: "", account: "", authoritiesTold: "",
    namedOk: false, preferredDsoId: "",
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const children = players.filter((p) => p.school === f.schoolId);
  const dsos = contacts.rows.filter((c) => c.schoolId === f.schoolId && c.heldAt === "school");

  const send = async () => {
    setSaid(""); setBusy(true);
    try {
      const r = await api("/api/safeguarding/concerns", { method: "POST", body: {
        schoolId: f.schoolId, aboutKind: f.aboutKind || null, nature: f.nature, certainty: f.certainty || null,
        account: f.account, howLearned: f.howLearned || null,
        subjectPlayerId: f.aboutKind === "child" && f.subjectPlayerId ? f.subjectPlayerId : null,
        subjectText: f.subjectText || null, occurredOn: f.occurredOn || null, occurredWhere: f.occurredWhere || null,
        authoritiesTold: f.authoritiesTold || null, namedOk: f.namedOk, preferredDsoId: f.preferredDsoId || null,
      } });
      onSent(r);
    } catch (e) { setSaid(say(e)); }
    setBusy(false);
  };

  return (
    <div className="os-page" style={s.page} data-testid="sg-form">
      <div>
        <h1 style={s.title}>Raise a concern</h1>
        <p style={{ ...s.body, marginTop: T.space.sm }}>
          Tell the DSO what you know, in your own words. You do not need to be sure, and you do not need to
          investigate. CSA asks that a concern reach the DSO within 24 hours of a child telling you something.
        </p>
      </div>
      <div style={{ ...s.card, borderColor: T.line.strong }} data-testid="sg-honesty">
        <p style={{ ...s.body, color: T.content.primary }}>
          <strong>This report is confidential, not anonymous.</strong> The DSO will know it came from you.
          Nobody else at the school can see it, and the person it is about is never shown it.
        </p>
        <p style={s.small}>
          To report anonymously, use The Guardian's app instead. If a child is in danger now, phone SAPS on 10111.
        </p>
        <div><GuardianLink url={contacts.guardianAppUrl}/></div>
      </div>

      <div style={s.card}>
        {schools.length > 1 && (
          <Field label="Which school is this about?" htmlFor="sg-school">
            <select id="sg-school" style={s.field} value={f.schoolId} onChange={(e) => set("schoolId")(e.target.value)}>
              {schools.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </Field>
        )}
        <Field label="This is about">
          <Choices name="about" options={ABOUT} value={f.aboutKind} onChange={set("aboutKind")} testid="sg-about"/>
        </Field>
        {f.aboutKind === "child" && children.length > 0 && (
          <Field label="Which pupil? (optional)" htmlFor="sg-child" hint="Only pupils you can already see are listed.">
            <select id="sg-child" style={s.field} value={f.subjectPlayerId} onChange={(e) => set("subjectPlayerId")(e.target.value)}>
              <option value="">I would rather describe who</option>
              {children.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team ? ` (${p.team})` : ""}</option>)}
            </select>
          </Field>
        )}
        <Field label="Who is it about, in your words (optional)" htmlFor="sg-who">
          <input id="sg-who" style={s.field} maxLength={500} value={f.subjectText} onChange={(e) => set("subjectText")(e.target.value)}/>
        </Field>
        <Field label="What kind of concern? Choose any that fit">
          <Choices name="nature" options={NATURE} value={f.nature} onChange={set("nature")} many testid="sg-nature"/>
        </Field>
        <Field label="How sure are you?">
          <Choices name="certainty" value={f.certainty} onChange={set("certainty")} testid="sg-certainty"
                   options={[["suspicion", "I am worried it might be happening"], ["recognised", "I know it happened"]]}/>
        </Field>
        <Field label="How do you know?">
          <Choices name="how" options={isDso ? HOW_DSO : HOW} value={f.howLearned} onChange={set("howLearned")} testid="sg-how"/>
        </Field>
        <Field label="What happened" htmlFor="sg-account" hint="Use the child's own words where you can. Write what you saw or were told, not what you think it means.">
          <textarea id="sg-account" data-testid="sg-account" rows={7} maxLength={8000}
                    style={{ ...s.field, minHeight: "160px", resize: "vertical" }}
                    value={f.account} onChange={(e) => set("account")(e.target.value)}/>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: T.space.md }}>
          <Field label="When (if you know)" htmlFor="sg-when">
            <input id="sg-when" type="date" style={s.field} value={f.occurredOn} onChange={(e) => set("occurredOn")(e.target.value)}/>
          </Field>
          <Field label="Where (if you know)" htmlFor="sg-where">
            <input id="sg-where" style={s.field} maxLength={200} value={f.occurredWhere} onChange={(e) => set("occurredWhere")(e.target.value)}/>
          </Field>
        </div>
        <Field label="Has anyone already been told? (optional)" htmlFor="sg-told" hint="SAPS, The Guardian, a social worker, a teacher.">
          <input id="sg-told" style={s.field} maxLength={500} value={f.authoritiesTold} onChange={(e) => set("authoritiesTold")(e.target.value)}/>
        </Field>
        {dsos.length > 1 && (
          <Field label="Which DSO would you like to handle it? (optional)" htmlFor="sg-dso">
            <select id="sg-dso" style={s.field} value={f.preferredDsoId} onChange={(e) => set("preferredDsoId")(e.target.value)}>
              <option value="">Any of them</option>
              {dsos.map((d) => <option key={d.personId} value={d.personId}>{d.name}</option>)}
            </select>
          </Field>
        )}
        <label style={s.choice(f.namedOk)}>
          <input type="checkbox" checked={f.namedOk} onChange={(e) => set("namedOk")(e.target.checked)}
                 style={{ width: "20px", height: "20px", margin: 0, accentColor: T.content.primary }}/>
          The DSO may tell others that it was me who reported this
        </label>
        <Refused said={said}/>
        <div style={s.row}>
          <button type="button" className="pressBtn" style={s.primary} onClick={send} disabled={busy} data-testid="sg-send">
            {busy ? "Sending…" : "Send to the DSO"}
          </button>
          <button type="button" className="pressBtn" style={s.secondary} onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** After sending: the receipt, and nothing else (SG-2). */
function Receipt({ r, guardianAppUrl, onDone }) {
  const s = useStyles();
  return (
    <div className="os-page" style={s.page} data-testid="sg-sent">
      <div style={s.card} role="status">
        <h1 style={s.title}>Received. The DSO has it.</h1>
        <p style={s.body}>Your reference is</p>
        <p style={{ ...s.mono, fontSize: "24px", margin: 0 }} data-testid="sg-reference">{r.reference}</p>
        <p style={s.small}>Sent {when(r.raisedAt)}. Keep the reference: it shows when you reported.</p>
        {r.unheld && (
          <p style={{ ...s.body, color: T.content.primary }} data-testid="sg-unheld">
            Nobody can hold this properly at your school yet. Please also use The Guardian's app, or phone Childline on 116.
          </p>
        )}
        {r.unheld && <div><GuardianLink url={guardianAppUrl}/></div>}
        <div><button type="button" className="pressBtn" style={s.primary} onClick={onDone}>Done</button></div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  The DSO: one concern
// ══════════════════════════════════════════════════════

function Concern({ id, role, onBack }) {
  const s = useStyles();
  const [nonce, setNonce] = useState(0);
  const again = () => setNonce((n) => n + 1);
  const [c, setC] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let off = false;
    api(`/api/safeguarding/concerns/${id}`)
      .then((r) => { if (!off) { setC(r); setError(""); } })
      .catch((e) => { if (!off) setError(say(e)); });
    return () => { off = true; };
  }, [id, nonce]);

  if (error) return (
    <div className="os-page" style={s.page}><Refused said={error}/>
      <div><button type="button" style={s.secondary} onClick={onBack}>Back</button></div></div>
  );
  if (!c) return <div className="os-page" style={s.page}><p style={s.meta}>Loading…</p></div>;
  const open = c.state === "open";
  return (
    <div className="os-page" style={s.page} data-testid="sg-concern">
      <div style={s.row}>
        <button type="button" className="pressBtn" style={s.secondary} onClick={onBack}>Back to the inbox</button>
      </div>
      <div style={s.card}>
        <div style={{ ...s.row, justifyContent: "space-between" }}>
          <h1 style={{ ...s.title, fontFamily: T.type.mono }}>{c.reference}</h1>
          <Clock c={{ state: c.state, hoursOpen: c.clock?.open, clockHours: c.clock?.hours,
                      clockStopped: c.clock?.stopped, overdue: c.clock?.overdue }}/>
        </div>
        <p style={s.small}>
          Raised {when(c.raisedAt)} · {c.schoolName}{c.tenantId !== c.schoolId ? ` (held by ${c.tenantName})` : ""}
          {c.unheld ? " · raised when nobody could properly hold it" : ""}
        </p>
        <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px,max-content) 1fr", gap: `${T.space.xs} ${T.space.md}`, margin: 0 }}>
          <Term k="About" v={label(ABOUT, c.aboutKind)}/>
          {c.subjectPlayer && <Term k="Child" v={`${c.subjectPlayer.name}${c.subjectPlayer.team ? ` (${c.subjectPlayer.team})` : ""}`}/>}
          {c.subjectPerson && <Term k="Adult named" v={c.subjectPerson.name}/>}
          {c.subjectText && <Term k="Described as" v={c.subjectText}/>}
          <Term k="Kind" v={(c.nature ?? []).map((n) => label(NATURE, n)).join(", ")}/>
          <Term k="Certainty" v={c.certainty === "recognised" ? "Known to have happened" : "A suspicion"}/>
          {(c.occurredOn || c.occurredWhere) && <Term k="When and where" v={[day(c.occurredOn), c.occurredWhere].filter(Boolean).join(" · ")}/>}
          {c.authoritiesTold && <Term k="Already told" v={c.authoritiesTold}/>}
          {c.reporter && <Term k="Raised by" v={`${c.reporter.name} · ${label(HOW_DSO, c.reporter.howLearned)} · ${c.reporter.namedOk ? "may be named" : "not to be named to others"}`}/>}
          {c.assignedTo && <Term k="Working it" v={c.assignedTo.name}/>}
        </dl>
        <div>
          <div style={s.fieldLabel}>The account, as written</div>
          <p style={s.pre} data-testid="sg-account-read">{c.account}</p>
        </div>
        {!open && <p style={s.small}>Closed {when(c.closedAt)} by {c.closedBy} · {label(OUTCOME, c.outcome)} · kept until {day(c.retainUntil)}.</p>}
      </div>

      {open && c.canManage && <Assign c={c} onDone={again}/>}
      {open && c.subjectPlayer && <Family id={c.id}/>}
      <Notes c={c} onDone={again}/>
      <Shares c={c} role={role} onDone={again}/>
      {open && c.canManage && <Close c={c} onDone={again}/>}
    </div>
  );
}

function Term({ k, v }) {
  const s = useStyles();
  return (<><dt style={{ ...s.meta, paddingTop: "3px" }}>{k}</dt><dd style={{ ...s.body, color: T.content.primary, margin: 0 }}>{v}</dd></>);
}

function Assign({ c, onDone }) {
  const s = useStyles();
  const [dso, setDso] = useState(c.assignedTo?.id ?? "");
  const [said, setSaid] = useState("");
  if ((c.dsos ?? []).length < 2) return null;
  const go = async () => {
    setSaid("");
    try { await api(`/api/safeguarding/concerns/${c.id}/assign`, { method: "POST", body: { dsoId: dso } }); onDone(); }
    catch (e) { setSaid(say(e)); }
  };
  return (
    <div style={s.card}>
      <Field label="Who is working it" htmlFor="sg-assign">
        <select id="sg-assign" style={s.field} value={dso} onChange={(e) => setDso(e.target.value)}>
          <option value="" disabled>Choose a DSO</option>
          {c.dsos.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Refused said={said}/>
      <div><button type="button" style={s.secondary} onClick={go} disabled={!dso}>Assign</button></div>
    </div>
  );
}

/** The child's parents and contacts: through the open concern, and on the record. */
function Family({ id }) {
  const s = useStyles();
  const [fam, setFam] = useState(null);
  const [said, setSaid] = useState("");
  const load = async () => {
    setSaid("");
    try { setFam(await api(`/api/safeguarding/concerns/${id}/family`)); } catch (e) { setSaid(say(e)); }
  };
  return (
    <div style={s.card}>
      <h2 style={s.h2}>The child's family</h2>
      {!fam && <>
        <p style={s.small}>Reaching the family is recorded on this concern's log.</p>
        <div><button type="button" style={s.secondary} onClick={load} data-testid="sg-family">Show the parents and contacts</button></div>
      </>}
      <Refused said={said}/>
      {fam && <>
        {(fam.guardians ?? []).map((g) => <p key={g.linkId} style={s.body}>{g.name} ({g.relationship}) · {g.email}</p>)}
        {!(fam.guardians ?? []).length && <p style={s.small}>No verified parent is on record.</p>}
        {(fam.emergency ?? []).map((e) => <p key={`${e.priority}-${e.name}`} style={s.body}>{e.priority}. {e.name} ({e.relationship}) · {e.phone}{e.phoneAlt ? ` · ${e.phoneAlt}` : ""}</p>)}
      </>}
    </div>
  );
}

function Notes({ c, onDone }) {
  const s = useStyles();
  const [kind, setKind] = useState("note");
  const [body, setBody] = useState("");
  const [said, setSaid] = useState("");
  const add = async () => {
    setSaid("");
    try { await api(`/api/safeguarding/concerns/${c.id}/notes`, { method: "POST", body: { kind, body } }); setBody(""); onDone(); }
    catch (e) { setSaid(say(e)); }
  };
  const KIND_LABEL = { raised: "Raised", assigned: "Assigned", shared: "Shared", share_revoked: "Share ended",
                       position_of_trust_set: "Position of trust", closed: "Closed", ...Object.fromEntries(NOTE_KIND) };
  return (
    <div style={s.card} data-testid="sg-notes">
      <h2 style={s.h2}>What has been done</h2>
      <p style={s.meta}>Notes are added, never edited. A correction is another note.</p>
      {(c.notes ?? []).map((n) => (
        <div key={n.id} style={{ borderTop: `1px solid ${T.line.subtle}`, paddingTop: T.space.sm }}>
          <div style={s.meta}>{KIND_LABEL[n.kind] ?? n.kind} · {n.by} · {when(n.at)}</div>
          {n.body && <p style={{ ...s.body, color: T.content.primary, whiteSpace: "pre-wrap" }}>{n.body}</p>}
        </div>
      ))}
      {c.state === "open" && c.canManage && <>
        <Field label="Add" htmlFor="sg-note-kind">
          <select id="sg-note-kind" style={s.field} value={kind} onChange={(e) => setKind(e.target.value)}>
            {NOTE_KIND.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </Field>
        <textarea aria-label="Note" rows={3} maxLength={4000} style={{ ...s.field, resize: "vertical" }}
                  value={body} onChange={(e) => setBody(e.target.value)} data-testid="sg-note-body"/>
        <Refused said={said}/>
        <div><button type="button" style={s.secondary} onClick={add} data-testid="sg-note-add">Add to the record</button></div>
      </>}
    </div>
  );
}

function Shares({ c, role, onDone }) {
  const s = useStyles();
  const users = useRows("users", role);
  const people = users.filter((u) => u.school === c.schoolId && !u.player && u.id !== c.subjectPerson?.id && u.status === "active");
  const soon = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({ withPersonId: "", what: ["summary"], until: soon(), reason: "" });
  const [said, setSaid] = useState("");
  const share = async () => {
    setSaid("");
    // The end of the chosen day, South African time; the server holds it to thirty days.
    const openUntil = f.until ? new Date(`${f.until}T23:59:00+02:00`).toISOString() : null;
    try {
      await api(`/api/safeguarding/concerns/${c.id}/shares`, { method: "POST",
        body: { withPersonId: f.withPersonId, what: f.what, openUntil, reason: f.reason } });
      setF({ withPersonId: "", what: ["summary"], until: soon(), reason: "" });
      onDone();
    } catch (e) { setSaid(say(e)); }
  };
  const revoke = async (sid) => {
    setSaid("");
    try { await api(`/api/safeguarding/shares/${sid}/revoke`, { method: "POST" }); onDone(); }
    catch (e) { setSaid(say(e)); }
  };
  const max = new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10);
  return (
    <div style={s.card} data-testid="sg-shares">
      <h2 style={s.h2}>Who else knows</h2>
      <p style={s.meta}>Share only what a person needs to know, for as long as they need it. Who reported this is never shared.</p>
      {!(c.shares ?? []).length && <p style={s.small}>Nobody outside the DSOs.</p>}
      {(c.shares ?? []).map((sh) => (
        <div key={sh.id} style={{ ...s.row, justifyContent: "space-between", borderTop: `1px solid ${T.line.subtle}`, paddingTop: T.space.sm }}>
          <span style={s.body}>
            <span style={{ color: T.content.primary }}>{sh.with}</span> · {(sh.what ?? []).map((w) => label(SHARE_PART, w)).join(", ")}
            <br/><span style={s.meta}>{sh.live ? `until ${when(sh.openUntil)}` : sh.revokedAt ? `ended ${when(sh.revokedAt)}` : "lapsed"} · {sh.reason}</span>
          </span>
          {sh.live && c.canManage && <button type="button" style={s.secondary} onClick={() => revoke(sh.id)}>End it now</button>}
        </div>
      ))}
      {c.state === "open" && c.canManage && <>
        <Field label="Share with" htmlFor="sg-share-with">
          <select id="sg-share-with" style={s.field} value={f.withPersonId} onChange={(e) => setF((x) => ({ ...x, withPersonId: e.target.value }))}>
            <option value="">Choose a person</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="What they may read">
          <Choices name="share-what" options={SHARE_PART.filter(([k]) => k !== "child" || c.subjectPlayer)} value={f.what}
                   onChange={(v) => setF((x) => ({ ...x, what: v }))} many/>
        </Field>
        <Field label="Until (thirty days at most)" htmlFor="sg-share-until">
          <input id="sg-share-until" type="date" style={s.field} value={f.until} max={max}
                 onChange={(e) => setF((x) => ({ ...x, until: e.target.value }))}/>
        </Field>
        <Field label="Why they need to know" htmlFor="sg-share-why">
          <input id="sg-share-why" style={s.field} maxLength={500} value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))}/>
        </Field>
        <Refused said={said}/>
        <div><button type="button" style={s.secondary} onClick={share}>Share</button></div>
      </>}
    </div>
  );
}

function Close({ c, onDone }) {
  const s = useStyles();
  const [outcome, setOutcome] = useState("");
  const [trust, setTrust] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState("");
  const go = async () => {
    setSaid("");
    try {
      await api(`/api/safeguarding/concerns/${c.id}/close`, { method: "POST",
        body: { outcome, positionOfTrust: trust === "yes" ? true : trust === "no" ? false : null, note: note || null } });
      onDone();
    } catch (e) { setSaid(say(e)); }
  };
  return (
    <div style={s.card}>
      <h2 style={s.h2}>Close</h2>
      <p style={s.meta}>Closing ends every share. The record is kept for at least three years, or five where it concerns somebody in a position of trust.</p>
      <Field label="Outcome" htmlFor="sg-outcome">
        <select id="sg-outcome" style={s.field} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Choose</option>
          {OUTCOME.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </Field>
      <Field label="Does it concern somebody in a position of trust?">
        <Choices name="trust" value={trust} onChange={setTrust} options={[["yes", "Yes"], ["no", "No"]]}/>
      </Field>
      <textarea aria-label="Closing note" rows={2} maxLength={4000} style={{ ...s.field, resize: "vertical" }}
                value={note} onChange={(e) => setNote(e.target.value)}/>
      <Refused said={said}/>
      <div><button type="button" style={s.secondary} onClick={go} disabled={!outcome || !trust}>Close the concern</button></div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  A named person: what the DSO shared
// ══════════════════════════════════════════════════════

function SharedWithMe({ id, onBack }) {
  const s = useStyles();
  const [sh, setSh] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let off = false;
    api(`/api/safeguarding/shares/${id}`).then((r) => { if (!off) setSh(r); }).catch((e) => { if (!off) setError(say(e)); });
    return () => { off = true; };
  }, [id]);
  return (
    <div className="os-page" style={s.page} data-testid="sg-share-open">
      <div><button type="button" className="pressBtn" style={s.secondary} onClick={onBack}>Back</button></div>
      <Refused said={error}/>
      {sh && (
        <div style={s.card}>
          <h1 style={s.h2}>Shared with you by {sh.sharedBy}</h1>
          <p style={s.small}>{sh.schoolName} · until {when(sh.openUntil)} · {sh.reason}</p>
          {sh.summary && <p style={s.body}>
            {label(ABOUT, sh.summary.aboutKind)} · {(sh.summary.nature ?? []).map((n) => label(NATURE, n)).join(", ")}
            {" · "}{sh.summary.certainty === "recognised" ? "known to have happened" : "a suspicion"}
            {sh.summary.occurredOn ? ` · ${day(sh.summary.occurredOn)}` : ""}</p>}
          {sh.child && <p style={s.body}>Child: <span style={{ color: T.content.primary }}>{sh.child}</span></p>}
          {sh.account && <p style={s.pre}>{sh.account}</p>}
          {sh.actions && sh.actions.map((a, i) => (
            <p key={i} style={s.small}>{label(NOTE_KIND, a.kind)} · {when(a.at)}{a.body ? `: ${a.body}` : ""}</p>
          ))}
          <p style={s.meta}>This is on the record. Keep it to yourself, and ask the DSO before acting on it.</p>
        </div>
      )}
    </div>
  );
}

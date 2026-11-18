import { Suspense, lazy, useEffect, useState } from "react";
import { T, clr } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { useFollowed } from "../lib/follow.js";
import { FollowedSchools } from "../follow/Followed.jsx";
import { REMOVE_WORDS, keepWords, stateWords } from "../lib/pupilClaim.js";

// The raise form and its receipt are the safeguarding screen's own (views/
// SafeguardingView.jsx), in that screen's chunk: loaded only when he presses
// "Raise a concern".
const RaiseFormView = lazy(() => import("../views/SafeguardingView.jsx").then((m) => ({ default: m.RaiseFormView })));
const Receipt = lazy(() => import("../views/SafeguardingView.jsx").then((m) => ({ default: m.Receipt })));
const ScoringBlock = lazy(() => import("../views/ScoringBlock.jsx").then((m) => ({ default: m.ScoringBlock })));
// His own ways to sign in (Me's list): his own rows only (my_sign_ins).
const WaysToSignIn = lazy(() => import("../views/signins.jsx").then((m) => ({ default: m.WaysToSignIn })));

// ══════════════════════════════════════════════════════
//  THE UNDER-18 BASIC VIEW  (SCRBRD-140, the honesty model §3.3; db/163)
//
//  An account that has said "I am a pupil here, and under 18". It is the
//  front door's view (the schools he follows, their public matches, a
//  Practice Match on his own phone) plus four things: his own account, his
//  state in one true sentence, how long the account is kept (Q9), and, once
//  his school has recognised him, its safeguarding card with "Raise a
//  concern" (Q8). Before that, The Guardian's link only.
//
//  WHAT IT NEVER DRAWS (§3.3's right column, and the walk
//  smoke-browser-under18.mjs holds it to it): his team, his next match as
//  his, a figure, a profile, a cap or an honour, an injury or a load, his
//  availability, team-mates, the side's notices, a request form of any kind
//  (to join a school, to be a parent or staff, to be a spectator, to add a
//  school), a sponsor or a "who read my record". It reads nothing a
//  signed-out visitor could not read, but his own account, his own state
//  and the safeguarding card (db/99 §141).
//
//  The words are lib/pupilClaim.js's.
// ══════════════════════════════════════════════════════

const FONT = { head: "'Syne',sans-serif", body: "'DM Sans',sans-serif" };
const text = (size = 14, color = T.content.secondary) => ({ fontFamily: FONT.body, fontSize: `${size}px`, lineHeight: 1.5, color });
const card = () => ({ borderRadius: "16px", border: `1px solid ${T.line.normal}`, background: T.fill.panel, padding: "20px", marginBottom: "16px" });

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

/** The Guardian's link, when the platform set one. */
function GuardianAnon({ url, testId }) {
  if (url === undefined) return null;
  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer" data-testid={testId}
         style={{ display: "flex", alignItems: "center", minHeight: "44px", color: T.brand.blueText, fontWeight: 600, fontSize: "14px", fontFamily: FONT.body }}>Report anonymously with The Guardian's app</a>
    : <div style={text(14)} data-testid={`${testId}-unset`}>The Guardian's app link has not been set on this platform yet.</div>;
}

/**
 * Q8: his school's safeguarding card, once the school has recognised him:
 * its officers by name, the line to phone in danger, "Raise a concern" and
 * "Report anonymously". Adults' names and a contact line; nothing about a
 * child. Unrecognised, The Guardian's link only (140 §4.2's rule, kept).
 */
function Safeguarding({ claim }) {
  const [c, setC] = useState(/** @type {{ rows: any[], guardianAppUrl?: string | null, loaded: boolean }} */ ({ rows: [], guardianAppUrl: undefined, loaded: false }));
  const [screen, setScreen] = useState(/** @type {{ at: "card" } | { at: "form" } | { at: "sent", r: any }} */ ({ at: "card" }));
  useEffect(() => {
    let off = false;
    api("/api/safeguarding/contacts")
      .then((r) => { if (!off) setC({ rows: r?.rows ?? [], guardianAppUrl: r?.guardianAppUrl ?? null, loaded: true }); })
      .catch(() => { if (!off) setC({ rows: [], guardianAppUrl: undefined, loaded: true }); });
    return () => { off = true; };
  }, []);
  const mine = c.rows.filter((r) => r.schoolId === claim.schoolId);
  const officers = mine.filter((r) => r.personId);

  if (!claim.safeguarding) {
    return (
      <div data-testid="no-school-help" style={{ ...card(), marginBottom: 0 }}>
        <div style={{ fontFamily: FONT.head, fontSize: "14px", fontWeight: 700, color: T.content.primary, marginBottom: "4px" }}>Worried about something?</div>
        <div style={text(14)}>You do not need a school to speak up. If you are in danger now, phone SAPS on 10111 or Childline on 116.</div>
        <GuardianAnon url={c.guardianAppUrl} testId="no-school-guardian"/>
      </div>
    );
  }
  if (screen.at === "form") {
    return (
      <Suspense fallback={<div role="status" style={text(14)}>Loading the form…</div>}>
        <RaiseFormView isDso={false} contacts={{ rows: mine, guardianAppUrl: c.guardianAppUrl ?? null }} players={[]}
          onSent={(r) => setScreen({ at: "sent", r })} onCancel={() => setScreen({ at: "card" })}/>
      </Suspense>
    );
  }
  if (screen.at === "sent") {
    return (
      <Suspense fallback={null}>
        <Receipt r={screen.r} guardianAppUrl={c.guardianAppUrl ?? null} onDone={() => setScreen({ at: "card" })}/>
      </Suspense>
    );
  }
  return (
    <section data-testid="pupil-safeguarding" aria-labelledby="pupil-safeguarding-h" style={{ ...card(), marginBottom: 0 }}>
      <h2 id="pupil-safeguarding-h" style={{ margin: "0 0 6px", fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary }}>Safeguarding at {claim.schoolName}</h2>
      <div style={{ ...text(14), marginBottom: "10px" }}>If something is wrong, at cricket or anywhere, these are the people at your school whose job is to help you.</div>
      {!c.loaded && <div role="status" style={text(14)}>Loading…</div>}
      {c.loaded && officers.length > 0 && (
        <ul aria-label="Safeguarding officers" data-testid="pupil-dso-list" style={{ listStyle: "none", margin: "0 0 10px", padding: 0, display: "grid", gap: "4px" }}>
          {officers.map((o) => <li key={o.personId} data-testid="pupil-dso" style={{ ...text(15, T.content.primary), fontWeight: 600 }}>{o.name}</li>)}
        </ul>
      )}
      {c.loaded && officers.length === 0 && <div data-testid="pupil-dso-none" style={{ ...text(14), marginBottom: "10px" }}>Nobody holds this at your school yet. Use The Guardian's app, or phone Childline on 116.</div>}
      <div data-testid="pupil-dso-line" style={{ ...text(14), marginBottom: "12px" }}>If you are in danger now, phone SAPS on 10111 or Childline on 116.</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <Btn kind="primary" data-testid="pupil-raise" onClick={() => setScreen({ at: "form" })}>Raise a concern</Btn>
        <GuardianAnon url={c.guardianAppUrl} testId="pupil-guardian"/>
      </div>
    </section>
  );
}

/**
 * The screen. `claim` is GET /api/pupil/state's; `onChanged` reads it again;
 * `onSignOut` is the shell's; `onRemoved` is what the shell does once his
 * account is gone (sign out, and say so).
 * @param {{ name?: string, claim: any, onSignOut: () => void, onRemoved: () => void, onOpenPad?: any }} p
 */
export function PupilBasic({ name, claim, onSignOut, onRemoved, onOpenPad = null }) {
  const me = profile()?.user;
  const followed = useFollowed();
  const words = stateWords(claim);
  const keep = keepWords(claim);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState("");
  const [following, setFollowing] = useState(false);
  const followsHisSchool = followed.schools.some((s) => s.id === claim.schoolId);

  const follow = async () => {
    setFollowing(true); setProblem("");
    try { await api("/api/follows", { method: "POST", body: { schoolId: claim.schoolId } }); followed.reload(); }
    catch { setProblem(`Could not follow ${claim.schoolName} just now. Try again.`); }
    setFollowing(false);
  };
  const remove = async () => {
    setRemoving(true); setProblem("");
    try { await api("/api/pupil/remove", { method: "POST" }); onRemoved(); return; }
    catch (e) { setProblem(/** @type {any} */ (e)?.code === "not_a_claim" ? REMOVE_WORDS.not_a_claim : REMOVE_WORDS.fallback); }
    setRemoving(false);
  };

  return (
    <div data-testid="pending-requests" style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "24px 16px", background: T.surface.canvas, boxSizing: "border-box" }}>
      <main data-testid="pupil-basic" data-state={claim.state} style={{ maxWidth: "520px", width: "100%" }}>
        <h1 data-testid="no-school-title" style={{ margin: "0 0 4px", fontFamily: FONT.head, fontSize: "22px", fontWeight: 800, color: T.content.primary, overflowWrap: "anywhere" }}>Hello {name || me?.name || "there"}</h1>
        <div style={{ ...text(14), marginBottom: "20px", overflowWrap: "anywhere" }}>You are signed in{me?.email ? <> as <span data-testid="no-school-email" style={{ color: T.content.primary }}>{me.email}</span></> : ""}.</div>

        {/* His state, first (§3.3): one true sentence, how a yes comes, and Q9's date. */}
        <section data-testid="pupil-state" data-state={claim.state} aria-labelledby="pupil-state-h" role="status"
          style={{ ...card(), border: `1px solid ${T.line.strong}` }}>
          <h2 id="pupil-state-h" style={{ margin: "0 0 6px", fontFamily: FONT.head, fontSize: "18px", fontWeight: 800, color: T.content.primary }}>{words.title}</h2>
          <div data-testid="pupil-state-line" style={text(15, T.content.primary)}>{words.line}</div>
          {words.how && <div data-testid="pupil-state-how" style={{ ...text(14), marginTop: "8px" }}>{words.how}</div>}
          {/* db/164: a boy the office enrolled, whose page a no closed, sent no claim: nothing he typed to repeat. */}
          {claim.name && <div style={{ ...text(13), marginTop: "10px" }}>You said you are at <strong style={{ color: T.content.primary }}>{claim.schoolName}</strong>, as <span data-testid="pupil-typed-name" style={{ color: T.content.primary }}>{claim.name}</span>{claim.year ? <> ({claim.year})</> : null}.</div>}
          {keep && <div data-testid="pupil-keep" style={{ ...text(13), marginTop: "8px" }}>{keep}</div>}
        </section>

        {(followed.live || followed.ask) && <FollowedSchools followed={followed} lead/>}

        {/* A Practice Match, on his own phone (§3.3). Its own chunk. */}
        {onOpenPad && (
          <Suspense fallback={<div role="status" style={{ ...text(14), marginBottom: "16px" }}>Loading scoring…</div>}>
            <ScoringBlock onOpenPad={onOpenPad} onJoin={null}/>
          </Suspense>
        )}

        {!(followed.live || followed.ask) && <FollowedSchools followed={followed}/>}
        {!followed.loading && !followsHisSchool && (
          <div style={{ marginBottom: "16px" }}>
            <Btn data-testid="pupil-follow-school" disabled={following} onClick={follow}>{following ? "Following…" : `Follow ${claim.schoolName}'s public matches`}</Btn>
          </div>
        )}

        <Safeguarding claim={claim}/>

        {/* His own account: sign out, and remove it now. */}
        <section data-testid="pupil-account" aria-labelledby="pupil-account-h" style={{ ...card(), marginTop: "16px" }}>
          <h2 id="pupil-account-h" style={{ margin: "0 0 8px", fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary }}>Your account</h2>
          <div data-testid="pupil-sign-ins" style={{ marginBottom: "12px" }}>
            <Suspense fallback={<div role="status" style={text(14)}>Loading your sign-ins…</div>}><WaysToSignIn/></Suspense>
          </div>
          {!asking && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Btn onClick={onSignOut} data-testid="no-school-sign-out">Sign out</Btn>
              <Btn onClick={() => setAsking(true)} data-testid="pupil-remove">Remove this account</Btn>
            </div>
          )}
          {asking && (
            <div role="group" aria-labelledby="pupil-remove-ask" data-testid="pupil-remove-ask">
              <div id="pupil-remove-ask" style={{ ...text(14, T.content.primary), marginBottom: "10px" }}>{REMOVE_WORDS.ask}</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Btn kind="primary" disabled={removing} onClick={remove} data-testid="pupil-remove-confirm">{removing ? "Removing…" : "Remove it"}</Btn>
                <Btn disabled={removing} onClick={() => setAsking(false)} data-testid="pupil-remove-cancel">Keep it</Btn>
              </div>
            </div>
          )}
          {problem && <div role="alert" data-testid="pupil-problem" style={{ ...text(13, T.semantic.criticalText), marginTop: "10px", padding: "10px 12px", borderRadius: "8px", background: clr(T.semantic.critical, 0.1) }}>{problem}</div>}
        </section>
      </main>
    </div>
  );
}

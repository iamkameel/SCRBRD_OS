import { useState } from "react";
import { T, inkOn } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";

/**
 * Health monitoring's own consent (SCRBRD-110 §7; db/60).
 *
 * Three pieces, one record:
 *
 *   HealthConsentRow      one child's answer: the wording, where it stands,
 *                         and one switch. The row the sign-up screen
 *                         (SCRBRD-092) draws beside the public-name row when
 *                         that screen exists; today Settings draws it.
 *   HealthConsentSection  Settings → Me: a row per child the signed-in person
 *                         answers for, and his own row (read-only until he is
 *                         eighteen). Nothing at all for staff: the read
 *                         returns them no rows.
 *   EighteenCard          Me: "you are 18 — is this still all right?", asked
 *                         once, from his birthday, when a parent had said yes.
 *   HealthConsentPrompt   Me: the one-time ask, once a guardian's link to a
 *                         child is verified and nobody has answered for him
 *                         yet (SCRBRD-110 §9.1, Decided 1). Same wording, same
 *                         endpoint as the switch; "Not now" hides it on this
 *                         device only, never on another.
 *
 * WHAT THIS SCREEN DECIDES: nothing. The switch calls
 * health_monitoring_consent_set(); the database says who may answer for whom
 * (a verified parent while he is a child, he himself from eighteen) and
 * refuses the rest with a word this file puts into a sentence. Turning it off
 * asks once, in plain words, before it withdraws.
 *
 * ALL THREE CARDS HIDE WHEN THE MODULE IS OFF (§9.1, Decided 2): each
 * `consents` row carries `moduleOn`, read server-side from `feature_enabled`
 * for that child's own school, so no family is asked about something the
 * school has not switched on. A record already given is kept and counts
 * again the day the module comes back on; nothing here decides that — the
 * server does, on every write and read that matters.
 *
 * NO DEMONSTRATION FALLBACK: a consent on screen is somebody's real answer.
 *
 * Type is 12px at the smallest, every control is 44px tall, and every colour
 * is read from `T` when the component renders, so both themes are right.
 */

/** The wording agreed to. A new wording is a new version, and a new record. */
export const HEALTH_CONSENT_VERSION = "health-monitoring-2026-09";

/** The words the family agrees to, in the order a parent reads them. */
export const HEALTH_CONSENT_WORDS = [
  "Separate from the terms, and off unless you turn it on.",
  "If you do, the school may collect how your child's body is doing, to help keep him playing: a short daily check-in (sleep, tiredness, soreness), a \"something doesn't feel right\" button, fitness tests, and guidelines set for him by the physio or his coach.",
  "The physio, his coach and the fitness coach read it; the director of sport only when he asks, and every read is on the record. He reads his own. You see it when the physio or his coach chooses to share it with you.",
  "You can turn it off at any time. Collection stops at once and staff stop reading it. What was collected is hidden, then deleted twelve months after it ended or after he leaves the school.",
  "His nets and match bowling are counted either way: that is part of running the sport, like attendance.",
];

const REFUSAL = {
  not_signed_in: "Your session has ended. Sign in again; nothing was changed.",
  not_permitted: "You cannot answer for this person.",
  adult_consents_for_himself: "He is eighteen, so this is his own decision now. He answers on his Me screen.",
  not_yet_eighteen: "Your parent answers this until you turn eighteen.",
  terms_not_agreed: "The school has not recorded your agreement to the terms yet. Ask the school office first.",
  already_given: "That is already on.",
  no_such_player: "That child is not one you can answer for.",
  module_disabled: "Your school has not switched this on.",
};
const say = (e) => REFUSAL[e?.code]
  ?? (e?.status ? `Not changed. The server said ${e.code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was changed.");
const day = (t) => (t ? new Date(`${t}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "");

/** What turning it off does, said before it is done (STEP 4 §4.2). */
const stopping = (self) =>
  "Collection stops at once and staff stop reading what was collected. "
  + (self ? "You can still read your own. " : "He can still read his own. ")
  + "Nothing is deleted today: it is hidden, and deleted twelve months after it ended or after "
  + (self ? "you leave" : "he leaves") + " the school. You can turn it on again.";

/** Where the answer stands, in words, naming nobody. */
function standing(c) {
  const who = c.fromForm ? "the office, from a form"
    : c.byYou ? "you"
    : c.givenBy === "self" ? (c.relation === "self" ? "you" : "him")
    : c.relation === "self" ? "your parent" : "his other parent";
  switch (c.state) {
    case "given":     return `On — agreed by ${who}, ${day(c.givenOn)}.`;
    case "lapsed":    return c.relation === "self"
      ? `Off — your parent's agreement ended on your eighteenth birthday.`
      : `Off — the agreement given ${day(c.givenOn)} no longer counts.`;
    case "withdrawn": return `Off — turned off by ${who}, ${day(c.endedOn)}.`;
    case "refused":   return `Off — ${who} said no, ${day(c.endedOn)}.`;
    case "superseded":return `Off.`;
    default:          return "Off — nobody has answered yet.";
  }
}

function useStyles() {
  return {
    card: { background: T.surface.raised, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg,
            padding: T.space.lg, display: "flex", flexDirection: "column", gap: T.space.md,
            fontFamily: T.type.body, color: T.content.primary },
    h2: { fontFamily: T.type.body, fontSize: "18px", fontWeight: 600, color: T.content.primary, margin: 0 },
    body: { fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.5, color: T.content.secondary, margin: 0 },
    small: { fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.5, color: T.content.secondary, margin: 0 },
    meta: { fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.4, color: T.content.tertiary, margin: 0 },
    row: { display: "flex", gap: T.space.md, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between",
           borderTop: `1px solid ${T.line.normal}`, paddingTop: T.space.md },
    name: { fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, color: T.content.primary },
    switch: (on) => ({ minHeight: "44px", minWidth: "88px", padding: "8px 14px", borderRadius: T.radius.pill,
                       cursor: "pointer", boxSizing: "border-box", fontFamily: T.type.body, fontSize: "15px", fontWeight: 600,
                       border: `1px solid ${on ? T.content.primary : T.line.strong}`,
                       background: on ? T.content.primary : "transparent",
                       color: on ? inkOn(T.content.primary) : T.content.primary }),
    primary: { minHeight: "44px", padding: "10px 18px", borderRadius: T.radius.pill, border: "none", cursor: "pointer",
               background: T.content.primary, color: inkOn(T.content.primary), fontFamily: T.type.body,
               fontSize: "15px", fontWeight: 600 },
    secondary: { minHeight: "44px", padding: "10px 18px", borderRadius: T.radius.pill, cursor: "pointer",
                 background: "transparent", color: T.content.primary, border: `1px solid ${T.line.strong}`,
                 fontFamily: T.type.body, fontSize: "15px", fontWeight: 600 },
    confirm: { display: "flex", flexDirection: "column", gap: T.space.sm, padding: T.space.md, borderRadius: T.radius.md,
               background: T.surface.base, border: `1px solid ${T.line.strong}` },
    alert: { fontFamily: T.type.body, fontSize: "14px", color: T.semantic.criticalText, margin: 0 },
    list: { margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: T.space.xs },
  };
}

/**
 * The wording, as a list a parent can read before she decides. `testid`
 * disambiguates when more than one card draws it on the same screen at once
 * (the one-time prompt sits beside the Settings section and the eighteen
 * card); the default keeps the Settings section's own id unchanged.
 */
export function HealthConsentWords({ open = false, testid = "health-consent-words" }) {
  const s = useStyles();
  return (
    <details open={open} data-testid={testid}>
      <summary style={{ ...s.small, cursor: "pointer", minHeight: "44px", display: "flex", alignItems: "center" }}>
        What this covers
      </summary>
      <ul style={s.list}>
        {HEALTH_CONSENT_WORDS.map((w) => <li key={w} style={s.small}>{w}</li>)}
      </ul>
    </details>
  );
}

/**
 * One child's answer. `c` is a `consents` row (lib/live.js asConsent);
 * `onChanged` is called after the server has recorded the change.
 */
export function HealthConsentRow({ c, onChanged }) {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState("");
  const on = c.state === "given";
  const canAnswer = on ? c.canSayNo : c.canSayYes;
  const answer = async (yes) => {
    // A row the pitch deck draws (`demo`, views/pitchdeck/demo.js) is nobody's
    // answer and has no child behind it: it never reaches the server, whoever
    // or whatever presses it. The deck's frames are inert as well; this is the
    // second lock on the one write in this file that a drawn row could reach.
    if (c.demo) return;
    setBusy(true); setSaid("");
    try {
      await api(`/api/players/${c.playerId}/consents/health`, { method: "POST", body: { yes, version: HEALTH_CONSENT_VERSION } });
      setAsking(false);
      onChanged?.();
    } catch (e) { setSaid(say(e)); }
    finally { setBusy(false); }
  };
  const who = c.relation === "self" ? "You" : c.name;
  return (
    <div data-testid={`health-consent-${c.playerId}`} style={{ ...s.row, flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", gap: T.space.md, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <div style={s.name}>{who}</div>
          <p style={s.meta} data-testid={`health-consent-state-${c.playerId}`}>{standing(c)}</p>
        </div>
        {canAnswer ? (
          <button type="button" role="switch" aria-checked={on} disabled={busy}
                  aria-label={`Health monitoring for ${c.relation === "self" ? "you" : c.name}`}
                  data-testid={`health-consent-switch-${c.playerId}`}
                  onClick={() => (on ? setAsking(true) : answer(true))} style={s.switch(on)}>
            {on ? "On" : "Off"}
          </button>
        ) : (
          <span style={s.meta} data-testid={`health-consent-readonly-${c.playerId}`}>
            {c.relation === "self" ? "Your parent answers until you are 18" : "Only he can answer now"}
          </span>
        )}
      </div>
      {asking && (
        <div style={s.confirm} role="group" aria-label="Turn off health monitoring" data-testid="health-consent-confirm">
          <p style={s.small}>{stopping(c.relation === "self")}</p>
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
            <button type="button" style={s.primary} disabled={busy} onClick={() => answer(false)}
                    data-testid="health-consent-stop">Turn it off</button>
            <button type="button" style={s.secondary} disabled={busy} onClick={() => setAsking(false)}>Keep it on</button>
          </div>
        </div>
      )}
      {said && <p role="alert" style={s.alert} data-testid="health-consent-refused">{said}</p>}
    </div>
  );
}

/**
 * Settings → Me: every child this person answers for, and himself. `nonce`
 * and `onChanged` are the Me screen's, shared with the eighteen card, so an
 * answer given in either redraws both.
 */
export function HealthConsentSection({ role, nonce = 0, onChanged }) {
  const [nudge, setNudge] = useState(0);
  const { rows } = useLive("consents", role, nonce + nudge);
  // §9.1, Decided 2: hidden per child where that child's school has not
  // switched the module on — `moduleOn !== false` so an older/missing value
  // reads as on, never off.
  const health = rows.filter((c) => c.kind === "health" && c.moduleOn !== false);
  if (!signedIn() || health.length === 0) return null;
  return <HealthConsentCard rows={health} onChanged={() => { setNudge((n) => n + 1); onChanged?.(); }}/>;
}

/**
 * The Settings section as drawn, from the rows it is given: no read, no
 * session. The section above hands it the server's rows; the pitch deck
 * (views/pitchdeck/) hands it a built-in demonstration, so the deck shows this
 * card itself and not a picture of it. `idSuffix` keeps the heading's id unique
 * when the deck draws two of these on one slide.
 */
export function HealthConsentCard({ rows, onChanged, idSuffix = "" }) {
  const s = useStyles();
  return (
    <section style={s.card} data-testid="health-consent-section" aria-labelledby={`health-consent-title${idSuffix}`}>
      <h2 id={`health-consent-title${idSuffix}`} style={s.h2}>Health monitoring</h2>
      <p style={s.body}>
        A separate choice for each child, off unless you turn it on, and yours to change at any time.
      </p>
      <HealthConsentWords/>
      {rows.map((c) => <HealthConsentRow key={c.playerId} c={c} onChanged={onChanged}/>)}
    </section>
  );
}

/**
 * The Me card at eighteen: asked once, from his birthday, when a parent had
 * said yes and he has not answered for himself. Gone once he answers.
 */
export function EighteenCard({ role, nonce = 0, onChanged }) {
  const [nudge, setNudge] = useState(0);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const { rows } = useLive("consents", role, nonce + nudge);
  // §9.1, Decided 2: hidden where his own school has switched the module off.
  const mine = rows.find((c) => c.kind === "health" && c.relation === "self" && c.askAt18 && c.moduleOn !== false);
  if (!signedIn() || !mine) return null;
  const answer = async (yes) => {
    setBusy(true); setSaid("");
    try {
      await api(`/api/players/${mine.playerId}/consents/health`, { method: "POST", body: { yes, version: HEALTH_CONSENT_VERSION } });
      setNudge((n) => n + 1);
      onChanged?.();
    } catch (e) { setSaid(say(e)); }
    finally { setBusy(false); }
  };
  return <EighteenCardView mine={mine} busy={busy} said={said} onAnswer={answer}/>;
}

/** The eighteen card as drawn, for a row and its handlers: no read, no session (see HealthConsentCard). */
export function EighteenCardView({ mine, busy = false, said = "", onAnswer }) {
  const s = useStyles();
  return (
    <section style={{ ...s.card, borderColor: T.content.primary }} data-testid="eighteen-card" aria-labelledby="eighteen-title">
      <h2 id="eighteen-title" style={s.h2}>You are 18 — is this still all right?</h2>
      <p style={s.body}>
        Your parent agreed to health monitoring for you while you were under 18: check-ins, the "something doesn't feel
        right" button, fitness tests and guidelines set for you.
        {mine.live
          ? " It carries on until you answer. From now on it is your decision."
          : " That agreement ended on your eighteenth birthday, so nothing about your body is being collected. It is your decision now."}
      </p>
      <HealthConsentWords/>
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <button type="button" style={s.primary} disabled={busy} onClick={() => onAnswer(true)} data-testid="eighteen-yes">
          {mine.live ? "Yes, carry on" : "Yes, turn it on"}
        </button>
        <button type="button" style={s.secondary} disabled={busy} onClick={() => onAnswer(false)} data-testid="eighteen-no">
          {mine.live ? "No, stop it" : "No, leave it off"}
        </button>
      </div>
      <p style={s.meta}>Either way you can change your mind in the section below.</p>
      {said && <p role="alert" style={s.alert}>{said}</p>}
    </section>
  );
}

/**
 * "Not now" — this device only (SCRBRD-110 §9.1, Decided 1: "answering or
 * dismissing it stores nothing but the answer"). Never the server: a school
 * switch or a guardian's own account carries no half-given state, and the
 * card simply asks again on another device, or if storage here is blocked.
 */
const promptDismissKey = (playerId) => `scrbrd:health-consent-prompt:${playerId}`;
const isPromptDismissed = (playerId) => {
  try { return localStorage.getItem(promptDismissKey(playerId)) === "1"; } catch { return false; }
};
const dismissPrompt = (playerId) => {
  try { localStorage.setItem(promptDismissKey(playerId), "1"); }
  catch { /* private window or storage blocked: the card simply shows again next time,
             which is the safe side to fail on — never worse than asking twice. */ }
};

/**
 * The one-time ask (SCRBRD-110 §9.1, Decided 1): once a guardian's link to a
 * child is verified and nobody — neither her nor him — has made a
 * health-monitoring record for him yet, Me asks once: "Health monitoring for
 * <him>: yes or no?" Yes and No are the same switch, the same endpoint, the
 * same wording as Settings; this card stores no state of its own, so there is
 * no pending or half-given answer anywhere. It never asks at sign-up (that
 * row stays informational) and never for the boy's own account — his own
 * "yes or no" is the eighteen card's, asked at eighteen, not before.
 *
 * A CHILD LEAVES THIS LIST THE MOMENT ANYBODY ANSWERS: a real "yes"/"no" sets
 * `state` away from `not_answered`, so the card is gone everywhere, not just
 * on this device. "Not now" only ever removes it from this one screen.
 */
export function HealthConsentPrompt({ role, nonce = 0, onChanged }) {
  const [nudge, setNudge] = useState(0);
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState({});
  const { rows } = useLive("consents", role, nonce + nudge);
  const due = rows.filter((c) => c.kind === "health" && c.relation !== "self" && c.state === "not_answered"
    && c.canSayYes && c.moduleOn !== false && !isPromptDismissed(c.playerId));
  if (!signedIn() || due.length === 0) return null;
  const answer = async (c, yes) => {
    setBusy(c.playerId); setSaid((m) => ({ ...m, [c.playerId]: "" }));
    try {
      await api(`/api/players/${c.playerId}/consents/health`, { method: "POST", body: { yes, version: HEALTH_CONSENT_VERSION } });
      setNudge((n) => n + 1);
      onChanged?.();
    } catch (e) { setSaid((m) => ({ ...m, [c.playerId]: say(e) })); }
    finally { setBusy(null); }
  };
  const notNow = (c) => { dismissPrompt(c.playerId); setNudge((n) => n + 1); };
  return (
    <>
      {due.map((c) => (
        <HealthConsentAsk key={c.playerId} c={c} busy={busy === c.playerId} said={said[c.playerId]}
                          onYes={() => answer(c, true)} onNo={() => answer(c, false)} onLater={() => notNow(c)}/>
      ))}
    </>
  );
}

/** One child's one-time ask as drawn: no read, no session (see HealthConsentCard). */
export function HealthConsentAsk({ c, busy = false, said = "", onYes, onNo, onLater }) {
  const s = useStyles();
  return (
    <section style={{ ...s.card, borderColor: T.content.primary }}
             data-testid={`health-consent-prompt-${c.playerId}`} aria-labelledby={`health-consent-prompt-title-${c.playerId}`}>
      <h2 id={`health-consent-prompt-title-${c.playerId}`} style={s.h2}>Health monitoring for {c.name}: yes or no?</h2>
      <HealthConsentWords testid={`health-consent-words-prompt-${c.playerId}`}/>
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <button type="button" style={s.primary} disabled={busy}
                onClick={onYes} data-testid={`health-consent-prompt-yes-${c.playerId}`}>Yes</button>
        <button type="button" style={s.secondary} disabled={busy}
                onClick={onNo} data-testid={`health-consent-prompt-no-${c.playerId}`}>No</button>
        <button type="button" style={s.secondary} disabled={busy}
                onClick={onLater} data-testid={`health-consent-prompt-later-${c.playerId}`}>Not now</button>
      </div>
      {said && <p role="alert" style={s.alert}>{said}</p>}
    </section>
  );
}

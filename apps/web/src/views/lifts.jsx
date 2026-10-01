/**
 * Parent lift clubs, phase 1: the arrangement (SCRBRD-124; db/70).
 *
 * Three pieces, over services/api/write/lift-api.mjs:
 *
 *   LiftsPanel             the fixture card (the Squad screen, beside
 *                          Availability, until STEP 4's P3 exists): the offers
 *                          on the side's fixture, a seat asked for, withdrawn
 *                          or confirmed again, in words; the driver's own card
 *                          with her requests to accept or decline; the offer
 *                          form (a round trip is two offers made by one form);
 *                          and, for the office, the counts. For a pupil of
 *                          eighteen still at school (Kameel's follow-up,
 *                          2026-10-01), a simple "Ask for a seat" for himself
 *                          on his own fixtures; the server decides who that
 *                          is, and for anybody else the list is empty.
 *   LiftPolicyPanel        Settings → School: the principal signs the
 *                          school's lift policy, or withdraws it.
 *   LiftDeclarationPanel   Settings → Me (the family's own page until STEP 4's
 *                          Family exists): where she stands — may she drive,
 *                          and if not why, in the school's words — and her
 *                          yearly declaration.
 *
 * WHAT THESE SCREENS DECIDE: nothing. Every act is one route, every route one
 * database function, and a refusal comes back as a word this file puts into a
 * sentence. Who a parent sees is the database's: the offers on her son's side,
 * the other passengers only once her own seat is confirmed (D6), numbers only
 * on the day (phase 2's card). Nothing is shown when the module is not live at
 * the school: a switch that is off is not on the screen.
 *
 * NO ADDRESS ANYWHERE. The meeting point is the school's named spot or the
 * ground (D3); the only free text is the driver's 120-character note, and its
 * field says "a public place, never a home".
 */
import { useEffect, useId, useMemo, useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { Badge, Card } from "../ui/primitives.jsx";
import { useLive } from "../lib/live.js";
import { api } from "../lib/api.js";
import { profile, schoolsWhere } from "../lib/session.js";
import { humanDateTime } from "../lib/format.js";
import { roleGrants } from "@scrbrd/policy/roles";

const TZ = "Africa/Johannesburg";

/**
 * The school's starting point for its own policy (§3.2): every point the
 * design lists, in plain words, for the principal to make the school's own.
 * A DRAFT for Kameel's words; nothing here is enforced but the two switches.
 */
export const LIFT_POLICY_TEMPLATE = [
  "Lifts to fixtures are arranged between families. The school makes a place for families to arrange them; it does not operate lifts, inspect or insure any car, or assign any child to any car.",
  "A parent who offers lifts declares once a year that she holds a valid driving licence, that the car is insured and roadworthy, and that every passenger will wear a seat belt. These are the parent's own statements; the school does not verify them.",
  "Every lift is agreed by the boy's own parent or guardian for that lift, with that driver. A boy under eighteen does not arrange a lift himself.",
  "Lifts meet at the school's named meeting point or at the ground, never at a home. No address is ever asked for.",
  "If a boy is not collected, the driver stays with him and rings the school office.",
  "Any concern about a lift, or about anybody's conduct, goes to the school's Designated Safeguarding Officer. The DSO card is on every screen.",
].join("\n\n");

/** A seat's status, in the family's words. */
const SEAT_WORDS = {
  confirmed: "Confirmed",
  requested: "Asked for — waiting for the driver",
  invited: "Invited — waiting for you",
  awaiting_driver: "The fixture moved — waiting for the driver",
  awaiting_guardian: "Changed — please confirm again",
  declined: "Not accepted",
  withdrawn: "Withdrawn",
  cancelled: "No longer available",
  void: "No longer available",
};
const seatColor = (s) => (s === "confirmed" ? D.emerald
  : s === "awaiting_guardian" || s === "awaiting_driver" || s === "requested" ? D.amber
  : D.textMuted);

/** A refusal's word, as a sentence. */
const REFUSAL = {
  not_signed_in: "Your session has ended. Sign in again; nothing was changed.",
  not_permitted: "You cannot do that for this lift.",
  module_disabled: "Lift clubs are not switched on at this school.",
  version_conflict: "The lift changed while you were looking at it. It has been reloaded; look again.",
  already_on_a_lift: "He already has a seat on another lift for this leg.",
  already_offered: "You already offer this leg of this fixture.",
  seats_full: "That is more boys than the seats offered.",
  one_to_one_not_allowed: "The school's policy does not allow one boy alone with a driver who is not his parent. Accept two together, or none.",
  awaiting_driver: "The fixture has moved. The driver must confirm she still offers the lift first.",
  awaiting_guardian: "The family has not yet said yes to the lift as it now stands.",
  consent_not_granted: "The school has not recorded your consent to the processing of your child's information, which lift clubs need. Ask the school office.",
  pupil_excluded: "Lift clubs are arranged between parents. A pupil does not drive or offer lifts, or ask for anybody but himself.",
  not_yet_eighteen: "A pupil under eighteen does not ask for a seat himself: his parent asks for him.",
  not_at_school: "Only a pupil still at the school may ask for a seat himself.",
  driver_own_child: "Your own son rides with you; he needs no seat.",
  not_on_side: "He is not in this side.",
  offer_not_open: "This lift is not taking requests.",
  offer_ended: "This lift is no longer available.",
  fixture_not_ahead: "This fixture is not ahead any more.",
  meet_after_start: "The way there must meet before the fixture starts.",
  meet_before_start: "The way home must meet after the fixture starts.",
  meet_at_past: "That meeting time has passed.",
  more_seats_than_declared: "That is more seats than your declaration names.",
  seats_below_confirmed: "That is fewer seats than boys already confirmed.",
  no_child_on_side: "You may offer lifts only to your own son's fixtures.",
  no_declaration: "Make your yearly driver's declaration first (Settings → Me).",
  declaration_expired: "Your driver's declaration has expired. Make a new one in Settings → Me.",
  clearance_required: "The school's policy asks drivers for the three CSA clearances, and the office has not recorded all three.",
  declaration_incomplete: "Every statement must be ticked.",
  contact_required: "Choose the number the families should ring you on.",
  registration: "That registration is not one we can read: letters, numbers and spaces.",
  vehicle_description: "Describe the car in 3 to 60 characters.",
  policy_too_short: "The policy must be at least 200 characters.",
  policy_too_long: "The policy must be at most 6000 characters.",
  no_live_policy: "There is no policy to withdraw.",
  nothing_to_reaffirm: "Nothing has changed under this lift.",
  legs: "Choose the way there, the way home, or both.",
  note_too_long: "The note is at most 120 characters.",
};
const say = (e) => REFUSAL[e?.code] ?? (e?.status ? `Not done. The server said ${e.code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was changed.");

/** "Sat 3 Oct", "07:15", on the Johannesburg clock. */
const saDay = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
const saClock = (t) => new Date(t).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
/** A day (YYYY-MM-DD) and a clock (HH:MM) in Johannesburg, as an instant. South Africa keeps no summer time. */
const saInstant = (day, clock) => `${day}T${clock}:00+02:00`;

const label = () => ({ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase" });
const body = () => ({ fontFamily: D.body, fontSize: "13px", color: D.textPrimary, lineHeight: 1.5 });
const muted = () => ({ fontFamily: D.body, fontSize: "12px", color: D.textMuted, lineHeight: 1.5 });
const alert = () => ({ fontFamily: D.body, fontSize: "12px", color: textOn(D.rose), marginTop: "6px" });

/**
 * The controls, at the floors the redesign holds every new screen to (§3.2,
 * §3.5): nothing read under 12px, nothing pressed under 44px.
 */
function Btn({ children, onClick, variant = "primary", disabled, ...rest }) {
  const bg = variant === "primary" ? D.sky : variant === "danger" ? D.rose : "transparent";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="pressBtn" {...rest} style={{
      minHeight: "44px", padding: "8px 16px", borderRadius: D.pill, cursor: disabled ? "not-allowed" : "pointer",
      border: `1px solid ${variant === "ghost" ? D.border : "transparent"}`, background: bg,
      color: variant === "ghost" ? D.textPrimary : inkOn(bg), fontFamily: D.head, fontSize: "13px", fontWeight: 700,
      opacity: disabled ? 0.45 : 1 }}>{children}</button>
  );
}
const fieldStyle = () => ({ width: "100%", minHeight: "44px", padding: "9px 12px", background: D.surf2, boxSizing: "border-box",
  border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "14px" });
const fieldLabel = () => ({ display: "block", fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted,
  letterSpacing: "0.04em", marginBottom: "5px" });
function Input({ label: words, value, onChange, type = "text", ...rest }) {
  const id = useId();
  return (
    <div style={{ marginBottom: "12px" }}>
      <label htmlFor={id} style={fieldLabel()}>{words}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} {...rest} style={fieldStyle()}/>
    </div>
  );
}
function Select({ label: words, value, onChange, options, ...rest }) {
  const id = useId();
  return (
    <div style={{ marginBottom: "12px" }}>
      <label htmlFor={id} style={fieldLabel()}>{words}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} style={fieldStyle()}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** A checkbox with its words, 44px to tap. */
function Tick({ checked, onChange, children, testid }) {
  return (
    <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", minHeight: "44px", cursor: "pointer", ...body() }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid}
        style={{ width: "20px", height: "20px", marginTop: "2px", flexShrink: 0 }}/>
      <span>{children}</span>
    </label>
  );
}

/** Where the caller stands at a school; refetched when `nonce` moves. */
function useStanding(schoolId, nonce = 0) {
  const [s, setS] = useState(null);
  useEffect(() => {
    if (!schoolId) return undefined;
    let gone = false;
    api(`/api/lifts/standing?schoolId=${schoolId}`).then((r) => { if (!gone) setS(r); }).catch(() => { if (!gone) setS(null); });
    return () => { gone = true; };
  }, [schoolId, nonce]);
  return s;
}

// ══════════════════════════════════════════════════════════════════
//  The fixture card: Lifts
// ══════════════════════════════════════════════════════════════════

/**
 * @param {{ role: string, team: string }} props
 */
export function LiftsPanel({ role, team }) {
  const family = schoolsWhere("transport.lift.arrange");
  const office = schoolsWhere("transport.lift.oversee");
  // A pupil — he arranges, receives and oversees no lift, and reads his own
  // file (selfaccess's medical.details.read, which no coach holds): his own
  // seat only, if the server lists him on any lift — at eighteen and still at
  // school. Presentation, not an authorization answer: the list is the
  // server's, and it is empty for anybody else.
  const pupil = !family.length && !office.length && !schoolsWhere("transport.lift.receive").length
    && (profile()?.assignments ?? []).some((a) => roleGrants(a.role, "medical.details.read"));
  const [picked, setPicked] = useState("");
  const { rows: matches } = useLive("matches", role);
  const upcoming = useMemo(() => (matches ?? [])
    .filter((m) => m.homeTeam === team && m.status === "upcoming" && m.startsAt && new Date(m.startsAt) > new Date())
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))), [matches, team]);
  const match = upcoming.find((m) => m.id === picked) ?? upcoming[0] ?? null;
  if (pupil && upcoming.length) return <SelfLifts upcoming={upcoming.slice(0, 5)}/>;
  if (!match || (!family.length && !office.length)) return null;
  return <LiftsForFixture key={match.id} match={match} upcoming={upcoming} onPick={setPicked}
    familySchool={family[0]?.id ?? null} office={office.length > 0}/>;
}

/** One act, then reload; a refusal said beside the thing it refused. */
function useAct(reload) {
  const [said, setSaid] = useState({ at: null, text: "" });
  const act = async (at, path, payload) => {
    setSaid({ at, text: "" });
    try {
      await api(path, { method: "POST", body: payload ?? {} });
      reload();
      return true;
    } catch (e) {
      if (e?.code === "version_conflict") reload();
      setSaid({ at, text: say(e) });
      return false;
    }
  };
  return { act, said };
}

/**
 * A pupil's own lifts (Kameel's follow-up, 2026-10-01): a boy of eighteen
 * still at school asks a seat for himself on his own fixtures, withdraws it,
 * and once it is confirmed reads who drives. Under eighteen, gone from
 * school, or the module off, the server lists nothing and nothing is shown.
 */
function SelfLifts({ upcoming }) {
  const [nonce, setNonce] = useState(0);
  const [byMatch, setByMatch] = useState({});
  const { act, said } = useAct(() => setNonce((n) => n + 1));
  const ids = upcoming.map((m) => m.id).join(",");
  useEffect(() => {
    let gone = false;
    Promise.all(upcoming.map((m) => api(`/api/matches/${m.id}/lifts`)
      .then((r) => [m.id, (r.rows ?? []).filter((o) => (o.myChildren ?? []).some((c) => c.how === "self"))])
      .catch(() => [m.id, []])))
      .then((pairs) => { if (!gone) setByMatch(Object.fromEntries(pairs)); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` is the list's identity
  }, [ids, nonce]);
  const shown = upcoming.filter((m) => (byMatch[m.id] ?? []).length > 0);
  if (!shown.length) return null;
  return (
    <Card sx={{ padding: "14px 16px", marginBottom: "16px" }} data-testid="lifts-self">
      <div style={label()}>Lifts</div>
      <p style={{ ...muted(), margin: "4px 0 0" }}>
        Arranged between families; the school facilitates and does not operate lifts. At eighteen you may ask for a seat for yourself.
      </p>
      {shown.map((m) => (
        <div key={m.id} style={{ marginTop: "12px" }}>
          <div style={{ ...body(), fontWeight: 600 }}>v {m.awayTeam} · {humanDateTime(m.date, m.time)}</div>
          <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
            {byMatch[m.id].map((o) => <OfferRow key={o.id} o={o} act={act} said={said}/>)}
          </div>
        </div>
      ))}
    </Card>
  );
}

function LiftsForFixture({ match, upcoming, onPick, familySchool, office }) {
  const [nonce, setNonce] = useState(0);
  const [offers, setOffers] = useState([]);
  const [summary, setSummary] = useState([]);
  const standing = useStanding(familySchool, nonce);
  const reload = () => setNonce((n) => n + 1);
  const { act, said } = useAct(reload);

  useEffect(() => {
    let gone = false;
    if (familySchool) {
      api(`/api/matches/${match.id}/lifts`).then((r) => { if (!gone) setOffers(r.rows ?? []); }).catch(() => { if (!gone) setOffers([]); });
    }
    if (office) {
      api(`/api/matches/${match.id}/lifts/summary`).then((r) => { if (!gone) setSummary(r.rows ?? []); }).catch(() => { if (!gone) setSummary([]); });
    }
    return () => { gone = true; };
  }, [match.id, familySchool, office, nonce]);

  const familyLive = Boolean(standing?.moduleLive);
  if (!familyLive && !(office && summary.length)) return null;
  const mine = offers.filter((o) => o.mine);
  const others = offers.filter((o) => !o.mine);

  return (
    <Card sx={{ padding: "14px 16px", marginBottom: "16px" }} data-testid="lifts-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={label()}>Lifts</div>
          <div data-testid="lifts-fixture" style={{ ...body(), marginTop: "4px" }}>
            v {match.awayTeam} · {humanDateTime(match.date, match.time)}
          </div>
        </div>
      </div>
      {upcoming.length > 1 && (
        <div style={{ marginTop: "10px", maxWidth: "360px" }}>
          <Select label="Fixture" value={match.id} onChange={onPick}
            options={upcoming.map((m) => ({ value: m.id, label: `v ${m.awayTeam} · ${humanDateTime(m.date, m.time)}` }))}/>
        </div>
      )}
      <p style={{ ...muted(), margin: "8px 0 0" }} data-testid="lifts-facilitates">
        Arranged between families; the school facilitates and does not operate lifts.
      </p>

      {familyLive && (
        <>
          {others.length === 0 && mine.length === 0 && (
            <div style={{ ...muted(), marginTop: "12px" }} data-testid="lifts-none">No lifts are offered for this fixture yet.</div>
          )}
          <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
            {others.map((o) => <OfferRow key={o.id} o={o} act={act} said={said}/>)}
          </div>
          {mine.map((o) => <DriverCard key={o.id} o={o} act={act} said={said} nonce={nonce}/>)}
          <OfferForm match={match} standing={standing} mineLegs={mine.map((o) => o.leg)} act={act} said={said}/>
        </>
      )}
      {office && summary.length > 0 && <OfficeCounts rows={summary}/>}
    </Card>
  );
}

/** One offer, as a family reads it: the driver, the place, the time, the seats, and her own boys' seats. */
function OfferRow({ o, act, said }) {
  const legWord = o.leg === "out" ? "There" : "Back";
  const children = o.myChildren ?? [];
  const seatOf = (pid) => (o.mySeats ?? []).find((s) => s.playerId === pid);
  return (
    <div data-testid={`lift-offer-${o.id}`} style={{ padding: "10px 12px", borderRadius: D.sm, background: D.surf2,
      border: `1px solid ${o.awaitingDriver ? D.amber + "55" : D.border}` }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <Badge color={D.sky}>{legWord}</Badge>
        {o.driverName
          ? <span style={{ ...body(), fontWeight: 600 }} data-testid={`lift-driver-${o.id}`}>{o.driverName}</span>
          : <span style={muted()} data-testid={`lift-driver-${o.id}`}>The driver is named once your seat is confirmed</span>}
        <span style={muted()}>{o.meetPlace} · {saClock(o.meetAt)}</span>
        <span style={muted()} data-testid={`lift-seats-${o.id}`}>{o.seatsLeft} of {o.seats} seats left</span>
        {o.state === "closed" && <Badge color={D.textMuted}>Full list</Badge>}
      </div>
      {o.note && <div style={{ ...muted(), marginTop: "4px" }}>“{o.note}”</div>}
      {o.awaitingDriver && <div style={{ ...muted(), marginTop: "4px", color: textOn(D.amber) }}>The fixture has moved; the driver has not yet confirmed this lift.</div>}
      {children.map((c) => {
        const seat = seatOf(c.playerId);
        const live = seat && ["confirmed", "requested", "invited", "awaiting_driver", "awaiting_guardian"].includes(seat.status);
        const lone = !seat && o.confirmed === 0;
        return (
          <div key={c.playerId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
            flexWrap: "wrap", marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${D.border}` }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ ...body(), fontWeight: 600 }}>{c.how === "self" ? "Your seat" : c.name}</span>
              {seat && <span style={{ marginLeft: "8px" }}><Badge color={seatColor(seat.status)} data-testid={`lift-status-${o.id}-${c.playerId}`}>{SEAT_WORDS[seat.status] ?? seat.status}</Badge></span>}
              {lone && c.how === "guardian" && (
                <div style={muted()}>{c.name} would be the only other boy in the car.</div>
              )}
              {said.at === `${o.id}:${c.playerId}` && said.text && <div role="alert" style={alert()}>{said.text}</div>}
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {!live && o.state === "open" && !o.awaitingDriver && (
                <Btn data-testid={`lift-ask-${o.id}-${c.playerId}`}
                  onClick={() => act(`${o.id}:${c.playerId}`, `/api/lifts/${o.id}/seats`, { playerId: c.playerId })}>
                  Ask for a seat
                </Btn>
              )}
              {live && seat.status === "awaiting_guardian" && (
                <Btn data-testid={`lift-reconfirm-${o.id}-${c.playerId}`}
                  onClick={() => act(`${o.id}:${c.playerId}`, `/api/lift-seats/${seat.seatId}/reconfirm`)}>
                  Confirm again
                </Btn>
              )}
              {live && (
                <Btn variant="ghost" data-testid={`lift-withdraw-${o.id}-${c.playerId}`}
                  onClick={() => act(`${o.id}:${c.playerId}`, `/api/lift-seats/${seat.seatId}/withdraw`)}>
                  Withdraw
                </Btn>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The driver's own offer: her requests, to accept (several together) or decline; reaffirm; close; cancel. */
function DriverCard({ o, act, said, nonce }) {
  const [seats, setSeats] = useState([]);
  const [chosen, setChosen] = useState({});
  useEffect(() => {
    let gone = false;
    api(`/api/lifts/${o.id}/passengers`).then((r) => { if (!gone) setSeats(r.rows ?? []); }).catch(() => { if (!gone) setSeats([]); });
    return () => { gone = true; };
  }, [o.id, nonce]);
  const asked = seats.filter((s) => s.status === "requested");
  const picked = asked.filter((s) => chosen[s.seatId]).map((s) => s.seatId);
  const at = `driver:${o.id}`;
  return (
    <div data-testid={`lift-driver-card-${o.id}`} style={{ marginTop: "12px", padding: "12px", borderRadius: D.sm,
      border: `1px solid ${D.sky}55`, background: D.surf2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={body()}>
          <strong>Your lift {o.leg === "out" ? "there" : "back"}</strong> · {o.meetPlace} · {saClock(o.meetAt)} · {o.confirmed} of {o.seats} seats taken
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {o.state === "open" && <Btn variant="ghost" data-testid={`lift-close-${o.id}`} onClick={() => act(at, `/api/lifts/${o.id}/close`)}>Take no more requests</Btn>}
          <Btn variant="danger" data-testid={`lift-cancel-${o.id}`} onClick={() => act(at, `/api/lifts/${o.id}/cancel`)}>Cancel this lift</Btn>
        </div>
      </div>
      {o.awaitingDriver && (
        <div style={{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...muted(), color: textOn(D.amber) }}>The fixture has moved. Do you still offer this lift? If the meeting time is now wrong, cancel and offer again.</span>
          <Btn data-testid={`lift-reaffirm-${o.id}`} onClick={() => act(at, `/api/lifts/${o.id}/reaffirm`, { version: o.version })}>Yes, I still offer it</Btn>
        </div>
      )}
      <div style={{ display: "grid", gap: "6px", marginTop: "10px" }}>
        {seats.length === 0 && <div style={muted()}>Nobody has asked for a seat yet.</div>}
        {seats.map((s) => (
          <div key={s.seatId} data-testid={`lift-passenger-${s.seatId}`} style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            {s.status === "requested" ? (
              <Tick checked={Boolean(chosen[s.seatId])} onChange={(v) => setChosen((c) => ({ ...c, [s.seatId]: v }))} testid={`lift-pick-${s.seatId}`}>
                {s.name}
              </Tick>
            ) : <span style={{ ...body(), minHeight: "44px", display: "flex", alignItems: "center" }}>{s.name}</span>}
            <Badge color={seatColor(s.status)}>{SEAT_WORDS[s.status] ?? s.status}</Badge>
            {s.status === "requested" && (
              <Btn variant="ghost" data-testid={`lift-decline-${s.seatId}`} onClick={() => act(at, `/api/lift-seats/${s.seatId}/decline`)}>Decline</Btn>
            )}
          </div>
        ))}
      </div>
      {asked.length > 0 && (
        <div style={{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <Btn disabled={!picked.length} data-testid={`lift-accept-${o.id}`}
            onClick={async () => { if (await act(at, `/api/lifts/${o.id}/accept`, { seatIds: picked })) setChosen({}); }}>
            Accept {picked.length > 1 ? `these ${picked.length}` : "this one"}
          </Btn>
          {picked.length === 1 && o.confirmed === 0 && <span style={muted()}>He would be the only other boy in the car.</span>}
        </div>
      )}
      {said.at === at && said.text && <div role="alert" style={alert()} data-testid={`lift-driver-said-${o.id}`}>{said.text}</div>}
    </div>
  );
}

/** The offer form: the way there, the way home, or both (D1), at the school's point or the ground. */
function OfferForm({ match, standing, mineLegs, act, said }) {
  const start = match.startsAt;
  const day = saDay(start);
  const [out, setOut] = useState(!mineLegs.includes("out"));
  const [back, setBack] = useState(!mineLegs.includes("back"));
  const [seats, setSeats] = useState(String(Math.min(3, standing?.declaration?.seats ?? 3)));
  const [kind, setKind] = useState("school");
  const [outAt, setOutAt] = useState(saClock(new Date(new Date(start).getTime() - 105 * 60_000)));
  const [backAt, setBackAt] = useState(saClock(new Date(new Date(start).getTime() + 300 * 60_000)));
  const [note, setNote] = useState("");
  if (!standing) return null;
  if (!standing.mayDrive) {
    return (
      <div data-testid="lift-standing-line" style={{ ...muted(), marginTop: "12px" }}>
        To offer a lift: {standing.words}
      </div>
    );
  }
  if (mineLegs.includes("out") && mineLegs.includes("back")) return null;
  const legs = [
    out && !mineLegs.includes("out") ? { leg: "out", seats: Number(seats), meetKind: kind, meetAt: saInstant(day, outAt), note: note || null } : null,
    back && !mineLegs.includes("back") ? { leg: "back", seats: Number(seats), meetKind: kind, meetAt: saInstant(day, backAt), note: note || null } : null,
  ].filter(Boolean);
  return (
    <details style={{ marginTop: "12px" }} data-testid="lift-offer-form">
      <summary style={{ ...body(), cursor: "pointer", minHeight: "44px", display: "flex", alignItems: "center", fontWeight: 600 }}>
        Offer a lift for this fixture
      </summary>
      <div style={{ display: "grid", gap: "4px", marginTop: "6px", maxWidth: "460px" }}>
        {!mineLegs.includes("out") && <Tick checked={out} onChange={setOut} testid="lift-form-out">The way there</Tick>}
        {out && !mineLegs.includes("out") && <Input label="Leaving at (there)" type="time" value={outAt} onChange={setOutAt} data-testid="lift-form-out-at"/>}
        {!mineLegs.includes("back") && <Tick checked={back} onChange={setBack} testid="lift-form-back">The way home</Tick>}
        {back && !mineLegs.includes("back") && <Input label="Leaving at (home)" type="time" value={backAt} onChange={setBackAt} data-testid="lift-form-back-at"/>}
        <Select label="Seats for other boys" value={seats} onChange={setSeats} data-testid="lift-form-seats"
          options={Array.from({ length: standing.declaration?.seats ?? 1 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}/>
        <Select label="Meeting point" value={kind} onChange={setKind} data-testid="lift-form-kind"
          options={[{ value: "school", label: "At school" }, { value: "ground", label: "At the ground" }]}/>
        <Input label="A note for the families (a public place, never a home; no addresses)" value={note}
          onChange={(v) => setNote(v.slice(0, 120))} maxLength={120} data-testid="lift-form-note"/>
        <div>
          <Btn disabled={!legs.length} data-testid="lift-form-submit"
            onClick={() => act("offer", `/api/matches/${match.id}/lifts`, { legs })}>
            {legs.length === 2 ? "Offer both ways" : "Offer this lift"}
          </Btn>
        </div>
        {said.at === "offer" && said.text && <div role="alert" style={alert()} data-testid="lift-form-said">{said.text}</div>}
      </div>
    </details>
  );
}

/** The office's counts on the fixture (D10): no names. */
function OfficeCounts({ rows }) {
  return (
    <div data-testid="lift-office-counts" style={{ marginTop: "12px", paddingTop: "10px", borderTop: `1px solid ${D.border}` }}>
      <div style={label()}>Lifts, in counts</div>
      {rows.map((r) => (
        <div key={`${r.schoolId}:${r.leg}`} data-testid={`lift-count-${r.leg}`} style={{ ...body(), marginTop: "4px" }}>
          {r.leg === "out" ? "There" : "Back"}: {r.offers} lift{r.offers === 1 ? "" : "s"}, {r.seatsOffered} seats,
          {" "}{r.confirmed} confirmed, {r.requested} asked for{r.awaiting ? `, ${r.awaiting} waiting on a yes` : ""}
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Settings → School: the principal's policy
// ══════════════════════════════════════════════════════════════════

export function LiftPolicyPanel() {
  const schools = schoolsWhere("transport.lift.policy");
  if (!schools.length) return null;
  return <>{schools.map((s) => <LiftPolicyForSchool key={s.id} school={s}/>)}</>;
}

function LiftPolicyForSchool({ school }) {
  const [nonce, setNonce] = useState(0);
  const [policy, setPolicy] = useState(undefined);
  const [text, setText] = useState(LIFT_POLICY_TEMPLATE);
  const [clearance, setClearance] = useState(false);
  const [oneToOne, setOneToOne] = useState(true);
  const [meet, setMeet] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    api(`/api/lifts/policy?schoolId=${school.id}`).then((r) => {
      if (gone) return;
      setPolicy(r.policy);
      if (r.policy) {
        setText(r.policy.body); setClearance(r.policy.requiresClearance); setOneToOne(r.policy.allowOneToOne); setMeet(r.policy.meetNote ?? "");
      }
    }).catch(() => { if (!gone) setPolicy(null); });
    return () => { gone = true; };
  }, [school.id, nonce]);
  const send = async (path, payload, done) => {
    setBusy(true); setSaid("");
    try { await api(path, { method: "POST", body: payload }); setSaid(done); setNonce((n) => n + 1); }
    catch (e) { setSaid(say(e)); }
    finally { setBusy(false); }
  };
  const length = text.trim().length;
  return (
    <Card sx={{ padding: "16px", marginTop: "16px" }} data-testid="lift-policy-panel">
      <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary }}>Lift clubs at {school.name}</div>
      <p style={{ ...muted(), margin: "4px 0 10px", maxWidth: "62ch" }}>
        Families give each other's boys lifts to fixtures; the school facilitates and does not operate them. Lift clubs are
        live at the school only while the platform has switched them on AND this policy, signed by you, stands. Every parent
        reads it before offering or asking. Withdrawing it cancels every open lift at once.
      </p>
      <div data-testid="lift-policy-state" style={{ ...body(), marginBottom: "10px" }}>
        {policy === undefined ? "Loading…"
          : policy ? `Version ${policy.version}, signed by ${policy.signedBy ?? "the principal"} on ${new Date(policy.signedAt).toLocaleDateString("en-ZA")}. ${policy.live ? "Lift clubs are live." : "Lift clubs are not switched on by the platform."}`
          : "No policy is signed: lift clubs are off at this school."}
      </div>
      <label htmlFor={`lift-policy-${school.id}`} style={{ ...label(), display: "block", marginBottom: "5px" }}>The school's lift policy</label>
      <textarea id={`lift-policy-${school.id}`} data-testid="lift-policy-body" value={text} onChange={(e) => setText(e.target.value)} rows={12}
        style={{ width: "100%", padding: "10px 12px", background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.md,
                 color: D.textPrimary, fontFamily: D.body, fontSize: "13px", lineHeight: 1.5, boxSizing: "border-box" }}/>
      <div style={{ ...muted(), marginBottom: "8px" }}>{length} characters (200 to 6000).</div>
      <Tick checked={clearance} onChange={setClearance} testid="lift-policy-clearance">
        Drivers must hold a current police clearance, Children's Act register clearance and Sexual Offences Register clearance, recorded by the office.
      </Tick>
      <Tick checked={oneToOne} onChange={setOneToOne} testid="lift-policy-one-to-one">
        A boy may be the only passenger in a car that is not his parent's (both families are told before they agree).
      </Tick>
      <Input label="The school's meeting point (optional, a public place)" value={meet} onChange={(v) => setMeet(v.slice(0, 80))}
        maxLength={80} placeholder="the Chapel car park" data-testid="lift-policy-meet"/>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Btn disabled={busy} data-testid="lift-policy-sign"
          onClick={() => send("/api/lifts/policy", { schoolId: school.id, body: text, requiresClearance: clearance, allowOneToOne: oneToOne, meetNote: meet }, "Signed.")}>
          {policy ? "Sign this as the new version" : "Sign and switch lift clubs on"}
        </Btn>
        {policy && (
          <Btn variant="danger" disabled={busy} data-testid="lift-policy-withdraw"
            onClick={() => send("/api/lifts/policy/withdraw", { schoolId: school.id }, "Withdrawn. Every open lift is cancelled and the families are told.")}>
            Withdraw: pause lift clubs
          </Btn>
        )}
      </div>
      {said && <div role="status" data-testid="lift-policy-said" style={{ ...body(), marginTop: "8px" }}>{said}</div>}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════
//  Settings → Me: the parent's standing and declaration
// ══════════════════════════════════════════════════════════════════

export function LiftDeclarationPanel() {
  const schools = schoolsWhere("transport.lift.arrange");
  if (!schools.length) return null;
  return <>{schools.map((s) => <LiftDeclarationForSchool key={s.id} school={s}/>)}</>;
}

/**
 * Her children at the school: the subjects of her assignments there that
 * arrange lifts — by capability, never by a role's name (§21.1).
 */
const childrenAt = (schoolId) => [...new Set((profile()?.assignments ?? [])
  .filter((a) => a.school === schoolId && roleGrants(a.role, "transport.lift.arrange")).flatMap((a) => a.subjects ?? []))];

function LiftDeclarationForSchool({ school }) {
  const [nonce, setNonce] = useState(0);
  const standing = useStanding(school.id, nonce);
  const [policy, setPolicy] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [f, setF] = useState({ vehicle: "", registration: "", seats: "3", licenceHeld: false, insured: false,
                               roadworthy: false, belts: false, codeAcknowledged: false, contactId: "" });
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const kids = childrenAt(school.id).join(",");
  useEffect(() => {
    if (!standing?.moduleLive) return undefined;
    let gone = false;
    api(`/api/lifts/policy?schoolId=${school.id}`).then((r) => { if (!gone) setPolicy(r.policy); }).catch(() => {});
    Promise.all(kids.split(",").filter(Boolean).map((pid) =>
      api(`/api/read/emergency_contacts?playerId=${pid}`).then((r) => r.rows ?? []).catch(() => [])))
      .then((lists) => { if (!gone) setContacts(lists.flat()); });
    return () => { gone = true; };
  }, [school.id, standing?.moduleLive, kids]);
  if (!standing?.moduleLive) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const d = standing.declaration;
  const send = async (path, payload, done) => {
    setBusy(true); setSaid("");
    try { await api(path, { method: "POST", body: payload }); setSaid(done); setNonce((n) => n + 1); }
    catch (e) { setSaid(say(e)); }
    finally { setBusy(false); }
  };
  return (
    <Card sx={{ padding: "16px", marginTop: "16px" }} data-testid="lift-declaration-panel">
      <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary }}>Lift club at {school.name}</div>
      <div data-testid="lift-standing" style={{ ...body(), margin: "6px 0 10px" }}>
        {standing.mayDrive ? `You may offer lifts to your son's fixtures, in your ${d?.vehicle} (${d?.registration}), with ${d?.seats} seats for other boys. Your declaration runs to ${d?.expiresOn ? String(d.expiresOn).slice(0, 10) : "next year"}.`
          : standing.words}
      </div>
      {d && !d.policyCurrent && <div style={{ ...muted(), marginBottom: "8px" }}>The school has signed a new policy since your declaration. Read it and declare again.</div>}
      {policy && (
        <details data-testid="lift-policy-read" open={!d}>
          <summary style={{ ...body(), cursor: "pointer", minHeight: "44px", display: "flex", alignItems: "center", fontWeight: 600 }}>
            The school's lift policy (version {policy.version})
          </summary>
          <div style={{ ...body(), whiteSpace: "pre-wrap", padding: "8px 0" }} data-testid="lift-policy-text">{policy.body}</div>
        </details>
      )}
      {!["pupil_excluded", "consent_not_granted", "module_off", "no_policy"].includes(standing.reason) && (
        <details data-testid="lift-declare-form" open={!d}>
          <summary style={{ ...body(), cursor: "pointer", minHeight: "44px", display: "flex", alignItems: "center", fontWeight: 600 }}>
            {d ? "Declare again (a new car, or a new year)" : "Make your yearly driver's declaration"}
          </summary>
          <div style={{ maxWidth: "460px", marginTop: "6px" }}>
            <Input label="The car (e.g. silver Toyota Fortuner)" value={f.vehicle} onChange={set("vehicle")} maxLength={60} data-testid="lift-declare-vehicle"/>
            <Input label="Registration" value={f.registration} onChange={set("registration")} maxLength={14} data-testid="lift-declare-registration"/>
            <Select label="Seats with belts for other boys (not your own children)" value={f.seats} onChange={set("seats")} data-testid="lift-declare-seats"
              options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }))}/>
            <Tick checked={f.licenceHeld} onChange={set("licenceHeld")} testid="lift-declare-licence">I hold a valid driving licence.</Tick>
            <Tick checked={f.insured} onChange={set("insured")} testid="lift-declare-insured">The car is insured.</Tick>
            <Tick checked={f.roadworthy} onChange={set("roadworthy")} testid="lift-declare-roadworthy">The car is roadworthy.</Tick>
            <Tick checked={f.belts} onChange={set("belts")} testid="lift-declare-belts">Every passenger will wear a seat belt.</Tick>
            <Tick checked={f.codeAcknowledged} onChange={set("codeAcknowledged")} testid="lift-declare-code">
              I have read the school's lift policy above and CSA's code of conduct, and accept them.
            </Tick>
            <fieldset style={{ border: "none", padding: 0, margin: "8px 0" }}>
              <legend style={{ ...label(), marginBottom: "6px" }}>The number families on your lift ring on the day</legend>
              {contacts.length === 0 && <div style={muted()}>Add your number to your son's emergency contacts first; it is chosen from there.</div>}
              {contacts.map((c) => (
                <label key={c.id} style={{ display: "flex", gap: "10px", alignItems: "center", minHeight: "44px", cursor: "pointer", ...body() }}>
                  <input type="radio" name={`lift-contact-${school.id}`} checked={f.contactId === c.id} onChange={() => set("contactId")(c.id)}
                    data-testid={`lift-declare-contact-${c.id}`} style={{ width: "20px", height: "20px" }}/>
                  <span>{c.name} ({c.relationship}) · {c.phone}</span>
                </label>
              ))}
            </fieldset>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Btn disabled={busy} data-testid="lift-declare-submit"
                onClick={() => send("/api/lifts/declaration", { schoolId: school.id, ...f, seats: Number(f.seats) }, "Declared.")}>
                Declare
              </Btn>
              {d && (
                <Btn variant="ghost" disabled={busy} data-testid="lift-declare-withdraw"
                  onClick={() => send("/api/lifts/declaration/withdraw", { schoolId: school.id }, "Withdrawn. Your open lifts are cancelled and the families told.")}>
                  Stop offering lifts
                </Btn>
              )}
            </div>
          </div>
        </details>
      )}
      {said && <div role="status" data-testid="lift-declare-said" style={{ ...body(), marginTop: "8px" }}>{said}</div>}
    </Card>
  );
}

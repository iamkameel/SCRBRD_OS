import { useEffect, useState } from "react";
import { D, T, textOn } from "../design/tokens.js";
import { Avatar, Btn, Card, Input, Modal, Select } from "../ui/primitives.jsx";
import { addDays, dateStr, today } from "../lib/format.js";
import { api } from "../lib/api.js";
import { mode } from "../lib/session.js";
import { teamsForLevel, teamLabel, compareTeams } from "@scrbrd/policy/teams";

/**
 * SCRBRD — arranging a fixture, in the client's own words.
 *
 * services/api/write/fixture-api.mjs validates vocabulary and shape and
 * otherwise leaves the decision to match_insert() in db/09; every refusal it
 * can give is named here as a sentence, not passed through as a bare code —
 * the same discipline discipline.jsx already keeps for a disciplinary matter.
 *
 * `invalid_fixture` (23514, a CHECK the database itself enforces) is the one
 * refusal this form cannot always word precisely: the route passes the
 * constraint violation's own message through as `detail`, and one of those
 * messages — a sport the platform has not granted this school — already reads
 * as a full sentence, so it is shown verbatim. The others (a side playing
 * itself, a format missing for cricket) are Postgres's own "violates check
 * constraint" wording, which is not something to show a sportsmaster, so a
 * general sentence stands in for those instead.
 */
const FIXTURE_REFUSAL = {
  school_required: "Choose the school this fixture is for.",
  team_required: "Choose which of your teams is playing.",
  starts_at_required: "Say when the fixture starts.",
  starts_at_invalid: "That date and time could not be read.",
  status_invalid: "That is not a status a fixture can hold.",
  format_required_for_cricket: "A cricket fixture needs a format.",
  overs_are_a_cricket_unit: "Overs are a cricket unit and do not apply to this sport.",
  overs_invalid: "Overs must be a whole number from 1 to 120.",
  name_the_away_side_once: "Name the away side one way — a school on SCRBRD, or typed by name — not both.",
  away_team_required: "Say which team the away school is fielding.",
  opponent_required: "Say who the fixture is against.",
  no_such_school_ground_or_sport: "That school, ground or sport could not be found.",
  nothing_to_change: "Nothing was changed.",
  not_permitted: "You do not hold the authority to arrange or amend a fixture for that school and team.",
};

/** A CHECK violation's own message, read for the one case that already states
 *  its reason in full sentences; anything else is Postgres's internal wording
 *  and is not shown as though it were the product's. */
function invalidFixtureSentence(detail) {
  if (typeof detail === "string" && /is not switched on for this school/.test(detail)) return detail;
  return "That fixture breaks one of the game's own rules — check that the two sides differ and, for cricket, that a format is set.";
}

export function fixtureRefusal(e) {
  if (e?.code === "invalid_fixture") return invalidFixtureSentence(e.detail);
  if (FIXTURE_REFUSAL[e?.code]) return FIXTURE_REFUSAL[e.code];
  if (e?.status === 401) return "Your session has ended — sign in again. Nothing was arranged.";
  if (e?.status) return `Not arranged — the server said ${e.code || `HTTP ${e.status}`}.`;
  return "Could not reach the server. Nothing was arranged.";
}

/** Every code a school's own vocabulary allows, in reading order — see
 *  packages/policy/src/teams.mjs. Used for BOTH sides: SCRBRD hosts schools,
 *  not clubs or provinces, so a tenant's away side draws the same list. */
const SCHOOL_TEAMS = [...teamsForLevel("school")].sort(compareTeams);

// A boy's game arranged for real: two sides, a place, a time. The right
// column is a live preview of exactly the fixture the left column is
// building — nothing in it is invented, only assembled from what has
// already been typed, so it can never say more than the form actually knows.
function AddFixtureModal({ fixtureSchools, teamOptions, grounds, matches, onClose, onCreated }) {
  const [schoolId, setSchoolId] = useState(fixtureSchools[0]?.id ?? "");
  const [teamCode, setTeamCode] = useState("");
  // The API's own two answers to "who is the away side" (see
  // services/api/write/fixture-api.mjs): a tenant school, named and read by
  // both sides, or free text for a visitor SCRBRD does not host. The toggle
  // makes that choice visible instead of leaving one text box to mean both.
  const [awayMode, setAwayMode] = useState("free");   // "free" | "school"
  const [opponent, setOpponent] = useState("");
  const [awaySchoolId, setAwaySchoolId] = useState("");
  const [awayTeamCode, setAwayTeamCode] = useState("");
  const [liveSchools, setLiveSchools] = useState([]);
  const [groundId, setGroundId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("14:00");
  const [format, setFormat] = useState("T20");
  const [overs, setOvers] = useState("20");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);

  // The away-school list is the same one onboarding offers a stranger — a
  // public fact, nothing more — fetched once, only if this mode is ever used.
  useEffect(() => { let off = false; (async () => {
    if (await mode() !== "live") return;
    const r = await api("/api/schools").catch(() => null);
    if (!off && r?.rows) setLiveSchools(r.rows);
  })(); return () => { off = true; }; }, []);

  const FORMATS = { T20: 20, "One-Day": 50, "Two-Day": 80 };
  const setFmt = (f) => { setFormat(f); setOvers(String(FORMATS[f] ?? 20)); };

  const ground = grounds.find(g=>g.id===groundId);
  const awaySchool = liveSchools.find(s=>s.id===awaySchoolId);
  const awayLabel = awayMode==="school"
    ? (awaySchool ? `${awaySchool.name}${awayTeamCode?` ${awayTeamCode}`:""}` : "")
    : opponent;
  const ready = teamCode && (awayMode==="school" ? (awaySchoolId && awayTeamCode.trim()) : opponent.trim()) && date;

  // Nothing here blocks a double-booking — the ground and the hour are a
  // fact worth knowing, not a rule worth enforcing, and only the office
  // arranging the trip could say whether it is really a clash. Computed
  // from the same fixture list already on screen: no fabricated lookup.
  const clash = date && ground && matches.some(m => m.venue===ground.name && m.date===date);

  const submit = async () => {
    setSaid(""); setBusy(true);
    try {
      await api("/api/fixtures", { method: "POST", body: {
        schoolId, teamCode,
        ...(awayMode==="school" ? { awaySchoolId, awayTeamCode: awayTeamCode.trim() } : { opponent: opponent.trim() }),
        groundId: groundId || null,
        startsAt: new Date(`${date}T${time}`).toISOString(),
        format, overs: Number(overs),
      }});
      onCreated();
    } catch (e) { setSaid(fixtureRefusal(e)); }
    finally { setBusy(false); }
  };

  // Three taps to a real Saturday, since almost every school fixture is one.
  const nextSaturday = (from) => { const d = new Date(from); const add = (6 - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + add); return d; };
  const quickDates = [
    { label: "This Saturday", d: nextSaturday(addDays(today, -1)) },
    { label: "Next Saturday", d: nextSaturday(today) },
    { label: "In two weeks", d: addDays(today, 14) },
  ];

  const checklist = [
    { label: "Home side", done: !!teamCode },
    { label: "Away side", done: awayMode==="school" ? !!(awaySchoolId && awayTeamCode.trim()) : !!opponent.trim() },
    { label: "Date", done: !!date },
  ];

  const lbl = { display:"block",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"};

  return (
    <Modal title="Arrange a Fixture" onClose={onClose} width="800px">
      <div style={{display:"flex",gap:"20px",flexWrap:"wrap"}}>
        {/* ── The form ── */}
        <div style={{flex:"1 1 380px",minWidth:"320px"}}>
          {fixtureSchools.length>1&&<Select label="School" value={schoolId} onChange={setSchoolId}
            options={fixtureSchools.map(s=>({value:s.id,label:s.name}))}/>}

          <Select label="Home side" value={teamCode} onChange={setTeamCode}
            options={[{value:"",label:"Which of your teams?"}, ...teamOptions.map(t=>({value:t,label:teamLabel(t)}))]}/>

          <div style={{marginBottom:"5px"}}>
            <label style={lbl}>Away side</label>
            <div style={{display:"flex",background:D.surf2,borderRadius:D.pill,padding:"3px",border:`1px solid ${D.border}`,marginBottom:"8px"}}>
              {[["free","Not on SCRBRD"],["school","A school here"]].map(([m,l])=>(
                <button key={m} onClick={()=>setAwayMode(m)} className="pressBtn" style={{
                  flex:1,padding:"6px 10px",borderRadius:D.pill,border:"none",cursor:"pointer",
                  background:awayMode===m?D.gradLive:"transparent",color:awayMode===m?T.light.ink:D.textMuted,
                  fontFamily:D.head,fontSize:"10px",fontWeight:700,
                }}>{l}</button>
              ))}
            </div>
          </div>
          {awayMode==="free"
            ? <Input label="Opponent" value={opponent} onChange={setOpponent} placeholder="e.g. Michaelhouse 1st XI"/>
            : (
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:"10px"}}>
                <Select label="School" value={awaySchoolId} onChange={setAwaySchoolId}
                  options={[{value:"",label:liveSchools.length?"Which school?":"Loading…"}, ...liveSchools.map(s=>({value:s.id,label:s.name}))]}/>
                <Input label="Their team" value={awayTeamCode} onChange={(v)=>setAwayTeamCode(v.toUpperCase())} placeholder="1XI"/>
              </div>
            )}

          <label style={lbl}>Quick dates</label>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"12px"}}>
            {quickDates.map(q=>(
              <button key={q.label} onClick={()=>setDate(dateStr(q.d))} className="pressBtn" style={{
                padding:"5px 12px",borderRadius:D.pill,cursor:"pointer",
                border:`1px solid ${date===dateStr(q.d)?D.violet+"55":D.border}`,
                background:date===dateStr(q.d)?D.violet+"14":"transparent",
                fontFamily:D.body,fontSize:"11px",color:date===dateStr(q.d)?D.violet:D.textMuted,
              }}>{q.label}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
            <Input label="Date" value={date} onChange={setDate} type="date"/>
            <Input label="Time" value={time} onChange={setTime} type="time"/>
          </div>

          <Select label="Venue" value={groundId} onChange={setGroundId}
            options={[{value:"",label:"Not recorded"}, ...grounds.map(g=>({value:g.id,label:g.name}))]}/>
          {clash&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.amber,marginTop:"-8px",marginBottom:"12px"}}>
            ⚠ Another fixture is already down for {ground.name} that day.</div>}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
            <Select label="Format" value={format} onChange={setFmt} options={Object.keys(FORMATS)}/>
            <Input label="Overs" value={overs} onChange={setOvers} type="number"/>
          </div>
        </div>

        {/* ── The live preview: exactly what the left column has assembled ── */}
        <div style={{flex:"1 1 300px",minWidth:"280px"}}>
          <div style={{position:"sticky",top:0}}>
            <Card sx={{padding:"18px",background:`linear-gradient(160deg,${D.violet}0d,${D.surf1})`}} data-testid="fixture-preview">
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"14px",textAlign:"center"}}>Matchday</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"14px",marginBottom:"16px"}}>
                <div style={{textAlign:"center"}}>
                  <Avatar name={teamCode||"?"} size={44} color={D.emerald}/>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textPrimary,marginTop:"6px"}}>{teamCode||"Your side"}</div>
                </div>
                <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,fontWeight:700}}>VS</div>
                <div style={{textAlign:"center"}}>
                  <Avatar name={awayLabel||"?"} size={44} color={D.rose}/>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textPrimary,marginTop:"6px",maxWidth:"110px"}}>{awayLabel||"Opponent"}</div>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px",fontFamily:D.body,fontSize:"12px",color:D.textSecondary,borderTop:`1px solid ${D.border}`,paddingTop:"12px"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:D.textMuted}}>When</span>
                  <span>{date ? new Date(`${date}T${time}`).toLocaleString(undefined,{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "—"}</span></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:D.textMuted}}>Venue</span><span>{ground?.name ?? "Not recorded"}</span></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:D.textMuted}}>Format</span><span>{format} · {overs} overs</span></div>
              </div>
            </Card>
            <div data-testid="fixture-checklist" style={{marginTop:"14px",display:"flex",flexDirection:"column",gap:"6px"}}>
              {checklist.map(c=>(
                <div key={c.label} style={{display:"flex",alignItems:"center",gap:"8px",fontFamily:D.body,fontSize:"11px",color:c.done?D.emerald:D.textMuted}}>
                  <span>{c.done?"✓":"○"}</span>{c.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {said&&<div role="alert" data-testid="fixture-refused" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginTop:"14px"}}>{said}</div>}
      <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"16px"}}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={!ready||busy} data-testid="fixture-submit">{busy?"Arranging…":"Arrange Fixture"}</Btn>
      </div>
    </Modal>
  );
}

/**
 * Rescheduling, or calling off, a fixture the host already owns.
 *
 * Everything but the date, the ground and the status is frozen once a fixture
 * exists — services/api/write/fixture-api.mjs's `amend` deliberately does not
 * take the away side or the sport, and neither does this form. The caller
 * (MatchCentreView) offers this only as a courtesy, the same shape canScore()
 * uses: the actual gate is match_update() in db/09, keyed on fixture.update at
 * the HOST's own school and team, and the away school's attempt is refused
 * there regardless of what this component draws.
 */
function RescheduleFixture({ match, grounds, onChanged }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [groundId, setGroundId] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);

  const amend = async (body) => {
    setSaid(""); setBusy(true);
    try {
      await api(`/api/fixtures/${match.id}`, { method: "POST", body });
      setOpen(false); setDate(""); setTime(""); setGroundId("");
      onChanged();
    } catch (e) { setSaid(fixtureRefusal(e)); }
    finally { setBusy(false); }
  };

  const save = () => {
    const body = {};
    if (date && time) body.startsAt = new Date(`${date}T${time}`).toISOString();
    if (groundId) body.groundId = groundId;
    if (!Object.keys(body).length) { setSaid(FIXTURE_REFUSAL.nothing_to_change); return; }
    amend(body);
  };

  if (!open) return (
    <Btn size="sm" variant="ghost" onClick={()=>setOpen(true)} data-testid="fixture-reschedule-open">Reschedule</Btn>
  );

  return (
    <Card sx={{padding:"14px",marginBottom:"12px"}} data-testid="fixture-reschedule">
      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"10px"}}>Reschedule this fixture</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
        <Input label="New date" value={date} onChange={setDate} type="date"/>
        <Input label="New time" value={time} onChange={setTime} type="time"/>
      </div>
      <Select label="New venue" value={groundId} onChange={setGroundId}
        options={[{value:"",label:"Leave as is"}, ...grounds.map(g=>({value:g.id,label:g.name}))]}/>
      {said&&<div role="alert" data-testid="fixture-reschedule-refused" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginBottom:"8px"}}>{said}</div>}
      <div style={{display:"flex",gap:"8px",justifyContent:"space-between",flexWrap:"wrap"}}>
        <Btn size="sm" variant="danger" disabled={busy} onClick={()=>amend({ status: "abandoned" })} data-testid="fixture-call-off">Call it off</Btn>
        <div style={{display:"flex",gap:"8px"}}>
          <Btn size="sm" variant="ghost" disabled={busy} onClick={()=>{setOpen(false);setSaid("");}}>Cancel</Btn>
          <Btn size="sm" disabled={busy||(!date&&!groundId)} onClick={save} data-testid="fixture-reschedule-save">Save</Btn>
        </div>
      </div>
    </Card>
  );
}

export { AddFixtureModal, RescheduleFixture, SCHOOL_TEAMS };

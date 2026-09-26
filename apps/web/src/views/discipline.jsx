import { useEffect, useState } from "react";
import { D, textOn, themed } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { filesConduct } from "../rbac/conduct.js";
import { Badge, Btn, Card } from "../ui/primitives.jsx";
import { DISMISSAL_LABEL } from "@scrbrd/scoring";

/**
 * The disciplinary record, drawn. SCRBRD-053 built the table (db/25), the read
 * (`disciplinary_records`) and both writes (discipline-api.mjs); this is the
 * first screen that calls them.
 *
 * Two surfaces, for two different people:
 *
 *   ConductTab — a tab on a boy's profile, for STAFF who read the record
 *     (rbac/conduct.js decides who is drawn it, and why a pupil is not). It
 *     lists his matters and, for a holder of discipline.write, offers the
 *     school-side filing form and the way to conclude or withdraw one.
 *
 *   ReportIncident — an action on a fixture in Match Centre, for the umpire
 *     who stood at it. He holds discipline.write and NOT discipline.read, so
 *     after filing he is told it landed and is shown nothing back. The server
 *     never returns the row to him either (no RETURNING — see discipline-api).
 *
 * Every gate here is a courtesy; row-level security on disciplinary_record is
 * the guard. And there is NO demonstration fallback: an invented matter about
 * a named child would read exactly like a real one.
 */

/**
 * Every refusal the routes can give, in words. discipline-api.mjs maps the
 * three database refusals — 42501 (row-level security), 45001 and 45002 (the
 * authorship trigger in db/25) — and the CHECK constraint onto these codes.
 */
const REFUSAL = {
  not_permitted: "Refused — your role does not reach this pupil, school or fixture. Nothing was recorded.",
  not_the_author: "Refused — only the person who recorded this account may change its wording.",
  subject_is_fixed: "Refused — a matter cannot be moved to another child.",
  outcome_required: "A matter cannot be closed without saying what was decided.",
  body_required: "Say what happened first.",
  body_too_long: "The account is longer than 4,000 characters.",
  nothing_to_change: "Nothing to change.",
};
const refusal = (e) =>
  REFUSAL[e?.code]
  ?? (e?.status === 401 ? "Your session has ended — sign in again. Nothing was recorded."
    : e?.status ? `Not recorded — the server said ${e.code || `HTTP ${e.status}`}.`
    : "Could not reach the server. Nothing was recorded.");

const STATE_TONE = themed(() => ({ open: D.amber, concluded: D.emerald, withdrawn: D.textMuted }));

const field = () => ({
  width: "100%", padding: "9px 10px", borderRadius: D.md, background: D.surf2,
  border: `1px solid ${D.border}`, color: D.textPrimary, fontFamily: D.body, fontSize: "12px",
  boxSizing: "border-box",
});
const label = () => ({ fontFamily: D.head, fontSize: "10px", fontWeight: 700, color: D.textMuted,
                letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "6px" });

function Refused({ said, testid }) {
  if (!said) return null;
  return (
    <div role="alert" data-testid={testid}
         style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginTop: "6px" }}>
      {said}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  On the profile — staff only
// ══════════════════════════════════════════════════════

/** One matter, and — for a writer — the way to close it. */
function Matter({ m, fixture, canProgress, onChanged }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  const progress = async (state) => {
    // Said before the server has to say it: the CHECK in db/25 would refuse
    // this anyway, and a person should not have to round-trip to learn it.
    if (!outcome.trim()) { setSaid(REFUSAL.outcome_required); return; }
    setBusy(true); setSaid(null);
    try {
      await api(`/api/discipline/${m.id}`, { method: "PATCH", body: { state, outcome: outcome.trim() } });
      setOutcome("");
      onChanged();
    } catch (e) {
      setSaid(refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const tone = STATE_TONE[m.state] ?? D.textMuted;
  return (
    <div data-testid={`conduct-matter-${m.id}`} style={{ padding: "12px 0", borderTop: `1px solid ${D.border}` }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "6px" }}>
        <span style={{ fontFamily: D.mono, fontSize: "11px", color: D.textPrimary }}>{m.occurredOn ?? "—"}</span>
        <Badge color={tone} data-testid={`conduct-state-${m.id}`}>{m.state}</Badge>
        <span style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>
          {m.matchId ? (fixture ? `At the fixture v ${fixture.awayTeam} · ${fixture.date ?? ""}` : "At a fixture you cannot see")
                     : "School matter — no fixture"}
        </span>
      </div>
      <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, lineHeight: 1.5, whiteSpace: "pre-wrap" }}
           data-testid={`conduct-body-${m.id}`}>
        {m.body}
      </div>
      <div style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, marginTop: "4px" }}>
        Recorded by {m.recordedBy ?? "someone whose account you cannot see"}
      </div>
      {m.outcome && (
        <div style={{ marginTop: "8px", padding: "8px 10px", background: D.surf2, borderRadius: D.md, border: `1px solid ${D.border}` }}>
          <div style={label()}>Outcome</div>
          <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, whiteSpace: "pre-wrap" }}
               data-testid={`conduct-outcome-${m.id}`}>{m.outcome}</div>
        </div>
      )}
      {canProgress && m.state === "open" && (
        <div style={{ marginTop: "10px" }}>
          <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2}
            aria-label="What was decided" data-testid={`conduct-outcome-input-${m.id}`}
            placeholder="What was decided — required to conclude or withdraw."
            style={{ ...field(), resize: "vertical" }}/>
          <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
            <Btn size="sm" variant="success" disabled={busy} onClick={() => progress("concluded")}
                 data-testid={`conduct-conclude-${m.id}`}>Conclude</Btn>
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => progress("withdrawn")}
                 data-testid={`conduct-withdraw-${m.id}`}>Withdraw</Btn>
          </div>
          <Refused said={said} testid={`conduct-refused-${m.id}`}/>
        </div>
      )}
    </div>
  );
}

/** The school-side filing form: a matter with no fixture behind it. */
function RecordMatter({ playerId, onFiled }) {
  const [body, setBody] = useState("");
  const [on, setOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const [filed, setFiled] = useState(false);

  const submit = async () => {
    if (!body.trim()) { setSaid(REFUSAL.body_required); return; }
    setBusy(true); setSaid(null); setFiled(false);
    try {
      await api(`/api/players/${playerId}/discipline`, {
        method: "POST", body: { body: body.trim(), ...(on ? { occurredOn: on } : {}) } });
      setBody(""); setOn(""); setFiled(true);
      onFiled();
    } catch (e) {
      setSaid(refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ padding: "14px" }} data-testid="conduct-record-form">
      <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary, marginBottom: "8px" }}>
        Record a matter
      </div>
      <textarea value={body} onChange={(e) => { setBody(e.target.value); setFiled(false); }} rows={3}
        aria-label="What happened" data-testid="conduct-record-body"
        placeholder="What happened, as you would say it to his parents."
        style={{ ...field(), resize: "vertical" }}/>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label="When it happened"
          data-testid="conduct-record-date" style={{ ...field(), width: "auto" }}/>
        <Btn size="sm" disabled={busy} onClick={submit} data-testid="conduct-record-submit">Record</Btn>
        {filed && <span data-testid="conduct-record-done" style={{ fontFamily: D.body, fontSize: "11px", color: D.emerald }}>Recorded.</span>}
      </div>
      <Refused said={said} testid="conduct-record-refused"/>
    </Card>
  );
}

/**
 * The Conduct tab. Mounted only when the tab is opened, so the read — which
 * the API writes to the school's access log — happens when somebody chooses to
 * look, not every time a profile is opened for his batting average.
 */
function ConductTab({ player, role }) {
  const [nonce, setNonce] = useState(0);
  const live = signedIn();
  const { rows, loading, error } = useLive("disciplinary_records", role, nonce, { playerId: player.id });
  const { rows: matches } = useLive("matches", role);
  const canWrite = filesConduct(role);

  if (!live) {
    return (
      <Card sx={{ padding: "18px" }} data-testid="conduct-signed-out">
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
          Sign in to see the disciplinary record. The demonstration carries none — an invented matter
          about a named boy would read exactly like a real one.
        </div>
      </Card>
    );
  }

  // Narrowed by the server already; filtered again because the list is about
  // this boy and nothing else should ever render under his name.
  const mine = rows.filter((m) => m.playerId === player.id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }} data-testid="conduct-tab">
      <Card sx={{ padding: "14px" }} data-testid="conduct-list">
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "4px" }}>
          <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary }}>Disciplinary record</div>
          {!loading && !error && (
            <div style={{ fontFamily: D.mono, fontSize: "9px", color: D.textMuted }} data-testid="conduct-count">
              {mine.length} {mine.length === 1 ? "matter" : "matters"}
            </div>
          )}
        </div>
        <div style={{ fontFamily: D.body, fontSize: "10px", color: D.textMuted, marginBottom: "6px" }}>
          Staff only. Every read of this record is on the school's own access log.
        </div>
        {loading ? (
          <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>Loading…</div>
        ) : error ? (
          <div role="alert" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose) }} data-testid="conduct-error">
            Could not load the record ({error}). Nothing is shown rather than a list that may be incomplete.
          </div>
        ) : mine.length === 0 ? (
          <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }} data-testid="conduct-empty">
            No matters on record that you can see.
          </div>
        ) : (
          mine.map((m) => (
            <Matter key={m.id} m={m} fixture={matches.find((x) => x.id === m.matchId)}
                    canProgress={canWrite} onChanged={() => setNonce((n) => n + 1)}/>
          ))
        )}
      </Card>
      {canWrite && <RecordMatter playerId={player.id} onFiled={() => setNonce((n) => n + 1)}/>}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  In Match Centre — the umpire
// ══════════════════════════════════════════════════════

/**
 * Who can be named, from what this reader can actually see of the fixture.
 *
 * The team sheet first (match_squad, under player.profile.read). An umpire
 * holds no player capability, so for him it comes back empty — and the only
 * thing about the players he CAN read is the ball log he stood over. So they
 * are offered as what they did in it: which innings, on strike or bowling, for
 * how many logged deliveries, and how they were out. Counts of logged events,
 * nothing derived, so nothing on the list is a figure the log does not hold.
 */
function fromBallLog(events) {
  const people = new Map();
  const touch = (id, innings) => {
    if (!id) return null;
    const k = `${id}`;
    if (!people.has(k)) people.set(k, { id, innings: new Set(), faced: 0, bowled: 0, out: null });
    const p = people.get(k);
    p.innings.add(innings);
    return p;
  };
  for (const e of events) {
    if ((e.kind ?? "ball") !== "ball") continue;
    const s = touch(e.striker_id, e.innings);
    if (s) s.faced++;
    touch(e.non_striker_id, e.innings);
    const b = touch(e.bowler_id, e.innings);
    if (b) b.bowled++;
    if (e.dismissal) {
      const d = touch(e.dismissed_id || e.striker_id, e.innings);
      if (d) d.out = DISMISSAL_LABEL[e.dismissal] ?? e.dismissal;
    }
  }
  return [...people.values()].map((p) => {
    const inns = [...p.innings].sort().map((i) => `innings ${Number(i) + 1}`).join(", ");
    const parts = [];
    if (p.faced) parts.push(`on strike for ${p.faced} logged deliver${p.faced === 1 ? "y" : "ies"}`);
    if (p.bowled) parts.push(`bowled ${p.bowled} logged deliver${p.bowled === 1 ? "y" : "ies"}`);
    if (!p.faced && !p.bowled) parts.push("at the non-striker's end");
    parts.push(p.out ? `out, ${p.out.toLowerCase()}` : p.faced ? "not out" : null);
    return { id: p.id, label: `${inns[0].toUpperCase()}${inns.slice(1)} · ${parts.filter(Boolean).join(" · ")}` };
  });
}

function ReportIncident({ match, role }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState({ loading: false, from: null, people: [], error: null });
  const [playerId, setPlayerId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const [done, setDone] = useState(false);

  const offered = signedIn() && filesConduct(role) && !!match?.id && match.status !== "upcoming";

  useEffect(() => {
    if (!open || !offered) return;
    let cancelled = false;
    setWho({ loading: true, from: null, people: [], error: null });
    (async () => {
      try {
        const squad = (await api(`/api/read/match_squad?matchId=${encodeURIComponent(match.id)}`)).rows ?? [];
        if (squad.length) {
          if (!cancelled) setWho({ loading: false, from: "squad", error: null,
            people: squad.map((r) => ({ id: r.player_id, label: `${r.full_name}${r.side ? ` · ${r.side}` : ""}` })) });
          return;
        }
        const events = (await api(`/api/matches/${encodeURIComponent(match.id)}/events?since=0`)).events ?? [];
        if (!cancelled) setWho({ loading: false, from: "log", error: null, people: fromBallLog(events) });
      } catch (e) {
        if (!cancelled) setWho({ loading: false, from: null, people: [], error: e.code || e.message || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
  }, [open, offered, match?.id]);

  // A courtesy, not the gate: the INSERT policy's fixture anchor decides.
  if (!offered) return null;

  const submit = async () => {
    if (!playerId) { setSaid("Choose who the report is about."); return; }
    if (!body.trim()) { setSaid(REFUSAL.body_required); return; }
    setBusy(true); setSaid(null); setDone(false);
    try {
      await api(`/api/players/${playerId}/discipline`, {
        method: "POST",
        body: { body: body.trim(), matchId: match.id, ...(match.date ? { occurredOn: match.date } : {}) },
      });
      // Deliberately no re-read. An umpire holds discipline.write and not
      // discipline.read: the server told him it landed, and that is all he
      // is entitled to know about it now.
      setBody(""); setPlayerId(""); setDone(true); setOpen(false);
    } catch (e) {
      setSaid(refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ padding: "14px", marginTop: "12px" }} data-testid="incident-panel">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "space-between" }}>
        <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary }}>Conduct</div>
        {!open && (
          <Btn size="sm" variant="ghost" onClick={() => { setOpen(true); setDone(false); setSaid(null); }}
               data-testid="incident-open">Report an incident</Btn>
        )}
      </div>
      {done && (
        <div role="status" data-testid="incident-recorded"
             style={{ fontFamily: D.body, fontSize: "11px", color: D.emerald, marginTop: "6px" }}>
          Recorded — the school has it.
        </div>
      )}
      {open && (
        <div style={{ marginTop: "8px" }}>
          {who.loading ? (
            <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>Loading who played…</div>
          ) : who.error ? (
            <div role="alert" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose) }}>
              Could not load who played ({who.error}).
            </div>
          ) : (
            <>
              <div style={label()}>About</div>
              <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} aria-label="Who the report is about"
                      data-testid="incident-player" style={field()}>
                <option value="">{who.people.length ? "Choose a player…" : "Nobody on record for this fixture"}</option>
                {who.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {who.from === "log" && (
                <div style={{ fontFamily: D.body, fontSize: "10px", color: D.textMuted, marginTop: "4px", lineHeight: 1.4 }}>
                  Your appointment does not include the team sheet, so players are named by their part in
                  the ball log. Anyone not in it — a fielder, a substitute — report to the school directly.
                </div>
              )}
              <div style={{ ...label(), marginTop: "10px" }}>What happened</div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
                aria-label="What happened" data-testid="incident-body"
                placeholder="Your account, as you saw it."
                style={{ ...field(), resize: "vertical" }}/>
              <div style={{ fontFamily: D.body, fontSize: "10px", color: D.textMuted, marginTop: "4px" }}>
                Filed against this fixture{match.date ? `, dated ${match.date}` : ""}. Once sent, it is readable by the school and not by you.
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <Btn size="sm" disabled={busy} onClick={submit} data-testid="incident-submit">Send to the school</Btn>
                <Btn size="sm" variant="ghost" disabled={busy} onClick={() => { setOpen(false); setSaid(null); }}>Cancel</Btn>
              </div>
            </>
          )}
          <Refused said={said} testid="incident-refused"/>
        </div>
      )}
    </Card>
  );
}

export { ConductTab, ReportIncident, fromBallLog };

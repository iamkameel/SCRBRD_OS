/**
 * Who can play in the side's next fixture, and the one tap that answers again
 * (SCRBRD-122).
 *
 * Drawn on the Squad screen for anybody who holds availability.read: the
 * people picking the side see the side, and a guardian sees his own child and
 * nobody else, because the rows come from GET /api/read/availability under
 * the caller's own policy. Nothing here narrows or widens a row.
 *
 * The status is the server's EFFECTIVE one (db/65): an answer given before the
 * fixture's time, ground, format or overs changed reads "Needs reconfirming",
 * never what it said, with the line saying what it said and about what. Every
 * row can be answered from here by whoever may declare for that boy (the
 * insert policy decides, and a refusal is shown); a row asking again offers
 * the old answer back as one tap.
 */
import { useMemo, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { Badge, Btn, Card, Select } from "../ui/primitives.jsx";
import { useLive } from "../lib/live.js";
import { api } from "../lib/api.js";
import { humanDateTime } from "../lib/format.js";
import { holdsCapability } from "../rbac/index.js";

const ANSWERS = [["available", "Available"], ["doubtful", "Doubtful"], ["unavailable", "Unavailable"]];
// Read at render, never at import: the tokens follow the theme (design.test).
const stateOf = (status) => ({
  available:          { label: "Available",          color: D.emerald },
  doubtful:           { label: "Doubtful",           color: D.amber },
  unavailable:        { label: "Unavailable",        color: D.rose },
  needs_reconfirming: { label: "Needs reconfirming", color: D.amber },
}[status] ?? { label: "No answer", color: D.textMuted });
const word = (s) => (ANSWERS.find(([v]) => v === s)?.[1] ?? s ?? "").toLowerCase();

/** The side's coming fixtures, soonest first: the one list the panel and the player's own setter both draw from. */
function useUpcoming(role, team) {
  const { rows: matches } = useLive("matches", role);
  return useMemo(() => (matches ?? [])
    .filter((m) => m.homeTeam === team && m.status === "upcoming" && m.startsAt && new Date(m.startsAt) > new Date())
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))), [matches, team]);
}

/** The one write: a player's answer for a fixture. The server decides who may; a refusal comes back as an error. */
const declare = (matchId, playerId, status, reasonKind = null) =>
  api(`/api/matches/${matchId}/availability`, { method: "POST", body: { playerId, status, reasonKind } });

/**
 * @param {{ role: string, team: string }} props
 */
export function AvailabilityPanel({ role, team }) {
  const [picked, setPicked] = useState("");
  const upcoming = useUpcoming(role, team);
  const match = upcoming.find((m) => m.id === picked) ?? upcoming[0] ?? null;
  if (!holdsCapability(role, "availability.read") || !match) return null;
  // Keyed on the fixture, so another fixture starts from its own answers.
  return <AvailabilityList key={match.id} role={role} match={match} upcoming={upcoming} onPick={setPicked}/>;
}

/**
 * Set Availability on the Squad screen's player panel: ONE player, the side's
 * next fixture (or the one picked), the same three answers and the same route
 * as the panel above. The status drawn after a save is the server's, re-read.
 * Refusals are shown in the server's words, never swallowed.
 * @param {{ role: string, team: string, player: { id: string, name: string } }} props
 */
export function PlayerAvailability({ role, team, player }) {
  const [picked, setPicked] = useState("");
  const upcoming = useUpcoming(role, team);
  const match = upcoming.find((m) => m.id === picked) ?? upcoming[0] ?? null;
  if (!match) {
    return <p data-testid="set-availability-none" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: 0 }}>
      {team} has no coming fixture to answer for.
    </p>;
  }
  return <PlayerAnswer key={match.id + player.id} role={role} match={match} upcoming={upcoming} onPick={setPicked} player={player}/>;
}

function PlayerAnswer({ role, match, upcoming, onPick, player }) {
  const [nonce, setNonce] = useState(0);
  const [said, setSaid] = useState({ text: "", bad: false });
  const [busy, setBusy] = useState(false);
  const mayRead = holdsCapability(role, "availability.read");
  const { rows } = useLive("availability", role, nonce, { matchId: match.id });
  const mine = mayRead ? (rows ?? []).find((r) => r.playerId === player.id) ?? null : null;
  const st = stateOf(mine?.status);
  const answer = async (status) => {
    setBusy(true); setSaid({ text: "", bad: false });
    try {
      await declare(match.id, player.id, status);
      setNonce((n) => n + 1);
      setSaid({ text: `${player.name} is marked ${word(status)}.`, bad: false });
    } catch (e) {
      setSaid({ text: e.message || "Refused.", bad: true });
    } finally { setBusy(false); }
  };
  return (
    <div data-testid="set-availability" style={{ display: "grid", gap: "8px" }}>
      <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary }}>
        v {match.awayTeam} · {humanDateTime(match.date, match.time)}
      </div>
      {upcoming.length > 1 && (
        <Select label="Fixture" aria-label="Which fixture" value={match.id} onChange={onPick}
          options={upcoming.map((m) => ({ value: m.id, label: `v ${m.awayTeam} · ${humanDateTime(m.date, m.time)}` }))}/>
      )}
      {mayRead && <div><Badge color={st.color} data-testid="set-availability-state">{st.label}</Badge></div>}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {ANSWERS.map(([v, l]) => (
          <button key={v} type="button" className="pressBtn" disabled={busy} data-testid={`set-availability-${v}`}
            onClick={() => answer(v)} style={{ minHeight: "44px", padding: "8px 14px", borderRadius: D.pill, cursor: busy ? "wait" : "pointer",
              background: "transparent", border: `1px solid ${D.border}`, color: D.textPrimary, fontFamily: D.head, fontSize: "12px", fontWeight: 700 }}>
            {l}
          </button>
        ))}
      </div>
      {said.text && (
        <div role={said.bad ? "alert" : "status"} data-testid="set-availability-said"
          style={{ fontFamily: D.body, fontSize: "12px", color: said.bad ? textOn(D.rose) : D.textSecondary }}>{said.text}</div>
      )}
    </div>
  );
}

/** One fixture's answers, read for this caller alone. */
function AvailabilityList({ role, match, upcoming, onPick }) {
  const [nonce, setNonce] = useState(0);
  const [said, setSaid] = useState({ id: null, text: "" });
  const { rows: answers, loading } = useLive("availability", role, nonce, { matchId: match.id });
  const mayDeclare = holdsCapability(role, "availability.declare");
  const asking = answers.filter((r) => r.needsReconfirming).length;

  const answer = async (playerId, status, reasonKind = null) => {
    setSaid({ id: playerId, text: "" });
    try {
      await declare(match.id, playerId, status, reasonKind);
      setNonce((n) => n + 1);
    } catch (e) {
      setSaid({ id: playerId, text: e.message || "Refused." });
    }
  };

  return (
    <Card sx={{ padding: "14px 16px", marginBottom: "16px" }} data-testid="availability-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Availability
          </div>
          <div data-testid="availability-fixture" style={{ fontFamily: D.body, fontSize: "13px", color: D.textPrimary, marginTop: "4px" }}>
            v {match.awayTeam} · {answers[0]?.fixtureWords ?? humanDateTime(match.date, match.time)}
          </div>
        </div>
        {asking > 0 && (
          <Badge color={D.amber} data-testid="availability-asking">{asking} to answer again</Badge>
        )}
      </div>
      {upcoming.length > 1 && (
        <div style={{ marginTop: "10px", maxWidth: "360px" }}>
          <Select label="Fixture" aria-label="Which fixture" value={match.id} onChange={onPick}
            options={upcoming.map((m) => ({ value: m.id, label: `v ${m.awayTeam} · ${humanDateTime(m.date, m.time)}` }))}/>
        </div>
      )}
      {!loading && answers.length === 0 && (
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "10px" }}>No one to show for this fixture.</div>
      )}
      <div style={{ display: "grid", gap: "8px", marginTop: "12px" }}>
        {answers.map((r) => {
          const st = stateOf(r.status);
          return (
            <div key={r.playerId} data-testid={`availability-row-${r.playerId}`} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap",
              padding: "8px 10px", borderRadius: D.sm, background: D.surf2,
              border: `1px solid ${r.needsReconfirming ? D.amber + "55" : D.border}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600, color: D.textPrimary }}>{r.name}</span>
                  <Badge color={st.color} data-testid={`availability-state-${r.playerId}`}>{st.label}</Badge>
                </div>
                {r.needsReconfirming && r.wasLine && (
                  <div data-testid={`availability-was-${r.playerId}`} style={{ fontFamily: D.body, fontSize: "12px", color: textOn(D.amber), marginTop: "4px" }}>
                    The fixture has changed: {r.wasLine}.
                  </div>
                )}
                {r.status && !r.needsReconfirming && r.declaredByName && (
                  <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "4px" }}>
                    {r.selfDeclared ? "Said by him" : `Said by ${r.declaredByName}`}
                  </div>
                )}
                {said.id === r.playerId && said.text && (
                  <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: textOn(D.rose), marginTop: "4px" }}>{said.text}</div>
                )}
              </div>
              {mayDeclare && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {r.needsReconfirming && r.saidStatus && (
                    <Btn size="sm" data-testid={`availability-again-${r.playerId}`}
                      onClick={() => answer(r.playerId, r.saidStatus, r.reasonKind)}>
                      Still {word(r.saidStatus)}
                    </Btn>
                  )}
                  {ANSWERS.filter(([v]) => r.needsReconfirming || v !== r.status).map(([v, l]) => (
                    <Btn key={v} size="sm" variant="ghost" data-testid={`availability-set-${r.playerId}-${v}`}
                      onClick={() => answer(r.playerId, v)}>{l}</Btn>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

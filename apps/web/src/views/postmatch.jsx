import { useEffect, useMemo, useState } from "react";
import { D } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { deriveMatch, fmtOvers, fromRow, PHASE_LABELS, PHASE_NAMES } from "@scrbrd/scoring";
import { keyMoments, matchBestBatting, matchBestBowling } from "../lib/postMatchReport.js";
import { Badge, Modal } from "../ui/primitives.jsx";

/**
 * SCRBRD-082 — the Post-Match Report.
 *
 * Built entirely from what a signed-in reader already has: the same
 * `GET /matches/:id/events` ScorecardModal reads, folded by the same
 * `deriveMatch()`/`deriveInnings()` the live pad runs (packages/scoring), and
 * the same composed `/read/phases` AnalyticsView-adjacent screens already
 * consume (asPhases(), lib/live.js — "the phases read is COMPOSED on the
 * server by the same derivePhases() the scorer's device runs"). Nothing here
 * is a second implementation of a rule the fold already owns: a key moment,
 * a milestone-over or a "best figures" pick comes from
 * apps/web/src/lib/postMatchReport.js, which reads the fold's own output and
 * invents nothing beside it.
 *
 * NO MOCK FALLBACK, same rule as ScorecardModal: a signed-out session has no
 * ball_event rows to fetch for a real fixture, and this says so rather than
 * reconstructing one.
 *
 * PRINT-FRIENDLY: the whole report sits inside one `.os-print-area` (see
 * design/tokens.js's `@media print` block) so a school can print exactly this
 * page — headed paper, no navigation, no button chrome — without a separate
 * print view to keep in sync with the screen one.
 */
function PostMatchReport({ match, role, onClose, onNavProfile }) {
  const [replay, setReplay] = useState({ loading: true, error: null, innings: null, result: null });

  useEffect(() => {
    if (!signedIn()) { setReplay({ loading: false, error: null, innings: [], result: null }); return; }
    let cancelled = false;
    setReplay((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const { events: rows } = await api(`/api/matches/${match.id}/events`);
        if (cancelled) return;
        const evs = (rows || []).map(fromRow);
        const { innings, result } = deriveMatch(evs);
        setReplay({ loading: false, error: null, innings, result });
      } catch (e) {
        if (!cancelled) setReplay({ loading: false, error: e.code || "unreachable", innings: null, result: null });
      }
    })();
    return () => { cancelled = true; };
  }, [match.id]);

  // The server's own phase breakdown — never recomputed here. See the
  // comment on asPhases() in lib/live.js for why this is nearly an identity:
  // renaming any of it in a second place is exactly the drift the shared
  // package exists to prevent.
  const phasesState = useLive("phases", role, 0, { matchId: match.id });

  // Memoized rather than `replay.innings ?? []` inline: a fresh `[]` literal
  // every render would make every hook below think its input changed, on
  // every render, forever.
  const innings = useMemo(() => replay.innings ?? [], [replay.innings]);
  const moments = useMemo(() => keyMoments(innings), [innings]);
  const bestBat = useMemo(() => matchBestBatting(innings), [innings]);
  const bestBowl = useMemo(() => matchBestBowling(innings), [innings]);

  if (replay.loading) return (
    <Modal title="Post-Match Report" onClose={onClose} width="880px">
      <div style={{ textAlign: "center", padding: "40px 0", color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>Building the report…</div>
    </Modal>
  );
  if (replay.error) return (
    <Modal title="Post-Match Report" onClose={onClose} width="880px">
      <div style={{ textAlign: "center", padding: "40px 0", color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>Could not build the report ({replay.error}).</div>
    </Modal>
  );
  if (!signedIn()) return (
    <Modal title="Post-Match Report" onClose={onClose} width="880px">
      <div style={{ textAlign: "center", padding: "40px 0", color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>Sign in to see the post-match report — it is derived from live match data, and a demo has none.</div>
    </Modal>
  );
  if (innings.length === 0) return (
    <Modal title="Post-Match Report" onClose={onClose} width="880px">
      <div style={{ textAlign: "center", padding: "40px 0", color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>Nothing has been scored for this fixture yet.</div>
    </Modal>
  );

  const resultLine = describeResult(replay.result);

  return (
    <Modal title="Post-Match Report" onClose={onClose} width="880px">
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginBottom: "10px" }} className="os-print-hide">
        <button onClick={() => window.print()} className="pressBtn" data-testid="pmr-print"
          style={{ padding: "6px 14px", borderRadius: D.pill, border: `1px solid ${D.borderMed}`, background: D.surf2, color: D.textPrimary, fontFamily: D.head, fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer" }}>
          🖨 Print
        </button>
      </div>

      <div className="os-print-area" data-testid="post-match-report">
        <div style={{ textAlign: "center", marginBottom: "16px" }}>
          <div style={{ fontFamily: D.head, fontSize: "17px", fontWeight: 800, color: D.textPrimary }}>
            {match.homeTeam} <span style={{ color: D.textMuted, fontSize: "12px" }}>vs</span> {match.awayTeam}
          </div>
          <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginTop: "2px" }}>
            {match.date}{match.venue ? ` · ${match.venue}` : ""}
          </div>
          <div style={{ marginTop: "8px" }}>
            {resultLine
              ? <Badge color={D.amber} data-testid="pmr-result">{resultLine}</Badge>
              : <span data-testid="pmr-result-pending" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>Result not yet decided</span>}
          </div>
        </div>

        {(bestBat || bestBowl) && (
          <Section title="Best performances">
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {bestBat && <FigureCard label="Best batting" color={D.emerald}
                value={`${bestBat.runs} (${bestBat.balls})`}
                sub={`${bestBat.name}${bestBat.balls ? ` · SR ${((bestBat.runs / bestBat.balls) * 100).toFixed(1)}` : ""}`}
                onClick={onNavProfile && bestBat.id ? () => onNavProfile(bestBat.id) : null} />}
              {bestBowl && <FigureCard label="Best bowling" color={D.rose}
                value={`${bestBowl.wickets}/${bestBowl.runs}`}
                sub={`${bestBowl.name} · ${fmtOvers(bestBowl.balls)} ov`}
                onClick={onNavProfile && bestBowl.id ? () => onNavProfile(bestBowl.id) : null} />}
            </div>
          </Section>
        )}

        {moments.length > 0 && (
          <Section title="Key moments">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }} data-testid="pmr-key-moments">
              {moments.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", alignItems: "baseline", fontFamily: D.body, fontSize: "12px", color: D.textSecondary }}>
                  <span style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, minWidth: "56px" }}>
                    {innings.length > 1 ? `Inn ${m.innings + 1}` : ""}{m.over ? ` · ov ${m.over}` : ""}
                  </span>
                  <span>{momentIcon(m.kind)} {m.label}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {innings.map((inn, i) => (
          <InningsCard key={i} inn={inn} index={i} onNavProfile={onNavProfile} />
        ))}

        {phasesState.rows.map((p) => (
          <PhaseCard key={p.innings} phases={p.phases} inningsNum={p.innings} inningsLabel={`Innings ${p.innings}`} />
        ))}
        {phasesState.error && (
          <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginTop: "8px" }}>
            Phase breakdown unavailable ({phasesState.error}).
          </div>
        )}
      </div>
    </Modal>
  );
}

/** `deriveMatch()`'s own result — never a second guess at a winner. */
function describeResult(result) {
  if (!result) return null;
  if (!result.winner) return `Match tied${result.margin && result.margin !== "tie" ? ` (${result.margin})` : ""}`;
  return `${result.winner} won by ${result.margin}`;
}

const momentIcon = (kind) => ({ wicket: "🎯", fifty: "5️⃣0️⃣", hundred: "💯", "five-for": "🏆" })[kind] ?? "•";

function Section({ title, children }) {
  return (
    <div style={{ marginTop: "18px" }}>
      <div style={{ fontFamily: D.head, fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: D.textMuted, marginBottom: "8px" }}>{title}</div>
      {children}
    </div>
  );
}

function FigureCard({ label, value, sub, color, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick ?? undefined} className={onClick ? "pressBtn" : undefined}
      style={{ flex: 1, minWidth: "180px", textAlign: onClick ? "left" : "center", cursor: onClick ? "pointer" : "default",
        background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.lg, padding: "12px 14px" }}>
      <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: D.textMuted }}>{label}</div>
      <div style={{ fontFamily: D.mono, fontSize: "20px", fontWeight: 700, color: color ?? D.textPrimary, marginTop: "4px" }}>{value}</div>
      <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary, marginTop: "2px" }}>{sub}</div>
    </Tag>
  );
}

function InningsCard({ inn, index, onNavProfile }) {
  const extrasSum = Object.values(inn.extras ?? {}).reduce((a, b) => a + b, 0);
  return (
    <Section title={`Innings ${index + 1}${inn.battingTeam ? ` — ${inn.battingTeam}` : ""}`}>
      <div style={{ fontFamily: D.mono, fontSize: "15px", fontWeight: 700, color: D.textPrimary, marginBottom: "10px" }}>
        {inn.runs}/{inn.wickets} <span style={{ fontSize: "11px", color: D.textMuted, fontWeight: 400 }}>({fmtOvers(inn.balls)} ov{inn.complete ? "" : ", in progress"})</span>
      </div>

      <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: D.textMuted, margin: "10px 0 4px" }}>Batting</div>
      {inn.batsmen?.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }} data-testid={`pmr-batting-${index}`}>
          <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>
            {["Batter", "R", "B", "4s", "6s", "SR", ""].map((h) => (
              <th key={h} style={{ textAlign: h === "Batter" || h === "" ? "left" : "right", padding: "4px 6px", fontFamily: D.head, fontSize: "9px", color: D.textMuted }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {inn.batsmen.map((b) => (
              <tr key={b.id} style={{ borderBottom: `1px solid ${D.border}` }}>
                <td style={{ padding: "4px 6px", color: D.textPrimary }}>
                  {onNavProfile && b.id ? <button onClick={() => onNavProfile(b.id)} className="pressBtn" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: D.sky, fontFamily: D.body, fontSize: "11px" }}>{b.name}</button> : b.name}
                </td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{b.runs}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{b.balls}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{b.fours}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{b.sixes}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{b.balls ? ((b.runs / b.balls) * 100).toFixed(1) : "—"}</td>
                <td style={{ padding: "4px 6px", color: D.textMuted, fontSize: "10px" }}>{b.status === "out" ? b.dismissal : "not out"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>No batting figures recorded for this innings.</div>
      )}
      <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary, marginTop: "6px" }}>Extras {extrasSum}</div>

      <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: D.textMuted, margin: "12px 0 4px" }}>Bowling</div>
      {inn.bowlers?.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }} data-testid={`pmr-bowling-${index}`}>
          <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>
            {["Bowler", "O", "M", "R", "W", "Econ"].map((h) => (
              <th key={h} style={{ textAlign: h === "Bowler" ? "left" : "right", padding: "4px 6px", fontFamily: D.head, fontSize: "9px", color: D.textMuted }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {inn.bowlers.map((bw) => (
              <tr key={bw.id} style={{ borderBottom: `1px solid ${D.border}` }}>
                <td style={{ padding: "4px 6px", color: D.textPrimary }}>{bw.name}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{fmtOvers(bw.balls)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{bw.maidens}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{bw.runs}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{bw.wickets}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{(bw.runs / Math.max(1, bw.balls / 6)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>No bowling figures recorded for this innings.</div>
      )}

      {inn.fow?.length > 0 && (
        <>
          <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: D.textMuted, margin: "12px 0 4px" }}>Fall of wickets</div>
          <div style={{ fontFamily: D.mono, fontSize: "11px", color: D.textSecondary, lineHeight: 1.8 }} data-testid={`pmr-fow-${index}`}>
            {inn.fow.map((f, i) => <span key={i}>{i > 0 && "  ·  "}{f.runs}/{f.wickets} ({f.batsman}, {f.overs})</span>)}
          </div>
        </>
      )}

      {inn.partnerships?.length > 0 && (
        <>
          <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: D.textMuted, margin: "12px 0 4px" }}>Partnerships</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }} data-testid={`pmr-partnerships-${index}`}>
            {inn.partnerships.map((p, i) => (
              <div key={i} style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>
                {p.wicket ? `${p.wicket}${ordinal(p.wicket)} wkt` : "unbroken"}: {p.bat1} &amp; {p.bat2} — {p.runs} ({fmtOvers(p.balls)} ov)
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

/** 1st, 2nd, 3rd, 4th… the ordinary English rule, teens excepted. */
const ordinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
};

function PhaseCard({ phases, inningsNum, inningsLabel }) {
  if (!phases) return null;
  return (
    <Section title={`${inningsLabel} — phase breakdown`}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }} data-testid={`pmr-phases-${inningsNum}`}>
        <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>
          {["Phase", "Overs", "Runs", "Wkts", "Run rate", "vs par"].map((h) => (
            <th key={h} style={{ textAlign: h === "Phase" ? "left" : "right", padding: "4px 6px", fontFamily: D.head, fontSize: "9px", color: D.textMuted }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {PHASE_NAMES.map((name) => {
            const p = phases[name];
            if (!p?.played) return null;
            return (
              <tr key={name} style={{ borderBottom: `1px solid ${D.border}` }}>
                <td style={{ padding: "4px 6px", color: D.textPrimary }}>{PHASE_LABELS[name]}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{p.overs}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{p.runs}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{p.wickets}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono }}>{p.runRate ?? "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: D.mono, color: p.vsPar == null ? D.textMuted : p.vsPar >= 0 ? D.emerald : D.rose }}>
                  {p.vsPar == null ? "—" : `${p.vsPar >= 0 ? "+" : ""}${p.vsPar}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

export { PostMatchReport };

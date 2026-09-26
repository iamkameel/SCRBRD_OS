import { useMemo, useState } from "react";
import { D, textOn, themed } from "../design/tokens.js";
import { useLive } from "../lib/live.js";
import { Badge, EmptyState, Modal } from "../ui/primitives.jsx";
import { Metric, MetricGroup, dash } from "../ui/data.jsx";

// ══════════════════════════════════════════════════════
//  THE OPPOSITION DOSSIER
//
//  The one deliberate crossing of the tenant line, and the only screen in
//  SCRBRD that draws another school's children. Everything it is allowed to
//  say has already been decided before a row reaches here: two SECURITY
//  DEFINER functions in db/08 check that this reader holds opposition.read at
//  THEIR side of this exact fixture, that the fixture is a head-to-head
//  between two tenants, and that the window before it is open — five days
//  since db/46 (SCRBRD-091), stated here only as the server reports it.
//  No standing means no rows — not a refusal with a reason, because a reason
//  would confirm the fixture exists.
//
//  So this file decides nothing. What it must do instead is REPORT HONESTLY,
//  and there are three distinct ways a dossier can be empty which a screen
//  has no business blurring together:
//
//    no rows at all     — you have no standing here. Say nothing about why.
//    a row, open false  — there IS a dossier and it is not available yet, or
//                         any more, or at all. `reason` says which, and every
//                         one of them is useful to a coach.
//    a row, open true,
//    figures null       — the player exists and the log is too thin to speak
//                         for him. The evidence label says so and an em dash
//                         stands where a number would mislead.
//
//  The last is the one a dashboard usually gets wrong. A strike rate off
//  eleven balls is a coin toss with decimals, so opposition_squad withholds
//  it below thirty and hands over `battingEvidence` instead. Rendering 0.0,
//  or hiding the row, would both be a lie — one invents a figure, the other
//  hides a boy the coach is about to face.
//
//  Every squad read here is written to access_log against the OTHER school —
//  the school whose children were read — with the ids of every boy in it. A
//  parent there asking "who has looked at my son's record" gets an answer
//  naming the reader, the fixture and the day. That is the price of this
//  screen existing and it is charged on open, not on some later action.
// ══════════════════════════════════════════════════════

/** Why there is no dossier, in words a coach can act on. */
const REASON = {
  feature_off: {
    title: "Opposition intelligence is switched off for your school",
    body: "It discloses another school's pupils to yours, so it is granted per school by the platform rather than assumed. Ask your director of sport to request it.",
  },
  opponent_not_on_scrbrd: {
    title: "This opponent is not on SCRBRD",
    body: "A dossier is built from their own ball log. A school that does not keep one here has nothing to read, and nothing is inferred from our side's scorecards in its place.",
  },
  not_yet_open: {
    title: "The window has not opened yet",
    body: (head) => `A dossier opens ${windowLength(head)} before the first ball. Until then it is a standing file on other people's children, which is not what this is for.`,
  },
  fixture_started: {
    title: "The window has closed",
    body: "It closes at the first ball. What happened after that is on the scorecard, where both sides can see the same thing.",
  },
};

const EVIDENCE = themed(() => ({
  none:         { label: "no log",   tone: D.textMuted },
  insufficient: { label: "too thin", tone: D.textMuted },
  low:          { label: "thin",     tone: D.amber },
  moderate:     { label: "fair",     tone: D.sky },
  high:         { label: "strong",   tone: D.emerald },
}));

/**
 * How long before the first ball the window opens, from the two ends the
 * server sent rather than a number of this file's own: the length is
 * opposition_window_days() (db/46), and a copy here is a copy that drifts.
 * Rounded, because a day across a clock change is not 86 400 000 ms.
 */
function windowLength(head) {
  const days = Math.round((Date.parse(head?.closesAt) - Date.parse(head?.opensAt)) / 86400000);
  return Number.isFinite(days) && days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "a set time";
}

const day = (t) => (t ? new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—");
const dayTime = (t) => (t ? new Date(t).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const TH = ({ children, right }) => (
  <th style={{ textAlign: right ? "right" : "left", padding: "6px 8px", fontFamily: D.head, fontSize: "9px",
               fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: D.textMuted,
               borderBottom: `1px solid ${D.borderMed}`, whiteSpace: "nowrap" }}>{children}</th>
);
const TD = ({ children, right, tone, mono }) => (
  <td style={{ textAlign: right ? "right" : "left", padding: "7px 8px", fontFamily: mono ? D.mono : D.body,
               fontSize: "12px", color: tone ?? D.textSecondary, borderBottom: `1px solid ${D.border}`,
               whiteSpace: "nowrap" }}>{children}</td>
);

/** A figure the server withheld, with the reason beside it rather than a zero. */
function Withheld({ evidence }) {
  const e = EVIDENCE[evidence] ?? EVIDENCE.none;
  return (
    <span title={`Withheld: ${e.label}`}>
      <span style={{ color: D.textMuted }}>—</span>
      <span style={{ fontFamily: D.body, fontSize: "10px", color: e.tone, marginLeft: "5px" }}>{e.label}</span>
    </span>
  );
}

function EvidencePill({ evidence }) {
  const e = EVIDENCE[evidence] ?? EVIDENCE.none;
  return <span style={{ fontFamily: D.body, fontSize: "10px", color: e.tone }}>{e.label}</span>;
}

/**
 * The dossier for one fixture.
 *
 * `match` is the row Match Centre already has; only its id is sent to the
 * server, because the server is the one deciding what this fixture is.
 */
function OppositionDossier({ match, role, onClose }) {
  const [sort, setSort] = useState("batting");
  const ctx = useLive("opposition_context", role, 0, { matchId: match.id });
  const squad = useLive("opposition_squad", role, 0, { matchId: match.id });
  const head = ctx.rows[0] ?? null;

  const rows = useMemo(() => {
    const r = [...squad.rows];
    if (sort === "bowling") {
      // Wickets, then the tighter economy — and a bowler with no log last
      // rather than first, which is what a null economy would otherwise sort as.
      return r.sort((a, b) => (b.bowling.wickets - a.bowling.wickets)
        || ((a.bowling.economy ?? 99) - (b.bowling.economy ?? 99))
        || a.name.localeCompare(b.name));
    }
    if (sort === "name") return r.sort((a, b) => a.name.localeCompare(b.name));
    return r.sort((a, b) => (b.batting.runs - a.batting.runs) || a.name.localeCompare(b.name));
  }, [squad.rows, sort]);

  const title = head?.theirLabel ? `Dossier — ${head.theirLabel}` : "Dossier";

  return (
    <Modal title={title} onClose={onClose} width="860px">
      <div data-testid="dossier">
        {ctx.loading && !head && <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>Reading…</div>}

        {/* No standing. Nothing about the fixture, the opponent, or why. */}
        {!ctx.loading && !head && (
          <div data-testid="dossier-none">
            <EmptyState icon="lock" message="No dossier for you on this fixture."/>
            <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, textAlign: "center", maxWidth: "460px", margin: "0 auto", lineHeight: 1.6 }}>
              A dossier is for the coaching staff of the side actually playing, inside the window before the match.
            </div>
          </div>
        )}

        {/* A dossier exists and is shut. Every reason is worth reading. */}
        {head && !head.open && (() => {
          const r = REASON[head.reason] ?? { title: "No dossier is available", body: "" };
          return (
            <div data-testid={`dossier-shut-${head.reason}`}>
              <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary, marginBottom: "6px" }}>{r.title}</div>
              <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.6, maxWidth: "560px" }}>{typeof r.body === "function" ? r.body(head) : r.body}</div>
              {head.reason === "not_yet_open" && head.opensAt && (
                <div style={{ fontFamily: D.mono, fontSize: "12px", color: D.sky, marginTop: "12px" }}>Opens {dayTime(head.opensAt)}</div>
              )}
              <div style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, marginTop: "14px" }}>
                {/* Deliberately no counts here: a shut window that said how
                    much there WOULD be to read has disclosed it. The server
                    returns null for both and this says nothing in their place. */}
                You are the {head.mySide} side.
              </div>
            </div>
          );
        })()}

        {head && head.open && (
          <>
            <MetricGroup min={120} sx={{ marginBottom: "16px" }}>
              <Metric label="Their side" value={head.theirTeam ?? "—"} sub={head.theirLabel} size="sm"/>
              <Metric label="Games read" value={dash(head.gamesAnalysed)} sub="their own fixtures" size="sm"/>
              <Metric label="Deliveries" value={dash(head.deliveriesAnalysed)} sub="in the log" size="sm"/>
              <Metric label="Window shuts" value={day(head.closesAt)} sub="at the first ball" size="sm"/>
              <Metric label="As at" value={dayTime(head.dataCutoff)} sub="read just now" size="sm"/>
            </MetricGroup>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
              <div style={{ fontFamily: D.head, fontSize: "11px", fontWeight: 700, color: D.textPrimary }}>
                Their squad <span style={{ color: D.textMuted }}>({squad.rows.length})</span>
              </div>
              <span style={{ flex: 1 }}/>
              <div role="group" aria-label="Sort the squad" style={{ display: "flex", gap: "5px" }}>
                {[["batting", "Runs"], ["bowling", "Wickets"], ["name", "Name"]].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}
                          data-testid={`dossier-sort-${k}`}
                          style={{ padding: "4px 10px", borderRadius: D.pill, cursor: "pointer",
                                   border: `1px solid ${sort === k ? D.sky : D.border}`, background: "transparent",
                                   fontFamily: D.mono, fontSize: "10px", color: sort === k ? D.textPrimary : D.textMuted }}>{l}</button>
                ))}
              </div>
            </div>

            {squad.rows.length === 0 ? (
              <EmptyState icon="users" message="Their side is not named yet — the window is open, and this school has no roster recorded for that team."/>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="dossier-squad">
                  <thead>
                    <tr>
                      <TH>Player</TH><TH>Role</TH>
                      <TH right>Inns</TH><TH right>Runs</TH><TH right>Balls</TH><TH right>SR</TH><TH right>Dot %</TH><TH>Bat evidence</TH>
                      <TH right>Overs</TH><TH right>Wkts</TH><TH right>Econ</TH><TH>Bowl evidence</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.playerId} data-testid={`dossier-player-${p.playerId}`}>
                        <TD tone={D.textPrimary}>
                          {p.name}
                          <div style={{ fontFamily: D.mono, fontSize: "9px", color: D.textMuted }}>
                            {[p.battingStyle, p.bowlingStyle].filter(Boolean).join(" · ") || "style not recorded"}
                          </div>
                        </TD>
                        <TD>{p.role ?? "—"}</TD>
                        <TD right mono>{p.batting.innings}</TD>
                        <TD right mono tone={D.textPrimary}>{p.batting.runs}</TD>
                        <TD right mono>{p.batting.balls}</TD>
                        <TD right mono>{p.batting.strikeRate == null ? <Withheld evidence={p.batting.evidence}/> : p.batting.strikeRate.toFixed(1)}</TD>
                        <TD right mono>{p.batting.dotPct == null ? <Withheld evidence={p.batting.evidence}/> : p.batting.dotPct.toFixed(1)}</TD>
                        <TD><EvidencePill evidence={p.batting.evidence}/></TD>
                        <TD right mono>{Math.floor(p.bowling.balls / 6)}.{p.bowling.balls % 6}</TD>
                        <TD right mono tone={p.bowling.wickets ? D.textPrimary : undefined}>{p.bowling.wickets}</TD>
                        <TD right mono>{p.bowling.economy == null ? <Withheld evidence={p.bowling.evidence}/> : p.bowling.economy.toFixed(2)}</TD>
                        <TD><EvidencePill evidence={p.bowling.evidence}/></TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: "14px", padding: "10px 12px", borderRadius: D.md,
                          border: `1px solid ${D.border}`, background: D.surf2 }}>
              <div style={{ fontFamily: D.head, fontSize: "10px", fontWeight: 700, letterSpacing: ".08em",
                            color: D.textMuted, textTransform: "uppercase", marginBottom: "5px" }}>What this is, and what it is not</div>
              <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary, lineHeight: 1.6 }}>
                Cricket columns only: what the ball log says about how each boy has batted and bowled, across their own
                fixtures. Nothing about a child's person is here and none of it is available — not a date of birth, not a
                guardian, not a note, not a fitness state. A figure withheld is withheld because the log is too thin to
                carry it, and the label beside it says which.
                {" "}This read is on the record: every name above is written to {head.theirLabel ?? "the other school"}&rsquo;s
                access log against this fixture, with your name on it.
              </div>
            </div>
          </>
        )}

        {/* The feature being off arrives as a 403 the read layer translates,
            so it can be true with no context row at all. Said once, here. */}
        {(ctx.disabled || squad.disabled) && !head && (
          <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, marginTop: "10px" }}
               data-testid="dossier-feature-off">
            <Badge color={D.amber}>switched off</Badge>{" "}
            {REASON.feature_off.body}
          </div>
        )}

        {ctx.error && (
          <div style={{ fontFamily: D.body, fontSize: "12px", color: textOn(D.rose), marginTop: "10px" }}>
            The dossier could not be read ({ctx.error}).
          </div>
        )}
      </div>
    </Modal>
  );
}

export { OppositionDossier };

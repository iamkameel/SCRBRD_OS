/**
 * THE PUPIL'S SKILLS HISTORY (GA-I26a §7.3, AH-D3): his own strip for each
 * skill, his targets with the drill for each, and "since the last look". His
 * and nobody's: it is handed his own record and asks for nobody else's, so a
 * team-mate's scores are never requested, never drawn and never logged
 * against the team-mate (READERS_child_data.md §3 H: the pupil reads his own
 * scores, never a team-mate's).
 *
 * The words are "your coach", never a name. What a coach writes for other
 * coaches (the "Why" behind a target, a coaching point on a score, a note) is
 * not read here, not asked for and has no place on the screen; nor is any way
 * to write, withdraw or set anything. No direction is said as a word.
 *
 * It is opened from Me. It is a screen of its own so the staff Skills screen,
 * with its list of the side, is not what a pupil is handed.
 */
import { useEffect, useRef, useState } from "react";
import { D, T } from "../../design/tokens.js";
import { TREE } from "@scrbrd/scoring";
import { useBoyRead } from "../../lib/live.js";
import { holdsForPlayer } from "../../lib/held.js";
import { readState } from "../../lib/readState.js";
import { ReadState } from "../../ui/primitives.jsx";
import { pointsFor, standingPoint, openTargetOn, metricWords } from "../../lib/assessmentHistory.js";
import { Action, Card, Line, Page, Title } from "./parts.jsx";
import { Strip, TargetLine, DotSheet, SincePanel } from "../skills/History.jsx";

/** The 1-20 scale's bands, as colour only (the strip's newest dot); no band word is written. */
const colourFor = (v) => (v >= 16 ? D.emerald : v >= 11 ? D.sky : v >= 6 ? D.amber : D.rose);
const CATEGORY_WORDS = { technical: "Technical", mental: "Mental", tactical: "Tactical", physical: "Physical" };

/**
 * @param {{ role: string, me: { id: string, name: string, team: string }, onBack: () => void }} props
 */
export function PupilSkills({ role, me, onBack }) {
  const [nonce, setNonce] = useState(0);
  const [openDot, setOpenDot] = useState(null);
  const head = useRef(null);
  useEffect(() => { head.current?.focus(); }, []);
  // Held for HIM: the own-record assignment names him alone, so this asks for
  // him and for no other id, ever.
  const may = holdsForPlayer(role, "player.development.read", me.id);
  const hist = useBoyRead("skills_history", role, me.id, nonce, may);
  const targets = useBoyRead("targets", role, me.id, nonce, may);
  const since = useBoyRead("development_since", role, me.id, nonce, may);
  const retry = () => setNonce((n) => n + 1);

  const cats = Object.keys(TREE).filter((c) => hist.rows.some((r) => r.category === c));
  const histState = readState(hist, { what: "your skills history" });
  const failed = [["your skills history", hist], ["your targets", targets], ["what has happened since the last look", since]]
    .filter(([what, r]) => readState(r, { what }).state === "failed");

  return (
    <Page testid="pupil-skills">
      <div ref={head} tabIndex={-1} style={{ outline: "none", display: "grid", gap: T.space.sm }}>
        <Title>Your skills</Title>
        <div><Action testid="pupil-skills-back" onClick={onBack}>Back to Me</Action></div>
      </div>
      {!may ? (
        <Card><Line quiet>Your skills are not open to this account.</Line></Card>
      ) : (
        <>
          {failed.map(([what, r]) => (
            <Card key={what} label={null}><ReadState compact testId="pupil-skills-read-state" read={readState(r, { what })} onRetry={retry}/></Card>
          ))}
          {hist.rows.length === 0 ? (
            <Card testid="pupil-skills-none">
              {histState.state === "failed" ? null
                : histState.state === "loading" ? <Line quiet>Reading your skills…</Line>
                : <Line quiet>Your coach has not rated you yet.</Line>}
            </Card>
          ) : (
            <>
              <SincePanel rows={since.rows} history={hist.rows} player={me} staff={false} self/>
              {cats.map((c) => (
                <Card key={c} label={CATEGORY_WORDS[c] ?? c} testid={`pupil-skills-${c}`}>
                  {TREE[c].map((m) => {
                    const pts = pointsFor(hist.rows, c, m);
                    if (!pts.length) return null;
                    const stands = standingPoint(pts);
                    const tgt = openTargetOn(targets.rows, c, m);
                    return (
                      <div key={m} data-testid={`history-${c}-${m}`} style={{ paddingBottom: T.space.sm }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: T.space.sm }}>
                          <span style={{ ...T.role.body, color: T.content.primary, textTransform: "capitalize" }}>{metricWords(m)}</span>
                          <span style={{ ...T.role.label, color: T.content.secondary }}>{stands ? `${stands.score} out of 20` : "withdrawn"}</span>
                        </div>
                        <Strip points={pts} staff={false} color={stands ? colourFor(stands.score) : D.textMuted} target={tgt}
                          label={metricWords(m)} onOpen={setOpenDot}/>
                        {tgt && <TargetLine target={tgt}/>}
                      </div>
                    );
                  })}
                </Card>
              ))}
            </>
          )}
        </>
      )}
      {openDot && <DotSheet point={openDot} staff={false} canWrite={false} points={[]} onClose={() => setOpenDot(null)} onDone={() => setOpenDot(null)}/>}
    </Page>
  );
}

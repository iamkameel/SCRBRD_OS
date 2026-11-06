/**
 * SCHOOL RECORD BOARDS — one side's records, as a pavilion board shows them
 * (RECOGNITION R9; docs/design/RECOGNITION_design.md D22–D25, §7).
 *
 * Read from `record_boards` (db/143 record_board()), which derives every
 * board from the log on each read, anchored on the side the performance was
 * for (D22). What a reader sees is the server's decision, not this file's:
 *   - staff (reader_view 'full'): each board's holder, joint and former
 *     holders, and this season's list ordered by the metric, with its
 *     minimum stated (D22, Q9);
 *   - a pupil ('chronology'): the holder and the former holders only — the
 *     read carries no season list for him, so nothing here can draw an
 *     ordered list of his team-mates (D23);
 *   - a family, another school, the public: no rows, and no board is drawn.
 * School Records is the headline group, Friendly Records under the filter
 * (D24). Every state is a word beside its icon, never a colour alone; the
 * boards do not move.
 */
import { useState } from "react";
import { T } from "../design/tokens.js";
import { useLive } from "../lib/live.js";
import { Icon } from "../ui/icons.jsx";
import { Action, Card, Line, NoneOr } from "./family/parts.jsx";
import {
  GROUPS, NO_BOARDS, boardEmptyWords, boardTitle, boardsOf, coverageWords, figureOf, groupLabel, groupsHeld,
  metricLabel, viewOf, whereWords,
} from "../lib/records.js";

/**
 * @param {{ role: string, school: string | null, side: string | null, testid?: string }} p
 */
export function RecordBoards({ role, school, side, testid = "record-boards" }) {
  const [nonce, setNonce] = useState(0);
  const [group, setGroup] = useState(GROUPS[0].id);
  const read = useLive("record_boards", role, nonce, school && side ? { schoolId: school, teamCode: side } : null);
  if (!school || !side) return null;
  return <RecordBoardsView rows={read.rows} read={read} side={side} group={group} onGroup={setGroup} testid={testid}
    onRetry={() => setNonce((n) => n + 1)}/>;
}

/** The card itself, from rows already read (also what the unit test renders). */
export function RecordBoardsView({ rows, read, side, group, onGroup, testid = "record-boards", onRetry }) {
  const held = groupsHeld(rows);
  const boards = boardsOf(rows, group);
  const full = viewOf(rows) === "full";
  const showFilter = held.some((g) => g !== GROUPS[0].id);
  return (
    <Card label={`Records · ${side}`} testid={testid}>
      {showFilter && (
        <div role="group" aria-label="Which records" data-testid={`${testid}-filter`} style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
          {GROUPS.filter((g) => held.includes(g.id) || g.id === GROUPS[0].id).map((g) => (
            <Action key={g.id} testid={`${testid}-group-${g.id}`} pressed={group === g.id} onClick={() => onGroup?.(g.id)}
              style={{ fontWeight: group === g.id ? 600 : 500 }}>
              {group === g.id && <Icon name="circle-check"/>}{g.label}
            </Action>
          ))}
        </div>
      )}
      {boards.length === 0 && (read
        ? <NoneOr read={read} what="the record boards" none={held.length ? `No ${groupLabel(group)} yet.` : NO_BOARDS}
            onRetry={onRetry} testid={`${testid}-none`}/>
        : <Line quiet testid={`${testid}-none`}>{NO_BOARDS}</Line>)}
      {boards.map((b) => <Board key={`${b.metric}-${b.format}`} b={b} side={side} group={group} full={full} testid={testid}/>)}
    </Card>
  );
}

// Quiet lines: body type, secondary ink (no uppercase label for a sentence).
// Functions, not constants: a token is read at render, never at import (the
// theme can change under a module that is already loaded).
const smallStyle = () => ({ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0 });
const bodyStyle = () => ({ ...T.role.body, color: T.content.primary, margin: 0 });

function Board({ b, side, group, full, testid }) {
  const empty = boardEmptyWords(b);
  const id = `${testid}-${b.metric}-${b.format}`.replace(/\s+/g, "");
  return (
    <section data-testid={`${testid}-board`} data-metric={b.metric} data-format={b.format} data-state={b.state}
      aria-labelledby={`${id}-title`}
      style={{ display: "grid", gap: T.space.xs, paddingTop: T.space.sm, borderTop: `1px solid ${T.line.normal}` }}>
      <h3 id={`${id}-title`} style={{ ...T.role.body, color: T.content.primary, margin: 0, fontWeight: 600 }}>
        {boardTitle(b, side, group)}
      </h3>
      {empty && (
        <p style={{ ...bodyStyle(), color: T.content.secondary }} data-testid={`${testid}-empty`}>
          <Icon name="hourglass"/> {empty}
        </p>
      )}
      {b.holders.map((h) => (
        <p key={`h-${h.matchId}-${h.playerId}-${h.innings}`} style={bodyStyle()} data-testid={`${testid}-holder`}>
          <Icon name="trophy"/> <span style={{ fontWeight: 600 }}>{b.holders.length > 1 ? "Joint holder" : "Holder"}</span>{" · "}
          <span style={{ ...T.role.figure.sm, fontWeight: 600, color: T.content.primary }}>{figureOf(h)}</span> {h.name} {whereWords(h)}
          {h.equalled && <span style={{ color: T.content.secondary }}> · equalled</span>}
        </p>
      ))}
      {b.formers.map((f) => (
        <p key={`f-${f.matchId}-${f.playerId}-${f.innings}`} style={{ ...bodyStyle(), color: T.content.secondary }} data-testid={`${testid}-former`}>
          <Icon name="rotate-ccw"/> Formerly {figureOf(f)} {f.name} {whereWords(f)}
        </p>
      ))}
      {b.awaiting > 0 && b.state !== "awaiting" && (
        <p style={{ ...smallStyle() }} data-testid={`${testid}-awaiting`}>
          Awaiting verification: {b.awaiting} {b.awaiting === 1 ? "match" : "matches"} the scorer has not sealed yet.
        </p>
      )}
      <p style={smallStyle()} data-testid={`${testid}-coverage`}>{coverageWords(b)}</p>
      {full && <SeasonList b={b} testid={testid}/>}
    </section>
  );
}

/** Staff only (the read sends it to nobody else): this season, ordered by the metric. */
function SeasonList({ b, testid }) {
  return (
    <div data-testid={`${testid}-season`} style={{ display: "grid", gap: "2px" }}>
      <p style={smallStyle()}>
        This season · ordered by {metricLabel(b.metric).toLowerCase()}{b.minBalls ? ` · minimum ${b.minBalls} balls` : ""} · staff only
      </p>
      {b.season.length === 0
        ? <p style={{ ...smallStyle(), color: T.content.secondary }} data-testid={`${testid}-season-none`}>Nothing counted this season yet.</p>
        : (
          <ol style={{ margin: 0, paddingLeft: "1.5em", display: "grid", gap: "2px" }}>
            {b.season.map((s) => (
              <li key={`s-${s.matchId}-${s.playerId}-${s.innings}`} value={s.place ?? undefined} style={bodyStyle()} data-testid={`${testid}-season-line`}>
                {figureOf(s)} {s.name} {whereWords(s)}
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}

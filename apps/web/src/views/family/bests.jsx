/**
 * PERSONAL BESTS — his own, on his passport and on his parent's card
 * (RECOGNITION R5; docs/design/RECOGNITION_design.md D22–D24, §7).
 *
 * One boy's highest innings and best bowling, read from `personal_bests`
 * (db/141 player_best()), which derives them from the log on each read and
 * marks them per class group, format and the side he played for. The card
 * draws the School Records group first (the headline, D24) and Friendly
 * under a filter, never merged; a tie shows every date; a match the scorer
 * has not sealed is "awaiting verification" and never a best. It names
 * nobody but him and ranks him against nobody (D23: never "you are 4th").
 * Every state is a word, never a colour alone; nothing moves.
 */
import { useState } from "react";
import { T } from "../../design/tokens.js";
import { useLive } from "../../lib/live.js";
import { Icon } from "../../ui/icons.jsx";
import { Action, Card, Line, NoneOr } from "./parts.jsx";
import {
  GROUPS, groupLabel, metricLabel, bestLines, whereWords, awaitingCount, groupsHeld, headline, coverageSince, emptyState,
} from "../../lib/bests.js";

const EMPTY = Object.freeze({
  none: "No personal bests yet.",
  awaiting: "Awaiting verification: the scorer has not sealed these matches yet.",
  not_enough: "Not enough eligible data in this group yet.",
});

/**
 * @param {{ role: string, playerId: string, who: string, testid?: string, quietWhenNone?: boolean }} p
 *   who: "Your" on his own passport, "Rohan's" on his parent's card.
 *   quietWhenNone: draw nothing for a boy with no innings at all (the
 *   parent's Home, where a card that says nothing is noise).
 */
export function PersonalBests({ role, playerId, who, testid = "personal-bests", quietWhenNone = false }) {
  const [nonce, setNonce] = useState(0);
  const [group, setGroup] = useState(GROUPS[0].id);
  // The read is asked about this one boy, and answers about nobody else.
  const read = useLive("personal_bests", role, nonce, { playerId });
  if (quietWhenNone && !read.loading && !read.error && !read.rows.length) return null;
  return <PersonalBestsView rows={read.rows} read={read} group={group} onGroup={setGroup} who={who} testid={testid}
    onRetry={() => setNonce((n) => n + 1)}/>;
}

/** The card itself, from rows already read (also what the unit test renders). */
export function PersonalBestsView({ rows, read, group, onGroup, who, testid = "personal-bests", onRetry }) {
  const held = groupsHeld(rows);
  const lines = bestLines(rows, group);
  const empty = emptyState(rows, group);
  const waiting = awaitingCount(rows);
  const since = coverageSince(rows);
  const head = headline(rows, group, who);
  // The filter appears once a group beside the headline holds something.
  const showFilter = held.some((g) => g !== GROUPS[0].id);
  return (
    <Card label="Personal bests" testid={testid}>
      {showFilter && (
        <div role="group" aria-label="Which group" data-testid={`${testid}-filter`} style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
          {GROUPS.map((g) => (
            <Action key={g.id} testid={`${testid}-group-${g.id}`} pressed={group === g.id} onClick={() => onGroup?.(g.id)}
              style={{ fontWeight: group === g.id ? 600 : 500 }}>
              {group === g.id && <Icon name="circle-check"/>}{g.label}
            </Action>
          ))}
        </div>
      )}
      {head && <Line strong testid={`${testid}-headline`}><Icon name="trending-up"/> {head}</Line>}
      {lines.map((l) => (
        <div key={`${l.metric}-${l.format}-${l.side}`} data-testid={`${testid}-line`} data-metric={l.metric}
          style={{ display: "grid", gap: "2px" }}>
          <p style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>
            {metricLabel(l.metric)}{l.format ? ` · ${l.format}` : ""}{l.side ? ` · ${l.side}` : ""}
          </p>
          <p style={{ ...T.role.body, margin: 0, color: T.content.primary }}>
            <span style={{ ...T.role.figure.md, color: T.content.primary }}>{l.figure}</span>{" "}
            <span>{whereWords(l.at)}</span>
            {l.at.length > 1 && <span style={{ color: T.content.secondary }}> · equalled</span>}
          </p>
        </div>
      ))}
      {empty && (read
        ? <NoneOr read={read} what="the personal bests" none={EMPTY[empty]} onRetry={onRetry} testid={`${testid}-none`}/>
        : <Line quiet testid={`${testid}-none`}>{EMPTY[empty]}</Line>)}
      {waiting > 0 && empty !== "awaiting" && (
        <Line quiet testid={`${testid}-awaiting`}>
          Awaiting verification: {waiting} {waiting === 1 ? "match" : "matches"} the scorer has not sealed yet.
        </Line>
      )}
      {lines.length > 0 && (
        <Line quiet testid={`${testid}-coverage`}>
          {groupLabel(group)} · in verified SCRBRD matches{since ? ` since ${since}` : ""}. Earlier matches are not counted.
        </Line>
      )}
    </Card>
  );
}

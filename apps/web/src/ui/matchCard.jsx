import { ReadState } from "./primitives.jsx";
import { readState } from "../lib/readState.js";
import { MatchCardCore, UpdatedAgo, cardFrame } from "./matchCardCore.jsx";

export { UpdatedAgo };

/**
 * THE MATCH CARD (redesign slice 1; DESIGN_DIRECTION §2.2), as every
 * signed-in screen imports it: ./matchCardCore.jsx's drawing, and, in its
 * place while the match is read or when the read failed, slice 7's one state
 * (ui/primitives.jsx ReadState, lib/readState.js): its Skeleton, or
 * "Couldn't load this match." and a Retry. Not a second copy of either, and
 * not a second card: the props are the core's, plus these three.
 *
 * @param {Parameters<typeof MatchCardCore>[0] & {loading?: boolean, error?: boolean, onRetry?: (() => void) | null}} p
 */
export function MatchCard({ loading = false, error = false, onRetry = null, ...card }) {
  if (loading || error) {
    const size = card.size ?? "card";
    const read = readState({ rows: [], loading, error: error ? "unreachable" : null, live: true }, { what: "this match" });
    return (
      <div data-testid={card.testid} data-state={read.state} style={cardFrame(size, card.last ?? false)}>
        <ReadState read={read} onRetry={onRetry ?? undefined} compact={size === "row"} testId="match-card-read"/>
      </div>
    );
  }
  return <MatchCardCore {...card}/>;
}

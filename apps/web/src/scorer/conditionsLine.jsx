import { T } from "../design/tokens.js";
import { capWords, bowlerInningsCap } from "@scrbrd/scoring";

/**
 * What the pad says about the match's playing conditions (SCRBRD-114,
 * design §7.4): words, never a refusal (D1). One quiet line under the board —
 * the version it is played under, whether a no-ball gives a free hit, the
 * innings cap — and, when the bowler on is at or near the cap, a second.
 * Nothing here changes by itself between balls, and nothing greys out a key:
 * past the cap the ball is recorded and the line says so.
 *
 * `info` is what the events read gave the pad (matchFoldContext(),
 * services/api/write/events-api.mjs): the play part of the match's document,
 * its sources and the version's title. A figure nobody confirmed says so
 * (design §8.2).
 */

/**
 * Is this figure one nobody has confirmed — a platform default, or a
 * version's figure marked unconfirmed? The fixture's own and an override
 * with its reason are the school's statement, not an assumption.
 * @param {any} info @param {string} key
 */
export function unconfirmed(info, key) {
  const s = info?.sources?.[key];
  if (!s || typeof s !== "object") return true;
  return s.from === "platform_default" || s.status === "unconfirmed";
}

/**
 * The line's words, in order, or [] when there is nothing to say.
 * @param {any} info
 * @returns {string[]}
 */
export function conditionsWords(info) {
  const c = info?.conditions;
  if (!c) return [];
  const out = [];
  const mark = (/** @type {string} */ k) => (unconfirmed(info, k) ? " (unconfirmed)" : "");
  if (info.title) out.push(`${info.title}${info.version ? ` v${info.version}` : ""}`);
  const fromSet = ["set", "override"].includes(info?.sources?.["format.free_hit"]?.from);
  if (c["format.free_hit"] === false) out.push(`No free hit in this match${mark("format.free_hit")}`);
  else if (c["format.free_hit"] === true && fromSet) out.push(`Free hit after a no-ball${mark("format.free_hit")}`);
  const cap = bowlerInningsCap(c);
  if (cap != null) out.push(`${cap} over${cap === 1 ? "" : "s"} a bowler${mark("bowling.max_overs_per_bowler_innings")}`);
  return out;
}

/**
 * The bowler's line against the cap, for a bowler with `balls` legal
 * deliveries in this innings, or null.
 * @param {any} info @param {number} balls
 */
export function bowlerCapWords(info, balls) {
  if (!info?.conditions) return null;
  return capWords(balls, info.conditions, { unconfirmed: unconfirmed(info, "bowling.max_overs_per_bowler_innings") });
}

export function ConditionsLine({ info, inn }) {
  const words = conditionsWords(info);
  const bowler = inn?.bowler != null ? inn.bowlers?.find((b) => b.id === inn.bowler) : null;
  const cap = bowler ? bowlerCapWords(info, bowler.balls) : null;
  if (!words.length && !cap) return null;
  const line = { fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.4, color: T.content.secondary, margin: 0 };
  return (
    <div data-testid="pad-conditions-block" style={{ display: "grid", gap: "2px" }}>
      {words.length > 0 && <p data-testid="pad-conditions" style={line}>{words.join(" · ")}</p>}
      {cap && <p data-testid="pad-bowler-cap" role="status" style={{ ...line, color: T.content.primary, fontWeight: 600 }}>
        {bowler.name}: {cap}</p>}
    </div>
  );
}

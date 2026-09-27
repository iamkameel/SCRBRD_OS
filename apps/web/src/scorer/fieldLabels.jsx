import { screenAngle } from "@scrbrd/scoring";
import { T } from "../design/tokens.js";
import { CX, CY, R_BND, R_PITCH, RIM, toXY } from "./field.js";

/**
 * The words on a wagon wheel (SCRBRD-101): which side is off and which is leg,
 * the positions around the rim, and the two ends.
 *
 * THE FRAME (Kameel, 2026-09-27). The batter's end is at the top, the
 * bowler's at the bottom, the keeper directly behind the batter. A
 * right-hander stands with his left shoulder to the bowler, so he faces the
 * screen's left: his off side is on the left and his leg side on the right.
 * A left-hander is the mirror, so every word here follows `hand` — the hand
 * of the one batter in view, or "R" for a view that mixes them and has
 * mirrored the left-handers' shots to match (frameOf in field.js).
 *
 * HTML laid over the SVG, not SVG text: a label drawn in the field's 300-unit
 * space shrinks with the wheel, and the 12px floor (DESIGN_DIRECTION §3.2) is
 * a floor in pixels. Placed by percentage, so it scales with the field and
 * the words keep their size. Hidden from assistive technology: the field's
 * own label says the same in a sentence (fieldSentence).
 */
export function FieldLabels({ hand = "R", rim = true }) {
  const at = ([x, y]) => ({ left: `${(x / 300) * 100}%`, top: `${(y / 300) * 100}%` });
  const word = {
    position: "absolute", transform: "translate(-50%,-50%)", pointerEvents: "none", whiteSpace: "nowrap",
    fontFamily: T.type.body, fontSize: "12px", lineHeight: 1, fontWeight: 500, color: T.content.secondary,
  };
  const side = { ...word, fontWeight: 700, letterSpacing: "0.08em", color: T.content.primary };
  const offLeft = hand !== "L";
  return (
    <div aria-hidden="true" data-testid="field-labels" data-hand={hand} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <span data-testid="field-side-left" style={{ ...side, ...at([9, CY]), transform: "translate(-50%,-50%) rotate(-90deg)" }}>
        {offLeft ? "OFF" : "LEG"}
      </span>
      <span data-testid="field-side-right" style={{ ...side, ...at([291, CY]), transform: "translate(-50%,-50%) rotate(90deg)" }}>
        {offLeft ? "LEG" : "OFF"}
      </span>
      <span data-testid="field-end-batter" style={{ ...word, ...at([CX, CY - R_PITCH - 10]) }}>Batter</span>
      <span data-testid="field-end-bowler" style={{ ...word, ...at([CX, CY + R_PITCH + 10]) }}>Bowler</span>
      {rim && RIM.map((r) => {
        // Anchored just inside the rope and grown INWARD — a name on the right
        // ends at its anchor, one at the top hangs below it — so on a small
        // wheel "Square leg" never runs into LEG or off the field.
        const a = /** @type {number} */ (screenAngle(r.theta, hand)), rad = (a * Math.PI) / 180;
        const tx = -50 - 50 * Math.sin(rad), ty = -50 + 50 * Math.cos(rad);
        return (
          <span key={r.key} data-rim={r.key} style={{ ...word, ...at(toXY(a, R_BND - 6)), transform: `translate(${tx.toFixed(1)}%,${ty.toFixed(1)}%)` }}>
            {r.label}
          </span>
        );
      })}
    </div>
  );
}

/** The frame in a sentence, for the field's accessible name. */
export const fieldSentence = (hand = "R", mixed = false) =>
  `Batter at the top, bowler at the bottom; off side on the ${hand === "L" ? "right" : "left"}, leg side on the ${hand === "L" ? "left" : "right"}${
    mixed ? "; left-handers' shots mirrored so leg side is always on the right" : hand === "L" ? ", for a left-hander" : ""}.`;

/** The line a view that mixes hands carries under its field. */
export const MIRROR_NOTE = "Left-handers’ shots mirrored so leg side is always on the right.";

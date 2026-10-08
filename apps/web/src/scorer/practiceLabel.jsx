import { T } from "../design/tokens.js";
import { Icon } from "../ui/icons.jsx";
import { StateLabel, STATE_WORDS } from "../ui/stateLabel.jsx";

/**
 * The words every practice screen carries, so nobody holds a phone with a
 * child's name on it and takes it for the school's record. Where the practice
 * match is kept is the whole of the privacy promise (lib/practice.js), so it is
 * said here, in the same words, on the setup, the list, the pad and the result.
 */
export const PRACTICE_LABEL = STATE_WORDS.practice;

/** @param {{saved?: string | null, compact?: boolean}} props  `saved`: "10:42", when the log was last written */
export function PracticeLabel({ saved = null, compact = false }) {
  // The one shared label (ui/stateLabel.jsx); the practice test ids stay.
  return (
    <StateLabel kind="practice" compact={compact} testid="practice-label">
      {saved && <span data-testid="practice-saved" style={{ fontWeight: 400 }}>{`· last saved ${saved}`}</span>}
    </StateLabel>
  );
}

/**
 * The small weather chip in the practice pad's header: what the weather is
 * now, in words ("Overcast · 18°C"), from the record (lib/practice.js
 * weatherChipWords). Text only, not a control; nothing when none is recorded.
 * Where the numbers are Google's, the chip says so (the provider's attribution).
 * @param {{words: string | null, byGoogle?: boolean}} props
 */
export function PracticeWeatherChip({ words, byGoogle = false }) {
  if (!words) return null;
  return (
    <p data-testid="practice-weather-chip" aria-label={`Weather: ${words}${byGoogle ? ". Weather by Google" : ""}`} style={{
      margin: 0, display: "inline-flex", alignItems: "center", gap: T.space.xs, maxWidth: "100%",
      fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.3, fontWeight: 600, color: T.content.secondary,
    }}>
      <Icon name="cloud-sun"/>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{words}</span>
      {byGoogle && <span style={{ fontWeight: 400, whiteSpace: "nowrap" }}>· Weather by Google</span>}
    </p>
  );
}

import { T } from "../design/tokens.js";
import { Icon } from "../ui/icons.jsx";

/**
 * The words every practice screen carries, so nobody holds a phone with a
 * child's name on it and takes it for the school's record. Where the practice
 * match is kept is the whole of the privacy promise (lib/practice.js), so it is
 * said here, in the same words, on the setup, the list, the pad and the result.
 */
export const PRACTICE_LABEL = "Practice match · kept on this phone";

/** @param {{saved?: string | null, compact?: boolean}} props  `saved`: "10:42", when the log was last written */
export function PracticeLabel({ saved = null, compact = false }) {
  return (
    <p data-testid="practice-label" style={{
      margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: `0 ${T.space.sm}`,
      fontFamily: T.type.body, fontSize: compact ? "12px" : "13px", lineHeight: 1.3, fontWeight: 600, color: T.content.secondary,
    }}>
      <Icon name="smartphone"/>
      <span>{PRACTICE_LABEL}</span>
      {saved && <span data-testid="practice-saved" style={{ fontWeight: 400 }}>{`· last saved ${saved}`}</span>}
    </p>
  );
}

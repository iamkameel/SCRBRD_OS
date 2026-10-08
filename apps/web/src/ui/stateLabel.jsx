import { T } from "../design/tokens.js";
import { Icon } from "./icons.jsx";

/**
 * One label for what a screen's figures are, so nobody takes a demonstration
 * for a school's record, a practice match for the school's, or a panel they
 * may only read for one they can change (GA-I21).
 *
 *   demo      Nothing on the screen is a school's and nothing is saved: the
 *             app has no session (signedIn() false). One word, "Demo", in the
 *             shell, on the Match Centre and on a card that shows sample rows.
 *   practice  A practice match, kept on this phone only (lib/practice.js).
 *             The words are the practice screens' own, unchanged.
 *   readonly  The person can see this and may not change it. Says so, and
 *             says why where the reason is known (a role, a competition's
 *             organiser), instead of leaving controls silently disabled.
 *
 * There is no "official": a match's status has no such value and a result is
 * read from the log, never stored (db/69). Nothing is labelled official until
 * the system has a state to take it from.
 *
 * Text and an icon, never colour alone. 12px at the least. It is a label, not
 * a control, and draws nothing tappable. Tokens only (the style lock).
 */
export const STATE_WORDS = Object.freeze({
  demo: "Demo",
  practice: "Practice match · kept on this phone",
  readonly: "Read only",
});

/** The kinds, in the order the brief names them. */
export const STATE_KINDS = Object.freeze(Object.keys(STATE_WORDS));

const KIND = {
  demo: { icon: "sparkles", tone: () => T.semantic.warningText, weight: 700 },
  practice: { icon: "smartphone", tone: () => T.content.secondary, weight: 600 },
  readonly: { icon: "lock", tone: () => T.content.secondary, weight: 600 },
};

/**
 * @param {object} props
 * @param {"demo" | "practice" | "readonly"} props.kind
 * @param {string | null} [props.why]   one short line, after the words: why it is this state, where known
 * @param {boolean} [props.compact]     12px rather than 13px (the floor is 12)
 * @param {import("react").ReactNode} [props.children]  anything that belongs on the same line (a practice match's "last saved")
 * @param {string} [props.testid]       the data-testid; defaults to `state-label-{kind}`
 */
export function StateLabel({ kind, why = null, compact = false, children = null, testid, ...rest }) {
  const k = KIND[kind];
  if (!k) return null;
  return (
    <p {...rest} data-testid={testid ?? `state-label-${kind}`} data-state={kind} style={{
      margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: `0 ${T.space.sm}`,
      fontFamily: T.type.body, fontSize: compact ? "12px" : "13px", lineHeight: 1.3, fontWeight: k.weight, color: k.tone(),
      ...(kind === "demo" ? { textTransform: "uppercase", letterSpacing: "0.05em" } : null),
    }}>
      <Icon name={k.icon}/>
      <span>{STATE_WORDS[kind]}</span>
      {why && <span data-testid={`state-why-${kind}`} style={{ fontWeight: 400, textTransform: "none", letterSpacing: "normal", color: T.content.secondary }}>{`· ${why}`}</span>}
      {children}
    </p>
  );
}

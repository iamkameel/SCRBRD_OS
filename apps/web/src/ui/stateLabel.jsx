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
 * A finished match's result (OFFICIAL_RESULT D11, D12). The state comes from
 * the server and nowhere else: GET /api/matches/:id/official, or the public
 * result's `official`, both read off db/114's match_official_state() — a
 * confirmation pinned to the log's head and the result's hash, so every
 * correction makes the result provisional again by itself. A match's status
 * never says it, and no screen decides it.
 *   provisional  complete and not confirmed, or confirmed and since
 *                corrected. Public. "Provisional"; `why` says when it was
 *                corrected, or (staff) what it waits on.
 *   review       a dispute stands. STAFF ONLY: a public page or a parent's
 *                screen is never given this kind (Q3); the server already
 *                reads it to them as provisional.
 *   official     "Official result"; `why` is the time it was confirmed (the
 *                public's), or the role word (staff): never a name.
 *
 * Text and an icon, never colour alone. 12px at the least. It is a label, not
 * a control, and draws nothing tappable. Tokens only (the style lock).
 */
export const STATE_WORDS = Object.freeze({
  demo: "Demo",
  practice: "Practice match · kept on this phone",
  readonly: "Read only",
  provisional: "Provisional",
  review: "Under review",
  official: "Official result",
});

/** The kinds, in the order the brief names them. */
export const STATE_KINDS = Object.freeze(Object.keys(STATE_WORDS));

const KIND = {
  demo: { icon: "sparkles", tone: () => T.semantic.warningText, weight: 700 },
  practice: { icon: "smartphone", tone: () => T.content.secondary, weight: 600 },
  readonly: { icon: "lock", tone: () => T.content.secondary, weight: 600 },
  provisional: { icon: "hourglass", tone: () => T.content.secondary, weight: 600 },
  review: { icon: "scale", tone: () => T.semantic.warningText, weight: 700 },
  official: { icon: "shield-check", tone: () => T.content.primary, weight: 700 },
};

/**
 * @param {object} props
 * @param {"demo" | "practice" | "readonly" | "provisional" | "review" | "official"} props.kind
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

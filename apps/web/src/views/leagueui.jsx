import { T } from "../design/tokens.js";
import { Badge } from "../ui/primitives.jsx";
import { styles } from "./playingconditions.jsx";

/**
 * The few small pieces the league wizard, the invitations and the fixture
 * planner share (SCRBRD-123, SCRBRD-127), so each reads the same: a message
 * said to a screen reader, a section, a standing in a Badge, a data list.
 *
 * Colour is read from `T` when a component renders, never at import, so both
 * themes are right. Type is 12px at the least and every control 44px.
 */

/** A message a person hears without moving focus (WCAG 4.1.3). Always in the page, so a change is announced. */
export function Said({ children, testid = "said" }) {
  const S = styles();
  return <p role="status" aria-live="polite" data-testid={testid} style={{ ...S.body, color: T.content.primary, minHeight: "20px" }}>{children}</p>;
}

/** A standing, in a Badge the theme colours. @param {{ tone: "good" | "warn" | "bad" | "info" | "quiet", children: any, testid?: string }} p */
export function Standing({ tone, children, testid }) {
  const color = tone === "good" ? T.semantic.positive : tone === "warn" ? T.semantic.warning : tone === "bad" ? T.semantic.critical : tone === "info" ? T.semantic.info : T.content.tertiary;
  return <Badge color={color} data-testid={testid}>{children}</Badge>;
}

/** A small native select or text input, styled as the app's. */
export function selectStyle() {
  const S = styles();
  return { ...S.input, appearance: "auto" };
}

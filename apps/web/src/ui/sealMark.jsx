/**
 * The seal's mark (RECOGNITION_design.md D6, §7): a milestone the scorer has
 * sealed carries the medal; one he has not yet sealed carries a star with a
 * dashed outline. The mark is never the message alone — the words beside it
 * ("sealed by the scorer, 12 Sep", "not yet sealed by the scorer") are — so
 * it is hidden from assistive technology. currentColor, no motion.
 */
import { Icon } from "./icons.jsx";

const INLINE = { display: "inline-block", verticalAlign: "-0.125em", flexShrink: 0 };

/** @param {{ sealed: boolean, testid?: string }} props */
export function SealMark({ sealed, testid }) {
  if (sealed) return <Icon name="medal" data-testid={testid} data-sealed="true"/>;
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={INLINE}
      data-testid={testid} data-sealed="false">
      <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"
        fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeDasharray="2.6 2.2"/>
    </svg>
  );
}

import { T } from "../design/tokens.js";

/**
 * The parts of a notice both Notices screens draw (redesign slice 17, DESIGN_DIRECTION Flow C): the staff's and
 * the pupil's (NotificationsView.jsx) and the parent's (family/family.jsx), so a dot, a day, a link and Report
 * look and read the same on each. What they are FOR is said in lib/noticeList.js; these only draw it.
 */

/** A day's heading: "Today", "Yesterday", "Mon 23 Nov". None for the demonstration's undated rows. */
export function DayHeading({ words, as: As = "h3" }) {
  if (!words) return null;
  return <As data-testid="notice-day-words" style={{ ...T.role.label, color: T.content.secondary, margin: `${T.space.sm} 0 0` }}>{words}</As>;
}

/**
 * The unread dot. Seen, it is a shape, not a colour (a dot is there or it is not), and the title beside it is
 * bold; heard, the title's own button says "Unread" (UnreadWord), so colour is never the only signal.
 */
export function UnreadDot() {
  return (
    <span aria-hidden="true" data-testid="notice-dot"
      style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: T.brand.blue, flexShrink: 0 }}/>
  );
}

/** What a screen reader hears after an unread notice's title, inside its button. */
export function UnreadWord() {
  return <span className="sr-only" data-testid="notice-unread">. Unread</span>;
}

/** Where a notice was sent from, when the reader's notices come from more than one school. */
export function SchoolLine({ name }) {
  if (!name) return null;
  return <span data-testid="notice-school" style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{name}</span>;
}

const quiet = (/** @type {boolean} */ strong) => ({
  alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "4px", minHeight: "44px", minWidth: "44px",
  padding: "0 2px", margin: 0, background: "transparent", border: "none", borderRadius: T.radius.sm, cursor: "pointer",
  ...T.role.body, fontSize: "14px", fontWeight: strong ? 600 : 500, color: strong ? T.content.primary : T.content.secondary,
  textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1px",
});

/** "See the fixture ›": the opened notice's subject, in this reader's app (lib/noticeList.js subjectLink). */
export function SubjectLink({ link, onFollow }) {
  return (
    <button type="button" className="os-state" data-testid="notice-subject" data-to={link.to} onClick={onFollow} style={quiet(true)}>
      {link.words}<span aria-hidden="true" style={{ textDecoration: "none" }}>›</span>
    </button>
  );
}

/**
 * "Report", a quiet text button at the notice's foot (D11, CSA SG-9 rule 4): still one tap, and only where
 * reportable() says so. Its name says which notice.
 */
export function ReportButton({ title, busy, onReport }) {
  return (
    <button type="button" className="os-state" data-testid="notice-report" disabled={busy} onClick={onReport}
      aria-label={`Report this notice: ${title}`} style={{ ...quiet(false), cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
      {busy ? "Reporting…" : "Report"}
    </button>
  );
}

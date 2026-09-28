import { T } from "../../design/tokens.js";
import { humanDateTime } from "../../lib/format.js";
import { Icon } from "../../ui/icons.jsx";
import { CardHead, Panel } from "./bits.jsx";

/**
 * The two notices above the tabs that the public page (SCRBRD-083) shares
 * with the signed-in Match Centre: before the toss, and an interrupted
 * innings. Moved out of fulltime.jsx, which re-exports them, because that
 * file also holds the confirm-the-scorecard prompt and its API calls, which
 * no public page reaches.
 */

// ── 1. Before the toss (item 1) ──

/**
 * A fixture that has not been played: the teams are already in the header,
 * so this names the ground and the start plainly, and nothing else — no
 * placeholder score, no "TBC" dressed up as a fact. A "follow this match"
 * action belongs here (SCRBRD-100 item 1) but no follow or notification
 * mechanism exists for one fixture today (searched: `apps/web/src/lib/push.js`
 * only turns alerts on or off for a device, never for a match), so it is left
 * out rather than built as a button that does nothing.
 */
export function PreTossCard({ match, weather }) {
  const rows = [
    ["Ground", match?.venue ?? null],
    ["Start", match?.date ? humanDateTime(match.date, match.time ?? null) : null],
    ["Weather", weather ? [weather.tempC != null ? `${weather.tempC}°` : null, weather.condition ?? null].filter(Boolean).join(" ") || null : null],
  ].filter(([, v]) => v != null && v !== "");
  return (
    <Panel testid="mc-pretoss">
      <CardHead icon="hourglass">Before the toss</CardHead>
      <div style={{ padding: T.space.md }}>
        {rows.length ? (
          <dl style={{ margin: 0, display: "grid", gap: T.space.xs }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: T.space.md }}>
                <dt style={{ ...T.role.label, color: T.content.secondary }}>{k}</dt>
                <dd style={{ ...T.role.body, color: T.content.primary, margin: 0, textAlign: "right" }}>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>Nothing set for this fixture yet.</p>
        )}
        <p style={{ ...T.role.body, fontSize: "13px", color: T.content.tertiary, margin: `${T.space.sm} 0 0` }}>
          The board opens once the toss is called.
        </p>
      </div>
    </Panel>
  );
}

// ── 1. A rain delay or interruption (item 1) ──

/**
 * A clear status in place of a frozen board, from the one signal the log
 * carries (`revisionNotice`, lib/matchCentre.js): a revision the umpires
 * recorded. There is no "play stopped, resuming at…" event on the platform
 * today — only this, after the fact — so that is what this says, honestly,
 * rather than inventing a countdown nobody typed.
 */
export function RevisionBanner({ notice }) {
  if (!notice) return null;
  return (
    <div data-testid="mc-revision" role="status" style={{ display: "flex", alignItems: "flex-start", gap: T.space.sm,
      padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md, border: `1px solid ${T.semantic.warning}`,
      background: T.surface.raised }}>
      <span aria-hidden="true" style={{ color: T.semantic.warning, flexShrink: 0, marginTop: "2px" }}><Icon name="cloud-rain"/></span>
      <div style={{ display: "grid", gap: "2px" }}>
        <span style={{ ...T.role.label, color: T.semantic.warning }}>{notice.label}</span>
        <span style={{ ...T.role.body, color: T.content.primary }}>{notice.text}</span>
      </div>
    </div>
  );
}

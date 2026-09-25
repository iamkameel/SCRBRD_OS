import { T } from "../design/tokens.js";
import { THEME_CHOICES, useTheme } from "../design/theme.js";

/**
 * System / Daylight / Floodlit — the one control for the theme, drawn in
 * Settings and on the pad's menu (DESIGN_DIRECTION §3.1). A radiogroup, so a
 * screen reader says "Daylight, radio button, 2 of 3" and the arrow keys move
 * between the three; each option is 44px tall, the tap floor, because on the
 * pad it is reached one-handed.
 *
 * It changes THIS device only (design/theme.js stores it locally): the office
 * desktop and the scorer's phone in the sun are different places.
 */
export function ThemeChoice({ testid = "theme-choice", label = "Appearance" }) {
  const { preference, theme, setPreference } = useTheme();
  const onKey = (e) => {
    const i = THEME_CHOICES.findIndex((c) => c.value === preference);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = THEME_CHOICES[(i + step + THEME_CHOICES.length) % THEME_CHOICES.length];
    setPreference(next.value);
    e.currentTarget.querySelector(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div>
      <div role="radiogroup" aria-label={label} data-testid={testid} data-theme-in-use={theme} onKeyDown={onKey}
        style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.xs,
          padding: T.space.xs, background: T.surface.base, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md }}>
        {THEME_CHOICES.map((c) => {
          const on = c.value === preference;
          return (
            <button key={c.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
              data-value={c.value} data-testid={`${testid}-${c.value}`} title={c.hint}
              onClick={() => setPreference(c.value)} className="pressBtn os-state" data-selected={on}
              style={{ minHeight: "44px", padding: `${T.space.xs} ${T.space.sm}`, borderRadius: T.radius.sm, cursor: "pointer",
                border: `1px solid ${on ? T.line.strong : "transparent"}`,
                background: on ? T.surface.raised : "transparent",
                boxShadow: on ? T.elevation.sm : "none",
                color: on ? T.content.primary : T.content.secondary,
                fontFamily: T.type.body, fontSize: "14px", fontWeight: on ? 600 : 500 }}>
              {c.label}
            </button>
          );
        })}
      </div>
      <div style={{ fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.4, color: T.content.tertiary, marginTop: T.space.sm }}>
        {preference === "system"
          ? `Following this device — ${theme === "daylight" ? "Daylight" : "Floodlit"} now.`
          : "Kept on this device. The scoreboard stays black in both."}
      </div>
    </div>
  );
}

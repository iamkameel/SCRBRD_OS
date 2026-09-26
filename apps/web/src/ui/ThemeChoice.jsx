import { T } from "../design/tokens.js";
import { THEME_CHOICES, VISION_CHOICES, useTheme } from "../design/theme.js";

/**
 * One row of choices as a radiogroup, so a screen reader says "Daylight, radio
 * button, 2 of 3" and the arrow keys move between them; each option is 44px
 * tall, the tap floor, because on the pad it is reached one-handed.
 */
function Choices({ choices, value, onChoose, testid, label, extra }) {
  const onKey = (e) => {
    const i = choices.findIndex((c) => c.value === value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = choices[(i + step + choices.length) % choices.length];
    onChoose(next.value);
    e.currentTarget.querySelector(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} data-testid={testid} {...extra} onKeyDown={onKey}
      style={{ display: "grid", gridTemplateColumns: `repeat(${choices.length},minmax(0,1fr))`, gap: T.space.xs,
        padding: T.space.xs, background: T.surface.base, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md }}>
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <button key={c.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            data-value={c.value} data-testid={`${testid}-${c.value}`} title={c.hint}
            onClick={() => onChoose(c.value)} className="pressBtn os-state" data-selected={on}
            style={{ minHeight: "44px", padding: `${T.space.xs} ${T.space.sm}`, borderRadius: T.radius.sm, cursor: "pointer",
              border: `1px solid ${on ? T.line.strong : "transparent"}`,
              background: on ? T.surface.raised : "transparent",
              boxShadow: on ? T.elevation.sm : "none",
              color: on ? T.content.primary : T.content.secondary,
              fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.2, fontWeight: on ? 600 : 500 }}>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

const note = () => ({ fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.4, color: T.content.tertiary, marginTop: T.space.sm });

/**
 * System / Daylight / Floodlit — the one control for the theme, drawn in
 * Settings and on the pad's menu (DESIGN_DIRECTION §3.1).
 *
 * It changes THIS device only (design/theme.js stores it locally): the office
 * desktop and the scorer's phone in the sun are different places.
 */
export function ThemeChoice({ testid = "theme-choice", label = "Appearance" }) {
  const { preference, theme, setPreference } = useTheme();
  return (
    <div>
      <Choices choices={THEME_CHOICES} value={preference} onChoose={setPreference} testid={testid} label={label}
        extra={{ "data-theme-in-use": theme }}/>
      <div style={note()}>
        {preference === "system"
          ? `Following this device — ${theme === "daylight" ? "Daylight" : "Floodlit"} now.`
          : "Kept on this device. The scoreboard stays black in both."}
      </div>
    </div>
  );
}

/**
 * Standard / Red-green safe / Blue-yellow safe — the colour-vision setting
 * (DESIGN_DIRECTION §3.9, SCRBRD-096), beside the theme wherever the theme is
 * offered. It swaps only the colours that carry meaning by hue (the ball
 * chips, saved / held / refused, the wagon wheel) and combines with either
 * theme. Kept on this device, like the theme.
 */
export function VisionChoice({ testid = "vision-choice", label = "Colours" }) {
  const { vision, setVision } = useTheme();
  const chosen = VISION_CHOICES.find((c) => c.value === vision) ?? VISION_CHOICES[0];
  return (
    <div>
      <Choices choices={VISION_CHOICES} value={chosen.value} onChoose={setVision} testid={testid} label={label}
        extra={{ "data-vision-in-use": chosen.value }}/>
      <div style={note()}>
        {chosen.value === "standard"
          ? "The ball chips and states in their usual colours. Every chip also carries its figure."
          : `${chosen.hint}. Only colours that carry meaning change; words and layout stay.`}
      </div>
    </div>
  );
}

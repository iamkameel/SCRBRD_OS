import { T } from "../design/tokens.js";
import { Icon } from "./icons.jsx";
import { StateLabel } from "./stateLabel.jsx";

/**
 * One line under an analysis panel's title that says what its figures stand
 * on, in plain words, the same way everywhere (GA-I22):
 *
 *   Source  where the figures come from ("Scored balls", "Scorebook import")
 *   Scope   whose they are ("1XI", "one player", "Hilton, every team")
 *   Window  the dates they cover ("This season", "12 Mar to 4 Oct 2026")
 *   Basis   the denominator ("From 214 balls", "From 6 innings")
 *
 * and, when the denominator is small or nothing, says so in words rather than
 * leaving a confident-looking figure beside it:
 *
 *   zero     "No balls on record yet, so there is nothing to read here."
 *   small    "Only 8 balls, fewer than the 30 this needs. A guide, not a result."
 *   unknown  "How many this is built from is not stated by this read."
 *
 * It invents nothing. Every part comes from what the panel already holds, and
 * a part the panel does not know is left out, not guessed. The one exception
 * is `denominator={{ unknown: true }}`, for a panel that should have a count
 * and whose read does not give one: the line then says that out loud.
 *
 * A figure that is a demonstration says "Demo" through StateLabel (GA-I21),
 * the shell's own word, and then only the scope and window the screen has: a
 * demonstration is not a school's record, so it names no source it does not
 * have.
 *
 * Text and an icon, never colour alone. Nothing under 12px (T.floor.read). It
 * is a line to read, not a control. Tokens only (the style lock).
 */

/** The labels, in the order the line reads. */
export const SOURCE_LABELS = Object.freeze({
  source: "Source",
  scope: "Scope",
  window: "Window",
  basis: "Basis",
});

/** What a denominator's level is called, for the test id and for the tests. */
export const LEVELS = Object.freeze(["ok", "small", "zero", "unknown"]);

/** Thousands with a space, South African style; small numbers as they are. */
const count = (n) => (n >= 10000 ? n.toLocaleString("en-ZA") : String(n));

/**
 * @typedef {object} Denominator
 * @property {number} [n]           how many the figures are built from
 * @property {string} [unit]        singular: "ball", "innings", "completed fixture"
 * @property {string} [plural]      when it is not unit + "s"
 * @property {number} [floor]       fewer than this is "small"; omit when the panel has no floor of its own
 * @property {string} [detail]      one clause after the count: "6 decided", "of 300 deliveries in the log"
 * @property {boolean} [unknown]    the panel should have a count and its read gives none
 */

/**
 * The words for a denominator, and how much weight it can bear.
 * @param {Denominator | null | undefined} d
 * @returns {{ level: "ok" | "small" | "zero" | "unknown", text: string } | null}  null: the panel has none to give
 */
export function denominatorWords(d) {
  if (!d) return null;
  if (d.unknown) return { level: "unknown", text: "How many this is built from is not stated by this read." };
  const n = d.n;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const unit = d.unit ?? "record";
  const plural = d.plural ?? `${unit}s`;
  const noun = n === 1 ? unit : plural;
  const detail = d.detail ? `, ${d.detail}` : "";
  if (n === 0) return { level: "zero", text: `No ${plural} on record yet, so there is nothing to read here.` };
  if (typeof d.floor === "number" && n < d.floor) {
    return { level: "small", text: `Only ${count(n)} ${noun}${detail}, fewer than the ${count(d.floor)} this needs. A guide, not a result.` };
  }
  return { level: "ok", text: `From ${count(n)} ${noun}${detail}.` };
}

/**
 * The parts of a line, in order, as plain text. Pure, so a test (and a walk)
 * can read what a panel says without rendering it.
 * @param {{ source?: string | null, scope?: string | null, window?: string | null, denominator?: Denominator | null }} p
 * @returns {{ key: "source" | "scope" | "window" | "basis", label: string, text: string, level?: string }[]}
 */
export function sourceParts({ source = null, scope = null, window = null, denominator = null } = {}) {
  const out = [];
  if (source) out.push({ key: "source", label: SOURCE_LABELS.source, text: source });
  if (scope) out.push({ key: "scope", label: SOURCE_LABELS.scope, text: scope });
  if (window) out.push({ key: "window", label: SOURCE_LABELS.window, text: window });
  const basis = denominatorWords(denominator);
  if (basis) out.push({ key: "basis", label: SOURCE_LABELS.basis, text: basis.text, level: basis.level });
  return out;
}

/**
 * @param {object} props
 * @param {string | null} [props.source]    "Scored balls", "Scorebook import", "Scored balls and scorebook imports"
 * @param {string | null} [props.scope]     "1XI", "One player", "Every team you can see"
 * @param {string | null} [props.window]    "This season", "12 Mar to 4 Oct 2026", "Every season on record"
 * @param {Denominator | null} [props.denominator]
 * @param {boolean} [props.demo]            the figures are a demonstration: "Demo" through StateLabel, no source claimed
 * @param {string} [props.demoWhy]          one short clause after "Demo"
 * @param {import("react").ReactNode} [props.children]  one sentence that belongs to this panel alone (what a null means here)
 * @param {string} [props.testid]           defaults to "source-line"
 */
export function SourceLine({ source = null, scope = null, window = null, denominator = null, demo = false, demoWhy = null, children = null, testid = "source-line", ...rest }) {
  const parts = demo
    ? sourceParts({ scope, window })
    : sourceParts({ source, scope, window, denominator });
  const basis = demo ? null : parts.find((p) => p.key === "basis");
  const level = basis?.level ?? "ok";
  const weak = level === "small" || level === "zero" || level === "unknown";
  if (!demo && !parts.length && !children) return null;
  return (
    <div {...rest} data-testid={testid} data-level={level} data-demo={demo ? "true" : undefined} style={{
      display: "flex", flexDirection: "column", gap: T.space.xs,
      fontFamily: T.type.body, fontSize: `${T.floor.read}px`, lineHeight: 1.45, color: T.content.secondary,
    }}>
      {demo && <StateLabel kind="demo" compact why={demoWhy}/>}
      {parts.length > 0 && (
        <p style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: `${T.space.xs} ${T.space.lg}` }}>
          {parts.map((p) => {
            const isWeak = p.key === "basis" && weak;
            return (
              <span key={p.key} data-part={p.key} style={isWeak ? { color: T.semantic.warningText, fontWeight: 600 } : undefined}>
                <span style={{ fontWeight: 700, color: isWeak ? "inherit" : T.content.primary }}>{p.label}</span>{" "}
                {isWeak && <Icon name="triangle-alert"/>}{isWeak ? " " : ""}{p.text}
              </span>
            );
          })}
        </p>
      )}
      {children && <span data-part="note">{children}</span>}
    </div>
  );
}

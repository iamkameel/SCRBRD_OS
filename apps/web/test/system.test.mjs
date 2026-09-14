/**
 * Design System 2.0 — the rules the components are supposed to enforce.
 *
 * A design system is only a system if the code refuses to break it. These are
 * the claims the surface and data families make, checked as behaviour rather
 * than trusted as documentation:
 *
 *   §4  / Rule 3  bento size communicates importance
 *   §21 / Rule 6  glass creates depth, not identity
 *   §22 / Rule 5  gradients are ambient light, not per-card decoration
 *   Rule 4        colour communicates meaning — including that "up" is not
 *                 automatically good
 *   the em-dash rule: an absent figure is never rendered as a zero
 *
 * The components are exercised through React's own renderer rather than by
 * reading their source, so a rule that is documented but not implemented
 * fails here.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { T, textOn } from "../src/design/tokens.js";
import { Bento, BentoCard, HeroSurface, TonalSurface, GlassSurface } from "../src/ui/surfaces.jsx";
import { Metric, MetricGroup, Trend, Sparkline, StatRow, StatusPill, SegmentedControl, ContextBar, dash }
  from "../src/ui/data.jsx";
import { Modal } from "../src/ui/primitives.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el);

// ══════════════════════════════════════════════════════════════════
group("Bento size communicates importance (§4, Rule 3)");

const LEVELS = ["a", "b", "c", "d"];
const spanOf = (lvl) => (html(h(BentoCard, { level: lvl }, "x")).match(/class="(bento-[a-d])/) ?? [])[1];

for (const lvl of LEVELS) {
  ok(`level ${lvl} draws the ${lvl} span`, spanOf(lvl) === `bento-${lvl}`);
}
ok("an unknown level falls back to intelligence, not to hero",
   spanOf("zzz") === "bento-c",
   "a typo must never silently promote a tile to the top of the hierarchy");
ok("the default is intelligence, not hero", spanOf(undefined) === "bento-c");

// The rule has teeth only if a call site cannot quietly opt out of it. Spread
// order is the whole guarantee: `style` last from the caller would erase the
// level's layout entirely, and the page would still render — just flat.
const clobbered = html(h(BentoCard, {
  level: "d", className: "mine", style: { background: "red", gridColumn: "span 12" },
}, "x"));
ok("a caller's style cannot replace the level's own", !/red/.test(clobbered));
ok("...and cannot widen the tile behind the level's back", !/span 12/.test(clobbered));
ok("a caller's className is added, not substituted",
   /bento-d/.test(clobbered) && /mine/.test(clobbered));
// ...while the things a card legitimately needs still get through.
const passed = html(h(BentoCard, { level: "c", "data-testid": "x", "aria-label": "Form" }, "y"));
ok("data- and aria- attributes still pass through",
   /data-testid="x"/.test(passed) && /aria-label="Form"/.test(passed));
// And sx is the sanctioned way to adjust, because it merges.
const sxed = html(h(BentoCard, { level: "c", sx: { minHeight: "200px" } }, "x"));
ok("sx merges into the computed style rather than replacing it",
   /min-height:200px/.test(sxed) && sxed.includes(T.surface.base));

// Hero is drawn louder as well as bigger: shadow and a stronger border.
const hero = html(h(BentoCard, { level: "a" }, "x"));
const util = html(h(BentoCard, { level: "d" }, "x"));
ok("the hero carries elevation and the utility tile does not",
   hero.includes("box-shadow") && hero.includes(T.elevation.md) && !util.includes(T.elevation.md));
ok("the hero sits on a lifted surface", hero.includes(T.surface.raised));
ok("...and the utility tile on the base surface", util.includes(T.surface.base));

// ══════════════════════════════════════════════════════════════════
group("Gradients are ambient light, not decoration (§22, Rule 5)");

const plain = html(h(BentoCard, { level: "b", accent: T.brand.lime }, "x"));
ok("an accented tile tints its edge only", plain.includes(`2px solid ${T.brand.lime}`));
ok("...and never fills itself with a gradient", !/gradient/.test(plain));
ok("no bento tile at any level draws a gradient",
   LEVELS.every((l) => !/gradient/.test(html(h(BentoCard, { level: l }, "x")))));

const heroSurface = html(h(HeroSurface, { tone: T.brand.cyan }, "x"));
ok("the hero surface is where the one wash lives", /radial-gradient/.test(heroSurface));
ok("...at low opacity, as light rather than paint", /1f,\s*transparent/.test(heroSurface));
ok("...behind the content, not over it", /aria-hidden="true"/.test(heroSurface));

// ══════════════════════════════════════════════════════════════════
group("Glass creates depth, not identity (§21, Rule 6)");

ok("a tonal surface is flat — no glass, no shadow, no gradient", (() => {
  const s = html(h(TonalSurface, null, "x"));
  return !/backdrop|blur|gradient|box-shadow/.test(s);
})());
const glass = html(h(GlassSurface, { over: "content" }, "x"));
ok("the glass surface is the only one that blurs", /os-glass/.test(glass));
ok("...and states what it floats above", /data-over="content"/.test(glass));

// ══════════════════════════════════════════════════════════════════
group("An absent figure is an em dash, never a zero");

ok("null renders as an em dash", dash(null) === "—");
ok("undefined renders as an em dash", dash(undefined) === "—");
ok("an empty string renders as an em dash", dash("") === "—");
// The distinction the whole rule exists for.
ok("a real zero renders as zero", dash(0) === "0");
ok("...and is not mistaken for absence", dash(0) !== "—");
ok("a Metric with no value shows the dash", html(h(Metric, { label: "Runs", value: null })).includes("—"));
ok("a Metric with zero shows the zero", /<span[^>]*>0<\/span>/.test(html(h(Metric, { label: "Runs", value: 0 }))));
ok("a StatRow follows the same rule", html(h(StatRow, { label: "Wickets", value: null })).includes("—"));

// ══════════════════════════════════════════════════════════════════
group("Colour communicates meaning (Rule 4)");

// Up is not automatically good. A rising bowling economy is worse, and a
// dashboard that congratulates a coach on a rising injury count is the bug.
const up = html(h(Trend, { value: 12 }));
const upBad = html(h(Trend, { value: 12, goodWhen: "down" }));
ok("a rise is positive when up is good", up.includes(T.semantic.positive));
ok("...and critical when up is bad", upBad.includes(textOn(T.semantic.critical)));
ok("...so direction alone does not decide the colour", up !== upBad);

const down = html(h(Trend, { value: -12 }));
const downGood = html(h(Trend, { value: -12, goodWhen: "down" }));
ok("a fall is critical when up is good", down.includes(textOn(T.semantic.critical)));
ok("...and positive when down is good", downGood.includes(T.semantic.positive));

ok("no change is neither", html(h(Trend, { value: 0 })).includes(T.content.tertiary));

// Direction must survive for a reader who cannot see the colour.
ok("the direction is stated in text, not only in colour",
   /increase|decrease/.test(up) && /increase|decrease/.test(down));

// ══════════════════════════════════════════════════════════════════
group("A fill-only colour never reaches the screen as text");

// This is the discipline the whole palette rests on. A tone arriving from
// DATA may be any value in the palette, and the call site does not know which.
for (const [name, fill] of [["cobalt", T.brand.blue], ["critical red", T.semantic.critical]]) {
  const m = html(h(Metric, { label: "x", value: 42, tone: fill }));
  ok(`a Metric toned ${name} renders the readable half`, m.includes(textOn(fill)));
  ok(`...and not the fill itself as text`, !new RegExp(`color:${fill}[;"]`).test(m));

  const r = html(h(StatRow, { label: "x", value: 42, tone: fill }));
  ok(`a StatRow toned ${name} renders the readable half`, r.includes(textOn(fill)));
}
const pill = html(h(StatusPill, { status: "critical" }));
ok("an urgent status pill reads in the readable half", pill.includes(textOn(T.semantic.critical)));
ok("...while its fill stays the true critical colour", pill.includes(`${T.semantic.critical}14`));

// ══════════════════════════════════════════════════════════════════
group("State is said in shape as well as colour");

ok("live carries a pulsing dot", /live-dot/.test(html(h(StatusPill, { status: "live" }))));
ok("...and complete does not", !/live-dot/.test(html(h(StatusPill, { status: "complete" }))));
ok("every status still renders a word, not only a colour",
   ["live", "upcoming", "complete", "warning", "critical"]
     .every((s) => /[A-Za-z]{3,}/.test(html(h(StatusPill, { status: s })).replace(/<[^>]+>/g, ""))));
ok("an unknown status degrades to upcoming rather than blank",
   html(h(StatusPill, { status: "nonsense" })).replace(/<[^>]+>/g, "").trim() === "Upcoming");

// ══════════════════════════════════════════════════════════════════
group("Controls are operable without a mouse");

const seg = html(h(SegmentedControl, {
  options: ["Batting", "Bowling"], value: "Batting", onChange: () => {}, label: "Discipline",
}));
ok("a segmented control is a radiogroup", /role="radiogroup"/.test(seg));
ok("...with a name", /aria-label="Discipline"/.test(seg));
ok("...and each option announces whether it is chosen",
   (seg.match(/aria-checked="true"/g) ?? []).length === 1 &&
   (seg.match(/aria-checked="false"/g) ?? []).length === 1);

// ══════════════════════════════════════════════════════════════════
group("A sparkline draws to one scale");

const flat = html(h(Sparkline, { points: [5, 5, 5, 5] }));
const zeroes = html(h(Sparkline, { points: [0, 0, 0, 0] }));
ok("a flat series still draws a line", /<path/.test(flat));
// Steady is a finding, and it must not draw the same picture as no data.
const yOf = (svg) => [...svg.matchAll(/[ML]-?\d+\.?\d*,(-?\d+\.?\d*)/g)].map((m) => Number(m[1]));
ok("...through the middle, not along the floor",
   yOf(flat).filter((v) => v !== 28).every((v) => Math.abs(v - 14) < 0.01),
   "steady and unrecorded must not look identical");
ok("a steady high series and a steady zero series draw alike, because both are steady",
   yOf(flat).join() === yOf(zeroes).join());
ok("a single point draws nothing rather than a misleading flat line",
   html(h(Sparkline, { points: [7] })) === "");
ok("an empty series draws nothing", html(h(Sparkline, { points: [] })) === "");

const rising = html(h(Sparkline, { points: [1, 4, 9] }));
ok("the latest point is emphasised", /<circle/.test(rising));
ok("...and the series is described for a screen reader", /aria-label=/.test(rising));
ok("the drawing stays inside its own box", (() => {
  const nums = [...rising.matchAll(/[ML](-?\d+\.?\d*),(-?\d+\.?\d*)/g)];
  return nums.length > 0 && nums.every(([, x, y]) =>
    Number(x) >= 0 && Number(x) <= 96 && Number(y) >= 0 && Number(y) <= 28);
})());

// ══════════════════════════════════════════════════════════════════
//
// A dialog is a trap unless it says what it is and can be left. This drew a
// backdrop over the whole viewport and listened for nothing: no Escape, no
// backdrop click, no role, no name. The browser walk caught it as a nav click
// that timed out three screens later, which is a long way from the cause.
//
// These are the static half — the semantics a screen reader reads. The
// behavioural half (Escape actually closes it, and the app is usable again
// afterwards) cannot be asserted from a static render, because the handler
// lives in an effect that never runs here; it is asserted in
// tools/smoke-browser-read.mjs against a real browser.
group("A dialog says what it is, and can be left");

const dlg = html(h(Modal, { title: "Edit User", onClose: () => {} }, "body"));

ok("the card is a dialog", /role="dialog"/.test(dlg));
ok("...and a modal one, so the rest of the page is out of play",
   /aria-modal="true"/.test(dlg));
ok("...named by its own heading, not by a guess", (() => {
  const labelled = (dlg.match(/aria-labelledby="([^"]+)"/) ?? [])[1];
  if (!labelled) return false;
  // The id must actually be ON the heading that carries the title, or the
  // name announced is empty — which is the same as having no name at all.
  const heading = dlg.match(new RegExp(`<h3 id="${labelled.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&")}"[^>]*>([^<]*)</h3>`));
  return !!heading && heading[1] === "Edit User";
})());
ok("the close control has a name a voice user can say",
   /aria-label="Close dialog"/.test(dlg));
ok("...because its visible label is a glyph nobody can pronounce",
   dlg.includes("\u2715"));
ok("the card can take focus, so opening it can move focus into it",
   /tabindex="-1"/.test(dlg));
ok("the backdrop is addressable, so a walk can prove it dismisses",
   /data-testid="modal-backdrop"/.test(dlg));
ok("the body is rendered inside the dialog, not beside it",
   dlg.indexOf("body") > dlg.indexOf('role="dialog"'));

// ══════════════════════════════════════════════════════════════════
group("The grid holds together");

ok("the bento grid is the twelve-column one", /class="os-bento"/.test(html(h(Bento, null, "x"))));
ok("a metric group fits its columns to what it holds",
   /auto-fit/.test(html(h(MetricGroup, null, "x"))));
ok("the context bar is glass, because it floats",
   /os-glass/.test(html(h(ContextBar, null, "x"))));

console.log(`\n${"─".repeat(52)}\nDESIGN SYSTEM 2.0: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

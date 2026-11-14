/**
 * THE ICON COMPONENT AND THE SPECTATOR'S VOCABULARY (ui/icons.jsx is the
 * whole one; DESIGN_DIRECTION §3.4).
 *
 * <Icon>, <IconButton>, the twelve cricket glyphs, and the few Lucide icons
 * the spectator surfaces draw: the shared match page (tabs-core.jsx,
 * scorecard.jsx, spectator.jsx, bits.jsx, banners.jsx), the Board and the
 * state labels. Split out of icons.jsx on 14 Nov 2026 (EXPERIENCE_PASS Slice
 * 2) so the public page's static graph, which has a ceiling
 * (tools/check-bundle.mjs, 470 KB), carries these and not the app's hundred
 * Lucide icons: about 50 KB.
 *
 * ONE REGISTRY. icons.jsx adds the rest of the vocabulary to the same
 * registry when it loads, and the signed-in app's entry imports it (the shell
 * draws its icons), so in the app every name answers wherever <Icon> was
 * imported from. A module in the public page's graph imports from here and
 * may name only CORE_NAMES below or a glyph; apps/web/test/icons.test.mjs
 * holds every literal name in such a module to that list, since an unknown
 * name draws nothing.
 *
 * Everything icons.jsx's header says of size, stroke and the accessible-name
 * rule is this file's.
 */
import {
  createLucideIcon,
  ChevronDown, CloudRain, Hourglass, Lock, Pause, Play, Scale, Send, ShieldCheck, Smartphone, Sparkles, TriangleAlert, TrendingUp, Trophy, Tv,
} from "lucide-react";

// ══════════════════════════════════════════════════════════════════
//  The twelve cricket glyphs
// ══════════════════════════════════════════════════════════════════
//
// Each is a Lucide icon node: [tag, attributes] pairs on a 24 × 24 grid. The
// `key` is React's, as in Lucide's own files.

const glyph = (name, node) =>
  createLucideIcon(name, node.map(([tag, attrs], i) => [tag, { ...attrs, key: `${name}-${i}` }]));

const GLYPHS = {
  // A bat, blade down and to the left, handle up and to the right.
  bat: glyph("bat", [
    ["path", { d: "M12.1 9.1 3.1 18.1a2 2 0 0 0 2.8 2.8l9-9z" }],
    ["path", { d: "M13.5 10.5 20 4" }],
    ["path", { d: "m18.8 2.8 2.4 2.4" }],
  ]),
  // A ball, its raised seam curving round it.
  ball: glyph("ball", [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "M7 4.5a10 10 0 0 1 0 15" }],
    ["path", { d: "M10 3.2a11 11 0 0 1 0 17.6" }],
  ]),
  // Three stumps, two bails on them.
  stumps: glyph("stumps", [
    ["path", { d: "M7 7v14" }],
    ["path", { d: "M12 7v14" }],
    ["path", { d: "M17 7v14" }],
    ["path", { d: "M6 4h5" }],
    ["path", { d: "M13 4h5" }],
  ]),
  // The wicket fallen: stumps still standing, the bails in the air.
  "bails-off": glyph("bails-off", [
    ["path", { d: "M7 10v11" }],
    ["path", { d: "M12 10v11" }],
    ["path", { d: "M17 10v11" }],
    ["path", { d: "m4.5 5.5 4-2" }],
    ["path", { d: "m15.5 3 4 2.5" }],
  ]),
  // A batting glove: three padded finger rolls, the thumb, the wrist strap.
  gloves: glyph("gloves", [
    ["rect", { x: "7", y: "3", width: "3", height: "9", rx: "1.5" }],
    ["rect", { x: "10.5", y: "2", width: "3", height: "10", rx: "1.5" }],
    ["rect", { x: "14", y: "3", width: "3", height: "9", rx: "1.5" }],
    ["path", { d: "M17 11v5a5 5 0 0 1-5 5 5 5 0 0 1-5-5v-3l-2.3-2.3a1.5 1.5 0 0 1 2.1-2.1L7 8.8" }],
    ["path", { d: "M7 17h10" }],
  ]),
  // A leg pad: the long guard, its two ridges, the instep flap.
  pads: glyph("pads", [
    ["rect", { x: "7", y: "2", width: "10", height: "16", rx: "3" }],
    ["path", { d: "M10.3 5v10" }],
    ["path", { d: "M13.7 5v10" }],
    ["path", { d: "M9 18v2.5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5V18" }],
  ]),
  // A helmet from the side: dome, peak, grille.
  helmet: glyph("helmet", [
    ["path", { d: "M5 14a7.5 7.5 0 0 1 15 0" }],
    ["path", { d: "M2.5 14H14" }],
    ["path", { d: "M14 14v5.5h6V14" }],
    ["path", { d: "M14 16.8h6" }],
    ["path", { d: "M8 17.5a3 3 0 0 0 3 2.5" }],
  ]),
  // An over: six balls, two rows of three.
  overs: glyph("overs", [
    ["circle", { cx: "6", cy: "8", r: "2" }],
    ["circle", { cx: "12", cy: "8", r: "2" }],
    ["circle", { cx: "18", cy: "8", r: "2" }],
    ["circle", { cx: "6", cy: "16", r: "2" }],
    ["circle", { cx: "12", cy: "16", r: "2" }],
    ["circle", { cx: "18", cy: "16", r: "2" }],
  ]),
  // The target: rings, and the ball on its way in.
  target: glyph("target", [
    ["circle", { cx: "11", cy: "13", r: "8" }],
    ["circle", { cx: "11", cy: "13", r: "4" }],
    ["path", { d: "M11 13 20 4" }],
    ["path", { d: "M17 4h3v3" }],
  ]),
  // The scorebook, open: a tally on the left page, the ledger on the right.
  scorebook: glyph("scorebook", [
    ["path", { d: "M12 7v13" }],
    ["path", { d: "M3 5h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v13h-6a3 3 0 0 0-3 2 3 3 0 0 0-3-2H3z" }],
    ["path", { d: "M6 9v4" }],
    ["path", { d: "M8.5 9v4" }],
    ["path", { d: "M15 9.5h3" }],
    ["path", { d: "M15 12.5h3" }],
    ["path", { d: "M15 15.5h3" }],
  ]),
  // The team bus from the side.
  bus: glyph("bus", [
    ["rect", { x: "2", y: "5", width: "20", height: "12", rx: "2" }],
    ["path", { d: "M2 11h20" }],
    ["path", { d: "M8 5v6" }],
    ["path", { d: "M14 5v6" }],
    ["circle", { cx: "7", cy: "18", r: "2" }],
    ["circle", { cx: "17", cy: "18", r: "2" }],
  ]),
  // The ground: the oval, the square in the middle of it.
  ground: glyph("ground", [
    ["ellipse", { cx: "12", cy: "12", rx: "10", ry: "8" }],
    ["rect", { x: "10.5", y: "8", width: "3", height: "8", rx: ".5" }],
  ]),
};

/** The twelve, in the order the brief names them. */
const GLYPH_NAMES = Object.freeze(Object.keys(GLYPHS));

// ══════════════════════════════════════════════════════════════════
//  The spectator's Lucide icons, by their Lucide name
// ══════════════════════════════════════════════════════════════════

const CORE = {
  "chevron-down": ChevronDown,
  "cloud-rain": CloudRain,
  "hourglass": Hourglass,
  "lock": Lock,
  "pause": Pause,
  "play": Play,
  "scale": Scale,
  "send": Send,
  "shield-check": ShieldCheck,
  "smartphone": Smartphone,
  "sparkles": Sparkles,
  "triangle-alert": TriangleAlert,
  "trending-up": TrendingUp,
  "trophy": Trophy,
  "tv": Tv,
};

/** The Lucide names this module draws on its own (the public page's). */
const CORE_NAMES = Object.freeze(Object.keys(CORE).sort());

/** Every icon drawn by name: these, and the rest once icons.jsx has added them. */
const REGISTRY = { ...CORE, ...GLYPHS };

/**
 * Add icons to the one registry (icons.jsx, as it loads). A glyph keeps its
 * name: where a name is in both sets, the cricket one is drawn.
 * @param {Record<string, any>} more
 */
const addIcons = (more) => {
  for (const [k, v] of Object.entries(more)) if (!Object.prototype.hasOwnProperty.call(GLYPHS, k)) REGISTRY[k] = v;
};

/** Every name <Icon> answers to now. */
const iconNames = () => Object.keys(REGISTRY).sort();

/** True when `name` is an icon this module can draw. */
const isIcon = (name) => typeof name === "string" && Object.prototype.hasOwnProperty.call(REGISTRY, name);

// Sits on the text's baseline the way the emoji it replaces did, and never
// shrinks out of a flex row. No colour: currentColor is the point.
const INLINE = { display: "inline-block", verticalAlign: "-0.125em", flexShrink: 0 };

/**
 * One icon.
 *
 * @param {object} props
 * @param {string} props.name       a name from ICON_NAMES
 * @param {string} [props.label]    say something no word beside it says — the icon becomes an image with this name
 * @param {number|string} [props.size]  default 1em: the size of the text around it
 * @param {number} [props.strokeWidth]  default 1.75
 * @param {object} [props.style]
 */
function Icon({ name, label, size = "1em", strokeWidth = 1.75, style, ...rest }) {
  const C = isIcon(name) ? REGISTRY[name] : null;
  if (!C) {
    // An unknown name draws nothing rather than the name as text — a string
    // on a button is worse than a gap. The static test catches it first.
    if (typeof console !== "undefined") console.error(`Icon: no icon named "${name}"`);
    return null;
  }
  const a11y = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": "true", focusable: "false" };
  return <C size={size} strokeWidth={strokeWidth} style={style ? { ...INLINE, ...style } : INLINE} {...a11y} {...rest}/>;
}

/**
 * A button whose only content is an icon. The label is required: it is the
 * button's name, since nothing else on it is.
 *
 * @param {object} props
 * @param {string} props.icon
 * @param {string} props.label
 * @param {number|string} [props.size]
 */
function IconButton({ icon, label, size, children, ...rest }) {
  if (!label && typeof console !== "undefined") console.error(`IconButton "${icon}" has no label, so the button has no name`);
  return (
    <button type="button" aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size}/>
      {children}
    </button>
  );
}

export { Icon, IconButton, CORE_NAMES, GLYPH_NAMES, addIcons, iconNames, isIcon };

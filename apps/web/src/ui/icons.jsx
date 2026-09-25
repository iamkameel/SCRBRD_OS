/**
 * ICONS — one vocabulary, one component (DESIGN_DIRECTION §3.4).
 *
 * Every pictogram in the app is drawn by <Icon name="…"/> from this file. Two
 * sets sit behind the one name space:
 *
 *   - LUCIDE for the general vocabulary (calendar, bell, map-pin, users…).
 *     Imported by name, one binding per icon, so the bundler keeps only the
 *     ones listed here — lucide-react is `sideEffects: false` and nothing
 *     reaches the rest of its two thousand icons. check-bundle.mjs holds the
 *     500 KB entry ceiling.
 *   - TWELVE CRICKET GLYPHS that Lucide does not have: bat, ball, stumps,
 *     bails-off, gloves, pads, helmet, overs, target, scorebook, bus, ground.
 *     They are built with Lucide's own createLucideIcon(), on its 24px grid,
 *     so they come out of the same <svg> with the same attributes — stroke
 *     `currentColor`, round caps and joins, the same class names — and sit
 *     beside a Lucide icon indistinguishably. Draw a new one the same way:
 *     inside a 2px margin, strokes only, nothing filled that a stroke can say.
 *
 * Where a name exists in both sets, the glyph wins (`bus`, `target`): the
 * cricket set is the one drawn for this product.
 *
 * ── Size and stroke ───────────────────────────────────────────────
 * An icon is 1em square unless told otherwise, so it takes the size of the
 * text it replaces — an emoji inherited the font size of the span it sat in,
 * and so does this. Stroke is 1.75 on the 24 grid, for both sets.
 *
 * ── The accessible-name rule ──────────────────────────────────────
 *   - An icon beside words is DECORATIVE: rendered `aria-hidden`, the words
 *     are the name. This is the default.
 *   - An icon that says something no word beside it says takes `label`, and
 *     is then an image with that name (`role="img"`, `aria-label`).
 *   - An icon that is the ONLY content of a control makes the control
 *     nameless. Use <IconButton icon="…" label="…"/>, which puts the label on
 *     the button, where a screen reader and voice control look for it. It
 *     refuses (console.error, which fails `pnpm smoke`) to render without one.
 *
 * No colour here: an icon is `currentColor`, so it wears the ink of the text
 * around it in either theme, and nothing is copied out of the tokens.
 */
import {
  createLucideIcon,
  ArrowUpRight, Award, Bandage, Banknote, Bell, BookOpen, Brain, Cake, Calendar,
  CalendarDays, ChartColumn, CircleCheck, Clapperboard, ClipboardList, CloudLightning,
  CloudRain, CloudSun, Compass, CornerRightDown, Crown, Droplet, Dumbbell, Eye, Flame,
  Footprints, Gavel, GraduationCap, Hammer, Hand, HandHeart, HardHat, Handshake,
  HeartPulse, Hourglass, House, IdCard, Key, KeyRound, Landmark, LayoutDashboard,
  LayoutGrid, LifeBuoy, Lightbulb, Lock, Mail, Map as MapIcon, MapPin, Medal, Megaphone,
  Newspaper, NotebookPen, Package, Pause, Pencil, Phone, Pin, Play, Plus, Presentation,
  Printer, Puzzle, RadioTower, RotateCcw, Ruler, Scale, School, ScrollText, Search,
  Settings, ShieldCheck, Shirt, SlidersHorizontal, Smartphone, Sparkles, Sprout, Square,
  Stamp, Stethoscope, Sun, Telescope, Timer, Trash2, TrendingDown, TrendingUp,
  TriangleAlert, Trophy, Tv, Umbrella, Undo2, User, UserCog, Users, UsersRound, Van,
  Volleyball, Waves, Wind, Wrench, Zap, Armchair, LogOut, Menu, Send, Ban,
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
//  The Lucide icons in use, by their Lucide name
// ══════════════════════════════════════════════════════════════════

const LUCIDE = {
  "armchair": Armchair, "arrow-up-right": ArrowUpRight, "award": Award, "bandage": Bandage,
  "banknote": Banknote, "bell": Bell, "book-open": BookOpen, "brain": Brain, "cake": Cake,
  "calendar": Calendar, "calendar-days": CalendarDays, "chart-column": ChartColumn,
  "circle-check": CircleCheck, "clapperboard": Clapperboard, "clipboard-list": ClipboardList,
  "cloud-lightning": CloudLightning, "cloud-rain": CloudRain, "cloud-sun": CloudSun,
  "compass": Compass, "corner-right-down": CornerRightDown, "crown": Crown, "droplet": Droplet,
  "dumbbell": Dumbbell, "eye": Eye, "flame": Flame, "footprints": Footprints, "gavel": Gavel,
  "graduation-cap": GraduationCap, "hammer": Hammer, "hand": Hand, "hand-heart": HandHeart,
  "hard-hat": HardHat, "handshake": Handshake, "heart-pulse": HeartPulse, "hourglass": Hourglass,
  "house": House, "id-card": IdCard, "key": Key, "key-round": KeyRound, "landmark": Landmark,
  "layout-dashboard": LayoutDashboard, "layout-grid": LayoutGrid, "life-buoy": LifeBuoy,
  "lightbulb": Lightbulb, "lock": Lock, "mail": Mail, "map": MapIcon, "map-pin": MapPin,
  "medal": Medal, "megaphone": Megaphone, "newspaper": Newspaper, "notebook-pen": NotebookPen,
  "package": Package, "pause": Pause, "pencil": Pencil, "phone": Phone, "pin": Pin, "play": Play,
  "plus": Plus, "presentation": Presentation, "printer": Printer, "puzzle": Puzzle,
  "radio-tower": RadioTower, "rotate-ccw": RotateCcw, "ruler": Ruler, "scale": Scale,
  "school": School, "scroll-text": ScrollText, "search": Search, "settings": Settings,
  "shield-check": ShieldCheck, "shirt": Shirt, "sliders-horizontal": SlidersHorizontal,
  "smartphone": Smartphone, "sparkles": Sparkles, "sprout": Sprout, "square": Square,
  "stamp": Stamp, "stethoscope": Stethoscope, "sun": Sun, "telescope": Telescope,
  "timer": Timer, "trash-2": Trash2, "trending-down": TrendingDown, "trending-up": TrendingUp,
  "triangle-alert": TriangleAlert, "trophy": Trophy, "tv": Tv, "umbrella": Umbrella,
  "undo-2": Undo2, "user": User, "user-cog": UserCog, "users": Users, "users-round": UsersRound,
  "van": Van, "volleyball": Volleyball, "waves": Waves, "wind": Wind, "wrench": Wrench, "zap": Zap,
  "log-out": LogOut, "menu": Menu, "send": Send, "ban": Ban,
};

const REGISTRY = { ...LUCIDE, ...GLYPHS };

/** Every name <Icon> answers to. */
const ICON_NAMES = Object.freeze(Object.keys(REGISTRY).sort());

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

export { Icon, IconButton, ICON_NAMES, GLYPH_NAMES, isIcon };

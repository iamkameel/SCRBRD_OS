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
 *
 * ── Where the code lives (14 Nov 2026) ────────────────────────────
 * <Icon>, <IconButton>, the twelve glyphs and the spectator's few Lucide
 * icons are in ui/iconCore.jsx, so the public page's bundle carries them and
 * not this file's hundred (tools/check-bundle.mjs). This file adds the rest
 * to the one registry as it loads; import from here anywhere in the app.
 */
import { Icon, IconButton, GLYPH_NAMES, addIcons, iconNames, isIcon } from "./iconCore.jsx";
import {
  ArrowUpRight, Award, Bandage, Banknote, Bell, BookOpen, Brain, Cake, Calendar, CalendarDays,
  ChartColumn, ChevronLeft, CircleCheck, Clapperboard, ClipboardList, CloudLightning, CloudSun,
  Compass, CornerRightDown, Crown, Droplet, Dumbbell, Eye, Flame, Footprints, Gavel, GraduationCap,
  Hammer, Hand, HandHeart, HardHat, Handshake, HeartPulse, House, IdCard, Key, KeyRound, Landmark,
  LayoutDashboard, LayoutGrid, LifeBuoy, Lightbulb, Mail, Map as MapIcon, MapPin, Medal, Megaphone,
  Newspaper, NotebookPen, Package, Pencil, Phone, Pin, Plus, Presentation, Printer, Puzzle, RadioTower,
  RotateCcw, Ruler, School, ScrollText, Search, Settings, Shirt, SlidersHorizontal, Sprout, Square,
  Stamp, Stethoscope, Sun, Telescope, Timer, Trash2, TrendingDown, Umbrella, Undo2, User, UserCog,
  Users, UsersRound, Van, Volleyball, Waves, Wind, Wrench, Zap, Armchair, LogOut, Menu, Ban,
} from "lucide-react";

// ══════════════════════════════════════════════════════════════════
//  The Lucide icons in use, by their Lucide name (the spectator's few are
//  iconCore.jsx's own, and answer here as well)
// ══════════════════════════════════════════════════════════════════

const LUCIDE = {
  "armchair": Armchair, "arrow-up-right": ArrowUpRight, "award": Award, "bandage": Bandage,
  "banknote": Banknote, "bell": Bell, "book-open": BookOpen, "brain": Brain, "cake": Cake,
  "calendar": Calendar, "calendar-days": CalendarDays, "chart-column": ChartColumn, "chevron-left": ChevronLeft,
  "circle-check": CircleCheck, "clapperboard": Clapperboard, "clipboard-list": ClipboardList,
  "cloud-lightning": CloudLightning, "cloud-sun": CloudSun,
  "compass": Compass, "corner-right-down": CornerRightDown, "crown": Crown, "droplet": Droplet,
  "dumbbell": Dumbbell, "eye": Eye, "flame": Flame, "footprints": Footprints, "gavel": Gavel,
  "graduation-cap": GraduationCap, "hammer": Hammer, "hand": Hand, "hand-heart": HandHeart,
  "hard-hat": HardHat, "handshake": Handshake, "heart-pulse": HeartPulse,
  "house": House, "id-card": IdCard, "key": Key, "key-round": KeyRound, "landmark": Landmark,
  "layout-dashboard": LayoutDashboard, "layout-grid": LayoutGrid, "life-buoy": LifeBuoy,
  "lightbulb": Lightbulb, "mail": Mail, "map": MapIcon, "map-pin": MapPin,
  "medal": Medal, "megaphone": Megaphone, "newspaper": Newspaper, "notebook-pen": NotebookPen,
  "package": Package, "pencil": Pencil, "phone": Phone, "pin": Pin,
  "plus": Plus, "presentation": Presentation, "printer": Printer, "puzzle": Puzzle,
  "radio-tower": RadioTower, "rotate-ccw": RotateCcw, "ruler": Ruler,
  "school": School, "scroll-text": ScrollText, "search": Search, "settings": Settings,
  "shirt": Shirt, "sliders-horizontal": SlidersHorizontal,
  "sprout": Sprout, "square": Square,
  "stamp": Stamp, "stethoscope": Stethoscope, "sun": Sun, "telescope": Telescope,
  "timer": Timer, "trash-2": Trash2, "trending-down": TrendingDown,
  "umbrella": Umbrella,
  "undo-2": Undo2, "user": User, "user-cog": UserCog, "users": Users, "users-round": UsersRound,
  "van": Van, "volleyball": Volleyball, "waves": Waves, "wind": Wind, "wrench": Wrench, "zap": Zap,
  "log-out": LogOut, "menu": Menu, "ban": Ban,
};

addIcons(LUCIDE);

/** Every name <Icon> answers to. */
const ICON_NAMES = Object.freeze(iconNames());

export { Icon, IconButton, ICON_NAMES, GLYPH_NAMES, isIcon };

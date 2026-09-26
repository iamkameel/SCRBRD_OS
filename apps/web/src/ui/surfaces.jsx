import { T } from "../design/tokens.js";

// ══════════════════════════════════════════════════════════════════
//  SURFACES — Design System 2.0
// ══════════════════════════════════════════════════════════════════
//
// §4 of the refactor strategy, as code: a collection of cards is not a bento
// system. What makes it one is that SIZE COMMUNICATES IMPORTANCE, and the only
// way to keep that true is to make size a declared property of the tile rather
// than a grid-column somebody typed into a style prop.
//
// So a tile states its LEVEL, and the level decides both how much room it
// takes and how loudly it is drawn:
//
//   a — hero        the primary situation. One per screen. Live match, the
//                   player's identity, the thing that is actually happening.
//   b — primary     immediate supporting context. Readiness, what needs doing.
//   c — intelligence the analytical explanation. Form, momentum, opposition.
//   d — utility     venue, transport, officials, links. Quiet by construction.
//
// Rule 1 of §31 — one screen, one obvious visual priority — is then something
// the markup can be checked against rather than something a reviewer has to
// eyeball, which is why `Bento` refuses more than one hero in development.

/**
 * The grid. Twelve columns, collapsing to one on a phone.
 *
 * Deliberately not configurable: a second grid shape is how "the bento system"
 * becomes "some grids", and every screen then negotiates its own hierarchy.
 */
const Bento = ({ children, sx, ...rest }) => (
  <div className="os-bento" style={sx} {...rest}>{children}</div>
);

const LEVEL_CLASS = { a: "bento-a", b: "bento-b", c: "bento-c", d: "bento-d" };

/**
 * A tile.
 *
 * `level` is the only size control. There is no `span` prop and no `width`,
 * because the moment one exists the hierarchy stops being legible from the
 * markup and starts having to be measured on screen.
 *
 * `accent` tints the top hairline only. A tile does not get a coloured fill or
 * its own gradient — §22: gradients are ambient light over a REGION, and forty
 * small light sources is the pattern this system exists to replace.
 */
const BentoCard = ({ level = "c", accent, title, action, children, sx, className = "", ...rest }) => (
  <section
    // `rest` is spread FIRST, so data-* and aria-* pass through but a caller
    // cannot hand in a `style` or `className` that overwrites the level's own
    // layout. That hole is not theoretical: spread last, one `style` prop from
    // a call site silently removes the entire hierarchy the level encodes, and
    // the screen still renders — just flat, with nothing to show what broke.
    // `sx` is the sanctioned way in, and it merges rather than replaces.
    {...rest}
    className={`${LEVEL_CLASS[level] ?? LEVEL_CLASS.c} ${className}`}
    style={{
      background: level === "a" ? T.surface.raised : T.surface.base,
      border: `1px solid ${level === "a" ? T.line.normal : T.line.subtle}`,
      borderTop: accent ? `2px solid ${accent}` : undefined,
      borderRadius: T.radius.lg,
      boxShadow: level === "a" ? T.elevation.md : T.elevation.none,
      overflow: "hidden",
      ...sx,
    }}
  >
    {(title || action) && (
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm,
        padding: `${T.space.md} ${T.space.lg}`,
        borderBottom: `1px solid ${T.line.subtle}`,
      }}>
        <h2 style={{
          fontFamily: T.type.head, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          // §3.2's floor — nothing read below 12px — reaches this eyebrow too:
          // a hero's title and a utility tile's were 12/10, and 10 is a failure
          // wherever it is drawn. Level still differs by weight and colour.
          fontSize: T.role.label.fontSize,
          color: level === "a" ? T.content.secondary : T.content.tertiary,
        }}>{title}</h2>
        {action}
      </header>
    )}
    <div style={{ padding: level === "d" ? T.space.md : T.space.lg }}>{children}</div>
  </section>
);

/**
 * The hero, for a screen whose primary situation deserves the ambient light
 * rather than a border.
 *
 * This is where the page's one gradient lives (§22). It is a wash BEHIND flat
 * content, at low opacity and broad transition, not a coloured card.
 */
const HeroSurface = ({ children, tone = T.brand.cyan, sx, ...rest }) => (
  <section
    className="bento-a"
    style={{
      position: "relative",
      background: T.surface.raised,
      border: `1px solid ${T.line.normal}`,
      borderRadius: T.radius.xl,
      boxShadow: T.elevation.md,
      overflow: "hidden",
      ...sx,
    }}
    {...rest}
  >
    <div aria-hidden="true" style={{
      position: "absolute", inset: 0, pointerEvents: "none",
      background: `radial-gradient(900px 340px at 82% -30%, ${tone}1f, transparent 62%)`,
    }}/>
    <div style={{ position: "relative", padding: T.space.xl }}>{children}</div>
  </section>
);

/**
 * A flat tonal block — the 85–90% of §21. No gradient, no glass, no shadow.
 * Most of the interface should be made of this.
 */
const TonalSurface = ({ children, tone = "base", sx, ...rest }) => (
  <div style={{
    background: T.surface[tone] ?? T.surface.base,
    border: `1px solid ${T.line.subtle}`,
    borderRadius: T.radius.md,
    ...sx,
  }} {...rest}>{children}</div>
);

/**
 * Glass — the 5–10%, and only for something that FLOATS ABOVE content.
 *
 * §21 names where it belongs: navigation, the sticky match HUD, the command
 * bar, the Inspector, floating controls. It explicitly does not belong on
 * tables, scorecards, forms, financial screens or the scorer's action grid —
 * surfaces that are read closely, where a translucent background competes with
 * the text sitting on it.
 *
 * `over` is documentation with teeth: it states what this pane floats above,
 * and there is nowhere to put "a card" that reads as correct.
 */
const GlassSurface = ({ children, over = "content", sx, ...rest }) => (
  <div className="os-glass" data-over={over} style={{ borderRadius: T.radius.lg, ...sx }} {...rest}>
    {children}
  </div>
);

export { Bento, BentoCard, HeroSurface, TonalSurface, GlassSurface };

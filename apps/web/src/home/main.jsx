import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GLOBAL_CSS, T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { LIVE_PATH } from "./reads.js";

/**
 * The public home page's entry (SCRBRD-142 phase 1), built from home.html and
 * served at / and /privacy (firebase.json; serveClient in server.mjs). The app
 * lives at /app.
 *
 * Nothing signed-in is reachable from here — no App shell, no sign-in, no API
 * client, no service worker, no Firebase — and tools/check-bundle.mjs fails
 * the build if any import, static or lazy, ever brings one in. The one data
 * this page reads is /api/public/live (home/reads.js), after it has painted.
 *
 * THE SECTIONS. Each is a module in ./sections/, named below, exporting its
 * component as the default or under its own name (Hero.jsx → `Hero`). This
 * file mounts whichever exist and, for one that does not yet, a placeholder
 * that says where it goes — so the routing, the bundle check and the walks
 * stand before the screens do. Section copy is not written here (§5 is the
 * screens' work).
 *
 * The order is §6.1's, top to bottom. "Live now" first only when something is
 * live is the strip's own decision: it renders its live cards and its Today
 * list from one read, so the lead may split it around the hero.
 */
const FOUND = /** @type {Record<string, Record<string, any>>} */ (
  import.meta.glob("./sections/*.jsx", { eager: true }));

/** @param {string} name */
function sectionOf(name) {
  const mod = FOUND[`./sections/${name}.jsx`];
  return mod ? (mod.default ?? mod[name] ?? null) : null;
}

/** The page at /, in order (§6.1). */
const HOME = ["Header", "Strip", "Hero", "Tiles", "News", "Families", "Schools", "Footer"];
/** The page at /privacy (§4.2): the words, and the same header and footer. */
const PRIVACY = ["Header", "Privacy", "Footer"];

/**
 * A section not built yet: a box that names its file, and for the header the
 * one thing the page must always offer — the way into the app.
 * @param {{name: string}} p
 */
function Placeholder({ name }) {
  return (
    <section data-home-placeholder={name} style={{ padding: "16px", margin: "8px 16px", border: `1px dashed ${T.line.strong}`,
      borderRadius: "12px", color: T.content.secondary, fontFamily: "'DM Mono',monospace", fontSize: "12px" }}>
      {/* TODO(SCRBRD-142): apps/web/src/home/sections/{name}.jsx */}
      {name === "Header"
        ? <a href="/app" data-testid="home-login" style={{ color: T.content.primary, fontWeight: 700 }}>Log in</a>
        : `TODO: apps/web/src/home/sections/${name}.jsx`}
    </section>
  );
}

/** @param {{names: string[]}} p */
function Page({ names }) {
  useTheme();
  return (
    <div data-testid="home-page" data-live-read={LIVE_PATH} style={{ minHeight: "100vh", background: T.surface.canvas, color: T.content.primary }}>
      <style>{GLOBAL_CSS}</style>
      {names.map((name) => {
        const Section = sectionOf(name);
        return Section ? <Section key={name}/> : <Placeholder key={name} name={name}/>;
      })}
    </div>
  );
}

const path = window.location.pathname.replace(/\/+$/, "");
createRoot(/** @type {HTMLElement} */ (document.getElementById("root"))).render(
  <StrictMode>
    <Page names={path === "/privacy" ? PRIVACY : HOME}/>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PublicMatch } from "./PublicMatch.jsx";

/**
 * The public pages' entry (SCRBRD-083 phase 1), built to /public-app.js and
 * loaded by the HTML shells the API serves at /live/:match and
 * /scorecard/:match (services/api/public/public-api.mjs). The shell names the
 * fixture and the view on #root.
 *
 * Nothing signed-in is reachable from here — no App shell, no sign-in, no
 * API client, no service worker, no analytics — and tools/check-bundle.mjs
 * fails the build if a static import ever brings one in.
 */
const root = document.getElementById("root");
createRoot(root).render(
  <StrictMode>
    <PublicMatch matchId={root?.dataset.match ?? ""} view={root?.dataset.view ?? "live"}/>
  </StrictMode>,
);

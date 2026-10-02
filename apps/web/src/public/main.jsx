import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { PublicMatch } from "./PublicMatch.jsx";

/**
 * The public pages' entry (SCRBRD-083 phase 1), built to /public-app.js and
 * loaded by the HTML shells the API serves at /live/:match,
 * /scorecard/:match and /display/:match (services/api/public/public-api.mjs).
 * The shell names the fixture and the view on #root.
 *
 * The ground display (SCRBRD-133 G1) is a chunk of its own, fetched only by
 * /display: the live page does not pay for its panels and rotation, and
 * tools/check-bundle.mjs holds it outside this entry's static graph.
 *
 * Nothing signed-in is reachable from here — no App shell, no sign-in, no
 * API client, no service worker, no analytics — and tools/check-bundle.mjs
 * fails the build if any import, static or lazy, ever brings one in.
 */
const PublicDisplay = lazy(() => import("../display/PublicDisplay.jsx").then((m) => ({ default: m.PublicDisplay })));

const root = document.getElementById("root");
const matchId = root?.dataset.match ?? "";
const asked = root?.dataset.view;
createRoot(root).render(
  <StrictMode>
    {asked === "display"
      ? <Suspense fallback={null}><PublicDisplay matchId={matchId}/></Suspense>
      : <PublicMatch matchId={matchId} view={asked === "scorecard" ? "scorecard" : "live"}/>}
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SCRBRD_OS from "./App.jsx";

// Register the offline shell. Without it a reload with no signal cannot even
// fetch the page, so a scorer who reloads mid-over loses access to a match
// that is still safely on their device. Failure to register is not fatal —
// the app simply requires a connection to start.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SCRBRD_OS />
  </StrictMode>,
);

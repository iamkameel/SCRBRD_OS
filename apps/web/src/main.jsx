import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SCRBRD_OS from "./scrbrd_os.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SCRBRD_OS />
  </StrictMode>,
);

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The repository root, so the same .env that tools/dev.mjs hands the API
  // also supplies VITE_* variables here. Two env files for one local run is
  // how the client ends up pointed at an API the server is not running on.
  envDir: "../..",
  server: { port: 5173, host: true },
  build: { outDir: "dist", sourcemap: true },
});

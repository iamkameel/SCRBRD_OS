import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The repository root, so the same .env that tools/dev.mjs hands the API
  // also supplies VITE_* variables here. Two env files for one local run is
  // how the client ends up pointed at an API the server is not running on.
  envDir: "../..",
  server: {
    port: 5173,
    host: true,
    // `/api` is forwarded to the API by VITE, server-side, so the browser only
    // ever talks to one address. That matters away from a laptop: in a cloud
    // shell or a container the client is reached through a forwarded URL, and
    // an absolute `http://localhost:8787` in the bundle points the BROWSER at
    // its own machine, where nothing is listening. It also means no
    // cross-origin request exists to be refused, so WEB_ORIGIN is irrelevant
    // in development and the CORS rule keeps its one job: production.
    //
    // Set VITE_API_BASE= (empty) in .env to use this. An absolute base still
    // wins, so nothing here can redirect a deployed build.
    proxy: { "/api": { target: `http://localhost:${process.env.PORT || 8787}`, changeOrigin: true } },
    // Vite 6 refuses a request whose Host header it does not recognise, which
    // is a real protection: without it, a page on another site can point a
    // name at 127.0.0.1 and read this dev server's responses. It also refuses
    // every remote development environment, where the browser legitimately
    // reaches the server through a forwarded hostname and the page arrives
    // blank with "Blocked request" behind it.
    //
    // A leading dot matches the domain and its subdomains. Named suffixes
    // rather than `true`: allowing ANY host is the version of this that keeps
    // the convenience and throws away the protection.
    allowedHosts: [".cloudshell.dev", ".github.dev", ".gitpod.io", ".repl.co"],
  },
  build: { outDir: "dist", sourcemap: true },
});

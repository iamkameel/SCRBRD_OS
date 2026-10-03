import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * dist/app.html: the app's page under a second name, for Firebase Hosting
 * (SCRBRD-142 §6.2). Hosting serves an existing file before it applies any
 * rewrite, and it answers `/` with dist/index.html — so a rewrite of `/` to
 * the home page never fires while index.html is deployed. firebase.json
 * therefore leaves index.html out of the upload and rewrites `/` and
 * `/privacy` to /home.html and everything else to /app.html. index.html stays
 * the app for the dev server, serveClient and every browser walk.
 */
function appHtml() {
  let out = "";
  return {
    name: "scrbrd-app-html",
    apply: /** @type {const} */ ("build"),
    /** @param {{root: string, build: {outDir: string}}} c */
    configResolved(c) { out = resolve(c.root, c.build.outDir); },
    closeBundle() {
      if (existsSync(join(out, "index.html"))) copyFileSync(join(out, "index.html"), join(out, "app.html"));
    },
  };
}

export default defineConfig({
  plugins: [react(), appHtml()],
  // Compile-time, never runtime: `false` in every build but the browser walks'
  // own (tools/smoke-browser-matchcentre.mjs makes one with SCRBRD_TEST_HOOKS=1
  // into dist-test/). ui/ErrorBoundary.jsx reads it; with `false` the test
  // hook is dead code and is not in the bundle. check-bundle.mjs holds that.
  define: { __SCRBRD_TEST_HOOKS__: JSON.stringify(process.env.SCRBRD_TEST_HOOKS === "1") },
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
  build: {
    outDir: "dist",
    sourcemap: true,
    // Three entries. `index` is the app (index.html), served at /app. `home`
    // is the public home page (home.html, SCRBRD-142): static, signed out,
    // served at / and /privacy, with a graph of its own on the public side of
    // check-bundle's line. `public` is the signed-out
    // pages' bundle (SCRBRD-083): the API serves their HTML shells itself, with
    // the robots meta and a title per fixture, and those shells load it by a
    // FIXED name, /public-app.js — the API image does not carry dist/ and so
    // cannot know a hashed one. It is served no-cache (server.mjs serveClient,
    // and firebase.json's header), and everything it imports is hashed as usual.
    rollupOptions: {
      input: { index: "index.html", home: "home.html", public: "src/public/main.jsx" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "public" ? "public-app.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});

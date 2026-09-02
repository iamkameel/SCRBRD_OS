#!/usr/bin/env node
/**
 * SCRBRD — development API server.
 *
 * Deliberately small and dependency-light. Its job is to make the pieces
 * runnable together: the web client, the AI proxy, and a health check that
 * says plainly what is and is not wired.
 *
 * This is NOT the production API. Before launch it needs, at minimum: the
 * auth middleware from auth/ mounted so `withPrincipal()` wraps every query,
 * the read and write routes, rate limiting on anything unauthenticated, and
 * secrets from a real secret store. Those are listed in services/api/README.md
 * under "Honest status" and are tracked, not forgotten.
 *
 *   node services/api/server.mjs        # PORT=8787 by default
 */

import { createServer } from "node:http";
import { askStatGuru, describeDelivery, aiConfigured } from "./ai/ai-service.mjs";

const PORT = Number(process.env.PORT || 8787);
const ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const MAX_BODY = 64 * 1024; // an AI prompt is small; anything larger is a mistake or an attack

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": ORIGIN,
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("payload_too_large"), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

const ROUTES = {
  "POST /api/ai/statguru": async (body) => ({
    answer: await askStatGuru({ question: body.question, context: body.context }),
  }),
  "POST /api/ai/commentary": async (body) => ({
    line: await describeDelivery({ situation: body.situation }),
  }),
};

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});

  const path = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (req.method === "GET" && path === "/api/health") {
    return json(res, 200, {
      ok: true,
      ai: aiConfigured() ? "configured" : "no_credentials",
      // Said out loud so nobody mistakes this server for the real API.
      auth: "not_mounted",
      read: "not_mounted",
      write: "not_mounted",
    });
  }

  const route = ROUTES[`${req.method} ${path}`];
  if (!route) return json(res, 404, { error: "not_found" });

  try {
    return json(res, 200, await route(await readJson(req)));
  } catch (err) {
    return json(res, err.status || 500, { error: err.message || "internal_error" });
  }
});

server.listen(PORT, () => {
  console.log(`SCRBRD dev API on http://localhost:${PORT}`);
  console.log(`  AI: ${aiConfigured() ? "configured" : "NO CREDENTIALS — StatGuru and commentary will return null"}`);
  console.log(`  auth/read/write routes are not mounted yet (see services/api/README.md)`);
});

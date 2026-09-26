/**
 * Every route services/api/server.mjs mounts, read from its source, as a
 * method and a path a request can be sent to.
 *
 * For the pad's resume credential (SCRBRD-078): the claim that a credential
 * reaches five routes and nothing else is only as good as the list of
 * everything else. That list is not kept by hand here — it is read out of the
 * dispatcher itself (the EXACT table, the three route tables, and the paths
 * it answers inline), so a route added to server.mjs tomorrow is walked by
 * services/api/auth/pad-resume.test.mjs and tools/smoke-pad-resume.mjs
 * without anyone remembering to add it. It refuses to answer with a list
 * shorter than MIN_ROUTES, so a change to the file's shape that this parser
 * no longer understands fails loudly instead of walking nothing.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "services", "api", "server.mjs");
const MIN_ROUTES = 90;

/**
 * @param {{ id?: string, resources?: string[] }} [opts]
 *   id: what to put in each capture group; resources: the read/export names to sample
 * @returns {{ method: string, path: string, from: string }[]}
 */
export function mountedRoutes({ id = "00000000-0000-0000-0000-000000000000", resources = ["players", "matches"] } = {}) {
  const src = readFileSync(SERVER, "utf8");
  /** @type {{ method: string, path: string, from: string }[]} */
  const out = [];

  // The EXACT table: "METHOD /api/…": handler
  for (const m of src.matchAll(/^\s*"(GET|POST|PATCH|PUT|DELETE) (\/api\/[^"]+)":/gm))
    out.push({ method: m[1], path: m[2], from: "EXACT" });

  // The route tables: [/^…$/, "METHOD", handler, module?]
  for (const m of src.matchAll(/\[\s*\/\^(.+?)\$\/\s*,\s*"(GET|POST|PATCH|PUT|DELETE)"/g)) {
    const path = m[1].replace(/\(\[\^\/\]\+\)/g, id).replace(/\\\//g, "/");
    out.push({ method: m[2], path, from: "table" });
  }

  // Answered inline in the dispatcher.
  for (const m of src.matchAll(/req\.method === "(GET|POST)" && path === "(\/api\/[^"]+)"/g))
    out.push({ method: m[1], path: m[2], from: "inline" });
  for (const m of src.matchAll(/req\.method === "(GET|POST)" && path\.startsWith\("(\/api\/[^"]+\/)"\)/g))
    for (const r of resources) out.push({ method: m[1], path: m[2] + r, from: "inline" });
  for (const m of src.matchAll(/req\.method === "(GET|POST)" && \/\^(\\\/api.+?)\$\/\.exec\(path\)/g))
    out.push({ method: m[1], path: m[2].replace(/\(\[\^\/\]\+\)/g, "players").replace(/\\\//g, "/"), from: "inline" });

  if (out.length < MIN_ROUTES)
    throw new Error(`mounted-routes: read ${out.length} routes from server.mjs, expected at least ${MIN_ROUTES} — has its shape changed?`);
  return out;
}

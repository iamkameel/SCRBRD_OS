/**
 * Let Node import .jsx, so components can be TESTED rather than described.
 *
 * Until now every suite in this repository tested plain .js — the geometry
 * behind the wagon wheel, the policy, the scoring engine — and the components
 * themselves were checked by reading their source with a regex. That works for
 * "is this string present" and not at all for "does this component obey the
 * rule it claims to", which is the only question a design system actually
 * needs answered.
 *
 * esbuild is already in the tree (Vite depends on it), so this is a transform
 * hook rather than a new dependency. It is test-only: the browser build still
 * goes through Vite exactly as before.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

export async function load(url, context, next) {
  if (url.endsWith(".jsx")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const { code } = await transform(source, {
      loader: "jsx",
      format: "esm",
      // The automatic runtime, so a component file does not have to import
      // React just to be renderable — which is how the app itself is built.
      jsx: "automatic",
      target: "node22",
      sourcefile: url,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return next(url, context);
}

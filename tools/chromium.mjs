/**
 * Where Chromium is, for the walks that drive a real browser.
 *
 * Six smoke walks each carried the same hard-coded absolute path:
 *
 *   executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
 *
 * That is where this development container happens to keep it, pinned to a
 * build number. It exists nowhere else — not on a contributor's laptop, not on
 * a CI runner — so every browser walk was unrunnable anywhere but here, and
 * the version was pinned six times over in six files that could drift apart.
 * The first CI run is what surfaced it.
 *
 * Resolution order, most specific first:
 *
 *   1. $CHROMIUM_PATH — an explicit override, which is what CI sets.
 *   2. The container's own build, IF IT IS ACTUALLY THERE. Checked rather than
 *      assumed: a missing file here means fall through, not crash.
 *   3. Nothing — omit executablePath entirely and let playwright-core resolve
 *      its own download (honouring $PLAYWRIGHT_BROWSERS_PATH). This is the
 *      path an ordinary `npx playwright install chromium` produces.
 *
 * The flags are the same everywhere and belong here for the same reason the
 * path does: a walk that quietly differs from its five siblings in what it
 * disables is a walk whose failure means something different, and nobody would
 * know which. They were already uneven — smoke.mjs passed none of them.
 *
 * What they are for, from the walk that documented it: Chromium phones home
 * for autofill and account state, and on a sandboxed network those requests
 * hang rather than fail, which makes a healthy run look like an app timeout.
 */
import { existsSync } from "node:fs";

const CONTAINER_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** The resolved binary, or null to let playwright-core decide. */
export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync(CONTAINER_CHROMIUM)) return CONTAINER_CHROMIUM;
  return null;
}

/**
 * Launch options for `chromium.launch()`.
 *
 * Spread it: `chromium.launch({ ...launchOptions() })`. When no path resolves,
 * `executablePath` is absent rather than undefined — playwright-core treats a
 * present-but-undefined key as a request to use it, and fails.
 */
export function launchOptions(extra = {}) {
  const path = chromiumPath();
  return {
    ...(path ? { executablePath: path } : {}),
    args: ["--disable-background-networking", "--disable-sync", "--no-first-run"],
    ...extra,
  };
}

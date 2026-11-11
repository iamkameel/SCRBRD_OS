/**
 * One tap on the field places the ball and nothing else (followThrough.js).
 *
 * The field places the ball on `pointerup`, and the pad then draws the Outcome
 * keys where the field was; the browser's emulated mousedown, mouseup and
 * click for that same tap landed on the key now there, and recorded a wicket
 * or runs (Kameel, 11 Nov 2026). swallowFollowThrough() swallows the rest of
 * that tap and nothing more. Here, on a stand-in window, in plain Node:
 *
 *   A  after it, the tap's mousedown, mouseup and click reach no listener and
 *      are default-prevented;
 *   B  it ends at that click: the next click is heard;
 *   C  a new tap (pointerdown) ends it at once, so a real second tap is never lost;
 *   D  a click from the keyboard (detail 0) is never swallowed;
 *   E  it ends by itself after its time, and arming it twice leaves one;
 *   F  the field calls it on the placing pointerup, before onPlace (the source).
 *
 * Falsified: by onPointerUp calling onPlace without it (F red); by stop() not
 * stopping the click (A red); by no pointerdown disarm (C red).
 *
 *   node apps/web/test/follow-through.test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c, why = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, why); } };
const group = (t) => console.log("\n" + t);

// A stand-in window that holds capture listeners, as `window` does in a
// browser: they run before the key under the finger hears the event, and a
// stopImmediatePropagation() there means the key never does.
const caps = new Map();
globalThis.window = {
  addEventListener: (t, f, capture) => { if (capture) { if (!caps.has(t)) caps.set(t, new Set()); caps.get(t).add(f); } },
  removeEventListener: (t, f, capture) => { if (capture) caps.get(t)?.delete(f); },
};
const { swallowFollowThrough } = await import("../src/scorer/followThrough.js");

const heard = [];
const fire = (type, init = {}) => {
  const e = { type, detail: init.detail ?? 1, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  for (const f of [...(caps.get(type) ?? [])]) { f(e); if (e.stopped) break; }
  if (!e.stopped) heard.push(type);
  return e;
};
const reset = () => { heard.length = 0; };

group("A. the rest of the placing tap reaches nothing");
{
  reset();
  swallowFollowThrough();
  const md = fire("mousedown"), mu = fire("mouseup"), cl = fire("click");
  ok("its mousedown, mouseup and click are not heard", heard.length === 0, heard.join(","));
  ok("...and are default-prevented", md.defaultPrevented && mu.defaultPrevented && cl.defaultPrevented);
}

group("B. it ends at that click");
{
  reset();
  fire("click");
  ok("the next click is heard", heard.join(",") === "click", heard.join(","));
}

group("C. a new tap is never swallowed");
{
  reset();
  swallowFollowThrough();
  fire("pointerdown"); fire("mousedown"); fire("mouseup"); fire("click");
  ok("a pointerdown ends it: the new tap's events are all heard", heard.join(",") === "pointerdown,mousedown,mouseup,click", heard.join(","));
}

group("D. a click from the keyboard is never swallowed");
{
  reset();
  const end = swallowFollowThrough();
  fire("click", { detail: 0 });
  ok("Enter or Space on a key (detail 0) is heard", heard.join(",") === "click", heard.join(","));
  end();
}

group("E. it ends by itself, and arming twice leaves one");
{
  reset();
  swallowFollowThrough(20);
  swallowFollowThrough(20);
  await new Promise((r) => setTimeout(r, 60));
  fire("click");
  ok("after its time a click is heard", heard.join(",") === "click", heard.join(","));
}

group("F. the field arms it on the placing pointerup, before the ball is placed");
{
  const src = readFileSync(new URL("../src/scorer/panels.jsx", import.meta.url), "utf8");
  const up = src.split("\n").find((l) => l.includes("onPointerUp=")) ?? "";
  ok("onPointerUp: swallowFollowThrough() then onPlace(p)", /swallowFollowThrough\(\);\s*onPlace\(p\)/.test(up), up.trim());
}

console.log(`\n${"─".repeat(52)}\nFOLLOW-THROUGH SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

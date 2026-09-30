/**
 * The error boundary (ui/ErrorBoundary.jsx): a panel that throws becomes a
 * quiet card in its own place, with a way to try again, and logs its name and
 * the error's message once — never the children's data.
 *
 * There is no DOM in this suite (and React's server renderer does not run
 * error boundaries), so the class is driven the way React drives it: the
 * static a throw is turned into state by, the commit-phase hook that logs, the
 * render for each state, and the reset. The browser walk for the Match Centre
 * (smoke-browser-matchcentre) mounts it for real: a panel made to throw, its
 * neighbours still drawn, and "Try again" bringing it back.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/error-boundary.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary } from "../src/ui/ErrorBoundary.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el).replace(/&#x27;|&#39;/g, "'");

/** A boundary as React would hold it: props set, state at its start, setState applied at once. */
function mount(props) {
  const b = new ErrorBoundary(props);
  b.props = props;
  b.setState = (u) => { b.state = { ...b.state, ...(typeof u === "function" ? u(b.state, b.props) : u) }; };
  return b;
}
/** Runs `f` with console.error captured. */
function logged(f) {
  const calls = [], real = console.error;
  console.error = (...a) => calls.push(a);
  try { f(); } finally { console.error = real; }
  return calls;
}

group("A. A panel that draws is drawn, untouched");
{
  const kid = h("p", { id: "kid" }, "the scorecard");
  const b = mount({ name: "scorecard", children: kid });
  ok("no failure at the start", b.state.failed === false);
  ok("the children are returned as they are — no wrapper to disturb the layout", b.render() === kid);
}

group("B. A throw becomes a card in its place");
{
  ok("a throw is turned into state", ErrorBoundary.getDerivedStateFromError(new Error("boom")).failed === true);
  const b = mount({ name: "scorecard", children: h("p", null, "secret child data") });
  b.state = ErrorBoundary.getDerivedStateFromError(new Error("boom"));
  const out = html(b.render());
  ok("it says so, with the panel's name", out.includes("The scorecard panel couldn't be shown."), out);
  ok("it is an alert", /role="alert"/.test(out), out);
  ok("it offers Try again", /<button[^>]*type="button"[^>]*>Try again<\/button>/.test(out), out);
  ok("the button is 44px tall", /<button[^>]*min-height:44px/.test(out), out);
  ok("none of the children's content is in the card", !out.includes("secret child data"), out);
  const plain = mount({ children: null });
  plain.state = { failed: true };
  ok("with no name it says 'This panel'", html(plain.render()).includes("This panel couldn't be shown."));
  ok("no text in the card is under 12px", !/font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px/.test(out), out);
}

group("C. It logs the name and the message, once, and nothing else");
{
  const b = mount({ name: "scorecard", children: null });
  const calls = logged(() => b.componentDidCatch(new Error("Cannot read x of y"), { componentStack: "\n    in KidsNames (at secret.jsx:1)" }));
  ok("exactly one log call", calls.length === 1, calls);
  ok("with one string argument — no objects, no stack", calls[0]?.length === 1 && typeof calls[0][0] === "string", calls[0]);
  ok("naming the panel and the message", /scorecard/.test(calls[0]?.[0]) && /Cannot read x of y/.test(calls[0]?.[0]), calls[0]);
  ok("never the component stack", !/KidsNames|secret\.jsx/.test(calls[0]?.[0]), calls[0]);
  const src = readFileSync(new URL("../src/ui/ErrorBoundary.jsx", import.meta.url), "utf8");
  const call = src.split("\n").filter((l) => /console\.(error|warn|log)\(/.test(l));
  ok("the source logs in one place, and from neither props nor state",
    call.length === 1 && !/this\.props\.(?!name)|this\.state|componentStack|info/.test(call[0]), call);
  const long = logged(() => b.componentDidCatch(new Error("x".repeat(5000)), {}));
  ok("a long message is cut", long[0][0].length < 400, long[0][0].length);
}

group("D. Try again resets it");
{
  const kid = h("p", null, "back");
  const b = mount({ name: "scorecard", children: kid });
  b.state = ErrorBoundary.getDerivedStateFromError(new Error("boom"));
  ok("failed, it is not the children", b.render() !== kid);
  b.reset();
  ok("reset clears the failure", b.state.failed === false);
  ok("and the children are drawn again", b.render() === kid);
  b.state = { failed: true };
  const button = [].concat(b.render().props.children).find((c) => c?.type === "button");
  ok("the card's button is wired to the reset", button?.props.onClick === b.reset);
}

group("E. The test hook is inert here");
{
  const src = readFileSync(new URL("../src/ui/ErrorBoundary.jsx", import.meta.url), "utf8");
  ok("it is gated on a build-time constant, read through typeof so node is safe", /typeof __SCRBRD_TEST_HOOKS__ !== "undefined" && __SCRBRD_TEST_HOOKS__/.test(src));
  const vite = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
  ok("...which vite.config.js defines true only for SCRBRD_TEST_HOOKS=1, and false otherwise",
     /__SCRBRD_TEST_HOOKS__:\s*JSON\.stringify\(process\.env\.SCRBRD_TEST_HOOKS === "1"\)/.test(vite));
  const b = mount({ name: "scorecard", children: h("p", null, "x") });
  globalThis.window = { __SCRBRD_TEST_THROW__: "scorecard" };
  let out;
  try { out = b.render(); } finally { delete globalThis.window; }
  ok("without the flag, asking a panel to throw does nothing", out === b.props.children);
}

console.log(`\nERROR BOUNDARY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

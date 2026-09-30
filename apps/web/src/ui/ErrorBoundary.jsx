import { Component } from "react";
import { T } from "../design/tokens.js";

/**
 * ONE PANEL, ALLOWED TO FAIL ALONE.
 *
 * Until this existed a render error anywhere in the app unmounted the whole
 * tree and left a blank screen — on match day that can hide the scorer's pad.
 * A boundary around a panel turns that into a quiet card in the panel's own
 * place, with a way to try again, and leaves its neighbours and the shell
 * standing.
 *
 * WHAT IT LOGS: the panel's name and the error's message, once per failure,
 * and nothing else. Never props, never state, never the component stack: the
 * children of a boundary are screens full of children's names, health notes
 * and scores, and a log line is the one place nobody is watching what goes.
 *
 * WHAT IT MUST NOT WRAP: anything that holds input not yet sent — the pad's
 * scoring keys, its outbox and sync, the sheets open over it. A boundary that
 * caught an error there would unmount the subtree and its pending taps with
 * it. The pad's core stays ABOVE every boundary (scorer/engine.jsx says where
 * each one sits); only panels that show the match back to the scorer get one.
 *
 * `name` is the panel's name in the words a person uses ("scorecard"): it goes
 * into the card's text and into the log. Give a boundary a `key` that changes
 * when what it shows is replaced (the shell keys it on the page), or a
 * failure would follow the person to the next screen.
 *
 * TEST HOOK. The browser walks need to make ONE panel throw, to prove its
 * neighbours stand. A build made with SCRBRD_TEST_HOOKS=1 (only the walks
 * make one, into their own dist-test/) lets window.__SCRBRD_TEST_THROW__ — a
 * panel name, or an array of names — throw from inside the boundary of that
 * name. vite.config.js `define`s __SCRBRD_TEST_HOOKS__ to the literal `false`
 * in every other build, so TEST_HOOKS folds to false at build time and both
 * the branch and TestThrow are removed from the bundle: no property name to
 * find in dist/ and nothing to read (tools/check-bundle.mjs fails the build
 * if the name is ever found there). Under node, where nothing defines it,
 * `typeof` keeps the read safe and false.
 */
const TEST_HOOKS = typeof __SCRBRD_TEST_HOOKS__ !== "undefined" && __SCRBRD_TEST_HOOKS__;

/** Throws when the walk has asked for this panel to. Renders nothing. */
function TestThrow({ name }) {
  const want = window.__SCRBRD_TEST_THROW__;
  if (name && (want === name || (Array.isArray(want) && want.includes(name)))) throw new Error("test throw");
  return null;
}

export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  // The commit-phase hook, called once per caught error — unlike
  // getDerivedStateFromError, which React may call twice in development.
  componentDidCatch(error) {
    const message = String(error?.message ?? error).slice(0, 200);
    console.error(`[panel] ${this.props.name ?? "unnamed"} could not be shown: ${message}`);
  }

  reset = () => this.setState({ failed: false });

  render() {
    const { name, children } = this.props;
    if (!this.state.failed) {
      return TEST_HOOKS ? <><TestThrow name={name}/>{children}</> : children;
    }
    return (
      <div role="alert" data-testid="panel-error" data-panel={name ?? undefined}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md, flexWrap: "wrap",
          padding: `${T.space.md} ${T.space.lg}`, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg,
          background: T.surface.raised }}>
        <p style={{ ...T.role.body, color: T.content.secondary, margin: 0, minWidth: 0 }}>
          {name ? `The ${name} panel couldn't be shown.` : "This panel couldn't be shown."}
        </p>
        <button type="button" onClick={this.reset} data-testid="panel-error-retry" className="pressBtn os-state"
          style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
            background: "transparent", border: `1px solid ${T.line.strong}`, color: T.content.primary,
            fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
          Try again
        </button>
      </div>
    );
  }
}

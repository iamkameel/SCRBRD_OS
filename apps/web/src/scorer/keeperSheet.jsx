import { useState } from "react";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { Icon } from "../ui/icons.jsx";
import { Sheet } from "./ui.jsx";

/**
 * THE WICKET-KEEPER — the pad's picker (SCRBRD-126).
 *
 * The keeper is state, as the bowler is: a `keeper` event names him from the
 * next ball on. Two places ask:
 *
 *   - KeeperRow, inside the bowler sheet at the innings start and at each
 *     over's start: "Who is keeping wicket?", one tap to open the squad. It
 *     never blocks the bowler — quick scoring goes on without a keeper, and
 *     the Laws then judge a stumping as they always did.
 *   - KeeperSheet, from the pad's menu ("Change keeper"): the gloves change
 *     hands at any time, mid-over too (a keeper hurt, the bowler bowling on).
 *
 * While a keeper is recorded the wicket sheet credits a stumping to him, and
 * the server refuses one credited to anyone else. The choices are the
 * fielding squad, or a typed name for a side SCRBRD holds no roster for. No
 * Law clause numbers. Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read
 * under 12px, nothing tapped under 44px; tokens read from T while it draws.
 *
 * WALK-SAFE BY DESIGN: the row's choices stay closed until asked for, its
 * typed field's placeholder and its button's words are not the bowler
 * sheet's ("name", "Go"), so a walk that types the bowler or taps him by
 * name finds the bowler, as it always did.
 */

const label = () => ({ ...T.role.label, color: T.content.secondary, margin: 0 });
const body = () => ({ fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.4, color: T.content.secondary, margin: 0 });
const choice = (/** @type {boolean} */ on) => ({
  width: "100%", minHeight: "48px", padding: `${T.space.xs} ${T.space.md}`, borderRadius: T.radius.md,
  cursor: "pointer", textAlign: /** @type {const} */ ("left"), display: "flex", alignItems: "center", gap: T.space.sm,
  fontFamily: T.type.body, fontSize: "15px", fontWeight: on ? 600 : 500, color: T.content.primary,
  background: on ? T.surface.raised : T.surface.interactive, border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});
const small = () => ({
  minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md, cursor: "pointer",
  border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary,
  fontFamily: T.type.body, fontSize: "14px", fontWeight: 600, flexShrink: 0,
});

/**
 * The fielding squad to choose from, the keeper now marked †, and a field for
 * a typed name.
 * @param {{keeper: {id: string, name: string} | null, choices: {id: string, name: string}[], onPick: (id: string) => void}} p
 */
export function KeeperChoices({ keeper, choices, onPick }) {
  const [typed, setTyped] = useState("");
  const name = typed.trim();
  return (
    <div data-testid="keeper-choices" style={{ display: "grid", gap: T.space.xs }}>
      <div role="radiogroup" aria-label="Who is keeping wicket?" style={{ display: "grid", gap: T.space.xs, maxHeight: "240px", overflowY: "auto" }}>
        {choices.map((p) => {
          const on = keeper?.id === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} data-testid="keeper-choice" data-id={p.id}
              onClick={() => onPick(p.id)} className="pressBtn os-state" style={choice(on)}>
              <span style={{ flex: 1, minWidth: 0 }}>{p.name}{on && <span aria-label="keeping wicket"> †</span>}</span>
              {on && <span aria-hidden="true"><Icon name="circle-check"/></span>}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: T.space.xs }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Keeper not in the squad…"
          aria-label="Keeper not in the squad" data-testid="keeper-typed"
          onKeyDown={(e) => { if (e.key === "Enter" && name) onPick(name); }}
          style={{ flex: 1, minWidth: 0, minHeight: "44px", boxSizing: "border-box", padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
            border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary,
            fontFamily: T.type.body, fontSize: "15px" }}/>
        <button type="button" data-testid="keeper-typed-set" disabled={!name} onClick={() => name && onPick(name)}
          className="pressBtn os-state" style={{ ...small(), opacity: name ? 1 : 0.6, cursor: name ? "pointer" : "not-allowed" }}>
          Keeps
        </button>
      </div>
    </div>
  );
}

/**
 * Inside the bowler sheet (SCRBRD-126): who is keeping, and a way to say.
 * Closed until asked; never in the way of the bowler.
 * @param {{keeper: {id: string, name: string} | null, choices: {id: string, name: string}[], onKeeper: ((id: string) => void) | null}} p
 */
export function KeeperRow({ keeper, choices, onKeeper }) {
  useTheme();
  const [open, setOpen] = useState(false);
  if (!onKeeper) return null;
  return (
    <section data-testid="keeper-row" aria-label="Wicket-keeper"
      style={{ display: "grid", gap: T.space.sm, padding: T.space.md, marginBottom: T.space.md, borderRadius: T.radius.md,
        border: `1px solid ${T.line.normal}`, background: T.surface.base }}>
      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px" }}>
          <span style={label()}>Wicket-keeper</span>
          <span data-testid="keeper-current" style={{ fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, color: T.content.primary }}>
            {keeper ? `${keeper.name} †` : "Who is keeping wicket?"}
          </span>
        </span>
        <button type="button" data-testid="keeper-open" aria-expanded={open} onClick={() => setOpen(!open)}
          className="pressBtn os-state" style={small()}>
          {open ? "Close" : keeper ? "Change" : "Choose"}
        </button>
      </div>
      {open && <KeeperChoices keeper={keeper} choices={choices} onPick={(id) => { onKeeper(id); setOpen(false); }}/>}
    </section>
  );
}

/**
 * "Change keeper", from the pad's menu: the gloves change hands from the next
 * ball, at any point of an over.
 * @param {{keeper: {id: string, name: string} | null, choices: {id: string, name: string}[], onKeeper: (id: string) => void, onClose: () => void}} p
 */
export function KeeperSheet({ keeper, choices, onKeeper, onClose }) {
  useTheme();
  return (
    <Sheet title="Wicket-keeper" onClose={onClose}>
      <div data-testid="keeper-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.md }}>
        <p data-testid="keeper-sheet-now" style={body()}>
          {keeper ? `${keeper.name} is keeping wicket.` : "Nobody has been named as keeping wicket."} The keeper you choose keeps from the next ball. A stumping is the wicket-keeper's alone.
        </p>
        <KeeperChoices keeper={keeper} choices={choices} onPick={onKeeper}/>
      </div>
    </Sheet>
  );
}

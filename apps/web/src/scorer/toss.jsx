import { useState } from "react";
import { battingFirst } from "@scrbrd/scoring";
import { D } from "../design/tokens.js";
import { Btn, Lbl, Sheet } from "./ui.jsx";

/**
 * Who won the toss, asked before the first innings opens. SCRBRD-067.
 *
 * Shown only on a live fixture the server has no toss for (or could not be
 * asked about). The answer decides which side `innings_start` names as
 * batting, and innings_start is the one event undo will not walk past — so
 * nothing is preselected and the innings does not open until both halves
 * are chosen. Closing the sheet opens nothing: the pad then says the batting
 * side is not set, and its fix brings this back.
 *
 * `home` / `away` are the fixture's two sides (team1 / team2 as the Match
 * Centre opens the scorer). Who bats follows from the answer by the rule the
 * server uses (battingFirst, bats_first() in SQL) and is read back on the
 * button before it is pressed.
 */
export function TossSheet({ home, away, onConfirm, onClose }) {
  const [wonBy, setWonBy] = useState(null);      // "home" | "away"
  const [decision, setDecision] = useState(null); // "bat" | "bowl"
  const batsFirst = battingFirst({ wonBy, decision });
  const name = (side) => (side === "home" ? home : away) || (side === "home" ? "Home" : "Away");

  const choice = (on, color) => ({
    padding: "12px", borderRadius: D.md, cursor: "pointer",
    fontFamily: D.body, fontSize: "13px", fontWeight: 600,
    border: `1px solid ${on ? color + "66" : D.border}`,
    background: on ? `${color}14` : D.surf2,
    color: on ? color : D.textSecondary, transition: "all .2s",
  });

  return (
    <Sheet title="The toss" accent={D.emerald} onClose={onClose}>
      <div data-testid="toss-sheet" style={{ display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "8px" }}>
        <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textSecondary, lineHeight: 1.5 }}>
          No toss is recorded for this match. Who won it, and what did they choose? The side batting
          first opens the innings, and that cannot be undone on the pad.
        </div>
        <div>
          <Lbl sx={{ marginBottom: "8px" }}>Toss won by</Lbl>
          <div role="radiogroup" aria-label="Toss won by" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {["home", "away"].map((side) => (
              <button key={side} type="button" role="radio" aria-checked={wonBy === side}
                data-testid={`toss-won-${side}`} className="pressBtn"
                onClick={() => setWonBy(side)} style={choice(wonBy === side, D.emerald)}>
                {name(side)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Lbl sx={{ marginBottom: "8px" }}>{wonBy ? `${name(wonBy)} elected to…` : "Elected to…"}</Lbl>
          <div role="radiogroup" aria-label="Elected to" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {[["bat", "Bat"], ["bowl", "Bowl"]].map(([d, label]) => (
              <button key={d} type="button" role="radio" aria-checked={decision === d}
                data-testid={`toss-decision-${d}`} className="pressBtn"
                onClick={() => setDecision(d)} style={choice(decision === d, D.amber)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Btn variant="primary" size="lg" full disabled={!batsFirst} data-testid="toss-confirm"
          onClick={() => onConfirm({ wonBy, decision, batsFirst })} sx={{ borderRadius: D.md }}>
          {batsFirst ? `Open the innings — ${name(batsFirst)} to bat` : "Choose the winner and their choice"}
        </Btn>
      </div>
    </Sheet>
  );
}

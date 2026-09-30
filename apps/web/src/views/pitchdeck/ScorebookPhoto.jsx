import { HOME, AWAY, SCOREBOOK, SCOREBOOK_CARD } from "./demo.js";

/**
 * A PHOTOGRAPH OF A SCOREBOOK PAGE, DRAWN — for the deck's scorebook slide.
 *
 * It is a drawing and says so: a ruled page in a blue pen, with the same
 * invented figures as the card beside it (demo.js), so the slide can be read
 * across, page to card. No photo is fetched, decoded or stored, and no name on
 * it is anybody's. The colours are the paper's and the pen's, not the theme's:
 * a photograph of a page looks the same in daylight and in the dark.
 *
 * HOOK: "READ THE PAGES" (not built). The automatic reader lands soon, and the
 * slide is meant to show it: a sweep down the page, each line lifting off the
 * paper into the card as the reader takes it. Everything that animation needs
 * is already here and inert:
 *   - every written line is a <g data-row="n"> in reading order, so a caller
 *     can light row n as it is read;
 *   - the empty <g data-hook="read-the-pages"> draws over the page (a scan
 *     bar, boxes round the cells) and is where the animation goes;
 *   - `reading` is passed through to data-state ("idle" now); the later work
 *     sets it, and nothing else in this file needs to change.
 * Until then the group is empty and the slide is a still.
 */

const INK = "#27407a", RULE = "#a9bfd3", MARGIN = "#d98c8c", PAPER = "#f4eedb", HAND = `"Segoe Print","Bradley Hand","Chalkboard SE","Comic Sans MS",cursive`;

const surname = (n) => n.split(" ").slice(1).join(" ") || n;
const HOW = {
  caught: (b, name) => `c ${surname(name(b.fielderRef))} b ${surname(name(b.bowlerRef))}`,
  bowled: (b, name) => `b ${surname(name(b.bowlerRef))}`,
  lbw: (b, name) => `lbw b ${surname(name(b.bowlerRef))}`,
  run_out: (b, name) => `run out (${surname(name(b.fielderRef))})`,
  not_out: () => "not out",
};

const ROW_H = 25, TOP = 95;

/** @param {{ reading?: null | { row?: number } }} p */
export function ScorebookPhoto({ reading = null }) {
  const card = SCOREBOOK_CARD, name = SCOREBOOK.nameOf;
  const rows = card.batting.map((b) => ({ who: name(b.ref), how: (HOW[b.howOut] ?? (() => b.howOut))(b, name), runs: b.runs }));
  const y = (i) => TOP + i * ROW_H;
  const foot = TOP + rows.length * ROW_H;
  const e = card.extras, extras = (e.byes ?? 0) + (e.legByes ?? 0) + (e.wides ?? 0) + (e.noBalls ?? 0) + (e.penalty ?? 0);
  return (
    <figure className="deck-photo" data-testid="deck-scorebook-photo">
      <div className="deck-photo-frame">
        <svg viewBox="0 0 300 400" role="img" aria-label="A drawing of a ruled scorebook page: a batting card in blue pen, with invented names and figures.">
          <rect width="300" height="400" fill={PAPER}/>
          {/* ruled lines and the margin */}
          {Array.from({ length: 15 }, (_, i) => <line key={i} x1="0" x2="300" y1={70 + i * ROW_H} y2={70 + i * ROW_H} stroke={RULE} strokeWidth=".8"/>)}
          <line x1="22" x2="22" y1="0" y2="400" stroke={MARGIN} strokeWidth="1"/>
          <line x1="212" x2="212" y1="70" y2={foot + 3 * ROW_H} stroke={RULE} strokeWidth=".8"/>
          <line x1="256" x2="256" y1="70" y2={foot + 3 * ROW_H} stroke={RULE} strokeWidth=".8"/>
          <g fontFamily={HAND} fill={INK}>
            <g transform="rotate(-.6 40 30)">
              <text x="30" y="30" fontSize="14">{HOME.replace(" 1st XI", "")}</text>
              <text x="30" y="49" fontSize="12">v {AWAY.replace(" 1st XI", "")}</text>
            </g>
            <text x="216" y="30" fontSize="10" opacity=".8">1st XI · 20 ov.</text>
            <g fontSize="9.5" opacity=".75">
              <text x="26" y="66">Batsman</text><text x="100" y="66">How out</text><text x="216" y="66">Runs</text><text x="260" y="66">Bls</text>
            </g>
            {rows.map((r, i) => (
              <g key={r.who} data-row={i} transform={`rotate(${i % 2 ? -.5 : .4} 150 ${y(i)})`}>
                <text x="26" y={y(i) - 6} fontSize="12">{r.who}</text>
                <text x="100" y={y(i) - 6} fontSize="10.5">{r.how}</text>
                <text x="222" y={y(i) - 6} fontSize="12">{r.runs}</text>
                <text x="262" y={y(i) - 6} fontSize="10">{card.batting[i].balls}</text>
              </g>
            ))}
            <g transform="rotate(.3 150 300)">
              <text x="26" y={foot + ROW_H - 6} fontSize="11">Extras</text>
              <text x="100" y={foot + ROW_H - 6} fontSize="10">b {e.byes} lb {e.legByes} w {e.wides} nb {e.noBalls}</text>
              <text x="222" y={foot + ROW_H - 6} fontSize="12">{extras}</text>
              <text x="26" y={foot + 2 * ROW_H - 6} fontSize="13" fontWeight="700">Total</text>
              <text x="100" y={foot + 2 * ROW_H - 6} fontSize="11">{card.wickets} wkts, {card.overs} overs</text>
              <text x="216" y={foot + 2 * ROW_H - 6} fontSize="15" fontWeight="700">{card.total}</text>
              <path d={`M 212 ${foot + 2 * ROW_H + 3} q 22 5 44 -1`} stroke={INK} strokeWidth="1" fill="none"/>
              <text x="26" y={foot + 3 * ROW_H - 6} fontSize="10" opacity=".8">D.N.B.: {card.didNotBat.map((r) => surname(name(r))).join(", ")}</text>
            </g>
          </g>
          {/* HOOK: "Read the pages" — see the note at the top of this file. Empty on purpose. */}
          <g data-hook="read-the-pages" data-testid="deck-read-hook" data-state={reading ? "reading" : "idle"} aria-hidden="true"/>
        </svg>
      </div>
      <figcaption className="deck-dev-cap">The page: a photograph of a scorebook, typed in or read from the photo. Drawn here, and invented.</figcaption>
    </figure>
  );
}

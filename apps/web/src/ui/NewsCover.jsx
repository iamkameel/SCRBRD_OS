import { useId } from "react";
import { T } from "../design/tokens.js";
import { hashOf, sideLabel } from "../lib/newsFeed.js";

/**
 * A NEWS POST'S COVER, drawn in code (no photograph, no upload, no person).
 *
 * Deterministic: the same post draws the same cover every time, on every
 * device. The ground comes from the school (T.cover, picked by its name), so
 * one school's posts share a colour; the motif — stumps, the ball's seam, a
 * pitch strip, a scoreboard — and its placement come from the post's id.
 *
 * WHAT IT MAY DRAW: only what the reader already reads on the card beside it
 * — the side's code and the school's initials. On the public home page those
 * come from the public copy (db/83's public_news(): school, team_code), which
 * names no pupil, so the cover cannot either. No scoreline is drawn: no read
 * of a post carries one.
 *
 * Decorative: aria-hidden, focusable false, and nothing in it is a control.
 * The headline beside it is the real heading.
 *
 * Props
 *   seed    the post's id
 *   school  the school's name, or null (a league post)
 *   team    the side's code ("1XI", "U15A"), or null
 *   scope   "team" | "school" | "competition"
 *   ratio   CSS aspect-ratio of the box (default "16 / 9"); "auto" fills its parent
 */
const MOTIFS = ["stumps", "seam", "pitch", "board"];

/** "Westville Boys' High" → "WBH"; at most three letters. @param {unknown} name */
export function monogram(name) {
  const words = String(name ?? "").replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter((w) => w && !/^(of|the|and|&)$/i.test(w));
  return words.slice(0, 3).map((w) => w.replace(/^'+/, "")[0] || "").join("").toUpperCase();
}

/** The motif and the numbers that place it. Pure, for the tests. */
export function coverPlan({ seed, school, team, scope }) {
  const h = hashOf(seed);
  const h2 = hashOf(`${seed}·b`);
  const palette = T.cover[hashOf(school || team || seed) % T.cover.length];
  const motif = MOTIFS[h % MOTIFS.length];
  const label = scope === "team" && team ? sideLabel(team)
    : scope === "competition" ? "LEAGUE"
    : monogram(school) || "SCRBRD";
  return { palette, motif, label, jx: (h2 % 61) - 30, jy: ((h2 >>> 8) % 41) - 20, tilt: ((h2 >>> 16) % 15) - 7, bits: h2 };
}

export function NewsCover({ seed, school = null, team = null, scope = "school", ratio = "16 / 9", style }) {
  const raw = useId();
  const id = `nc${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const { palette: p, motif, label, jx, jy, tilt, bits } = coverPlan({ seed, school, team, scope });
  const ink = p.ink, acc = p.accent;
  const big = label.length <= 4 ? 168 : label.length <= 6 ? 128 : 96;
  return (
    <div className="os-news-cover" aria-hidden="true"
      style={{ position: "relative", overflow: "hidden", background: p.deep, aspectRatio: ratio === "auto" ? undefined : ratio, width: "100%", height: ratio === "auto" ? "100%" : undefined, ...style }}>
      <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1" gradientTransform={`rotate(${tilt * 3} .5 .5)`}>
            <stop offset="0" stopColor={p.ground}/>
            <stop offset="1" stopColor={p.deep}/>
          </linearGradient>
          <radialGradient id={`${id}r`} cx="0.72" cy="0.3" r="0.6">
            <stop offset="0" stopColor={acc} stopOpacity="0.32"/>
            <stop offset="1" stopColor={acc} stopOpacity="0"/>
          </radialGradient>
          <pattern id={`${id}p`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform={`rotate(${35 + tilt})`}>
            <line x1="0" y1="0" x2="0" y2="10" stroke={ink} strokeOpacity="0.045" strokeWidth="2"/>
          </pattern>
          <linearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.45" stopColor={p.deep} stopOpacity="0"/>
            <stop offset="1" stopColor={p.deep} stopOpacity="0.7"/>
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${id}g)`}/>
        <rect width="640" height="360" fill={`url(#${id}p)`}/>
        <rect width="640" height="360" fill={`url(#${id}r)`}/>
        {motif === "stumps" && <Stumps ink={ink} acc={acc} jx={jx} jy={jy}/>}
        {motif === "seam" && <Seam ink={ink} acc={acc} jx={jx} jy={jy} tilt={tilt} ground={p.ground}/>}
        {motif === "pitch" && <Pitch ink={ink} acc={acc} jx={jx} tilt={tilt}/>}
        {motif === "board" && <Board acc={acc} jx={jx} jy={jy} bits={bits} label={label}/>}
        <rect width="640" height="360" fill={`url(#${id}v)`}/>
        {motif !== "board" && (
          <text x="28" y="334" fontFamily="Syne, sans-serif" fontWeight="800" fontSize={big} letterSpacing="-4"
            fill="none" stroke={ink} strokeOpacity="0.22" strokeWidth="2">{label}</text>
        )}
        <rect x="28" y="28" width="44" height="4" rx="2" fill={acc}/>
      </svg>
    </div>
  );
}

/** Three stumps and their bails on a crease, a ball coming in on a dashed line. */
function Stumps({ ink, acc, jx, jy }) {
  const x = 450 + jx, base = 300, top = 86 + jy / 2;
  return (
    <g>
      <ellipse cx={x + 36} cy={base + 6} rx="120" ry="12" fill="#000" opacity="0.28"/>
      <line x1="300" y1={base} x2="640" y2={base} stroke={ink} strokeOpacity="0.55" strokeWidth="3"/>
      <line x1={x - 70} y1={base} x2={x - 70} y2="360" stroke={ink} strokeOpacity="0.35" strokeWidth="3"/>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={x + i * 30} y={top} width="13" height={base - top} rx="6" fill={ink} opacity={0.92 - i * 0.06}/>
      ))}
      <rect x={x - 2} y={top - 10} width="32" height="7" rx="3.5" fill={acc}/>
      <rect x={x + 30} y={top - 10} width="32" height="7" rx="3.5" fill={acc}/>
      <path d={`M 40 ${120 + jy} Q 260 ${20 + jy} ${x - 34} ${top + 70}`} fill="none" stroke={acc} strokeWidth="3" strokeDasharray="2 12" strokeLinecap="round" opacity="0.85"/>
      <circle cx={x - 34} cy={top + 70} r="17" fill={acc}/>
      <path d={`M ${x - 46} ${top + 60} q 12 10 24 20`} stroke={ink} strokeWidth="2" fill="none" opacity="0.7"/>
    </g>
  );
}

/** A ball as large as the cover, its seam stitched across it. */
function Seam({ ink, acc, jx, jy, tilt, ground }) {
  const cx = 470 + jx, cy = 180 + jy, r = 205;
  return (
    <g transform={`rotate(${tilt * 2 - 18} ${cx} ${cy})`}>
      <circle cx={cx} cy={cy} r={r} fill={ground} stroke={ink} strokeOpacity="0.22" strokeWidth="2"/>
      <circle cx={cx} cy={cy} r={r} fill={acc} opacity="0.08"/>
      <path d={`M ${cx - 46} ${cy - r + 6} Q ${cx - 110} ${cy} ${cx - 46} ${cy + r - 6}`} fill="none" stroke={acc} strokeWidth="3"/>
      <path d={`M ${cx + 46} ${cy - r + 6} Q ${cx - 18} ${cy} ${cx + 46} ${cy + r - 6}`} fill="none" stroke={acc} strokeWidth="3"/>
      <path d={`M ${cx - 62} ${cy - r + 14} Q ${cx - 128} ${cy} ${cx - 62} ${cy + r - 14}`} fill="none" stroke={ink} strokeOpacity="0.8" strokeWidth="10" strokeDasharray="2 10"/>
      <path d={`M ${cx + 62} ${cy - r + 14} Q ${cx - 2} ${cy} ${cx + 62} ${cy + r - 14}`} fill="none" stroke={ink} strokeOpacity="0.8" strokeWidth="10" strokeDasharray="2 10"/>
      <path d={`M ${cx + 70} ${cy - r + 40} A ${r - 30} ${r - 30} 0 0 1 ${cx + r - 26} ${cy - 40}`} fill="none" stroke={ink} strokeOpacity="0.28" strokeWidth="6" strokeLinecap="round"/>
    </g>
  );
}

/** A pitch strip seen from behind the bowler's arm, mown stripes either side. */
function Pitch({ ink, acc, jx, tilt }) {
  const c = 430 + jx;
  const s = T.strip;
  return (
    <g>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path key={i} d={`M ${c - 600 + i * 150} 360 L ${c - 30 + i * 18} 0 L ${c - 12 + i * 18} 0 L ${c - 525 + i * 150} 360 Z`} fill={ink} opacity={i % 2 ? 0.035 : 0.0}/>
      ))}
      <g transform={`skewX(${tilt / 2})`}>
        <path d={`M ${c - 48} 24 L ${c + 48} 24 L ${c + 150} 360 L ${c - 150} 360 Z`} fill={s.clay} opacity="0.92"/>
        <path d={`M ${c - 48} 24 L ${c + 48} 24 L ${c + 150} 360 L ${c - 150} 360 Z`} fill="none" stroke={s.edge} strokeWidth="2"/>
        <line x1={c - 64} y1="64" x2={c + 64} y2="64" stroke={s.paint} strokeWidth="3"/>
        <line x1={c - 128} y1="300" x2={c + 128} y2="300" stroke={s.paint} strokeWidth="4"/>
        <line x1={c - 26} y1="64" x2={c - 30} y2="44" stroke={s.paint} strokeWidth="2"/>
        <line x1={c + 26} y1="64" x2={c + 30} y2="44" stroke={s.paint} strokeWidth="2"/>
        {[-8, 0, 8].map((d) => <rect key={d} x={c + d - 1.5} y="40" width="3" height="20" fill={s.paint}/>)}
        {[-26, 0, 26].map((d) => <rect key={d} x={c + d - 4} y="232" width="8" height="64" rx="3" fill={s.paint}/>)}
        <path d={`M ${c - 20} 150 l 12 18 l -6 14 l 14 20`} fill="none" stroke={s.crack} strokeWidth="1.5" opacity="0.8"/>
        <path d={`M ${c + 36} 200 l -10 14 l 6 16`} fill="none" stroke={s.crackDeep} strokeWidth="1.5" opacity="0.8"/>
      </g>
      <circle cx={c - 4} cy="128" r="9" fill={acc}/>
    </g>
  );
}

/** A scoreboard panel: the side's figures, and a field of bulbs lit by the post's id. */
function Board({ acc, jx, jy, bits, label }) {
  const b = T.board;
  const x = 286 + jx / 2, y = 54 + jy / 2, w = 318, hgt = 252;
  const cols = 14, rows = 4;
  const size = label.length <= 3 ? 104 : label.length <= 5 ? 76 : 54;
  return (
    <g>
      <rect x={x + 8} y={y + 12} width={w} height={hgt} rx="12" fill="#000" opacity="0.35"/>
      <rect x={x} y={y} width={w} height={hgt} rx="12" fill={b.face} stroke={b.rule} strokeWidth="2"/>
      <line x1={x} y1={y + 150} x2={x + w} y2={y + 150} stroke={b.rule} strokeWidth="2"/>
      <rect x={x + 22} y={y + 24} width="54" height="8" rx="4" fill={b.dim}/>
      <rect x={x + w - 64} y={y + 24} width="42" height="8" rx="4" fill={acc}/>
      <text x={x + 22} y={y + 132} fontFamily="'DM Mono', monospace" fontWeight="500" fontSize={size} fill={b.figure} letterSpacing="2">{label}</text>
      {Array.from({ length: cols * rows }, (_, i) => {
        const on = ((bits >>> (i % 31)) ^ (i * 7)) & 1;
        const cx = x + 26 + (i % cols) * ((w - 52) / (cols - 1));
        const cy = y + 176 + Math.floor(i / cols) * 17;
        return <circle key={i} cx={cx} cy={cy} r="5" fill={on ? acc : b.dim} opacity={on ? 0.95 : 0.22}/>;
      })}
    </g>
  );
}

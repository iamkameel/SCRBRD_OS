// patch MatchCentreView to include weather

// ══════════════════════════════════════════════════════
//  MATCH DETAIL — deterministic scorecard synthesis (demo data)
//  Seeded by match id so every open shows the same card.
// ══════════════════════════════════════════════════════
const mulberry32 = seed => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const strSeed = s => { let h = 2166136261; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export { mulberry32, strSeed };

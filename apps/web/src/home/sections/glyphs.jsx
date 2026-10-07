/**
 * The home page's own eight glyphs, for the tiles (Tiles.jsx). Drawn here, on
 * ui/icons.jsx's 24px grid and stroke (1.75, round caps), rather than imported
 * from it: icons.jsx carries the app's whole vocabulary and Lucide with it,
 * ~60 KB of the home graph for eight pictures (tools/check-bundle.mjs). Always
 * decorative here: the tile's heading says what the glyph shows.
 */
const PATHS = {
  scorebook: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h3.5" /><circle cx="16" cy="16.5" r="1.4" /></>,
  tv: <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4M7 13l3-3 2 2 4-4" /></>,
  scale: <><path d="M12 3v18M8 21h8M5 7h14" /><path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14.4A5 5 0 0 1 21 19" /></>,
  "heart-pulse": <><path d="M20.8 8.6a5 5 0 0 0-8.8-3.2 5 5 0 0 0-8.8 3.2c0 5.4 8.8 11 8.8 11s8.8-5.6 8.8-11z" /><path d="M5 12h3l2-3 3 6 2-3h4" /></>,
  van: <><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  "shield-check": <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
};

export function Glyph({ name, size = 24 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{PATHS[name] ?? null}</svg>
  );
}

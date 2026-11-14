import { useState } from "react";
import { T } from "../../design/tokens.js";
import { Icon } from "../../ui/iconCore.jsx";

/**
 * A match page's two links outward (EXPERIENCE_PASS Slice 2), on the public
 * page and the Match Centre alike.
 *
 * SHARE (Q18, decided 13 Nov: the link, no image card). The system's share
 * sheet where the phone has one, else the link copied, else the link shown to
 * copy by hand. What is shared is the page's own link, the two sides' names
 * and the status sentence (lib/matchCentre.js statusSentence(), which names
 * sides, never a boy). The link's own preview is the public shell's, which
 * names the sides and the score and nobody else (services/api/public/
 * public-api.mjs shellHtml(), asserted in public.test.mjs). No child's name is
 * put in what leaves the page.
 *
 * GROUND DISPLAY (Q19, decided 13 Nov). The public ground display,
 * /display/:id, for a fixture its home school has published: the same address
 * the staff's Publication section gives the pavilion TV, which serves exactly
 * when the home side is published (SCRBRD-133 D2) and names by the public rule.
 * It opens nothing new; the caller passes it only for a published fixture.
 *
 * Its own chunk: the public page's static graph has a ceiling
 * (tools/check-bundle.mjs), so the public page fetches this lazily.
 *
 * @param {{share?: {url: string, title: string, text?: string} | null, display?: string | null}} p
 */
export default function PageLinks({ share = null, display = null }) {
  const [said, setSaid] = useState("");
  if (!share && !display) return null;
  const onShare = async () => {
    if (!share) return;
    setSaid("");
    try {
      if (typeof navigator.share === "function") { await navigator.share(share); return; }
      await navigator.clipboard.writeText(share.url);
      setSaid("Link copied");
    } catch (/** @type {any} */ e) {
      // Closing the sheet is not a failure; anything else leaves the link to copy by hand.
      if (e?.name !== "AbortError") setSaid(`Copy this link: ${share.url}`);
    }
  };
  const pill = { minHeight: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
    background: "transparent", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer",
    color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 500, textDecoration: "none" };
  return (
    <div data-testid="mc-page-links" style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", alignItems: "center" }}>
      {share && (
        <button type="button" onClick={onShare} data-testid="mc-share" className="pressBtn os-state" style={pill}>
          <Icon name="send"/> Share
        </button>
      )}
      {display && (
        <a href={display} target="_blank" rel="noopener noreferrer" data-testid="mc-ground-display" className="pressBtn os-state" style={pill}>
          <Icon name="tv"/> Ground display<span className="sr-only"> (opens a new tab)</span>
        </a>
      )}
      <span role="status" aria-live="polite" data-testid="mc-share-said"
        style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, overflowWrap: "anywhere", minWidth: 0 }}>{said}</span>
    </div>
  );
}

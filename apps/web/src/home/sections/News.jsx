import { useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { NewsCover } from "../../ui/NewsCover.jsx";
import { Section, homeBody, homeHead, shortDate } from "./shared.jsx";

/**
 * Public news: the five latest posts a school asked to make public and a
 * second person approved (SCRBRD-142 §3, §3.5). Pure: it is given the read's
 * answer and fetches nothing.
 *
 * Props
 *   data  the answer of GET /api/public/news (§3.2), or nothing:
 *           { posts: [{ id,
 *               school,        // the school's label, as the match header's
 *               team,          // team code, or null for a school-wide post
 *               title, body,   // team-level words; a public post names no pupil
 *               publishedAt    // ISO
 *           }] }
 *         A bare array of the same posts is read the same way. This is
 *         db/83's public_news() (id, school, team_code, title, body,
 *         published_at) as public-api.mjs names it; no author is sent.
 *         null or undefined (not yet answered, or 404 because the public
 *         pages are off): the section renders NOTHING. So does an empty list:
 *         no "no news" line, because a school with nothing to say is not news.
 *   limit  how many to show. Default 5.
 *
 * The cards are the newsfeed's (views/NewsView.jsx): the newest is the lead
 * story, the rest a grid. Each has a cover drawn in code (ui/NewsCover.jsx)
 * from what the public copy already shows — the school's name and the side's
 * code — and nothing else: no photograph, no person, no score. No author is
 * drawn either, because none is sent.
 *
 * The body is plain text, shown as written (line breaks kept, never read as
 * markup), clamped to four lines; "More" opens it in place. Each card is at
 * #news-<id>, the link the newsfeed's Share gives for a post on this page.
 */
const postsOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.posts) ? data.posts : null);

const LONG = 240;   // a body past this many characters is clamped; it is a guess at four lines, the clamp itself is CSS

function Post({ p, lead, index, open: startOpen }) {
  const [open, setOpen] = useState(!!startOpen);
  useEffect(() => { if (startOpen) setOpen(true); }, [startOpen]);
  const text = String(p.body ?? "");
  const long = text.length > LONG;
  const chip = [p.school, p.team].filter(Boolean).join(" ");
  const when = shortDate(p.publishedAt);
  const clamp = long && !open
    ? { display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }
    : {};
  return (
    <article id={`news-${p.id}`} data-testid="home-news-post" className={`os-news-in${lead ? " os-news-lead" : ""}`}
      style={{ animationDelay: `${Math.min(index, 6) * 50}ms`, borderRadius: T.radius.lg, border: `1px solid ${T.line.subtle}`, background: T.fill.panel, overflow: "hidden",
               display: lead ? undefined : "flex", flexDirection: lead ? undefined : "column", minWidth: 0, scrollMarginTop: "84px" }}>
      <NewsCover seed={p.id} school={p.school || null} team={p.team || null} scope={p.team ? "team" : "school"} ratio="16 / 9"/>
      <div style={{ padding: lead ? T.space.xl : T.space.lg, display: "flex", flexDirection: "column", gap: T.space.sm, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center" }}>
          {chip && <span style={{ fontFamily: T.type.mono, fontSize: "12px", letterSpacing: "0.04em", fontWeight: 500, color: T.brand.blueText }}>{chip}</span>}
          {when && <span style={{ fontFamily: T.type.mono, fontSize: "12px", color: T.content.tertiary }}>{when}</span>}
        </div>
        <h3 style={{ ...homeHead(), fontSize: lead ? "clamp(20px, 3vw, 28px)" : "17px", fontWeight: 700, color: T.content.primary, lineHeight: 1.25, overflowWrap: "anywhere" }}>{p.title}</h3>
        <p style={{ ...homeBody(), fontSize: lead ? "16px" : "15px", color: T.content.secondary, lineHeight: 1.6, whiteSpace: long && !open ? "normal" : "pre-line", overflowWrap: "anywhere", ...clamp }}>{long && !open ? text.replace(/\s+/g, " ").trim() : text}</p>
        {long && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
            style={{ ...homeBody(), alignSelf: "flex-start", minHeight: "44px", minWidth: "44px", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: "14px", fontWeight: 600, color: T.brand.blueText, textDecoration: "underline", textUnderlineOffset: "3px" }}>
            {open ? "Less" : "More"}
          </button>
        )}
      </div>
    </article>
  );
}

/** The post a #news-<id> address names (the newsfeed's Share link), or null. */
const linked = () => {
  try { const m = /^#news-([A-Za-z0-9-]{1,64})$/.exec(window.location.hash || ""); return m ? m[1] : null; } catch { return null; }
};

export function News({ data, limit = 5 }) {
  const [target, setTarget] = useState(/** @type {string | null} */ (null));
  const all = postsOf(data);
  const posts = (all ?? []).filter((p) => p && typeof p.id === "string" && p.title).slice(0, limit);
  const ready = posts.length > 0;
  // A shared link arrives before the news does (it is read after paint), so
  // the browser's own jump to #news-<id> finds nothing: do it once it can.
  useEffect(() => {
    if (!ready) return;
    const id = linked();
    if (!id || !posts.some((p) => p.id === id)) return;
    setTarget(id);
    requestAnimationFrame(() => document.getElementById(`news-${id}`)?.scrollIntoView?.({ block: "start" }));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!all || !ready) return null;
  const [lead, ...rest] = posts;
  return (
    <Section id="home-news" label="News">
      <div style={{ display: "grid", gap: T.space.lg }}>
        <Post key={lead.id} p={lead} lead index={0} open={target === lead.id}/>
        {rest.length > 0 && (
          <div className="os-news-grid">
            {rest.map((p, i) => <Post key={p.id} p={p} index={i + 1} open={target === p.id}/>)}
          </div>
        )}
      </div>
    </Section>
  );
}

import { useState } from "react";
import { T } from "../../design/tokens.js";
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
 *               title, homeBody,   // team-level words; a public post names no pupil
 *               publishedAt    // ISO
 *           }] }
 *         A bare array of the same posts is read the same way. The route
 *         does not exist yet: this is the shape §3.2's public_news() returns
 *         (id, school label, team_code, title, homeBody, published_at), renamed
 *         to camel case; the entry maps it if the API keeps the column names.
 *         null or undefined (not yet answered, or 404 because the public
 *         pages are off): the section renders NOTHING. So does an empty list:
 *         no "no news" line, because a school with nothing to say is not news.
 *   limit  how many to show. Default 5.
 *
 * The body is plain text, shown as written (line breaks kept, never read as
 * markup), clamped to four lines; "More" opens it in place.
 */
const postsOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.posts) ? data.posts : null);

const LONG = 240;   // a body past this many characters is clamped; it is a guess at four lines, the clamp itself is CSS

function Post({ p }) {
  const [open, setOpen] = useState(false);
  const text = String(p.body ?? "");
  const long = text.length > LONG;
  const chip = [p.school, p.team].filter(Boolean).join(" ");
  const when = shortDate(p.publishedAt);
  const clamp = long && !open
    ? { display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }
    : {};
  return (
    <article data-testid="home-news-post" style={{ borderRadius: T.radius.lg, border: `1px solid ${T.line.subtle}`, background: T.fill.panel, padding: T.space.lg }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center", marginBottom: T.space.sm }}>
        {chip && <span style={{ fontFamily: T.type.mono, fontSize: "12px", color: T.brand.blueText, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, padding: "2px 10px" }}>{chip}</span>}
        {when && <span style={{ fontFamily: T.type.mono, fontSize: "12px", color: T.content.tertiary }}>{when}</span>}
      </div>
      <h3 style={{ ...homeHead(), fontSize: "16px", fontWeight: 700, color: T.content.primary, lineHeight: 1.3, marginBottom: T.space.sm }}>{p.title}</h3>
      <p style={{ ...homeBody(), fontSize: "15px", color: T.content.secondary, lineHeight: 1.55, whiteSpace: "pre-line", ...clamp }}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          style={{ ...homeBody(), minHeight: "44px", minWidth: "44px", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontSize: "14px", color: T.brand.blueText, textDecoration: "underline", textUnderlineOffset: "3px" }}>
          {open ? "Less" : "More"}
        </button>
      )}
    </article>
  );
}

export function News({ data, limit = 5 }) {
  const all = postsOf(data);
  if (!all) return null;
  const posts = all.filter((p) => p && typeof p.id === "string" && p.title).slice(0, limit);
  if (!posts.length) return null;
  return (
    <Section id="home-news" label="News" narrow>
      <div style={{ display: "grid", gap: T.space.md }}>
        {posts.map((p) => <Post key={p.id} p={p} />)}
      </div>
    </Section>
  );
}

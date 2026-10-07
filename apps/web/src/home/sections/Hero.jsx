import { useEffect, useRef } from "react";
import { LinkButton } from "./shared.jsx";

/**
 * The hero, which is the film of one delivery (SCRBRD-142 §5.2, §6.1; the
 * centrepiece Kameel asked for on 2026-10-03). The first screen is the call to
 * action over the opening shot; scrolling on plays the delivery in five shots
 * on a pinned stage, each with a caption that is a claim §5.1 allows; the last
 * shot cuts to the scoreboard, and the page's real content follows.
 *
 * Props
 *   appHref   where "Log in" goes. Default "/app".
 *   hasStrip  true when the live strip is on this page. Then "Follow a match"
 *             links to it (#matches) and the line under it says to look there.
 *             False (the default, and what a 404 from the strip leaves): no
 *             such button, and the line says to ask the school.
 *   skipTo    where "Skip the film" goes: the first thing after the film.
 *   photo     { src, alt } — THE PHOTO SLOT. A picture for the first screen,
 *             behind the words, when there is one (none is in the repo yet).
 *             It scrolls away with the first screen and the film carries on
 *             under it. A photograph of children needs the school's say and a
 *             parent's, as PUBLIC_DATA.md §3 has it, before it is put here.
 *
 * Until SCRBRD-140 ships the honest way in is the office code; when it does
 * "Log in" becomes "Sign in with Google" (§5.2). The page collects nothing.
 *
 * The drawing is film/draw.js and the clock film/engine.js. Everything the
 * film shows is decorative (aria-hidden): the words are in the captions, which
 * are real text in page order. The figures are silhouettes, nobody in
 * particular, and the scoreboard is a team's sample, labelled SAMPLE on its
 * face and in its caption. With reduced motion the stage is not drawn and the
 * five shots are a storyboard of stills, each with its caption (home/fx.js).
 */
export const SHOT_COPY = [
  { tag: "Side-on · the run-up", title: "Every ball, scored on a phone",
    say: "The scorer taps each ball on the pad as it is bowled, and can hand the match to another scorer mid-innings." },
  { tag: "Over the shoulder · the delivery", title: "No signal? Keep scoring",
    say: "The pad keeps working with no signal at the ground and sends the balls when the network returns." },
  { tag: "Overhead · the bounce", title: "Followed ball by ball",
    say: "Families follow a match on its live page, by link, with commentary written from the scorer's events." },
  { tag: "The shot · six", title: "On the ground's screen too",
    say: "Put the score on a screen in the pavilion. It shows what the public page shows, and no more." },
  { tag: "The scoreboard", title: "A name only with a parent's yes",
    say: "Until a parent agrees, a public page says \"Batter\" or \"Bowler\". The board in this film is a sample, not a real match." },
];

const INK = "#f4f6f3", SOFT = "#c9d1db", QUIET = "#a3adbb", LIME = "#b9f227";

export function Hero({ appHref = "/app", hasStrip = false, skipTo = "#home-after-film", photo = null }) {
  const section = useRef(null), stage = useRef(null), canvas = useRef(null), heroStill = useRef(null);
  const stills = useRef(/** @type {(HTMLCanvasElement | null)[]} */ ([]));

  useEffect(() => {
    let stop = () => {}, live = true;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const start = () => {
      stop();
      // Loaded after first paint, so the words and the call to action never wait on the drawing.
      import("../film/engine.js").then((film) => {
        if (!live) return;
        stop = mq?.matches
          ? film.drawStills([{ canvas: heroStill.current, shot: 0, p: 0.02 }, ...stills.current.map((c, i) => ({ canvas: c, shot: i }))])
          : film.mountFilm({ section: section.current, stage: stage.current, canvas: canvas.current });
      }).catch(() => { /* no drawing: the night backdrop (home/fx.js) and every word stay */ });
    };
    start();
    mq?.addEventListener?.("change", start);
    return () => { live = false; stop(); mq?.removeEventListener?.("change", start); };
  }, []);

  return (
    <section id="home-film" ref={section} className="film" aria-labelledby="home-hero-h">
      <div ref={stage} className="film-stage" aria-hidden="true">
        <canvas ref={canvas} className="film-canvas" />
      </div>

      <div className="film-block film-hero">
        {photo?.src && <img className="film-photo" src={photo.src} alt={photo.alt ?? ""} />}
        <canvas ref={heroStill} className="film-still" aria-hidden="true" />
        <div className="film-in">
          <p style={{ display: "inline-flex", alignItems: "center", gap: "8px", margin: "0 0 20px", padding: "7px 14px", borderRadius: "9999px",
            background: "rgba(5,8,13,0.6)", border: "1px solid rgba(255,255,255,0.18)", fontFamily: "'Syne',sans-serif", fontSize: "12px",
            fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: SOFT }}>
            <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: LIME, boxShadow: `0 0 10px ${LIME}` }} />
            KZN school cricket pilot
          </p>
          <h1 id="home-hero-h" style={{ fontFamily: "'Syne',sans-serif", margin: 0, fontSize: "clamp(32px,6.4vw,64px)", fontWeight: 700,
            color: INK, lineHeight: 1.04, letterSpacing: "-0.02em", maxWidth: "10.5em", textShadow: "0 2px 30px rgba(0,0,0,0.5)" }}>
            School cricket, scored live
            <span style={{ display: "block", color: LIME }}>and kept safe.</span>
          </h1>
          <p style={{ fontFamily: "'DM Sans',sans-serif", margin: "18px 0 24px", fontSize: "17px", color: SOFT, lineHeight: 1.6, maxWidth: "540px" }}>
            SCRBRD runs a school's cricket from the pavilion to the parent's phone. Scorers score offline, families follow live, and a child's name stays private unless a parent agrees.
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <LinkButton solid href={appHref} testId="home-cta-login">Log in</LinkButton>
            {hasStrip && <LinkButton href="#matches" testId="home-cta-follow" tone="night">Follow a match</LinkButton>}
            <LinkButton href={skipTo} testId="home-skip-film" tone="night">Skip the film</LinkButton>
          </div>
          <p data-testid="home-cta-note" style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "14px", color: QUIET, lineHeight: 1.55, margin: "16px 0 0", maxWidth: "440px" }}>
            Your school's office gives you your code.{" "}
            {hasStrip ? "On match day, ask your school for the live link, or look here." : "On match day, ask your school for the live link."}
          </p>
        </div>
        <p className="film-cue" aria-hidden="true"><i />Scroll to bowl</p>
      </div>

      <ol className="film-shots" aria-label="One delivery, in five shots">
        {SHOT_COPY.map((c, i) => (
          <li key={c.tag} className="film-block film-shot" data-shot={i + 1}>
            <canvas ref={(el) => { stills.current[i] = el; }} className="film-still" aria-hidden="true" />
            <div className="film-cap">
              <p className="film-tag">{`0${i + 1} · ${c.tag}`}</p>
              <h2>{c.title}</h2>
              <p className="film-say">{c.say}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

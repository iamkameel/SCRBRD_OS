import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GLOBAL_CSS, T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { Header, LiveStrip, Hero, Tiles, News, Families, Schools, Footer, Privacy, Seam } from "./sections/index.js";
import { homeCss } from "./fx.js";
import { LIVE_POLL_MS, anyLive, readLive, readNews } from "./reads.js";

/**
 * The public home page's entry (SCRBRD-142), built from home.html and served
 * at / and /privacy (firebase.json; serveClient in server.mjs). The app lives
 * at /app.
 *
 * Nothing signed-in is reachable from here — no App shell, no sign-in, no
 * API client, no service worker, no Firebase — and tools/check-bundle.mjs
 * fails the build if any import, static or lazy, ever brings one in. The
 * sections (./sections/) are pure; this file is the one place that reads:
 * /api/public/live once after paint, and again every 15 s while a card is
 * live and the tab is visible (D14, §6.3). A 404 (the public pages off) or a
 * failure leaves the strip hidden and the page whole.
 *
 * News (phase 3): /api/public/news once after paint, no poll — a post is not
 * a score. A 404 or a failure leaves the section hidden.
 *
 * Schools write to SCHOOLS_EMAIL (A8: the address Kameel named, 3 October 2026).
 *
 * The page opens on the film of one delivery (sections/Hero.jsx, film/), and
 * the real content follows it: the strip, the pitch, the news, the promise to
 * families, the schools. While a fixture is live the header carries a link
 * to the strip on every screen, and the hero offers "Follow a match", so a
 * parent who came for the score is one tap from it however far the film is.
 * HERO_PHOTO is the photo slot (Hero's `photo`): null until there is one.
 */
const APP = "/app";
const SCHOOLS_EMAIL = "kameel@maverickdesign.co.za";
const PRIVACY = "/privacy";
/** The first screen's photograph, { src, alt }, when there is one. See Hero.jsx before filling it. */
const HERO_PHOTO = null;

/** Today's listed fixtures: null until answered, and on a 404 or a failure. */
function useLive() {
  const [live, setLive] = useState(/** @type {Awaited<ReturnType<typeof readLive>>} */ (null));
  useEffect(() => {
    let stop = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const tick = async () => {
      const next = await readLive();
      if (stop) return;
      setLive(next);
      // Poll only while something is live; a hidden tab skips the read and
      // asks again when its turn comes round.
      if (anyLive(next)) timer = setTimeout(function again() {
        if (stop) return;
        if (document.hidden) { timer = setTimeout(again, LIVE_POLL_MS); return; }
        tick();
      }, LIVE_POLL_MS);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  return live;
}

/** The approved posts of the schools that list: null until answered, and on a 404 or a failure. */
function useNews() {
  const [news, setNews] = useState(/** @type {Awaited<ReturnType<typeof readNews>>} */ (null));
  useEffect(() => {
    let stop = false;
    readNews().then((n) => { if (!stop) setNews(n); });
    return () => { stop = true; };
  }, []);
  return news;
}

/**
 * The reveals' fallback: where CSS has no view() timeline (Firefox today), an
 * IntersectionObserver marks each `.rv` as it comes into view. <html> gets
 * `rv-io` first, and only that class lets a reveal start faded, so without
 * this script, or with reduced motion, nothing is ever held back.
 */
function useRevealFallback(key) {
  useEffect(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still || globalThis.CSS?.supports?.("animation-timeline: view()") || !("IntersectionObserver" in window)) return;
    document.documentElement.classList.add("rv-io");
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -6% 0px" });
    document.querySelectorAll(".rv:not(.in)").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);
}

function Home() {
  const live = useLive();
  const news = useNews();
  useRevealFallback(`${live ? live.fixtures.length : -1}:${news ? news.posts.length : -1}`);
  const liveNow = live ? live.fixtures.filter((f) => f?.status === "live").length : 0;
  return (
    <>
      <Header appHref={APP} logo={SCRBRD_LOGO} live={liveNow} over/>
      <main>
        <Hero appHref={APP} hasStrip={!!live} photo={HERO_PHOTO}/>
        <div id="home-after-film" tabIndex={-1} style={{ outline: "none", paddingTop: "24px" }}>
          <LiveStrip data={live} show="live"/>
          <LiveStrip data={live} show="today"/>
          <Seam/>
          <Tiles/>
          <News data={news}/>
          <Seam/>
          <Families privacyHref={PRIVACY}/>
          <Schools email={SCHOOLS_EMAIL}/>
        </div>
      </main>
      <Footer privacyHref={PRIVACY}/>
    </>
  );
}

/** @param {{privacy: boolean}} p */
function Page({ privacy }) {
  useTheme();
  return (
    <div data-testid="home-page" style={{ minHeight: "100vh", background: T.surface.canvas, color: T.content.primary }}>
      <style>{GLOBAL_CSS + homeCss()}</style>
      {privacy ? <Privacy homeHref="/" appHref={APP} logo={SCRBRD_LOGO}/> : <Home/>}
    </div>
  );
}

const path = window.location.pathname.replace(/\/+$/, "");
createRoot(/** @type {HTMLElement} */ (document.getElementById("root"))).render(
  <StrictMode>
    <Page privacy={path === PRIVACY}/>
  </StrictMode>,
);

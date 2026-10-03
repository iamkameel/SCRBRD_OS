import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GLOBAL_CSS, T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { Header, LiveStrip, Hero, Tiles, News, Families, Schools, Footer, Privacy } from "./sections/index.js";
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
 * a score. A 404 or a failure leaves the section hidden. Schools' address
 * waits on A8.
 */
const APP = "/app";
const PRIVACY = "/privacy";

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

function Home() {
  const live = useLive();
  const news = useNews();
  return (
    <>
      <Header appHref={APP} logo={SCRBRD_LOGO}/>
      <main>
        <LiveStrip data={live} show="live"/>
        <Hero appHref={APP} hasStrip={!!live}/>
        <LiveStrip data={live} show="today"/>
        <Tiles/>
        <News data={news}/>
        <Families privacyHref={PRIVACY}/>
        <Schools/>
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
      <style>{GLOBAL_CSS}</style>
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

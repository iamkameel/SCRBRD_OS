import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GLOBAL_CSS, T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { Header, LiveStrip, Hero, Tiles, News, Families, Schools, Footer, Privacy, Seam } from "./sections/index.js";
import { arrange, firstScreen } from "./sections/LiveStrip.jsx";
import { homeCss } from "./fx.js";
import { LIVE_POLL_MS, anyLive, readLive, readNews } from "./reads.js";
import { arenaMode } from "./arena/capable.js";
import { Arena } from "./arena/Arena.jsx";

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
 * families, the schools. EXCEPT on a match day (EXPERIENCE_PASS §2.3, Q6,
 * 13 Nov 2026): while a listed fixture is live its board, with the status
 * sentence, is the first screen and the film plays under it; with fixtures
 * listed and none live, Today leads; with only results, the results lead
 * (LiveStrip's firstScreen). The state is the read the page already makes.
 * While a fixture is live the header carries a link to the strip on every
 * screen. The hero's doors are Watch a match (the strip), Score a match and
 * My child plays (sign-in, then the pad or the join form).
 * HERO_PHOTO is the photo slot (Hero's `photo`): null until there is one.
 *
 * The arena (6 Nov 2026, Kameel: "make it look and feel like a modern video
 * game … continue using three.js"): after the first paint, arena/capable.js
 * picks the picture behind the words — the three.js ground (arena/Arena.jsx,
 * a lazy chunk the camera flies through as the page is read), the 2D film,
 * or with reduced motion its stills. Each section names its camera shot with
 * data-cam. A scene that fails hands back to the film (useArena).
 */
const APP = "/app";
const SCHOOLS_EMAIL = "kameel@maverickdesign.co.za";
const PRIVACY = "/privacy";
/** The first screen's photograph, { src, alt }, when there is one. See Hero.jsx before filling it. */
const HERO_PHOTO = null;

/**
 * Today's listed fixtures: null until answered, and on a 404 or a failure.
 * `answered` turns true with the first answer, whatever it was.
 */
function useLive() {
  const [live, setLive] = useState(/** @type {Awaited<ReturnType<typeof readLive>>} */ (null));
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    let stop = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const tick = async () => {
      const next = await readLive();
      if (stop) return;
      setLive(next);
      setAnswered(true);
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
  return { live, answered };
}

/** How long the page waits for the first read before it settles on the film. */
const LEAD_WAIT_MS = 400;

/**
 * The first screen, chosen ONCE per visit (EXPERIENCE_PASS §2.3, Q6). From the
 * first answer of the public read, and from nothing later: a poll that finds
 * a match ended, or a new one started, changes the cards inside the boards
 * already drawn and never what leads, so nothing moves above the reader.
 * Until the read answers (LEAD_WAIT_MS at most) the page waits with the
 * header alone; a read slower than that leaves the film first for the whole
 * visit, rather than a board arriving above a hero already painted.
 *
 * Returns null while waiting, else { first, ids }: firstScreen()'s answer and
 * the fixtures it put first, which stay in the lead slot whatever their status
 * becomes (a live match that ends shows its result where it was).
 * @param {any} live @param {boolean} answered
 */
function useLead(live, answered) {
  const [lead, setLead] = useState(/** @type {null | { first: string, ids: string[] }} */ (null));
  useEffect(() => {
    const t = setTimeout(() => setLead((l) => l ?? { first: "film", ids: [] }), LEAD_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!answered) return;
    setLead((l) => {
      if (l) return l;
      const first = firstScreen(live);
      const all = first === "film" ? [] : arrange(live.fixtures);
      const ids = (first === "live" ? all.filter((f) => f.status === "live")
        : all.filter((f) => f.status !== "live")).map((f) => f.id);
      return { first, ids };
    });
  }, [answered, live]);
  return lead;
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

/**
 * Which picture is behind the page: null until after the first paint (the
 * words never wait on the choice), then arena/capable.js's answer, asked
 * again when reduced motion is switched. A 3D scene that fails is replaced
 * by the film for the rest of the visit.
 */
function useArena() {
  const [mode, setMode] = useState(/** @type {ReturnType<typeof arenaMode> | null} */ (null));
  const failed = useRef(false);
  const pick = useCallback(() => {
    const m = arenaMode();
    setMode(failed.current && m.mode === "3d" ? { mode: "film", forced: false } : m);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    pick();
    mq?.addEventListener?.("change", pick);
    return () => mq?.removeEventListener?.("change", pick);
  }, [pick]);
  const fail = useCallback(() => { failed.current = true; pick(); }, [pick]);
  return { arena: mode, fail };
}

function Home() {
  const { arena, fail } = useArena();
  const { live, answered } = useLive();
  const news = useNews();
  useRevealFallback(`${live ? live.fixtures.length : -1}:${news ? news.posts.length : -1}`);
  const liveNow = live ? live.fixtures.filter((f) => f?.status === "live").length : 0;
  const mode = arena?.mode ?? "wait";
  // The first screen, chosen once from the first read (useLead): a live
  // board, today's first start or a result leads, above the film; with
  // nothing listed the film is first, as before. Every later poll updates the
  // fixtures in place: the ones that led stay above the film, the rest below.
  const lead = useLead(live, answered);
  // A poll that fails keeps the last answer on the page rather than emptying the boards.
  const kept = useRef(/** @type {any} */ (null));
  if (live) kept.current = live;
  const shown = kept.current;
  const leads = !!lead && lead.first !== "film";
  const fixtures = shown ? shown.fixtures : [];
  const top = leads ? { ...shown, fixtures: fixtures.filter((f) => lead.ids.includes(f?.id)) } : null;
  const rest = leads ? fixtures.filter((f) => !lead.ids.includes(f?.id)) : null;
  const below = !leads ? shown : rest.length ? { ...shown, fixtures: rest } : null;
  return (
    <>
      <Header appHref={APP} logo={SCRBRD_LOGO} live={liveNow} over/>
      <main data-arena={mode} data-first={lead ? lead.first : "wait"} style={lead ? undefined : { minHeight: "100vh" }}>
        {lead && <>
          {arena?.mode === "3d" && <Arena forced={arena.forced} onFail={fail}/>}
          {leads && <LiveStrip data={top} lead/>}
          <Hero appHref={APP} hasStrip={!!shown} photo={HERO_PHOTO} mode={mode}/>
          <div id="home-after-film" tabIndex={-1} style={{ outline: "none", paddingTop: "24px" }}>
            <LiveStrip data={below} ids={leads ? ["more-matches", "more-today"] : undefined}/>
          <Seam/>
          <Tiles/>
          <News data={news}/>
          <Seam/>
          <Families privacyHref={PRIVACY}/>
          <Schools email={SCHOOLS_EMAIL}/>
          </div>
        </>}
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

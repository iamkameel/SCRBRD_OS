/**
 * The home page's sections, in page order (SCRBRD-142 §6.1, phone first).
 * The entry (src/home/main.jsx) composes them; every one is pure, takes props
 * and fetches nothing. Prop shapes are in each file's header.
 *
 *   Header                          logo, the over, Live (while one is), Log in
 *   Hero                            the film of one delivery: the sentence and
 *                                   the call to action, then five shots
 *   LiveStrip show="live"           Live now: only when a listed fixture is live
 *   LiveStrip show="today"          Today: the rest, or "No matches listed today"
 *   Tiles                           what SCRBRD does
 *   News                            the five latest public posts
 *   Families                        the promise, and the way to /privacy
 *   Schools                         Bring SCRBRD to your school
 *   Footer                          Privacy, and the analytics toggle
 *
 * LiveStrip and News render nothing until given data and when the read
 * answers 404 (pass null). Privacy is the /privacy page, whole.
 */
import { Header } from "./Header.jsx";
import { LiveStrip } from "./LiveStrip.jsx";
import { Hero } from "./Hero.jsx";
import { Tiles } from "./Tiles.jsx";
import { News } from "./News.jsx";
import { Families } from "./Families.jsx";
import { Schools } from "./Schools.jsx";
import { Footer, AnalyticsToggle, ANALYTICS_PREF, setAnalyticsPref } from "./Footer.jsx";
import { Privacy } from "./Privacy.jsx";
import { Seam } from "./shared.jsx";

export { Header, LiveStrip, Hero, Tiles, News, Families, Schools, Footer, AnalyticsToggle, ANALYTICS_PREF, setAnalyticsPref, Privacy, Seam };

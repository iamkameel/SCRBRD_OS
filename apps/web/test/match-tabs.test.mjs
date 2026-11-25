/**
 * CRI-1.3: the match page's tabs on a phone and one address per tab
 * (lib/matchTabs.js, views/matchcentre/tabStrip.jsx). The split — Summary,
 * Scorecard and Commentary in the strip, the rest under More, the reader's own
 * tab first among them — the addresses both ways for the signed-in Match
 * Centre and the public page, and the strip's markup: a tablist, More as a
 * menu button naming the tab chosen under it, and the menu's motion taken away
 * under reduced motion.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/match-tabs.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_MATCHES, COACH_STRIP_TABS, NARROW_PX, PUBLIC_LIVE_TABS, STRIP_TABS, appPath, homeTab, parseAppPath, parsePublicPath, publicPath, splitTabs, tabOr } from "../src/lib/matchTabs.js";
import { menuCss, TabStrip, panelLabel } from "../src/views/matchcentre/tabStrip.jsx";
import { GLOBAL_CSS, T } from "../src/design/tokens.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const SIX = [
  { id: "summary", label: "Summary" }, { id: "scorecard", label: "Scorecard" }, { id: "commentary", label: "Commentary" },
  { id: "partnerships", label: "Partnerships" }, { id: "analytics", label: "Analytics" }, { id: "details", label: "Match details" },
];
const withRole = (id, label) => [SIX[0], { id, label }, ...SIX.slice(1)];
// Slice 10 (question 7): the coach's tab is his first.
const COACH = [{ id: "coach", label: "Coach" }, ...SIX];
const ids = (xs) => xs.map((t) => t.id).join(",");

group("The split");
{
  const wide = splitTabs(COACH, false);
  ok("wide: every tab in the strip, the coach's first, and no More", ids(wide.strip) === "coach,summary,scorecard,commentary,partnerships,analytics,details" && wide.more.length === 0, ids(wide.strip));
  const coach = splitTabs(COACH, true);
  ok("a coach's phone: Coach, Summary, Scorecard in the strip (§2.5)", ids(coach.strip) === COACH_STRIP_TABS.join(",") && ids(coach.strip) === "coach,summary,scorecard", ids(coach.strip));
  ok("...Commentary first under More, then Partnerships, Analytics, Match details", ids(coach.more) === "commentary,partnerships,analytics,details", ids(coach.more));
  ok("...seven tabs, each once", [...coach.strip, ...coach.more].length === 7 && new Set(ids([...coach.strip, ...coach.more]).split(",")).size === 7);
  ok("a Coach tab anywhere but first keeps the reader's strip as everyone's", ids(splitTabs(withRole("coach", "Coach"), true).strip) === STRIP_TABS.join(","));
  const cap = splitTabs(withRole("captain", "Captain"), true);
  ok("a captain's phone: Summary, Scorecard, Commentary in the strip", ids(cap.strip) === STRIP_TABS.join(","), ids(cap.strip));
  ok("...and the captain's the same way", ids(cap.more) === "captain,partnerships,analytics,details", ids(cap.more));
  const plain = splitTabs(SIX, true);
  ok("a reader with no tab of his own: three under More", ids(plain.more) === "partnerships,analytics,details", ids(plain.more));
  ok("every tab is in the strip or under More, once", [...plain.strip, ...plain.more].length === 6 && new Set(ids([...plain.strip, ...plain.more]).split(",")).size === 6);
  ok("two taps at most: the strip's in one, More's in two", plain.strip.length + (plain.more.length ? 1 : 0) === 4);
  const short = splitTabs(SIX.slice(0, 4), true);
  ok("a menu of one is never drawn: four tabs stay in the strip", short.more.length === 0 && short.strip.length === 4, ids(short.strip));
  ok("the breakpoint is the match page's phone one (640)", NARROW_PX === 640);
}

group("A tab the reader has, or the Summary");
ok("a tab he has", tabOr(SIX, "analytics") === "analytics");
ok("a role tab he does not hold, from an old link: the Summary", tabOr(SIX, "coach") === "summary");
ok("nothing asked: the Summary", tabOr(SIX, null) === "summary");
ok("nothing asked, on a page whose default is the Coach tab: the Coach tab", tabOr(COACH, null, "coach") === "coach");
ok("...the Summary asked: the Summary", tabOr(COACH, "summary", "coach") === "summary");
ok("...a default the reader does not hold: the Summary", tabOr(SIX, null, "coach") === "summary");

group("The page's default tab (question 7)");
ok("the coach's, before the first ball: the Coach tab", homeTab(COACH, false) === "coach");
ok("the coach's, once a ball is bowled: the Summary", homeTab(COACH, true) === "summary");
ok("anyone else's, before or after: the Summary", homeTab(SIX, false) === "summary" && homeTab(withRole("captain", "Captain"), false) === "summary");

group("The signed-in Match Centre's addresses");
{
  const id = "3f7b0c1e-1111-4222-8333-444455556666";
  ok("the Summary is the fixture's own address", appPath(id) === `/app/matches/${id}` && appPath(id, "summary") === `/app/matches/${id}`);
  ok("every other tab is one segment after it", appPath(id, "commentary") === `/app/matches/${id}/commentary` && appPath(id, "coach") === `/app/matches/${id}/coach`);
  for (const t of ["summary", "coach", "scorecard", "commentary", "partnerships", "analytics", "details", "captain"]) {
    const back = parseAppPath(appPath(id, t));
    ok(`${t}: the address reads back as the same fixture and tab`, back?.matchId === id && (back.tab ?? "summary") === t, back);
  }
  ok("with the Coach tab the default, it is the bare address and the Summary has its segment",
     appPath(id, "coach", "coach") === `/app/matches/${id}` && appPath(id, "summary", "coach") === `/app/matches/${id}/summary`);
  ok("...which reads back as the Summary, asked", parseAppPath(`/app/matches/${id}/summary`)?.tab === "summary" && parseAppPath(`/app/matches/${id}`)?.tab === null);
  ok("the list", JSON.stringify(parseAppPath(APP_MATCHES)) === JSON.stringify({ matchId: null, tab: null }) && parseAppPath("/app/matches/") != null);
  ok("a trailing slash is the same address", parseAppPath(`/app/matches/${id}/analytics/`)?.tab === "analytics");
  ok("anything else is not the Match Centre's", [ "/", "/app", "/app/matches/x/y/z", "/app/matches/a%20b", "/app/matches/x/Commentary", "/live/x", "/app/match/x"]
    .every((p) => parseAppPath(p) === null), [ "/", "/app", "/app/matches/x/y/z"].map(parseAppPath));
}

group("The public page's addresses");
{
  const id = "77777777-0000-0000-0000-000000000001";
  ok("the Summary is /live/:id and the Scorecard /scorecard/:id, the shells it always had", publicPath(id, "summary") === `/live/${id}` && publicPath(id, "scorecard") === `/scorecard/${id}`);
  ok("the other four after /live/:id", PUBLIC_LIVE_TABS.every((t) => publicPath(id, t) === `/live/${id}/${t}`));
  for (const t of SIX.map((x) => x.id)) {
    const back = parsePublicPath(publicPath(id, t));
    ok(`${t}: reads back`, back?.matchId === id && back.tab === t, back);
  }
  ok("a tab the page does not have, or after the scorecard: not a match page", parsePublicPath(`/live/${id}/coach`) === null && parsePublicPath(`/scorecard/${id}/commentary`) === null);
  ok("the display is not the match page", parsePublicPath(`/display/${id}`) === null);
}

group("The strip's markup");
const html = (p) => renderToStaticMarkup(h(TabStrip, { setTab: () => {}, label: "Match Centre", ...p }));
{
  const wide = html({ tabs: withRole("coach", "Coach"), tab: "summary", narrow: false });
  ok("wide: one tablist of seven tabs, no More", (wide.match(/role="tab"/g) ?? []).length === 7 && !/mc-more/.test(wide) && /role="tablist"/.test(wide));
  ok("...the selected tab the one stop", (wide.match(/tabindex="0"/g) ?? []).length === 1 && /aria-selected="true"[^>]*tabindex="0"/.test(wide));
  const ph = html({ tabs: withRole("coach", "Coach"), tab: "summary", narrow: true });
  ok("a phone: three tabs in the tablist", (ph.match(/role="tab"/g) ?? []).length === 3 && /data-testid="mc-tab-commentary"/.test(ph) && !/data-testid="mc-tab-coach"/.test(ph));
  ok("...More is a menu button outside the tablist, closed", /<\/div><button[^>]*id="mc-more"/.test(ph) && /aria-haspopup="menu"/.test(ph) && /aria-expanded="false"/.test(ph));
  ok("...named More, its accessible name leading with its words", />More<svg/.test(ph) && /aria-label="More tabs"/.test(ph));
  ok("...the menu is not drawn until it is opened", !/role="menu"/.test(ph));
  ok("...13px type (the floor is 12) and 44px taps", /font-size:13px/.test(ph) && /min-height:44px/.test(ph));
  const under = html({ tabs: withRole("coach", "Coach"), tab: "analytics", narrow: true });
  ok("a tab under More: More says its name, and reads as selected", /aria-label="Analytics, more tabs"/.test(under) && />Analytics<svg/.test(under) && /data-selected="true"/.test(under));
  ok("...no strip tab is selected, and the first is still the tablist's stop", !/aria-selected="true"/.test(under) && /data-testid="mc-tab-summary"[^>]*tabindex="0"|tabindex="0"[^>]*data-testid="mc-tab-summary"/.test(under));
  ok("...and the panel is labelled by More", panelLabel(withRole("coach", "Coach"), "analytics", true) === "mc-more"
     && panelLabel(withRole("coach", "Coach"), "commentary", true) === "mc-tab-commentary" && panelLabel(SIX, "analytics", false) === "mc-tab-analytics");
}

group("The menu's motion");
// Drawn with the menu (tabStrip.jsx menuCss), not in GLOBAL_CSS: every visitor downloads the signed-in entry graph.
ok("it drops in, quickly", /\.mc-more-menu\{animation:mcMenuIn /.test(menuCss()) && /@keyframes mcMenuIn/.test(menuCss()) && menuCss().includes(T.motion.micro));
ok("under prefers-reduced-motion it simply appears", /@media \(prefers-reduced-motion: reduce\)\{\.mc-more-menu\{animation:none!important\}\}/.test(menuCss()));
ok("...and under the root's own setting", /:root\[data-reduce-motion\] \.mc-more-menu\{animation:none!important\}/.test(menuCss()));
ok("...and the global sheet does not carry it twice", !/mc-more-menu|mcMenuIn/.test(GLOBAL_CSS));

console.log(`\nMATCH TABS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

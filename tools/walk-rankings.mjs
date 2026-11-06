/**
 * "No ordered list of team-mates is drawn" — recognition R5b, for the browser
 * walks (docs/design/RECOGNITION_design.md D23, A15; STEP4 §6: "no leaderboard
 * of the team's parents' children on a family screen").
 *
 * A list of players ordered by a figure carries `data-ranking` wherever the
 * app draws one (LeagueView's RankedList and Top Performers lists, the
 * Competitions screen's Top Performers card). What a walk asks of a screen is
 * that none is there, that neither league tab that opens one is offered, and
 * that none of their titles is on screen under another mark. A team sheet in
 * batting order is not a ranking and is not looked for here.
 */

/** The titles a ranking is drawn under (LeagueView.jsx, CompetitionsView.jsx). */
export const RANKING_TITLES = /\bMVP\b|Top Run-Scorers|Top Wicket-Takers|Best Batting Index|Best Bowling Index|Top Batters|Top Bowlers|Top Performers/;

/**
 * Every ranking on the page now, each in a few words: a `data-ranking`
 * element (with how many players it lists), the Awards or Top Performers tab,
 * or a ranking's title in the main area's text. Empty means none.
 * @param {import("playwright-core").Page} page
 * @returns {Promise<string[]>}
 */
export function rankingsOnScreen(page) {
  return page.evaluate((titles) => {
    const found = [];
    for (const e of document.querySelectorAll("[data-ranking]")) {
      found.push(`${e.getAttribute("data-testid") ?? e.tagName} (${e.querySelectorAll("[data-player], [data-testid$='-row']").length} rows)`);
    }
    for (const id of ["league-tab-awards", "league-tab-performers", "season-awards"]) {
      if (document.querySelector(`[data-testid="${id}"]`)) found.push(id);
    }
    const main = document.querySelector('[data-testid="os-main"]')?.innerText ?? "";
    const title = main.match(new RegExp(titles));
    if (title) found.push(`"${title[0]}" on screen`);
    return found;
  }, RANKING_TITLES.source);
}

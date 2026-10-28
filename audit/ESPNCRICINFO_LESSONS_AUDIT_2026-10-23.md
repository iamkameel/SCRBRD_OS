# ESPNcricinfo UI/UX Audit — Lessons for SCRBRD OS

Oct 23, 2026 · @Kameel Kalyan

## Executive summary

Cricinfo wins on one thing SCRBRD OS does not yet have: a single, stable **match page grammar** that every fan, scorer and journalist has learned since 1993. Score hero at the top, a fixed tab row underneath, ball-by-ball as the spine, scorecard as the record. SCRBRD's data model is already richer than Cricinfo's public surface (shot type, zone, wagon wheel per ball), so the gap is presentation and consistency, not data.

Seven things to take:

1. **One match page, many roles.** Cricinfo serves a casual glance and a stats obsessive from the same URL, through tabs. SCRBRD currently splits this across Scorer tabs (`score`, `cards`, `analysis`, `history`) and a separate OS Match Centre.
2. **The score hero is a contract.** Team, score, overs, CRR, RRR, target, partnership, last wicket, current batters and bowler, in that order, never rearranged. SCRBRD's `DynamicBar` rotates content; the hero should not.
3. **Ball-by-ball is the product.** Every ball is a readable sentence with a coloured ball token (W, 4, 6, wide, no ball). SCRBRD logs richer data per ball but renders it as a 30-row list.
4. **The scorecard is a document.** Batting card, bowling card, extras, fall of wickets, match details, in the same order every time. Readers rely on muscle memory.
5. **Context metrics turn numbers into a story.** Forecaster win probability, projected score, Smart Stats impact. SCRBRD already computes win probability and phase splits; surface them where the reader is looking.
6. **Personalise the home, not the match.** Favourite teams and competitions pin matches to the top and drive alerts. For SCRBRD that is "my child", "my team", "my school".
7. **Do not copy their failures.** Ad interstitials at wicket moments, webview sluggishness, redesigns that broke features people relied on, and "overwhelming for casual fans" are the repeated complaints. SCRBRD has no ads, so it can own the clean version.

## Scope and method

This is a heuristic audit, not a usability test. Cricinfo's pages are client-rendered, so structural notes come from direct use of espncricinfo.com and the Cricinfo app (iOS/Android, JioStar), cross-checked against ESPN's own relaunch material, the Superstats explainers, and 2025–26 review aggregates. SCRBRD observations are grounded in `scrbrd_os.jsx` (Scorer tabs `score`, `cards`, `analysis`, `history`; `FocusPad` and `ScoringPanel` modes; `DynamicBar`; `EventOverlay`) and the project design brief.

| Surface reviewed | Cricinfo | SCRBRD counterpart |
| --- | --- | --- |
| Home / live scores list | Live score carousel, personalised feed | OS dashboard, fixtures |
| Match page: Live tab | Score hero + commentary | Wicket Hub (`score` tab) |
| Match page: Scorecard | Batting, bowling, FOW, match details | `cards` tab (`ScorecardPanel`) |
| Match page: Overs / graphs | Over-by-over, worm, run rate, win probability | `analysis` tab (`AnalysisDashboard`) |
| Match page: Squads / Table / Report | Playing XI, standings, written report | Team sheets, leagues module |
| Player and team pages | Profile, career stats, StatsGuru | Player Passport (spec stage) |
| App: alerts and favourites | Push alerts per team/match | Parent broadcast (roadmap) |

Where Cricinfo's behaviour could not be verified against a live page it is marked as observed rather than sourced.

## Information architecture and navigation

Cricinfo's IA is shallow and predictable: three levels, and the third level is always the same set of tabs. That predictability is the asset.

**Level 1, global.** Top bar: Live Scores, Series, Teams, News, Features, Videos, Stats, plus search. On mobile this collapses to a bottom bar (Home, Scores, News, Videos, More). The live scores list is one tap from anywhere.

**Level 2, the live scores list.** Matches grouped by series, each a compact card: team names with short codes, score and overs per innings, and a one-line status ("Live", "Stumps", "X won by Y runs", "Starts in 2h"). Filters by format and date. A horizontal live-score carousel sits above news on the home screen.

**Level 3, the match page.** The same tab row for every match: Live (or Summary once finished), Scorecard, Report, Overs, Videos, Table, Squads, Stats, News, Photos. The score hero stays pinned above the tabs. The URL carries the series and match slug, so every page is shareable and bookmarkable.

What SCRBRD should learn:

- **Make the match page one object with one tab row**, shared by the scorer, coach, parent and spectator, with role deciding which tabs render and whether the action pad shows. Today the Scorer has its own `score`/`cards`/`analysis`/`history` set and the OS Match Centre is a separate screen; a match handed over between them changes shape.
- **Fixtures list cards need the Cricinfo status line.** One sentence that reads correctly at every match state: scheduled, toss done, live with chase context, innings break, result. The `matches.live_status` enum already encodes these states; render them as copy, not badges.
- **Group fixtures by competition, then date**, with a date strip at the top. Schools think in weekends and competitions, which mirrors Cricinfo's series-then-day grouping.
- **Keep depth to three levels.** The Stadium Bar should be the Level 1 bar, the fixtures list Level 2, and the match page Level 3. Anything deeper (player passport, pitch profile) opens as a sheet over the match page, not a new navigation stack.
- **Stable URLs per match and per tab**, so a parent's WhatsApp link opens the Live tab and a coach's link opens the Scorecard.

## Live match centre and ball-by-ball

The Live tab is a fixed stack, top to bottom, and that order is the lesson.

1. **Score hero.** Batting team score and overs large, the other innings small beside it, then one status line: "RSA need 54 off 38 balls" or "Day 2, Session 1". Below it a mini-table: the two batters (R, B, 4s, 6s, SR, striker marked) and current bowler (O, M, R, W, Econ). Then CRR, RRR, partnership, last wicket, target. Nothing here rotates.
2. **Context strip.** Forecaster win probability bar and projected score, plus a one-line "Key stats" (last 5 overs, boundary count). The win predictor is updated over by over and the live graphs track the ebb and flow of a game.
3. **Commentary stream.** Newest first. Each ball is one row: over.ball on the left, a coloured token (W red, 4 blue/green, 6 purple, wd/nb outlined), then a sentence: "Bowler to Batter, FOUR, short and wide, cut through point." Overs are separated by an over-summary row (runs in the over, running score, bowler figures). Wickets and milestones get a larger card with the dismissal line and a stat.
4. **Filter chips** above the stream: All, Wickets, Fours, Sixes, Milestones. This is how a parent who missed an hour catches up in 20 seconds.

Where SCRBRD stands today: the Wicket Hub centres on the action pad, which is correct for the scorer. But the ball log on the `history` tab renders the last 30 balls as a flat list with type, shot and zone, and the `DynamicBar` rotates partnership, last over and chase context in one strip. The scorer's eye has to hunt.

What to take:

- **Split the hero from the pad.** The glass score card should carry exactly Cricinfo's hero fields in Cricinfo's order. Partnership, last wicket and last over belong on the hero as small fixed rows, not in a rotating `DynamicBar`. The scorer and the parent then read the same card.
- **Generate the commentary sentence from `ball_events`.** SCRBRD already stores bowler, striker, outcome, shot type and zone per ball. That is enough to template "Naidoo to Khumalo, FOUR, pulled through midwicket" without AI. Use AI only to embellish, never to be the source.
- **Over-summary rows.** After each sixth legal ball, insert a row: over number, runs, wickets, bowler figures, score. This is also the scorer's natural checkpoint for an undo boundary.
- **Wicket card, not toast.** Keep the `EventOverlay` for the scorer's moment, but the stream needs a persistent wicket card with dismissal text, batter's figures and the FOW score, exactly as Cricinfo prints "c Smith b Jones 34 (41b 4x4)".
- **Filter chips on the stream** (Wickets, Boundaries, Milestones), driven by `outcome_type` and `wicket_flag`. Cheap to build, high value for parents and coaches.
- **Innings break and result screens** as first-class states of the same page. Cricinfo swaps the Live tab for Summary; the hero becomes "Hilton won by 23 runs" and the stream becomes the innings summary.

## Scorecard, stats and data presentation

Cricinfo's scorecard is the de facto standard record of a cricket match, and it has barely changed in two decades. Readers know where every number lives.

**Batting card.** One row per batter in batting order: name (captain and keeper marked), dismissal in the compact traditional form ("c Smith b Jones", "lbw b Jones", "not out"), then R, B, M, 4s, 6s, SR. Not-out batters are bolded. Below: Extras broken into b, lb, w, nb, pen; Total with overs and run rate; Did not bat; Fall of wickets as "1-12 (Khumalo, 3.4 ov)". Rows are tappable to the player profile.

**Bowling card.** O, M, R, W, Econ, then 0s, 4s, 6s, Wd, Nb. The extended columns only appear on wide screens.

**Match details block.** Toss, series, venue, umpires, match referee, days, player of the match, points. Always at the bottom, always in that order.

**Overs tab.** One row per over: over number, runs, wickets, bowler, running score, bar length proportional to runs. This is the Manhattan chart as a table.

**Graphs.** Worm (cumulative runs), Manhattan (runs per over), run-rate comparison, partnership bars, and the win-probability curve. Wickets are marked as dots on the worm. Charts are simple, two-series, one colour per team.

**Smart Stats.** Smart Runs and Smart Wickets weight each run and wicket by match situation and opposition quality, and Player Impact combines batting and bowling into one match-level number. Cricinfo uses them to argue a different player of the match than the official choice.

What SCRBRD should take:

- **Freeze the scorecard layout** to the Cricinfo column order and dismissal grammar. Coaches, scorers and umpires in KZN already read Cricinfo; do not make them learn a new card. `innings_batting_scorecards` and `innings_bowling_scorecards` map one-to-one.
- **Print dismissal text the traditional way** and derive it from `wicket_type`, `dismissed_person_id`, `assisting_fielder_1_id` and the bowler. The recognition spec already flags that bowler credit is wrong for run outs; the scorecard is where that error becomes visible.
- **Fall of wickets with over and ball**, generated from `innings_fall_of_wickets`, under the batting card, not on a separate tab.
- **Match details block** at the bottom with toss, venue, field, umpires, scorer, player of the match, competition and points. This is also where POPIA-safe attribution lives (scorer name only with consent).
- **One Overs table and three charts**, no more: worm with wicket pins, Manhattan, win probability. SCRBRD's `AnalysisDashboard` has phase splits and wagon wheels too; keep those on a Coach tab, because Cricinfo's lesson is that the public analytics surface is small.
- **Impact score as a Player of the Match aid.** The recognition decision is coach or captain picks with system suggestions; a simplified Smart-Stats style impact number (runs above par by match phase, wickets weighted by batter quality) is exactly that suggestion. Show the number with the reasoning, as Cricinfo does.
- **Tap any name, get the passport.** Every batter and bowler row links to the Player Passport, opened as a sheet so the scorecard stays underneath.

## Mobile app patterns: alerts, personalisation, offline

Cricinfo's app bet is personalisation, and ESPN's own numbers back it: users who personalise visit more than three times as often as those who do not. The mechanics are simple.

- **Favourites on first run.** Pick teams, competitions and players. Favourite matches pin to the top of the scores list and the home carousel.
- **Per-match alert toggles.** On any match: Wickets, Boundaries, Milestones, Innings end, Result. Default off except Result; the user opts in per match or per team.
- **Docked video and persistent score.** Watching a clip keeps the score visible, and leaving the match page leaves a floating score pill.
- **Lightweight by design.** The 2018 relaunch was explicitly built for "any device on any network" with a lighter architecture, which matters for South African school grounds with poor signal.

What SCRBRD should take:

- **"Follow" is the parent's first action.** On sign-up a parent follows their child; the system then auto-follows the child's team, school and competitions. Match cards for followed teams pin to the top of the OS dashboard.
- **Alert categories map to `notifications.notification_type`**: child batting in, child's wicket, child's milestone, innings end, result, logistics change. Parents choose per category once, not per match. This is the "Parent broadcast push" roadmap item with a concrete UI.
- **Floating score pill** when the scorer or a coach leaves the Wicket Hub for squad or logistics screens. SCRBRD already shows a small `liveDot` score pill in the header; promote it to a global element in the Stadium Bar.
- **Offline state is a visible status**, not a silent queue. Cricinfo does not do this well; SCRBRD's IndexedDB queue should show "12 balls pending sync" on the hero and a sync-complete tick, because the scorer at the ground needs to trust it.
- **Low-bandwidth mode** for spectator pages: score hero and text stream only, no charts or images, auto-selected on slow connections.

## Visual design, typography and branding

Cricinfo's visual system is deliberately quiet so the numbers carry the page. White and light grey surfaces, one brand red for the wordmark and live indicators, team colours used only as thin accent bars on cards, and tabular numerals throughout.

| Element | Cricinfo | SCRBRD CI today | Verdict |
| --- | --- | --- | --- |
| Theme | Light-first, dark mode added later | Dark-first, five surface tiers | Keep dark-first; scorers work outdoors in sun, so a true light mode with high contrast is required, not optional |
| Score figures | Bold sans, tabular numerals, score far larger than overs | DM Mono for figures, Syne 800 headings | Right choice; ensure mono figures are used in every table, not only the hero |
| Ball tokens | Small filled circles: W red, 4 and 6 highlighted, extras outlined | `BallDot` with semantic colours | Matches the brief (4 cyan, 6 orange, W red); add outlined style for wd/nb/bye so extras read differently from runs |
| Team identity | Short code plus small flag or crest, thin accent bar | Flag emoji from `INT_TEAMS` | Replace emoji with crest or a two-colour swatch per team (`team_colour_primary`/`secondary` exist in schema) |
| Density | Dense tables, 12–13px, lots of rows | 11–13px DM Sans in cards | Comparable; keep row height at 32px minimum for touch |
| Motion | Almost none; score updates without animation | Glow states, event overlays, milestone queue | Restrain: glow on the live pill and the last ball only; honour reduced-motion |
| Live indicator | Red dot plus "LIVE" text | Green `liveDot` | Semantic clash with the brief's "wicket red, live green"; keep green but always pair with the word "Live" |

The overall lesson is restraint. Cricinfo reads as a reference, not a broadcast. SCRBRD's brief asks for broadcast-quality graphics, which is fine for the hero and charts, but the scorecard, stream and fixtures list should be as plain as Cricinfo's so they stay fast to scan on a phone at a ground.

## Where Cricinfo falls short

The same five complaints repeat across 2025–26 reviews, and most are self-inflicted.

1. **Ads at the moment that matters.** Full-screen, often unskippable video ads that fire on launch and at wickets; reviewers who praise the core score experience still say the ad load drove them to uninstall. SCRBRD must never interrupt a wicket with anything, including its own milestone overlay for non-scorer roles.
2. **The app feels like a webview.** Long-time users describe the native app as having become a responsive site wrapper, with jumping scroll positions and back-button bugs. SCRBRD's scorer-first pad has to feel native: no layout shift when the stream updates, no re-render of the pad on each ball.
3. **Redesigns that removed things.** A recurring pattern is a relaunch that users felt downgraded the experience, with stats features becoming hard to find. For the planned SCRBRD redesign: ship a parity checklist, and keep the Pro scoring mode's shot and field capture one tap away rather than buried.
4. **Overwhelming for casual fans.** Cricinfo is praised for depth and criticised for noise; the Live tab can show predictor, key stats, video, commentary and ads in one scroll. SCRBRD's parent and player views should default to hero plus stream, with analytics behind a tab.
5. **Notification spam and battery drain.** Alerts default on for too much; background activity complaints are common. Default to Result only, and batch low-priority alerts.
6. **No scoring, no grassroots.** Cricinfo is a consumption product; it has no scorer input, no team sheets, no availability, no consent. This is SCRBRD's whole opportunity: Cricinfo's reading experience on top of a scoring and school-operations core.
7. **Weak offline and slow-network behaviour.** Blank screens and stale scores on poor connections. School grounds are the worst case; design for it first.

## Recommendations for SCRBRD OS

Twelve changes, ordered by value to the pilot. P1 items are the ones to land before the next field test; they are mostly presentation over data SCRBRD already has.

| # | Priority | Recommendation | Feeds into | Effort |
| --- | --- | --- | --- | --- |
| 1 | P1 | Fix the score hero fields and order (score, overs, status line, batters, bowler, CRR/RRR, partnership, last wicket); remove rotation from `DynamicBar` | UI redesign, Wicket Hub | Small |
| 2 | P1 | One match page with one tab row (Live, Scorecard, Overs, Squads, Info) for every role; scorer gets the action pad below the hero | UI redesign, Pilot Match | Medium |
| 3 | P1 | Commentary stream generated from `ball_events`, with coloured ball tokens, over-summary rows and persistent wicket cards | Wicket Hub, parent view | Medium |
| 4 | P1 | Freeze the scorecard to Cricinfo's column order, dismissal grammar, extras, FOW and match-details block | Scorecard, Recognition | Small |
| 5 | P1 | Fixtures list cards with a Cricinfo-style status sentence per match state, grouped by competition then date | OS dashboard, Pilot Match | Small |
| 6 | P1 | Visible sync status on the hero ("3 balls pending") and a low-bandwidth spectator mode | Offline queue | Medium |
| 7 | P2 | Stream filter chips: Wickets, Boundaries, Milestones | Parent view | Small |
| 8 | P2 | Follow model: parent follows child, auto-follows team, school, competition; followed matches pin to top | Notifications, RBAC | Medium |
| 9 | P2 | Alert categories per follower, default Result only; no overlay interrupts for non-scorer roles | Parent broadcast | Medium |
| 10 | P2 | Tap-to-passport from every scorecard and stream row, opened as a sheet | Player Passport | Small once Passport exists |
| 11 | P3 | Impact score (runs above par by phase, weighted wickets) shown with reasoning as the Player of the Match suggestion | Recognition | Medium |
| 12 | P3 | Innings-break and result states as the same page: hero becomes the result line, stream becomes the summary | Wicket Hub | Small |

Two sequencing notes. Items 1 to 5 are the "Cricinfo grammar" and should ship together, because their value is consistency across screens. Item 11 depends on the recognition spec's scoring fixes (bowler credit, dismissed batter) landing first, otherwise the impact number will be wrong in public.

What not to borrow: the news feed, video docking, editorial layers, and anything that puts content between the reader and the score. SCRBRD's scope is the match and the school; Cricinfo's scope is the sport.

## Sources

- [ESPNcricinfo Raises The Game with Relaunched Website and App](https://espnpressroom.com/press-release/espncricinfo-raises-game-relaunched-website-app/), ESPN Press Room
- [Why the redesign of ESPN's cricket site centers around personalization](https://digiday.com/media/espn-cricket-redesign/), Digiday
- [ESPNcricinfo unveils new app; promises dynamic digital experience on mobile](https://mediabrief.com/espncricinfo-unveils-new-app/), Mediabrief
- [Explainer: how Smart Stats works](https://www.espn.com/cricket/story/_/id/26312449), ESPNcricinfo
- [Smart Stats: the HD version of conventional cricket stats](https://www.espncricinfo.com/print/story/1178323), ESPNcricinfo
- [Smart Stats: Why Sam Curran's impact was higher than Moeen Ali's](https://www.espn.com/cricket/story/_/id/31291228/csk-v-rr-ipl-2021-smart-stats-why-sam-curran-was-impact-was-higher-moeen-alis), ESPNcricinfo
- [We've lived cricket for three decades, alongside you](https://www.espn.com.au/cricket/story/_/id/35901524/lived-cricket-three-decades-alongside-sambit-bal), ESPNcricinfo at 30
- [Cricbuzz vs ESPNcricinfo vs Hotstar: 5 Apps Ranked (2026)](https://unstar.app/blog/cricbuzz-espncricinfo-hotstar-fancode-crex-cricket-apps-ranked-2026), Unstar review analysis
- [Cricinfo - Live Cricket Scores, user reviews](https://chrome-stats.com/d/id417408017), Chrome-Stats
- [ESPNcricinfo app reviews](https://justuseapp.com/en/app/417408017/cricinfo-live-cricket-scores/reviews), JustUseApp
- [Cricinfo vs Cricbuzz](https://planetcricket.org/forums/threads/cricinfo-vs-cricbuzz.118023/latest), PlanetCricket forum
- SCRBRD project files: `scrbrd_os.jsx`, `claude/scrbrd_recognition_spec_v0.2.md`, project design brief

Match-page structure (tab names, hero fields, commentary and scorecard layout) is observed from direct use of espncricinfo.com and the Cricinfo app; those pages are client-rendered and could not be fetched as static text.

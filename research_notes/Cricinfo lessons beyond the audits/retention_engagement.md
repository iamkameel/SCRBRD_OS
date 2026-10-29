# Cricinfo retention and engagement mechanics, beyond the match page (2025–2026)

> **How this was gathered, and how far to trust it (read first).** Every direct fetch failed under this session's network policy: espncricinfo.com, espn.com, espnpressroom.com, apps.apple.com, play.google.com, apkmirror.com, justuseapp.com, unstar.app, digiday.com and exchange4media.com all failed DNS. Each finding below therefore rests on **search-engine result summaries**, not on pages read in full. Treat the figures as indicative, and recheck any one that a decision will rest on once those hosts are allowed. No r/Cricket thread came up in four searches, so the complaint evidence comes from app-review aggregators and comparison blogs, not from Reddit.
>
> **A material 2026 fact:** on 23 June 2026 JioStar renamed ESPNcricinfo **Cricinfo**. Old espncricinfo.com links redirect, and the footer credits Jiostar India Pvt Ltd. The change follows the Reliance–Disney India merger. — [exchange4media](https://www.exchange4media.com/industry-briefing-news/espncricinfo-to-be-rebranded-as-cricinfo-155697.html); [JioStar PDF](https://cdn.jiostar.com/jiostar/wp-content/uploads/2026/07/ESPNcricinfo-is-back-to-being-Cricinfo.pdf); [Manifest Media](https://manifest-media.in/media-/230626/cricinfo-returns-to-its-original-identity-as-jiostar-rebrands-espncric.html). The Android developer name has also changed to "JioStar India Private Limited", per APKMirror's listing path — [APKMirror](https://www.apkmirror.com/apk/jiostar-india-private-limited/espncricinfo-live-cricket-scores-news-videos/).
>
> **Scope:** this note adds to the two audits (`audit/ESPNCRICINFO_FULL_UX_AUDIT_2026-10-23.md` §4.10 and §10; `audit/ESPNCRICINFO_LESSONS_AUDIT_2026-10-23.md`, "Mobile app patterns" and "Where Cricinfo falls short"). It does not repeat their per-match alert toggles, favourites on first run, floating score pill, ads at wickets, or "default to Result only".

## Personalisation: follow, favourites, "my teams"

### Takeaway
Personalisation has been the stated centre of every Cricinfo relaunch since 2017 (web and app 2017, app 2018, app 2020). I found no 2025–26 source that describes the current follow model in more detail than the audits already do. The audits' claim that "users who personalise visit more than three times as often" **could not be verified**.

### Cited Findings
- The July 2017 relaunch of site and app put personalisation at the centre of the redesign and made the product "mobile-first, live, and fast". — [Digiday (search summary)](https://digiday.com/media/espn-cricket-redesign); [SVG, 24 Jul 2017](https://www.sportsvideo.org/2017/07/24/espncricinfo-relaunches-website-and-app-delivering-mobile-first-experience-for-cricket-fans/)
- 2017 traffic at the time of that relaunch: nearly 233 million visits a month worldwide, with mobile visits up nearly 100% in a year. Another report gave more than 150 million a month from India and the subcontinent. — [ESPN Press Room (search summary)](https://espnpressroom.com/press-release/espncricinfo-raises-game-relaunched-website-app/); [Business Standard](https://www.business-standard.com/amp/article/companies/espncricinfo-leaps-from-digital-to-tv-117072001688_1.html)
- The July 2018 Android app relaunch was pitched as "a more personalised experience" with more intuitive navigation, and claimed over one billion visits a year. — [Indian Television](https://indiantelevision.com/news-headline/espncricinfo-launches-new-reimagined-app-180714/); [InsideSport, 13 Jul 2018](https://insidesportnews.blogspot.com/2018/07/espncricinfo-launches-new-re-imagined.html)
- The December 2020 app relaunch added a live-score carousel, a new live scorecard and a better story-reading experience. — [exchange4media (search summary)](https://www.exchange4media.com/industry-briefing-news/espncricinfo-unveils-all-new-app-to-offer-more-dynamic-experience-to-cricket-fans-109729.html); [afaqs](https://www.afaqs.com/companies/espncricinfo-launches-new-app)
- A search for the "three times as often" figure for personalised users found no source. — searched: "ESPNcricinfo relaunch personalise 'three times' visits favourites" (no hit)

### Inferences
- The retention logic is "pick once, and the home re-orders around you": favourites decide what the carousel and the scores list show first. That fits SCRBRD's one-school scope, which has a single obvious personal anchor (my child, my team).
- The "3×" figure in `ESPNCRICINFO_LESSONS_AUDIT` should be marked unverified before anyone quotes it in a design doc.

### Gaps
- The current (2026, post-rebrand) follow model: whether players can be followed, whether follows sync between web and app, and whether a web login exists at all. The pages could not be fetched.
- Any retention or engagement figure from 2024 onwards for personalised users.

## Alerts and push: what a user can choose, and how noise is controlled

### Takeaway
In 2025–26, the alert *granularity* (wickets, milestones, results) is less of a complaint than alert *scope*. Reviewers say the app pushes matches they never chose, and that promotional pushes cannot be muted without losing score alerts. Reliability, though, is praised.

### Cited Findings
- One reviewer "temporarily deleted ESPNcricinfo … as it is sending notifications for games I didn't request and have no interest in." — [JustUseApp reviews (search summary)](https://justuseapp.com/en/app/417408017/cricinfo-live-cricket-scores/reviews)
- A 2026 comparison says users cannot mute promotional notifications without also losing score alerts. — [Unstar, cricket apps ranked 2026 (search summary)](https://unstar.app/blog/cricbuzz-espncricinfo-hotstar-fancode-crex-cricket-apps-ranked-2026)
- Some App Store reviewers say "the notifications for live matches are very reliable". — [AppFollow / App Store (search summary)](https://appfollow.io/ios/preloaded/417408017?country=us)
- Historical (Windows Phone era): push alerts for wickets, batsman milestones and score updates. — [allaboutwindowsphone](https://allaboutwindowsphone.com/flow/item/14860_ESPNcricinfo_brings_live_crick.php)
- I found no official Cricinfo help page for the notification settings, and no evidence that the app offers iOS Live Activities or a lock-screen widget. Apple Sports and third-party cricket apps (Cricket Pulse Live, Runcaster) do advertise lock-screen live scores. — [MacRumors](https://www.macrumors.com/how-to/get-live-sports-scores-on-your-iphone-lock-screen/); [MacRumors, Apple Sports Live Activities](https://www.macrumors.com/2024/09/16/apple-sports-app-live-activities/)

### Inferences
- The noise-control lesson goes beyond the audits' "default Result only". Keep **editorial or promotional** notices on a different channel from **followed-match** notices, and make each separately switchable. Never push for a fixture the user did not follow.
- Reliability is what earns the alert channel its keep. One late or missing wicket alert costs more trust than a missing alert type.

### Gaps
- The exact 2026 settings screen (per-match versus global toggles, quiet hours, digest options) could not be seen, because the store listings and the help site were blocked.
- Whether Cricinfo uses Live Activities on iOS 16+ or Android ongoing notifications.

## Habit loops: live blogs, newsletters, podcasts, short video, previews

### Takeaway
Cricinfo runs a reported **"live match blog" / "Live Report"** layer beside ball-by-ball commentary. Writers file it in segments through the day, and it was confirmed for the 2025–26 Ashes. Podcasts (Switch Hit) remain a weekly habit. No current newsletter or WhatsApp channel could be found.

### Cited Findings
- Each 2025–26 Ashes Test had a `/live-match-blog` URL on the match. Bylined "Live Report" segments followed the session story: Matt Roller on England's collapse after lunch on day 2 at Perth, and Andrew McGlashan on Starc dismissing Root on day 3 at Brisbane. Some reports were also published as stories, e.g. "5th Test – live report – spin sidelined again at SCG". — [Ashes 1st Test live blog](https://www.espncricinfo.com/series/the-ashes-2025-26-1455609/australia-vs-england-1st-test-1455611/live-match-blog-2); [2nd Test live blog](https://www.espncricinfo.com/series/the-ashes-2025-26-1455609/australia-vs-england-2nd-test-1455612/live-match-blog); [5th Test live report](https://www.espncricinfo.com/story/australia-vs-england-5th-test---live-report---spin-sidelined-again-at-scg-1517975)
- **Switch Hit** is Cricinfo's English-cricket debate podcast, made by its writers and reporters. 2025 episodes include a 20 May preview of England v Zimbabwe and an 18 Nov "Switch Hit x Final Word: Ashes story time special". Episodes are also published as Cricinfo story pages. Directories disagree on whether it ran into 2026: Apple says 2009–2025 and 200 episodes, while others list a 16 Jun 2026 episode. — [Cricinfo Switch Hit page](https://www.espncricinfo.com/story/switch-hit-podcast-eng-vs-zim-zim-bunnies-1486708); [Apple Podcasts](https://podcasts.apple.com/us/podcast/id304534298); [TuneIn](https://tunein.com/podcasts/Cricket/Switch-Hit-Podcast-p355450)
- Match-preview video sits under a "match preview" video genre. — [Cricinfo match-preview videos](https://www.espncricinfo.com/cricket-videos/genre/match-preview-8)
- There is a Hindi edition (`/hindi/`), a second habit loop in another language. — [Cricinfo Hindi author page](https://www.espncricinfo.com/hindi/author/steven-lynch-34)
- No official Cricinfo WhatsApp channel or newsletter sign-up was found. Channels using the name are third-party. Rivals such as The Cricketer and Cricket Ireland do run WhatsApp channels. — [The Cricketer](https://thecricketer.com/Topics/news/how_to_join_the_cricketer's_brilliant_new_whatsapp_channel.html); [Cricket Ireland](https://cricketireland.ie/new-whatsapp-channel/)

### Inferences
- The live blog is the "story so far" layer for someone who missed three hours. A person writes it at natural breaks (session or innings). It is not ball-by-ball. For a parent who arrives at tea, that is the right shape.
- In this category the habit comes from the **fixture calendar** (preview, then live, then report). It does not come from a daily email. SCRBRD's equivalent rhythm is the fixture week: team sheet, then match, then result.

### Gaps
- Whether Cricinfo has an email newsletter in 2026. Its site could not be fetched to check the footer or the sign-up.
- Short vertical video (Shorts or Reels) strategy and figures. No usable source was found.
- Any open-rate, listen or return-visit figures for these formats.

## Participation: polls, predictor and fantasy games, reader questions, user content

### Takeaway
Most of Cricinfo's participation features are **historical**: Super Selector (ESPN Star Sports, 2000s), "Fantasy Pick" editorial videos (2020–21), Open Mic live chat (2020), "Talk to your hero" reader Q&As, Ask Steven, and an in-app commentary feedback form (an early app version). I found no evidence of a live predictor, fantasy game or reader-comment system in 2025–26. Cricinfo is now mostly a read-only product.

### Cited Findings
- **Super Selector** was an ESPN Star Sports fantasy game with more than 500,000 entrants at the 2003 World Cup. It is historical. — [Wikipedia](https://en.wikipedia.org/wiki/ESPN_Super_Selector)
- **"Fantasy Pick"** (2020–21) was an editorial video series suggesting fantasy XIs. It was advice, not a game. — [Cricinfo video example](https://www.espncricinfo.com/cricket-videos/dc-vs-srh-ipl-2021-fantasy-pick-back-shaw-dhawan-pant-to-deliver-1278959)
- **Open Mic** (2020) was a live chat show where fans asked questions while it was on air, moderated by the team. — [afaqs](https://www.afaqs.com/companies/espncricinfo-launches-an-innovative-live-chat-show-open-mic)
- An editor wrote that one of the biggest problems in live online discussions is the sheer volume of feedback, so some live Q&As were run by email instead. — [Cricinfo "From the Editor"](https://www.espncricinfo.com/page2/content/story/614802.html)
- **Reader Q&As**: "Talk to your hero" (players answer readers' questions) and the "Ask Steven" column. — [Talk to your hero](https://www.espncricinfo.com/genre/talk-to-your-hero-276)
- **In-app commentary feedback** ("send us your comments") came in an early app version 3.0 and is historical. — [allaboutwindowsphone](https://allaboutwindowsphone.com/flow/item/20792_ESPNs_Cricinfo_gets_a_big_upda.php)
- **AskCricinfo** (13 Sep 2021) was a natural-language stats search over Statsguru for T20 data (IPL, BBL, PSL, T20Is), e.g. "most sixes in powerplay in IPL 2021". It planned more languages. Its current status is unknown. — [Adgully](https://www.adgully.com/espncricinfo-launches-game-changing-new-ai-powered-query-service-108582.html?amp=1); [Cricinfo video](https://www.espncricinfo.com/cricket-videos/askcricinfo-a-new-stats-query-tool-from-espncricinfo-1277747)

### Inferences
- Cricinfo has largely dropped open participation. The likely reasons are moderation cost at scale (the editor's own words) and, in India, the separate fantasy-gaming business. For SCRBRD, open comments about matches with minors in them would carry Cricinfo's moderation load plus safeguarding risk.
- AskCricinfo is the participation idea that suits SCRBRD best: a question box over the school's own data. It is not social, so it needs no moderation.

### Gaps
- Whether any poll or predictor ("Who will win?") currently runs on Cricinfo match pages.
- Whether AskCricinfo still exists, or was folded into search.

## Second-screen and live experience as a return driver: Forecaster, Smart Stats, Impact

### Takeaway
**Superstats** (Smart Stats, Luck Index, Forecaster) launched in March 2019 with IIT Madras and Gyan Data. Forecaster's live win probability was still being quoted by mainstream outlets at the T20 World Cup 2026. Smart Stats "Player of the Match" pieces still ran through the 2024 T20 World Cup. These metrics bring people back as *stories* ("why X, not Y, was the real PoTM") as much as numbers on a screen.

### Cited Findings
- Superstats launched on 20 Mar 2019. Smart Stats adjusts each performance for match situation and opposition quality. Luck Index quantifies chance. Forecaster predicts the final score and win probability live, using statistical and machine-learning models. — [Cricinfo launch story](https://www.espncricinfo.com/ci/content/story/1178276.html); [Business Standard](https://business-standard.com/article/technology/and-now-ai-to-predict-cricket-matches-assess-the-luck-of-the-players-119032000799_1.html); [IIT Madras ACR](https://acr.iitm.ac.in/iitm_news_repository/ai-powered-superstats-enhancing-the-ipl-experience-for-fans)
- Smart Stats began as a standalone tool in 2018. Match impact is the sum of batting impact and bowling impact, built from Smart Runs, Smart Strike-Rate, Smart Wickets and Smart Economy. — [ESPN UK, "HD version of conventional stats"](https://www.espn.co.uk/cricket/story/_/id/26312448/hd-version-conventional-cricket-stats)
- Recurring editorial built on these metrics includes "Why Pat Cummins, and not Shubman Gill, is the Smart Stats player of the match" and "2024 T20 World Cup Smart Stats: how good were India". — [Cricinfo print story](https://www.espncricinfo.com/print/story/1233574); [ESPN Africa, 2024](https://africa.espn.com/cricket/story/_/id/40471995/2024-t20-world-cup-smart-stats-how-good-were-india)
- At the T20 World Cup 2026 semi-final, India's win probability "rose from 77.72% to 89.88% after Jasprit Bumrah's 18th over", credited to ESPNcricinfo. A third party re-told a swing in the live model as news. — [Inshorts](https://inshorts.com/en/amp_news/india-s-win-probability-rose-from-77-72--to-89-88--after-jasprit-bumrah-s-18th-over-vs-england-1772765644322)

### Inferences
- The model drives return visits through **moments**: a swing in win probability becomes a shareable headline, and a "contrarian PoTM" becomes an argument. The audits' warning stands, though (Full audit §10.5): a win probability for U13 cricket is uncalibrated. A "what changed the game" moment drawn from the event log (an over that turned it, a partnership) can deliver the same hook without a predictive claim.

### Gaps
- Any figure showing that Forecaster or Smart Stats raise session length or return rate. None was found.
- Whether Luck Index is still published.

## App versus web, and offline or low-bandwidth handling

### Takeaway
I found nothing new for 2025–26 beyond the audits. The 2017–18 relaunches were framed as mobile-first and light. A 2026 changelog (v26.03.16, via APKMirror's search snippet) claims "faster live scores & commentary with reduced lag during high-traffic moments". The fact that it is advertised suggests lag at peak load was a known problem.

### Cited Findings
- v26.03.16 "What's new": faster live scores and commentary with less lag in high-traffic moments, and clearer scorecards and navigation on match pages. The 2025 builds carry no feature notes. — [APKMirror (search summary)](https://www.apkmirror.com/apk/jiostar-india-private-limited/espncricinfo-live-cricket-scores-news-videos/)
- The app page offers "Download the ESPNcricinfo App" and "Text Me The Link", web-to-app hand-off prompts. — [ESPN apps page (search summary)](https://www.espn.com/espn/apps/cricinfo)

### Inferences
- Peak-moment lag is the failure that matters for retention. At a school fixture, "peak" means the last over of a close match, when every parent refreshes at once.

### Gaps
- Any offline, low-data or "lite" mode in the 2026 app. No source was found.

## Where it annoys users

### Takeaway
The audits already cover ad interruptions at wickets. The **new** evidence is about timing and trend. Complaints say the ads "became awful after the last update" (a May 2026 review), and that the March 2026 redesign, or an earlier one, felt like a downgrade. Some reviewers say they moved to Cricbuzz.

### Cited Findings
- A May 2026 review says the ads "became awful after the last update". Another calls the app "somewhat unusable and way too intrusive". One user says moving to Cricbuzz was the better option. — [JustUseApp reviews (search summary)](https://justuseapp.com/en/app/417408017/cricinfo-live-cricket-scores/reviews)
- A user asked for an ad-free version for ESPN+ subscribers. No ad-free tier was found for Cricinfo. — [JustUseApp (search summary)](https://justuseapp.com/en/app/417408017/cricinfo-live-cricket-scores/reviews)
- Complaints cluster on a redesign that long-time users felt "downgraded the experience". Across free cricket apps, the top complaint is ads that are too many and badly timed. — [Unstar 2026 (search summary)](https://unstar.app/blog/cricbuzz-espncricinfo-hotstar-fancode-crex-cricket-apps-ranked-2026)
- Ratings differ by storefront. One listing shows 4.7★ from 67.8K ratings, another 4.0 from about 14.5K reviews. — [AppFollow](https://apps.appfollow.io/ios/espncricinfo-cricket-scores/417408017?country=in); [AppGoblin](https://appgoblin.info/apps/417408017)
- A forum poll (12 voters) preferred Cricinfo to Cricbuzz 11 to 1 for its interface, while complaining that the quality of reporting was falling. The sample is tiny and the date is unclear. — [PlanetCricket](https://planetcricket.org/forums/threads/cricinfo-vs-cricbuzz.118023/latest)

### Inferences
- In the reviews, an update that adds ads drives people away even when the core product is still praised. For SCRBRD, a parent's trust that "the score page will look the same on Saturday" is a retention asset in its own right.

### Gaps
- No r/Cricket thread was found, and the review sites could not be read in full, so the counts of each complaint type are unknown.

## Cricbuzz: where it beats Cricinfo on retention

### Takeaway
Cricbuzz's clearest lead is **scale and speed**. It is India's most-visited sports site (192M visits in October 2025, per Semrush) and claims 25M daily active users in IPL 2025. Comparisons consistently say it updates scores faster. It also has a paid ad-free tier (Cricbuzz Plus, since 2021) and an app in Indian languages, two retention levers Cricinfo lacks. Most of the figures are self-reported or estimates.

### Cited Findings
- Cricbuzz's own figures for IPL 2025 were 25M daily active users, 110B impressions and 12B minutes consumed. This is a marketing source (advertorial). — [exchange4media](https://www.exchange4media.com/marketing-initiative-news/ipl-2025-the-season-of-conversations-and-cricbuzz-is-at-the-heart-of-it-140878.html); [afaqs](https://www.afaqs.com/news/advertorial/ipl-2025-the-season-of-conversations-and-cricbuzz-is-at-the-heart-of-it-8714422)
- cricbuzz.com was the most-visited sports site in India at 192.37M monthly visits (October 2025, Semrush estimate). A Comscore 2025 report also ranks it India's top cricket platform. — [Semrush](https://cw.semrush.com/website/cricbuzz.com/overview); [Indian Television](https://indiantelevision.com/mam/cricbuzz-stays-indias-top-cricket-platform-in-new-comscore-report/)
- Comparisons and reviewers say Cricbuzz updates scores faster and that its commentary explains the state of the game better. — [Medium comparison](https://medium.com/new-media-dod/espn-cricinfo-vs-cricbuzz-b4086a9efd64); [Unstar 2026](https://unstar.app/blog/cricbuzz-espncricinfo-hotstar-fancode-crex-cricket-apps-ranked-2026)
- Cricbuzz Plus (April 2021) is a paid tier with exclusive shows and ad-free reading. Deal sites say ads remain during live broadcasts, and they quote prices from Rs 399 to Rs 750 a year (they conflict). — [bestmediainfo](https://bestmediainfo.com/2021/04/cricbuzz-launches-cricbuzz-plus-a-one-stop-destination-for-cricket-coverage)
- Cricbuzz has a separate app in Indian languages and an Android TV app. — [AppGoblin](https://appgoblin.info/apps/com.cricbuzz.android.vernacular)
- A Gulf News report on free IPL 2026 streaming in MENA claims more than 300,000 daily unique viewers. — [Gulf News](https://gulfnews.com/gn-focus/cricbuzz-shatters-viewership-records-in-mena-as-tata-ipl-2026-streams-free-1.500516519)
- Cricbuzz gets ad complaints too: a 2026 Trustpilot review says it floods its occasional live streams with ads. — [Trustpilot](https://www.trustpilot.com/review/cricbuzz.com)

### Inferences
- In this category, **perceived speed** of the live score is the main reason people choose one app over another. Users judge which app is faster, not which is deeper.

### Gaps
- Independent like-for-like retention figures for Cricbuzz and Cricinfo (DAU/MAU, D30 retention). None were found. Similarweb's app comparison page could not be read.

---

### Lessons that would apply to SCRBRD (inferences, sourced above)

1. **Never push for what the user did not follow, and keep every notice type separately switchable.** Cricinfo's most-cited alert complaint is pushes for unrequested games, and promotional pushes that can't be muted without losing score alerts. In SCRBRD, a child's own match, the team sheet, logistics and school news should each be a separate channel. A parent should be able to switch off school news without missing that their child is batting.
2. **Reliability is what keeps the alert channel switched on.** The one alert feature reviewers praise is reliability. Measure the delay from scorer to push on a weak signal, and show a late notice as late rather than sending it silently.
3. **Add a written "story so far" beside the ball-by-ball.** Cricinfo's live blog is written segments at the breaks, not every ball. A SCRBRD equivalent is a short summary at drinks, innings and close, built from the event log or written by the team manager, for the parent who arrives at tea. No child's name goes on public pages (PUBLIC_DATA.md).
4. **Build the habit around the fixture week, not a daily feed.** Cricinfo's loop is preview, then live, then report, plus a podcast. SCRBRD's is team sheet, then reminder, then live, then result and report. Each step is a reason to come back, and none needs ads or content volume.
5. **Turn "what changed the game" moments into the story, not a win percentage.** Forecaster swings become headlines, and Smart Stats PoTM pieces start arguments. SCRBRD can get the same hook from the event log (the over that turned it, the partnership) without an uncalibrated prediction for U13 cricket (Full audit §10.5).
6. **Leave out open comments and fantasy games; a question box over the school's own figures is the participation worth copying.** Cricinfo has quietly dropped its participation features, citing the volume to moderate. With minors involved, SCRBRD should not add open comments. An AskCricinfo-style query, scoped by role and policy, gives the engagement without the moderation.
7. **Never let an update add interruptions.** In May 2026 reviews, "ads got awful after the last update" drove people away while the core product was still praised. A parity checklist and a "no new interruptions" rule per release protect that trust.
8. **Speed under peak load is the competitive edge.** Cricbuzz wins on perceived speed, and Cricinfo's March 2026 release notes headline "reduced lag in high-traffic moments". SCRBRD's peak is a tight final over with every parent refreshing, so test fan-out at that moment.
9. **Offer a second language if the school community needs one.** Cricinfo Hindi and Cricbuzz's Indian-language app are both retention levers. For South African schools, Afrikaans (or isiZulu or isiXhosa where a school's families use it) may be worth a backlog line for Kameel to weigh.

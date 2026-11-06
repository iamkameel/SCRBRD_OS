/**
 * The newsfeed's words, order and covers (lib/newsFeed.js, ui/NewsCover.jsx).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/news-feed.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BAND_LABEL, bandOf, deskOf, hashOf, kickerOf, longWhenSa, bodyParagraphs, readStore, sideLabel, standfirst, whenSa } from "../src/lib/newsFeed.js";
import { NewsCover, coverPlan, monogram } from "../src/ui/NewsCover.jsx";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`); }
};
const group = (g) => console.log(`\n${g}`);

group("A. Kicker, side and desk");
ok("1XI reads 1st XI, 2XI 2nd XI, 3XI 3rd XI, 11XI 11th XI", sideLabel("1XI") === "1st XI" && sideLabel("2xi") === "2nd XI" && sideLabel("3XI") === "3rd XI" && sideLabel("11XI") === "11th XI");
ok("an age-group code stays as written", sideLabel("U15A") === "U15A" && sideLabel(null) === "");
ok("a team post's kicker is the side, then the school",
   kickerOf({ scope: "team", teamCode: "1XI", schoolName: "Westville" }) === "1st XI · Westville");
ok("a school post's kicker is Whole school, then the school", kickerOf({ scope: "school", schoolName: "Westville" }) === "Whole school · Westville");
ok("a league post's kicker is League, then the competition", kickerOf({ scope: "competition", competitionName: "Inland T20" }) === "League · Inland T20");
ok("the desk never shows an email", deskOf({ scope: "team", teamCode: "1XI", authorName: "coach@example.invalid" }).name === null
   && deskOf({ scope: "team", teamCode: "1XI", authorName: "coach@example.invalid" }).desk === "1st XI staff");
ok("a readable name is kept beside the desk", deskOf({ scope: "school", schoolName: "Westville", authorName: "Ms Dlamini" }).name === "Ms Dlamini"
   && deskOf({ scope: "school", schoolName: "Westville" }).desk === "Westville staff");

group("B. Standfirst and paragraphs");
ok("a short body is the standfirst whole", standfirst("Won by six wickets.") === "Won by six wickets.");
const long = "The side won by six wickets. " + "Teas are in the pavilion after the game and parents are welcome. ".repeat(6);
const sf = standfirst(long, 120);
ok("a long body is cut at a sentence or a word, never mid-word", sf.length <= 121 && (/\.$/.test(sf) || /…$/.test(sf)), sf);
ok("paragraphs split on blank lines and keep line breaks inside one", JSON.stringify(bodyParagraphs("One.\nTwo.\n\n\nThree.")) === JSON.stringify(["One.\nTwo.", "Three."]));
ok("markup is text to it", bodyParagraphs("<b>x</b>")[0] === "<b>x</b>");

group("C. The SA day: bands and dates");
const now = Date.parse("2026-11-06T19:00:00Z");   // 21:00 SAST, Friday
ok("22:30 UTC on the 6th is the 7th in SA: today for a reader on the 7th", bandOf("2026-11-06T22:30:00Z", Date.parse("2026-11-07T06:00:00Z")) === "today");
ok("earlier today is Today", bandOf("2026-11-06T08:00:00Z", now) === "today" && whenSa("2026-11-06T08:00:00Z", now) === "Today, 10:00");
ok("yesterday is This week and reads Yesterday", bandOf("2026-11-05T12:00:00Z", now) === "week" && whenSa("2026-11-05T12:00:00Z", now) === "Yesterday, 14:00");
ok("three days ago names the weekday", whenSa("2026-11-03T12:00:00Z", now) === "Tue 3 Nov");
ok("a fortnight ago is Earlier, with no weekday", bandOf("2026-10-20T12:00:00Z", now) === "earlier" && whenSa("2026-10-20T12:00:00Z", now) === "20 Oct");
ok("last year carries its year", whenSa("2025-10-20T12:00:00Z", now) === "20 Oct 2025");
ok("the long date is on the SA clock", longWhenSa("2026-11-05T22:30:00Z") === "Friday 6 November 2026, 00:30");
ok("no date is no words, and Earlier", whenSa(null, now) === "" && bandOf(null, now) === "earlier");
ok("the band labels", BAND_LABEL.today === "Today" && BAND_LABEL.week === "This week" && BAND_LABEL.earlier === "Earlier");

group("D. Opened, per viewer, in this browser");
{
  const mem = new Map();
  const fake = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const a = readStore("user-a", fake), b = readStore("user-b", fake);
  a.mark(["p1", "p2"]);
  ok("a viewer's opened posts are remembered", a.load().has("p1") && a.load().has("p2"));
  ok("...and are not another viewer's", b.load().size === 0);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const c = readStore("user-c", broken);
  ok("storage that throws is storage that is not there", c.load().size === 0 && c.mark(["x"]).has("x"));
  ok("no storage at all is the same", readStore("u", null).load().size === 0);
  mem.set("scrbrd.news.opened.v1:user-d", "{not json");
  ok("a corrupt entry reads as nothing opened", readStore("user-d", fake).load().size === 0);
}

group("E. The covers: deterministic, decorative, and only what the card shows");
{
  const one = renderToStaticMarkup(h(NewsCover, { seed: "post-1", school: "Hilton College", team: "1XI", scope: "team" }));
  const again = renderToStaticMarkup(h(NewsCover, { seed: "post-1", school: "Hilton College", team: "1XI", scope: "team" }));
  ok("the same post draws the same cover", one === again);
  ok("a cover is hidden from assistive technology", /^<div[^>]*aria-hidden="true"/.test(one) && /<svg[^>]*aria-hidden="true"/.test(one) && /focusable="false"/.test(one));
  ok("it draws no image, no link and no control", !/<(img|image|a|button|foreignObject)\b/i.test(one));
  const motifs = new Set(Array.from({ length: 40 }, (_, i) => coverPlan({ seed: `p${i}`, school: "S", team: "1XI", scope: "team" }).motif));
  ok("forty posts use all four motifs", motifs.size === 4, [...motifs].join());
  const hilton = new Set(Array.from({ length: 40 }, (_, i) => coverPlan({ seed: `h${i}`, school: "Hilton College" }).palette));
  ok("one school's posts keep to a family of three grounds", hilton.size === 3, hilton.size);
  ok("a post's ground is the same every time", coverPlan({ seed: "a", school: "Hilton College" }).palette === coverPlan({ seed: "a", school: "Hilton College" }).palette);
  const grounds = new Set(["Hilton College", "Westville Boys' High", "Maritzburg College", "Durban High", "Kearsney College", "Michaelhouse"].map((s) => coverPlan({ seed: "x", school: s }).palette.ground));
  ok("different schools mostly get different grounds", grounds.size >= 4, grounds.size);
  const words = (m) => [...m.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]);
  const drawn = [];
  for (let i = 0; i < 24; i++) drawn.push(...words(renderToStaticMarkup(h(NewsCover, { seed: `q${i}`, school: "Hilton College", team: "2XI", scope: "team" }))));
  ok("the only words on a team cover are the side", drawn.length > 0 && drawn.every((w) => w === "2nd XI"), [...new Set(drawn)].join());
  ok("a school cover draws the school's initials", monogram("Westville Boys' High") === "WBH" && coverPlan({ seed: "x", school: "Hilton College", scope: "school" }).label === "HC");
  ok("two covers on one page do not share gradient ids",
     (() => { const m = renderToStaticMarkup(h("div", null, h(NewsCover, { seed: "a" }), h(NewsCover, { seed: "a" }))); const ids = [...m.matchAll(/id="(nc[^"]+)"/g)].map((x) => x[1]); return new Set(ids).size === ids.length; })());
  ok("hashOf is stable", hashOf("abc") === hashOf("abc") && hashOf("abc") !== hashOf("abd"));
}

console.log(`\n${"─".repeat(52)}\nNEWS FEED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

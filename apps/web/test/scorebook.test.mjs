/**
 * The scorebook importer's words and card helpers (SCRBRD-120; lib/scorebook.js):
 * who is offered the entry point, a refusal in plain words, a typed number that
 * is never a nought, the ticks that follow a row when it moves, an opposition
 * name that becomes a `t:<n>` key and never a player, and who counts as having
 * worked on a card. The screens are walked in a browser
 * (tools/smoke-browser-scorebook.mjs); the rules are the API's and the
 * database's and are not repeated here.
 *
 *   node apps/web/test/scorebook.test.mjs
 */
import {
  blankBatter, blankCard, cellWords, cleanName, countOf, differenceOf, dropCardChecked, footnoteWords, getPath, mayImport, oversOf,
  pruneTyped, refusalWords, refusalsByCell, refusalsOf, rowPaths, setPath, settleTyped, shiftChecked, startedYet, tickProgress, workedOn,
  CAP_CONFIRM, CAP_WRITE,
} from "../src/lib/scorebook.js";
import { ApiError } from "../src/lib/api.js";
import { baseCard, TYPED } from "../../../packages/scoring/test/scorebook-cards.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const HIL = "11111111-1111-1111-1111-111111111111";
const P = ["01", "02", "03", "04", "05", "11"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const m = { id: "m1", schoolId: HIL, homeTeam: "1XI", startsAt: "2020-01-01T10:00:00Z" };

group("Who is offered the entry point (a layout hint; the API decides)");
ok("a scorer at the school writes", mayImport([{ role: "scorer", school: HIL }], CAP_WRITE, m));
ok("...but does not confirm", !mayImport([{ role: "scorer", school: HIL }], CAP_CONFIRM, m));
ok("the director of sport confirms and does not write", mayImport([{ role: "directorofsport", school: HIL }], CAP_CONFIRM, m) && !mayImport([{ role: "directorofsport", school: HIL }], CAP_WRITE, m));
ok("a parent holds neither", !mayImport([{ role: "guardian", school: HIL, subjects: ["x"] }], CAP_WRITE, m) && !mayImport([{ role: "guardian", school: HIL }], CAP_CONFIRM, m));
ok("another school's coach holds neither for this fixture", !mayImport([{ role: "coach", school: "22222222-2222-2222-2222-222222222222", team: "1XI" }], CAP_WRITE, m));
ok("a coach of another team of the school does not write for the 1XI", !mayImport([{ role: "coach", school: HIL, team: "U16B" }], CAP_WRITE, m) && mayImport([{ role: "coach", school: HIL, team: "1XI" }], CAP_WRITE, m));
ok("nothing is nobody", !mayImport([], CAP_WRITE, m) && !mayImport(undefined, CAP_WRITE, m));
ok("a fixture already begun is offered; one to come is not", startedYet(m) && !startedYet({ startsAt: new Date(Date.now() + 864e5).toISOString() }) && !startedYet({}));

group("Who has worked on a card (db/63 scorebook_authored())");
const revs = [{ actorId: "a", action: "create" }, { actorId: "b", action: "save" }, { actorId: "c", action: "return" }, { actorId: "d", action: "confirm" }];
ok("the opener and the typer worked on it", workedOn("a", {}, revs) && workedOn("b", {}, revs));
ok("the submitter did, whatever the revisions say", workedOn("z", { submittedBy: "z" }, []));
ok("one who only returned it did not (she may confirm the corrected card)", !workedOn("c", {}, revs) && !workedOn("d", {}, revs));
ok("nobody signed in worked on nothing", !workedOn(null, { createdBy: "a" }, revs));

group("A refusal, in plain words");
const say = (code, status = 422, detail) => refusalWords(new ApiError(status, code, "/x", detail));
ok("no code reaches a person", ["not_permitted", "module_disabled", "version_conflict", "page_too_large", "not_an_image", "too_many_pages", "duplicate_page",
  "cannot_confirm_your_own", "note_required", "unreconciled_not_acknowledged", "match_complete", "not_yet_played", "not_our_player", "innings_twice"].every((c) => !/_/.test(say(c))));
ok("a photo over the limit says 8 MB", /8 MB/.test(say("page_too_large", 413)));
ok("a 413 or 415 with a code of its own is still worded", /8 MB/.test(say("payload_too_large", 413)) && /JPEG or PNG/.test(say("whatever", 415)));
ok("cannot_confirm_your_own says you worked on it", /You worked on this card/.test(say("cannot_confirm_your_own", 403)));
ok("confirming without being the right person says who confirms", /director of sport/.test(refusalWords(new ApiError(403, "not_permitted", "/x"), { confirming: true })) && /league/.test(refusalWords(new ApiError(403, "not_permitted", "/x"), { confirming: true })));
ok("cells_unchecked counts the cells", /3 cells still need a tick/.test(say("cells_unchecked", 422, ["a", "b", "c"])) && /1 cell still needs a tick/.test(say("cells_unchecked", 422, ["a"])));
ok("the Laws' refusal carries its words and says nothing was written", /^The Laws refuse this record: a batter was out twice\. Nothing was written/.test(say("laws_refused", 422, { law: "x", text: "a batter was out twice" })));
ok("the seal's refusal names the innings", /^Innings 2 cannot be sealed: all out with seven down/.test(say("seal_refused", 422, { seal: "x", text: "all out with seven down", innings: 1 })));
ok("a code nobody has words for is still a sentence, not a bare code", /^That was refused \(some new thing\)/.test(say("some_new_thing")));
ok("no answer at all is said as no answer", /did not answer/.test(refusalWords(new TypeError("fetch failed"))) && /over 8 MB/.test(say("photo_not_sent", 0)));

group("What is typed: a blank is null, never nought");
ok("digits only, at most four", countOf("12a3") === 123 && countOf("123456") === 1234);
ok("nothing typed is null; a typed nought is nought", countOf("") === null && countOf("abc") === null && countOf("0") === 0 && countOf("00") === 0);
ok("overs keep one point", oversOf("17.3") === "17.3" && oversOf("17..3.") === "17.3" && oversOf("x") === null && oversOf("") === null);
ok("a name is trimmed to one space between words", cleanName("  Ngcobo   T ") === "Ngcobo T" && cleanName("") === "");
const c0 = blankCard(0, "home");
ok("a new card has every figure null and no rows", c0.total === null && c0.wickets === null && c0.overs === null && c0.endReason === null && Object.values(c0.extras).every((v) => v === null) && c0.batting.length === 0 && c0.unreconciled === null);
ok("a new batter is blank all through", Object.entries(blankBatter(3)).every(([k, v]) => k === "order" ? v === 3 : v === null));
ok("setPath copies, never changes in place", (() => { const c = blankCard(0, "home"); const d = setPath(c, "extras.byes", 2); return c.extras.byes === null && d.extras.byes === 2 && d !== c; })());
ok("getPath reads a row's cell", getPath(baseCard(P), "batting.2.runs") === 0 && getPath(baseCard(P), "batting.9.runs") === undefined);

group("The card's arithmetic is the server's (summaryRefusal), by cell");
const good = baseCard(P, []);
ok("a card that adds up has no refusal", refusalsOf([good], TYPED, "home")[0].length === 0);
const bad = structuredClone(good); bad.total = 130;
const byCell = refusalsByCell(refusalsOf([bad], TYPED, "home")[0]);
ok("a total that does not add up is refused at the total, in words", /do not add up to the total/.test(byCell.total?.[0] ?? ""), JSON.stringify(byCell));
ok("cells are named for a person", cellWords("batting.2.runs") === "Batter 3, runs" && cellWords("1.bowling.0.wickets", { withCard: true }) === "Innings 2, bowler 1, wickets"
  && cellWords("0.extras.legByes", { withCard: true }) === "Innings 1, extras, leg byes" && cellWords("total") === "Total" && cellWords("fallOfWickets") === "Fall of wickets");
ok("the difference is the book's, and the footnote says it", (() => { const d = differenceOf(bad); return d.difference === 3 && d.battingRuns === 116 && d.extras === 11; })()
  && footnoteWords({ runs: 3 }) === "The book's batting figures differ from its total by 3 runs." && /by 1 run\./.test(footnoteWords({ runs: 1 })) && footnoteWords(null) === "");
ok("no total yet, no difference", differenceOf(blankCard(0, "home")) === null);

group("The ticks follow their cells");
const cards = [structuredClone(good), structuredClone(good)];
const all = Object.fromEntries(rowPaths(cards, 0, "batting", 1).map((p) => [p, true]));
ok("a row's paths are its own eight cells", rowPaths(cards, 0, "batting", 1).length === 8 && rowPaths(cards, 0, "batting", 1).every((p) => p.startsWith("0.batting.1.")));
ok("a did-not-bat row is one cell", rowPaths([{ ...good, didNotBat: [P[4]] }], 0, "didNotBat", 0).join() === "0.didNotBat.0");
const ticks = { "0.batting.0.runs": true, "0.batting.1.runs": true, "0.batting.2.runs": true, "1.batting.2.runs": true, "0.total": true };
const moved = shiftChecked(ticks, 0, "batting", 1);
ok("removing a row drops its ticks and moves the later rows' up one, leaving other cards alone", moved["0.batting.0.runs"] && moved["0.batting.1.runs"] && !moved["0.batting.2.runs"]
  && moved["1.batting.2.runs"] && moved["0.total"] && Object.keys(moved).length === 4, JSON.stringify(moved));
const gone = dropCardChecked({ "0.total": true, "1.total": true, "2.batting.0.runs": true }, 1);
ok("removing an innings drops its ticks and moves the later cards' up", gone["0.total"] && gone["1.batting.0.runs"] && !gone["2.batting.0.runs"] && Object.keys(gone).length === 2, JSON.stringify(gone));
const t0 = tickProgress([good], {});
ok("progress counts every cell, and ticks against it", t0.left === t0.total && t0.total > 50 && tickProgress([good], Object.fromEntries(rowPaths([good], 0, "batting", 0).map((p) => [p, true]))).left === t0.left - 8);
void all;

group("The opposition's names: typed keys, never players");
const withNames = () => { const c = blankCard(0, "home"); c.bowling = [{ ref: "t:1", overs: null, maidens: null, runs: null, wickets: null, wides: null, noBalls: null }]; return c; };
let r = settleTyped({}, [blankCard(0, "home")], { name: "Opp Bowler", current: null, path: "bowling.0.ref", card: 0 });
ok("a first name gets the first key", r.ref === "t:1" && r.typed["t:1"] === "Opp Bowler");
r = settleTyped({ "t:1": "Opp Bowler" }, [withNames()], { name: "opp   bowler", current: null, path: "batting.0.fielderRef", card: 0 });
ok("the same name (any case, any spacing) is the same person: the same key, no new one", r.ref === "t:1" && Object.keys(r.typed).length === 1);
r = settleTyped({ "t:1": "Opp Bowler" }, [withNames()], { name: "Opp Bowlerson", current: "t:1", path: "bowling.0.ref", card: 0 });
ok("a cell that alone uses its key renames him in place", r.ref === "t:1" && r.typed["t:1"] === "Opp Bowlerson" && Object.keys(r.typed).length === 1, JSON.stringify(r));
const shared = withNames(); shared.batting = [{ ...blankBatter(1), bowlerRef: "t:1" }];
r = settleTyped({ "t:1": "Opp Bowler" }, [shared], { name: "Someone Else", current: "t:1", path: "batting.0.fielderRef", card: 0 });
ok("a key used elsewhere is not renamed under the other cell: the new name gets a new key", r.ref === "t:2" && r.typed["t:1"] === "Opp Bowler" && r.typed["t:2"] === "Someone Else");
r = settleTyped({ "t:1": "Opp Bowler" }, [withNames()], { name: "  ", current: "t:1", path: "bowling.0.ref", card: 0 });
ok("an emptied box is no one", r.ref === null);
ok("a typed name nothing uses any more is dropped before a save", JSON.stringify(pruneTyped({ "t:1": "Kept", "t:2": "Orphan" }, [withNames()])) === JSON.stringify({ "t:1": "Kept" }));

console.log(`\n${"─".repeat(52)}\nSCOREBOOK SCREEN WORDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * The school's listing switch and Fields → Add ground: the pure halves.
 *
 *   - THE LISTING WORDS promise only what docs/design/SCRBRD-142 §1–§2 does: a
 *     team-level card (no player, never the ground), listing alone shows
 *     nothing (the side must be published too), and off takes effect within
 *     seconds, not "at once" (the edge holds the read ten seconds, §2.2).
 *   - THE PUBLICATION LINE: the listed and the does-not-list forms, nothing for
 *     a reader who may not read the setting, and no card promised for a side
 *     that is not published or while public pages are off.
 *   - REFUSALS IN WORDS: every code listing-api.mjs and groundCreate name has a
 *     sentence of its own, read from the routes' source so a new refusal fails
 *     here and not in front of an office.
 *   - ADD GROUND: the route's limits (2 to 80, up to 40), the name as the route
 *     reads it, the fields a pitch may lie on (same school, not itself a pitch),
 *     and the body that is sent.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/listing-screens.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GROUND_NAME_MAX, GROUND_SURFACE_MAX, LISTING_READ_ONLY, LISTING_WORDS, cleanGroundName, fieldsOf, groundBody, groundFormReady,
  groundRefusal, listingLine, listingRefusal,
} from "../src/lib/listing.js";
import { ListingPanel } from "../src/views/listing.jsx";
import { AddGroundForm } from "../src/views/addground.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

group("The listing words say what the design says, and no more");
{
  const words = LISTING_WORDS.join(" ");
  ok("two sentences", LISTING_WORDS.length === 2 && LISTING_WORDS.every((w) => w.endsWith(".")), LISTING_WORDS.length);
  ok("the published matches appear on the SCRBRD home page", /published matches appear on the SCRBRD home page/.test(words));
  ok("team names and scores, no player named, never the ground", /team names and scores only/.test(words) && /no player is named/.test(words) && /ground is never shown/.test(words));
  ok("switching off takes them off, and does not claim an instant the edge cache does not give", /Switching off takes them off the page within seconds/.test(words) && !/at once/.test(words));
  ok("it does not promise names on the card, a parent's yes, or anything for an unpublished match", !/parent|consent|every match|all matches/i.test(words));
  ok("a reader who may not change it is told why, plainly", /may publish for the whole school/.test(LISTING_READ_ONLY) && /not change it/.test(LISTING_READ_ONLY));
}

group("The line under the Publish switch");
{
  ok("a reader who may not read the setting is told nothing", listingLine({ listed: null, published: true, pagesOn: true }) === null);
  ok("listed and published: this fixture will appear there",
    listingLine({ listed: true, published: true, pagesOn: true }) === "Your school lists its matches on the SCRBRD home page: this fixture will appear there.");
  ok("listed, not yet published: says it needs publishing", /will appear there once you publish it/.test(listingLine({ listed: true, published: false, pagesOn: true })));
  ok("listed, public pages off on this deployment: no card promised", /switched off on this deployment, so nothing appears there yet/.test(listingLine({ listed: true, published: true, pagesOn: false }))
     && !/will appear/.test(listingLine({ listed: true, published: true, pagesOn: false })));
  ok("pages state unknown is read as on", /will appear there/.test(listingLine({ listed: true, published: true, pagesOn: null })));
  const off = listingLine({ listed: false, published: true, pagesOn: true });
  ok("does not list: says so, that it will not appear, and points to Settings → School",
    /does not list its matches on the SCRBRD home page/.test(off) && /will not appear there/.test(off) && /Settings → School/.test(off), off);
}

group("Every refusal the routes name has its own words");
{
  const listing = readFileSync("services/api/write/listing-api.mjs", "utf8");
  // not_permitted comes from public_listing_set()'s own reason, as the route's status mapping names it.
  const listingCodes = new Set([...listing.matchAll(/(?:error: |reason === )"([a-z_]+)"/g)].map((m) => m[1]));
  const generic = (f, code) => f({ code, status: 400 }) === f({ code: "zzz_unknown", status: 400 }).replace("zzz_unknown", code);
  for (const code of ["not_permitted", "no_such_school", "no_answer"]) ok(`listing: ${code} is a route code`, listingCodes.has(code), [...listingCodes]);
  for (const code of ["not_signed_in", "not_permitted", "no_such_school", "no_answer"]) ok(`listing: ${code} has a sentence`, !generic(listingRefusal, code), listingRefusal({ code, status: 400 }));
  ok("listing: an unknown refusal names the server's word", /zzz_unknown/.test(listingRefusal({ code: "zzz_unknown", status: 500 })));
  ok("listing: no answer at all says nothing was changed", /Nothing was changed/.test(listingRefusal(new Error("fetch failed"))));

  const planner = readFileSync("services/api/write/planner-api.mjs", "utf8");
  const block = planner.slice(planner.indexOf("groundCreate: handle"), planner.indexOf("// POST /api/grounds/:id/parent"));
  const groundCodes = new Set([...block.matchAll(/err\("([a-z_]+)"/g)].map((m) => m[1]));
  ok("ground: the route's own refusals were found", groundCodes.has("ground_exists") && groundCodes.has("name_invalid") && groundCodes.size >= 5, [...groundCodes]);
  for (const code of groundCodes) ok(`ground: ${code} has a sentence`, !generic(groundRefusal, code), groundRefusal({ code, status: 400 }));
  ok("ground: not_permitted (the table's own policy) has one", !generic(groundRefusal, "not_permitted"));
  ok("ground_exists, in the words the office was promised", groundRefusal({ code: "ground_exists", status: 409 }) === "A ground with that name already exists at this school.");
  ok("ground: no answer at all says nothing was added", /Nothing was added/.test(groundRefusal(new Error("fetch failed"))));
}

group("Add ground: the route's limits, said before the trip");
{
  const f = (o) => ({ schoolId: "s1", name: "Memorial Oval", surface: "", ...o });
  ok("a name of two characters is enough", groundFormReady(f({ name: "AB" })));
  ok("one character is not", !groundFormReady(f({ name: "A" })));
  ok("spaces do not count: ' A ' is one character", !groundFormReady(f({ name: "  A  " })));
  ok("eighty characters is enough, eighty-one is not", groundFormReady(f({ name: "x".repeat(GROUND_NAME_MAX) })) && !groundFormReady(f({ name: "x".repeat(GROUND_NAME_MAX + 1) })));
  ok("a surface is up to forty", groundFormReady(f({ surface: "y".repeat(GROUND_SURFACE_MAX) })) && !groundFormReady(f({ surface: "y".repeat(GROUND_SURFACE_MAX + 1) })));
  ok("no school, no form", !groundFormReady(f({ schoolId: "" })));
  ok("the name as the route reads it: trimmed, runs of spaces collapsed", cleanGroundName("  Top   Field \n") === "Top Field");
  ok("a body carries surface and parent only when given", JSON.stringify(groundBody({ schoolId: "s1", name: " Net  1 ", surface: " ", parentId: "" })) === JSON.stringify({ schoolId: "s1", name: "Net 1" })
     && JSON.stringify(groundBody({ schoolId: "s1", name: "Net 1", surface: " turf ", parentId: "g1" })) === JSON.stringify({ schoolId: "s1", name: "Net 1", surface: "turf", parentId: "g1" }));
}

group("The fields a pitch may lie on");
{
  const g = (id, name, school, parentId = null) => ({ id, name, school, parentId });
  const list = [g("a", "Top Field", "s1"), g("b", "Back Oval", "s1"), g("c", "Pitch 1", "s1", "a"), g("d", "Other School Oval", "s2")];
  ok("this school's grounds that are not themselves pitches, by name", fieldsOf(list, "s1").map((x) => x.id).join() === "b,a");
  ok("never another school's", !fieldsOf(list, "s1").some((x) => x.id === "d"));
  ok("a school with none has none", fieldsOf(list, "s3").length === 0);
}

group("The screens, as drawn");
{
  ok("the listing panel draws nothing until the read has answered a reader who may see it", renderToStaticMarkup(h(ListingPanel, { schoolId: "11111111-1111-1111-1111-111111111111" })) === "");
  const form = renderToStaticMarkup(h(AddGroundForm, {
    schools: [{ id: "s1", name: "Hilton College" }],
    grounds: [{ id: "a", name: "Top Field", school: "s1", parentId: null }, { id: "c", name: "Pitch 1", school: "s1", parentId: "a" }],
    onAdded: () => {}, onClose: () => {},
  }));
  ok("the form has a name, a surface and the pitch-on choice, each with a label", /add-ground-name/.test(form) && /add-ground-surface/.test(form) && /add-ground-parent/.test(form)
     && (form.match(/<label /g) ?? []).length === 3, (form.match(/<label /g) ?? []).length);
  ok("...offering the one field and not the pitch", />Top Field</.test(form) && !/>Pitch 1</.test(form));
  ok("...with no school choice for a person who has one school", !/add-ground-school/.test(form));
  ok("...and Add ground waits for a name", /data-testid="add-ground-save"[^>]*disabled|disabled=""[^>]*data-testid="add-ground-save"/.test(form));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * The union selector's screen (docs/design/UNION_SELECTOR_FIND.md S3), held
 * against lib/selection.js and the screen's own source:
 *
 *   - NEVER EVERYONE (D2): no list without an institution and a school or an
 *     age group; a name alone is no filter; the age group is a side's code
 *   - A ROW IS THREE THINGS (D3, §4.3–4.4): name, school, side
 *   - THE WORDS (S3, §4.2): the empty result and a failed open, word for word
 *   - NOTHING KEPT (D7, §4.6): the screen names no store, no export, no share,
 *     and reads only the five reads it needs
 *
 *   node apps/web/test/selection.test.mjs
 */
import { readFileSync } from "node:fs";
import { AGE_GROUPS, asRow, canList, closedWords, emptyWords, listQuery, showsChip } from "../src/lib/selection.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const ORG = "33333333-3333-3333-3333-333333333333", SCH = "11111111-1111-1111-1111-111111111111";

group("Never everyone (D2)");
ok("no institution, no list", listQuery({ org: "", school: SCH, ageGroup: "U15" }) === null);
ok("an institution alone is no list", listQuery({ org: ORG }) === null && !canList({ org: ORG }));
ok("a name alone is no filter", listQuery({ org: ORG, q: "pillay" }) === null);
ok("an age group that is not a side's code is no filter", listQuery({ org: ORG, ageGroup: "1XI" }) === null && listQuery({ org: ORG, ageGroup: "u15; drop" }) === null);
ok("a school is enough", listQuery({ org: ORG, school: SCH }) === `org=${ORG}&school=${SCH}`);
ok("an age group is enough", listQuery({ org: ORG, ageGroup: "U15" }) === `org=${ORG}&ageGroup=U15`);
ok("a name narrows, trimmed, and an empty one is not sent",
   listQuery({ org: ORG, school: SCH, q: "  pil " }) === `org=${ORG}&school=${SCH}&q=pil` && !/q=/.test(listQuery({ org: ORG, school: SCH, q: "   " })));
ok("the age groups are U13 to U19, and no date of birth", AGE_GROUPS.join() === "U13,U14,U15,U16,U17,U18,U19");

group("A row is a name, a school and a side (D3)");
const row = asRow({ player_id: "p1", name: "Boy A", school_name: "School A", team_code: "U15A", org_id: ORG, consent_id: "c1", runs: 300, born: "2010-01-01" });
ok("three things drawn, his id and the institution to open by", Object.keys(row).sort().join() === "id,name,org,school,side");
ok("...anything else the server might send is dropped", !("runs" in row) && !("born" in row) && !JSON.stringify(row).includes("300"));

group("The words (S3, §4.2, §4.8)");
ok("the empty result", emptyWords("KZN Cricket Union") === "No boy's family has named KZN Cricket Union in that school or age group.");
ok("a failed open, and nothing more", closedWords("KZN Cricket Union") === "No longer open to KZN Cricket Union");
ok("...neither gives a reason", !/withdr|laps|moved|left|consent|other|CSA/i.test(emptyWords("X") + closedWords("X")));
ok("the chip only for two institutions", !showsChip([]) && !showsChip([{}]) && showsChip([{}, {}]));

group("Nothing kept, nothing compared (D7, §4.6, §4.7)");
const src = readFileSync(new URL("../src/views/SelectionView.jsx", import.meta.url), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
ok("no store on the device", !/localStorage|sessionStorage|indexedDB|caches\.|persist|useLive|useRows/.test(code));
ok("no export, share, download, copy or print", !/export\/|navigator\.share|download|navigator\.clipboard|window\.print|\.csv/i.test(code));
const reads = [...code.matchAll(/\/api\/read\/([a-z_]+)/g)].map((m) => m[1]);
ok("reads only the union's three, his name and his passport",
   [...new Set(reads)].sort().join() === "passport,passport_name,passport_union_list,passport_union_orgs,passport_union_schools", reads.join());
ok("no figure, honour or ranking word on a row", !/sort\(|rank|average|wickets|honour|born|age_band/i.test(code.split("function SelectionPassport")[0]));
ok("a list only on the button, never on a keystroke", /onSubmit=\{ask\}/.test(code) && !/onChange=\{[^}]*runList/.test(code));

console.log("\n" + "─".repeat(52));
console.log(`SELECTION: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

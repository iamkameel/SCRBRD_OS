// The setup section's QR code (SCRBRD-133 G1): apps/web/src/lib/qr.js against a
// second, independent encoder. The fingerprints below are the first 16 hex of
// the SHA-256 of each matrix (rows of 0/1, joined by newlines) as the Python
// `qrcode` package (8.x) writes it for the same text, error correction M, byte
// mode, no border and the same mask — taken once on 2026-10-02 and pinned here,
// so a change to the encoder that a phone's camera would not read fails.
import { createHash } from "node:crypto";
import { qrMatrix, qrPath } from "../src/lib/qr.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

const base = "https://scrbrd.example/display/77777777-0000-0000-0000-000000000004";
const TEXTS = {
  short: "hello",
  link: base,
  daylight: `${base}?theme=daylight`,
  all: `${base}?theme=daylight&dwell=long&motion=reduce`,
  v10: "y".repeat(300),        // version 10+: 16-bit count, several blocks, the version blocks
  v19: "z".repeat(600),
};
/** @type {Record<string, string[]>} mask 0–7 */
const PINNED = {
  short:    ["52a7aa67e7296ede", "b5607dcfbd80e2bc", "f67f2bc632df800d", "75b99c66edebbd90", "c81027800a8044d0", "aab8a0a72b21c8c6", "073eb88268c25799", "683921f56b2988dd"],
  link:     ["e6bf6a75ebaebf3e", "c81b4f9545bf7bc7", "f9b342f11a716a35", "71e51c9a0568aab7", "3584a82cf113d776", "bcffbd0d1ace17c5", "03f6d2d32b54882b", "6764301b4e35a0a7"],
  daylight: ["07b83f73aeb1356d", "ee6516d9e8a1579c", "7660429b598a941d", "40bf98d524f77247", "2e5329c9c1b55d35", "e44db13cd33b872a", "68cb0533526a3fb8", "61cc48310b1518c8"],
  all:      ["a3bbbdc8d46d8161", "06b1bc7aca98da5f", "14a26304874d8f86", "46e95cfbef4949c9", "a74bb0dad9ad2c15", "a10b87dbc10b36fb", "e8f3f126113d4c00", "7804fdc85c234728"],
  v10:      ["03b399de36fdd852", "bba5be6f30ab04e2", "824b95816545595a", "cc741856f930c447", "6055da93ebdf7dda", "b6eb0b534da1406d", "697bc8e1734538ba", "d1f7b06b94db487e"],
  v19:      ["fde0dbcf60586118", "928d1241ca46c070", "634442ca5c82e8a4", "757901dc44ef4138", "2ec9ec921d676b3a", "69931773047fa05d", "0aca9d043c88cc89", "d20c6ab224212ea7"],
};
const print = (/** @type {boolean[][]} */ m) => createHash("sha256").update(m.map((r) => r.map((d) => (d ? "1" : "0")).join("")).join("\n")).digest("hex").slice(0, 16);

console.log("A. The same symbol as an independent encoder, mask by mask");
for (const [name, text] of Object.entries(TEXTS)) {
  const got = PINNED[name].map((_, mask) => print(qrMatrix(text, { mask })));
  ok(`${name} (${text.length} bytes, ${qrMatrix(text, { mask: 0 }).length} modules): all eight masks match`,
     got.every((h, i) => h === PINNED[name][i]), got.join(" "));
}

console.log("\nB. The mask it picks, and the drawing");
{
  const m = qrMatrix(TEXTS.all);
  const fixed = Array.from({ length: 8 }, (_, k) => print(qrMatrix(TEXTS.all, { mask: k })));
  ok("left to itself it draws one of the eight valid symbols", fixed.includes(print(m)));
  ok("...the same one every time", print(qrMatrix(TEXTS.all)) === print(m));
  ok("the display's longest link (112 bytes) is a version 7 symbol, 45 modules, version blocks and all", m.length === 45);
  const p = qrPath(m);
  ok("the path has a four-module quiet zone", p.size === 53);
  ok("...and one square per dark module", (p.d.match(/M/g) ?? []).length === m.flat().filter(Boolean).length);
  let threw = false;
  try { qrMatrix("q".repeat(3000)); } catch { threw = true; }
  ok("text no QR code can hold is refused, not truncated", threw);
}

console.log(`\nQR: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

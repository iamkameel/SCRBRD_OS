/**
 * THE SCORING PROOF (Kameel, 12 Nov 2026: "Yes, but use invented matches for
 * now"). An independent, repeatable check that the engine gets every total
 * right: each scorebook in test/scorebook/books is a match's paper — the balls
 * as a scorer writes them, and the card the paper states, worked out by hand
 * and typed independently (format.mjs). The harness (harness.mjs) scores the
 * balls through the pad's event path, folds the log with deriveMatch(), and
 * holds every figure to the card.
 *
 * Three questions for every book, in this order, so that a failure says
 * whose it is:
 *   1. does the card add up on its own (cardArithmetic — no fold is asked):
 *      a card that does not is a typing mistake in the fixture;
 *   2. could the pad score the paper, and would the Laws take every event;
 *   3. does the fold give every figure the card gives.
 *
 * A real school's scorebook can be added as one more .scorebook file.
 *
 *   node packages/scoring/test/scorebook-proof.test.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScorebook, cardArithmetic } from "./scorebook/format.mjs";
import { prove } from "./scorebook/harness.mjs";

const BOOKS = join(dirname(fileURLToPath(import.meta.url)), "scorebook", "books");

let pass = 0, fail = 0;
/** @param {string} n @param {boolean} c @param {string[]} [why] */
const ok = (n, c, why = []) => {
  if (c) { pass++; return; }
  fail++;
  console.log("  ✗", n);
  for (const w of why) console.log("      ", w);
};

const files = readdirSync(BOOKS).filter((f) => f.endsWith(".scorebook")).sort();
ok("there are scorebooks to prove", files.length >= 15, [`${files.length} found`]);

for (const f of files) {
  const book = parseScorebook(readFileSync(join(BOOKS, f), "utf8"), f);
  console.log(`\n${book.match} · ${book.title}`);
  for (const card of book.cards) {
    const sums = cardArithmetic(card);
    ok(`${book.match} innings ${card.innings}: the card adds up on its own`, sums.length === 0, sums);
  }
  const { mismatches, built } = prove(book);
  ok(`${book.match}: the pad could score it and the Laws took every event`, built.problems.length === 0, built.problems);
  const figures = mismatches.filter((m) => !built.problems.includes(m));
  ok(`${book.match}: every figure of the fold is the card's (${built.log.length} events)`, figures.length === 0, figures);
}

console.log(`\nscorebook proof: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// Every day and time a person sees is South African (Africa/Johannesburg,
// UTC+2, no summer time). lib/saTime.js is the one helper the screens use;
// lib/live.js's asMatch and asTraining name a fixture's and a practice's day
// and time through it, so a 14:30 fixture stored as 12:30Z reads 14:30.
import { saClock, saDate } from "../src/lib/saTime.js";

let passes = 0, fails = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (ok) passes++; else fails++;
};

// An instant in UTC reads on the SA clock.
eq("12:30Z reads 14:30", saClock("2026-11-06T12:30:00.000Z"), "14:30");
eq("12:30Z is the same SA day", saDate("2026-11-06T12:30:00.000Z"), "2026-11-06");
eq("13:00Z practice reads 15:00", saClock("2026-11-06T13:00:00Z"), "15:00");
// After 22:00 UTC it is already tomorrow in South Africa.
eq("23:30Z reads 01:30", saClock("2026-11-06T23:30:00Z"), "01:30");
eq("23:30Z is the next SA day", saDate("2026-11-06T23:30:00Z"), "2026-11-07");
eq("31 Dec 22:15Z is 1 Jan in SA", saDate("2026-12-31T22:15:00Z"), "2027-01-01");
// An offset is honoured, not double-shifted.
eq("14:30+02:00 stays 14:30", saClock("2026-11-06T14:30:00+02:00"), "14:30");
eq("14:30+02:00 stays the day", saDate("2026-11-06T14:30:00+02:00"), "2026-11-06");
eq("Postgres text form 12:30:00+00", saClock("2026-11-06 12:30:00+00"), "14:30");
// A Date and ms read the same way.
eq("a Date", saClock(new Date("2026-11-06T12:30:00Z")), "14:30");
eq("ms", saDate(Date.parse("2026-11-06T23:30:00Z")), "2026-11-07");
// A date-only string is a day already: never shifted.
eq("date-only unchanged", saDate("2026-11-06"), "2026-11-06");
eq("date-only has no clock", saClock("2026-11-06"), null);
// A wall clock with no zone is already local: read as written.
eq("zoneless wall clock is not shifted (time)", saClock("2026-11-06T14:30"), "14:30");
eq("zoneless wall clock is not shifted (day)", saDate("2026-11-06T23:30:00"), "2026-11-06");
// Nothing, or nonsense, is null.
eq("null", saClock(null), null);
eq("empty", saDate(""), null);
eq("garbage", saClock("not a time"), null);

// The adapters: a fixture and a practice as the API sends them.
const { readFileSync } = await import("node:fs");
const live = readFileSync(new URL("../src/lib/live.js", import.meta.url), "utf8");
eq("asMatch's time is on the SA clock", /time: saClock\(r\.starts_at\)/.test(live), true);
eq("asMatch's date is the SA day", /date: saDate\(r\.starts_at\)/.test(live), true);
eq("no UTC slice of a start time is left in live.js", /starts_at\)\.slice\(11|toISOString\(\)\.slice\(11/.test(live), false);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

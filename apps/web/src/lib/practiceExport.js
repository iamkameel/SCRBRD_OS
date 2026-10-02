/**
 * SCRBRD — a practice match's scorecard, as a file the scorer chooses to save.
 *
 * Plain text, so it opens anywhere and pastes into a message. It is built from
 * the ball log by the same fold the pad reads (scorer/penalty.js foldPad), so
 * it is the scorecard on the pad and not a second reckoning. It carries the
 * names: exporting is the scorer's choice, and what they do with the file
 * after that is theirs. Nothing here sends it anywhere; the screen offers a
 * download, which the browser hands to the person.
 */
import { describeResult } from "@scrbrd/scoring";
import { foldPad } from "../scorer/penalty.js";
import { weatherChangeWords, weatherStartWords } from "./practice.js";

const ov = (b) => `${Math.floor(b / 6)}.${b % 6}`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${d.getDate()} ${m} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * @param {any} meta   the stored record (lib/practice.js practiceRecord)
 * @param {any[][]} events  the ball log, one list per innings
 */
export function scorecardText(meta, events) {
  const home = meta?.teams?.[0]?.display_name ?? "Team 1";
  const away = meta?.teams?.[1]?.display_name ?? "Team 2";
  const innings = foldPad(events ?? [[], []], {}).filter((i) => i && i.battingTeam);
  const out = [];
  out.push(`${home} v ${away}`);
  out.push("PRACTICE MATCH — scored on one phone, not part of any fixture, table or statistic.");
  out.push("");
  if (meta?.match?.starts_at) out.push(`Started: ${when(meta.match.starts_at)}`);
  const v = meta?.match?.venue;
  if (v?.name) out.push(`Venue: ${v.name}`);
  out.push(`Overs per innings: ${meta?.match?.overs ?? ""}`);
  if (meta?.match?.toss) {
    const side = meta.match.toss.won_by === "away" ? away : home;
    out.push(`Toss: ${side} won and chose to ${meta.match.toss.decision}`);
  }
  const w = weatherStartWords(meta);
  if (w) out.push(`Weather at the start: ${w}`);
  for (const c of meta?.weather_changes ?? []) out.push(`Weather: ${weatherChangeWords(c)}`);

  innings.forEach((inn, idx) => {
    out.push("", "-".repeat(56));
    out.push(`${inn.battingTeam}, innings ${idx + 1}: ${inn.runs}/${inn.wickets} (${ov(inn.balls)} overs)`);
    out.push("");
    out.push(`${pad("Batter", 22)}${pad("", 26)}${lpad("R", 4)}${lpad("B", 4)}`);
    for (const b of inn.batsmen ?? []) {
      const how = b.status === "out" ? (b.dismissal ?? "out") : b.status === "retired" ? "retired hurt" : "not out";
      out.push(`${pad(b.name, 22)}${pad(how, 26)}${lpad(b.runs, 4)}${lpad(b.balls ?? "", 4)}`);
    }
    const ex = inn.extras ?? {};
    const exTotal = (ex.wide ?? 0) + (ex.noBall ?? 0) + (ex.bye ?? 0) + (ex.legBye ?? 0) + (ex.penalty ?? 0);
    out.push(`Extras: ${exTotal} (wides ${ex.wide ?? 0}, no-balls ${ex.noBall ?? 0}, byes ${ex.bye ?? 0}, leg byes ${ex.legBye ?? 0}${ex.penalty ? `, penalty ${ex.penalty}` : ""})`);
    out.push(`Total: ${inn.runs}/${inn.wickets} (${ov(inn.balls)} overs)`);
    const dnb = (inn.squad ?? []).map((p) => p?.name ?? p).filter((n) => !(inn.batsmen ?? []).some((b) => b.name === n || b.id === n));
    if (dnb.length) out.push(`Did not bat: ${dnb.join(", ")}`);
    if (inn.twelfthMan) out.push(`12th man: ${inn.twelfthMan}`);
    if ((inn.fow ?? []).length) out.push(`Fall of wickets: ${inn.fow.map((f, i) => `${f.runs}-${f.wickets ?? i + 1} (${f.batsman}${f.overs ? `, ${f.overs} ov` : ""})`).join(", ")}`);
    out.push("");
    out.push(`${pad("Bowler", 22)}${lpad("O", 6)}${lpad("M", 4)}${lpad("R", 5)}${lpad("W", 4)}`);
    for (const b of inn.bowlers ?? []) {
      out.push(`${pad(b.name, 22)}${lpad(ov(b.balls), 6)}${lpad(b.maidens ?? 0, 4)}${lpad(b.runs, 5)}${lpad(b.wickets, 4)}`);
    }
  });

  const result = (() => { try { return describeResult(innings, {}); } catch { return null; } })();
  if (result?.text) out.push("", "-".repeat(56), `Result: ${result.text}`);
  out.push("", `Saved from SCRBRD on ${when(new Date().toISOString())}.`);
  return out.join("\n") + "\n";
}

/** A file name that says what it is without anyone's name in it: the sides and the date. @param {any} meta */
export function scorecardFileName(meta) {
  const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const d = meta?.match?.starts_at ? new Date(meta.match.starts_at) : new Date();
  const day = Number.isNaN(d.getTime()) ? "" : `-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const sides = (meta?.teams ?? []).map((t) => slug(t.display_name)).filter(Boolean).join("-v-");
  return `practice-match${sides ? `-${sides}` : ""}${day}.txt`;
}

/**
 * Hand the file to the person: a download the browser asks them about or
 * drops in their downloads folder. Nothing is uploaded.
 * @param {string} text @param {string} name
 */
export function saveTextFile(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

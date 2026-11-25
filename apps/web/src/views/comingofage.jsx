import { useEffect, useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";
import { BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";
import { comingOfAgeLine, comingOfAgeWritten } from "../lib/comingOfAge.js";

/**
 * "Coming of age" (db/173; Kameel, 25 Nov 2026, Q2): the boys at the school
 * who are 18, or will be within 60 days, on a date nobody at the school
 * office wrote or confirmed. One action each, "Confirm his date", after the
 * office has checked it against the school's register.
 *
 *   GET  /api/schools/:id/coming-of-age            (the office alone)
 *   POST /api/players/:id/date-of-birth/confirm
 *
 * Drawn for the office (the three capabilities of db/172's
 * player_born_office(), which the server asks again). Floors: 12px text, 44px taps.
 */

const sub = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.5, color: D.textSecondary });

function SchoolComingOfAge({ school }) {
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState(/** @type {{ bad: boolean, text: string } | null} */ (null));
  useEffect(() => {
    let off = false;
    api(`/api/schools/${encodeURIComponent(school.id)}/coming-of-age`)
      .then((r) => { if (!off) setRows(r?.rows ?? []); })
      // Refused (not this school's office): nothing is drawn for it.
      .catch(() => { if (!off) setRows(/** @type {any} */ ("refused")); });
    return () => { off = true; };
  }, [school.id, nonce]);
  const confirm = async (/** @type {any} */ r) => {
    setBusy(r.playerId); setNote(null);
    try {
      await api(`/api/players/${encodeURIComponent(r.playerId)}/date-of-birth/confirm`, { method: "POST", body: {} });
      setNote({ bad: false, text: `Confirmed ${r.fullName}'s date of birth.` });
    } catch (e) {
      const code = /** @type {any} */ (e)?.code;
      setNote({ bad: true, text: BIRTH_DATE_MESSAGE[code] ?? "The date could not be confirmed. Try again." });
    }
    setBusy(null); setNonce((n) => n + 1);
  };
  if (rows === /** @type {any} */ ("refused")) return null;
  const list = rows ?? [];
  return (
    <div data-testid="coming-of-age-school" data-school={school.id} style={{ marginTop: "8px" }}>
      {rows === null && <div style={sub()}>Reading the list…</div>}
      {rows !== null && list.length === 0 && <div data-testid="coming-of-age-none" style={sub()}>No date of birth waits to be confirmed.</div>}
      {list.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "8px" }}>
          {list.map((r) => (
            <li key={r.playerId} data-testid="coming-of-age-row" data-player={r.playerId}
                style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap",
                         padding: "10px 12px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 }}>
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <div style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary, overflowWrap: "anywhere" }}>{comingOfAgeLine(r)}</div>
                <div style={sub()}>{comingOfAgeWritten(r)}</div>
              </div>
              <button type="button" className="pressBtn" disabled={busy === r.playerId} onClick={() => confirm(r)}
                data-testid="coming-of-age-confirm"
                style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, border: "1px solid transparent",
                         background: D.indigo, color: inkOn(D.indigo), fontFamily: D.head, fontSize: "13px", fontWeight: 700,
                         cursor: busy === r.playerId ? "not-allowed" : "pointer", opacity: busy === r.playerId ? 0.5 : 1 }}>
                {busy === r.playerId ? "Confirming…" : "Confirm his date"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && <div role={note.bad ? "alert" : "status"} data-testid="coming-of-age-said"
                    style={{ ...sub(), marginTop: "8px", color: note.bad ? textOn(D.rose) : D.textPrimary }}>{note.text}</div>}
    </div>
  );
}

/** The panel: one list per school where this person is the office. */
export function ComingOfAgePanel() {
  const schools = schoolsWhere("player.identity.read");
  if (schools.length === 0) return null;
  return (
    <section data-testid="coming-of-age" aria-labelledby="coming-of-age-h"
      style={{ marginBottom: "16px", padding: "16px", borderRadius: D.lg, border: `1px solid ${D.border}`, background: D.surf1 }}>
      <h2 id="coming-of-age-h" style={{ margin: 0, fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>Coming of age</h2>
      <div style={{ ...sub(), margin: "3px 0 6px", maxWidth: "62ch" }}>
        Boys who are 18, or will be within 60 days, on a date nobody at the office has checked. At 18 a boy&apos;s own sign-in is his, with nobody asked. Check each date against the register, then confirm it.
      </div>
      {schools.map((s) => (
        <div key={s.id}>
          {schools.length > 1 && <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary, marginTop: "10px" }}>{s.name}</div>}
          <SchoolComingOfAge school={s}/>
        </div>
      ))}
    </section>
  );
}

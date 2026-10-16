/**
 * THE COACH'S COMPOSER for the plan to the side (SCRBRD-138 phase B;
 * docs/design/SCRBRD-138_phaseB.md §5.1, §3.4).
 *
 * Opened from the Coach tab of a fixture the coach's side plays in, so the
 * fixture is not asked for: it is named, and the title is made by the screen
 * ("The plan: v Kearsney, Sat 3 Oct") and is not his to edit. One body of at
 * most 1 000 characters, counted from 900. The side he published is read-only
 * above it, as names and places. Nothing from it is copied into the plan: what
 * goes out is what he typed.
 *
 * THE WORD LIST. Before anything is sent the same list the server uses
 * (@scrbrd/policy/words) is run over the title and the body, as a courtesy: on
 * a hit the Send and Save buttons are disabled, and the refusal is said in
 * words under the field, with each refused word named. The server still
 * decides: its own refusal (a stale bundle, a longer list) is shown the same
 * way. The region is `aria-live="polite"` and the field's `aria-describedby`
 * names it, so a screen reader hears it; it is announced after a short pause in
 * typing, not on every letter. What the coach typed is never cleared by a
 * refusal, a failure or a reload of the plan beneath it.
 *
 * WHAT IT DOES NOT HAVE: a per-boy field, an attachment, a reply.
 *
 * CHANGING AN UNSENT PLAN (db/110, Kameel 15 Oct). Given `draft`, the composer
 * opens on that plan's words and loudness and saves or sends through
 * POST /api/news/:id/edit: a plan never sent, or one withdrawn (which comes
 * back to its author to change and send again). A plan out with the side is
 * not changed here; it is withdrawn first.
 *
 * This file is its own lazy chunk (CoachTab loads it on the first tap), which
 * is where the word list's bytes go: the entry bundle does not carry them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { refusedWords, refusalMessage } from "@scrbrd/policy/words";
import { T } from "../../design/tokens.js";
import { api } from "../../lib/api.js";
import { PLAN_MAX, planRefusal } from "../../lib/captain.js";
import { Action, Card, Line } from "../family/parts.jsx";

const HONESTY = "Read by every boy in the side and their parents. Kept with the fixture; a DSO can open it. Name the other side's boys only as the public scorecard does.";
const LIMITS = "A word list catches words, not meaning. You are the check on how it sounds.";

/** "1 000" @param {number} n */
const spaced = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, " ");

/**
 * @param {{
 *   match: any,
 *   side: { school: string, team: string },
 *   title: string,
 *   opponent: string,
 *   sheet: { playerId: string, name: string, battingNo: number | null, twelfth: boolean }[],
 *   onClose: () => void,
 *   onDone: (what: "sent" | "saved") => void,
 *   draft?: { id: string, body: string, urgency: string, wasSent: boolean } | null,
 * }} p
 */
export default function PlanComposer({ match, side, title, opponent, sheet, onClose, onDone, draft = null }) {
  const [body, setBody] = useState(draft?.body ?? "");
  const [phones, setPhones] = useState(draft?.urgency === "medium");
  const [busy, setBusy] = useState(/** @type {null | "send" | "save"} */ (null));
  const [serverSaid, setServerSaid] = useState(/** @type {null | { code: string, message: string, words: { word: string, cls: string }[] }} */ (null));
  const field = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  useEffect(() => { field.current?.focus(); }, []);

  // The courtesy check, now (it decides the buttons) and, after a pause, in words (it is read out).
  const hits = useMemo(() => refusedWords(`${title}\n${body}`), [title, body]);
  const [shown, setShown] = useState(/** @type {{ word: string, cls: string }[]} */ ([]));
  useEffect(() => {
    if (!hits.length) { setShown([]); return undefined; }
    const t = setTimeout(() => setShown(hits), 450);
    return () => clearTimeout(t);
  }, [hits]);

  const length = body.trim().length;
  const over = length > PLAN_MAX;
  const refusal = serverSaid ?? (shown.length ? { code: "refused_words", words: shown, message: refusalMessage(shown) ?? "" } : null);
  const blocked = hits.length > 0 || over || length === 0 || busy != null;

  const go = async (/** @type {"send" | "save"} */ how) => {
    if (blocked) return;
    setBusy(how); setServerSaid(null);
    try {
      if (draft) {
        await api(`/api/news/${draft.id}/edit`, { method: "POST", body: {
          body: body.trim(), urgency: phones ? "medium" : "low", send: how === "send",
        } });
      } else {
        await api("/api/news", { method: "POST", body: {
          scope: "team", schoolId: side.school, teamCode: side.team, kind: "plan", fixtureId: match.id,
          title, body: body.trim(), publish: how === "send", urgency: phones ? "medium" : "low",
        } });
      }
      onDone(how === "send" ? "sent" : "saved");
    } catch (/** @type {any} */ e) {
      setServerSaid(planRefusal(e));
      setBusy(null);
    }
  };

  const names = sheet.filter((r) => !r.twelfth).map((r) => `${r.battingNo != null ? `${r.battingNo} ` : ""}${r.name}`);
  const twelfth = sheet.filter((r) => r.twelfth).map((r) => r.name);

  return (
    <Card label={draft ? "Change the plan" : "Write the plan"} testid="plan-composer">
      <form onSubmit={(e) => { e.preventDefault(); void go("send"); }} style={{ display: "grid", gap: T.space.md }} noValidate>
        <Line strong testid="plan-title">{title}</Line>
        <Line quiet>The title is made for you, from the fixture: v {opponent}.</Line>

        {names.length > 0 && (
          <div data-testid="plan-sheet" style={{ display: "grid", gap: T.space.xs }}>
            <span style={{ ...T.role.label, color: T.content.secondary }}>The side you published</span>
            <p style={{ ...T.role.body, fontSize: "14px", color: T.content.primary, margin: 0 }}>
              {names.join(" · ")}{twelfth.length ? ` · 12th: ${twelfth.join(", ")}` : ""}
            </p>
          </div>
        )}

        <div style={{ display: "grid", gap: T.space.xs }}>
          <label htmlFor="plan-body" style={{ ...T.role.label, color: T.content.secondary }}>The plan</label>
          <textarea id="plan-body" ref={field} data-testid="plan-body-field" value={body} rows={7}
            onChange={(e) => { setBody(e.target.value); setServerSaid(null); }}
            aria-describedby="plan-honesty plan-refusal plan-count" aria-invalid={refusal || over ? "true" : undefined}
            placeholder="What the side needs to hear before the day."
            style={{ ...T.role.control, width: "100%", boxSizing: "border-box", minHeight: "44px", padding: `${T.space.sm} ${T.space.md}`,
              background: T.surface.interactive, color: T.content.primary, border: `1px solid ${refusal || over ? T.semantic.criticalText : T.line.normal}`,
              borderRadius: T.radius.md, resize: "vertical", fontWeight: 400, lineHeight: 1.5 }}/>
          <p id="plan-count" data-testid="plan-count" style={{ ...T.role.body, fontSize: "14px", margin: 0, textAlign: "right",
            color: over ? T.semantic.criticalText : T.content.secondary, visibility: length >= 900 ? "visible" : "hidden" }}>
            {length >= 900 ? `${spaced(length)} of ${spaced(PLAN_MAX)}${over ? ` · ${spaced(length - PLAN_MAX)} over` : ""}` : " "}
          </p>
        </div>

        {/* The refusal: in words, the refused words named, read out. The region is always here so a change in it is announced. */}
        <div id="plan-refusal" data-testid="plan-refusal" aria-live="polite" style={{ display: "grid", gap: T.space.xs }}>
          {refusal && (
            <>
              <p data-testid="plan-refusal-message" style={{ ...T.role.body, fontSize: "14px", color: T.semantic.criticalText, margin: 0, fontWeight: 600 }}>{refusal.message}</p>
              {refusal.words.length > 0 && (
                <p data-testid="plan-refused-words" style={{ ...T.role.body, fontSize: "14px", color: T.content.primary, margin: 0 }}>
                  Words to change: {refusal.words.map((w, i) => (
                    <span key={w.word}>{i > 0 ? ", " : ""}<strong style={{ textDecoration: "underline" }}>{w.word}</strong></span>
                  ))}
                </p>
              )}
            </>
          )}
        </div>

        <p id="plan-honesty" data-testid="plan-honesty" style={{ ...T.role.body, fontSize: "14px", color: T.content.primary, margin: 0 }}>
          {HONESTY} <span style={{ color: T.content.secondary }}>{LIMITS}</span>
        </p>

        {/* The post's own option, unchanged: low stays in the app, medium is "Send to phones too". Never louder. */}
        <div data-testid="plan-phones-row" style={{ display: "grid", gap: T.space.xs, justifyItems: "start" }}>
          <Action testid="plan-phones" pressed={phones} onClick={() => setPhones((p) => !p)}>
            Send to phones too
          </Action>
          <span id="plan-phones-hint" style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>
            {phones ? "Phones that allow alerts show “You have a new notice.” The words stay in the app."
              : "In the app only: it waits in Notices until people open SCRBRD."}
          </span>
        </div>

        <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Action testid="plan-cancel" onClick={onClose} disabled={busy != null}>Cancel</Action>
          <Action testid="plan-save" disabled={blocked} onClick={() => { void go("save"); }}>{busy === "save" ? "Saving…" : draft ? "Save changes" : "Save draft"}</Action>
          <Action testid="plan-send" primary disabled={blocked} type="submit">{busy === "send" ? "Sending…" : draft?.wasSent ? "Send again" : "Send to the side"}</Action>
        </div>
      </form>
    </Card>
  );
}

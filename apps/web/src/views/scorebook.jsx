import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { formatWhen } from "../lib/playingConditions.js";
import { sidesOf } from "../lib/matchCentre.js";
import { uncheckedCells } from "@scrbrd/scoring";
import { Badge } from "../ui/primitives.jsx";
import { Icon } from "../ui/icons.jsx";
import { useIsMobile } from "../shell/MobileNav.jsx";
import {
  EDITABLE, FINISHED, STATE_SHORT, STATE_WORDS, blankCard, dropCardChecked, fetchPage, hadPages, inningsWord, livePages,
  nameOfRef, pruneTyped, refusalWords, refusalsByCell, refusalsOf, removePage, rowPaths, settleTyped, setPath, shiftChecked,
  startedYet, tickProgress, titleOf, uploadPage, cellWords, workedOn, getPath,
} from "../lib/scorebook.js";
import { CardEditor, CardReader, rosterGroups, styles } from "./scorebookcard.jsx";

/**
 * Importing a paper scorebook (SCRBRD-120, phase 1; db/63, API in
 * services/api/write/scorebook-api.mjs).
 *
 * THREE SCREENS over one import, chosen by where it stands and who is looking:
 *
 *   UPLOAD   a writer, an import in draft, review or returned: add the page
 *            photos, see them.
 *   REVIEW   the same writer: the card typed beside the pages, a tick on every
 *            cell, the arithmetic as it is typed, save, submit.
 *   CONFIRM  the school's director of sport (a league's administrator for a
 *            league fixture), a submitted import: the card read-only beside
 *            the pages; confirm, or return with a note. Never edit.
 *
 * Reached from the Match Centre: a fixture's side panel offers it, and only
 * when the API's import list says this person may write, confirm or read an
 * import of the fixture (`may`) and the module is on for its school (`module`);
 * a 403 or a module that is off draws nothing.
 *
 * WHAT THIS DECIDES: nothing. Who may import, who may confirm, that two people
 * sign it and what the Laws and the seal say at the commit are the API's; a
 * refusal is worded beside the thing refused (lib/scorebook.js). The card's
 * arithmetic is the same function the server runs.
 *
 * THE PAGES are children's names in handwriting. Each is fetched with the
 * bearer token into memory, shown through a blob URL, and revoked when the
 * screen goes; none is written to storage, put in an address or logged.
 */

// ── The pages, in memory ────────────────────────────────────────────────

/**
 * The photos of an import, fetched one at a time into blob URLs and revoked
 * when they are no longer wanted or the screen goes. Never cached.
 * @param {string} importId @param {Array<{pageNo: number, sha256: string, deletedAt?: unknown}>} pages
 */
function usePageBlobs(importId, pages) {
  const [urls, setUrls] = useState(/** @type {Record<number, string>} */ ({}));
  const [errors, setErrors] = useState(/** @type {Record<number, string>} */ ({}));
  const alive = useRef(/** @type {Map<number, string>} */ (new Map()));
  const live = livePages(pages);
  const key = live.map((p) => `${p.pageNo}:${p.sha256}`).join(",");
  useEffect(() => {
    const ctl = new AbortController();
    const held = alive.current;
    const want = new Set(key ? key.split(",").map((k) => Number(k.split(":")[0])) : []);
    for (const [n, url] of held) if (!want.has(n)) { URL.revokeObjectURL(url); held.delete(n); }
    (async () => {
      for (const n of want) {
        if (held.has(n)) continue;
        try {
          const blob = await fetchPage(importId, n, ctl.signal);
          if (ctl.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          held.set(n, url);
          setUrls((u) => ({ ...u, [n]: url }));
        } catch (/** @type {any} */ e) {
          if (!ctl.signal.aborted) setErrors((x) => ({ ...x, [n]: refusalWords(e) }));
        }
      }
    })();
    return () => ctl.abort();
  }, [importId, key]);
  useEffect(() => {
    const held = alive.current;
    return () => { for (const url of held.values()) URL.revokeObjectURL(url); held.clear(); };
  }, []);
  return { urls, errors };
}

/**
 * The pages: thumbnails, and the page shown large, zoomable. With `onRemove`
 * (a writer, the import still being typed) the page shown can be taken off
 * the import, after a question asked in place.
 * @param {{ pages: any[], photos: {urls: Record<number, string>, errors: Record<number, string>}, sticky?: boolean,
 *           onRemove?: (pageNo: number) => Promise<boolean>, busy?: boolean }} props
 */
function PhotoColumn({ pages, photos, sticky, onRemove, busy }) {
  const S = styles();
  const live = livePages(pages);
  const [sel, setSel] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [removing, setRemoving] = useState(/** @type {number | null} */ (null));
  const shown = live.find((p) => p.pageNo === sel) ?? live[0] ?? null;
  if (!live.length) {
    return (
      <div style={S.card} data-testid="sb-photos">
        <h3 style={S.h4}>The pages</h3>
        <p style={S.body} data-testid="sb-no-pages">{hadPages(pages) ? "The photos of this import have been deleted." : "No pages have been added yet."}</p>
      </div>
    );
  }
  async function remove(/** @type {number} */ n) {
    if (!onRemove) return;
    if (await onRemove(n)) { setRemoving(null); setZoom(1); }
  }
  const url = shown ? photos.urls[shown.pageNo] : null;
  return (
    <div style={{ ...S.card, ...(sticky ? { position: "sticky", top: T.space.sm, maxHeight: "calc(100vh - 16px)", overflowY: "auto" } : {}) }} data-testid="sb-photos">
      <h3 style={S.h4}>The pages ({live.length})</h3>
      <div style={S.wrap} role="group" aria-label="Pages">
        {live.map((p) => (
          <button key={p.pageNo} type="button" data-testid={`sb-thumb-${p.pageNo}`} aria-pressed={shown?.pageNo === p.pageNo} aria-label={`Show page ${p.pageNo}`}
            onClick={() => { setSel(p.pageNo); setZoom(1); }}
            style={{ width: "72px", minHeight: "72px", padding: 0, overflow: "hidden", cursor: "pointer", borderRadius: T.radius.md, background: T.surface.base,
                     border: `2px solid ${shown?.pageNo === p.pageNo ? T.content.primary : T.line.normal}`, display: "grid", placeItems: "center", color: T.content.secondary,
                     fontFamily: T.type.body, fontSize: "12px" }}>
            {photos.urls[p.pageNo]
              ? <img src={photos.urls[p.pageNo]} alt="" data-testid={`sb-thumb-img-${p.pageNo}`} style={{ width: "100%", height: "72px", objectFit: "cover", display: "block" }}/>
              : <span>{photos.errors[p.pageNo] ? "!" : "…"}</span>}
          </button>
        ))}
      </div>
      {shown && (
        <>
          <div style={S.wrap}>
            <span style={S.body} data-testid="sb-page-label">Page {shown.pageNo}</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} style={S.small} data-testid="sb-zoom-in">Zoom in</button>
            <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} style={S.small} data-testid="sb-zoom-out">Zoom out</button>
            <button type="button" onClick={() => setZoom(1)} style={S.small}>Fit to width</button>
            {onRemove && removing !== shown.pageNo && (
              <button type="button" data-testid={`sb-remove-page-${shown.pageNo}`} onClick={() => setRemoving(shown.pageNo)} style={S.small}>
                Remove page {shown.pageNo}
              </button>
            )}
          </div>
          {onRemove && removing === shown.pageNo && (
            <div style={S.panel} data-testid="sb-remove-page-ask">
              <p style={{ ...S.body, color: T.content.primary }}>Take page {shown.pageNo} off this import? Its photo is deleted. The other pages keep their numbers.</p>
              <div style={S.wrap}>
                <button type="button" data-testid="sb-remove-page-yes" disabled={busy} onClick={() => remove(shown.pageNo)} style={S.danger}>Yes, remove page {shown.pageNo}</button>
                <button type="button" data-testid="sb-remove-page-no" onClick={() => setRemoving(null)} style={S.secondary}>Keep it</button>
              </div>
            </div>
          )}
          <div role="region" aria-label={`Page ${shown.pageNo} of the scorebook`} tabIndex={0} data-testid="sb-page-view"
            style={{ overflow: "auto", maxHeight: "70vh", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, background: T.surface.base }}>
            {url
              ? <img src={url} alt={`Photo of scorebook page ${shown.pageNo}`} data-testid="sb-page-img" style={{ width: `${zoom * 100}%`, maxWidth: "none", display: "block" }}/>
              : <p style={{ ...S.body, padding: T.space.lg }}>{photos.errors[shown.pageNo] ?? "Loading the photo…"}</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Upload ──────────────────────────────────────────────────────────────

function UploadScreen({ R }) {
  const S = styles();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(/** @type {Array<{ok: boolean, text: string}>} */ ([]));
  async function pick(/** @type {any} */ ev) {
    const files = Array.from(ev.target.files ?? []);
    ev.target.value = "";
    if (!files.length) return;
    setBusy(true);
    const out = [];
    for (const [i, f] of files.entries()) {
      try {
        const r = await uploadPage(R.id, f);
        out.push({ ok: true, text: `Photo ${i + 1} of ${files.length}: added as page ${r.pageNo}.` });
      } catch (/** @type {any} */ e) {
        out.push({ ok: false, text: `Photo ${i + 1} of ${files.length}: ${refusalWords(e)}` });
      }
      setResults([...out]);
    }
    await R.afterUpload(out.filter((r) => r.ok).length);
    setBusy(false);
  }
  const live = livePages(R.d.pages);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.space.lg }} data-testid="sb-upload">
      <div style={S.card}>
        <h3 style={S.h3}>Add the pages of the scorebook</h3>
        <p style={S.body}>Photograph each page of the book that has this innings on it, flat and in good light. JPEG or PNG, up to 8 MB a page and 12 pages an import. The photos show children's names: they are kept privately, shown only to the people who work on this import, and deleted after it is done.</p>
        <div>
          <label htmlFor="sb-file" style={S.label}>Add page photos</label>
          <input id="sb-file" data-testid="sb-file" type="file" multiple accept="image/jpeg,image/png" disabled={busy} onChange={pick}
            style={{ ...S.input, padding: "8px 12px", fontSize: "14px" }}/>
        </div>
        <div role="status" data-testid="sb-upload-status" aria-live="polite">
          {busy && <p style={S.body}>Adding photos…</p>}
          {results.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: T.space.xs }}>
              {results.map((r, i) => <li key={i} data-testid={r.ok ? "sb-upload-ok" : "sb-upload-refused"} style={{ ...S.body, color: r.ok ? T.content.secondary : T.semantic.criticalText }}>{r.text}</li>)}
            </ul>
          )}
        </div>
      </div>
      <PhotoColumn pages={R.d.pages} photos={R.photos} onRemove={R.removePage} busy={R.busy}/>
      <div style={S.wrap}>
        <button type="button" data-testid="sb-next" onClick={() => R.setStep("card")} style={S.primary}>
          {live.length ? "Next: type the card" : "Next: type the card (no pages yet)"}
        </button>
        {R.d.import.cards.length > 0 && <span style={S.meta}>The card already has {R.d.import.cards.length} innings.</span>}
      </div>
    </div>
  );
}

// ── Review ──────────────────────────────────────────────────────────────

/** Add an innings: which of the four, and which side bats. */
function AddInnings({ R }) {
  const S = styles();
  const taken = new Set(R.draft.cards.map((c) => c.innings));
  const state = new Map((R.d.innings ?? []).map((i) => [i.innings, i]));
  const free = [0, 1, 2, 3].filter((n) => !taken.has(n));
  const [n, setN] = useState(free[0] ?? 0);
  const [side, setSide] = useState(/** @type {"home" | "away"} */ ("home"));
  if (!free.length) return null;
  const pick = free.includes(n) ? n : free[0];
  const why = (/** @type {number} */ i) => {
    const s = state.get(i);
    return s?.summarised ? " (already from a scorebook)" : s?.deliveries > 0 ? " (scored on the pad)" : "";
  };
  const blocked = (/** @type {number} */ i) => { const s = state.get(i); return !!(s?.summarised || s?.deliveries > 0); };
  return (
    <div style={{ ...S.panel }} data-testid="sb-add-innings">
      <h4 style={S.h4}>Add an innings</h4>
      <div style={S.grid}>
        <div>
          <label htmlFor="sb-inn-n" style={S.label}>Which innings</label>
          <select id="sb-inn-n" data-testid="sb-inn-n" value={pick} onChange={(e) => setN(Number(e.target.value))} style={S.input}>
            {free.map((i) => <option key={i} value={i} disabled={blocked(i)}>{inningsWord(i)}{why(i)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sb-inn-side" style={S.label}>Who batted</label>
          <select id="sb-inn-side" data-testid="sb-inn-side" value={side} onChange={(e) => setSide(/** @type {any} */ (e.target.value))} style={S.input}>
            <option value="home">{R.sideNames.home}</option>
            <option value="away">{R.sideNames.away}</option>
          </select>
        </div>
      </div>
      <button type="button" data-testid="sb-add-innings-go" disabled={blocked(pick)} onClick={() => R.addInnings(pick, side)} style={{ ...S.secondary, alignSelf: "flex-start" }}>Add this innings</button>
    </div>
  );
}

function ReviewScreen({ R }) {
  const S = styles();
  const wide = !useIsMobile(900);
  const { cards, typed, checked } = R.draft;
  const cur = Math.min(R.cur, cards.length - 1);
  // A cell not yet filled in is not "wrong": until the person has tried to
  // submit, a blank is left to the "Still to check" prompt, not to a refusal.
  const local = useMemo(() => refusalsOf(cards, typed, R.ours).map((rs, n) => rs.filter((r) => {
    if (R.attempted || r.code !== "card_shape") return true;
    const v = getPath(cards[n], r.path);
    return !(v === null || v === undefined || v === "");
  })), [cards, typed, R.ours, R.attempted]);
  const progress = tickProgress(cards, checked);
  const scoredLive = (R.d.innings ?? []).filter((i) => i.deliveries > 0 || i.summarised);
  const problems = local.flatMap((rs, n) => rs.map((r) => ({ ...r, n })));
  const ctx = cur >= 0 ? {
    n: cur, card: cards[cur], cards, typed, checked, attempted: R.attempted, groups: R.groups, rosterMap: R.rosterMap, sideNames: R.sideNames,
    refusals: refusalsByCell(local[cur] ?? []),
    ours: (/** @type {"home" | "away"} */ side) => R.ours === "both" || side === "home",
    nameOf: (/** @type {string} */ ref) => nameOfRef(ref, typed, R.rosterMap),
    setCell: (/** @type {string} */ p, /** @type {unknown} */ v) => R.setCell(cur, p, v),
    setName: (/** @type {string} */ p, /** @type {string} */ text, /** @type {string | null} */ current) => R.setName(cur, p, text, current),
    setTick: (/** @type {string} */ p, /** @type {boolean} */ on) => R.setTick(cur, p, on),
    tickRow: (/** @type {string} */ list, /** @type {number} */ i, /** @type {boolean} */ on) => R.tickRow(cur, list, i, on),
    addRow: (/** @type {string} */ list, /** @type {unknown} */ blank) => R.addRow(cur, list, blank),
    removeRow: (/** @type {string} */ list, /** @type {number} */ i) => R.removeRow(cur, list, i),
    setUnreconciled: (/** @type {unknown} */ u) => R.setCell(cur, "unreconciled", u, false),
  } : null;
  return (
    <div style={{ display: "grid", gap: T.space.lg, gridTemplateColumns: wide ? "minmax(280px, 4fr) minmax(0, 8fr)" : "minmax(0, 1fr)", alignItems: "start" }} data-testid="sb-review">
      <PhotoColumn pages={R.d.pages} photos={R.photos} sticky={wide} onRemove={R.removePage} busy={R.busy}/>
      <div style={{ display: "flex", flexDirection: "column", gap: T.space.lg, minWidth: 0 }}>
        {R.d.import.state === "returned" && (
          <div style={{ ...S.panel, borderColor: T.semantic.warning }} data-testid="sb-returned-note">
            <h3 style={S.h4}>Returned to you with a note</h3>
            <p style={{ ...S.body, color: T.content.primary }}>{R.d.import.returnedNote}</p>
          </div>
        )}
        {scoredLive.length > 0 && (
          <div style={S.panel} data-testid="sb-live-innings">
            <h3 style={S.h4}>Some innings are already recorded</h3>
            <p style={S.body}>
              {scoredLive.map((i) => `${inningsWord(i.innings)} ${i.summarised ? "is already from a scorebook" : `was scored on the pad (${i.deliveries} deliveries)`}`).join("; ")}.
              A book cannot replace a scored innings: to correct one, the match is amended first.
            </p>
          </div>
        )}
        <div style={S.card}>
          <div style={{ ...S.wrap, justifyContent: "space-between" }}>
            <h3 style={S.h3}>The card</h3>
            <p role="status" data-testid="sb-progress" style={S.body}>
              {cards.length ? `${progress.total - progress.left} of ${progress.total} cells checked` : "No innings on the card yet"}
            </p>
          </div>
          <p style={S.meta}>Type each figure as the book shows it. Leave a box empty if the book does not give it, and tick it: an empty box is not a nought. Changing a box ticks it; tick the rest once you have checked them against the page.</p>
          {cards.length > 0 && (
            <div style={S.wrap} role="group" aria-label="Innings on the card">
              {cards.map((c, n) => (
                <button key={n} type="button" aria-pressed={n === cur} data-testid={`sb-tab-${n}`} onClick={() => R.setCur(n)}
                  style={{ ...S.secondary, ...(n === cur ? { background: T.content.primary, color: T.surface.canvas, borderColor: T.content.primary } : {}) }}>
                  {inningsWord(c.innings)}
                </button>
              ))}
            </div>
          )}
          {problems.length > 0 && (
            <div data-testid="sb-problems" style={{ ...S.panel, borderColor: T.semantic.critical }}>
              <h4 style={S.h4}>{problems.length} {problems.length === 1 ? "thing" : "things"} to put right before this can be submitted</h4>
              <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: T.space.xs }}>
                {problems.map((p, i) => <li key={i} style={{ ...S.body, color: T.semantic.criticalText }}>{cellWords(`${p.n}.${p.path}`, { withCard: true })}: {p.text}</li>)}
              </ul>
            </div>
          )}
          {ctx ? <CardEditor key={cur} ctx={ctx}/> : <p style={S.body} data-testid="sb-empty-card">Add the first innings to begin.</p>}
          {cur >= 0 && (
            <button type="button" data-testid="sb-remove-innings" onClick={() => R.removeInnings(cur)} style={{ ...S.secondary, alignSelf: "flex-start" }}>
              Remove {inningsWord(cards[cur].innings)} from the card
            </button>
          )}
        </div>
        <AddInnings key={cards.length} R={R}/>
      </div>
    </div>
  );
}

// ── Confirm ─────────────────────────────────────────────────────────────

function ConfirmScreen({ R }) {
  const S = styles();
  const wide = !useIsMobile(900);
  const imp = R.d.import;
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [returning, setReturning] = useState(false);
  const [why, setWhy] = useState("");
  const unreconciled = imp.cards.some((c) => c.unreconciled != null);
  const cells = R.d.cells;
  const ticked = cells - (R.d.unchecked?.length ?? 0);
  return (
    <div style={{ display: "grid", gap: T.space.lg, gridTemplateColumns: wide ? "minmax(280px, 4fr) minmax(0, 8fr)" : "minmax(0, 1fr)", alignItems: "start" }} data-testid="sb-confirm">
      <PhotoColumn pages={R.d.pages} photos={R.photos} sticky={wide}/>
      <div style={{ display: "flex", flexDirection: "column", gap: T.space.lg, minWidth: 0 }}>
        <CardsRead R={R}/>
        {R.mayAct ? (
          <div style={S.card} data-testid="sb-decide">
            <h3 style={S.h3}>Confirm or return</h3>
            <p style={S.body}>Check the card against the pages. You cannot change a figure: if something is wrong, return it with a note and the scorer corrects it. Confirming writes each innings into the match's record and completes the match.</p>
            <p style={S.meta} data-testid="sb-ticks">{ticked} of {cells} cells were checked by the person who typed the card.</p>
            {unreconciled && (
              <label style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", minHeight: "44px", cursor: "pointer", ...S.body, color: T.content.primary }}>
                <input type="checkbox" data-testid="sb-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: "20px", height: "20px", marginTop: "2px", flexShrink: 0 }}/>
                <span>I have seen that the book's batting figures do not add up to its total. Confirm the record with that difference noted as a footnote.</span>
              </label>
            )}
            {!returning && (
              <div>
                <label htmlFor="sb-confirm-note" style={S.label}>Note for the record (optional)</label>
                <input id="sb-confirm-note" data-testid="sb-confirm-note" type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} style={S.input}/>
              </div>
            )}
            {asking && (
              <div style={S.panel} data-testid="sb-confirm-ask">
                <p style={{ ...S.body, color: T.content.primary }}>This cannot be undone here: a wrong record is corrected by an amendment. Confirm this import?</p>
                <div style={S.wrap}>
                  <button type="button" data-testid="sb-confirm-yes" disabled={R.busy} onClick={() => R.confirm({ acknowledgeUnreconciled: ack, note: note.trim() || undefined })} style={S.primary}>Yes, confirm it</button>
                  <button type="button" data-testid="sb-confirm-no" onClick={() => setAsking(false)} style={S.secondary}>Not yet</button>
                </div>
              </div>
            )}
            {returning && (
              <div style={S.panel} data-testid="sb-return-form">
                <label htmlFor="sb-return-note" style={S.label}>What needs changing? (at least ten characters)</label>
                <textarea id="sb-return-note" data-testid="sb-return-note" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} style={S.input}/>
                <div style={S.wrap}>
                  <button type="button" data-testid="sb-return-send" disabled={R.busy} onClick={() => R.giveBack(why)} style={S.primary}>Send it back</button>
                  <button type="button" data-testid="sb-return-cancel" onClick={() => setReturning(false)} style={S.secondary}>Cancel</button>
                </div>
              </div>
            )}
            {!asking && !returning && (
              <div style={S.wrap}>
                <button type="button" data-testid="sb-confirm-go" onClick={() => setAsking(true)} style={S.primary}>Confirm</button>
                <button type="button" data-testid="sb-return-go" onClick={() => setReturning(true)} style={S.secondary}>Return with a note</button>
              </div>
            )}
          </div>
        ) : R.blockedOwn ? (
          <div style={S.card} data-testid="sb-cannot-confirm">
            <h3 style={S.h3}>You cannot confirm this one</h3>
            <p style={S.body} data-testid="sb-cannot-confirm-why">{refusalWords({ code: "cannot_confirm_your_own" })}</p>
            <p style={S.meta}>Two different people sign a scorebook import: one types it, another checks it against the pages.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Every innings of the import, read-only. */
function CardsRead({ R }) {
  const S = styles();
  const imp = R.d.import;
  const rosterMap = R.rosterMap;
  const typed = imp.typed ?? {};
  if (!imp.cards.length) return <div style={S.card}><p style={S.body}>There is no card on this import yet.</p></div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.space.lg }} data-testid="sb-cards-read">
      {imp.cards.map((c, n) => (
        <CardReader key={n} card={c} n={n} sideNames={R.sideNames} refusals={R.d.refusals?.[n] ?? []}
          nameOf={(ref) => nameOfRef(ref, typed, rosterMap) || (ref && !String(ref).startsWith("t:") ? "A player (name not shown to you)" : "")}/>
      ))}
    </div>
  );
}

// ── The import, as one screen ───────────────────────────────────────────

const REVISION_WORDS = { create: "Opened", pages: "Pages added", read: "Read", save: "Saved", submit: "Submitted", return: "Returned", confirm: "Confirmed", abandon: "Abandoned" };

/**
 * @param {{ importId: string, match: any, onClose: () => void }} props
 */
export function ScorebookImportView({ importId, match, onClose }) {
  const S = styles();
  const me = profile()?.user?.id ?? null;
  const sides = sidesOf(match);
  const sideNames = { home: sides.home.full, away: sides.away.full };
  const ours = match.awaySchoolId && match.awaySchoolId === match.schoolId ? "both" : "home";

  const [load, setLoad] = useState(/** @type {{status: string, error?: string}} */ ({ status: "loading" }));
  const [d, setD] = useState(/** @type {any} */ (null));
  const [draft, setDraft] = useState(/** @type {any} */ (null));
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(/** @type {"pages" | "card" | null} */ (null));
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(/** @type {{kind: "ok" | "error", text: string} | null} */ (null));
  const [attempted, setAttempted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [roster, setRoster] = useState(/** @type {any[]} */ ([]));
  const [blockedOwn, setBlockedOwn] = useState(false);
  // What the API says this person may do with the import: drawn exactly.
  const canWrite = d?.may?.write === true;
  const canConfirm = d?.may?.confirm === true;

  /** Adopt what the server holds as the working copy. */
  const adopt = useCallback((/** @type {any} */ p, /** @type {boolean} */ keepDraft) => {
    setD(p);
    setVersion(p.import.version);
    if (!keepDraft) {
      setDraft({ cards: structuredClone(p.import.cards ?? []), typed: { ...(p.import.typed ?? {}) }, checked: { ...(p.import.checked ?? {}) } });
      setDirty(false);
    }
  }, []);

  const fetchImport = useCallback(async () => api(`/api/scorebook/${importId}`), [importId]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const p = await fetchImport();
        if (dead) return;
        adopt(p, false);
        const editable = EDITABLE.includes(p.import.state);
        setStep(editable ? (p.pages.some((x) => !x.deletedAt) && p.import.cards.length ? "card" : "pages") : null);
        setLoad({ status: "ready" });
      } catch (/** @type {any} */ e) {
        if (!dead) setLoad({ status: "error", error: refusalWords(e) });
      }
    })();
    return () => { dead = true; };
  }, [fetchImport, adopt]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { rows } = await api("/api/read/players");
        if (!dead) setRoster((rows ?? []).filter((r) => r.school_id === match.schoolId).map((r) => ({ id: r.id, name: r.full_name, team: r.team_code })));
      } catch { /* the card's own boys are named by the import (names); the rest of the roster is not offered */ }
    })();
    return () => { dead = true; };
  }, [match.schoolId]);

  const photos = usePageBlobs(importId, d?.pages ?? []);
  // The names the API gives for the card's own boys (a confirmer outside the
  // school cannot read its roster), and the roster's where it can be read.
  const rosterMap = useMemo(() => new Map([...Object.entries(d?.names ?? {}), ...roster.map((p) => [p.id, p.name])]), [roster, d?.names]);
  const groups = useMemo(() => rosterGroups(roster, [match.homeTeam, match.awayTeamCode].filter(Boolean)), [roster, match.homeTeam, match.awayTeamCode]);

  /**
   * After pages were added or taken off: the list as the server has it. Each
   * page added or removed is one revision, so the version moves on by exactly
   * that. If it moved by more, somebody else saved: keep ours, so the next
   * save is refused and the latest is loaded rather than overwritten. The
   * typing in hand is never touched.
   * @param {number} changed
   */
  async function afterPages(changed) {
    try {
      const p = await fetchImport();
      setD(p);
      setVersion((v) => (p.import.version === v + changed ? p.import.version : v));
    } catch { /* the list stays as it was */ }
  }

  /** Someone else saved first: their version is loaded, the typing in hand is not kept. */
  async function reloadAfterConflict() {
    try {
      const p = await fetchImport();
      adopt(p, false);
      setMsg({ kind: "error", text: "This import was changed by someone else since you opened it. Their latest version is now showing; look it over and make your changes again." });
    } catch (/** @type {any} */ e) { setMsg({ kind: "error", text: refusalWords(e) }); }
  }

  /** @returns {Promise<number | null>} the new version, or null when it was refused */
  async function save() {
    const typed = pruneTyped(draft.typed, draft.cards);
    try {
      const r = await api(`/api/scorebook/${importId}/save`, { method: "POST", body: { cards: draft.cards, typed, checked: draft.checked, version } });
      setVersion(r.version); setDirty(false);
      setDraft((x) => ({ ...x, typed }));
      return r.version;
    } catch (/** @type {any} */ e) {
      if (e?.code === "version_conflict") await reloadAfterConflict();
      else setMsg({ kind: "error", text: refusalWords(e) });
      return null;
    }
  }

  async function doSave() {
    setBusy(true); setMsg(null);
    const v = await save();
    if (v != null) setMsg({ kind: "ok", text: "Saved. Nothing is sent for confirmation until you submit." });
    setBusy(false);
  }

  async function doSubmit() {
    setBusy(true); setMsg(null); setAttempted(true);
    try {
      const cards = draft.cards;
      if (!cards.length) { setMsg({ kind: "error", text: refusalWords({ code: "no_card" }) }); return; }
      const left = uncheckedCells(cards, draft.checked);
      if (left.length) { setMsg({ kind: "error", text: refusalWords({ code: "cells_unchecked", detail: left }) }); return; }
      if (refusalsOf(cards, draft.typed, ours).some((r) => r.length)) { setMsg({ kind: "error", text: refusalWords({ code: "card_refused" }) }); return; }
      const v = await save();
      if (v == null) return;
      try {
        await api(`/api/scorebook/${importId}/submit`, { method: "POST", body: { version: v } });
      } catch (/** @type {any} */ e) {
        if (e?.code === "version_conflict") { await reloadAfterConflict(); return; }
        setMsg({ kind: "error", text: refusalWords(e) });
        return;
      }
      const p = await fetchImport();
      adopt(p, false);
      setStep(null);
      setMsg({ kind: "ok", text: "Submitted. It now waits for someone else to check it against the pages and confirm it." });
    } finally { setBusy(false); }
  }

  async function doConfirm(/** @type {{acknowledgeUnreconciled: boolean, note?: string}} */ body) {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/scorebook/${importId}/confirm`, { method: "POST", body });
      adopt(await fetchImport(), false);
      setMsg({ kind: "ok", text: "Confirmed. The innings are now in the match's record and the match is complete; its scorecard says they are from the scorebook." });
    } catch (/** @type {any} */ e) {
      if (e?.code === "cannot_confirm_your_own") setBlockedOwn(true);
      setMsg({ kind: "error", text: refusalWords(e, { confirming: true }) });
    } finally { setBusy(false); }
  }

  async function doReturn(/** @type {string} */ note) {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/scorebook/${importId}/return`, { method: "POST", body: { note: note.trim() } });
      adopt(await fetchImport(), false);
      setMsg({ kind: "ok", text: "Returned to the scorer with your note. They can change the card and submit it again." });
    } catch (/** @type {any} */ e) {
      if (e?.code === "cannot_confirm_your_own") setBlockedOwn(true);
      setMsg({ kind: "error", text: refusalWords(e, { confirming: true }) });
    } finally { setBusy(false); }
  }

  async function doAbandon() {
    setBusy(true); setMsg(null);
    try {
      await api(`/api/scorebook/${importId}/abandon`, { method: "POST", body: {} });
      adopt(await fetchImport(), false);
      setStep(null); setAsking(false);
      setMsg({ kind: "ok", text: "Abandoned. The page photos have been deleted; the match is unchanged." });
    } catch (/** @type {any} */ e) { setMsg({ kind: "error", text: refusalWords(e) }); }
    finally { setBusy(false); }
  }

  const back = (
    <button type="button" onClick={onClose} data-testid="sb-back" className="pressBtn os-state"
      style={{ ...S.secondary, display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
      <Icon name="chevron-left"/> Back to the match
    </button>
  );

  if (load.status !== "ready" || !d || !draft) {
    return (
      <div className="os-page" data-testid="sb-root">
        <div style={{ marginBottom: T.space.md }}>{back}</div>
        <div style={S.card}>
          <p role="status" data-testid="sb-loading" style={S.body}>{load.status === "error" ? load.error : "Loading the import…"}</p>
        </div>
      </div>
    );
  }

  const imp = d.import;
  const state = imp.state;
  const editable = EDITABLE.includes(state) && canWrite;
  const worked = workedOn(me, imp, d.revisions);
  const mayAct = state === "submitted" && canConfirm && !worked && !blockedOwn;
  const cantConfirm = state === "submitted" && canConfirm && (worked || blockedOwn);
  const canAbandon = !FINISHED.includes(state) && (editable || (state === "submitted" && (canConfirm || canWrite)));

  // ── Editing the working copy ──
  const edit = (/** @type {(x: any) => any} */ fn) => { setDraft(fn); setDirty(true); };
  const R = {
    id: importId, d, draft, version, ours, sideNames, groups, rosterMap, photos, cur, setCur, attempted, busy, step, setStep,
    mayAct, blockedOwn: cantConfirm, worked, confirm: doConfirm, giveBack: doReturn,
    afterUpload: (/** @type {number} */ added) => afterPages(added),
    removePage: async (/** @type {number} */ n) => {
      setBusy(true); setMsg(null);
      try {
        await removePage(importId, n);
        await afterPages(1);
        setMsg({ kind: "ok", text: `Page ${n} was taken off the import and its photo deleted.` });
        return true;
      } catch (/** @type {any} */ e) {
        setMsg({ kind: "error", text: refusalWords(e) });
        return false;
      } finally { setBusy(false); }
    },
    setCell: (/** @type {number} */ n, /** @type {string} */ path, /** @type {unknown} */ value, tick = true) => edit((x) => ({
      ...x, cards: x.cards.map((c, i) => (i === n ? setPath(c, path, value) : c)),
      checked: tick ? { ...x.checked, [`${n}.${path}`]: true } : x.checked })),
    setName: (/** @type {number} */ n, /** @type {string} */ path, /** @type {string} */ text, /** @type {string | null} */ current) => edit((x) => {
      const r = settleTyped(x.typed, x.cards, { name: text, current, path, card: n });
      return { ...x, typed: r.typed, cards: x.cards.map((c, i) => (i === n ? setPath(c, path, r.ref) : c)), checked: { ...x.checked, [`${n}.${path}`]: true } };
    }),
    setTick: (/** @type {number} */ n, /** @type {string} */ path, /** @type {boolean} */ on) => edit((x) => {
      const checked = { ...x.checked };
      if (on) checked[`${n}.${path}`] = true; else delete checked[`${n}.${path}`];
      return { ...x, checked };
    }),
    tickRow: (/** @type {number} */ n, /** @type {any} */ list, /** @type {number} */ i, /** @type {boolean} */ on) => edit((x) => {
      const checked = { ...x.checked };
      for (const p of rowPaths(x.cards, n, list, i)) { if (on) checked[p] = true; else delete checked[p]; }
      return { ...x, checked };
    }),
    addRow: (/** @type {number} */ n, /** @type {string} */ list, /** @type {unknown} */ blank) => edit((x) => ({
      ...x, cards: x.cards.map((c, i) => (i === n ? { ...c, [list]: [...c[list], blank] } : c)) })),
    removeRow: (/** @type {number} */ n, /** @type {string} */ list, /** @type {number} */ at) => edit((x) => ({
      ...x,
      cards: x.cards.map((c, i) => {
        if (i !== n) return c;
        const rows = c[list].filter((_, j) => j !== at);
        return { ...c, [list]: list === "batting" ? rows.map((b, j) => ({ ...b, order: j + 1 })) : rows };
      }),
      checked: shiftChecked(x.checked, n, list, at) })),
    addInnings: (/** @type {number} */ innings, /** @type {"home" | "away"} */ side) => {
      edit((x) => ({ ...x, cards: [...x.cards, blankCard(innings, side)] }));
      setCur(draft.cards.length);
    },
    removeInnings: (/** @type {number} */ n) => {
      edit((x) => ({ ...x, cards: x.cards.filter((_, i) => i !== n), checked: dropCardChecked(x.checked, n) }));
      setCur(0);
    },
  };

  return (
    <div className="os-page" data-testid="sb-root" data-state={state}>
      <div style={{ ...S.wrap, justifyContent: "space-between", marginBottom: T.space.md }}>
        {back}
        <Badge color={state === "confirmed" ? T.semantic.positive : state === "abandoned" ? T.semantic.critical : T.semantic.warning} data-testid="sb-state">{STATE_SHORT[state]}</Badge>
      </div>
      <header style={{ display: "grid", gap: T.space.xs, marginBottom: T.space.lg }}>
        <h1 style={{ ...S.h3, fontSize: "22px" }} data-testid="sb-title">Scorebook import</h1>
        <p style={S.body}>{titleOf(sides)}</p>
        <p style={S.meta} data-testid="sb-state-words">{STATE_WORDS[state]}</p>
      </header>

      <div role={msg?.kind === "error" ? "alert" : "status"} data-testid="sb-status" style={{ marginBottom: msg ? T.space.lg : 0 }}>
        {msg && <p style={{ ...S.body, padding: T.space.md, borderRadius: T.radius.md, border: `1px solid ${msg.kind === "error" ? T.semantic.critical : T.line.strong}`,
                            background: T.surface.raised, color: msg.kind === "error" ? T.semantic.criticalText : T.content.primary }}>{msg.text}</p>}
      </div>

      {editable && (
        <>
          <div style={{ ...S.wrap, marginBottom: T.space.lg }} role="group" aria-label="Steps">
            {[["pages", "1. The pages"], ["card", "2. The card"]].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={step === k} data-testid={`sb-step-${k}`} onClick={() => setStep(/** @type {any} */ (k))}
                style={{ ...S.secondary, ...(step === k ? { background: T.content.primary, color: T.surface.canvas, borderColor: T.content.primary } : {}) }}>{label}</button>
            ))}
          </div>
          {step === "pages" ? <UploadScreen R={R}/> : <ReviewScreen R={R}/>}
          <div style={{ ...S.card, marginTop: T.space.lg }} data-testid="sb-actions">
            <div style={S.wrap}>
              <button type="button" data-testid="sb-save" disabled={busy} onClick={doSave} style={S.secondary}>Save</button>
              <button type="button" data-testid="sb-submit" disabled={busy} onClick={doSubmit} style={S.primary}>Submit for confirmation</button>
              <span role="status" data-testid="sb-dirty" style={S.meta}>{dirty ? "You have changes that are not saved." : "All changes are saved."}</span>
            </div>
          </div>
        </>
      )}

      {!editable && (
        <>
          {state === "returned" && imp.returnedNote && (
            <div style={{ ...S.card, marginBottom: T.space.lg }} data-testid="sb-returned-note">
              <h3 style={S.h4}>Returned with a note</h3><p style={S.body}>{imp.returnedNote}</p>
            </div>
          )}
          {state === "submitted" && !canConfirm && (
            <div style={{ ...S.card, marginBottom: T.space.lg }} data-testid="sb-waiting">
              <h3 style={S.h4}>Waiting to be confirmed</h3>
              <p style={S.body}>A school's director of sport confirms a friendly; for a league fixture, the league's administrator does. Whoever typed a card cannot confirm it.</p>
            </div>
          )}
          {state === "confirmed" && (
            <div style={{ ...S.card, marginBottom: T.space.lg }} data-testid="sb-confirmed">
              <h3 style={S.h4}>Confirmed{imp.confirmedAt ? ` ${formatWhen(imp.confirmedAt)}` : ""}</h3>
              <p style={S.body}>These innings are in the match's record, marked as from the scorebook.{imp.confirmNote ? ` Note: ${imp.confirmNote}` : ""}</p>
              {imp.unreconciledAcknowledged && <p style={S.body}>The confirmer acknowledged that the book's figures do not add up to its total.</p>}
            </div>
          )}
          {state === "abandoned" && (
            <div style={{ ...S.card, marginBottom: T.space.lg }} data-testid="sb-abandoned"><p style={S.body}>This import was abandoned and its photos deleted. The match is unchanged.</p></div>
          )}
          <ConfirmScreen R={R}/>
        </>
      )}

      {canAbandon && (
        <div style={{ ...S.card, marginTop: T.space.lg }} data-testid="sb-abandon">
          {asking ? (
            <>
              <p style={{ ...S.body, color: T.content.primary }}>Abandoning closes this import and deletes its page photos. The match is not changed. Abandon it?</p>
              <div style={S.wrap}>
                <button type="button" data-testid="sb-abandon-yes" disabled={busy} onClick={doAbandon} style={S.danger}>Yes, abandon it</button>
                <button type="button" data-testid="sb-abandon-no" onClick={() => setAsking(false)} style={S.secondary}>Keep it</button>
              </div>
            </>
          ) : <button type="button" data-testid="sb-abandon-go" onClick={() => setAsking(true)} style={{ ...S.secondary, alignSelf: "flex-start" }}>Abandon this import</button>}
        </div>
      )}

      {(d.revisions ?? []).length > 0 && (
        <details style={{ ...S.card, marginTop: T.space.lg }} data-testid="sb-history">
          <summary style={{ ...S.h4, cursor: "pointer", minHeight: "44px", display: "flex", alignItems: "center" }}>History of this import</summary>
          <ol style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: T.space.xs }}>
            {d.revisions.map((r) => <li key={r.version} style={S.body}>{REVISION_WORDS[r.action] ?? r.action}, {formatWhen(r.at)}{r.note ? `: ${r.note}` : ""}</li>)}
          </ol>
        </details>
      )}
    </div>
  );
}

// ── The way in, from a fixture ──────────────────────────────────────────

/**
 * A fixture's scorebook, in its side panel in the Match Centre.
 *
 * Drawn from the API's answer alone: the fixture's imports, what this person
 * may do with them (`may`: write, confirm, read, by the checks the database
 * asks) and whether the module is on for the school. A 403 (may do nothing),
 * a module that is off, or a person who may only audit the card draws nothing.
 * @param {{ match: any, onOpen: (importId: string) => void }} props
 */
export function ScorebookPanel({ match, onOpen }) {
  const S = styles();
  const eligible = signedIn() && match.live === true;
  const [st, setSt] = useState(/** @type {{status: string, imports?: any[], may?: any, error?: string}} */ ({ status: "loading" }));
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!eligible) return undefined;
    let dead = false;
    (async () => {
      try {
        const r = await api(`/api/matches/${match.id}/scorebook`);
        if (dead) return;
        const may = r.may ?? {};
        setSt(r.module === true && (may.write || may.confirm || may.read)
          ? { status: "ready", imports: r.imports ?? [], may } : { status: "off" });
      } catch (/** @type {any} */ e) {
        if (dead) return;
        // Off, or not this person's: drawn as nothing. Anything else is said.
        setSt(e?.status === 403 ? { status: "off" } : { status: "error", error: refusalWords(e) });
      }
    })();
    return () => { dead = true; };
  }, [eligible, match.id, nonce]);
  if (!eligible || st.status === "loading" || st.status === "off") return null;
  if (st.status === "error") {
    return <div style={{ ...S.card, marginTop: T.space.md }} data-testid="scorebook-panel"><p role="alert" style={S.alert}>{st.error}</p></div>;
  }
  const canWrite = st.may?.write === true;
  const canConfirm = st.may?.confirm === true;
  const imports = (st.imports ?? []).filter((i) => i.state !== "abandoned");
  const openOne = imports.find((i) => !FINISHED.includes(i.state)) ?? null;
  const offer = canWrite && !openOne && match.status !== "complete" && startedYet(match);
  if (!imports.length && !offer) return null;

  async function start() {
    setBusy(true); setErr("");
    try {
      const r = await api(`/api/matches/${match.id}/scorebook`, { method: "POST", body: {} });
      onOpen(r.id);
    } catch (/** @type {any} */ e) {
      if (e?.code === "import_open" && typeof e.detail === "string") { onOpen(e.detail); return; }
      setErr(refusalWords(e)); setNonce((n) => n + 1);
    } finally { setBusy(false); }
  }
  const verb = (/** @type {any} */ i) => (EDITABLE.includes(i.state) && canWrite ? "Continue the import"
    : i.state === "submitted" && canConfirm ? "Review and confirm" : "View the import");
  return (
    <div style={{ ...S.card, marginTop: T.space.md }} data-testid="scorebook-panel">
      <h3 style={{ ...S.h4, display: "flex", alignItems: "center", gap: T.space.xs }}><Icon name="scorebook"/> Scorebook</h3>
      {imports.map((i) => (
        <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: T.space.xs }} data-testid={`sb-import-${i.id}`} data-state={i.state}>
          <p style={S.body} data-testid="sb-import-state">{STATE_WORDS[i.state]} ({i.pages} {i.pages === 1 ? "page" : "pages"})</p>
          <button type="button" data-testid={`sb-open-${i.id}`} onClick={() => onOpen(i.id)} style={{ ...S.secondary, alignSelf: "flex-start" }}>{verb(i)}</button>
        </div>
      ))}
      {offer && (
        <div>
          <p style={S.meta}>Type the innings from the paper scorebook, beside photos of its pages. A second person then checks it.</p>
          <button type="button" data-testid="sb-start" disabled={busy} onClick={start} style={{ ...S.primary, marginTop: T.space.sm }}>Import from a scorebook</button>
        </div>
      )}
      {err && <p role="alert" data-testid="sb-start-error" style={S.alert}>{err}</p>}
    </div>
  );
}

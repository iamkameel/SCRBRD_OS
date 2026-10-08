/**
 * A school's listing on the SCRBRD home page (SCRBRD-142 phase 2), over
 * listing-api.mjs. Two pieces:
 *
 *   ListingPanel      Settings → School: one switch, "List our matches on the
 *                     SCRBRD home page", and what it does.
 *   useSchoolListing  the read both pieces share; publication.jsx's line under
 *                     the Publish switch is drawn from it.
 *
 * WHAT THESE DECIDE: nothing. GET answers 404 to a reader who may not read the
 * setting (broadcast.publish at the school, any side of it), and then nothing
 * is drawn; `mayChange` says whether he may switch it, and for a reader who may
 * not the switch is there and disabled, with the sentence why. public_listing_set()
 * (db/82) refuses anybody else, and the refusal is shown in words.
 */
import { useEffect, useState } from "react";
import { D, T, inkOn } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { LISTING_READ_ONLY_WHY, LISTING_WORDS, listingRefusal } from "../lib/listing.js";
import { StateLabel } from "../ui/stateLabel.jsx";
import { dHead, dNote } from "./publicname.jsx";

/**
 * The listing as this reader may read it, re-read after each change.
 * `data` is null for a reader the route answered 404 (and while it is being
 * read); `error` is a read that did not answer at all.
 * @param {string | null | undefined} schoolId
 */
export function useSchoolListing(schoolId) {
  const [nonce, setNonce] = useState(0);
  const [st, setSt] = useState({ loading: true, data: null, error: false });
  useEffect(() => {
    if (!signedIn() || !schoolId) return undefined;
    let gone = false;
    api(`/api/schools/${schoolId}/listing`)
      .then((data) => { if (!gone) setSt({ loading: false, data, error: false }); })
      .catch((e) => { if (!gone) setSt({ loading: false, data: null, error: e?.status !== 404 }); });
    return () => { gone = true; };
  }, [schoolId, nonce]);
  return { ...st, reload: () => setNonce((n) => n + 1) };
}

/** Settings → School, for one school: drawn for any reader of the setting, changeable by whoever `mayChange`. */
export function ListingPanel({ schoolId }) {
  const { data, error, reload } = useSchoolListing(schoolId);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  if (error) return <p style={dNote(true)}>This school&apos;s listing could not be read just now. Nothing has changed.</p>;
  if (!data) return null;
  const on = data.listed === true;
  const flip = async () => {
    setBusy(true); setSaid("");
    try {
      await api(`/api/schools/${schoolId}/listing`, { method: "POST", body: { listed: !on } });
      reload();
    } catch (e) { setSaid(listingRefusal(e)); }
    finally { setBusy(false); }
  };
  const off = busy || !data.mayChange;
  return (
    <section data-testid={`listing-${schoolId}`} aria-label="Home page listing" style={{ marginTop: "12px", borderTop: `1px solid ${D.border}`, paddingTop: "12px" }}>
      <p style={dHead()}>SCRBRD home page</p>
      <p style={dNote(false)} data-testid="listing-words">{LISTING_WORDS.join(" ")}</p>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
        <button type="button" role="switch" aria-checked={on} disabled={off} onClick={flip} className="pressBtn"
          aria-describedby={data.mayChange ? undefined : `listing-why-${schoolId}`}
          data-testid="listing-switch"
          style={{ minHeight: "44px", padding: "0 14px", borderRadius: D.pill, cursor: off ? "not-allowed" : "pointer",
            fontFamily: D.body, fontSize: "13px", fontWeight: 600, opacity: data.mayChange ? 1 : 0.6,
            border: `1px solid ${on ? T.content.primary : T.line.strong}`, background: on ? T.content.primary : "transparent",
            color: on ? inkOn(T.content.primary) : T.content.primary }}>
          List our matches on the SCRBRD home page: {on ? "listed" : "not listed"}
        </button>
      </div>
      {!data.mayChange && <StateLabel kind="readonly" id={`listing-why-${schoolId}`} testid="listing-why" why={LISTING_READ_ONLY_WHY}/>}
      {said && <p role="alert" data-testid="listing-refused" style={dNote(true)}>{said}</p>}
    </section>
  );
}

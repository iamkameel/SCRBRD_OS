/**
 * SCRBRD — the phone screen for a driver or a groundskeeper. SCRBRD-085.
 *
 * Both roles used to land on the coordinator's desktop dashboard — a screen
 * built for someone planning a season, not someone standing at a bus door or
 * a pitch on a Saturday morning. These two views are deliberately narrow: one
 * column, large buttons, today first.
 *
 * GATED BY CAPABILITY, NEVER BY ROLE NAME. App.jsx decides whether to draw
 * DriverDayView or GroundskeeperDayView in place of the ordinary dashboard by
 * asking holdsCapability() — transport.drive for a driver, facility.manage
 * without team.manage for a groundskeeper (the thing that tells a facilities
 * account apart from a schooladmin or director of sport, who also hold
 * facility.manage but run the whole desktop). Neither view re-decides
 * anything: every read here is the same row-scoped, column-masked query the
 * desktop screens use, and every write is the same policy-governed route.
 *
 * THE DRIVER GAP, LEFT OPEN RATHER THAN WIDENED — AND BIGGER THAN IT LOOKS.
 * A driver's role holds transport.read and transport.drive but NOT
 * fixture.read (packages/policy/src/roles.mjs). The obvious consequence is
 * that `match` rows — opponent, venue, format — are invisible to this
 * account, exactly as on the desktop Logistics screen today. The
 * non-obvious one, found by this ticket's own browser walk rather than
 * guessed at: `trip`'s own read policy (packages/policy/src/tables.mjs,
 * generated into db/09_rls_policies.sql) anchors its school/team on a plain
 * subquery against `match` —
 *
 *     school: "(SELECT m.school_id FROM match m WHERE m.id = trip.match_id)"
 *
 * — run under the CALLER's own row-level security, not through the
 * SECURITY DEFINER match_school()/match_team() helpers db/02 built for
 * exactly this. Every other table anchored on a fixture (weather, the pitch
 * report, match_official, match_availability…) is generated the same way,
 * and it has never mattered before, because every OTHER role that holds
 * transport.read (transportcoordinator, schooladmin, sportsadmin,
 * directorofsport) also independently holds fixture.read, so the subquery
 * always resolved for them. `driver` is the first role ever granted a
 * capability on a fixture-anchored table without also holding fixture.read,
 * and the subquery comes back NULL — which the resource side of app_can()
 * treats as "does not state its school", failing closed. The result: a
 * driver's account reads ZERO rows from `/api/read/trips`, always,
 * regardless of whether a trip is arranged for them. Confirmed against a
 * live database, not inferred from the policy text (tools/smoke-browser-
 * dayof.mjs, group 1).
 *
 * This view does not work around either half of that by reading a wider
 * resource, joining around the policy, or fabricating a destination from the
 * pickup text. It reads exactly what `/api/read/trips` returns under the
 * driver's own RLS — which is nothing yet — and says so, plainly, rather
 * than a bare "no trips" that would read as a fact about the school's
 * schedule instead of a fact about this account's access. The write side
 * still works: trip_mark() is its own SECURITY DEFINER function keyed on the
 * trip id and the caller's driver_id, so a driver who is handed a trip id
 * some other way (or once the read is fixed) can still mark it departed and
 * arrived — the buttons below are wired and were proven against the API
 * directly (same smoke walk), only the list above them is empty for now.
 *
 * SCRBRD-085's write-up asks Opus to decide the fix: give `trip`'s anchor
 * (and its fixture-anchored siblings) the SECURITY DEFINER helper instead of
 * a raw subquery — the schema-wide fix, since nothing about this is specific
 * to transport — or give driver a narrow, trip-scoped fixture.read. Either
 * is an RLS/capability change and neither belongs in this commit.
 */
import { useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { dateStr, today } from "../lib/format.js";
import { api } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { useLive } from "../lib/live.js";
import { Badge, Btn, Card, EmptyState, Select } from "../ui/primitives.jsx";

// HH:MM from a raw timestamp string, or an em dash. Sliced rather than run
// through a Date object and a timezone conversion — the same convention
// asMatch's own `time` field uses, so a fixture's kickoff and a trip's
// departure read as the same clock.
const hm = (ts) => (ts ? String(ts).slice(11, 16) : "—");
const dayOf = (ts) => (ts ? String(ts).slice(0, 10) : null);

/**
 * A trip card: what the driver's own account can read about it, and the one
 * or two buttons trip_mark() actually accepts from this driver.
 */
function TripCard({ trip, onMarked }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const mark = async (event) => {
    setBusy(true); setSaid("");
    try {
      await api(`/api/trips/${trip.id}/mark`, { method: "POST", body: { event } });
      onMarked();
    } catch (e) {
      setSaid(e.code || e.message || "Could not save that.");
    }
    setBusy(false);
  };
  const stateColor = trip.state === "arrived" ? D.emerald : trip.state === "under_way" ? D.sky : D.textMuted;
  const stateLabel = trip.state === "arrived" ? "Arrived" : trip.state === "under_way" ? "On the road" : "Not yet departed";
  return (
    <Card data-testid="driver-trip" data-trip-id={trip.id} sx={{ padding: "16px", marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "10px" }}>
        <div>
          <div style={{ fontFamily: D.mono, fontSize: "22px", fontWeight: 700, color: D.textPrimary }}>{hm(trip.departAt)}</div>
          <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>Departure</div>
        </div>
        <Badge color={stateColor}>{stateLabel}</Badge>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
        <div style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary }}>
          📍 <strong>Pickup:</strong> {trip.pickup || "Not recorded — check with your coordinator"}
        </div>
        {(trip.reg || trip.vehicleDescription) && (
          <div style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary }}>
            🚐 <strong>{trip.reg || "Vehicle"}</strong>{trip.vehicleDescription ? ` — ${trip.vehicleDescription}` : ""}
            {trip.capacity ? ` · ${trip.capacity} seats` : ""}
          </div>
        )}
        {trip.seatsTaken != null && (
          <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>{trip.seatsTaken} passengers booked on</div>
        )}
        {trip.returnAt && (
          <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>Return by {hm(trip.returnAt)}</div>
        )}
        {trip.notes && (
          <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted, fontStyle: "italic" }}>{trip.notes}</div>
        )}
      </div>

      {said && <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: textOn(D.rose), marginBottom: "10px" }}>{said}</div>}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {trip.state === "scheduled" && (
          <Btn size="lg" data-testid="driver-trip-departed" disabled={busy} onClick={() => mark("departed")}>
            {busy ? "Saving…" : "We've left"}
          </Btn>
        )}
        {trip.state === "under_way" && (
          <Btn size="lg" variant="success" data-testid="driver-trip-arrived" disabled={busy} onClick={() => mark("arrived")}>
            {busy ? "Saving…" : "We've arrived"}
          </Btn>
        )}
      </div>
    </Card>
  );
}

function DriverDayView({ role }) {
  const [nonce, setNonce] = useState(0);
  const { rows: rawTrips, live, loading, error } = useLive("trips", role, nonce);
  const myId = profile()?.user?.id;
  const mine = rawTrips.filter((t) => t.driverId === myId && t.state !== "cancelled" && t.departAt);
  const todayStr = dateStr(today);
  const todays = mine.filter((t) => dayOf(t.departAt) === todayStr)
    .sort((a, b) => (a.departAt < b.departAt ? -1 : 1));
  const upcoming = mine.filter((t) => dayOf(t.departAt) > todayStr)
    .sort((a, b) => (a.departAt < b.departAt ? -1 : 1)).slice(0, 5);

  return (
    <div className="os-page" data-testid="dayof-driver" style={{ maxWidth: "480px" }}>
      <div style={{ marginBottom: "18px" }}>
        <h1 style={{ fontFamily: D.head, fontSize: "20px", fontWeight: 800, color: D.textPrimary, marginBottom: "3px" }}>
          🚌 Your trips
        </h1>
        <p style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>
          {new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* What this account cannot show yet, said once and plainly rather than
          left as a silent empty list. See the file comment: this is not one
          missing field but the whole trip read, and it is not worked around
          here by reading a wider resource or guessing at what is missing. */}
      <Card sx={{ padding: "12px 14px", marginBottom: "16px", background: D.amber + "0e", border: `1px solid ${D.amber}33` }}>
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.5 }}>
          This account can't yet confirm whether a trip has been arranged for you, or show
          its fixture, opponent or venue. Ask your transport coordinator for today's
          departure time, pickup point and vehicle directly, and check in with them once
          you're on the road — once this is fixed, marking a trip departed and arrived from
          here will still work exactly as below.
        </div>
      </Card>

      {loading && <EmptyState loading/>}
      {!loading && error && <EmptyState error/>}
      {!loading && !error && live && mine.length === 0 && (
        <EmptyState icon="🚌" message="No trips are visible here yet."/>
      )}

      {todays.length > 0 && (
        <>
          <div style={{ fontFamily: D.head, fontSize: "11px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
            Today
          </div>
          {todays.map((t) => <TripCard key={t.id} trip={t} onMarked={() => setNonce((n) => n + 1)}/>)}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div style={{ fontFamily: D.head, fontSize: "11px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", margin: "18px 0 8px" }}>
            Coming up
          </div>
          {upcoming.map((t) => (
            <Card key={t.id} data-testid="driver-trip-upcoming" sx={{ padding: "12px 14px", marginBottom: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600, color: D.textPrimary }}>
                    {new Date(t.departAt).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} · {hm(t.departAt)}
                  </div>
                  <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>{t.pickup || "Pickup not recorded"}</div>
                </div>
                {t.reg && <Badge color={D.teal}>{t.reg}</Badge>}
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * The quick pitch report — a subset of FieldsView's fuller form, chosen for a
 * phone: the five things a groundsman most needs to say on a Saturday
 * morning, not the whole vocabulary. The write route (services/api/write/
 * events-api.mjs conditionsRoutes().pitch) accepts every field this form
 * leaves out as simply absent, so nothing here narrows what a fuller desktop
 * report could still add later.
 */
const QUICK_FIELDS = {
  surface: { label: "Surface", values: ["hard", "firm", "soft", "damp"] },
  pace: { label: "Pace", values: ["slow", "medium", "quick"] },
  favours: { label: "Favours", values: ["seam", "spin", "batting", "even"] },
};
function QuickPitchForm({ matchId, role, onSaved }) {
  const { rows: existing } = useLive("pitch_report", role, 0, { matchId });
  const filed = existing[0] ?? null;
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v || undefined }));

  const submit = async () => {
    setBusy(true); setResult(null);
    try {
      await api(`/api/matches/${matchId}/pitch`, {
        method: "POST",
        body: { ...form, coversOn: form.coversOn === "true" ? true : form.coversOn === "false" ? false : undefined },
      });
      setResult("ok");
      onSaved?.();
    } catch (e) {
      setResult(e.code || e.message || "error");
    }
    setBusy(false);
  };

  if (result === "ok") {
    return (
      <div data-testid="gk-pitch-saved" style={{ fontFamily: D.body, fontSize: "13px", color: D.emerald, padding: "4px 0" }}>
        Report filed. Thanks.
      </div>
    );
  }

  return (
    <div data-testid="gk-pitch-form" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {filed && (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginBottom: "8px" }}>
          Already filed today at {hm(filed.reportedAt)} — saving again replaces it.
        </div>
      )}
      {Object.entries(QUICK_FIELDS).map(([k, { label, values }]) => (
        <Select key={k} label={label} value={form[k] ?? ""} onChange={set(k)} data-testid={`gk-pitch-${k}`}
          options={[{ value: "", label: "— not recorded" }, ...values]}/>
      ))}
      <Select label="Covers on" value={form.coversOn ?? ""} onChange={set("coversOn")} data-testid="gk-pitch-coversOn"
        options={[{ value: "", label: "— not recorded" }, { value: "true", label: "On" }, { value: "false", label: "Off" }]}/>
      <label style={{ display: "block", fontFamily: D.head, fontSize: "10px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "5px" }}>
        Notes
      </label>
      <textarea data-testid="gk-pitch-notes" value={form.notes ?? ""} onChange={(e) => set("notes")(e.target.value)} rows={3}
        style={{ width: "100%", padding: "10px 12px", background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.md,
          color: D.textPrimary, fontFamily: D.body, fontSize: "14px", boxSizing: "border-box", resize: "vertical", marginBottom: "12px" }}/>
      {result && result !== "ok" && (
        <div data-testid="gk-pitch-error" style={{ fontFamily: D.body, fontSize: "12px", color: textOn(D.rose), marginBottom: "10px" }}>
          {result === "empty_report" ? "Record at least one thing before saving." : `Could not save (${result}).`}
        </div>
      )}
      <Btn size="lg" variant="primary" disabled={busy} onClick={submit} data-testid="gk-pitch-submit">
        {busy ? "Saving…" : "File pitch report"}
      </Btn>
    </div>
  );
}

function GroundskeeperDayView({ role }) {
  const { rows: MATCHES, live, loading, error } = useLive("matches", role);
  const [openId, setOpenId] = useState(null);
  const todayStr = dateStr(today);
  const todays = MATCHES.filter((m) => m.date === todayStr)
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  return (
    <div className="os-page" data-testid="dayof-groundskeeper" style={{ maxWidth: "480px" }}>
      <div style={{ marginBottom: "18px" }}>
        <h1 style={{ fontFamily: D.head, fontSize: "20px", fontWeight: 800, color: D.textPrimary, marginBottom: "3px" }}>
          🌿 Today's grounds
        </h1>
        <p style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>
          {new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {loading && <EmptyState loading/>}
      {!loading && error && <EmptyState error/>}
      {!loading && !error && live && todays.length === 0 && (
        <EmptyState icon="🌿" message="No fixtures at your grounds today."/>
      )}

      {todays.map((m) => (
        <Card key={m.id} data-testid="gk-fixture" data-match-id={m.id} sx={{ padding: "16px", marginBottom: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "10px" }}>
            <div>
              <div style={{ fontFamily: D.mono, fontSize: "20px", fontWeight: 700, color: D.textPrimary }}>{m.time ?? "—"}</div>
              <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textPrimary, marginTop: "2px" }}>
                {m.homeTeam} vs {m.awayTeam}
              </div>
            </div>
            {m.format && <Badge color={D.indigo}>{m.format}</Badge>}
          </div>
          <div style={{ fontFamily: D.body, fontSize: "14px", color: D.textSecondary, marginBottom: "12px" }}>
            📍 {m.venue || "Ground not recorded"}
          </div>

          {openId === m.id ? (
            <QuickPitchForm matchId={m.id} role={role} onSaved={() => {}}/>
          ) : (
            <Btn size="lg" variant="tonal" data-testid="gk-open-pitch-form" onClick={() => setOpenId(m.id)}>
              File pitch report
            </Btn>
          )}
        </Card>
      ))}
    </div>
  );
}

export { DriverDayView, GroundskeeperDayView };

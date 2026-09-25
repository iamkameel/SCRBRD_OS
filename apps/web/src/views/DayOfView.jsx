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
 * WHAT A DRIVER READS, and why it is exactly this (db/41). A driver's role
 * holds transport.read and transport.drive but NOT fixture.read
 * (packages/policy/src/roles.mjs), and his assignment is school-wide. Until
 * db/41 that meant `/api/read/trips` came back empty for him — trip's read
 * policy resolves its school/team through a subquery on `match`, which he
 * could not read — while trip_contacts() and trip_mark() went the other way
 * and let any transport.drive holder reach every trip at the school.
 * docs/rls-anchor-audit.md §5.1 has the whole story. db/41 made both follow
 * the trip's named driver: he reads the trips that name him, the fixture of
 * each live one (opponent, start, format — `match` rows, nothing that hangs
 * off them), the manifest of his own bus on the day, and he marks his own
 * trips. Not another driver's bus at the school, and not the second bus to
 * his own fixture.
 *
 * So this view does no filtering that matters for access: the reads are
 * already his. It still keeps to trips naming him (a person who is also,
 * say, the transport coordinator reads every trip, and this screen is about
 * the ones he is driving). The venue is the one gap left, and it is said
 * rather than guessed: the ground's name is behind facility.read, which a
 * driver does not hold, so the card says "check with your coordinator".
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
function TripCard({ trip, fixture, onMarked }) {
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
        {fixture && (
          <div data-testid="driver-trip-fixture" style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary }}>
            🏏 <strong>{fixture.homeTeam} vs {fixture.awayTeam}</strong>
            {fixture.time ? ` · starts ${fixture.time}` : ""}{fixture.format ? ` · ${fixture.format}` : ""}
            <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>
              {fixture.venue || "Venue: check with your coordinator"}
            </div>
          </div>
        )}
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
  // The fixtures of his live trips — the only `match` rows a driver reads.
  const { rows: fixtures } = useLive("matches", role);
  const fixtureOf = (t) => fixtures.find((m) => m.id === t.matchId) ?? null;
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

      {loading && <EmptyState loading/>}
      {!loading && error && <EmptyState error/>}
      {!loading && !error && live && mine.length === 0 && (
        <EmptyState icon="🚌" message="No trips are arranged for you."/>
      )}

      {todays.length > 0 && (
        <>
          <div style={{ fontFamily: D.head, fontSize: "11px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "8px" }}>
            Today
          </div>
          {todays.map((t) => <TripCard key={t.id} trip={t} fixture={fixtureOf(t)} onMarked={() => setNonce((n) => n + 1)}/>)}
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
                  <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
                    {fixtureOf(t) ? `${fixtureOf(t).homeTeam} vs ${fixtureOf(t).awayTeam} · ` : ""}{t.pickup || "Pickup not recorded"}
                  </div>
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

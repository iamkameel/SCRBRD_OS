/**
 * Booking a vehicle and a trip, on Logistics → transport.
 *
 *   Add a vehicle      POST /api/vehicles           (the school's fleet)
 *   Book a trip        POST /api/matches/:id/trip   (a bus to a fixture)
 *
 * Both are `transport.manage`, written by transportRoutes() under the caller's
 * own policy; this panel is drawn only for a holder of it, at a school where
 * they hold it. The server decides again on every post.
 *
 * A TRIP BELONGS TO THE HOST SCHOOL: the route takes the school from the
 * fixture, so the visitors cannot book a bus to a fixture another school
 * hosts. Only fixtures this school hosts are offered; the others are named in
 * one plain sentence. The vehicles offered are the host school's own.
 *
 * The routes insert and nothing more: a booked trip cannot be changed or
 * cancelled from here, and the confirmation says so before it is booked.
 *
 * Each write says "added" or "booked" only after the server has answered OK. A
 * refusal (the server said no, and why) and a failure (it did not answer) are
 * told apart, and neither clears the form.
 *
 * Floors: nothing read under 12px, every control 44px tall.
 */
import { useEffect, useId, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { schoolsWhere } from "../lib/session.js";
import {
  VEHICLE_CONDITIONS, VEHICLE_KINDS, fixtureLine, transportWords, tripBody, tripProblem,
  unbookedFixtures, vehicleBody, vehicleLabel, vehicleProblem, vehiclesFor, driversFor,
} from "../lib/transportBook.js";
import { DBtn, dField, dHead, dNote } from "./publicname.jsx";

/** A label over its control, both at the floors. */
function Field({ label, children }) {
  const id = useId();
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={dHead()}>{label}</label>
      {children(id)}
    </div>
  );
}

const grid = () => ({ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "10px", marginTop: "8px" });
// `area` keeps each form's answer findable on its own: vehicle, trip or book.
const said = (o, area) => o && (
  <p role={o.kind === "ok" ? "status" : "alert"} data-testid={`${area}-${o.kind}`}
    style={{ ...dNote(o.kind !== "ok"), color: o.kind === "ok" ? D.textPrimary : textOn(D.rose) }}>{o.text}</p>
);

const EMPTY_VEHICLE = { registration: "", description: "", kind: "minibus", capacity: "", condition: "", nextServiceOn: "", insuranceExpiresOn: "", roadworthyExpiresOn: "" };

/** Add a vehicle to the school's fleet. A registration already on the list updates that vehicle. */
function AddVehicle({ vehicles, onAdded }) {
  const schools = schoolsWhere("transport.manage");
  const [open, setOpen] = useState(false);
  const [school, setSchool] = useState(schools[0]?.id ?? "");
  const [f, setF] = useState(EMPTY_VEHICLE);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const schoolId = school || schools[0]?.id;

  const save = async () => {
    if (busy) return;
    const problem = vehicleProblem(f);
    if (problem) { setOutcome({ kind: "problem", text: problem }); return; }
    const reg = f.registration.trim();
    const had = vehicles.some((v) => v.school === schoolId && String(v.reg).trim().toUpperCase() === reg.toUpperCase());
    setBusy(true); setOutcome(null);
    try {
      await api("/api/vehicles", { method: "POST", body: vehicleBody(f, schoolId) });
      setOutcome({ kind: "ok", text: had ? `Saved. ${reg} was already on the register, and has been updated.` : `Added. ${reg} is on the register.` });
      setF(EMPTY_VEHICLE);
      onAdded();
    } catch (e) { setOutcome(transportWords(e)); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="transport-add-vehicle">
      {!open
        ? <DBtn quiet onClick={() => { setOpen(true); setOutcome(null); }} testid="transport-add-vehicle-open">Add a vehicle</DBtn>
        : (
          <div>
            <p style={dHead()}>Add a vehicle</p>
            <p style={dNote()}>A registration that is already on the register updates that vehicle. It is not added twice.</p>
            <div style={grid()}>
              {schools.length > 1 && (
                <Field label="School">{(id) => (
                  <select id={id} value={schoolId} onChange={(e) => setSchool(e.target.value)} style={dField()} data-testid="vehicle-school">
                    {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>)}</Field>
              )}
              <Field label="Registration">{(id) => <input id={id} value={f.registration} onChange={set("registration")} style={dField()} data-testid="vehicle-registration" autoComplete="off"/>}</Field>
              <Field label="Description">{(id) => <input id={id} value={f.description} onChange={set("description")} style={dField()} data-testid="vehicle-description" autoComplete="off"/>}</Field>
              <Field label="Kind">{(id) => (
                <select id={id} value={f.kind} onChange={set("kind")} style={dField()} data-testid="vehicle-kind">
                  {VEHICLE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>)}</Field>
              <Field label="Seats">{(id) => <input id={id} type="number" inputMode="numeric" min="1" max="80" value={f.capacity} onChange={set("capacity")} style={dField()} data-testid="vehicle-seats"/>}</Field>
              <Field label="Condition">{(id) => (
                <select id={id} value={f.condition} onChange={set("condition")} style={dField()} data-testid="vehicle-condition">
                  {VEHICLE_CONDITIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>)}</Field>
              <Field label="Insurance runs out">{(id) => <input id={id} type="date" value={f.insuranceExpiresOn} onChange={set("insuranceExpiresOn")} style={dField()} data-testid="vehicle-insurance"/>}</Field>
              <Field label="Roadworthy runs out">{(id) => <input id={id} type="date" value={f.roadworthyExpiresOn} onChange={set("roadworthyExpiresOn")} style={dField()} data-testid="vehicle-roadworthy"/>}</Field>
              <Field label="Next service">{(id) => <input id={id} type="date" value={f.nextServiceOn} onChange={set("nextServiceOn")} style={dField()} data-testid="vehicle-service"/>}</Field>
            </div>
            <p style={dNote()}>A date left empty is not recorded. A lapsed insurance or roadworthy date stops a trip being booked on the vehicle.</p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <DBtn onClick={save} disabled={busy} testid="vehicle-save">{busy ? "Saving…" : "Save the vehicle"}</DBtn>
              <DBtn quiet onClick={() => { setOpen(false); setOutcome(null); }} disabled={busy} testid="vehicle-close">Close</DBtn>
            </div>
          </div>
        )}
      {said(outcome, "vehicle")}
    </div>
  );
}

const EMPTY_TRIP = { vehicleId: "", driverId: "", departAt: "", returnAt: "", pickup: "", seatsTaken: "" };

/** The form for one fixture, then its confirmation, then the booking. */
function BookOne({ match, vehicles, drivers, driversLoading, onBooked, onClose }) {
  const [f, setF] = useState(EMPTY_TRIP);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setConfirming(false); };
  const options = vehiclesFor(vehicles, match.schoolId);
  const vehicle = options.find((v) => v.id === f.vehicleId) ?? null;
  const line = fixtureLine(match);

  const check = () => {
    const problem = tripProblem(f);
    if (problem) { setOutcome({ kind: "problem", text: problem }); setConfirming(false); return; }
    setOutcome(null); setConfirming(true);
  };
  const book = async () => {
    if (busy) return;
    setBusy(true); setOutcome(null);
    try {
      await api(`/api/matches/${match.id}/trip`, { method: "POST", body: tripBody(f) });
      onBooked(`Booked. ${vehicle?.reg ?? "The vehicle"} is booked for ${line}.`);
    } catch (e) { setOutcome(transportWords(e)); setConfirming(false); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid={`trip-form-${match.id}`} style={{ marginTop: "10px", padding: "12px 14px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 }}>
      <p style={dHead()}>Book a trip for {line}</p>
      {options.length === 0
        ? <p data-testid="trip-no-vehicles" style={dNote()}>This school has no vehicle in service on the register. Add one first.</p>
        : (
          <div style={grid()}>
            <Field label="Vehicle">{(id) => (
              <select id={id} value={f.vehicleId} onChange={set("vehicleId")} style={dField()} data-testid="trip-vehicle">
                <option value="">Choose a vehicle…</option>
                {options.map((v) => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}
              </select>)}</Field>
            {drivers.length > 0
              ? (
                <Field label="Driver">{(id) => (
                  <select id={id} value={f.driverId} onChange={set("driverId")} style={dField()} data-testid="trip-driver">
                    <option value="">No driver named yet</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>)}</Field>
              )
              : (
                <div>
                  <p style={dHead()}>Driver</p>
                  {driversLoading
                    ? <p data-testid="trip-drivers-loading" role="status" style={dNote()}>Reading the drivers…</p>
                    : (
                      <p data-testid="trip-no-drivers" style={dNote()}>
                        No driver account is on the list you can read, so this trip is booked with no driver named. The school office can book a trip with one.
                      </p>
                    )}
                </div>
              )}
            <Field label="Leaves">{(id) => <input id={id} type="datetime-local" value={f.departAt} onChange={set("departAt")} style={dField()} data-testid="trip-departs"/>}</Field>
            <Field label="Returns">{(id) => <input id={id} type="datetime-local" value={f.returnAt} onChange={set("returnAt")} style={dField()} data-testid="trip-returns"/>}</Field>
            <Field label="Pick-up point">{(id) => <input id={id} value={f.pickup} onChange={set("pickup")} maxLength={200} style={dField()} data-testid="trip-pickup" autoComplete="off"/>}</Field>
            <Field label="Seats taken">{(id) => <input id={id} type="number" inputMode="numeric" min="0" value={f.seatsTaken} onChange={set("seatsTaken")} style={dField()} data-testid="trip-seats"/>}</Field>
          </div>
        )}

      {confirming && vehicle && (
        <div role="group" aria-label={`Book ${vehicle.reg} for ${line}?`} data-testid="trip-confirm" style={{ marginTop: "10px" }}>
          <p style={{ ...dNote(), color: D.textPrimary }}>
            Book {vehicle.reg} for {line}? A booked trip cannot be changed or cancelled here yet.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <DBtn onClick={book} disabled={busy} testid="trip-yes">{busy ? "Booking…" : "Yes, book it"}</DBtn>
            <DBtn quiet onClick={() => setConfirming(false)} disabled={busy} testid="trip-back">Back</DBtn>
          </div>
        </div>
      )}
      {!confirming && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {options.length > 0 && <DBtn onClick={check} disabled={busy} testid="trip-book">Book this trip</DBtn>}
          <DBtn quiet onClick={onClose} disabled={busy} testid="trip-close">Close</DBtn>
        </div>
      )}
      {said(outcome, "trip")}
    </div>
  );
}

/**
 * The panel. Mounted only for a holder of transport.manage at some school
 * (LogisticsView decides); it reads the drivers itself, so a reader who is not
 * offered it never asks.
 */
export function BookBus({ role, matches, trips, vehicles, loading, readError, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [outcome, setOutcome] = useState(null);
  // "Loading" is the first read only. A re-read after a write must not unmount
  // the forms, or the answer to the write would go with them.
  const [ready, setReady] = useState(false);
  useEffect(() => { if (!loading) setReady(true); }, [loading]);
  const first = loading && !ready;
  const accounts = useLive("users", role);
  const mySchools = schoolsWhere("transport.manage").map((s) => s.id);
  const { bookable, elsewhere } = unbookedFixtures({ matches, trips, mySchools });
  const driversAt = (school) => driversFor(accounts.rows, school);

  return (
    <div data-testid="transport-book" style={{ padding: "14px 16px", marginBottom: "20px", borderRadius: D.lg, border: `1px solid ${D.border}`, background: D.surf1 }}>
      <p style={dHead()}>Book a bus</p>
      <p style={dNote()}>Add a vehicle to the school&apos;s register, then book a trip to a fixture the school hosts.</p>

      {first && <p role="status" data-testid="transport-book-loading" style={dNote()}>Reading the fleet and the trips…</p>}
      {!first && readError && (
        <p role="alert" data-testid="transport-book-unread" style={dNote(true)}>
          The fleet or the trips could not be read, so a trip cannot be booked now. This is not the same as there being none. Reload the page and try again.
        </p>
      )}

      {!first && !readError && (
        <>
          <AddVehicle vehicles={vehicles} onAdded={onChanged}/>

          <p style={{ ...dHead(), marginTop: "16px" }}>Fixtures with no bus yet</p>
          {bookable.length === 0 && <p data-testid="trip-none" style={dNote()}>No upcoming fixture hosted by this school is without a bus.</p>}
          {bookable.map((m) => (
            <div key={m.id} data-testid={`trip-fixture-${m.id}`} style={{ padding: "8px 0", borderTop: `1px solid ${D.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: "200px", fontFamily: D.body, fontSize: "14px", color: D.textPrimary }}>{fixtureLine(m)}</span>
                <DBtn quiet={openId !== m.id} onClick={() => { setOpenId(openId === m.id ? null : m.id); setOutcome(null); }} testid={`trip-open-${m.id}`}>Book a trip</DBtn>
              </div>
              {openId === m.id && (
                <BookOne match={m} vehicles={vehicles} drivers={driversAt(m.schoolId)} driversLoading={accounts.loading}
                  onClose={() => setOpenId(null)}
                  onBooked={(text) => { setOpenId(null); setOutcome({ kind: "ok", text }); onChanged(); }}/>
              )}
            </div>
          ))}
          {elsewhere.length > 0 && (
            <p data-testid="trip-elsewhere" style={dNote()}>
              {elsewhere.length === 1 ? "One upcoming fixture is" : `${elsewhere.length} upcoming fixtures are`} hosted by another school. A trip belongs to the host school, so only that school books its bus.
            </p>
          )}
        </>
      )}
      {said(outcome, "book")}
    </div>
  );
}

/**
 * SCRBRD — booking a vehicle and a trip (Logistics → transport).
 *
 * The pure half of views/transportbook.jsx. Two routes, both under
 * `transport.manage` (transportRoutes() in services/api/write/events-api.mjs):
 *
 *   POST /api/vehicles           { schoolId, registration, description, kind,
 *                                  capacity, condition?, nextServiceOn?,
 *                                  insuranceExpiresOn?, roadworthyExpiresOn? }
 *   POST /api/matches/:id/trip   { vehicleId, driverId?, departAt, returnAt?,
 *                                  pickup?, seatsTaken? }
 *
 * What this decides: what to offer (a fixture the caller's school hosts, with
 * no bus yet, and that school's own vehicles) and what to say. What it does
 * not: whether a trip is allowed. The database does, and its reasons are shown
 * as it gives them (a bus that seats fourteen carrying fifteen, a lapsed
 * insurance date, another school's vehicle).
 *
 * A TRIP BELONGS TO THE HOST SCHOOL. The route writes school_id from the
 * fixture (match_school()), never from the request, so a school that is only
 * the visitor cannot book a bus to a fixture another school hosts; it is
 * refused as not_permitted. Such a fixture is named, plainly, and not offered.
 */

/** @type {readonly { value: string, label: string }[]} */
export const VEHICLE_KINDS = Object.freeze([
  { value: "minibus", label: "Minibus" },
  { value: "bus", label: "Bus" },
  { value: "van", label: "Van" },
  { value: "car", label: "Car" },
]);

/** @type {readonly { value: string, label: string }[]} */
export const VEHICLE_CONDITIONS = Object.freeze([
  { value: "", label: "Not recorded" },
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" },
  { value: "off_road", label: "Off the road" },
]);

/** A whole number from `lo` to `hi`, or null. @param {unknown} v */
const whole = (v, lo, hi) => {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
};

/**
 * What the Add a vehicle form is missing, before anything is sent. null when it can go.
 * @param {{ registration?: string, description?: string, capacity?: string }} f
 * @returns {string | null}
 */
export function vehicleProblem(f) {
  if (!String(f.registration ?? "").trim()) return "Give the registration.";
  if (!String(f.description ?? "").trim()) return "Describe the vehicle, for example Quantum 22-seater.";
  if (whole(f.capacity, 1, 80) === null) return "Seats must be a whole number from 1 to 80.";
  return null;
}

/**
 * The body POST /api/vehicles takes. Empty optional fields are left out, so a
 * date nobody typed stays "not recorded" and never becomes a date.
 * @param {Record<string, string>} f @param {string} schoolId
 */
export function vehicleBody(f, schoolId) {
  /** @type {Record<string, unknown>} */
  const b = { schoolId, registration: f.registration.trim(), description: f.description.trim(),
              kind: f.kind || "minibus", capacity: whole(f.capacity, 1, 80) };
  if (f.condition) b.condition = f.condition;
  if (f.nextServiceOn) b.nextServiceOn = f.nextServiceOn;
  if (f.insuranceExpiresOn) b.insuranceExpiresOn = f.insuranceExpiresOn;
  if (f.roadworthyExpiresOn) b.roadworthyExpiresOn = f.roadworthyExpiresOn;
  return b;
}

/**
 * What the Book a trip form is missing, before anything is sent. null when it can go.
 * Seats against the vehicle are NOT checked here: the database holds that rule
 * and says it in its own words, which a copy here could drift from.
 * @param {{ vehicleId?: string, departAt?: string, returnAt?: string, seatsTaken?: string }} f
 * @returns {string | null}
 */
export function tripProblem(f) {
  if (!f.vehicleId) return "Choose the vehicle.";
  if (!f.departAt || Number.isNaN(new Date(f.departAt).getTime())) return "Say when it leaves.";
  if (f.returnAt) {
    if (Number.isNaN(new Date(f.returnAt).getTime())) return "That return time is not a time.";
    if (new Date(f.returnAt) < new Date(f.departAt)) return "The return time is before the departure.";
  }
  if (String(f.seatsTaken ?? "").trim() !== "" && whole(f.seatsTaken, 0, 1000) === null) return "Seats taken must be a whole number, 0 or more.";
  return null;
}

/**
 * The body POST /api/matches/:id/trip takes. A local date and time from the
 * form becomes an instant; the driver, the pick-up and the seats are left out
 * when empty.
 * @param {Record<string, string>} f
 */
export function tripBody(f) {
  /** @type {Record<string, unknown>} */
  const b = { vehicleId: f.vehicleId, departAt: new Date(f.departAt).toISOString() };
  if (f.driverId) b.driverId = f.driverId;
  if (f.returnAt) b.returnAt = new Date(f.returnAt).toISOString();
  if (f.pickup && f.pickup.trim()) b.pickup = f.pickup.trim();
  if (String(f.seatsTaken ?? "").trim() !== "") b.seatsTaken = Number(f.seatsTaken);
  return b;
}

/**
 * A fixture, in a line: the sides and the day. Sides, never a person.
 * @param {{ homeLabel?: string | null, homeTeam?: string | null, awayLabel?: string | null, awayTeam?: string | null, date?: string | null, time?: string | null }} m
 */
export function fixtureLine(m) {
  const home = m.homeLabel || m.homeTeam || "Home";
  const away = m.awayLabel || m.awayTeam || "an opponent to be named";
  return `${home} v ${away}${m.date ? ` · ${m.date}${m.time ? ` ${m.time}` : ""}` : ""}`;
}

/**
 * Upcoming fixtures with no bus yet, split by whose they are to book:
 * `bookable` where a school the caller holds transport.manage at is the host,
 * `elsewhere` where another school hosts, and only that school may.
 * @param {{ matches: any[], trips: any[], mySchools: string[] }} a
 */
export function unbookedFixtures({ matches, trips, mySchools }) {
  const withTrip = new Set((trips ?? []).filter((t) => t.state !== "cancelled").map((t) => t.matchId));
  const open = (matches ?? []).filter((m) => m.status === "upcoming" && !withTrip.has(m.id));
  const mine = new Set(mySchools);
  return {
    bookable: open.filter((m) => m.schoolId && mine.has(m.schoolId)),
    elsewhere: open.filter((m) => !m.schoolId || !mine.has(m.schoolId)),
  };
}

/**
 * The vehicles that can be named on a fixture: its host school's own, in
 * service. Cover and seats are not filtered: the database refuses a lapsed one
 * and says why.
 * @param {any[]} vehicles @param {string} hostSchool
 */
export function vehiclesFor(vehicles, hostSchool) {
  return (vehicles ?? []).filter((v) => v.school === hostSchool && v.active);
}

/**
 * The drivers who can be named on a trip: active driver accounts at the host
 * school, from the `users` read. A reader who may not read the school's
 * accounts (a transport coordinator holds no user.read) is given none, and
 * the form says so, never a made-up list. This only narrows what was read: it
 * grants nothing, and the trip's own policy decides what is written.
 * @param {{ id: string, name: string, role?: string, status?: string, school?: string | null }[]} users
 * @param {string | null | undefined} hostSchool
 */
export function driversFor(users, hostSchool) {
  return (users ?? []).filter((u) => u.role === "driver" && u.status === "active" && (!hostSchool || u.school === hostSchool))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * One vehicle in a pick list: what it is, how many it seats, and what the
 * register says about its cover, so a lapse is seen before the booking.
 * @param {{ reg: string, description?: string | null, capacity?: number | null, coverState?: string | null }} v
 */
export function vehicleLabel(v) {
  const cover = v.coverState === "expired" ? "cover has lapsed" : v.coverState === "expiring" ? "cover ends soon"
    : v.coverState === "unknown" ? "cover not recorded" : "cover current";
  return `${v.reg}${v.description ? `, ${v.description}` : ""} · ${v.capacity ?? "?"} seats · ${cover}`;
}

/**
 * The sentence for a refusal or a failure, and which of the two it is. Nothing
 * was changed either way; the form keeps what was typed.
 *
 * @param {any} e  an ApiError, or whatever was thrown
 * @returns {{ kind: "refused" | "failed", text: string }}
 */
export function transportWords(e) {
  const code = e?.code;
  const status = e?.status;
  if (status === undefined || status === null) {
    return { kind: "failed", text: "Could not reach SCRBRD. Check your connection and try again. Nothing was changed." };
  }
  if (status === 401) return { kind: "refused", text: "Your session has ended. Sign in again. Nothing was changed." };
  if (code === "invalid_trip") {
    const d = String(e?.detail ?? "");
    if (/trip_returns_after_departure/.test(d)) return { kind: "refused", text: "The return time is before the departure. Nothing was changed." };
    if (/trip_arrives_after_departing/.test(d)) return { kind: "refused", text: "That trip is not in an order the register allows. Nothing was changed." };
    return { kind: "refused", text: d ? `The trip was refused: ${d.replace(/[.\s]+$/, "")}. Nothing was changed.` : "The trip was refused. Nothing was changed." };
  }
  const REFUSED = {
    not_permitted: "You may not do this. A trip belongs to the school hosting the fixture, so only that school's transport office books it, and only people who plan transport may. Nothing was changed.",
    vehicle_already_on_this_fixture: "That vehicle is already booked for this fixture. Choose another vehicle. Nothing was changed.",
    no_such_match_or_vehicle: "The fixture or the vehicle could not be found. Reload the page and try again. Nothing was changed.",
    school_required: "No school was named for the vehicle. Reload the page and try again. Nothing was changed.",
    registration_required: "Give the registration. Nothing was changed.",
    description_required: "Describe the vehicle. Nothing was changed.",
    capacity_invalid: "Seats must be a whole number from 1 to 80. Nothing was changed.",
    kind_invalid: "Choose bus, minibus, van or car. Nothing was changed.",
    condition_invalid: "Choose one of the conditions on the list. Nothing was changed.",
    seats_invalid: "Seats taken must be a whole number, 0 or more. Nothing was changed.",
    date_must_be_yyyy_mm_dd: "A date must be a real date. Nothing was changed.",
  };
  if (code && Object.hasOwn(REFUSED, code)) return { kind: "refused", text: REFUSED[/** @type {keyof typeof REFUSED} */ (code)] };
  return { kind: "failed", text: `That did not go through (${code || `HTTP ${status}`}). Nothing was changed.` };
}

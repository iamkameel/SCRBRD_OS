/**
 * Booking a vehicle and a trip (Logistics → transport): the pure half,
 * lib/transportBook.js.
 *
 *   - the forms are checked for what is missing before anything is sent, and
 *     seats against the bus are NOT: the database says that, in its words
 *   - the bodies are what transportRoutes() reads, and an empty optional field
 *     is left out, never sent as a date or a zero
 *   - only fixtures the caller's school hosts, with no bus yet, are offered; a
 *     fixture another school hosts is counted, not offered
 *   - only the host school's own vehicles in service can be named
 *   - every refusal transportRoutes() answers has words, a refusal and a
 *     failure are told apart, and the server's own reason is passed through
 *
 *   node apps/web/test/transport-book.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  VEHICLE_CONDITIONS, VEHICLE_KINDS, fixtureLine, transportWords, tripBody, tripProblem,
  driversFor, unbookedFixtures, vehicleBody, vehicleLabel, vehicleProblem, vehiclesFor,
} from "../src/lib/transportBook.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

group("The vehicle form");
{
  const good = { registration: "WES DEMO 2", description: "Quantum 22-seater", kind: "minibus", capacity: "22" };
  ok("a full form can go", vehicleProblem(good) === null);
  ok("no registration", /registration/.test(vehicleProblem({ ...good, registration: "  " })));
  ok("no description", /Describe/.test(vehicleProblem({ ...good, description: "" })));
  ok("no seats", /1 to 80/.test(vehicleProblem({ ...good, capacity: "" })));
  ok("0 seats", /1 to 80/.test(vehicleProblem({ ...good, capacity: "0" })));
  ok("81 seats", /1 to 80/.test(vehicleProblem({ ...good, capacity: "81" })));
  ok("half a seat", /1 to 80/.test(vehicleProblem({ ...good, capacity: "22.5" })));
  ok("80 seats is the most", vehicleProblem({ ...good, capacity: "80" }) === null);
  const b = vehicleBody({ ...good, registration: " WES DEMO 2 ", condition: "", nextServiceOn: "", insuranceExpiresOn: "", roadworthyExpiresOn: "" }, HIL);
  ok("the body is what POST /api/vehicles reads", b.schoolId === HIL && b.registration === "WES DEMO 2" && b.description === "Quantum 22-seater" && b.kind === "minibus" && b.capacity === 22, JSON.stringify(b));
  ok("an empty condition and empty dates are left out, not sent as nothing in particular", !("condition" in b) && !("nextServiceOn" in b) && !("insuranceExpiresOn" in b) && !("roadworthyExpiresOn" in b), JSON.stringify(b));
  const d = vehicleBody({ ...good, condition: "good", nextServiceOn: "2026-12-01", insuranceExpiresOn: "2027-03-01", roadworthyExpiresOn: "2027-02-01" }, HIL);
  ok("a date typed is sent as typed", d.condition === "good" && d.nextServiceOn === "2026-12-01" && d.insuranceExpiresOn === "2027-03-01" && d.roadworthyExpiresOn === "2027-02-01");
  ok("an unset kind is a minibus, as the route's own default", vehicleBody({ ...good, kind: "" }, HIL).kind === "minibus");

  // The kinds and conditions on offer are the ones the route and the table accept.
  const route = readFileSync(new URL("../../../services/api/write/events-api.mjs", import.meta.url), "utf8");
  ok("every kind offered is one the route accepts", VEHICLE_KINDS.every((k) => route.includes(`"${k.value}"`)));
  ok("every condition offered is one the route accepts", VEHICLE_CONDITIONS.filter((c) => c.value).every((c) => route.includes(`"${c.value}"`)));
  ok("...and the route accepts no kind that is not offered", ["bus", "minibus", "van", "car"].every((k) => VEHICLE_KINDS.some((x) => x.value === k)));
}

group("The trip form");
{
  const good = { vehicleId: "v1", departAt: "2026-10-12T13:00", returnAt: "2026-10-12T18:00", seatsTaken: "14" };
  ok("a full form can go", tripProblem(good) === null);
  ok("a form with only a vehicle and a departure can go", tripProblem({ vehicleId: "v1", departAt: "2026-10-12T13:00" }) === null);
  ok("no vehicle", /Choose the vehicle/.test(tripProblem({ ...good, vehicleId: "" })));
  ok("no departure", /when it leaves/.test(tripProblem({ ...good, departAt: "" })));
  ok("a return before the departure", /before the departure/.test(tripProblem({ ...good, returnAt: "2026-10-12T12:00" })));
  ok("a return at the departure is allowed (the table says the same)", tripProblem({ ...good, returnAt: "2026-10-12T13:00" }) === null);
  ok("negative seats", /Seats taken/.test(tripProblem({ ...good, seatsTaken: "-1" })));
  ok("fractional seats", /Seats taken/.test(tripProblem({ ...good, seatsTaken: "1.5" })));
  ok("zero seats taken is allowed", tripProblem({ ...good, seatsTaken: "0" }) === null);
  ok("seats against the bus are the database's to refuse", tripProblem({ ...good, seatsTaken: "400" }) === null);
  const b = tripBody({ vehicleId: "v1", driverId: "", departAt: "2026-10-12T13:00", returnAt: "", pickup: "  ", seatsTaken: "" });
  ok("the body carries the vehicle and the departure as an instant", b.vehicleId === "v1" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(b.departAt), JSON.stringify(b));
  ok("the departure round-trips to the minute typed", new Date(b.departAt).getTime() === new Date("2026-10-12T13:00").getTime());
  ok("no driver, no return, no pick-up and no seats are left out, never sent as zero or empty", !("driverId" in b) && !("returnAt" in b) && !("pickup" in b) && !("seatsTaken" in b), JSON.stringify(b));
  const f = tripBody({ ...good, driverId: "d1", pickup: " Main gate " });
  ok("everything typed is sent", f.driverId === "d1" && f.pickup === "Main gate" && f.seatsTaken === 14 && typeof f.returnAt === "string");
  ok("zero seats taken is sent as 0", tripBody({ ...good, seatsTaken: "0" }).seatsTaken === 0);
}

group("Which fixtures are offered, and which vehicles");
{
  const m = (id, over) => ({ id, status: "upcoming", schoolId: HIL, homeTeam: "1XI", awayTeam: "Kearsney", date: "2026-10-12", ...over });
  const matches = [m("a"), m("b"), m("c", { schoolId: WES }), m("d", { status: "complete" }), m("e", { status: "live" }), m("f", { schoolId: null })];
  const trips = [{ matchId: "b", state: "scheduled" }];
  const { bookable, elsewhere } = unbookedFixtures({ matches, trips, mySchools: [HIL] });
  ok("a fixture the school hosts with no bus is offered", bookable.map((x) => x.id).join() === "a", bookable.map((x) => x.id).join());
  ok("one that has a bus is not", !bookable.some((x) => x.id === "b"));
  ok("a fixture another school hosts is not offered, but is counted", elsewhere.map((x) => x.id).sort().join() === "c,f", elsewhere.map((x) => x.id).join());
  ok("a played or live fixture is neither", ![...bookable, ...elsewhere].some((x) => ["d", "e"].includes(x.id)));
  ok("a cancelled trip does not count as a bus", unbookedFixtures({ matches, trips: [{ matchId: "a", state: "cancelled" }], mySchools: [HIL] }).bookable.some((x) => x.id === "a"));
  ok("a school with no right anywhere is offered nothing", unbookedFixtures({ matches, trips, mySchools: [] }).bookable.length === 0);
  ok("a fixture line names the sides and the day", fixtureLine(m("a")) === "1XI v Kearsney · 2026-10-12", fixtureLine(m("a")));
  ok("...the full side names where the read has them, and the time", fixtureLine(m("a", { homeLabel: "Westville 1XI", awayLabel: "Kearsney College 1XI", time: "09:00" })) === "Westville 1XI v Kearsney College 1XI · 2026-10-12 09:00");
  ok("...and an opponent not yet named is said so", /to be named/.test(fixtureLine({ homeTeam: "1XI", awayTeam: null })));

  const vs = [
    { id: "1", school: HIL, active: true, reg: "A", capacity: 22 },
    { id: "2", school: HIL, active: false, reg: "B", capacity: 14 },
    { id: "3", school: WES, active: true, reg: "C", capacity: 22 },
  ];
  ok("only the host school's own vehicle in service can be named", vehiclesFor(vs, HIL).map((v) => v.id).join() === "1");
  const us = [
    { id: "d1", name: "B Ngcobo", role: "driver", status: "active", school: HIL },
    { id: "d0", name: "A Driver", role: "driver", status: "active", school: HIL },
    { id: "d2", name: "Gone", role: "driver", status: "inactive", school: HIL },
    { id: "d3", name: "Elsewhere", role: "driver", status: "active", school: WES },
    { id: "c1", name: "A Coach", role: "coach", status: "active", school: HIL },
  ];
  ok("the drivers on offer are active driver accounts at the host school, in name order", driversFor(us, HIL).map((u) => u.id).join() === "d0,d1", driversFor(us, HIL).map((u) => u.id).join());
  ok("a reader who may read no accounts is offered no driver, not an invented one", driversFor([], HIL).length === 0 && driversFor(undefined, HIL).length === 0);
  ok("a vehicle's line says its seats and its cover", vehicleLabel({ reg: "KZN 482 GP", description: "Quantum", capacity: 22, coverState: "current" }) === "KZN 482 GP, Quantum · 22 seats · cover current");
  ok("a lapse is said before the booking", /lapsed/.test(vehicleLabel({ reg: "X", capacity: 5, coverState: "expired" })));
  ok("...and an unrecorded date is not called current", /not recorded/.test(vehicleLabel({ reg: "X", capacity: 5, coverState: "unknown" })));
}

group("Every refusal has words");
{
  const err = (status, code, detail) => Object.assign(new Error(code), { status, code, detail });
  const say = (status, code, detail) => transportWords(err(status, code, detail));
  const route = readFileSync(new URL("../../../services/api/write/events-api.mjs", import.meta.url), "utf8");
  // Every code transportRoutes() can answer, read from the route.
  const from = route.indexOf("export function transportRoutes");
  const body = route.slice(from, route.indexOf("export function officialRoutes"));
  const codes = new Set([...body.matchAll(/err\("([a-z_]+)"/g)].map((m) => m[1]));
  for (const c of ["invalid_trip", "vehicle_already_on_this_fixture", "no_such_match_or_vehicle", "not_permitted"]) if (body.includes(`"${c}"`)) codes.add(c);
  codes.delete("event_invalid");   // the driver's mark: not this screen
  ok("the route answers at least a dozen codes", codes.size >= 12, [...codes].join());
  for (const c of codes) {
    const w = say(c === "not_permitted" ? 403 : c === "invalid_trip" ? 422 : 400, c, c === "invalid_trip" ? "vehicle X seats 14, and this trip names 15 passengers" : undefined);
    ok(`${c}: a refusal in a sentence, never the code`, w.kind === "refused" && w.text.length > 25 && !w.text.includes(c), w.text);
    ok(`${c}: says nothing was changed`, /Nothing was changed/.test(w.text), w.text);
  }
  const cap = say(422, "invalid_trip", "vehicle KZN 119 KP seats 14, and this trip names 15 passengers");
  ok("the database's own reason is passed through", /KZN 119 KP seats 14, and this trip names 15 passengers/.test(cap.text), cap.text);
  const lapsed = say(422, "invalid_trip", "vehicle KZN 482 GP: insurance expired on 2026-09-01. Renew it, or record the renewal, before it carries a side");
  ok("...and the lapsed cover with it, with one full stop between the sentences", /insurance expired on 2026-09-01\. Renew it/.test(lapsed.text) && !/\.\./.test(lapsed.text), lapsed.text);
  ok("a return before the departure is said plainly, not as a constraint name",
     /return time is before the departure/.test(say(422, "invalid_trip", 'new row for relation "trip" violates check constraint "trip_returns_after_departure"').text));
  ok("a trip refused with no reason still says it was refused", /refused/.test(say(422, "invalid_trip").text));
  ok("a host rule refusal says whose trip it is", /belongs to the school hosting the fixture/.test(say(403, "not_permitted").text));
  ok("a double booking says to choose another vehicle", /another vehicle/.test(say(409, "vehicle_already_on_this_fixture").text));
  ok("a session that ended is a refusal that says to sign in", say(401, "session_revoked").kind === "refused" && /Sign in again/.test(say(401, "session_revoked").text));
  const none = transportWords(new Error("fetch failed"));
  ok("no answer at all is a failure, said so", none.kind === "failed" && /Could not reach SCRBRD/.test(none.text), none.text);
  const odd = say(500, "error");
  ok("a code nobody knows is a failure that shows it", odd.kind === "failed" && /\(error\)/.test(odd.text) && /Nothing was changed/.test(odd.text), odd.text);
  ok("a word on Object.prototype is not a refusal", transportWords(err(400, "constructor")).kind === "failed");
}

console.log(`\nTRANSPORT BOOKING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

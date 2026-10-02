/**
 * The five lift exceptions db/76 defines, in words (lift_exceptions()). One
 * home for the sentences, so the Squad screen's list (views/lifts.jsx) and the
 * coach's feed (lib/signals.js, S4b) say the same thing and cannot drift.
 */
export const EXCEPTION_WORDS = Object.freeze({
  not_left: "The lift is late and not marked as left",
  not_boarded: "Not marked in the car when the lift left",
  not_collected: "Not collected",
  not_received: "Handed over; nobody has said they have him",
  not_handed_over: "The lift arrived; not marked handed over",
});

/**
 * SCRBRD — turning alerts on for this phone, and nothing more than that.
 *
 * This file registers a device and retires it. It does NOT decide what the
 * device receives, cache anything it received, or hold any notion of what its
 * owner is allowed to know. That is the rule the whole notify path is built
 * on: a cached notification is not permission, and the server re-asks the
 * notification's own policy, as the person, every time it sends.
 *
 * So a device registration can only ever REDUCE what somebody receives — by
 * not existing. There is no arrangement of this file that widens what a person
 * may know, which is why it needs no capability and has no administrative
 * path: nobody enrols somebody else's phone.
 *
 * THREE THINGS CAN SAY NO, and none of them is an error worth shouting about:
 * the browser may not support web push at all, the person may decline the
 * permission prompt, and the deployment may have no VAPID key configured. All
 * three come back as a reason string, because a settings screen has to say
 * which one happened — "your browser does not do this" and "you said no" and
 * "we have not set this up yet" need three different sentences.
 */
import { api } from "./api.js";
import { firebaseApp } from "./firebase.js";

// The public half of the VAPID pair. Public by design — it identifies the
// project to the browser's push service and is safe in a bundle. The PRIVATE
// half lives with the sender and never comes near this repository.
const VAPID = import.meta.env?.VITE_FCM_VAPID_KEY ?? null;

/**
 * Can this browser do web push at all?
 *
 * Firebase's own isSupported() is the honest test — iOS Safari only gained
 * web push for installed PWAs, and a private window with storage blocked
 * fails in ways a feature-detect on `window.Notification` does not catch.
 * Dynamic import so a browser that cannot do any of this never pays to
 * download the messaging SDK.
 */
export async function pushSupported() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const { isSupported } = await import("firebase/messaging");
    return await isSupported();
  } catch { return false; }
}

/**
 * Ask for permission, get a token, and register it.
 *
 * Order matters: permission FIRST, because getToken() would otherwise trigger
 * the browser's own prompt at a moment the person did not ask for it, and a
 * prompt nobody expected is a prompt that gets denied permanently.
 *
 * @returns {{ok: true, id: string} | {ok: false, reason: string}}
 */
export async function enablePush({ label } = {}) {
  if (!(await pushSupported())) return { ok: false, reason: "unsupported" };
  if (!VAPID) return { ok: false, reason: "not_configured" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "declined" };

  try {
    const { getMessaging, getToken } = await import("firebase/messaging");
    // The messaging service worker, registered explicitly rather than left to
    // the SDK's default lookup: this app already registers /sw.js for the
    // offline shell, and letting Firebase quietly install a second worker at
    // its default path is how two workers end up fighting over one scope.
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token = await getToken(getMessaging(firebaseApp), {
      vapidKey: VAPID, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: "no_token" };

    // The platform is what this code can actually vouch for. A user agent
    // string could say more and would be guessing.
    const res = await api("/api/devices", {
      method: "POST", body: { token, platform: "web", label: label ?? null } });
    return { ok: true, id: res.id };
  } catch (e) {
    return { ok: false, reason: e?.code || "registration_failed" };
  }
}

/**
 * Turn alerts off for this phone.
 *
 * Both halves, and the order is deliberate: tell the server first, because a
 * deleted local token with a live server registration means the school keeps
 * sending to a phone that will never show it, and the delivery log fills with
 * sends nobody sees. A failed deleteToken() after a successful retire is
 * harmless — the registration is already retired and the fan-out will not
 * carry it.
 */
export async function disablePush() {
  let retired = 0;
  try {
    const { getMessaging, getToken, deleteToken } = await import("firebase/messaging");
    const messaging = getMessaging(firebaseApp);
    const token = VAPID ? await getToken(messaging, { vapidKey: VAPID }).catch(() => null) : null;
    if (token) {
      const res = await api("/api/devices/retire", { method: "POST", body: { token } });
      retired = res?.retired ?? 0;
      await deleteToken(messaging).catch(() => {});
    }
  } catch { /* nothing registered, or the SDK is unavailable */ }
  return { ok: true, retired };
}

/**
 * A notice that arrives while the app is open.
 *
 * The payload is a POINTER for anything not already public — an id and a
 * generic line — so this callback must not try to render it as content. It
 * exists to prompt a refetch of the notifications read, which is where the
 * authorization actually happens. Handing the payload straight to the UI
 * would be treating a push as a source of truth, and a push is a doorbell.
 */
export async function onPushWhileOpen(handler) {
  if (!(await pushSupported())) return () => {};
  const { getMessaging, onMessage } = await import("firebase/messaging");
  return onMessage(getMessaging(firebaseApp), (payload) => {
    handler({ notificationId: payload?.data?.notificationId ?? null });
  });
}

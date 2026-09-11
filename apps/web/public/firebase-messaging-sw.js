/**
 * SCRBRD — the service worker that receives a push when the app is closed.
 *
 * THE CONFIG IS DUPLICATED FROM src/lib/firebase.js AND HAS TO BE. A service
 * worker is a separate script with no access to the app bundle or to Vite's
 * environment variables, so there is no import that would share it. Both
 * copies name the same project, scrbrd-os, and only the keys the browser needs
 * to identify the project — all of which are public by design and already in
 * the shipped bundle. If the project ever changes, both files change together.
 *
 * WHAT THIS WORKER MUST NOT DO is treat the payload as content. Anything not
 * already marked public arrives as a pointer — a generic line and an id —
 * because a lock screen renders without anybody signing in. So this shows what
 * it was given and nothing more: it does not fetch the notice, and it does not
 * decorate the notification with anything it looked up, because a service
 * worker has no session and no authorization context in which to look
 * anything up safely.
 */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAagOmj51ns5R64-IQRI92o4Sa5iagFRPA",
  authDomain: "scrbrd-os.firebaseapp.com",
  projectId: "scrbrd-os",
  storageBucket: "scrbrd-os.firebasestorage.app",
  messagingSenderId: "705280257618",
  appId: "1:705280257618:web:8f5d627b62e3c826c3398b",
});

firebase.messaging().onBackgroundMessage((payload) => {
  const n = payload?.notification || {};
  self.registration.showNotification(n.title || "SCRBRD", {
    body: n.body || "You have a new notice.",
    // The id travels so a tap can open the right notice — and the app fetches
    // its content through the governed read, once the person is authenticated
    // again. The worker never holds it.
    data: { notificationId: payload?.data?.notificationId ?? null },
    tag: payload?.data?.notificationId ?? undefined,
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification?.data?.notificationId;
  event.waitUntil(clients.openWindow(id ? `/?notice=${encodeURIComponent(id)}` : "/"));
});

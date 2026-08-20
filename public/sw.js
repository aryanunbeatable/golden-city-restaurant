// Service worker for order notifications. Deliberately tiny — it only exists
// because a push cannot be delivered to a page that is closed, which is the
// entire point of the feature.

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // ponytail: no icon/badge — there is no app icon asset yet and browsers
      // fall back cleanly. Add one here when there is a real logo PNG.
      // Same tag replaces rather than stacks: one order, one notification.
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  if (!url) return;
  // Focus the tracker if it is already open somewhere rather than opening a
  // second copy of the same order.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.url.includes(url) && "focus" in tab) return tab.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

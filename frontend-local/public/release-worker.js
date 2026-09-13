// An older installed PWA may not contain the new version-checking UI yet.
// Once the new worker activates, reload same-origin app windows onto its assets.
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.filter(client => {
      const url = new URL(client.url);
      return url.origin === self.location.origin && !/^\/(api|download|share)(\/|$)/.test(url.pathname);
    }).forEach(client => {
      // A navigation may fetch through this worker. Waiting for it here would
      // block activation while the navigation itself waits for activation.
      void client.navigate(client.url).catch(() => undefined);
    });
  }));
});

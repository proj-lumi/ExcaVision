const CACHE = 'excavision-customer-prototype-v2'

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/']))))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})

function alertUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/alerts'
  return value
}

self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { /* use safe defaults */ }
  const title = typeof payload.title === 'string' ? payload.title : 'Monitoring alert'
  const options = {
    body: typeof payload.body === 'string' ? payload.body : 'Open ExcaVision to review the alert.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: typeof payload.tag === 'string' ? payload.tag : 'excavision-alert',
    data: { url: alertUrl(payload.url) },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = alertUrl(event.notification.data?.url)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows[0]
    if (existing) {
      await existing.navigate(url)
      return existing.focus()
    }
    return self.clients.openWindow(url)
  })())
})

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients =>
    clients.forEach(client => client.postMessage({ type: 'excavision-push-subscription-changed' })),
  ))
})

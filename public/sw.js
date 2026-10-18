// Service worker do Motoristas por Galpão: recebe e mostra as notificações push.
// Não faz cache de páginas (o app sempre busca a versão mais nova).

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()))

self.addEventListener('push', (evento) => {
  let aviso = { title: 'Motoristas por Galpão', body: '', url: '/', tag: undefined }
  try {
    aviso = { ...aviso, ...evento.data.json() }
  } catch {
    if (evento.data) aviso.body = evento.data.text()
  }
  evento.waitUntil(
    self.registration.showNotification(aviso.title, {
      body: aviso.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: aviso.tag,
      renotify: !!aviso.tag,
      data: { url: aviso.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const destino = new URL(evento.notification.data?.url || '/', self.location.origin).href
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      // Reaproveita uma aba do app já aberta, se houver.
      for (const janela of janelas) {
        if (new URL(janela.url).origin === self.location.origin && 'focus' in janela) {
          janela.navigate(destino)
          return janela.focus()
        }
      }
      return self.clients.openWindow(destino)
    }),
  )
})

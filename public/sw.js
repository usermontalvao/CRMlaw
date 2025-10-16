// Service Worker para Push Notifications

const CACHE_NAME = 'crm-cache-v2';

// Install event
self.addEventListener('install', (event) => {
  console.log('Service Worker instalado');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker ativado');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => clients.claim())
  );
});

// Fetch event - estratégia de fallback para navegação SPA
self.addEventListener('fetch', (event) => {
  // Apenas interceptar requisições de navegação (HTML)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Se falhar (offline ou erro), retornar index.html do cache ou network
        return caches.match('/index.html').then((response) => {
          return response || fetch('/index.html');
        });
      })
    );
  }
});

// Push event - recebe notificações push
self.addEventListener('push', (event) => {
  console.log('Push notification recebida');

  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Nova Notificação';
  const options = {
    body: data.body || '',
    icon: data.icon || '/logo192.png',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('Notificação clicada:', event.notification.tag);
  
  event.notification.close();

  // Abre ou foca a janela do app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se já tem uma janela aberta, foca nela
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Senão, abre uma nova janela
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('Notificação fechada:', event.notification.tag);
});

// Service Worker para Push Notifications

// ⚠️ IMPORTANTE: index.html e sw.js NÃO são cacheados pelo SW.
// O _headers do Netlify já instrui o browser a nunca cachear index.html,
// garantindo que após novo deploy os chunks corretos sejam carregados.
const CACHE_NAME = 'crm-cache-v7'; // Incrementar aqui a cada mudança na estratégia de cache

// Install event — não pré-cacheia index.html para evitar stale chunks
self.addEventListener('install', (event) => {
  console.log('Service Worker instalado - v7');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pré-cache somente de recursos estáticos que NÃO mudam entre deploys
      return cache.addAll([
        '/manifest.webmanifest',
        '/favicon.ico'
      ]).catch((error) => {
        console.log('Falha no pré-cache:', error);
        // Não falhar a instalação se o pré-cache falhar
      });
    })
  );

  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('Service Worker ativado - v7');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('Deletando cache antigo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('Todos os caches antigos foram limpos');
      return clients.claim();
    })
  );
});

// Fetch event — network-first para navegação SPA
// index.html NUNCA vem do cache (evita stale chunks após deploy)
self.addEventListener('fetch', (event) => {
  // Ignorar requisições não-GET e recursos de API/storage
  if (event.request.method !== 'GET') return;
  if (
    event.request.url.includes('/api/') ||
    event.request.url.includes('/functions/v1/') ||
    event.request.url.includes('supabase.co')
  ) return;

  // Requisições de navegação (HTML) — sempre da rede, NUNCA do cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => {
        // Offline: fallback mínimo (não usar index.html cacheado pois teria chunks antigos)
        return new Response(
          '<html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem"><h2>Sem conexão</h2><p>Verifique sua internet e <a href="/">recarregue a página</a>.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      })
    );
    return;
  }

  // Outros recursos (imagens, fontes, etc.) — cache-first com fallback de rede
  // Assets do Vite (/assets/*) já têm hash imutável, podem ser cacheados
  if (event.request.url.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
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

  const payload = event.notification.data || {};

  // Abre ou foca a janela do app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se já tem uma janela aberta, foca nela
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then(() => {
            try {
              client.postMessage(payload);
            } catch {}
          });
        }
      }
      // Senão, abre uma nova janela
      if (clients.openWindow) {
        return clients.openWindow('/').then((client) => {
          try {
            client?.postMessage(payload);
          } catch {}
        });
      }
    })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  console.log('Notificação fechada:', event.notification.tag);
});

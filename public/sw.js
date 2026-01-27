// Service Worker para Push Notifications

const CACHE_NAME = 'crm-cache-v5'; // Incrementado para forçar atualização

// Install event
self.addEventListener('install', (event) => {
  console.log('Service Worker instalado - v5');
  
  // Pré-cache dos arquivos essenciais
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Cache aberto, pré-carregando arquivos essenciais');
      return cache.addAll([
        '/',
        '/index.html',
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
  console.log('Service Worker ativado - v5');
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

// Fetch event - estratégia de fallback para navegação SPA
self.addEventListener('fetch', (event) => {
  // Não interceptar requisições de API ou outros recursos
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('/functions/v1/') ||
      event.request.mode !== 'navigate') {
    return; // Deixa o navegador lidar normalmente
  }
  
  // Apenas interceptar requisições de navegação (HTML)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Tenta buscar a requisição original primeiro
          const response = await fetch(event.request);
          return response;
        } catch (error) {
          console.log('Fetch falhou, tentando fallback para index.html:', error);
          
          try {
            // Fallback: tenta buscar index.html diretamente
            const indexResponse = await fetch('/index.html');
            return indexResponse;
          } catch (indexError) {
            console.log('Index.html falhou, tentando cache:', indexError);
            
            // Último recurso: tenta do cache
            const cachedResponse = await caches.match('/index.html');
            if (cachedResponse) {
              console.log('Usando index.html do cache');
              return cachedResponse;
            }
            
            // Se nada funcionar, retorna uma resposta básica
            console.log('Nenhuma opção funcionou, retornando resposta básica');
            return new Response(
              '<html><body><h1>Offline - App Indisponível</h1><p>Verifique sua conexão e recarregue a página.</p></body></html>',
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/html' }
              }
            );
          }
        }
      })()
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

// Script para limpar e re-registrar o Service Worker
// Execute este script no console do navegador para limpar problemas

if ('serviceWorker' in navigator) {
  // 1. Unregister todos os service workers
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    console.log('Found registrations:', registrations.length);
    
    return Promise.all(registrations.map(function(registration) {
      console.log('Unregistering:', registration.scope);
      return registration.unregister();
    }));
  }).then(function() {
    console.log('✅ All service workers unregistered');
    
    // 2. Limpar todos os caches
    return caches.keys().then(function(cacheNames) {
      console.log('Found caches:', cacheNames);
      return Promise.all(
        cacheNames.map(function(cacheName) {
          console.log('Deleting cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    });
  }).then(function() {
    console.log('✅ All caches cleared');
    
    // 3. Recarregar a página
    console.log('🔄 Reloading page...');
    window.location.reload();
  }).catch(function(error) {
    console.error('❌ Error during cleanup:', error);
  });
} else {
  console.log('❌ Service workers not supported');
}

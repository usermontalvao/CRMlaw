/**
 * Recarrega a página quando um chunk do Vite pedido pelo navegador não existe
 * mais no servidor (acontece a cada deploy: o index.html novo tem hashes novos,
 * mas uma aba aberta há horas ainda pede os antigos).
 *
 * Compartilhado pelas DUAS entradas do site — `main.tsx` (CRM/portal) e
 * `atendimento.tsx` (app do WhatsApp) —, que precisam exatamente do mesmo
 * comportamento e não podem divergir com o tempo.
 */
export function installStaleChunkReload(): void {
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String((event.reason as any)?.message || event.reason || '');
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('dynamically imported module') ||
      msg.includes('Unable to preload CSS')
    ) {
      console.warn('[App] Chunk desatualizado — recarregando...');
      const lastReload = Number(sessionStorage.getItem('_chunk_reload_at') || 0);
      if (Date.now() - lastReload > 60_000) {
        sessionStorage.setItem('_chunk_reload_at', String(Date.now()));
        window.location.reload();
      }
    }
  });

  // O service worker avisa quando há versão nova publicada.
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'app-update-available') return;
    const lastReload = Number(sessionStorage.getItem('_sw_reload_at') || 0);
    if (Date.now() - lastReload > 10_000) {
      sessionStorage.setItem('_sw_reload_at', String(Date.now()));
      window.location.reload();
    }
  });
}

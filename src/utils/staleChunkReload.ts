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
    if (ehChunkVelho(msg)) {
      console.warn('[App] Chunk desatualizado — recarregando...');
      recarregarUmaVez('_chunk_reload_at', 60_000);
    }
  });

  // O import que falha DENTRO de um `React.lazy` não chega como promessa
  // rejeitada: o React relança o erro na renderização, e ele sai como `error`
  // solto na janela ("Uncaught TypeError: Failed to fetch dynamically imported
  // module"). Sem esta segunda escuta, o deploy deixava a tela quebrada até o
  // usuário apertar F5 na mão.
  window.addEventListener('error', (event) => {
    const msg = String(event.error?.message || event.message || '');
    if (ehChunkVelho(msg)) {
      console.warn('[App] Chunk desatualizado — recarregando...');
      recarregarUmaVez('_chunk_reload_at', 60_000);
    }
  });

  // O service worker avisa quando há versão nova publicada.
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'app-update-available') return;
    recarregarUmaVez('_sw_reload_at', 10_000);
  });
}

/** A mensagem é de um pedaço do site que não existe mais no servidor? */
function ehChunkVelho(msg: string): boolean {
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    msg.includes('Failed to load module script') ||
    msg.includes('Unable to preload CSS')
  );
}

/** Recarrega no máximo uma vez por minuto, para nunca virar laço. */
function recarregarUmaVez(chave: string, janelaMs: number): void {
  const ultima = Number(sessionStorage.getItem(chave) || 0);
  if (Date.now() - ultima <= janelaMs) return;
  sessionStorage.setItem(chave, String(Date.now()));
  window.location.reload();
}

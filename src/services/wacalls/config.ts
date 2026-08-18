// Configuração de acesso ao WaCalls: onde ele está e como nos identificamos.
//
// PONTO ÚNICO. A URL não aparece em componente nenhum, e o dia em que a API
// deixar de ser aberta (hoje `/api/*` é livre por decisão de infraestrutura)
// basta `authHeaders()` passar a devolver o `Authorization` — nem o serviço nem
// a UI mudam.

/** Base do WaCalls, sem barra no fim. Configurável por `VITE_WACALLS_URL`. */
export const WACALLS_BASE_URL = String(
  import.meta.env.VITE_WACALLS_URL || 'https://call.jurius-api.com',
).replace(/\/+$/, '');

const CLIENT_ID_KEY = 'wacalls.clientId';

/**
 * Identidade desta ABA/navegador para o WaCalls (header `X-Client-Id`).
 *
 * É o que o servidor usa como "dono" da chamada: ele recusa uma segunda
 * chamada para o mesmo dono (409) e é por este id que decidimos se o áudio de
 * uma chamada é nosso ou de outro operador no mesmo número. Persistente por
 * navegador — recarregar a página não faz o operador virar outra pessoa.
 */
export function getWaCallsClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
    const id = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    // Navegador com storage bloqueado: id efêmero, válido enquanto a aba viver.
    return `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

/**
 * Cabeçalhos extras de autenticação. Hoje vazio — a instância está aberta.
 * Quando houver token, ele entra AQUI e em nenhum outro lugar.
 */
export function authHeaders(): Record<string, string> {
  return {};
}

/** Só em desenvolvimento: rastro do ciclo de vida da chamada, sem dado sensível. */
export function waCallsLog(message: string, extra?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (extra === undefined) console.log(`[WaCalls] ${message}`);
  else console.log(`[WaCalls] ${message}`, extra);
}

/**
 * Servidores ICE da ponte ENTRE NAVEGADORES (segundo atendente e
 * transferência) — nada a ver com a ponte para o WaCalls, que é servidor
 * público e dispensa STUN.
 *
 * Duas mesas na mesma rede do escritório se acham por candidato local; quem
 * atende de casa precisa de STUN para descobrir o próprio endereço externo.
 * Sem TURN de propósito: relay de áudio é banda paga, e o caso que ele
 * resolveria (NAT simétrico dos dois lados) é raro numa operação de escritório.
 * `VITE_WEBRTC_ICE_SERVERS` aceita uma lista separada por vírgula.
 */
export const WEBRTC_ICE_SERVERS: RTCIceServer[] = (() => {
  const bruto = String(import.meta.env.VITE_WEBRTC_ICE_SERVERS || '').trim();
  if (bruto) {
    return bruto.split(',').map(u => ({ urls: u.trim() })).filter(s => !!s.urls);
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
})();

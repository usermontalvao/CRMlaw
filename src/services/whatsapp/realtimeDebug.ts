/**
 * O rastro de validação do canal `whatsapp:messages` — ligável em produção sem
 * deploy e desligado por padrão.
 *
 * Os logs de CICLO DE VIDA do canal (AUTH_READY, CHANNEL_CREATED, SUBSCRIBED,
 * CHANNEL_ERROR, CLEANED_UP) são poucos e sempre saem: acontecem uma vez por
 * sessão e são a primeira coisa que se pede a quem relata "a inbox parou". O que
 * este módulo controla é o rastro POR EVENTO — esse sai a cada mensagem, e ligado
 * o tempo todo viraria um console rolando durante o expediente.
 *
 * Ligar/desligar no console da própria produção, sem publicar nada:
 *
 *   localStorage.setItem('jurius:realtime-debug', '1'); location.reload();
 *   localStorage.removeItem('jurius:realtime-debug');   location.reload();
 *
 * O que pode ser logado está fechado por construção em `LinhaDeEvento`: operação,
 * identificadores e o `refresh`. Conteúdo de mensagem, telefone, nome de cliente,
 * transcrição, mídia e token NÃO passam por aqui — o console de um atendente é
 * lido por quem estiver ao lado dele, e o print vai para o grupo do escritório.
 */

const CHAVE = 'jurius:realtime-debug';

/**
 * Lido uma vez só. Ler o localStorage a cada mensagem custaria um acesso síncrono
 * ao disco dentro do caminho de entrega — e um interruptor que muda no meio do
 * teste torna o próprio teste difícil de ler.
 */
const ligado: boolean = (() => {
  try {
    if (import.meta.env.DEV) return true;
    return window.localStorage.getItem(CHAVE) === '1';
  } catch {
    // localStorage bloqueado (aba anônima com cookies de terceiros barrados).
    return false;
  }
})();

export function rastroLigado(): boolean {
  return ligado;
}

/** Exatamente os campos que podem ir ao console. Nada de `content` aqui. */
export interface LinhaDeEvento {
  op: string;
  id: string;
  conversation_id: string | null;
  refresh: boolean;
}

/**
 * `[marca] EVENT_RECEIVED op=INSERT id=… conversation_id=… refresh=true ts=…`
 *
 * `marca` diz por qual caminho o fato chegou — com o broadcast como fonte única,
 * é o que responde, olhando o console, se o canal está mesmo entregando ou se a
 * tela só está andando pela reposição por HTTP.
 */
export function registrarEventoRecebido(marca: string, linha: LinhaDeEvento | null): void {
  if (!ligado || !linha) return;
  console.info(
    `${marca} EVENT_RECEIVED op=${linha.op} id=${linha.id}` +
      ` conversation_id=${linha.conversation_id ?? '-'}` +
      ` refresh=${linha.refresh} ts=${new Date().toISOString()}`,
  );
}

/** Marcos sem payload: MERGE_IN_PLACE, RELOAD_EXECUTED, RELOAD_SKIPPED. */
export function registrarMarco(marca: string, marco: string, detalhe = ''): void {
  if (!ligado) return;
  console.info(`${marca} ${marco}${detalhe ? ` ${detalhe}` : ''}`.trim());
}

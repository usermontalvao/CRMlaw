// FALAR COM O CLIENTE É DENTRO DO CRM — não é mais um link para fora.
//
// Todo botão verde do sistema (ficha do cliente, lista, lead, requerimento,
// assinatura, agenda, busca global, nuvem) mandava para `https://wa.me/...`:
// abria o WhatsApp Web numa aba nova, com a conversa acontecendo num lugar que
// o escritório não vê. O que se perdia a cada clique era tudo o que o módulo
// existe para dar — a thread na inbox, o vínculo com o cadastro, o histórico,
// o SLA, a fila, o rodízio, quem respondeu e quando.
//
// Aqui o mesmo clique passa a abrir (ou reabrir) a conversa no widget
// flutuante, sem trocar a tela em que a pessoa está: quem clicou de dentro da
// ficha do cliente continua na ficha. O widget embute o módulo de verdade, e é
// nele que a mensagem é escrita e enviada.
//
// O wa.me continua existindo como PLANO B, e por dois motivos honestos:
//
//   • quem não tem acesso ao módulo do WhatsApp (permissão) não pode abrir uma
//     thread na inbox — para essa pessoa o link de fora é o que sempre foi;
//   • sem nenhum canal conectado não há por onde mandar nada; abrir uma thread
//     que não envia só produz conversa morta.
//
// A pergunta "dá para abrir aqui dentro?" é respondida de forma SÍNCRONA
// (`canOpenWhatsAppChat`), e isso não é detalhe: os botões são âncoras de
// verdade, e só cancelam a navegação quando o widget vai assumir. Decidir isso
// depois de um `await` faria o navegador tratar o `window.open` do plano B como
// pop-up e bloquear — o clique morreria sem nada acontecer.
//
// Quem responde ao pedido é o `WhatsAppChatOpener`, montado uma vez no App.
import { events, SYSTEM_EVENTS } from './events';
import { buildWhatsappUrl } from './whatsapp';

export interface WhatsAppChatRequest {
  /** Telefone do contato, com ou sem máscara. */
  phone: string;
  /** Cadastro a vincular na conversa (quando o clique parte de um cliente). */
  clientId?: string | null;
  /** Nome de exibição para a thread nova. */
  contactName?: string | null;
  /** Texto que já entra escrito no compositor (modelos, convites de assinatura). */
  text?: string;
}

export interface WhatsAppChatPayload extends WhatsAppChatRequest {
  /** URL do wa.me equivalente — o plano B, caso a abertura interna falhe. */
  fallbackUrl: string;
}

// Publicado pelo `WhatsAppChatOpener`: só é `true` quando ele existe na tela,
// a pessoa tem acesso ao módulo e há canal conectado para falar.
let ready = false;

/** O opener avisa aqui quando pode (ou deixou de poder) assumir os cliques. */
export function setWhatsAppChatReady(value: boolean): void {
  ready = value;
}

/** Resposta síncrona: este clique abre no widget ou vai para o wa.me? */
export function canOpenWhatsAppChat(): boolean {
  return ready;
}

/**
 * Pede a conversa com este número.
 *
 * Devolve `true` quando o widget assumiu — o chamador cancela a navegação da
 * âncora. Devolve `false` quando não há como abrir por dentro; aí o link
 * externo segue seu caminho normal, sem `preventDefault`.
 */
export function openWhatsAppChat(request: WhatsAppChatRequest): boolean {
  const fallbackUrl = buildWhatsappUrl(request.phone, request.text);
  if (!fallbackUrl) return false;
  if (!canOpenWhatsAppChat()) return false;
  events.emit(SYSTEM_EVENTS.WHATSAPP_OPEN_CHAT, { ...request, fallbackUrl } as WhatsAppChatPayload);
  return true;
}

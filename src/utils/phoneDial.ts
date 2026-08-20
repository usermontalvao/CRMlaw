// LIGAR TAMBÉM É DENTRO DO CRM — o `tel:` é o plano B.
//
// Irmão do `whatsappChat.ts`, e pelo mesmo motivo: cada `href="tel:..."`
// espalhado pelo sistema (ficha do cliente, agenda, painel do atendimento)
// entrega a ligação ao aparelho de quem clicou. A chamada acontece fora, e
// some — não entra no histórico, não aparece na ficha, não é gravada, e o
// número que aparece no celular de quem recebe é o do atendente, não o do
// escritório.
//
// Aqui o mesmo clique abre o DISCADOR já com o número escrito. Ele não liga
// sozinho de propósito: a pessoa confere o número, escolhe a linha e aperta o
// verde — a mesma porta de todas as outras ligações (`placeCall` →
// `resolveCallablePhone`), com as mesmas travas.
//
// O `tel:` continua no `href` como PLANO B, para quem não tem permissão de
// discar (aí o discador nem existe na tela) e para o botão direito copiar.
//
// A resposta é SÍNCRONA (`canOpenDialer`) pelo mesmo motivo do WhatsApp:
// decidir depois de um `await` faria o navegador tratar a navegação do plano B
// como pop-up. Quem responde é a própria janela do discador, que se anuncia ao
// montar — e ela só é montada quando a permissão diz que sim (ver
// `WaCallsHost`).
import { dialerStore } from '../services/wacalls/dialerStore';

export interface DialRequest {
  /** Telefone do destino, com ou sem máscara. */
  phone: string;
  /** Quem é — a barra minimizada do discador mostra o nome, não só o número. */
  label?: string | null;
}

// Publicado pela `DialerWindow`: só é `true` enquanto ela está na tela.
let ready = false;

/** A janela do discador avisa aqui quando entra (e quando sai) da tela. */
export function setDialerReady(value: boolean): void {
  ready = value;
}

/** Resposta síncrona: este clique abre o discador ou vai para o `tel:`? */
export function canOpenDialer(): boolean {
  return ready;
}

/**
 * Pede o discador com este número já escrito.
 *
 * Devolve `true` quando o discador assumiu — o chamador cancela a navegação da
 * âncora. Devolve `false` quando não há discador para assumir; aí o `tel:`
 * segue seu caminho normal, sem `preventDefault`.
 */
export function openDialer(request: DialRequest): boolean {
  const phone = String(request.phone || '').trim();
  if (!phone) return false;
  if (!canOpenDialer()) return false;
  dialerStore.open({ phone, label: request.label ?? null });
  return true;
}

// O que a LINHA DA INBOX diz sobre a assinatura que está sendo acompanhada.
//
// Por que existe: o topo da conversa já anunciava "Cliente assinou" numa faixa
// verde de ponta a ponta, mas quem está olhando a fila não tem nenhuma conversa
// aberta — e o aviso mais esperado do escritório só aparecia para quem já
// estivesse dentro da conversa certa. Aqui a mesma notícia entra na primeira
// coluna, ao lado das outras etiquetas da linha.
//
// PURO DE PROPÓSITO: recebe o status de acompanhamento (o mesmo
// `ClientTrackedSignatureStatus` que alimenta o cabeçalho) e devolve o que
// desenhar. Sem React e sem DOM — dá para testar "assinou" sem montar a inbox.

/** Subconjunto do status de acompanhamento que o chip precisa. */
export interface SignatureChipInput {
  kind:
    | 'fill_sent' | 'fill_opened' | 'fill_live'
    | 'signature_pending' | 'signature_viewed' | 'signature_live'
    | 'signature_signed' | 'signature_refused';
  /** Frase completa vinda do serviço (pode trazer "visto por último…"). */
  label: string;
}

export interface SignatureListChip {
  /** Curto por obrigação: divide a fileira com etapa, docs e relógio. */
  label: string;
  /** A frase inteira, para o `title` do chip. */
  title: string;
  /** Classes de fundo/texto, no mesmo tom do cabeçalho e da faixa do topo. */
  cls: string;
  /** Qual ícone desenhar. A linha não importa quais componentes existem. */
  icon: 'signed' | 'refused' | 'live' | 'seen';
}

/**
 * O QUE NÃO ENTRA NA LISTA.
 *
 * `fill_sent` ("Link enviado") e `signature_pending` ("Aguardando assinatura")
 * não são notícia: eles descrevem o que NÓS fizemos, não o que o cliente fez, e
 * acenderiam um chip em toda linha com um documento em aberto — a fileira
 * inteira pintada com o que já se sabia. A lista só fala quando a outra ponta
 * mexe: abriu, está na tela agora, saiu sem assinar, assinou ou recusou.
 */
const CHIPS: Record<SignatureChipInput['kind'], Omit<SignatureListChip, 'title'> | null> = {
  signature_signed:  { label: 'Assinado',        cls: 'bg-[#e7f5ec] text-[#137333]', icon: 'signed' },
  signature_refused: { label: 'Recusou',         cls: 'bg-[#fce8e6] text-[#c5221f]', icon: 'refused' },
  signature_live:    { label: 'Assinando agora', cls: 'bg-[#e3f2fd] text-[#0b57d0]', icon: 'live' },
  fill_live:         { label: 'Preenchendo',     cls: 'bg-[#f3e8fd] text-[#7c3aed]', icon: 'live' },
  signature_viewed:  { label: 'Saiu sem assinar', cls: 'bg-[#fdf1e0] text-[#a15c07]', icon: 'seen' },
  fill_opened:       { label: 'Abriu o kit',     cls: 'bg-[#e3f2fd] text-[#0b57d0]', icon: 'seen' },
  signature_pending: null,
  fill_sent:         null,
};

/** Frase do `title` quando o serviço não mandou nada de mais específico. */
const TITULOS: Record<SignatureChipInput['kind'], string> = {
  signature_signed:  'O cliente assinou o documento',
  signature_refused: 'O cliente recusou a assinatura',
  signature_live:    'O cliente está na página de assinatura agora',
  fill_live:         'O cliente está preenchendo o kit agora',
  signature_viewed:  'O cliente abriu a assinatura e saiu sem assinar',
  fill_opened:       'O cliente abriu a página do kit',
  signature_pending: '',
  fill_sent:         '',
};

export function signatureListChip(tracked: SignatureChipInput | null | undefined): SignatureListChip | null {
  if (!tracked) return null;
  const base = CHIPS[tracked.kind];
  if (!base) return null;
  // O rótulo do serviço é a frase longa ("Saiu sem assinar — visto por último
  // hoje às 14:32"): ela não cabe na linha, mas é exatamente o que se quer ler
  // ao parar o mouse em cima.
  const detalhe = tracked.label && tracked.label !== base.label ? tracked.label : TITULOS[tracked.kind];
  return { ...base, title: detalhe || TITULOS[tracked.kind] || base.label };
}

/**
 * O ESTADO DA COBRANÇA DE UMA ASSINATURA PENDENTE — lido, não adivinhado.
 *
 * O CRM manda lembretes de assinatura sozinho: a Edge Function
 * `whatsapp-signature-followup` roda de 2 em 2 horas e cobra quem abriu o
 * documento e saiu sem assinar. Ela funciona. O problema é que ela é MUDA: a
 * tela nunca disse que cobrou, e — pior — nunca disse quando parou de cobrar.
 *
 * E ela para calada com facilidade. Basta a conversa de WhatsApp do cliente
 * estar encerrada para o `.neq('status','closed')` não achar conversa nenhuma
 * e o lembrete seguinte simplesmente não sair. Foi o que aconteceu com a única
 * pendência viva do escritório: dezesseis aberturas do documento, dois
 * lembretes enviados, e o terceiro que nunca sairia sem ninguém saber.
 *
 * Este arquivo responde, para uma pendência, a pergunta que a tela precisa
 * fazer: *ela está sendo cobrada? Se não, por quê? Se sim, quando é a próxima?*
 *
 * ⚠️ CÓPIA DUPLA — as constantes abaixo são as MESMAS de
 * `supabase/functions/whatsapp-signature-followup/index.ts`. Elas moram nos dois
 * lados porque o navegador não importa código de Edge Function. Mudou lá, muda
 * aqui: `cobrancaDeAssinatura.test.ts` compara os dois valores e falha se
 * andarem separados.
 *
 * Sem imports de propósito: `npm test` roda por ts-node e quebra com import
 * relativo sem extensão em qualquer ponto da cadeia.
 */

/** Espera entre um lembrete e o próximo, em horas. Índice = lembretes já enviados. */
export const ESPERA_ENTRE_LEMBRETES_EM_HORAS = [4, 24, 24 * 3, 24 * 7, 24 * 14];

/** Quantos lembretes o robô manda antes de desistir. */
export const TOTAL_DE_LEMBRETES = ESPERA_ENTRE_LEMBRETES_EM_HORAS.length;

/** Idade máxima de uma solicitação para ainda ser cobrada. */
export const IDADE_MAXIMA_EM_DIAS = 30;

export type MotivoDaCobranca =
  /** Está na fila: o próximo lembrete tem hora marcada. */
  | 'ativa'
  /** O cliente pediu para parar, ou alguém encerrou o acompanhamento. */
  | 'encerrada'
  /** A assinatura está com a validação pública bloqueada. */
  | 'bloqueada'
  /** Sem cliente vinculado — o robô não tem por onde falar. */
  | 'sem_cliente'
  /** O cliente tem cadastro, mas nenhuma conversa aberta no WhatsApp. */
  | 'sem_conversa'
  /** Criada há mais de 30 dias: fora da janela do robô. */
  | 'antiga'
  /** Os cinco lembretes já foram enviados. */
  | 'limite';

export interface DadosDaCobranca {
  criadaEm: string;
  lembretesEnviados: number;
  ultimoLembreteEm?: string | null;
  /** Quando o signatário saiu da página pública pela última vez. */
  ultimaPresencaEm?: string | null;
  /** Quando o signatário abriu a página pela primeira vez. */
  primeiraAberturaEm?: string | null;
  temCliente: boolean;
  /**
   * Se o cliente tem conversa aberta no WhatsApp. `null` quando não deu para
   * saber (a consulta falhou) — e aí a tela não acusa nada, porque acusar
   * errado é pior do que não acusar.
   */
  temConversaAberta: boolean | null;
  acompanhamentoEncerrado: boolean;
  bloqueada: boolean;
}

export interface EstadoDaCobranca {
  motivo: MotivoDaCobranca;
  /** `true` quando nenhum lembrete vai sair enquanto nada mudar. */
  parada: boolean;
  /** Hora do próximo lembrete, quando ele existe. */
  proximoLembreteEm: string | null;
  lembretesEnviados: number;
  totalDeLembretes: number;
  /**
   * `false` quando não deu para conferir se o cliente tem conversa aberta.
   * A cobrança segue tratada como ativa — não se acusa o que não se sabe —,
   * mas a tela não promete hora para o próximo lembrete, porque ele pode
   * simplesmente não sair.
   */
  confirmada: boolean;
}

const HORA_EM_MS = 60 * 60 * 1000;

const paraMs = (valor?: string | null): number | null => {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * A âncora do tempo é a mesma da Edge Function: conta a partir do último
 * lembrete; se nunca houve, do momento em que o cliente saiu da página; se ele
 * nunca abriu, da criação.
 */
const acharAncora = (dados: DadosDaCobranca): number | null =>
  paraMs(dados.ultimoLembreteEm)
  ?? paraMs(dados.ultimaPresencaEm)
  ?? paraMs(dados.primeiraAberturaEm)
  ?? paraMs(dados.criadaEm);

export function lerEstadoDaCobranca(dados: DadosDaCobranca, agora: Date = new Date()): EstadoDaCobranca {
  const enviados = Math.max(0, Number(dados.lembretesEnviados) || 0);
  const base = {
    lembretesEnviados: enviados,
    totalDeLembretes: TOTAL_DE_LEMBRETES,
    proximoLembreteEm: null as string | null,
    confirmada: dados.temConversaAberta !== null,
  };

  const parada = (motivo: MotivoDaCobranca): EstadoDaCobranca => ({ ...base, motivo, parada: true });

  // A ordem importa: é a que a Edge Function usa para desistir, e é também a
  // ordem em que a pessoa consegue resolver — vincular cliente antes de reabrir
  // conversa, reabrir conversa antes de reclamar do prazo.
  if (dados.acompanhamentoEncerrado) return parada('encerrada');
  if (dados.bloqueada) return parada('bloqueada');
  if (!dados.temCliente) return parada('sem_cliente');
  if (enviados >= TOTAL_DE_LEMBRETES) return parada('limite');

  const criadaMs = paraMs(dados.criadaEm);
  if (criadaMs !== null && agora.getTime() - criadaMs > IDADE_MAXIMA_EM_DIAS * 24 * HORA_EM_MS) {
    return parada('antiga');
  }

  // `false` é uma resposta ("não há conversa aberta"); `null` é a falta de uma,
  // e nesse caso não se acusa nada.
  if (dados.temConversaAberta === false) return parada('sem_conversa');

  const ancora = acharAncora(dados);
  const proximo = ancora === null
    ? null
    : new Date(ancora + ESPERA_ENTRE_LEMBRETES_EM_HORAS[enviados] * HORA_EM_MS).toISOString();

  return {
    ...base,
    motivo: 'ativa',
    parada: false,
    // Sem saber da conversa, a hora seria um palpite apresentado como promessa.
    proximoLembreteEm: base.confirmada ? proximo : null,
  };
}

/** O motivo em uma linha, do jeito que se diz para uma pessoa. */
export function descreverParada(motivo: MotivoDaCobranca): string {
  switch (motivo) {
    case 'encerrada': return 'acompanhamento encerrado';
    case 'bloqueada': return 'documento bloqueado';
    case 'sem_cliente': return 'sem cliente vinculado';
    case 'sem_conversa': return 'conversa encerrada no WhatsApp';
    case 'antiga': return 'enviada há mais de 30 dias';
    case 'limite': return 'os 5 lembretes já foram enviados';
    default: return '';
  }
}

/** O que a pessoa faz para destravar. Vazio quando não há conserto óbvio. */
export function comoDestravar(motivo: MotivoDaCobranca): string {
  switch (motivo) {
    case 'sem_cliente': return 'Vincular um cliente religa a cobrança.';
    case 'sem_conversa': return 'Cobrar pelo WhatsApp reabre a conversa e a cadência volta.';
    case 'antiga': return 'Reenviar o documento recomeça a contagem.';
    case 'limite': return 'A partir daqui a cobrança é manual.';
    default: return '';
  }
}

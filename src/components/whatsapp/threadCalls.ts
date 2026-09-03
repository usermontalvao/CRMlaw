// A ligação como uma linha da CONVERSA — do jeito que o WhatsApp escreve.
//
// A ficha do cliente já tinha o registro das chamadas (aba "Chamadas"), mas
// quem atende não vive na ficha: vive na thread. E é lá que a ligação faz
// falta, porque ela é parte da MESMA conversa. Sem isso, a leitura do
// atendimento tinha um buraco no meio — "mandei os documentos" … silêncio de
// duas horas … "então ficou combinado assim" — e o que aconteceu no silêncio
// (uma ligação de 6 minutos) não estava em lugar nenhum daquela tela.
//
// AS PALAVRAS SÃO AS DO WHATSAPP, de propósito. Quem trabalha na inbox tem o
// aplicativo aberto no celular ao lado; usar outro vocabulário para os mesmos
// seis desfechos obrigaria a traduzir mentalmente a cada linha. Três coisas
// mudam de nome porque no CRM elas significam outra coisa:
//   · quem recusou. No celular a recusa é sempre sua; aqui a chamada de saída
//     pode ter sido recusada PELO CONTATO, e isso muda o que o atendente faz em
//     seguida (não insistir agora). As duas recusas são ditas com todas as letras.
//   · "falhou" existe. É o desfecho de erro do WaCalls, e ele não é a mesma
//     coisa que "não atenderam" — um pede tentar de novo, o outro pede esperar.
//   · TODA frase diz o meio: "de voz" ou "de vídeo", nos SEIS desfechos. O
//     celular economiza isso nas não atendidas ("Sem resposta", "Chamada
//     recusada") porque lá o ícone ao lado já mostra a câmera. Aqui a linha da
//     inbox é lida de relance, sem ícone de meio e às vezes sem abrir a
//     conversa — e "Sem resposta" sozinho não diz se a pessoa perdeu uma
//     ligação ou uma chamada de vídeo, que pedem retornos diferentes.
//
// PURO DE PROPÓSITO: nenhum import (ver o cabeçalho de `attendanceRouting.ts`).

export type ThreadCallDirection = 'inbound' | 'outbound';
export type ThreadCallOutcome = 'answered' | 'missed' | 'declined' | 'failed';

export interface ThreadCallInput {
  direction: ThreadCallDirection;
  outcome: ThreadCallOutcome;
  /** Segundos de conversa. Só faz sentido em chamada atendida. */
  durationSeconds?: number | null;
  /**
   * Foi chamada de VÍDEO. O nome do campo é o da coluna do registro
   * (`is_video`) de propósito: a linha da ficha e a da conversa passam o
   * registro inteiro para cá, e um nome diferente exigiria traduzir nos dois
   * lugares — que é como uma delas ficaria para trás.
   */
  isVideo?: boolean | null;
}

/** Qual seta desenhar. `missed` é a seta quebrada, em vermelho. */
export type ThreadCallIcon = 'incoming' | 'outgoing' | 'missed';

/**
 * A COR da linha — e três cores, não duas, porque três coisas diferentes
 * acontecem e a tela estava dizendo todas do mesmo jeito.
 *
 *  · `perdida`  — vermelho. Alguém procurou o escritório e não foi atendido, ou
 *    a chamada falhou. É dívida: enquanto ninguém retornar, aquilo está aberto.
 *  · `sem-resposta` — VERDE. Nós ligamos e o contato não estava lá. Não é falha
 *    de ninguém e não é pendência do cliente; é a nossa tentativa registrada,
 *    esperando a próxima. Verde porque é a nossa cor na conversa — o mesmo
 *    verde das mensagens que enviamos — e porque pintar de vermelho a ligação
 *    que NÓS fizemos transformaria a inbox inteira num painel de alarme.
 *  · `atendida` — neutro. A conversa aconteceu; o que interessa dela é o
 *    conteúdo (duração, quem falou, a gravação), não o desfecho.
 */
export type ThreadCallTone = 'perdida' | 'sem-resposta' | 'atendida';

export interface ThreadCallLabel {
  /** A frase da linha: "Chamada de voz perdida", "Sem resposta"… */
  title: string;
  icon: ThreadCallIcon;
  /** A cor da linha. Ver `ThreadCallTone`. */
  tone: ThreadCallTone;
  /** `true` pinta a linha de vermelho — algo ficou pendente de retorno. */
  attention: boolean;
  /** "6 min 12 s" quando houve conversa; `null` quando não houve. */
  duration: string | null;
}

/**
 * "6 min 12 s" / "42 s" / "1 h 3 min" — duração para ler, não para calcular.
 *
 * Passa de hora com mais frequência do que parece: audiência por vídeo e
 * perícia acompanhada ficam na linha o tempo todo, e "78 min" é pior de ler.
 */
export function formatCallDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total === 0) return '';
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;
  if (horas > 0) return minutos > 0 ? `${horas} h ${minutos} min` : `${horas} h`;
  if (minutos === 0) return `${resto} s`;
  return resto === 0 ? `${minutos} min` : `${minutos} min ${resto} s`;
}

/** A linha da chamada, pronta para desenhar. */
export function threadCallLabel(call: ThreadCallInput): ThreadCallLabel {
  const recebida = call.direction === 'inbound';
  const atendida = call.outcome === 'answered';
  const duration = atendida ? (formatCallDuration(call.durationSeconds) || null) : null;
  // "de voz" / "de vídeo" — a mesma distinção que o WhatsApp faz na conversa.
  // Sem ela, a ligação em que as duas pessoas se viram ficava registrada como
  // uma chamada de voz, e quem lesse a thread depois não teria como saber.
  const meio = call.isVideo ? 'de vídeo' : 'de voz';

  if (atendida) {
    return {
      title: recebida ? `Chamada ${meio} recebida` : `Chamada ${meio}`,
      icon: recebida ? 'incoming' : 'outgoing',
      tone: 'atendida',
      attention: false,
      duration,
    };
  }

  if (call.outcome === 'declined') {
    return {
      // Quem recusou é a informação: recusa nossa é decisão do escritório;
      // recusa do contato é "ele viu e não quis atender agora".
      title: recebida ? `Chamada ${meio} recusada` : `Chamada ${meio} recusada pelo contato`,
      icon: recebida ? 'missed' : 'outgoing',
      tone: recebida ? 'perdida' : 'sem-resposta',
      attention: recebida,
      duration: null,
    };
  }

  if (call.outcome === 'failed') {
    // Falha é vermelha nos dois sentidos: não houve tentativa de conversa, houve
    // um defeito — e ele pede uma ação (tentar de novo agora), não uma espera.
    return { title: `A chamada ${meio} falhou`, icon: 'missed', tone: 'perdida', attention: true, duration: null };
  }

  // missed. A assimetria é real: uma chamada RECEBIDA que ninguém atendeu é
  // dívida do escritório (aparece em vermelho, como no celular); uma de saída
  // que o contato não atendeu é só "não estava lá".
  return {
    title: recebida ? `Chamada ${meio} perdida` : `Chamada ${meio} sem resposta`,
    icon: recebida ? 'missed' : 'outgoing',
    tone: recebida ? 'perdida' : 'sem-resposta',
    attention: recebida,
    duration: null,
  };
}

// ── A mesma ligação, agora na LISTA de conversas ────────────────
//
// A linha da inbox é a única leitura que a maioria das conversas recebe no dia
// — ninguém abre 300 threads, todo mundo corre o olho pela coluna da esquerda.
// E ali a ligação não existia: uma chamada de 6 minutos às 4h numa conversa
// cujo último texto é das 3h deixava a lista contando a história errada,
// justamente na tela onde se decide o que abrir.
//
// A conversa guarda as duas últimas coisas SEPARADAS, de propósito: a última
// mensagem (`last_message_*`, que é o relógio do SLA, do encerramento
// automático e da 1ª resposta) e a última chamada (`last_call_*`, que não pode
// mexer em nada disso — ver a migration `20260819060000`). Nenhuma das duas
// sozinha é "a última coisa que aconteceu"; juntá-las é o que estas funções
// fazem.
//
// POR QUE AQUI, e não num módulo só delas: a frase da chamada tem de ser a
// MESMA da thread, e ela nasce em `threadCallLabel`, logo acima. Um módulo
// separado teria de importar este — e import relativo na cadeia quebra o
// `npm test` deste projeto (ver a memória sobre ts-node), o que na prática
// significaria uma segunda redação das mesmas seis frases, envelhecendo
// sozinha. Prévia e thread erradas uma em relação à outra é pior do que este
// arquivo ter dois assuntos vizinhos.

/**
 * Tira o `*Nome:*` que o compositor cola na primeira linha do envio manual.
 *
 * CÓPIA DELIBERADA de `stripAgentSignature` (waRichText). Este arquivo é
 * importado por um teste e não tem import nenhum de propósito — import
 * relativo sem extensão na cadeia derruba o `npm test` deste projeto. A regra
 * é uma linha; o teste ao lado confronta as duas redações caso a caso.
 */
function semAssinaturaDoAgente(texto: string): string {
  return texto.replace(/^\*[^*\n]+:\*\n/, '');
}

export interface ConversationPreviewInput {
  /** Prévia congelada da última mensagem (a coluna `last_message_preview`). */
  messagePreview: string | null | undefined;
  messageAt: string | null | undefined;
  messageDirection: 'in' | 'out' | null | undefined;
  callAt: string | null | undefined;
  /** 'inbound' | 'outbound', cru do registro de chamadas. */
  callDirection: string | null | undefined;
  /** 'answered' | 'missed' | 'declined' | 'failed', cru do registro. */
  callOutcome: string | null | undefined;
  callDurationSeconds: number | null | undefined;
  /** A última chamada foi de vídeo. */
  callIsVideo?: boolean | null;
}

export interface ConversationPreviewLine {
  kind: 'message' | 'call' | 'empty';
  /** "Você: " nas mensagens que saíram daqui. A chamada não usa: a frase dela já diz o sentido. */
  prefix: string;
  text: string;
  /** Quando aconteceu — é esta a hora que a linha mostra e por onde ela ordena. */
  at: string | null;
  /** Chamada recebida perdida ou recusada: ficou pendente de retorno. */
  attention: boolean;
}

const PREVIA_VAZIA: ConversationPreviewLine = {
  kind: 'empty', prefix: '', text: '', at: null, attention: false,
};

/** O que a linha da lista diz: a última mensagem OU a última chamada. */
export function conversationPreview(input: ConversationPreviewInput): ConversationPreviewLine {
  const msgAt = input.messageAt || null;
  // Chamada sem sentido conhecido é registro pela metade: não vira linha.
  const temChamada = !!input.callAt
    && (input.callDirection === 'inbound' || input.callDirection === 'outbound');
  const callAt = temChamada ? (input.callAt as string) : null;

  // Empate no mesmo instante fica com a chamada: é o evento que a pessoa
  // acabou de viver.
  if (callAt && (!msgAt || callAt >= msgAt)) {
    // Desfecho desconhecido cai em "perdida", nunca em "atendida": dizer que
    // atenderam quando ninguém sabe é a mentira que apaga uma pendência.
    const outcome: ThreadCallOutcome =
      input.callOutcome === 'answered' || input.callOutcome === 'declined'
        || input.callOutcome === 'failed' ? input.callOutcome : 'missed';
    const label = threadCallLabel({
      direction: input.callDirection === 'inbound' ? 'inbound' : 'outbound',
      outcome,
      durationSeconds: input.callDurationSeconds ?? null,
      isVideo: input.callIsVideo ?? false,
    });
    return {
      kind: 'call',
      prefix: '',
      // "Chamada de voz · 4 s" diz numa linha só que atenderam e por quanto tempo.
      text: label.duration ? `📞 ${label.title} · ${label.duration}` : `📞 ${label.title}`,
      at: callAt,
      attention: label.attention,
    };
  }

  // A ASSINATURA DO ATENDENTE NÃO ENTRA NA PRÉVIA.
  //
  // O compositor cola `*Dr. Pedro:*\n` na frente de todo envio manual, e a
  // coluna `last_message_preview` é escrita no banco a partir do `content` CRU
  // (ver `wa_message_preview`). A bolha sempre escondeu essa linha; a lista,
  // não — e o resultado era a linha dizendo "Você: Pedro Montalvão: ok",
  // atribuindo a mesma frase duas vezes e gastando meia largura da prévia com
  // o nome de quem já está escrito ali ao lado. Em muitas inboxes TODA linha
  // enviada tinha esse prefixo, então a prévia dizia sempre a mesma coisa.
  //
  // Só no que SAIU daqui: um cliente que escreva "*Fulano:*" na primeira linha
  // está escrevendo isso mesmo, e apagá-lo seria mentir sobre a mensagem dele.
  const bruta = (input.messagePreview || '').trim();
  const texto = input.messageDirection === 'out' ? semAssinaturaDoAgente(bruta) : bruta;
  if (!msgAt && !texto) return PREVIA_VAZIA;

  return {
    kind: 'message',
    prefix: input.messageDirection === 'out' ? 'Você: ' : '',
    text: texto,
    at: msgAt,
    attention: false,
  };
}

/**
 * O instante da última atividade — mensagem OU chamada.
 *
 * É por ele que a fila se ordena: a ligação que você acabou de fazer sobe a
 * conversa para o topo, como no WhatsApp. Fica separado da prévia porque a
 * ordenação roda para a lista inteira a cada tecla digitada no compositor, e
 * comparar duas datas não precisa montar frase nenhuma.
 */
export function conversationActivityAt(
  c: { last_message_at?: string | null; last_call_at?: string | null; created_at?: string | null },
): string {
  const msg = c.last_message_at || '';
  const call = c.last_call_at || '';
  const maior = msg > call ? msg : call;
  return maior || c.created_at || '';
}

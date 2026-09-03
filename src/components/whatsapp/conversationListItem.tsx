import React, { useEffect, useState } from 'react';
import {
  Clock, Pencil, Ban, BellOff, AlertTriangle, Users, Timer, FileText, CheckCircle2, ArrowRightLeft,
  Check, X, PenLine, Eye, Pin,
} from 'lucide-react';
import type {
  WhatsAppConversation, WhatsAppChannel, WhatsAppDepartment, WhatsAppPresence,
} from '../../types/whatsapp.types';
import type { FunnelLabel } from '../../services/settings.service';
import {
  formatTime, prettyPhone, conversationName, presenceInfo, maskName, maskPhoneFull,
  slaSignal,
} from './format';
import { autoCloseClock, autoCloseIdleLabel } from './autoCloseClock';
import type { ElapsedMinutes } from './businessTime';
import type { SlaPolicyFor } from './slaPolicy';
import { waPlainText } from './waRichText';
import { inferFunnelStage } from './funnel';
import { conversationPreview } from './threadCalls';
import { Avatar } from './avatar';
import { WA_SWEEP_META, type WaSweepKind } from './conversationSweep';
import type { SignatureListChip } from './signatureChip';

/**
 * Linha de presença do cabeçalho (online/digitando/visto por último). Possui o
 * próprio tick de 15s para reavaliar o tempo relativo — assim o relógio vive
 * neste componente isolado em vez de re-renderizar o módulo inteiro a cada 15s.
 */
export const PresenceText: React.FC<{
  conv: { presence: WhatsAppPresence; presence_updated_at: string | null; last_seen_at: string | null; contact_phone: string };
  privateMode: boolean;
}> = React.memo(({ conv, privateMode }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick(t => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const pr = presenceInfo(conv);
  if (!pr) return <span>{privateMode ? maskPhoneFull() : prettyPhone(conv.contact_phone)}</span>;
  if (!pr.live) return <span className="text-slate-500">{pr.text}</span>;
  // "digitando…/gravando…" ganha os três pontinhos animados; "online" mantém o
  // ponto verde fixo.
  const isTyping = pr.text !== 'online';
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-green-600">
      {isTyping
        ? <span className="wa-typing" aria-hidden="true"><span /><span /><span /></span>
        : <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
      {pr.text}
    </span>
  );
});
PresenceText.displayName = 'PresenceText';

/**
 * Etiqueta do dia, grudada no topo enquanto aquele dia passa.
 *
 * Precisa estar dentro de UMA SEÇÃO POR DIA (ver `diasDaThread` em useWaThread):
 * `position: sticky` só é empurrado pelo fim do próprio pai, então vários
 * divisores soltos no mesmo contêiner param todos na mesma altura e se
 * sobrepõem, com um rótulo tapando o outro pela metade.
 *
 * Sem `backdrop-blur`: desfoque de fundo em elemento grudento obriga o navegador
 * a recompor a área a cada quadro da rolagem, e numa conversa longa são vários
 * deles ao mesmo tempo. Fundo sólido dá o mesmo resultado a olho nu e devolve a
 * rolagem para o compositor da GPU.
 */
export const DateDivider: React.FC<{ label: string }> = ({ label }) => (
  <div className="sticky top-2 z-[2] flex justify-center my-3 pointer-events-none">
    <span className="wa-date-chip px-3 py-1.5 rounded-lg bg-[#f2f5f6] text-[#54656f] text-[10.5px] font-medium uppercase tracking-[0.03em] shadow-sm ring-1 ring-black/[0.03]">{label}</span>
  </div>
);

/**
 * Divisor de CANAL da thread. O histórico do escritório funde numa conversa só a
 * mesma pessoa que escreveu para números diferentes (Comercial, Atendimento…);
 * sem uma marca, uma resposta enviada pelo Comercial e outra pelo Atendimento
 * ficam lado a lado sem dizer por onde saíram. Este divisor abre cada trecho de
 * um canal, com a bolinha de cor do próprio canal — a mesma do seletor no
 * cabeçalho —, para o leitor saber de qual número partiu aquele pedaço.
 *
 * Ao contrário do `DateDivider`, NÃO é grudento: dois divisores grudentos
 * disputariam o topo e se sobreporiam. Ele marca o ponto da troca e rola junto.
 */
export const ChannelDivider: React.FC<{ name: string; color: string }> = ({ name, color }) => (
  <div className="flex items-center gap-2 my-3">
    <span className="flex-1 h-px bg-black/[0.06]" />
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white text-[#54656f] text-[10.5px] font-semibold shadow-sm ring-1 ring-black/[0.04]">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      {name}
    </span>
    <span className="flex-1 h-px bg-black/[0.06]" />
  </div>
);

/**
 * UMA forma para todas as etiquetas da linha.
 *
 * Antes cada uma tinha o seu tamanho, o seu raio e o seu peso — 9,5px em negrito
 * aqui, 9,5px em semibold ali, `rounded` numa e fundo cheio na outra —, e três
 * delas lado a lado pareciam três sistemas diferentes empilhados na mesma linha.
 * Altura fixa é o que faz a fileira ficar reta quando quebra em duas linhas.
 */
const CHIP = 'inline-flex items-center gap-1 h-[18px] px-1.5 rounded-md text-[10px] font-semibold leading-none';

// Item da lista de conversas (memoizado). Os sinais de SLA/transferência/abandono
// são funções puras de `c` (mais a medição de tempo, que chega estável do
// módulo), então o item os calcula sozinho; só `status`/`docStatus` (que
// dependem de estado do módulo) chegam prontos como primitivos. Com props
// estáveis, o React.memo só re-renderiza a linha cuja conversa de fato mudou —
// não a lista inteira a cada evento de realtime.
export const ConversationListItem: React.FC<{
  c: WhatsAppConversation;
  active: boolean;
  channel: WhatsAppChannel | null;
  dept: WhatsAppDepartment | null;
  privateMode: boolean;
  statusKey: string;
  statusLabel: string;
  statusCls: string;
  docStatus: 'awaiting' | 'ready' | null;
  muted: boolean;
  /** Fixada no topo por este usuário. */
  pinned?: boolean;
  draftPreview: string;
  funnelLabels: FunnelLabel[];
  /**
   * A IA está com esta conversa, e quando ela volta a falar.
   *
   * Quando existe, TROCA os sinais humanos da linha (status operacional, SLA,
   * "na fila", abandono) por uma etiqueta só. Não é economia de espaço: com o
   * agente respondendo, "Aguardando setor" e "na fila há 2h07" são informação
   * errada, e mandam o atendente procurar um problema que não existe.
   */
  aiChip?: { label: string; title: string } | null;
  /**
   * Medição de tempo dos badges de SLA. Ausente = relógio de parede; com a
   * medição em horário útil do módulo, a espera fora do expediente não conta.
   * Precisa ter identidade estável para o React.memo continuar valendo.
   */
  elapsedMinutes?: ElapsedMinutes;
  /** Patamares do canal desta conversa. Ausente = padrão (15/60). */
  slaPolicyFor?: SlaPolicyFor;
  /**
   * Envios desta conversa que falharam e continuam esperando uma decisão
   * (tentar de novo ou descartar). Vem da fila otimista do compositor, que
   * sobrevive à troca de conversa — sem este aviso na lista, uma mensagem que
   * não saiu ficaria escondida dentro de uma thread que ninguém vai reabrir.
   */
  failedSends?: number;
  /**
   * Encerrada trazida do arquivo pela busca. Some a cor da linha: ela está ali
   * porque foi procurada, não porque é trabalho de hoje.
   */
  archived?: boolean;
  /**
   * Escrever o nome do canal na linha. Ligado só quando o escritório tem mais de
   * um número: com um só, o nome seria a mesma palavra em todas as linhas.
   */
  showChannelName?: boolean;
  /** Outro atendente está com esta conversa aberta agora. */
  busy?: boolean;
  /**
   * A conversa acabou de sair da fila: a faixa de varredura passa por cima da
   * linha dizendo o que aconteceu (ver `conversationSweep`). Enquanto vale, a
   * linha não recebe clique — ela já não é mais trabalho de ninguém.
   */
  sweep?: WaSweepKind | null;
  /**
   * O que o CLIENTE fez com o documento que mandamos para assinar — assinou,
   * recusou, está na página agora. Vem pronto de `signatureListChip`; a linha só
   * desenha. Sem isto, "Cliente assinou" só existia dentro da conversa aberta,
   * e quem varre a fila não abre conversa nenhuma.
   */
  signatureChip?: SignatureListChip | null;
  onSelect: (id: string) => void;
  onDismissTracking?: () => void;
}> = React.memo(({ c, active, channel: ch, dept, privateMode, statusKey, statusLabel, statusCls, docStatus: ds, muted, pinned = false, draftPreview, funnelLabels, aiChip = null, elapsedMinutes, slaPolicyFor, failedSends = 0, archived = false, showChannelName = false, busy = false, sweep = null, signatureChip = null, onSelect, onDismissTracking }) => {
  // Com a IA conduzindo, os sinais de espera humana saem de cena — inclusive o
  // relógio vermelho do canto, que contava uma demora que não está havendo.
  const sla = aiChip ? null : slaSignal(c, elapsedMinutes, slaPolicyFor);
  const stage = inferFunnelStage(c.labels, funnelLabels);
  /**
   * A ETAPA INICIAL NÃO É NOTÍCIA.
   *
   * Toda conversa nasce em "Novo" (ou no que o canal definir como etapa
   * inicial), e a lista mostrava esse chip em TODAS as linhas: uma etiqueta
   * repetida do topo ao fim da inbox, que não distingue nada de nada — só
   * ocupa a fileira e empurra as etiquetas que importam para a segunda linha.
   * A etapa só aparece depois que alguém a MOVE.
   */
  const etapaVisivel = stage && stage.stageKey !== (ch?.funnel_initial_stage || 'novo') ? stage : null;
  /**
   * O que aconteceu por último NESTA conversa — e a hora em que aconteceu.
   *
   * Não é o mesmo que a última mensagem: a ligação também é a conversa (ver
   * `conversationPreview`). Sem isto, uma chamada de 6 minutos deixava a linha
   * repetindo o texto de horas antes, com a hora antiga no canto.
   */
  const previa = React.useMemo(() => conversationPreview({
    messagePreview: c.last_message_preview,
    messageAt: c.last_message_at,
    messageDirection: c.last_message_direction,
    callAt: c.last_call_at,
    callDirection: c.last_call_direction,
    callOutcome: c.last_call_outcome,
    callDurationSeconds: c.last_call_duration_seconds,
    callIsVideo: c.last_call_is_video,
  }), [c.last_message_preview, c.last_message_at, c.last_message_direction,
    c.last_call_at, c.last_call_direction, c.last_call_outcome, c.last_call_duration_seconds,
    c.last_call_is_video]);
  /**
   * Aviso de encerramento iminente.
   *
   * Mede com `Date.now()` na renderização, como os demais relógios da linha: a
   * lista é `React.memo` e receber o instante por prop faria toda linha
   * re-renderizar a cada minuto só para nada mudar em 99% delas. A conversa que
   * está mesmo perto de encerrar tem sempre algo mexendo por perto (mensagem,
   * seleção, contagem de não lidas) — e o painel da conversa aberta tem o
   * contador que anda sozinho.
   *
   * Com a IA conduzindo, some junto com os outros sinais humanos.
   */
  const autoClose = React.useMemo(() => {
    if (aiChip) return null;
    const info = autoCloseClock(c, ch, Date.now());
    if (info.key !== 'counting' && info.key !== 'due') return null;
    // TODA conversa que está contando mostra o contador, e não só a que está
    // prestes a encerrar: acompanhar é ver o prazo andar. O que separa uma da
    // outra é a cor — cinza enquanto sobra tempo, âmbar na última hora.
    return {
      label: info.label,
      urgent: info.urgent,
      title: `Sem nenhuma mensagem há ${autoCloseIdleLabel(info.idleMinutes)}.`,
    };
  }, [c, ch, aiChip]);
  /** Não lida pesa mais: nome em negrito, prévia mais escura, hora em âmbar. */
  const naoLida = !c.is_blocked && c.unread_count > 0;
  /**
   * O SLA deixou de ser TARJA na borda da linha.
   *
   * Numa inbox real quase toda conversa tem alguma espera, e o resultado era
   * uma coluna listrada de vermelho e âmbar de cima a baixo — o alarme ligado
   * o tempo todo, que é o mesmo que alarme nenhum, e a única cor forte da tela
   * gasta no que é rotina. A espera continua escrita, na fileira de etiquetas,
   * com a mesma forma das outras: relógio, cor e o tempo por extenso. A barra
   * da esquerda passou a significar UMA coisa só — a conversa aberta.
   */
  return (
    <button onClick={() => onSelect(c.id)}
      // Identifica a linha para o teclado da inbox trazê-la ao campo de visão.
      data-conv-id={c.id}
      className={`wa-conv w-[calc(100%-12px)] mx-1.5 rounded-xl flex items-start gap-3 pl-3 pr-2.5 py-2.5 text-left transition-colors duration-150 ${active ? 'wa-conv-active bg-[#fff3e6]' : 'hover:bg-[#f5f4f1]'} ${c.is_blocked ? 'opacity-60' : ''} ${archived ? 'wa-conv-archived' : ''} ${sweep === 'closed' ? 'wa-conv-saindo' : ''} ${sweep === 'transferred' ? 'wa-conv-transferindo' : ''}`}>
      {/* A faixa só existe no meio segundo em que passa: a inbox de um
          escritório grande tem centenas de linhas, e nenhuma delas precisa
          carregar este elemento à toa. */}
      {sweep && (
        <span className="wa-conv-varredura" style={{ background: WA_SWEEP_META[sweep].bg }} aria-hidden="true">
          <span style={{ color: WA_SWEEP_META[sweep].fg }}>
            {sweep === 'closed' ? <CheckCircle2 size={16} /> : <ArrowRightLeft size={16} />}
            {WA_SWEEP_META[sweep].label}
          </span>
        </span>
      )}
      <div className="relative flex-shrink-0 mt-0.5">
        <Avatar url={c.contact_avatar_url} name={conversationName(c)} phone={c.contact_phone} size={40} />
        {/* Com UM canal só, a bolinha era a mesma cor em todas as linhas: um
            ponto laranja por conversa, sem nada a distinguir. */}
        {ch && showChannelName && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ background: ch.color || '#ea6c00' }} title={ch.name || ch.instance_name} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[13.5px] truncate flex items-center gap-1 tracking-[-0.006em] ${naoLida ? 'font-bold text-[#16181c]' : 'font-semibold text-[#1f2328]'}`}>
            {c.is_blocked && <Ban size={12} className="text-red-500 flex-shrink-0" />}
            <span className="truncate">{privateMode ? maskName(conversationName(c)) : conversationName(c)}</span>
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            {/* Alguém já está nesta conversa. Saber ANTES de abrir é o que evita
                a colisão — depois de aberta, os dois já leram e já pensaram na
                resposta. */}
            {busy && (
              <span title="Outro atendente está nesta conversa agora"
                className="wa-busy-dot flex-shrink-0 inline-flex items-center justify-center">
                <Users size={11} className="text-amber-600" />
              </span>
            )}
            {/* A marca de fixada fica JUNTO DA HORA, e não antes do nome: o
                nome é o que o olho varre para achar a pessoa, e um ícone à
                frente dele desalinharia todas as linhas por causa de duas. */}
            {pinned && <Pin size={11} className="text-slate-400 flex-shrink-0" aria-label="Fixada no topo" />}
            {muted && <BellOff size={11} className="text-slate-400 flex-shrink-0" />}
            <span className={`text-[11px] tabular-nums ${naoLida ? 'font-semibold text-[#b45309]' : 'text-[#9aa0a6]'}`}>{formatTime(previa.at)}</span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          {draftPreview ? (
            <span className="flex items-center gap-1 min-w-0 text-[12px] truncate">
              <Pencil size={11} className="flex-shrink-0 text-amber-600" />
              <span className="flex-shrink-0 font-semibold text-amber-600">Rascunho:</span>
              <span className="truncate text-slate-500">{privateMode ? '••••••••' : draftPreview}</span>
            </span>
          ) : (
            <span className={`text-[12.5px] truncate ${previa.attention ? 'text-[#c5221f] font-semibold' : naoLida ? 'text-[#3c4043] font-medium' : 'text-[#5f6368]'}`}>
              {/* Prévia de uma linha: as marcas do WhatsApp saem do caminho.
                  A chamada não passa por `waPlainText` — a frase é nossa, não
                  tem asterisco de negrito para limpar. O modo privado esconde o
                  TEXTO da mensagem, mas não a chamada: "chamada perdida" não
                  revela nada de ninguém, e escondê-la tiraria da tela o único
                  aviso de que alguém ficou sem retorno. */}
              {previa.prefix}
              {previa.kind === 'call'
                ? previa.text
                : (privateMode ? '••••••••' : (waPlainText(previa.text) || '—'))}
            </span>
          )}
          {!c.is_blocked && c.unread_count > 0 && (
            <span className="wa-badge-pop wa-badge-glow flex-shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#f27a23] text-white text-[10px] font-bold tabular-nums flex items-center justify-center">{c.unread_count}</span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1.5 flex-wrap empty:mt-0">
          {/* Primeiro da fileira depois do erro de envio: é o relógio da
              pessoa que está esperando. */}
          {sla && (
            <span
              className={CHIP}
              style={{ background: `${sla.color}14`, color: sla.color }}
              title={`Esperando resposta: ${sla.label.replace('parada há ', '')} (contado em horário útil)`}
            >
              {/* Só o tempo: "parada há" é a mesma palavra em toda linha que
                  tem o chip, e a fileira precisa caber numa linha só. A frase
                  inteira continua na dica do mouse. */}
              <Clock size={10} />{sla.label.replace('parada há ', '')}
            </span>
          )}
          {/* Primeiro de todos os badges, e o único em vermelho cheio: uma
              mensagem que não saiu é a coisa mais urgente que esta linha pode
              ter a dizer. */}
          {failedSends > 0 && (
            <span className={`${CHIP} bg-[#d93025] text-white`}
              title="Toque na conversa para tentar de novo ou descartar">
              <AlertTriangle size={10} />
              {failedSends === 1 ? 'Não enviada' : `${failedSends} não enviadas`}
            </span>
          )}
          {/* O CLIENTE MEXEU NO DOCUMENTO. Vem logo depois do erro de envio e
              antes da etapa: "Cliente assinou" é a notícia que o escritório
              mais espera, e ela vivia só na faixa do topo da conversa aberta.
              O X encerra o acompanhamento daqui mesmo — a mesma ação da faixa,
              sem precisar entrar na conversa. */}
          {signatureChip && (
            <span className={`${CHIP} ${signatureChip.cls}`} title={signatureChip.title}>
              {signatureChip.icon === 'signed' ? <Check size={10} strokeWidth={3} />
                : signatureChip.icon === 'refused' ? <X size={10} strokeWidth={3} />
                : signatureChip.icon === 'live' ? <PenLine size={10} />
                : <Eye size={10} />}
              {signatureChip.label}
              {/* A linha inteira já é um <button>, e botão dentro de botão é HTML
                  inválido (o React reclama e o navegador desmonta a árvore do
                  seu jeito). Um span com papel de botão mantém o clique, o foco
                  e o teclado sem aninhar nada. */}
              {onDismissTracking && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onDismissTracking(); }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    // preventDefault: sem ele, o Espaço rola a lista e o Enter
                    // dispara o clique da linha logo atrás.
                    e.preventDefault();
                    e.stopPropagation();
                    onDismissTracking();
                  }}
                  title="Parar de acompanhar esta assinatura"
                  aria-label="Parar de acompanhar esta assinatura"
                  className="inline-flex items-center justify-center h-3 w-3 cursor-pointer rounded-full bg-white/60 transition hover:bg-slate-700 hover:text-white"
                >
                  <X size={8} strokeWidth={2.75} />
                </span>
              )}
            </span>
          )}
          {/* ETAPA do funil — onde o atendimento está no processo. Anda por
              arrasto no quadro, pela etiqueta ou por automação, e é sempre uma
              decisão de gente. O ponto colorido é a marca da etapa: é o que a
              distingue, a olho nu, do chip de documentos ao lado. */}
          {etapaVisivel && (
            <span
              className={CHIP}
              style={{ background: `${etapaVisivel.color}16`, color: etapaVisivel.color }}
              title={`Etapa do funil: ${etapaVisivel.stageLabel}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: etapaVisivel.color }} />
              {etapaVisivel.stageLabel}
            </span>
          )}
          {/* ESTADO da solicitação de documentos — fato, lido de
              `document_requests`, não posição no funil.
              Voltou para a lista porque sem ele a linha só tinha a etapa, e uma
              etapa chamada "Aguardando documentos" continuava dizendo isso
              DEPOIS de os arquivos chegarem: o resumo lá em cima anunciava
              "Documentos prontos" e a lista, a mesma conversa, "Aguardando
              docs". Os dois convivem, cada um com o seu desenho — ícone de
              arquivo aqui, ponto de etapa ali — e o texto nunca repete o da
              etapa. */}
          {ds && (
            <span
              className={`${CHIP} ${
                ds === 'awaiting' ? 'bg-[#fdf1e0] text-[#a15c07]' : 'bg-[#e7f5ec] text-[#137333]'
              }`}
              title={ds === 'awaiting'
                ? 'Há solicitação de documentos pendente para este cliente'
                : 'Os documentos solicitados já chegaram — a etapa do funil continua onde estava'}
            >
              <FileText size={10} /> {ds === 'awaiting' ? 'Docs pendentes' : 'Docs prontos'}
            </span>
          )}
          {/* Quanto falta para esta conversa encerrar sozinha. Fica na lista
              porque acompanhar o prazo é olhar a fila inteira, não uma conversa
              de cada vez — e sem ele o encerramento automático só se descobre
              depois de acontecer. Âmbar na última hora, quando ainda dá tempo
              de responder ou de tirar a conversa da regra. */}
          {autoClose && (
            <span
              className={`${CHIP} ${
                autoClose.urgent ? 'bg-[#fdf1e0] text-[#a15c07]' : 'bg-[#f1f0ec] text-[#5f6368]'
              }`}
              title={autoClose.title}
            >
              <Timer size={10} />
              {autoClose.label}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
ConversationListItem.displayName = 'ConversationListItem';

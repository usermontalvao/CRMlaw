import React, { useEffect, useState } from 'react';
import {
  Clock, Pencil, Ban, BellOff, AlertTriangle, Users, Timer, FileText,
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
import { waPlainText } from './waRichText';
import { inferFunnelStage } from './funnel';
import { Avatar } from './avatar';

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
    <span className="px-3 py-1.5 rounded-lg bg-[#f2f5f6] text-[#54656f] text-[10.5px] font-medium uppercase tracking-[0.03em] shadow-sm ring-1 ring-black/[0.03]">{label}</span>
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
  onSelect: (id: string) => void;
  onDismissTracking?: () => void;
}> = React.memo(({ c, active, channel: ch, dept, privateMode, statusKey, statusLabel, statusCls, docStatus: ds, muted, draftPreview, funnelLabels, aiChip = null, elapsedMinutes, failedSends = 0, archived = false, showChannelName = false, busy = false, onSelect, onDismissTracking }) => {
  // Com a IA conduzindo, os sinais de espera humana saem de cena — inclusive o
  // relógio vermelho do canto, que contava uma demora que não está havendo.
  const sla = aiChip ? null : slaSignal(c, elapsedMinutes);
  const stage = inferFunnelStage(c.labels, funnelLabels);
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
  const urgentBorder = sla?.color === '#dc2626' ? 'border-l-[3px] border-l-red-400'
    : sla?.color === '#d97706' ? 'border-l-[3px] border-l-amber-400'
    : '';
  return (
    <button onClick={() => onSelect(c.id)}
      // Identifica a linha para o teclado da inbox trazê-la ao campo de visão.
      data-conv-id={c.id}
      className={`wa-conv w-full flex items-center gap-3 px-4 py-3 text-left border-b border-[#f1f0ec] transition ${urgentBorder} ${active ? 'wa-conv-active bg-amber-50' : 'hover:bg-[#f9f8f6]'} ${c.is_blocked ? 'opacity-60' : ''} ${archived ? 'wa-conv-archived' : ''}`}>
      <div className="relative flex-shrink-0">
        <Avatar url={c.contact_avatar_url} name={conversationName(c)} phone={c.contact_phone} size={40} />
        {ch && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ background: ch.color || '#ea6c00' }} title={ch.name || ch.instance_name} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-semibold text-slate-800 truncate flex items-center gap-1">
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
            {muted && <BellOff size={11} className="text-slate-400 flex-shrink-0" />}
            {sla
              ? <span className="inline-flex items-center gap-0.5 text-[9.5px] font-bold" style={{ color: sla.color }}>
                  <Clock size={9} />{sla.label}
                </span>
              : <span className="text-[10.5px] text-slate-400">{formatTime(c.last_message_at)}</span>}
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
            <span className="text-[12px] text-slate-500 truncate">
              {/* Prévia de uma linha: as marcas do WhatsApp saem do caminho. */}
              {c.last_message_direction === 'out' ? 'Você: ' : ''}
              {privateMode ? '••••••••' : (waPlainText(c.last_message_preview || '') || '—')}
            </span>
          )}
          {!c.is_blocked && c.unread_count > 0 && (
            <span className="wa-badge-pop wa-badge-glow flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-600 text-white text-[10px] font-bold flex items-center justify-center">{c.unread_count}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {/* Primeiro de todos os badges, e o único em vermelho cheio: uma
              mensagem que não saiu é a coisa mais urgente que esta linha pode
              ter a dizer. */}
          {failedSends > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-red-600 text-white"
              title="Toque na conversa para tentar de novo ou descartar">
              <AlertTriangle size={9} />
              {failedSends === 1 ? 'Não enviada' : `${failedSends} não enviadas`}
            </span>
          )}
          {/* ETAPA do funil — onde o atendimento está no processo. Anda por
              arrasto no quadro, pela etiqueta ou por automação, e é sempre uma
              decisão de gente. O ponto colorido é a marca da etapa: é o que a
              distingue, a olho nu, do chip de documentos ao lado. */}
          {stage && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold"
              style={{ background: `${stage.color}22`, color: stage.color }}
              title={`Etapa do funil: ${stage.stageLabel}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: stage.color }} />
              {stage.stageLabel}
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
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold ${
                ds === 'awaiting' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
              }`}
              title={ds === 'awaiting'
                ? 'Há solicitação de documentos pendente para este cliente'
                : 'Os documentos solicitados já chegaram — a etapa do funil continua onde estava'}
            >
              <FileText size={9} /> {ds === 'awaiting' ? 'Docs pendentes' : 'Docs prontos'}
            </span>
          )}
          {/* Quanto falta para esta conversa encerrar sozinha. Fica na lista
              porque acompanhar o prazo é olhar a fila inteira, não uma conversa
              de cada vez — e sem ele o encerramento automático só se descobre
              depois de acontecer. Âmbar na última hora, quando ainda dá tempo
              de responder ou de tirar a conversa da regra. */}
          {autoClose && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-semibold ${
                autoClose.urgent ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
              }`}
              title={autoClose.title}
            >
              <Timer size={9} />
              {autoClose.label}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
ConversationListItem.displayName = 'ConversationListItem';

import React, { useEffect, useState } from 'react';
import { Bot, ChevronRight, ClipboardList, Loader2, LockKeyhole, Undo2 } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppAiConversationState } from '../../types/whatsapp.types';
import { canShowPrivateAiHandoffSummary } from '../../utils/waAiHandoffSummary';

interface Options {
  conversationId: string;
  currentUserId: string | null;
  assignedUserId: string | null;
  /** Injetável apenas nas bancadas visuais; produção usa o serviço real. */
  loadState?: (conversationId: string) => Promise<WhatsAppAiConversationState | null>;
  /** Idem: a devolução de verdade solta a conversa e religa o agente. */
  resumeAi?: (conversationId: string) => Promise<void>;
  /**
   * Devolver à IA é a MESMA operação do botão "Retomar IA" da faixa do topo.
   * Sem este aviso, a faixa continuaria dizendo "Atendimento humano" depois de
   * a conversa já ter voltado para o agente.
   */
  onChanged?: () => void;
}

export interface AiHandoffSummary {
  /** Falso quando não há nada a mostrar — os dois componentes somem juntos. */
  visible: boolean;
  summary: string;
  pendingItems: string[];
  podeDevolver: boolean;
  resuming: boolean;
  devolver: () => Promise<void>;
}

/**
 * Resumo que a IA entrega ao responsável humano.
 *
 * A checagem acontece antes da consulta: outro atendente não baixa nem monta o
 * conteúdo. Em transferência para setor, ele aparece depois do aceite, quando
 * quem aceitou passa a ser o responsável nominal da conversa.
 *
 * Uma leitura só, dois lugares: o cartão da coluna lateral (onde o texto
 * inteiro cabe) e a faixa fina da thread (que apenas avisa que ele existe).
 * Por isso o estado mora aqui, num hook, e não dentro de cada componente.
 */
export const useAiHandoffSummary = ({
  conversationId, currentUserId, assignedUserId,
  loadState = whatsappService.getAiConversationState,
  resumeAi = whatsappService.resumeAiForConversation,
  onChanged,
}: Options): AiHandoffSummary => {
  const toast = useToastContext();
  const [state, setState] = useState<WhatsAppAiConversationState | null>(null);
  const [resuming, setResuming] = useState(false);

  const isRecipient = !!currentUserId && assignedUserId === currentUserId;

  useEffect(() => {
    let active = true;
    setState(null);
    if (!isRecipient || !conversationId) return () => { active = false; };

    loadState(conversationId)
      .then(value => { if (active) setState(value); })
      .catch(() => { if (active) setState(null); });
    return () => { active = false; };
  }, [conversationId, isRecipient, loadState]);

  const liberado = isRecipient && !!state && canShowPrivateAiHandoffSummary({
    currentUserId, assignedUserId, status: state.status,
  });

  const summary = liberado ? (state!.handoffSummary || state!.summary || '').trim() : '';
  // Devolver só faz sentido se existe agente e o canal ainda usa IA — senão o
  // botão prometeria uma coisa que não acontece.
  const podeDevolver = liberado && !!state!.assistantId && state!.channelAiEnabled;

  const devolver = async () => {
    setResuming(true);
    try {
      await resumeAi(conversationId);
      // Some na hora: com a IA ativa o handoff não tem mais razão de existir, e
      // a conversa deixa de ser minha na mesma operação.
      setState(prev => (prev ? { ...prev, aiActive: true, status: 'active' } : prev));
      toast.success('Atendimento devolvido à IA',
        'A conversa voltou para a fila e o agente continua de onde parou.');
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResuming(false);
    }
  };

  return {
    visible: liberado && (!!summary || podeDevolver),
    summary,
    pendingItems: liberado ? state!.pendingItems : [],
    podeDevolver,
    resuming,
    devolver,
  };
};

/**
 * O resumo por extenso, na coluna lateral.
 *
 * Ele já morou em cima da thread, numa faixa larga: com o roteiro de triagem
 * cheio de fatos, essa faixa passou a tomar meia tela e a empurrar as mensagens
 * para fora da vista. Aqui o texto corre numa coluna estreita, sem competir com
 * a conversa, e o botão de devolver à IA vem junto — quem lê o resumo é quem
 * decide se assume ou devolve.
 */
export const AiHandoffSummaryCard: React.FC<{ data: AiHandoffSummary }> = ({ data }) => {
  const [expandido, setExpandido] = useState(false);
  const { summary, pendingItems, podeDevolver, resuming, devolver } = data;

  if (!data.visible) return null;

  // Resumo longo é regra, não exceção: mostra o começo e deixa o resto a um
  // clique, para o cartão não empurrar o resto do painel para baixo.
  const longo = summary.length > 220;

  return (
    <section className="space-y-1.5" aria-label="Resumo privado da IA">
      <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
        <Bot size={10} className="text-violet-500" />
        {summary ? 'Resumo da IA para você' : 'Atendimento entregue por você'}
      </p>
      <div className="rounded-lg border border-violet-100 bg-violet-50/60 px-2.5 py-2 space-y-1.5">
        {summary ? (
          <p className={`whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-700 ${
            longo && !expandido ? 'line-clamp-5' : ''
          }`}>
            {summary}
          </p>
        ) : (
          <p className="text-[11.5px] text-slate-500">
            A IA está parada nesta conversa enquanto ela tiver dono.
          </p>
        )}

        {longo && (
          <button onClick={() => setExpandido(v => !v)}
            className="text-[10.5px] font-semibold text-violet-600 transition hover:text-violet-800">
            {expandido ? 'ver menos' : 'ver tudo'}
          </button>
        )}

        {pendingItems.length > 0 && (
          <p className="text-[11px] text-amber-700 break-words">
            <strong>Pendente:</strong> {pendingItems.join(' · ')}
          </p>
        )}

        {summary && (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-violet-500">
            <LockKeyhole size={9} /> privado no painel · não vai para o cliente
          </p>
        )}

        {podeDevolver && (
          <button
            onClick={devolver}
            disabled={resuming}
            title="A conversa volta para a fila e o agente reassume a partir daqui"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px] font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 disabled:opacity-50"
          >
            {resuming ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
            Devolver para a IA
          </button>
        )}
      </div>
    </section>
  );
};

/**
 * A faixa fina da thread. Não é o resumo: é o aviso de que ele existe, para
 * quem está com o painel fechado (ou no celular, onde ele é gaveta). Uma linha,
 * na altura em que a antiga faixa começava, levando ao cartão do painel.
 */
export const AiHandoffSummaryStrip: React.FC<{
  data: AiHandoffSummary;
  onOpenPanel: () => void;
}> = ({ data, onOpenPanel }) => {
  if (!data.visible || !data.summary) return null;

  return (
    <button
      onClick={onOpenPanel}
      title="Abrir o resumo da IA no painel da conversa"
      aria-label="Ver o resumo da IA no painel"
      className="flex w-full items-center gap-2 border-b border-violet-200 bg-violet-50/90 px-4 py-1.5 text-left transition hover:bg-violet-100"
    >
      <ClipboardList size={13} className="flex-shrink-0 text-violet-600" />
      <span className="flex-shrink-0 text-[11.5px] font-semibold text-violet-800">Resumo da IA para você</span>
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-violet-600/90">{data.summary}</span>
      <span className="ml-auto flex flex-shrink-0 items-center gap-0.5 text-[10.5px] font-semibold text-violet-600">
        ver no painel <ChevronRight size={11} />
      </span>
    </button>
  );
};

export default AiHandoffSummaryCard;

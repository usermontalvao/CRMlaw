import React, { useEffect, useState } from 'react';
import { Bot, ClipboardList, Loader2, LockKeyhole, Undo2 } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppAiConversationState } from '../../types/whatsapp.types';
import { canShowPrivateAiHandoffSummary } from '../../utils/waAiHandoffSummary';

interface Props {
  conversationId: string;
  currentUserId: string | null;
  assignedUserId: string | null;
  /** Injetável apenas nas bancadas visuais; produção usa o serviço real. */
  loadState?: (conversationId: string) => Promise<WhatsAppAiConversationState | null>;
  /** Idem: a devolução de verdade solta a conversa e religa o agente. */
  resumeAi?: (conversationId: string) => Promise<void>;
}

/**
 * Resumo que a IA entrega ao responsável humano.
 *
 * A checagem acontece antes da consulta: outro atendente não baixa nem monta o
 * conteúdo. Em transferência para setor, ele aparece depois do aceite, quando
 * quem aceitou passa a ser o responsável nominal da conversa.
 *
 * É também o caminho de volta. Quem assume a conversa está exatamente aqui — e
 * até agora a única forma de devolvê-la ao agente era abrir o painel "Memória
 * da IA", recolhido na coluna lateral. O botão fica ao lado do resumo, no
 * mesmo lugar onde o handoff é lido.
 */
export const AiHandoffSummaryBanner: React.FC<Props> = ({
  conversationId, currentUserId, assignedUserId,
  loadState = whatsappService.getAiConversationState,
  resumeAi = whatsappService.resumeAiForConversation,
}) => {
  const toast = useToastContext();
  const [state, setState] = useState<WhatsAppAiConversationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(false);

  const isRecipient = !!currentUserId && assignedUserId === currentUserId;

  useEffect(() => {
    let active = true;
    setState(null);
    if (!isRecipient) return () => { active = false; };

    setLoading(true);
    loadState(conversationId)
      .then(value => { if (active) setState(value); })
      .catch(() => { if (active) setState(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId, isRecipient, loadState]);

  if (!isRecipient) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-2 border-b border-violet-100 bg-violet-50 px-4 py-2 text-[11.5px] text-violet-600">
        <Loader2 size={13} className="animate-spin" /> Preparando o resumo da IA…
      </div>
    );
  }

  if (!state || !canShowPrivateAiHandoffSummary({
    currentUserId, assignedUserId, status: state.status,
  })) return null;

  const summary = (state.handoffSummary || state.summary || '').trim();
  // Devolver só faz sentido se existe agente e o canal ainda usa IA — senão o
  // botão prometeria uma coisa que não acontece.
  const podeDevolver = !!state.assistantId && state.channelAiEnabled;
  if (!summary && !podeDevolver) return null;

  const devolver = async () => {
    setResuming(true);
    try {
      await resumeAi(conversationId);
      // Some na hora: com a IA ativa o banner de handoff não tem mais razão de
      // existir, e a conversa deixa de ser minha na mesma operação.
      setState(prev => (prev ? { ...prev, aiActive: true, status: 'active' } : prev));
      toast.success('Atendimento devolvido à IA',
        'A conversa voltou para a fila e o agente continua de onde parou.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResuming(false);
    }
  };

  return (
    <section className="border-b border-violet-200 bg-violet-50/90 px-4 py-3" aria-label="Resumo privado da IA">
      <div className="mx-auto flex max-w-[1180px] items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
          <ClipboardList size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-violet-900">
              <Bot size={13} /> {summary ? 'Resumo da IA para você' : 'Atendimento entregue por você'}
            </p>
            {summary && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-600">
                <LockKeyhole size={10} /> privado no painel · não vai para o cliente
              </span>
            )}
            {podeDevolver && (
              <button
                onClick={devolver}
                disabled={resuming}
                title="A conversa volta para a fila e o agente reassume a partir daqui"
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 disabled:opacity-50"
              >
                {resuming ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                Devolver para a IA
              </button>
            )}
          </div>
          {summary ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-slate-700">
              {summary}
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-slate-500">
              A IA está parada nesta conversa enquanto ela tiver dono.
            </p>
          )}
          {state.pendingItems.length > 0 && (
            <p className="mt-1.5 text-[11.5px] text-amber-700">
              <strong>Pendente:</strong> {state.pendingItems.join(' · ')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default AiHandoffSummaryBanner;

import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Clock } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import type { WhatsAppAiConversationState } from '../../types/whatsapp.types';
import { describeWaAiFollowupStatus } from '../../utils/waAiFollowupDisplay';

interface Props {
  conversationId: string;
  onAssume: () => void;
  /** Injetável apenas nas bancadas visuais; produção usa o serviço real. */
  loadState?: (conversationId: string) => Promise<WhatsAppAiConversationState | null>;
}

/**
 * A faixa "o agente está com esta conversa", no topo da thread.
 *
 * SUBSTITUI o banner de playbook, que contava "0 turnos · passo 0" — números da
 * tentativa ANTERIOR de assistente (`whatsapp_ai_sessions.turn_count` e
 * `current_step`), que o agente novo nunca escreve. Ficavam eternamente em zero
 * enquanto a IA conduzia o atendimento inteiro, e serviam de prova de que o
 * agente estava parado quando ele não estava.
 *
 * O que importa aqui é outra coisa: se existe uma retomada agendada e para
 * quando. Quem quiser o estado completo (memória, dados coletados, regra da
 * escada) abre o painel "Memória da IA" na coluna lateral — este é o resumo de
 * uma linha, não um segundo painel.
 */
export const AiAgentBanner: React.FC<Props> = ({
  conversationId, onAssume, loadState = whatsappService.getAiConversationState,
}) => {
  const [state, setState] = useState<WhatsAppAiConversationState | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  const load = useCallback(() => {
    let active = true;
    loadState(conversationId)
      .then(value => { if (active) setState(value); })
      .catch(() => { if (active) setState(null); });
    return () => { active = false; };
  }, [conversationId, loadState]);

  useEffect(() => { setState(null); return load(); }, [load]);

  // A conta regressiva anda sozinha; sem isto "em 2h" fica congelado no valor
  // que tinha quando a conversa foi aberta.
  const temPendente = !!state?.pendingFollowup;
  useEffect(() => {
    if (!temPendente) return;
    const id = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [temPendente]);

  // O estado vem do backend e muda sem que o navegador faça nada: o agente
  // agenda a retomada, o cron envia, o turno cria a próxima. Sem releitura, a
  // faixa fica presa no retrato de quando a conversa foi aberta.
  const temAgente = !!state?.assistantId;
  useEffect(() => {
    if (!temAgente) return;
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [temAgente, load]);

  if (!state || !state.assistantId) return null;
  // A faixa é sobre a IA estar CONDUZINDO a conversa. Depois do handoff quem
  // fala é gente, e o lugar dessa informação é o banner de resumo.
  if (!state.aiActive || !state.channelAiEnabled || state.status === 'handed_off') return null;

  const followup = describeWaAiFollowupStatus({
    policy: state.followupPolicy,
    attemptsDone: state.followupAttempts,
    pending: state.pendingFollowup
      ? {
        attempt: state.pendingFollowup.attempt,
        scheduledAt: state.pendingFollowup.scheduled_at,
        kind: state.pendingFollowup.kind,
      }
      : null,
    nowMs: agora,
  });

  return (
    <div className="flex items-center gap-2.5 border-b border-violet-200 bg-violet-50 px-4 py-2">
      <Bot size={15} className="flex-shrink-0 text-violet-600" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-[12.5px] font-bold text-violet-900">
          {state.assistantName || 'Assistente IA'}
        </span>
        {state.mode === 'test' && (
          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            modo teste
          </span>
        )}
        {followup.tone !== 'off' && (
          <span className={`inline-flex items-center gap-1 text-[11.5px] ${
            followup.tone === 'scheduled' ? 'text-violet-700'
              : followup.tone === 'appointment' ? 'text-emerald-700'
                : 'text-amber-700'
          }`}>
            <Clock size={11} className="flex-shrink-0" />
            {followup.tone === 'scheduled'
              ? `${followup.label} · retomada ${followup.attempt} ${followup.when} (${followup.countdown})`
              : followup.tone === 'appointment'
                ? `Contato marcado pelo cliente · ${followup.when} (${followup.countdown})`
                : followup.detail}
          </span>
        )}
      </div>
      <button
        onClick={onAssume}
        className="flex-shrink-0 rounded-md bg-violet-600 px-2.5 py-1 text-[11.5px] font-bold text-white transition hover:bg-violet-700">
        Assumir atendimento
      </button>
    </div>
  );
};

export default AiAgentBanner;

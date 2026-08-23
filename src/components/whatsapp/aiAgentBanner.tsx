import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Bot, Clock, Loader2, Pause, Play, UserCheck, UserRound,
} from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { useSecurityPin } from '../../contexts/SecurityPinContext';
import type { WhatsAppAiConversationState } from '../../types/whatsapp.types';
import { describeWaAiFollowupStatus } from '../../utils/waAiFollowupDisplay';
import { ROTULO_ESTADO_IA, estadoDaIa, type WaIaEstado } from '../../services/whatsapp/waPermissions';
import type { ConfirmFn } from './types';

interface Props {
  conversationId: string;
  /** Responsável nomeado — é o que separa "IA pausada" de "Atendimento humano". */
  assignedUserId: string | null;
  /** Transferência esperando aceite. */
  awaitingAccept: boolean;
  /** Nome de quem está com o atendimento, quando há. */
  responsavelNome?: string | null;
  /** `acoes.controlarIa` — espelho de `wa_ai_require_control`. */
  podeControlar: boolean;
  /** `acoes.assumir`. */
  podeAssumir: boolean;
  onAssume: () => void;
  confirm: ConfirmFn;
  /** Muda quando algo mexeu na IA em outro ponto da tela; força a releitura. */
  versao?: number;
  /** Avisa o módulo de que o estado da IA mudou aqui. */
  onMudou?: () => void;
  /** Injetável apenas nas bancadas visuais; produção usa o serviço real. */
  loadState?: (conversationId: string) => Promise<WhatsAppAiConversationState | null>;
}

/**
 * A faixa de estado da IA, no topo da thread.
 *
 * ── O QUE ELA RESOLVE ──────────────────────────────────────────────────────
 *
 * Antes esta faixa só existia enquanto a IA CONDUZIA a conversa: ela sumia no
 * handoff, e a única pista do que havia acontecido era um chip cinza dentro de
 * um painel recolhido na coluna lateral. Quatro situações diferentes —
 *
 *   · a IA está atendendo;
 *   · alguém pausou a IA e ninguém assumiu (a conversa está parada);
 *   · a última execução do agente falhou;
 *   · uma pessoa está atendendo, ou há transferência esperando aceite
 *
 * — chegavam à tela como "a faixa não está aí". Agora a faixa é o indicador de
 * estado e não desaparece: cada situação tem cor, texto e o botão que cabe nela.
 *
 * A classificação é regra pura e testada (`estadoDaIa`, em `waPermissions.ts`),
 * espelho do que o banco decide.
 *
 * ── O QUE ELA NÃO É ────────────────────────────────────────────────────────
 *
 * Não é configuração. Prompt, modelo, playbook, canais atendidos, limites e
 * follow-up moram em Configurações › WhatsApp › Agentes de IA, e são de
 * administrador. Aqui só há o que se decide durante um atendimento.
 *
 * Também não é o painel de memória: resumo, fatos coletados e a regra da escada
 * continuam na coluna lateral. Esta faixa é uma linha.
 */
const TOM: Record<
  NonNullable<(typeof ROTULO_ESTADO_IA)[WaIaEstado]>['tom'],
  { borda: string; fundo: string; texto: string; icone: string }
> = {
  ativa: { borda: 'border-violet-200', fundo: 'bg-violet-50', texto: 'text-violet-900', icone: 'text-violet-600' },
  falha: { borda: 'border-red-200', fundo: 'bg-red-50', texto: 'text-red-900', icone: 'text-red-600' },
  pausada: { borda: 'border-amber-200', fundo: 'bg-amber-50', texto: 'text-amber-900', icone: 'text-amber-600' },
  humano: { borda: 'border-slate-200', fundo: 'bg-slate-50', texto: 'text-slate-700', icone: 'text-slate-500' },
  pendente: { borda: 'border-sky-200', fundo: 'bg-sky-50', texto: 'text-sky-900', icone: 'text-sky-600' },
};

const ICONE: Record<WaIaEstado, React.ComponentType<{ size?: number; className?: string }>> = {
  'sem-ia': Bot,
  'canal-desligado': Bot,
  'transferencia-pendente': UserCheck,
  'ia-falha': AlertTriangle,
  'ia-ativa': Bot,
  'atendimento-humano': UserRound,
  'ia-pausada': Pause,
};

export const AiAgentBanner: React.FC<Props> = ({
  conversationId, assignedUserId, awaitingAccept, responsavelNome,
  podeControlar, podeAssumir, onAssume, confirm, versao = 0, onMudou,
  loadState = whatsappService.getAiConversationState,
}) => {
  const toast = useToastContext();
  const { ensurePermission } = useSecurityPin();
  const [state, setState] = useState<WhatsAppAiConversationState | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let active = true;
    loadState(conversationId)
      .then(value => { if (active) setState(value); })
      .catch(() => { if (active) setState(null); });
    return () => { active = false; };
  }, [conversationId, loadState]);

  useEffect(() => { setState(null); return load(); }, [load]);
  // Mexeram na IA em outro ponto da tela (o painel lateral limpa a memória e
  // cancela retomada). Sem isto a faixa ficaria contando um agendamento que já
  // não existe.
  useEffect(() => { if (versao > 0) return load(); }, [versao, load]);

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

  const rodar = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      load();
      onMudou?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pausar = () => {
    if (!ensurePermission({ module: 'whatsapp', action: 'edit' })) return;
    void rodar(
      () => whatsappService.stopAiForConversation(conversationId),
      'IA pausada nesta conversa.');
  };

  /**
   * Retomar tem impacto que o atendente não vê pela palavra "retomar": a
   * conversa volta para a fila (a IA não atende conversa com dono) e, se
   * estiver encerrada, reabre. Por isso confirma — é a única das ações
   * operacionais da IA que muda o responsável do atendimento.
   */
  const retomar = async () => {
    if (!ensurePermission({ module: 'whatsapp', action: 'edit' })) return;
    const ok = await confirm({
      title: 'Devolver esta conversa para a IA?',
      message: 'O atendimento sai do nome de quem estiver com ele e a conversa volta para a fila. '
        + 'Se estiver encerrada, ela reabre. A memória do caso é mantida.',
      confirmLabel: 'Devolver para a IA',
    });
    if (!ok) return;
    await rodar(
      () => whatsappService.resumeAiForConversation(conversationId),
      'IA reativada nesta conversa.');
  };

  // Canal sem agente nenhum: a faixa não existe. Nada de espaço ocupado por uma
  // funcionalidade que este canal não usa.
  if (!state || !state.assistantId) return null;

  const estado = estadoDaIa({
    temAgente: true,
    canalLigado: state.channelAiEnabled,
    iaAtiva: state.aiActive,
    ultimaExecucaoFalhou: state.lastExecution?.status === 'error',
    temResponsavel: !!assignedUserId,
    aguardandoAceite: awaitingAccept,
  });

  const rotulo = ROTULO_ESTADO_IA[estado];
  if (!rotulo) return null;
  const cor = TOM[rotulo.tom];
  const Icone = ICONE[estado];

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

  // O detalhe da segunda linha muda com o estado: enquanto a IA atende, o que
  // importa é a retomada agendada; quando ela parou, o que importa é por quê.
  const detalhe = estado === 'ia-ativa' || estado === 'ia-falha'
    ? (state.lastExecution?.status === 'error' ? state.lastExecution.error : null)
    : state.handoffReason;

  const botao = 'flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 '
    + 'text-[11.5px] font-bold transition disabled:opacity-50';

  return (
    <div className={`flex items-center gap-2.5 border-b px-4 py-2 ${cor.borda} ${cor.fundo}`}>
      <Icone size={15} className={`flex-shrink-0 ${cor.icone}`} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={`text-[12.5px] font-bold ${cor.texto}`}>{rotulo.label}</span>

        <span className="text-[11.5px] text-slate-500">
          {estado === 'atendimento-humano' && responsavelNome
            ? `com ${responsavelNome}`
            : state.assistantName || 'Assistente IA'}
        </span>

        {state.mode === 'test' && estado === 'ia-ativa' && (
          <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            modo teste
          </span>
        )}

        {estado === 'ia-ativa' && followup.tone !== 'off' && (
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

        {detalhe && (
          <span className="min-w-0 truncate text-[11.5px] text-slate-500" title={detalhe}>
            · {detalhe}
          </span>
        )}
      </div>

      {/* Os botões seguem a permissão, não o estado da tela: quem não pode
          controlar a IA neste atendimento simplesmente não os vê. A trava
          continua sendo do banco (`wa_ai_require_control`) — esconder aqui é
          para o atendente não clicar num botão que só responde 403. */}
      {podeControlar && (estado === 'ia-ativa' || estado === 'ia-falha') && (
        <button onClick={pausar} disabled={busy} className={`${botao} border border-amber-300 bg-white text-amber-700 hover:bg-amber-100`}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Pause size={11} />} Pausar IA
        </button>
      )}

      {podeControlar && state.channelAiEnabled
        && (estado === 'ia-pausada' || estado === 'atendimento-humano') && (
        <button onClick={retomar} disabled={busy} className={`${botao} border border-violet-300 bg-white text-violet-700 hover:bg-violet-100`}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Retomar IA
        </button>
      )}

      {podeAssumir && estado !== 'atendimento-humano' && (
        <button onClick={onAssume} className={`${botao} bg-violet-600 text-white hover:bg-violet-700`}>
          <UserCheck size={11} /> Assumir atendimento
        </button>
      )}
    </div>
  );
};

export default AiAgentBanner;

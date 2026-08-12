/**
 * Painel "Memória da IA" na coluna lateral da conversa.
 *
 * Discreto de propósito: só aparece quando existe agente no canal, e recolhido.
 * Serve para o operador ver o que a IA entendeu do caso, se ela está ativa, e
 * poder interromper ou limpar a memória sem sair da conversa.
 *
 * Não é dashboard: mostra o ÚLTIMO estado, não uma série histórica.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot, BrainCircuit, ChevronDown, ChevronRight, Clock, Loader2, Pause, Play, Trash2,
} from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppAiConversationState } from '../../types/whatsapp.types';
import { canShowPrivateAiHandoffSummary } from '../../utils/waAiHandoffSummary';
import {
  describeWaAiFollowupSchedule,
  describeWaAiFollowupStatus,
  describeWaAiFollowupWindow,
} from '../../utils/waAiFollowupDisplay';
import type { ConfirmFn } from './types';

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
};

export const AiMemoryPanel: React.FC<{
  conversationId: string;
  currentUserId: string | null;
  assignedUserId: string | null;
  confirm: ConfirmFn;
  /** Injetável apenas nas bancadas visuais; produção usa o serviço real. */
  loadState?: (conversationId: string) => Promise<WhatsAppAiConversationState | null>;
}> = ({ conversationId, currentUserId, assignedUserId, confirm,
  loadState = whatsappService.getAiConversationState }) => {
  const toast = useToastContext();
  const [state, setState] = useState<WhatsAppAiConversationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A conta regressiva precisa de um relógio próprio: sem ele "em 2h" fica
  // congelado até o operador trocar de conversa.
  const [agora, setAgora] = useState(() => Date.now());
  const [regraAberta, setRegraAberta] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    loadState(conversationId)
      .then(setState)
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }, [conversationId, loadState]);

  useEffect(() => { setOpen(false); load(); }, [conversationId, load]);

  // Meio minuto é o suficiente: a menor unidade que a conta regressiva mostra é
  // o minuto. Só corre quando há retomada agendada.
  const temPendente = !!state?.pendingFollowup;
  useEffect(() => {
    if (!temPendente) return;
    const id = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [temPendente]);

  // E o ESTADO também envelhece. O agente agenda, envia e cria a tentativa
  // seguinte sozinho, tudo pelo backend — sem esta releitura o painel congela no
  // retrato de quando a conversa foi aberta e anuncia "ainda não agendado"
  // enquanto o acompanhamento já saiu. Um minuto, e só enquanto há agente.
  const temAgente = !!state?.assistantId;
  useEffect(() => {
    if (!temAgente) return;
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [temAgente, load]);

  // Canal sem agente: o painel não existe. Nada de espaço ocupado por uma
  // funcionalidade que este canal não usa.
  if (loading || !state || !state.assistantId) return null;

  // Depois do handoff, resumo, fatos e pendências viram o recado operacional do
  // caso e ficam apenas com quem recebeu a conversa.
  //
  // O PAINEL, porém, continua de pé para todos: ele é o único lugar onde se
  // religa a IA. Esconder o painel inteiro depois do handoff — que acontece
  // sozinho quando um humano responde — deixava a conversa sem nenhuma forma de
  // trazer o agente de volta.
  const podeVerResumo = state.status !== 'handed_off' || canShowPrivateAiHandoffSummary({
    currentUserId, assignedUserId, status: state.status,
  });

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); load(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const stop = () => run(
    () => whatsappService.stopAiForConversation(conversationId),
    'IA interrompida nesta conversa.');

  const resume = () => run(
    () => whatsappService.resumeAiForConversation(conversationId),
    'IA reativada nesta conversa.');

  const clear = async () => {
    const ok = await confirm({
      title: 'Limpar a memória da IA?',
      message: 'O resumo, os dados coletados e as pendências desta conversa são apagados. '
        + 'As mensagens continuam intactas e a IA recomeça do zero.',
      confirmLabel: 'Limpar memória',
      tone: 'danger',
    });
    if (!ok) return;
    await run(() => whatsappService.clearAiMemory(conversationId), 'Memória da IA limpa.');
  };

  const cancelFollowup = async () => {
    if (!state.pendingFollowup) return;
    await run(() => whatsappService.cancelAiFollowup(state.pendingFollowup!.id), 'Acompanhamento cancelado.');
  };

  const ativa = state.aiActive && state.channelAiEnabled;
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
  const followupAtivo = ativa && followup.tone !== 'off';
  const factKeys = Object.keys(state.knownFacts);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 transition"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <BrainCircuit size={12} /> Memória da IA
        <span className="ml-auto flex items-center gap-1">
          {followupAtivo && (
            <span
              className={`inline-flex items-center gap-1 normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                followup.tone === 'scheduled' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'
              }`}
              title={followup.detail}>
              <Clock size={10} />
              {followup.tone === 'scheduled'
                ? `${followup.attempt?.split(' ')[0]} ${followup.countdown}`
                : 'sem retomada'}
            </span>
          )}
          <span className={`normal-case tracking-normal text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          ativa ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {ativa ? (state.mode === 'test' ? 'Teste' : 'Ativa') : 'Parada'}
          </span>
        </span>
      </button>

      {open && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-2 space-y-2.5">
          <p className="text-[10.5px] text-slate-400 flex items-center gap-1.5">
            <Bot size={11} /> {state.assistantName || 'Agente'}
            {!state.channelAiEnabled && ' · IA desligada neste canal'}
          </p>

          {!podeVerResumo && (
            <p className="text-[11.5px] text-slate-400">
              O resumo do caso fica com quem assumiu a conversa.
            </p>
          )}

          {podeVerResumo && (state.summary ? (
            <p className="text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
              {state.summary}
            </p>
          ) : (
            <p className="text-[11.5px] text-slate-400">A IA ainda não registrou um resumo desta conversa.</p>
          ))}

          {/* Aguardando vem ANTES dos dados coletados: é a única linha que diz
              o que acontece a seguir. Dado já coletado é consulta; pendência é
              o motivo de a conversa estar parada. */}
          {podeVerResumo && state.pendingItems.length > 0 && (
            <p className="text-[11.5px] text-slate-700 break-words">
              <span className="text-slate-400">Aguardando: </span>
              {state.pendingItems.join(' · ')}
            </p>
          )}

          {podeVerResumo && factKeys.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {factKeys.map(key => (
                <span key={key}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[10.5px] text-slate-600">
                  <span className="text-slate-400">{key}</span>
                  <span className="truncate font-medium">{state.knownFacts[key]}</span>
                </span>
              ))}
            </div>
          )}

          {podeVerResumo && state.handoffReason && (
            <p className="text-[11.5px] text-amber-700 bg-amber-50 rounded px-2 py-1.5 break-words">
              Entregue ao humano: {state.handoffReason}
            </p>
          )}

          {/* Uma linha responde o que o atendente pergunta ("quanto tempo eu
              tenho antes de a IA cobrar sozinha?"). A escada inteira e a janela
              do canal são consulta, não notícia: ficam atrás do "ver regra". */}
          {followupAtivo && state.followupPolicy && (
            <div className={`rounded border px-2 py-1.5 space-y-1 ${
              followup.tone === 'scheduled' ? 'border-violet-100 bg-violet-50/60'
                : followup.tone === 'appointment' ? 'border-emerald-100 bg-emerald-50/60'
                  : 'border-amber-100 bg-amber-50/60'
            }`}>
              <p className={`text-[11.5px] font-semibold flex items-center gap-1.5 ${
                followup.tone === 'scheduled' ? 'text-violet-800'
                  : followup.tone === 'appointment' ? 'text-emerald-800'
                    : 'text-amber-800'
              }`}>
                <Clock size={11} className="flex-shrink-0" />
                {followup.tone === 'scheduled'
                  ? <span>Retomada {followup.attempt} · {followup.when} <span className="font-bold">({followup.countdown})</span></span>
                  : followup.tone === 'appointment'
                    ? <span>Contato marcado pelo cliente · {followup.when} <span className="font-bold">({followup.countdown})</span></span>
                    : <span>{followup.detail}</span>}
              </p>
              {followup.tone === 'appointment' && (
                <p className="text-[10.5px] text-emerald-700">
                  A escada de follow-up fica pausada até lá e não gasta tentativa.
                </p>
              )}

              {state.pendingFollowup && (
                <p className="text-[11px] text-slate-600 break-words line-clamp-2">“{state.pendingFollowup.message}”</p>
              )}

              <div className="flex items-center gap-2">
                <button onClick={() => setRegraAberta(v => !v)}
                  className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-700 transition">
                  {regraAberta ? 'ocultar regra' : 'ver regra'}
                </button>
                {state.pendingFollowup && (
                  <button onClick={cancelFollowup} disabled={busy}
                    className="text-[10.5px] font-semibold text-slate-500 hover:text-red-600 transition">
                    cancelar retomada
                  </button>
                )}
              </div>

              {regraAberta && (
                <p className="text-[10.5px] text-slate-500 break-words">
                  {describeWaAiFollowupSchedule(state.followupPolicy)}
                  {' · '}
                  {describeWaAiFollowupWindow(state.followupPolicy)}
                  {state.followupAttempts > 0 && ` · ${state.followupAttempts} já enviada${state.followupAttempts === 1 ? '' : 's'}`}
                </p>
              )}
            </div>
          )}

          {/* Último estado, não histórico: é o que responde "o que ela fez agora?". */}
          {state.lastExecution && (
            <p className="text-[10.5px] text-slate-400 break-words">
              Última execução {fmt(state.lastExecution.created_at)} · {state.lastExecution.status}
              {state.lastExecution.error && ` · ${state.lastExecution.error}`}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-200">
            {state.aiActive ? (
              <button onClick={stop} disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-amber-700 hover:border-amber-200 transition disabled:opacity-50">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Pause size={11} />} Interromper IA
              </button>
            ) : (
              <button onClick={resume} disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-emerald-700 hover:border-emerald-200 transition disabled:opacity-50">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Reativar IA
              </button>
            )}
            <button onClick={clear} disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-red-600 hover:border-red-200 transition disabled:opacity-50">
              <Trash2 size={11} /> Limpar memória
            </button>
          </div>
          <p className="text-[10.5px] text-slate-400">
            {state.aiActive
              ? 'A IA para sozinha quando alguém do escritório responde.'
              : 'Reativar devolve a conversa à fila: a IA não atende conversa que já tem dono.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default AiMemoryPanel;

/**
 * DEV-ONLY: bancada do acompanhamento do agente de IA (?waaifollowuppreview=1).
 *
 * Mostra lado a lado os três estados que o operador pode encontrar — retomada
 * agendada, política ligada sem nada agendado, e conversa entregue ao humano —
 * com a faixa do topo e o painel da coluna lateral, sem login e sem banco.
 *
 * Existe porque a diferença entre "configurado" e "agendado" é justamente a que
 * ninguém enxergava: o painel antigo dizia "Follow-up automático ativo" com o
 * banco sem uma única linha pendente.
 *
 * Mesmo padrão das outras bancadas em src/dev/ (ver main.tsx).
 */
import React from 'react';
import { ToastProvider } from '../contexts/ToastContext';
import { AiAgentBanner } from '../components/whatsapp/aiAgentBanner';
import { AiMemoryPanel } from '../components/whatsapp/aiMemoryPanel';
import type { WhatsAppAiConversationState } from '../types/whatsapp.types';

const POLICY: NonNullable<WhatsAppAiConversationState['followupPolicy']> = {
  enabled: true,
  strategy: 'custom',
  intervalHours: 24,
  customHours: [2, 4, 8, 24, 48, 168, 240, 336],
  maxAttempts: 8,
  days: [1, 2, 3, 4, 5],
  startMinute: 480,
  endMinute: 1080,
  timezone: 'America/Cuiaba',
  inactivityMinutes: 10,
};

const BASE: WhatsAppAiConversationState = {
  aiActive: true,
  assistantId: '509cc5cf-25eb-4fca-ae5a-05f7ec07e69b',
  assistantName: 'Campanha — Sem registro na carteira',
  mode: 'auto',
  followupPolicy: POLICY,
  channelAiEnabled: true,
  status: 'active',
  summary: 'Resumo automático — o agente não registrou o dele. '
    + 'Última mensagem do cliente: "trabalhei uns 3 anos lá".',
  knownFacts: { nome: 'Pedro', empresa: 'Todinho', vínculo: 'sem registro' },
  pendingItems: ['responder: "Pode me dizer quando você saiu, Pedro?"'],
  lastAction: null,
  handoffReason: null,
  handoffSummary: null,
  nextFollowupAt: null,
  followupAttempts: 0,
  lastExecution: null,
  pendingFollowup: null,
};

/** Daqui a duas horas: o primeiro degrau da escada desta campanha. */
const daquiA = (ms: number) => new Date(Date.now() + ms).toISOString();

const CENARIOS: { titulo: string; nota: string; state: WhatsAppAiConversationState }[] = [
  {
    titulo: 'Retomada agendada',
    nota: 'O estado normal depois de a IA responder: existe linha pendente e a conta regressiva anda.',
    state: {
      ...BASE,
      nextFollowupAt: daquiA(2 * 3_600_000),
      pendingFollowup: {
        id: 'fu-1',
        conversation_id: 'previa',
        assistant_id: BASE.assistantId,
        attempt: 1,
        scheduled_at: daquiA(2 * 3_600_000),
        message: 'Oi, Pedro! Podemos continuar? Ficou faltando você me dizer o mês e o ano em que saiu da empresa.',
        reason: 'Retomada automática · tentativa 1 de 8.',
        status: 'pending',
        kind: 'followup',
        cancel_reason: null,
        sent_at: null,
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as WhatsAppAiConversationState['pendingFollowup'],
    },
  },
  {
    titulo: 'Configurado, nada agendado',
    nota: 'O bug de 12/08/2026 visto de fora: política de 8 tentativas ligada, banco sem pendente.',
    state: { ...BASE, pendingFollowup: null, nextFollowupAt: null },
  },
  {
    titulo: 'Terceira tentativa, escada andando',
    nota: 'Duas retomadas já saíram; a terceira cai daqui a oito horas, no primeiro horário útil.',
    state: {
      ...BASE,
      followupAttempts: 2,
      summary: 'Cliente trabalhou na Todinho sem registro por cerca de 3 anos. Falta a data de saída.',
      pendingItems: ['mês e ano da saída da empresa'],
      pendingFollowup: {
        id: 'fu-3',
        conversation_id: 'previa',
        assistant_id: BASE.assistantId,
        attempt: 3,
        scheduled_at: daquiA(26 * 3_600_000),
        message: 'Oi, Pedro! Continuo por aqui quando você puder responder. Ficou faltando mês e ano da saída da empresa.',
        reason: 'Escada automática · tentativa 3 de 8.',
        status: 'pending',
        kind: 'followup',
        cancel_reason: null,
        sent_at: null,
        error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as WhatsAppAiConversationState['pendingFollowup'],
    },
  },
];

const WhatsAppAiFollowupPanelPreview: React.FC = () => (
  <ToastProvider>
    <div className="min-h-screen bg-slate-100 p-6 space-y-6">
      <header>
        <h1 className="text-lg font-bold text-slate-800">Acompanhamento do agente de IA</h1>
        <p className="text-[12px] text-slate-500">
          Faixa do topo da conversa e painel da coluna lateral, nos três estados possíveis.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        {CENARIOS.map(cenario => (
          <section key={cenario.titulo} className="space-y-2">
            <div>
              <h2 className="text-[13px] font-bold text-slate-700">{cenario.titulo}</h2>
              <p className="text-[11px] text-slate-500">{cenario.nota}</p>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <AiAgentBanner
                conversationId="previa"
                onAssume={() => {}}
                loadState={async () => cenario.state}
              />
              <div className="p-3">
                <p className="text-[11px] text-slate-400">…thread da conversa…</p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <AiMemoryPanel
                conversationId="previa"
                currentUserId={null}
                assignedUserId={null}
                confirm={async () => true}
                loadState={async () => cenario.state}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  </ToastProvider>
);

export default WhatsAppAiFollowupPanelPreview;

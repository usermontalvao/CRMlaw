// DEV-ONLY: harness visual do quadro de Leads (?wafunnelboardpreview=1).
// Mostra o recorte do quadro sem depender do banco: só conversas vivas do canal
// entram, e as que nenhuma etapa reconhece caem na coluna "Sem etapa".
import React, { useState } from 'react';
import { Target } from 'lucide-react';
import { ToastProvider } from '../contexts/ToastContext';
import { ConversationFunnelBoard } from '../components/whatsapp/conversationFunnelBoard';
import { funnelLabelsFromChannelStages } from '../components/whatsapp/funnel';
import type { WhatsAppChannelFunnelStage, WhatsAppConversation } from '../types/whatsapp.types';

const CANAL = 'channel-pedro';

const stage = (
  key: string, label: string, color: string, position: number, labels: string[], isDefault = false,
): WhatsAppChannelFunnelStage => ({
  id: `${CANAL}-${key}`, channel_id: CANAL, stage_key: key, label, description: '',
  color, labels, position, is_active: true, is_default: isDefault, entry_actions: [],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
});

const stages: WhatsAppChannelFunnelStage[] = [
  stage('novo', 'Novo', '#64748b', 0, ['Novo'], true),
  stage('em_atendimento', 'Em atendimento', '#3b82f6', 1, ['Em atendimento']),
  stage('aguardando_documentos', 'Aguardando documentos', '#f59e0b', 2, ['Documentação pendente']),
  stage('finalizado', 'Finalizado', '#10b981', 3, ['Finalizado']),
];

const conv = (patch: Partial<WhatsAppConversation> & { id: string }): WhatsAppConversation => ({
  instance_id: CANAL, remote_jid: `${patch.id}@s.whatsapp.net`, contact_phone: '5566960066720',
  contact_name: null, contact_avatar_path: null, contact_avatar_url: null,
  client_id: null, client_name: null,
  assigned_user_id: null, department_id: null, status: 'open', unread_count: 0,
  last_message_at: '2026-08-04T09:41:00Z', last_message_preview: null, last_message_direction: 'in',
  presence: null, presence_updated_at: null, last_seen_at: null,
  is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null,
  closed_at: null, closed_by: null, closure_reason: null, reopened_at: null,
  first_response_at: null, last_customer_message_at: null, last_agent_message_at: null,
  awaiting_accept: false, transfer_pending_since: null, contact_reason: null, labels: [],
  legal_hold: false, legal_hold_reason: null, absence_suppressed: false,
  created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-04T09:41:00Z',
  ...patch,
});

const seed: WhatsAppConversation[] = [
  conv({ id: 'isabel', contact_name: 'Isabel Maria', labels: ['Novo'], last_message_preview: 'Sem problema.' }),
  conv({ id: 'robiane', contact_name: 'Robiane Aguiar', labels: ['Novo'], last_message_preview: 'Blza' }),
  conv({ id: 'fc', contact_name: 'Fc', labels: ['Em atendimento'], last_message_preview: 'Vou verificar aqui' }),
  conv({ id: 'marcia', contact_name: 'Márcia Souza', labels: ['Documentação pendente'], last_message_preview: 'Mando o RG hoje' }),
  // Fora do quadro: encerrada, bloqueada e rascunho sem nenhum envio.
  conv({ id: 'itamar', contact_name: 'itamar (encerrada)', labels: ['Novo'], status: 'closed', closed_at: '2026-08-04T09:50:00Z' }),
  conv({ id: 'bloqueado', contact_name: 'Contato bloqueado', labels: ['Novo'], is_blocked: true }),
  conv({ id: 'rascunho', contact_name: 'Rascunho sem envio', labels: ['Novo'], last_message_at: null }),
  // Sem etapa: etiqueta livre que nenhuma etapa deste canal reconhece.
  conv({ id: 'legado', contact_name: 'Conversa antiga', labels: ['Urgente'], last_message_preview: 'Etiqueta fora do funil' }),
  conv({ id: 'sem_tag', contact_name: 'Sem etiqueta', last_message_preview: 'Nunca entrou no funil' }),
  // Outro canal — não deve aparecer.
  conv({ id: 'outro_canal', contact_name: 'Outro canal', instance_id: 'channel-comercial', labels: ['Novo'] }),
];

const WhatsAppFunnelBoardPreview: React.FC = () => {
  const [conversations, setConversations] = useState(seed);
  const funnelLabels = funnelLabelsFromChannelStages(stages);

  return (
    <ToastProvider>
      <main className="min-h-screen bg-[#f5f5f3] p-4 sm:p-8">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white"><Target size={20} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">WhatsApp · Leads</p>
              <h1 className="text-base font-semibold text-slate-900">Quadro do funil</h1>
              <p className="text-xs text-slate-500">
                10 conversas na origem: encerrada, bloqueada, rascunho e a de outro canal ficam fora
              </p>
            </div>
          </header>
          <div className="bg-[#f5f5f3] px-4 py-5">
            <ConversationFunnelBoard
              conversations={conversations}
              funnelLabels={funnelLabels}
              channelId={CANAL}
              onOpen={id => console.info('abrir conversa', id)}
              onMoved={(id, labels) => setConversations(prev => prev.map(c => c.id === id ? { ...c, labels } : c))}
            />
          </div>
        </div>
      </main>
    </ToastProvider>
  );
};

export default WhatsAppFunnelBoardPreview;

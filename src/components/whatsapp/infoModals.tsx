// Modais informativos da conversa: resumo automático por IA e histórico
// (timeline) de eventos. Extraídos de WhatsAppModule.tsx — autocontidos.
import React, { useEffect, useState } from 'react';
import {
  Sparkles, Loader2, StickyNote, History, UserCheck, Filter,
  ArrowRightLeft, CheckCircle2, RotateCcw, Ban, Scale,
} from 'lucide-react';
import { WaDialog, WaDialogBody, waBtnGhost, waBtnPrimary } from './ui';
import { whatsappService } from '../../services/whatsapp.service';
import { aiService } from '../../services/ai.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppConversation, TimelineEvent, TimelineKind } from '../../types/whatsapp.types';

// ── Resumo automático por IA (Fase 7) ──
export const ConversationSummaryModal: React.FC<{
  conversation: WhatsAppConversation;
  staffByUser: Map<string, string>;
  onClose: () => void;
}> = ({ conversation, staffByUser, onClose }) => {
  const toast = useToastContext();
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Carrega as últimas 60 mensagens e solicita resumo ao serviço de IA.
    whatsappService.listMessages(conversation.id)
      .then(async msgs => {
        if (!alive) return;
        const lines = msgs.slice(-60).map(m => {
          const who = m.direction === 'out'
            ? (m.sender_user_id ? (staffByUser.get(m.sender_user_id) || 'Agente') : 'Agente')
            : (conversation.contact_name || conversation.contact_phone);
          const body = m.content || (m.file_name ? `[Arquivo: ${m.file_name}]` : `[${m.type}]`);
          const ts = new Date(m.wa_timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `[${ts}] ${who}: ${body}`;
        }).join('\n');

        const conversationText = `Conversa WhatsApp — ${conversation.contact_name || conversation.contact_phone}\n\n${lines}\n\nDestaque: assunto principal, o que foi solicitado ou combinado, pendências e próximos passos.`;
        const result = await aiService.generateSummary(conversationText, 150);
        if (alive) setSummary(result);
      })
      .catch(() => { if (alive) setSummary(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [conversation.id, conversation.contact_name, conversation.contact_phone, staffByUser]);

  const saveAsNote = async () => {
    if (!summary) return;
    setSaving(true);
    try {
      await whatsappService.addNote(conversation.id, `\u{1F916} Resumo automático:\n${summary}`);
      toast.success('Resumo salvo como nota interna.');
      onClose();
    } catch (e: any) { toast.error('Falha ao salvar nota', e.message); }
    finally { setSaving(false); }
  };

  return (
    <WaDialog
      title="Resumo automático por IA"
      icon={<Sparkles size={18} />}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Fechar</button>
          {summary && (
            <button onClick={saveAsNote} disabled={saving} className={waBtnPrimary}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <StickyNote size={14} />} Salvar como nota
            </button>
          )}
        </div>
      }
    >
      <WaDialogBody className="min-h-[120px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-slate-400">
            <Loader2 size={24} className="animate-spin text-[#00a884]" />
            <span className="text-[13px]">Gerando resumo da conversa…</span>
          </div>
        ) : summary ? (
          <p className="text-[13.5px] text-slate-700 leading-relaxed whitespace-pre-wrap">{summary}</p>
        ) : (
          <p className="text-[13px] text-slate-400 italic text-center py-6">Não foi possível gerar o resumo. Verifique se a IA está configurada.</p>
        )}
      </WaDialogBody>
    </WaDialog>
  );
};

// ── Timeline unificada da conversa (Fase 7) ──
const TL_META: Record<TimelineKind, { label: string; icon: React.ReactNode; color: string }> = {
  transfer: { label: 'Transferências', icon: <ArrowRightLeft size={13} />, color: '#d97706' },
  note: { label: 'Notas', icon: <StickyNote size={13} />, color: '#0ea5e9' },
  closed: { label: 'Ciclo', icon: <CheckCircle2 size={13} />, color: '#64748b' },
  reopened: { label: 'Ciclo', icon: <RotateCcw size={13} />, color: '#16a34a' },
  blocked: { label: 'Ciclo', icon: <Ban size={13} />, color: '#dc2626' },
  process: { label: 'Processo', icon: <Scale size={13} />, color: '#7c3aed' },
};
const TL_FILTERS: { key: 'all' | TimelineKind; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'transfer', label: 'Transferências' },
  { key: 'note', label: 'Notas' },
  { key: 'closed', label: 'Ciclo' },
  { key: 'process', label: 'Processo' },
];

export const ConversationTimelineModal: React.FC<{
  conversation: WhatsAppConversation;
  staffByUser: Map<string, string>;
  onClose: () => void;
}> = ({ conversation, staffByUser, onClose }) => {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | TimelineKind>('all');

  useEffect(() => {
    let alive = true;
    whatsappService.getConversationTimeline(conversation)
      .then(e => { if (alive) setEvents(e); })
      .catch(() => { if (alive) setEvents([]); });
    whatsappService.getConversationAgents(conversation)
      .then(a => { if (alive) setAgents(a); })
      .catch(() => { if (alive) setAgents([]); });
    return () => { alive = false; };
  }, [conversation]);

  // O filtro "closed" agrupa todos os eventos de ciclo de vida.
  const matchFilter = (k: TimelineKind) => filter === 'all' || k === filter
    || (filter === 'closed' && (k === 'closed' || k === 'reopened' || k === 'blocked'));
  const shown = (events || []).filter(e => matchFilter(e.kind));

  return (
    <WaDialog title="Histórico da conversa" icon={<History size={18} />} onClose={onClose} size="lg">
      {agents.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 border-b border-[#f1f0ec] flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><UserCheck size={13} /> Atendentes:</span>
          {agents.map((id, i) => (
            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#f0f2f5] text-slate-600">
              {staffByUser.get(id) || 'Usuário'}
              {i === agents.length - 1 && conversation.assigned_user_id === id && conversation.status !== 'closed' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Responsável atual" />
              )}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 px-4 sm:px-5 py-3 border-b border-[#f1f0ec] flex-wrap">
        <Filter size={13} className="text-slate-400" />
        {TL_FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition ${filter === f.key ? 'bg-[#00a884] text-white' : 'text-slate-500 hover:bg-[#f0f2f5]'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="px-4 sm:px-5 py-4">
        {events === null ? (
          <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
        ) : shown.length === 0 ? (
          <p className="text-center text-[13px] text-slate-400 py-8">Nenhum evento para este filtro.</p>
        ) : (
          <div className="space-y-3">
            {shown.map(e => {
              const meta = TL_META[e.kind];
              return (
                <div key={e.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: meta.color + '22', color: meta.color }}>{meta.icon}</span>
                    <span className="flex-1 w-px bg-[#e7e5df] mt-1" />
                  </div>
                  <div className="pb-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-700">{e.title}</p>
                    {e.detail && <p className="text-[12px] text-slate-500 whitespace-pre-wrap break-words">{e.detail}</p>}
                    <p className="text-[10.5px] text-slate-400 mt-0.5">
                      {e.actorId && staffByUser.get(e.actorId) ? `${staffByUser.get(e.actorId)} · ` : ''}
                      {new Date(e.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WaDialog>
  );
};

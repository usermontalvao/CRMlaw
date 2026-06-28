// Quadro Kanban do funil por conversa: colunas = etapas; arrastar troca a etapa.
import React, { useState, useMemo, useCallback } from 'react';
import { Target } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { prettyPhone } from './format';
import { inferFunnelStage } from './funnel';
import { Avatar } from './avatar';
import type { FunnelLabel } from '../../services/settings.service';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

export const ConversationFunnelBoard: React.FC<{
  conversations: WhatsAppConversation[];
  funnelLabels: FunnelLabel[];
  channelId: string;
  onOpen: (id: string) => void;
  onMoved: (conversationId: string, labels: string[]) => void;
}> = ({ conversations, funnelLabels, channelId, onOpen, onMoved }) => {
  const toast = useToastContext();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const funnelKeys = useMemo(() => new Set(funnelLabels.map(l => l.key)), [funnelLabels]);
  const stages = useMemo(() => {
    const m = new Map<string, { key: string; label: string; color: string; primary: string }>();
    for (const l of funnelLabels) if (!m.has(l.stageKey)) m.set(l.stageKey, { key: l.stageKey, label: l.stageLabel, color: l.color, primary: l.key });
    return [...m.values()];
  }, [funnelLabels]);

  const visible = useMemo(
    () => (channelId ? conversations.filter(c => c.instance_id === channelId) : conversations),
    [conversations, channelId],
  );
  const stageKeyOf = useCallback(
    (c: WhatsAppConversation) => inferFunnelStage(c.labels, funnelLabels)?.stageKey ?? null,
    [funnelLabels],
  );

  const move = async (c: WhatsAppConversation, stage: { key: string; primary: string }) => {
    if (stageKeyOf(c) === stage.key) return;
    // 1 etapa por vez: remove etiquetas de funil anteriores, mantém tags livres.
    const free = (c.labels ?? []).filter(l => !funnelKeys.has(l));
    const next = [...free, stage.primary];
    onMoved(c.id, next);
    try { await whatsappService.updateLabels(c.id, next); }
    catch (e: any) { toast.error('Falha ao mover no funil', e.message); }
  };

  if (stages.length === 0) {
    return <p className="text-[12.5px] text-slate-400 py-6 text-center">Configure as etapas do funil em Configurações → Leads.</p>;
  }

  return (
    <div className="flex flex-col md:flex-row gap-2.5 md:gap-3 md:overflow-x-auto pb-1">
      {stages.map(stage => {
        const items = visible.filter(c => stageKeyOf(c) === stage.key)
          .sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
        const isOver = overStage === stage.key;
        return (
          <div key={stage.key} className="flex-shrink-0 w-full md:w-72">
            <div className={`rounded-2xl border overflow-hidden bg-white transition-colors ${isOver ? 'border-amber-400' : 'border-[#ebe9e3]'}`}
              onDragOver={e => { e.preventDefault(); setOverStage(stage.key); }}
              onDragLeave={() => setOverStage(s => (s === stage.key ? null : s))}
              onDrop={e => { e.preventDefault(); setOverStage(null); const id = e.dataTransfer.getData('text/plain'); const c = visible.find(x => x.id === id); if (c) move(c, stage); setDragId(null); }}>
              <div className="px-3 py-2.5 border-b border-[#f1efe9] bg-white flex items-center justify-between"
                style={{ color: stage.color, boxShadow: 'inset 3px 0 0 0 currentColor' }}>
                <div className="flex items-center gap-1.5"><Target size={12} /><h4 className="font-semibold text-[11px] tracking-wide uppercase text-slate-600">{stage.label}</h4></div>
                <span className="text-[11px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">{items.length}</span>
              </div>
              <div className="p-2.5 space-y-2 overflow-y-auto min-h-[230px] max-h-[340px] bg-white">
                {items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-[210px] text-center gap-1.5">
                    <Target size={20} className="text-slate-200" />
                    <p className="text-[11px] text-slate-300">Arraste conversas para cá</p>
                  </div>
                ) : items.map(c => (
                  <div key={c.id} draggable
                    onDragStart={e => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; setDragId(c.id); }}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    onClick={() => onOpen(c.id)}
                    title="Abrir conversa"
                    className={`flex items-center gap-2 rounded-xl border border-[#ebe9e3] bg-white p-2 cursor-pointer hover:border-amber-300 hover:shadow-sm transition-all ${dragId === c.id ? 'opacity-50' : ''}`}>
                    <Avatar url={c.contact_avatar_url} name={c.contact_name} phone={c.contact_phone} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-slate-800 truncate">{c.contact_name || prettyPhone(c.contact_phone)}</p>
                      <p className="text-[10.5px] text-slate-400 truncate">{c.last_message_preview || prettyPhone(c.contact_phone)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

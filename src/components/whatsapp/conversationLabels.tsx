// Painel de etiquetas da conversa (espelho do funil configurado).
import React, { useState } from 'react';
import { Target, Tag, X } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { resolveLabelMeta, inferFunnelStage } from './funnel';
import type { FunnelLabel } from '../../services/settings.service';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

export const ConversationLabelsPanel: React.FC<{
  conversation: WhatsAppConversation;
  funnelLabels: FunnelLabel[];
  onChanged: (conv: WhatsAppConversation) => void;
}> = ({ conversation, funnelLabels, onChanged }) => {
  const toast = useToastContext();
  const [saving, setSaving] = useState(false);
  const current = conversation.labels ?? [];
  const funnelKeys = new Set(funnelLabels.map(l => l.key));

  const toggle = async (key: string) => {
    // Etiquetas de FUNIL são mutuamente exclusivas: só 1 etapa por vez. Ao
    // adicionar uma de funil, removo qualquer outra de funil (mantendo as tags
    // livres). Tags livres continuam acumuláveis normalmente.
    let next: string[];
    if (current.includes(key)) {
      next = current.filter(l => l !== key);
    } else if (funnelKeys.has(key)) {
      next = [...current.filter(l => !funnelKeys.has(l)), key];
    } else {
      next = [...current, key];
    }
    setSaving(true);
    try {
      await whatsappService.updateLabels(conversation.id, next);
      onChanged({ ...conversation, labels: next });
    } catch (e: any) { toast.error('Falha ao salvar etiqueta', e.message); }
    finally { setSaving(false); }
  };

  // Agrupa as etiquetas do funil por etapa, preservando a ordem do funil.
  const groups: { stageKey: string; stageLabel: string; labels: FunnelLabel[] }[] = [];
  for (const l of funnelLabels) {
    if (current.includes(l.key)) continue; // já aplicadas saem do select
    let g = groups.find(x => x.stageKey === l.stageKey);
    if (!g) { g = { stageKey: l.stageKey, stageLabel: l.stageLabel, labels: [] }; groups.push(g); }
    g.labels.push(l);
  }

  const stage = inferFunnelStage(current, funnelLabels);

  return (
    <div className="space-y-1.5">
      {/* Etapa atual do funil (derivada das etiquetas). */}
      {stage && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold"
          style={{ background: stage.color + '22', color: stage.color }}>
          <Target size={10} /> {stage.stageLabel}
        </span>
      )}
      {/* Select compacto agrupado por etapa do funil. */}
      <select value="" onChange={e => { if (e.target.value) toggle(e.target.value); }} disabled={saving || funnelLabels.length === 0}
        className="w-full min-w-0 text-[12px] pl-2 pr-6 py-1.5 rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none disabled:opacity-60">
        <option value="">{saving ? 'Salvando…' : funnelLabels.length === 0 ? 'Configure o funil em Leads' : '🏷 Etiquetas — adicionar…'}</option>
        {groups.map(g => (
          <optgroup key={g.stageKey} label={g.stageLabel}>
            {g.labels.map(l => <option key={l.key} value={l.key}>{l.key}</option>)}
          </optgroup>
        ))}
      </select>
      {current.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {current.map(key => {
            const meta = resolveLabelMeta(key, funnelLabels);
            return (
              <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: meta.color, color: '#fff' }}>
                <Tag size={9} />{key}
                <button onClick={() => toggle(key)} disabled={saving} className="hover:opacity-70 ml-0.5"><X size={10} /></button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Painel de etiquetas da conversa (espelho do funil configurado).
//
// Antes eram três blocos empilhados — a etapa do funil, um `select` de largura
// cheia e, embaixo dele, as etiquetas aplicadas — o que fazia a mesma coisa
// aparecer em dois lugares e o controle ficar no meio do caminho. Agora é UMA
// linha só: as etiquetas aplicadas e, como último item, a pastilha de
// adicionar. Quem lê vê o conjunto; quem vai editar acha o controle onde a
// lista termina. A etapa do funil mudou-se para o resumo do atendimento (ver
// `detailsPanelHeader`), junto de responsável e setor, que é o que ela é.
import React, { useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { resolveLabelMeta, inferFunnelStage } from './funnel';
import type { FunnelLabel } from '../../services/settings.service';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

export const ConversationLabelsPanel: React.FC<{
  conversation: WhatsAppConversation;
  funnelLabels: FunnelLabel[];
  onChanged: (conv: WhatsAppConversation) => void;
  onStageEntered?: (conversation: WhatsAppConversation, stageKey: string) => Promise<void>;
}> = ({ conversation, funnelLabels, onChanged, onStageEntered }) => {
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
      const updated = { ...conversation, labels: next };
      onChanged(updated);
      const previousStage = inferFunnelStage(current, funnelLabels)?.stageKey;
      const nextStage = funnelKeys.has(key) ? funnelLabels.find(label => label.key === key)?.stageKey : undefined;
      if (nextStage && nextStage !== previousStage) await onStageEntered?.(updated, nextStage);
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

  const semFunil = funnelLabels.length === 0;
  const semSugestao = groups.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {current.map(key => {
        const meta = resolveLabelMeta(key, funnelLabels);
        return (
          <span key={key} className="wa-chip inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-white"
            style={{ background: meta.color }}>
            <Tag size={9} className="flex-shrink-0 opacity-80" />
            <span className="max-w-[140px] truncate">{key}</span>
            <button onClick={() => toggle(key)} disabled={saving}
              title={`Remover ${key}`} aria-label={`Remover etiqueta ${key}`}
              className="wa-chip-x flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full">
              <X size={9} strokeWidth={3} />
            </button>
          </span>
        );
      })}

      {/* Pastilha de adicionar. O `select` nativo continua ali por cima, apenas
          invisível: é ele que dá o menu agrupado por etapa, a navegação por
          teclado e o comportamento certo no celular — de graça. */}
      <span className={`wa-chip-add relative inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-[3px] text-[10.5px] font-semibold ${
        saving || semFunil || semSugestao
          ? 'border-slate-200 text-slate-300'
          : 'cursor-pointer border-slate-300 text-slate-500'
      }`}>
        <Plus size={10} className="flex-shrink-0" />
        {saving
          ? 'Salvando…'
          : semFunil
            ? 'Configure em Funis'
            : semSugestao
              ? 'Todas aplicadas'
              : 'Etiqueta'}
        <select value="" onChange={e => { if (e.target.value) toggle(e.target.value); }}
          disabled={saving || semFunil || semSugestao}
          aria-label="Adicionar etiqueta"
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default">
          <option value="">Adicionar etiqueta…</option>
          {groups.map(g => (
            <optgroup key={g.stageKey} label={g.stageLabel}>
              {g.labels.map(l => <option key={l.key} value={l.key}>{l.key}</option>)}
            </optgroup>
          ))}
        </select>
      </span>
    </div>
  );
};

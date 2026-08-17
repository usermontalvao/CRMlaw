// Seletor da etapa atual da conversa.
//
// O banco ainda guarda a etapa no array `labels` por compatibilidade com as
// conversas e automações existentes. Na interface, porém, essa implementação
// fica escondida: cada conversa mostra uma única ETAPA, com o mesmo nome usado
// no funil. Assim "Aguardando retorno", "Novo lead" e outras etiquetas
// auxiliares não disputam espaço com o passo que realmente orienta a equipe.
import React, { useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { inferFunnelStage } from './funnel';
import type { FunnelLabel } from '../../services/settings.service';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

interface StageOption {
  stageKey: string;
  stageLabel: string;
  color: string;
  /** Valor persistido por compatibilidade com o modelo atual. */
  labelKey: string;
}

export const ConversationStageSelect: React.FC<{
  conversation: WhatsAppConversation;
  funnelLabels: FunnelLabel[];
  onChanged: (conv: WhatsAppConversation) => void;
  onStageEntered?: (conversation: WhatsAppConversation, stageKey: string) => Promise<void>;
}> = ({ conversation, funnelLabels, onChanged, onStageEntered }) => {
  const toast = useToastContext();
  const [saving, setSaving] = useState(false);
  const current = conversation.labels ?? [];
  const currentStage = inferFunnelStage(current, funnelLabels);

  const stages = useMemo(() => {
    const seen = new Set<string>();
    const options: StageOption[] = [];
    for (const label of funnelLabels) {
      if (seen.has(label.stageKey)) continue;
      seen.add(label.stageKey);
      options.push({
        stageKey: label.stageKey,
        stageLabel: label.stageLabel,
        color: label.color,
        labelKey: label.key,
      });
    }
    return options;
  }, [funnelLabels]);

  const changeStage = async (stageKey: string) => {
    if (!stageKey || stageKey === currentStage?.stageKey) return;
    const target = stages.find(stage => stage.stageKey === stageKey);
    if (!target) return;

    // Remove somente os marcadores que pertencem ao funil. Dados legados ou
    // classificações livres continuam preservados, mas deixam de poluir a UI.
    const funnelKeys = new Set(funnelLabels.map(label => label.key));
    const next = [...current.filter(label => !funnelKeys.has(label)), target.labelKey];
    setSaving(true);
    try {
      await whatsappService.updateLabels(conversation.id, next);
      const updated = { ...conversation, labels: next };
      onChanged(updated);
      await onStageEntered?.(updated, target.stageKey);
    } catch (error: any) {
      toast.error('Falha ao alterar etapa', error.message);
    } finally {
      setSaving(false);
    }
  };

  if (stages.length === 0) {
    return <span className="text-[11px] font-medium text-slate-400">Configure o funil</span>;
  }

  return (
    <div className="relative flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: currentStage?.color ?? '#94a3b8' }}
      />
      <select
        value={currentStage?.stageKey ?? ''}
        onChange={event => void changeStage(event.target.value)}
        disabled={saving}
        aria-label="Etapa da conversa"
        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-5 text-[12.5px] font-semibold text-slate-700 outline-none disabled:cursor-wait disabled:opacity-60"
      >
        {!currentStage && <option value="">Selecione a etapa</option>}
        {stages.map(stage => (
          <option key={stage.stageKey} value={stage.stageKey}>{stage.stageLabel}</option>
        ))}
      </select>
      {saving
        ? <Loader2 size={11} className="absolute right-0 animate-spin text-slate-400" />
        : <ChevronDown size={12} className="pointer-events-none absolute right-0 text-slate-400" />}
    </div>
  );
};

// Alias temporário para bancadas e imports antigos; o componente já expõe
// somente etapas, não etiquetas.
export const ConversationLabelsPanel = ConversationStageSelect;

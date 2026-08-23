import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowRightLeft, ArrowUp, Building2, CheckCircle2,
  ChevronDown, ChevronUp, Copy, GitBranch, Loader2, MessageSquareText, Plus,
  Save, Star, ToggleLeft, ToggleRight, Trash2, UserRound, Zap,
} from 'lucide-react';
import { whatsappService, type StaffOption } from '../../services/whatsapp.service';
import {
  LEAD_COLOR_HEX, settingsService, WHATSAPP_MODULE_DEFAULTS,
  type LeadStageConfig, type WhatsAppModuleConfig,
} from '../../services/settings.service';
import type {
  WhatsAppChannel, WhatsAppChannelFunnelStage, WhatsAppDepartment,
  WhatsAppFunnelStageAction, WhatsAppFunnelStageActionType,
} from '../../types/whatsapp.types';
import { normalizeFunnelStageActions, validateFunnelStageActions } from './funnelStageActionConfig';
import {
  VARIAVEIS_AVISO_CLIENTE, VARIAVEIS_OBSERVACAO_INTERNA,
  escreveDestino, leDestino, resolveDestino,
  type FontesDeDestino, type FunnelDestinationKind,
} from './funnelTransferTargets';
import { CampoComVariaveis, SeletorDeDestino, TipoDeDestino } from './funnelTransferPicker';

type StageDraft = Pick<WhatsAppChannelFunnelStage,
  'stage_key' | 'label' | 'description' | 'color' | 'labels' | 'position' | 'is_active' | 'is_default' | 'entry_actions'>;

interface FunnelDraft {
  enabled: boolean;
  stages: StageDraft[];
}

interface ChannelFunnelManagerProps {
  channels: WhatsAppChannel[];
  departments: WhatsAppDepartment[];
  staff: StaffOption[];
  moduleConfig?: WhatsAppModuleConfig;
  requirePin?: (options: any) => Promise<boolean>;
  onFeedback?: (type: 'error' | 'success', message: string) => void;
  onChannelsChange?: (channels: WhatsAppChannel[]) => void;
  /** Permite visualizar o editor sem consultar o banco. */
  initialStages?: WhatsAppChannelFunnelStage[];
  /**
   * Matriz canal × usuário e setor → membros. Passe-as para montar o editor sem
   * ir ao banco (é o que a bancada de preview faz); em produção elas são
   * carregadas aqui, porque as duas telas que usam este editor não as têm.
   */
  initialChannelMembers?: Array<{ channel_id: string; user_id: string }>;
  initialDepartmentMembers?: Record<string, string[]>;
}

const normalizeKey = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'etapa';

const sameDraft = (left?: FunnelDraft, right?: FunnelDraft) => JSON.stringify(left) === JSON.stringify(right);

const fromBase = (stages: LeadStageConfig[]): StageDraft[] => stages.map((stage, position) => ({
  stage_key: normalizeKey(stage.key || stage.label),
  label: stage.label,
  description: stage.description || '',
  color: LEAD_COLOR_HEX[stage.color] || '#64748b',
  labels: stage.labels?.length ? stage.labels : [stage.label],
  position,
  is_active: stage.active !== false,
  is_default: stage.isDefault === true || (position === 0 && !stages.some(item => item.isDefault)),
  entry_actions: [],
}));

const actionOf = (stage: StageDraft, type: WhatsAppFunnelStageActionType) =>
  stage.entry_actions.find(action => action.type === type);

const transferActionOf = (stage: StageDraft) => stage.entry_actions.find(action =>
  action.type === 'transfer_to_department' || action.type === 'transfer_to_user');

const ChannelFunnelManager: React.FC<ChannelFunnelManagerProps> = ({
  channels, departments, staff, moduleConfig = WHATSAPP_MODULE_DEFAULTS,
  requirePin, onFeedback, onChannelsChange, initialStages,
  initialChannelMembers, initialDepartmentMembers,
}) => {
  const [selectedId, setSelectedId] = useState(channels[0]?.id || '');
  const [drafts, setDrafts] = useState<Record<string, FunnelDraft>>({});
  const [saved, setSaved] = useState<Record<string, FunnelDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({});
  // Quem enxerga cada canal e quem atende cada setor. É o que separa "a lista
  // inteira do escritório" de "quem pode mesmo receber uma conversa DESTE
  // número" — a pergunta que o `<select>` antigo não fazia.
  const [channelMembers, setChannelMembers] = useState<Array<{ channel_id: string; user_id: string }>>(
    initialChannelMembers ?? []);
  const [departmentMembers, setDepartmentMembers] = useState<Record<string, string[]>>(
    initialDepartmentMembers ?? {});

  useEffect(() => {
    if (!channels.some(channel => channel.id === selectedId)) setSelectedId(channels[0]?.id || '');
  }, [channels, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = initialStages ?? await whatsappService.listChannelFunnelStages(channels.map(channel => channel.id));
        if (cancelled) return;
        const next = Object.fromEntries(channels.map(channel => [
          channel.id,
          {
            enabled: channel.funnel_enabled !== false,
            stages: rows
              .filter(stage => stage.channel_id === channel.id)
              .sort((a, b) => a.position - b.position)
              .map(({ stage_key, label, description, color, labels, position, is_active, is_default, entry_actions }) => ({
                stage_key, label, description, color, labels: labels || [], position, is_active, is_default,
                entry_actions: normalizeFunnelStageActions(entry_actions),
              })),
          } satisfies FunnelDraft,
        ]));
        setDrafts(next);
        setSaved(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os funis.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [channels, initialStages, reloadToken]);

  /**
   * Os vínculos são carregados à parte de propósito: falhar aqui não pode
   * derrubar o editor de etapas inteiro. Sem eles, `opcoesDePessoa` deixa de
   * marcar quem não tem acesso — e quem barra passa a ser só o banco, no
   * salvamento, que é o comportamento de antes desta mudança.
   */
  useEffect(() => {
    let cancelled = false;
    // Quem chega pronto entra na hora — o módulo carrega as duas matrizes para
    // outras telas e as repassa, e esperar a consulta de novo faria o editor
    // abrir sem saber quem tem acesso.
    if (initialChannelMembers) setChannelMembers(initialChannelMembers);
    if (initialDepartmentMembers) setDepartmentMembers(initialDepartmentMembers);
    if (initialChannelMembers && initialDepartmentMembers) return;
    void (async () => {
      try {
        const [canal, setor] = await Promise.all([
          initialChannelMembers ? Promise.resolve(initialChannelMembers) : whatsappService.listChannelMembers(),
          initialDepartmentMembers ? Promise.resolve(initialDepartmentMembers) : whatsappService.listAllDepartmentMembers(),
        ]);
        if (cancelled) return;
        setChannelMembers(canal);
        setDepartmentMembers(setor);
      } catch { /* o editor continua de pé; a trava do banco continua valendo */ }
    })();
    return () => { cancelled = true; };
  }, [initialChannelMembers, initialDepartmentMembers, reloadToken]);

  const channel = channels.find(item => item.id === selectedId) || null;
  /** O cadastro real, recortado pelo canal cujo funil está aberto. */
  const fontesDeDestino = useMemo<FontesDeDestino>(() => ({
    canal: channel ? { id: channel.id, visibility_mode: channel.visibility_mode } : null,
    setores: departments,
    pessoas: staff,
    membrosPorSetor: departmentMembers,
    membrosDoCanal: channelMembers
      .filter(row => row.channel_id === selectedId)
      .map(row => row.user_id),
  }), [channel, departments, staff, departmentMembers, channelMembers, selectedId]);
  const draft = selectedId ? drafts[selectedId] : undefined;
  const dirty = selectedId ? !sameDraft(draft, saved[selectedId]) : false;
  const activeStages = useMemo(() => draft?.stages.filter(stage => stage.is_active) || [], [draft]);

  const updateDraft = (apply: (current: FunnelDraft) => FunnelDraft) => {
    if (!selectedId) return;
    setDrafts(previous => ({
      ...previous,
      [selectedId]: apply(previous[selectedId] || { enabled: true, stages: [] }),
    }));
  };

  const updateStage = (index: number, patch: Partial<StageDraft>) => updateDraft(current => ({
    ...current,
    stages: current.stages.map((stage, stageIndex) => stageIndex === index ? { ...stage, ...patch } : stage),
  }));

  const moveStage = (index: number, direction: -1 | 1) => updateDraft(current => {
    const target = index + direction;
    if (target < 0 || target >= current.stages.length) return current;
    const stages = [...current.stages];
    [stages[index], stages[target]] = [stages[target], stages[index]];
    return { ...current, stages: stages.map((stage, position) => ({ ...stage, position })) };
  });

  const removeStage = (index: number) => updateDraft(current => {
    const removedDefault = current.stages[index]?.is_default;
    const stages = current.stages.filter((_, stageIndex) => stageIndex !== index)
      .map((stage, position) => ({ ...stage, position }));
    if (removedDefault && stages.length > 0) stages[0] = { ...stages[0], is_default: true };
    return { ...current, stages };
  });

  const addStage = () => updateDraft(current => {
    const used = new Set(current.stages.map(stage => stage.stage_key));
    let index = current.stages.length + 1;
    let key = `nova_etapa_${index}`;
    while (used.has(key)) key = `nova_etapa_${++index}`;
    return {
      ...current,
      stages: [...current.stages, {
        stage_key: key,
        label: `Nova etapa ${index}`,
        description: '',
        color: '#64748b',
        labels: [`Nova etapa ${index}`],
        position: current.stages.length,
        is_active: true,
        is_default: current.stages.length === 0,
        entry_actions: [],
      }],
    };
  });

  const setDefault = (index: number) => updateDraft(current => ({
    ...current,
    stages: current.stages.map((stage, stageIndex) => ({ ...stage, is_default: stageIndex === index })),
  }));

  const setStageActions = (index: number, actions: WhatsAppFunnelStageAction[]) => {
    updateStage(index, { entry_actions: normalizeFunnelStageActions(actions) });
  };

  const removeAction = (index: number, type: WhatsAppFunnelStageActionType | 'transfer') => {
    const stage = draft?.stages[index];
    if (!stage) return;
    setStageActions(index, stage.entry_actions.filter(action => type === 'transfer'
      ? !action.type.startsWith('transfer_to_')
      : action.type !== type));
  };

  const upsertAction = (index: number, action: WhatsAppFunnelStageAction) => {
    const stage = draft?.stages[index];
    if (!stage) return;
    const isTransfer = action.type.startsWith('transfer_to_');
    const kept = stage.entry_actions.filter(item => isTransfer
      ? !item.type.startsWith('transfer_to_')
      : item.type !== action.type);
    setStageActions(index, [...kept, action]);
  };

  const toggleMessageAction = (index: number) => {
    const stage = draft?.stages[index];
    if (!stage) return;
    const current = actionOf(stage, 'send_message');
    if (current) removeAction(index, 'send_message');
    else upsertAction(index, {
      type: 'send_message',
      message: 'Olá{{cliente.primeiro_nome_com_virgula}}, seu atendimento avançou para uma nova etapa.',
    });
  };

  const toggleTransferAction = (index: number) => {
    const stage = draft?.stages[index];
    if (!stage) return;
    const current = transferActionOf(stage);
    if (current) {
      removeAction(index, 'transfer');
      return;
    }
    // Nasce SEM destino. Escolher sozinho o primeiro setor da lista era o que
    // fazia a etapa sair de fábrica apontando para um lugar que ninguém pediu —
    // e, como o campo mostrava um nome plausível, ninguém conferia. A validação
    // de salvamento cobra o clique.
    const transfer: WhatsAppFunnelStageAction = escreveDestino({
      type: 'transfer_to_department',
      message: moduleConfig.transfer_to_department_template,
      payload: { note: 'Transferência automática pela etapa do funil' },
    }, { kind: 'department', id: null, nome: null });
    setStageActions(index, [
      ...stage.entry_actions.filter(action => action.type !== 'close_conversation' && !action.type.startsWith('transfer_to_')),
      transfer,
    ]);
  };

  const toggleCloseAction = (index: number) => {
    const stage = draft?.stages[index];
    if (!stage) return;
    const current = actionOf(stage, 'close_conversation');
    if (current) {
      removeAction(index, 'close_conversation');
      return;
    }
    setStageActions(index, [
      ...stage.entry_actions.filter(action => action.type !== 'close_conversation' && !action.type.startsWith('transfer_to_')),
      {
      type: 'close_conversation',
      message: moduleConfig.close_farewell_default,
      payload: { reason: 'Etapa final do funil' },
      },
    ]);
  };

  const copyBase = async () => {
    setCopying(true);
    setError(null);
    try {
      const base = await settingsService.getLeadModuleConfig();
      updateDraft(current => ({ ...current, stages: fromBase(base.stages) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível copiar o funil-base.');
    } finally {
      setCopying(false);
    }
  };

  const saveFunnel = async () => {
    if (!channel || !draft) return;
    const normalized = draft.stages.map((stage, position) => ({
      ...stage,
      stage_key: normalizeKey(stage.stage_key || stage.label),
      label: stage.label.trim(),
      description: stage.description.trim(),
      labels: Array.from(new Set(stage.labels.map(label => label.trim()).filter(Boolean))),
      entry_actions: normalizeFunnelStageActions(stage.entry_actions),
      position,
    }));
    if (normalized.length === 0 || normalized.some(stage => !stage.label)) {
      setError('Adicione ao menos uma etapa e informe o nome de todas elas.');
      return;
    }
    if (new Set(normalized.map(stage => stage.stage_key)).size !== normalized.length) {
      setError('Há etapas com identificadores repetidos. Ajuste os nomes antes de salvar.');
      return;
    }
    if (!normalized.some(stage => stage.is_active)) {
      setError('Mantenha pelo menos uma etapa ativa.');
      return;
    }
    const activeLabels = normalized
      .filter(stage => stage.is_active)
      .flatMap(stage => stage.labels.length ? stage.labels : [stage.label])
      .map(label => label.toLocaleLowerCase('pt-BR'));
    if (new Set(activeLabels).size !== activeLabels.length) {
      setError('A mesma etiqueta não pode representar duas etapas ativas deste canal.');
      return;
    }
    const actionError = normalized.flatMap(stage => validateFunnelStageActions(stage.entry_actions)
      .map(message => `${stage.label}: ${message}`))[0];
    if (actionError) {
      setError(actionError);
      return;
    }
    // O destino é conferido contra o cadastro ATUAL antes de sair daqui. Não é
    // a trava (o trigger `wa_funnel_entry_actions_check` recusa igual), mas é a
    // única que consegue dizer QUAL etapa está errada e por quê — o erro do
    // banco chega como uma linha só, sem o nome da etapa.
    const destinoInvalido = normalized.flatMap(stage => {
      const transfer = stage.entry_actions.find(action => action.type.startsWith('transfer_to_'));
      if (!transfer) return [];
      const resolucao = resolveDestino(transfer, fontesDeDestino);
      if (resolucao.status === 'ok') return [];
      return [`${stage.label}: ${resolucao.aviso || 'Escolha o destino da transferência automática.'}`];
    })[0];
    if (destinoInvalido) {
      setError(destinoInvalido);
      return;
    }
    const defaultIndex = normalized.findIndex(stage => stage.is_default && stage.is_active);
    const fallbackIndex = normalized.findIndex(stage => stage.is_active);
    const defaultStage = normalized[defaultIndex >= 0 ? defaultIndex : fallbackIndex];
    const finalStages = normalized.map(stage => ({ ...stage, is_default: stage.stage_key === defaultStage.stage_key }));

    const pinOk = requirePin ? await requirePin({
      action: 'update_whatsapp_channel_funnel', resourceType: 'whatsapp_channel', resourceId: channel.id,
      sensitivity: 'high', title: 'Salvar funil do canal',
      description: `Confirme com seu PIN as etapas do canal “${channel.name || channel.instance_name}”.`,
      actionLabel: 'Salvar funil',
      permission: { module: 'whatsapp', action: 'edit' },
    }) : true;
    if (!pinOk) return;

    setSaving(true);
    setError(null);
    try {
      if (!initialStages) {
        await whatsappService.updateChannelFunnel(channel.id, {
          enabled: draft.enabled,
          initialStage: defaultStage.stage_key,
          stages: finalStages,
        });
      }
      const persisted = { enabled: draft.enabled, stages: finalStages };
      setDrafts(previous => ({ ...previous, [channel.id]: persisted }));
      setSaved(previous => ({ ...previous, [channel.id]: persisted }));
      onChannelsChange?.(channels.map(item => item.id === channel.id ? {
        ...item, funnel_enabled: draft.enabled, funnel_initial_stage: defaultStage.stage_key,
      } : item));
      onFeedback?.('success', `Funil do canal “${channel.name || channel.instance_name}” atualizado.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível salvar o funil.';
      setError(message);
      onFeedback?.('error', message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> Carregando funis…</div>;

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <GitBranch size={18} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="text-[13px] font-semibold text-amber-950">Um funil para cada canal</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">Cada número tem suas próprias etapas, ordem, cores e etiquetas. O funil global de Leads fica como modelo-base para copiar, sem misturar os canais.</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setReloadToken(token => token + 1)} className="shrink-0 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 font-semibold hover:bg-red-100">
            Tentar novamente
          </button>
        </div>
      )}

      {channels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">Cadastre um canal antes de configurar o funil.</div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {channels.map(item => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-left transition ${selectedId === item.id ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:border-amber-200'}`}>
                <span className="flex items-center gap-2 text-xs font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color || '#ea6c00' }} />{item.name || item.instance_name}</span>
                <span className="mt-0.5 block text-[10px] opacity-70">{(drafts[item.id]?.stages.length || 0)} etapas</span>
              </button>
            ))}
          </div>

          {channel && draft && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-slate-900">{channel.name || channel.instance_name}</h3>
                  <p className="text-[11px] text-slate-500">{activeStages.length} etapa{activeStages.length === 1 ? '' : 's'} ativa{activeStages.length === 1 ? '' : 's'}</p>
                </div>
                <button type="button" onClick={() => updateDraft(current => ({ ...current, enabled: !current.enabled }))}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${draft.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {draft.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}{draft.enabled ? 'Exibir em Leads' : 'Oculto em Leads'}
                </button>
                <button type="button" onClick={() => void copyBase()} disabled={copying} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {copying ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Copiar funil-base
                </button>
              </div>

              <div className="space-y-3 p-4">
                {draft.stages.map((stage, index) => {
                  const messageAction = actionOf(stage, 'send_message');
                  const transferAction = transferActionOf(stage);
                  const closeAction = actionOf(stage, 'close_conversation');
                  const actionCount = stage.entry_actions.length;
                  const expansionKey = `${selectedId}:${index}`;
                  const actionsOpen = expandedActions[expansionKey] === true;
                  return (
                  <div key={`${stage.stage_key}-${index}`} data-stage-key={stage.stage_key}
                    className={`rounded-xl border p-3 ${stage.is_active ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setDefault(index)} title="Definir como etapa inicial" className={`rounded-lg p-1.5 ${stage.is_default ? 'bg-amber-100 text-amber-700' : 'text-slate-300 hover:bg-amber-50 hover:text-amber-600'}`}><Star size={15} fill={stage.is_default ? 'currentColor' : 'none'} /></button>
                      <input type="color" value={stage.color} onChange={event => updateStage(index, { color: event.target.value })} title="Cor da etapa" className="h-8 w-9 cursor-pointer rounded border border-slate-200 bg-white p-1" />
                      <input value={stage.label} onChange={event => updateStage(index, { label: event.target.value })} aria-label="Nome da etapa" className="min-w-[160px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:border-amber-300" />
                      <button type="button" onClick={() => updateStage(index, { is_active: !stage.is_active })} className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold ${stage.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{stage.is_active ? 'Ativa' : 'Inativa'}</button>
                      <button type="button" onClick={() => moveStage(index, -1)} disabled={index === 0} title="Subir" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-25"><ArrowUp size={14} /></button>
                      <button type="button" onClick={() => moveStage(index, 1)} disabled={index === draft.stages.length - 1} title="Descer" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-25"><ArrowDown size={14} /></button>
                      <button type="button" onClick={() => removeStage(index)} title="Excluir etapa" className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                    <input value={stage.description} onChange={event => updateStage(index, { description: event.target.value })} placeholder="Descrição da etapa" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-amber-300" />
                    <p className="mt-1.5 text-[10px] text-slate-400">Identificador: {stage.stage_key}{stage.is_default ? ' · etapa inicial' : ''}</p>

                    <button type="button"
                      data-testid={`stage-actions-toggle-${stage.stage_key}`}
                      onClick={() => setExpandedActions(previous => ({ ...previous, [expansionKey]: !actionsOpen }))}
                      className={`mt-2.5 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${actionCount > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-dashed border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-200'}`}>
                      <Zap size={14} className={actionCount > 0 ? 'text-amber-600' : 'text-slate-400'} />
                      <span className="min-w-0 flex-1 text-[11px] font-semibold">Ações ao entrar nesta etapa</span>
                      {actionCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold">{actionCount} ativa{actionCount === 1 ? '' : 's'}</span>}
                      {actionsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {actionsOpen && (
                      <div className="mt-2.5 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start gap-2">
                          <Zap size={14} className="mt-0.5 shrink-0 text-amber-600" />
                          <p className="text-[10.5px] leading-relaxed text-slate-500">Executadas na ordem abaixo quando alguém mover um card para esta etapa. A etapa inicial não dispara ações apenas por uma conversa nova ter sido criada.</p>
                        </div>

                        <div className={`rounded-lg border p-3 ${messageAction ? 'border-sky-200 bg-white' : 'border-slate-200 bg-white/70'}`}>
                          <div className="flex items-center gap-2">
                            <MessageSquareText size={14} className="text-sky-600" />
                            <span className="flex-1 text-[11px] font-semibold text-slate-700">1. Enviar mensagem</span>
                            <button type="button" onClick={() => toggleMessageAction(index)} aria-pressed={!!messageAction}
                              data-testid={`stage-action-message-${stage.stage_key}`}
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${messageAction ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
                              {messageAction ? 'Ativada' : 'Ativar'}
                            </button>
                          </div>
                          {messageAction && (
                            <textarea value={messageAction.message || ''} rows={2}
                              onChange={event => upsertAction(index, { ...messageAction, message: event.target.value })}
                              placeholder="Mensagem automática ao cliente"
                              className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-sky-300" />
                          )}
                        </div>

                        <div className={`rounded-lg border p-3 ${transferAction ? 'border-violet-200 bg-white' : 'border-slate-200 bg-white/70'}`}>
                          <div className="flex items-center gap-2">
                            <ArrowRightLeft size={14} className="text-violet-600" />
                            <span className="flex-1 text-[11px] font-semibold text-slate-700">2. Transferir atendimento</span>
                            <button type="button" onClick={() => toggleTransferAction(index)} aria-pressed={!!transferAction}
                              data-testid={`stage-action-transfer-${stage.stage_key}`}
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${transferAction ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                              {transferAction ? 'Ativada' : 'Ativar'}
                            </button>
                          </div>
                          {transferAction && (() => {
                            const destino = leDestino(transferAction);
                            const resolucao = resolveDestino(transferAction, fontesDeDestino);
                            // A prévia usa o destino REAL desta ação; só o que
                            // ainda não se sabe (nome do cliente, etapa) cai no
                            // exemplo do catálogo.
                            const destinoEscolhido = resolucao.nome
                              ? {
                                destino: resolucao.nome,
                                // Destino Pessoa não tem setor: a execução manda
                                // string vazia, e a prévia mostra o mesmo.
                                setor: destino.kind === 'department' ? resolucao.nome : '',
                              }
                              : undefined;
                            return (
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <div className="text-[10px] font-semibold text-slate-500">
                                Tipo de destino
                                <TipoDeDestino valor={destino.kind} stageKey={stage.stage_key}
                                  onChange={kind => {
                                    if (kind === destino.kind) return;
                                    // Trocar o tipo zera o destino: um id de setor
                                    // não vira id de pessoa, e manter o anterior
                                    // aqui só produziria um "sumiu" logo abaixo.
                                    upsertAction(index, escreveDestino({
                                      ...transferAction,
                                      message: kind === 'department'
                                        ? moduleConfig.transfer_to_department_template
                                        : moduleConfig.transfer_to_agent_template,
                                    }, { kind, id: null, nome: null }));
                                  }} />
                              </div>
                              <div className="text-[10px] font-semibold text-slate-500">
                                Destino
                                <SeletorDeDestino kind={destino.kind} fontes={fontesDeDestino}
                                  resolucao={resolucao} stageKey={stage.stage_key}
                                  onSelect={opcao => upsertAction(index, escreveDestino(transferAction, {
                                    kind: opcao.kind, id: opcao.id, nome: opcao.name,
                                  }))} />
                              </div>
                              <div className="md:col-span-2">
                                <CampoComVariaveis multilinha testId={`transfer-notice-${stage.stage_key}`}
                                  rotulo={<>Aviso ao cliente <span className="font-normal text-slate-400">(opcional)</span></>}
                                  valor={transferAction.message || ''}
                                  variaveis={VARIAVEIS_AVISO_CLIENTE}
                                  valoresReais={destinoEscolhido}
                                  onChange={texto => upsertAction(index, { ...transferAction, message: texto })} />
                              </div>
                              <div className="md:col-span-2">
                                <CampoComVariaveis testId={`transfer-note-${stage.stage_key}`}
                                  rotulo={<>Observação interna <span className="font-normal text-slate-400">(opcional)</span></>}
                                  valor={transferAction.payload?.note || ''}
                                  variaveis={VARIAVEIS_OBSERVACAO_INTERNA}
                                  valoresReais={destinoEscolhido}
                                  onChange={texto => upsertAction(index, {
                                    ...transferAction, payload: { ...transferAction.payload, note: texto },
                                  })} />
                              </div>
                            </div>
                            );
                          })()}
                        </div>

                        <div className={`rounded-lg border p-3 ${closeAction ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-white/70'}`}>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-emerald-600" />
                            <span className="flex-1 text-[11px] font-semibold text-slate-700">3. Encerrar atendimento</span>
                            <button type="button" onClick={() => toggleCloseAction(index)} aria-pressed={!!closeAction}
                              data-testid={`stage-action-close-${stage.stage_key}`}
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${closeAction ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {closeAction ? 'Ativada' : 'Ativar'}
                            </button>
                          </div>
                          {closeAction && (
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <label className="text-[10px] font-semibold text-slate-500">
                                Motivo interno
                                <input value={closeAction.payload?.reason || ''}
                                  onChange={event => upsertAction(index, { ...closeAction, payload: { ...closeAction.payload, reason: event.target.value } })}
                                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-300" />
                              </label>
                              <label className="text-[10px] font-semibold text-slate-500">
                                Mensagem de despedida <span className="font-normal text-slate-400">(opcional)</span>
                                <textarea value={closeAction.message || ''} rows={2}
                                  onChange={event => upsertAction(index, { ...closeAction, message: event.target.value })}
                                  className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-300" />
                              </label>
                            </div>
                          )}
                        </div>

                        {(transferAction || closeAction) && (
                          <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
                            {transferAction ? <Building2 size={12} /> : <UserRound size={12} />}
                            Transferir e encerrar são alternativas exclusivas; ao ativar uma, a outra é desligada.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}

                <button type="button" onClick={addStage} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"><Plus size={14} /> Adicionar etapa</button>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><CheckCircle2 size={13} className="text-emerald-600" /> A estrela marca onde novas conversas entram.</p>
                  <button type="button" onClick={() => void saveFunnel()} disabled={!dirty || saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-45">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{saving ? 'Salvando…' : 'Salvar funil do canal'}
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default ChannelFunnelManager;

/**
 * Formulário de um agente de IA — criação e edição.
 *
 * Separado do painel de propósito: aqui não há chamada de serviço nenhuma. O
 * componente recebe o rascunho e devolve alterações, o que deixa o formulário
 * inteiro exercitável na bancada de dev (?waaiagentpreview=1) sem Supabase.
 *
 * A organização é por DIVULGAÇÃO PROGRESSIVA: a tela abre curta, mostrando
 * identificação e o texto do "deve fazer"; limites, ações, acompanhamentos e
 * ajustes finos ficam recolhidos com um resumo do que já está configurado.
 * Nada de regra de negócio mudou — validação, referências compiladas, ações
 * permitidas e a trava que impede desmarcar uma ação em uso continuam iguais.
 */
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, Loader2, MessagesSquare, Save, Wand2, X, Zap,
} from 'lucide-react';
import {
  WA_AI_ACTIONS,
  WA_AI_MODELS,
  WA_AI_MODELS_PRICED_AT,
  WA_AI_PROVIDERS,
  WA_AI_TYPICAL_TURN_INPUT_TOKENS,
  WA_AI_TYPICAL_TURN_OUTPUT_TOKENS,
  estimateWaAiTurnCostUsd,
  getWaAiModel,
  parseWaAiPromptExpressions,
  pruneWaAiActionRefs,
  validateWaAiPrompt,
} from '../../utils/waAiActionCatalog';
import { formatWaAiFollowupHours, parseWaAiFollowupPlan } from '../../utils/waAiFollowupPlan';
import type {
  WhatsAppAiActionRef, WhatsAppAiAssistantInput, WhatsAppAiTargetOption,
} from '../../types/whatsapp.types';
import { AiPromptEditor } from './aiPromptEditor';
import { AiAgentSimulator } from './aiAgentSimulator';
import { AiPlaybookEditor } from './aiPlaybookEditor';
import { normalizeWaAiPlaybook } from '../../utils/waAiPlaybook';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const BR_TIMEZONES = [
  { label: 'Cuiabá / Manaus — UTC-4', value: 'America/Cuiaba' },
  { label: 'Brasília / São Paulo — UTC-3', value: 'America/Sao_Paulo' },
  { label: 'Rio Branco — UTC-5', value: 'America/Rio_Branco' },
];

const minutesToTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const timeToMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

const fieldStyle: React.CSSProperties = {
  width: '100%', fontSize: '12.5px', padding: '7px 10px', borderRadius: '8px',
  border: '1px solid #d1d5db', background: '#fff', color: '#111827',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 700, color: '#6b7280',
  marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.03em',
};
const hintStyle: React.CSSProperties = { fontSize: '11px', color: '#9ca3af', marginTop: '4px' };

/**
 * Estilos que precisam de pseudo-classe (foco visível, hover do cabeçalho) —
 * o resto continua inline, como no restante da tela de configurações.
 */
const FORM_CSS = `
  .wa-ai-section {
    border: 1px solid #e7e5df; border-radius: 10px; background: #fff; overflow: hidden;
  }
  .wa-ai-section-head {
    display: flex; align-items: center; gap: 11px; width: 100%;
    padding: 13px 14px; background: transparent; border: none; text-align: left;
    font: inherit; cursor: pointer;
  }
  .wa-ai-section-head[aria-expanded] { cursor: pointer; }
  .wa-ai-section-head:hover { background: #fbfaf8; }
  .wa-ai-section-head:focus-visible,
  .wa-ai-chip-toggle:focus-visible,
  .wa-ai-day:focus-visible {
    outline: 2px solid #ea6c00; outline-offset: -2px;
  }
  .wa-ai-static-head { display: flex; align-items: center; gap: 11px; padding: 13px 14px; }
  .wa-ai-section-num {
    flex-shrink: 0; width: 22px; height: 22px; border-radius: 999px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; color: #b45309; background: #fff3e6;
  }
  .wa-ai-section-title { font-size: 12.5px; font-weight: 700; color: #374151; }
  .wa-ai-section-summary {
    display: block; font-size: 11.5px; color: #9ca3af; margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis;
  }
  .wa-ai-section-body { padding: 0 14px 14px; }
  .wa-ai-chev { flex-shrink: 0; color: #9ca3af; transition: transform .16s ease; }
  .wa-ai-chev.open { transform: rotate(180deg); }
  .wa-ai-details > summary {
    cursor: pointer; font-size: 11.5px; color: #6b7280; list-style: none;
    display: inline-flex; align-items: center; gap: 5px;
  }
  .wa-ai-details > summary::-webkit-details-marker { display: none; }
  .wa-ai-details > summary:focus-visible { outline: 2px solid #ea6c00; outline-offset: 2px; border-radius: 4px; }
  .wa-ai-apply {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 13px; font-size: 12px; font-weight: 600; color: #fff;
    background: #ea6c00; border: none; border-radius: 8px; cursor: pointer;
  }
  .wa-ai-apply:hover { background: #d46000; }
  .wa-ai-apply:disabled { opacity: .45; cursor: not-allowed; }
  .wa-ai-apply:focus-visible { outline: 2px solid #b45309; outline-offset: 2px; }
  .wa-ai-footer {
    position: sticky; bottom: 0; z-index: 5;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    flex-wrap: wrap; padding: 12px 14px; margin-top: 2px;
    border: 1px solid #e7e5df; border-radius: 10px;
    background: rgba(255,255,255,.96); backdrop-filter: blur(8px);
    box-shadow: 0 -6px 18px rgba(15,23,42,.06);
  }
  @media (max-width: 640px) {
    .wa-ai-footer { flex-direction: column; align-items: stretch; }
    .wa-ai-footer .wa-ai-footer-actions { justify-content: flex-end; }
  }
`;

type SectionKey = 'identity' | 'do' | 'dont' | 'actions' | 'playbook' | 'tuning';

interface Props {
  draft: WhatsAppAiAssistantInput;
  targets: WhatsAppAiTargetOption[];
  saving: boolean;
  onPatch: (patch: Partial<WhatsAppAiAssistantInput>) => void;
  onCancel: () => void;
  /** Recebe as referências vivas — as órfãs já foram podadas. */
  onSave: (refs: WhatsAppAiActionRef[]) => void;
}

export const AiAssistantForm: React.FC<Props> = ({
  draft, targets, saving, onPatch, onCancel, onSave,
}) => {
  // Estado de abertura: só identificação e "o que deve fazer" começam abertas.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    identity: true, do: true, dont: false, actions: false, playbook: false, tuning: false,
  });
  const [testando, setTestando] = useState(false);
  const toggle = (key: SectionKey) => setOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Ações e referências ─────────────────────────────────────

  const addRef = (ref: WhatsAppAiActionRef) => {
    const already = (draft.action_refs || []).some(r =>
      r.action === ref.action && r.target_id === ref.target_id);
    if (already) return;
    onPatch({ action_refs: [...(draft.action_refs || []), ref] });
  };

  const useAction = (action: string) => {
    const allowed = draft.allowed_actions || [];
    if (allowed.includes(action)) return;
    onPatch({ allowed_actions: [...allowed, action] });
  };

  /**
   * Desmarcar uma ação que o texto ainda usa quebraria o agente em silêncio: o
   * prompt mandaria fazer algo que o backend recusa. Por isso avisamos QUAIS
   * trechos dependem dela antes de permitir a remoção.
   */
  const toggleAction = (action: string, checked: boolean) => {
    if (checked) { useAction(action); return; }

    const usos = [
      ...parseWaAiPromptExpressions(draft.instructions_do || ''),
      ...parseWaAiPromptExpressions(draft.instructions_dont || ''),
    ].filter(e => e.action === action);

    if (usos.length > 0) {
      const lista = usos.map(u => `  • ${u.raw}`).join('\n');
      const titulo = WA_AI_ACTIONS.find(a => a.name === action)?.title || action;
      const ok = window.confirm(
        `Estes trechos do prompt ainda usam "${titulo}":\n\n${lista}\n\n`
        + 'Se você desmarcar a ação, o agente não conseguirá executá-la e o prompt ficará inválido. Remover mesmo assim?',
      );
      if (!ok) return;
    }

    onPatch({ allowed_actions: (draft.allowed_actions || []).filter(a => a !== action) });
  };

  // As referências órfãs somem à medida que o texto muda, para o resumo abaixo
  // do editor sempre refletir o que está escrito agora.
  const liveRefs = useMemo(() => pruneWaAiActionRefs(
    (draft.action_refs || []) as WhatsAppAiActionRef[],
    draft.instructions_do || '', draft.instructions_dont || ''),
  [draft.action_refs, draft.instructions_do, draft.instructions_dont]);

  const issuesDo = useMemo(
    () => validateWaAiPrompt(draft.instructions_do || '', liveRefs, draft.allowed_actions || []),
    [draft.instructions_do, draft.allowed_actions, liveRefs]);
  const issuesDont = useMemo(
    () => validateWaAiPrompt(draft.instructions_dont || '', liveRefs, draft.allowed_actions || []),
    [draft.instructions_dont, draft.allowed_actions, liveRefs]);

  const blockingIssues = [...issuesDo, ...issuesDont].filter(i => i.level === 'erro').length;
  const dontWarnings = issuesDont.filter(i => i.level === 'aviso').length;

  // ── Resumos das seções fechadas ─────────────────────────────

  const selectedActions = draft.allowed_actions || [];
  const actionsSummary = selectedActions.length === 0
    ? 'Nenhuma ação selecionada'
    : `${selectedActions.length} ação(ões) selecionada(s)`;

  const dontText = (draft.instructions_dont || '').trim();
  const dontSummary = dontText
    ? `${dontText.replace(/\s+/g, ' ').slice(0, 90)}${dontText.length > 90 ? '…' : ''}`
    : 'Defina o que a IA não pode prometer, informar ou executar.';

  // O resumo da seção fechada conta o que o BACKEND vai ler, não o que está
  // digitado: campo sem chave não existe para ele.
  const playbookLido = useMemo(() => normalizeWaAiPlaybook(draft.playbook), [draft.playbook]);
  const playbookSummary = playbookLido
    ? `${playbookLido.fields.length} informação(ões) · ${playbookLido.stages.length} etapa(s)`
      + ` · ${playbookLido.cuts.length} regra(s) de corte`
    : 'Sem roteiro — o agente responde em texto livre, sem conferência do sistema.';

  const tuningSummary = `Debounce: ${draft.debounce_seconds ?? 8} segundos`
    + ` · Histórico: ${draft.history_limit ?? 12} mensagens`;

  const modelDef = getWaAiModel(draft.provider || '', draft.model || '');
  const providerLabel = (id: string) => WA_AI_PROVIDERS.find(p => p.id === id)?.label || id;
  const identitySummary = [
    draft.name?.trim() || 'Sem nome',
    draft.is_active !== false ? 'ativo' : 'inativo',
    draft.mode === 'auto' ? 'automático' : 'modo de teste',
    modelDef?.label || draft.model || '—',
  ].join(' · ');

  const doText = (draft.instructions_do || '').trim();
  const doSummary = doText
    ? `${doText.replace(/\s+/g, ' ').slice(0, 90)}${doText.length > 90 ? '…' : ''}`
    : 'Objetivo, estilo e roteiro do atendimento.';

  const followupSummary = draft.followup_enabled
    ? `Até ${draft.followup_max_attempts ?? 3} tentativa(s) · `
      + (draft.followup_strategy === 'custom'
        ? formatWaAiFollowupHours((draft.followup_custom_hours || []).map(Number)) || 'sem intervalos'
        : `a cada ${draft.followup_interval_hours ?? 24}h`)
      + ` · ${minutesToTime(draft.followup_start_minute ?? 480)}–${minutesToTime(draft.followup_end_minute ?? 1080)}`
    : 'Desligado — o agente só responde quando o cliente escreve.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <style>{FORM_CSS}</style>

      {/* ── 1. Identificação ── */}
      <Section
        id="identity" num={1} title="Identificação" summary={identitySummary}
        open={open.identity} onToggle={() => toggle('identity')}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <div>
            <label style={labelStyle} htmlFor="wa-ai-nome">Nome do agente</label>
            <input id="wa-ai-nome" style={fieldStyle} value={draft.name}
              onChange={e => onPatch({ name: e.target.value })} placeholder="Ex.: Triagem inicial" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="wa-ai-desc">Descrição (opcional)</label>
            <input id="wa-ai-desc" style={fieldStyle} value={draft.description || ''}
              onChange={e => onPatch({ description: e.target.value })} placeholder="Para que serve este agente" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '18px', marginTop: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
            <input type="checkbox" checked={draft.is_active !== false}
              onChange={e => onPatch({ is_active: e.target.checked })} />
            <span style={{ fontSize: '12.5px', color: '#1f2937' }}>Agente ativo</span>
          </label>
          <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <legend style={{
              float: 'left', fontSize: '12.5px', color: '#1f2937', fontWeight: 600, padding: 0, marginRight: '10px',
            }}>Modo:</legend>
            {(['test', 'auto'] as const).map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                <input type="radio" name="wa-ai-mode" checked={draft.mode === m}
                  onChange={() => onPatch({ mode: m })} />
                <span style={{ fontSize: '12.5px', color: '#374151' }}>
                  {m === 'test' ? 'Teste' : 'Automático'}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <p style={{ ...hintStyle, marginTop: '6px' }}>
          Em <strong>teste</strong>, a IA gera a resposta e registra as ações que faria, sem enviar nada ao cliente
          e sem executar efeito nenhum. Em <strong>automático</strong>, ela envia e executa.
        </p>

        <div style={{ marginTop: '14px' }}>
          <label style={labelStyle} htmlFor="wa-ai-model">Inteligência e modelo</label>
          <ModelPicker
            provider={draft.provider || ''}
            model={draft.model || ''}
            onPick={(provider, model) => onPatch({ provider, model })}
          />
        </div>
      </Section>

      {/* ── 2. O que deve fazer ── */}
      <Section
        id="do" num={2} title="O que este agente deve fazer" summary={doSummary}
        open={open.do} onToggle={() => toggle('do')}
      >
        <p style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '8px' }}>
          Objetivo, estilo, o que perguntar e em que ordem. Digite{' '}
          <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: '4px' }}>ação=</code>{' '}
          para inserir uma ação do sistema.
        </p>
        <AiPromptEditor
          id="wa-ai-do"
          value={draft.instructions_do || ''}
          onChange={v => onPatch({ instructions_do: v })}
          refs={liveRefs}
          onAddRef={addRef}
          onUseAction={useAction}
          targets={targets}
          issues={issuesDo}
          rows={12}
          placeholder={'Ex.: Cumprimente pelo nome e descubra o assunto.\n'
            + 'Pergunte o nome completo e o que aconteceu, uma coisa de cada vez.\n'
            + 'Se for assunto trabalhista, ação='}
        />
      </Section>

      {/* ── 3. Limites do atendimento ── */}
      <Section
        id="dont" num={3} title="Limites do atendimento" summary={dontSummary}
        badge={dontWarnings > 0 ? `${dontWarnings} aviso(s)` : undefined}
        open={open.dont} onToggle={() => toggle('dont')}
      >
        <p style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '8px' }}>
          O que este agente NÃO pode fazer. Ex.: não prometer resultado, não informar honorários, não inventar
          andamento processual, não dar parecer jurídico definitivo.
        </p>
        <AiPromptEditor
          id="wa-ai-dont"
          value={draft.instructions_dont || ''}
          onChange={v => onPatch({ instructions_dont: v })}
          refs={[]}
          onAddRef={addRef}
          onUseAction={useAction}
          targets={targets}
          issues={issuesDont}
          rows={8}
          placeholder={'Ex.: Nunca prometa resultado nem estime valores de indenização.\n'
            + 'Nunca informe honorários.'}
        />
      </Section>

      {/* ── 4. Ações disponíveis (multiselect) ── */}
      <Section
        id="actions" num={4} title="Ações disponíveis" summary={actionsSummary}
        open={open.actions} onToggle={() => toggle('actions')}
        headerExtra={!open.actions && selectedActions.length > 0 ? (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
            {selectedActions.map(name => (
              <span key={name} style={{
                fontSize: '10.5px', fontWeight: 600, color: '#b45309', background: '#fff7ed',
                border: '1px solid #fed7aa', borderRadius: '999px', padding: '2px 8px',
              }}>
                {WA_AI_ACTIONS.find(a => a.name === name)?.title || name}
              </span>
            ))}
          </div>
        ) : undefined}
      >
        <p style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '10px' }}>
          Só o que estiver marcado aqui é oferecido ao modelo — e só isso pode ser executado.
        </p>
        <div role="group" aria-label="Ações permitidas ao agente"
          style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {WA_AI_ACTIONS.map(def => {
            const checked = selectedActions.includes(def.name);
            const semDestino = def.targetSource !== 'none'
              && !liveRefs.some(r => r.action === def.name && r.target_id);
            return (
              <label key={def.name} style={{
                display: 'flex', alignItems: 'flex-start', gap: '9px', cursor: 'pointer',
                padding: '8px 10px', borderRadius: '8px',
                border: `1px solid ${checked ? '#fed7aa' : '#f1efe9'}`,
                background: checked ? '#fffbf5' : '#fff',
              }}>
                <input type="checkbox" checked={checked} style={{ marginTop: '2px', flexShrink: 0 }}
                  onChange={e => toggleAction(def.name, e.target.checked)} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#111827' }}>{def.title}</span>
                  <span style={{ display: 'block', fontSize: '11.5px', color: '#6b7280', marginTop: '2px' }}>
                    {def.description}
                  </span>
                  {checked && semDestino && (
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px',
                      fontSize: '11px', color: '#92400e',
                    }}>
                      <AlertTriangle size={11} />
                      Sem destino escolhido no prompt — a ação não será oferecida ao modelo.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </Section>

      {/* ── 5. Roteiro da triagem ── */}
      <Section
        id="playbook" num={5} title="Roteiro da triagem" summary={playbookSummary}
        open={open.playbook} onToggle={() => toggle('playbook')}
      >
        <AiPlaybookEditor
          value={draft.playbook}
          onChange={playbook => onPatch({ playbook })}
        />
      </Section>

      {/* ── 6. Acompanhamentos ── */}
      <Section
        id="followup" num={6} title="Acompanhamentos" summary={followupSummary} collapsible={false}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.followup_enabled === true}
            onChange={e => onPatch({ followup_enabled: e.target.checked })} />
          <span style={{ fontSize: '12.5px', color: '#1f2937', fontWeight: 600 }}>
            Permitir que o agente retome o contato
          </span>
        </label>

        {draft.followup_enabled && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '14px',
            marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #ece7df',
          }}>
            <div>
              <label style={labelStyle} htmlFor="wa-ai-fu">Como devem ser os acompanhamentos</label>
              <textarea id="wa-ai-fu" rows={5} style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }}
                value={draft.followup_instructions || ''}
                onChange={e => onPatch({ followup_instructions: e.target.value })}
                placeholder={'Escreva como você explicaria para um estagiário. Ex.:\n'
                  + 'Primeiro acompanhamento em 2 horas, depois 4, 8, 24, 48, 7 dias, 10, 14 — no máximo 30 dias.\n'
                  + 'Só em horário comercial, das 08 às 18h00 de Cuiabá.\n'
                  + 'Cada retomada é personalizada: veja em que estágio a conversa parou, cumprimente com bom dia, '
                  + 'boa tarde ou boa noite e pergunte o que ficou pendente (ainda tem interesse, conseguiu assinar, '
                  + 'faltam documentos).'} />
              <p style={hintStyle}>
                Este texto vai inteiro para o modelo — é ele que faz cada retomada ser diferente. Os horários que
                você escrever aqui podem virar agendamento com um clique abaixo.
              </p>
            </div>

            <FollowupPlanReader
              text={draft.followup_instructions || ''}
              draft={draft}
              onApply={onPatch}
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
              <div>
                <label style={labelStyle} htmlFor="wa-ai-fu-max">Máximo de tentativas</label>
                <input id="wa-ai-fu-max" type="number" min={1} max={10} style={fieldStyle}
                  value={draft.followup_max_attempts ?? 3}
                  onChange={e => onPatch({ followup_max_attempts: Number(e.target.value) })} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="wa-ai-fu-strategy">Estratégia</label>
                <select id="wa-ai-fu-strategy" style={fieldStyle} value={draft.followup_strategy || 'fixed'}
                  onChange={e => onPatch({ followup_strategy: e.target.value as WhatsAppAiAssistantInput['followup_strategy'] })}>
                  <option value="fixed">Intervalo fixo</option>
                  <option value="progressive">Intervalo progressivo (dobra a cada vez)</option>
                  <option value="custom">Personalizado</option>
                </select>
              </div>
              {draft.followup_strategy !== 'custom' ? (
                <div>
                  <label style={labelStyle} htmlFor="wa-ai-fu-interval">Intervalo (horas)</label>
                  {/* Desce a minutos: "10 minutos sem resposta" é 0,1667 — o
                      degrau mais curto e o mais usado nas campanhas. */}
                  <input id="wa-ai-fu-interval" type="number" min={0.0167} step={0.25} style={fieldStyle}
                    value={draft.followup_interval_hours ?? 24}
                    onChange={e => onPatch({ followup_interval_hours: Number(e.target.value) })} />
                </div>
              ) : (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle} htmlFor="wa-ai-fu-hours">Intervalos, em horas, na ordem</label>
                  <input id="wa-ai-fu-hours" style={fieldStyle}
                    value={(draft.followup_custom_hours || []).join(', ')}
                    onChange={e => onPatch({
                      followup_custom_hours: e.target.value.split(',')
                        .map(v => Number(v.trim())).filter(v => Number.isFinite(v) && v > 0),
                    })}
                    placeholder="4, 24, 72" />
                  <p style={hintStyle}>
                    A primeira tentativa usa o primeiro valor, a segunda o segundo, e assim por diante.
                    Ordem decrescente também vale: <code>72, 24, 4</code>. Para minutos, use fração:{' '}
                    <code>0.1667</code> são 10 minutos.
                  </p>
                </div>
              )}
            </div>

            <div role="group" aria-label="Dias permitidos para acompanhamento">
              <span style={labelStyle}>Dias permitidos</span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {DAY_NAMES.map((name, dow) => {
                  const on = (draft.followup_days || []).includes(dow);
                  return (
                    <button
                      key={dow}
                      type="button"
                      className="wa-ai-day"
                      aria-pressed={on}
                      onClick={() => onPatch({
                        followup_days: on
                          ? (draft.followup_days || []).filter(d => d !== dow)
                          : [...(draft.followup_days || []), dow].sort((a, b) => a - b),
                      })}
                      style={{
                        fontSize: '11.5px', fontWeight: 600, padding: '5px 11px', borderRadius: '999px',
                        cursor: 'pointer',
                        border: `1px solid ${on ? '#ea6c00' : '#d1d5db'}`,
                        background: on ? '#fff7ed' : '#fff',
                        color: on ? '#b45309' : '#6b7280',
                      }}
                    >{name}</button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <div>
                <label style={labelStyle} htmlFor="wa-ai-fu-from">A partir de</label>
                <input id="wa-ai-fu-from" type="time" style={fieldStyle}
                  value={minutesToTime(draft.followup_start_minute ?? 480)}
                  onChange={e => onPatch({ followup_start_minute: timeToMinutes(e.target.value) })} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="wa-ai-fu-to">Até</label>
                <input id="wa-ai-fu-to" type="time" style={fieldStyle}
                  value={minutesToTime(draft.followup_end_minute ?? 1080)}
                  onChange={e => onPatch({ followup_end_minute: timeToMinutes(e.target.value) })} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="wa-ai-fu-tz">Fuso horário do canal</label>
                <select id="wa-ai-fu-tz" style={fieldStyle} value={draft.timezone || 'America/Cuiaba'}
                  onChange={e => onPatch({ timezone: e.target.value })}>
                  {BR_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>
            </div>

            <p style={{ fontSize: '11px', color: '#9ca3af' }}>
              O acompanhamento para sozinho quando o cliente responde, quando a conversa é encerrada ou assumida
              por um atendente, e quando a IA é desligada. Documentos, preenchimento e assinatura já têm cobrança
              automática própria — não configure follow-up para eles aqui.
            </p>
          </div>
        )}
      </Section>

      {/* ── 6. Ajustes finos ── */}
      <Section
        id="tuning" num={7} title="Ajustes finos" summary={tuningSummary}
        open={open.tuning} onToggle={() => toggle('tuning')}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <div>
            <label style={labelStyle} htmlFor="wa-ai-debounce">Agrupar mensagens por (segundos)</label>
            <input id="wa-ai-debounce" type="number" min={0} max={60} style={fieldStyle}
              value={draft.debounce_seconds ?? 8}
              onChange={e => onPatch({ debounce_seconds: Number(e.target.value) })} />
            <p style={hintStyle}>
              Mensagens seguidas do cliente dentro desta janela viram uma resposta só.
            </p>
          </div>
          <div>
            <label style={labelStyle} htmlFor="wa-ai-history">Mensagens de histórico no contexto</label>
            <input id="wa-ai-history" type="number" min={2} max={40} style={fieldStyle}
              value={draft.history_limit ?? 12}
              onChange={e => onPatch({ history_limit: Number(e.target.value) })} />
            <p style={hintStyle}>
              O que vem antes disso é sustentado pelo resumo da memória da conversa.
            </p>
          </div>
        </div>
      </Section>

      {/* ── Rodapé ── */}
      <div className="wa-ai-footer">
        <span
          role="status"
          style={{ fontSize: '11.5px', color: blockingIssues ? '#b91c1c' : '#6b7280' }}
        >
          {blockingIssues > 0
            ? `${blockingIssues} problema(s) no prompt impedem o salvamento — veja o detalhe em cada campo.`
            : 'Prompt válido.'}
        </span>
        <div className="wa-ai-footer-actions" style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="settings-btn-ghost" onClick={() => setTestando(true)}>
            <MessagesSquare size={13} /> Testar agente
          </button>
          <button type="button" className="settings-btn-ghost" onClick={onCancel}><X size={13} /> Cancelar</button>
          <button type="button" className="settings-btn-primary" onClick={() => onSave(liveRefs)}
            disabled={saving || blockingIssues > 0}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar agente
          </button>
        </div>
      </div>

      {/* A prévia recebe as referências VIVAS: é o que o agente teria de verdade. */}
      {testando && (
        <AiAgentSimulator
          draft={{ ...draft, action_refs: liveRefs }}
          onClose={() => setTestando(false)}
        />
      )}
    </div>
  );
};

// ── Peças pequenas ──────────────────────────────────────────────────────────

/**
 * Bloco de seção. Com `collapsible={false}` o cabeçalho continua informando
 * número, título e resumo, mas o conteúdo fica sempre visível — é o caso dos
 * acompanhamentos, cujo próprio switch já é a divulgação progressiva.
 */
const Section: React.FC<{
  id: string;
  num: number;
  title: string;
  summary: string;
  badge?: string;
  open?: boolean;
  onToggle?: () => void;
  collapsible?: boolean;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, num, title, summary, badge, open = true, onToggle, collapsible = true, headerExtra, children }) => {
  const headId = `wa-ai-sec-${id}-head`;
  const bodyId = `wa-ai-sec-${id}-body`;
  const head = (
    <>
      <span className="wa-ai-section-num" aria-hidden="true">{num}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="wa-ai-section-title">{title}</span>
        {badge && (
          <span style={{
            marginLeft: '7px', fontSize: '10px', fontWeight: 700, padding: '2px 7px',
            borderRadius: '999px', background: '#fffbeb', color: '#92400e',
          }}>{badge}</span>
        )}
        <span className="wa-ai-section-summary">{summary}</span>
        {headerExtra}
      </span>
    </>
  );

  return (
    <section className="wa-ai-section">
      {collapsible ? (
        <button
          type="button"
          id={headId}
          className="wa-ai-section-head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          {head}
          <ChevronDown size={16} className={`wa-ai-chev${open ? ' open' : ''}`} aria-hidden="true" />
        </button>
      ) : (
        <div className="wa-ai-static-head" id={headId}>{head}</div>
      )}
      {(!collapsible || open) && (
        <div className="wa-ai-section-body" id={bodyId} role="region" aria-labelledby={headId}>
          {children}
        </div>
      )}
    </section>
  );
};

/**
 * Lê o acompanhamento escrito em português e oferece o agendamento pronto.
 *
 * A leitura é local e determinística (`waAiFollowupPlan`): a tela mostra o que
 * entendeu ANTES de mexer em qualquer campo, e só o clique aplica. Os campos
 * continuam sendo os mesmos de sempre — dá para conferir e corrigir logo
 * abaixo. Nada aqui muda a política de follow-up; só preenche o formulário.
 */
const FollowupPlanReader: React.FC<{
  text: string;
  draft: WhatsAppAiAssistantInput;
  onApply: (patch: Partial<WhatsAppAiAssistantInput>) => void;
}> = ({ text, draft, onApply }) => {
  const plan = useMemo(() => parseWaAiFollowupPlan(text), [text]);
  const temAlgo = plan.hours.length > 0 || plan.startMinute !== null || plan.timezone !== null;
  if (!temAlgo && plan.warnings.length === 0) return null;

  const mesmaEscada = plan.hours.length > 0
    && draft.followup_strategy === 'custom'
    && (draft.followup_custom_hours || []).length === plan.hours.length
    && (draft.followup_custom_hours || []).every((h, i) => Number(h) === plan.hours[i]);
  const mesmaJanela = plan.startMinute === null
    || ((draft.followup_start_minute ?? 480) === plan.startMinute
      && (draft.followup_end_minute ?? 1080) === plan.endMinute);
  const mesmoFuso = plan.timezone === null || (draft.timezone || 'America/Cuiaba') === plan.timezone;
  const aplicado = (plan.hours.length === 0 || mesmaEscada) && mesmaJanela && mesmoFuso;

  const aplicar = () => {
    const patch: Partial<WhatsAppAiAssistantInput> = {};
    if (plan.hours.length > 0) {
      patch.followup_strategy = 'custom';
      patch.followup_custom_hours = plan.hours;
      patch.followup_max_attempts = plan.maxAttempts;
    }
    if (plan.startMinute !== null && plan.endMinute !== null) {
      patch.followup_start_minute = plan.startMinute;
      patch.followup_end_minute = plan.endMinute;
    }
    if (plan.days) patch.followup_days = plan.days;
    if (plan.timezone) patch.timezone = plan.timezone;
    onApply(patch);
  };

  return (
    <div style={{
      padding: '10px 12px', borderRadius: '9px',
      background: '#fffbf5', border: '1px solid #fdebd6',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <Wand2 size={12} style={{ color: '#b45309' }} aria-hidden="true" />
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '.03em' }}>
          O que dá para agendar com este texto
        </span>
      </div>

      {plan.hours.length > 0 && (
        <p style={{ fontSize: '12px', color: '#374151' }}>
          <strong>{plan.maxAttempts} tentativa(s):</strong> {formatWaAiFollowupHours(plan.hours)}
        </p>
      )}
      <ul style={{ margin: '4px 0 0', paddingLeft: '15px', listStyle: 'disc' }}>
        {plan.notes.slice(plan.hours.length > 0 ? 1 : 0).map((nota, i) => (
          <li key={i} style={{ fontSize: '11.5px', color: '#6b7280' }}>{nota}</li>
        ))}
        {plan.warnings.map((aviso, i) => (
          <li key={`w${i}`} style={{ fontSize: '11.5px', color: '#92400e' }}>{aviso}</li>
        ))}
      </ul>

      {temAlgo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '9px', flexWrap: 'wrap' }}>
          <button type="button" className="wa-ai-apply" onClick={aplicar} disabled={aplicado}>
            <Wand2 size={12} aria-hidden="true" /> Aplicar ao agendamento
          </button>
          {aplicado && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#047857' }}>
              <Check size={12} aria-hidden="true" /> Os campos abaixo já estão assim.
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Escolha da IA e do modelo, com o custo à vista.
 *
 * A lista fica dentro de um select fechado; só o modelo escolhido ganha o
 * resumo com preço. O número mostrado é uma ESTIMATIVA por 100 atendimentos,
 * calculada sobre um turno típico deste assistente. Serve para comparar
 * modelos — a fatura é do provedor, e a tabela dele muda quando ele quiser.
 */
const ModelPicker: React.FC<{
  provider: string;
  model: string;
  onPick: (provider: string, model: string) => void;
}> = ({ provider, model, onPick }) => {
  const indisponiveis = WA_AI_PROVIDERS.filter(p => !p.available);
  const current = `${provider}:${model}`;
  const def = getWaAiModel(provider, model);
  const por100 = def
    ? (estimateWaAiTurnCostUsd(
        def.provider, def.id, WA_AI_TYPICAL_TURN_INPUT_TOKENS, WA_AI_TYPICAL_TURN_OUTPUT_TOKENS) ?? 0) * 100
    : 0;

  return (
    <div>
      <select
        id="wa-ai-model"
        style={fieldStyle}
        value={current}
        onChange={e => {
          const [p, ...rest] = e.target.value.split(':');
          onPick(p, rest.join(':'));
        }}
      >
        {/* Agente gravado com um modelo que saiu da lista: a opção continua
            existindo para não trocar o modelo dele sem ninguém pedir. */}
        {!def && (
          <option value={current}>{model || '—'} (fora da lista atual)</option>
        )}
        {WA_AI_MODELS.map(m => (
          <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
            {m.label} — {WA_AI_PROVIDERS.find(p => p.id === m.provider)?.label || m.provider}
            {m.recommended ? ' · Recomendado' : ''}
          </option>
        ))}
      </select>

      {def ? (
        <div style={{
          marginTop: '8px', padding: '9px 11px', borderRadius: '9px',
          background: '#fffbf5', border: '1px solid #fdebd6',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#111827' }}>{def.label}</span>
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              {WA_AI_PROVIDERS.find(p => p.id === def.provider)?.label || def.provider}
            </span>
            {def.recommended && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px',
                background: '#ecfdf5', color: '#047857',
              }}><Zap size={9} /> RECOMENDADO</span>
            )}
          </div>
          <p style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '4px' }}>{def.notes}</p>
          <p style={{ fontSize: '11px', color: '#374151', marginTop: '4px' }}>
            US$ {def.inputCostPerMTok.toFixed(2)} por 1M de tokens de entrada ·{' '}
            US$ {def.outputCostPerMTok.toFixed(2)} de saída ·{' '}
            <strong>≈ US$ {por100.toFixed(2)} a cada 100 atendimentos</strong>
          </p>
        </div>
      ) : (
        <p style={{ fontSize: '11.5px', color: '#92400e', marginTop: '8px' }}>
          Este modelo não está mais na lista suportada. Escolha um dos disponíveis para o agente voltar a rodar.
        </p>
      )}

      <details className="wa-ai-details" style={{ marginTop: '8px' }}>
        <summary>
          <ChevronDown size={12} aria-hidden="true" /> Preços e disponibilidade
        </summary>
        <p style={{ ...hintStyle, marginTop: '6px' }}>
          Preços de referência anotados em {WA_AI_MODELS_PRICED_AT}; confirme na fatura do provedor.
          {indisponiveis.length > 0 && (
            <> Indisponíveis nesta versão: {indisponiveis.map(p => `${p.label} (${p.unavailableReason})`).join(' ')}</>
          )}
        </p>
      </details>
    </div>
  );
};

export default AiAssistantForm;

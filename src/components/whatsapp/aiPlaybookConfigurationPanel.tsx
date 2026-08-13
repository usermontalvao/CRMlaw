import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Database, Settings2, ShieldCheck } from 'lucide-react';
import type { WhatsAppAiTargetOption } from '../../types/whatsapp.types';
import { getWaAiAction } from '../../utils/waAiActionCatalog';
import type {
  WaAiCutRule, WaAiPlaybook, WaAiPlaybookBinding, WaAiPlaybookCut,
} from '../../utils/waAiPlaybook';

interface Props {
  playbook: WaAiPlaybook;
  targets: WhatsAppAiTargetOption[];
  onBindingChange: (key: string, target: WhatsAppAiTargetOption | null) => void;
}

const TYPE_LABELS: Record<string, string> = {
  texto: 'Texto', data_mes_ano: 'Mês/ano', bool: 'Sim ou não', enum: 'Lista',
  numero: 'Número', hora: 'Horário',
};

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: '8px',
  background: '#fff', color: '#111827', fontSize: '12px',
};

const normalized = (value: string) => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function availableTargets(binding: WaAiPlaybookBinding, targets: WhatsAppAiTargetOption[]) {
  const action = getWaAiAction(binding.action);
  if (action?.targetSource === 'document_template') {
    return targets.filter(target => target.type === 'document_template');
  }
  if (action?.targetSource === 'user_or_department') {
    return targets.filter(target => target.type === 'user' || target.type === 'department');
  }
  return [];
}

function selectedTarget(binding: WaAiPlaybookBinding, options: WhatsAppAiTargetOption[]) {
  if (binding.targetId) return options.find(option => option.id === binding.targetId) || null;
  const label = binding.targetLabel || binding.suggestedTargetLabel || '';
  const matches = options.filter(option => normalized(option.label) === normalized(label));
  return matches.length === 1 ? matches[0] : null;
}

function fieldLabel(playbook: WaAiPlaybook, key: string) {
  return playbook.fields.find(field => field.key === key)?.label || key.replace(/_/g, ' ');
}

function ruleText(rule: WaAiCutRule, playbook: WaAiPlaybook) {
  if (rule.kind === 'older_than') {
    return `${fieldLabel(playbook, rule.field)} anterior à janela de ${rule.years} ${rule.years === 1 ? 'ano' : 'anos'}`;
  }
  if (rule.kind === 'field_equals') {
    return `${fieldLabel(playbook, rule.field)} = ${rule.values.join(' ou ')}`;
  }
  return `${rule.fields.map(key => fieldLabel(playbook, key)).join(' e ')} = ${rule.value}`;
}

function cutTitle(cut: WaAiPlaybookCut) {
  if (cut.id === 'prazo_2_anos') return 'Prescrição: prazo de 2 anos';
  if (cut.id === 'orgao_publico') return 'Empregador é órgão público';
  if (cut.id === 'sem_pessoalidade') return 'Outra pessoa podia substituir';
  if (cut.id === 'sem_pagamento') return 'Trabalho sem pagamento';
  if (cut.id === 'trabalho_esporadico') return 'Trabalho apenas esporádico';
  if (cut.id === 'sem_subordinacao') return 'Sem direção ou cobrança';
  if (cut.id === 'sem_prova_nem_testemunha') return 'Sem prova e sem testemunha';
  if (cut.id === 'prazo_2_anos_conta') return 'Ocorrência fora dos últimos 2 anos';
  if (cut.id === 'houve_aviso_previo') return 'Banco avisou previamente';
  if (cut.id === 'sem_print_conta') return 'Sem print do bloqueio ou encerramento';
  if (cut.id === 'declarante_sem_documento') return 'Declarante sem documento';
  if (cut.id === 'honorarios_nao_aceitos') return 'Honorários de 40% não aceitos';
  return cut.id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** Configurações operacionais e mapa de coleta que ficam fora do JSON visível. */
export const AiPlaybookConfigurationPanel: React.FC<Props> = ({
  playbook, targets, onBindingChange,
}) => {
  const bindings = playbook.bindings || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginTop: '18px' }}>
      <section aria-labelledby="wa-ai-flow-config-title" style={{
        borderTop: '1px solid #e7e5df', paddingTop: '16px',
      }}>
        <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', marginBottom: '11px' }}>
          <Settings2 size={17} style={{ color: '#b45309', marginTop: '1px', flexShrink: 0 }} />
          <div>
            <h4 id="wa-ai-flow-config-title" style={{ margin: 0, fontSize: '13px', color: '#111827' }}>
              Configure pessoas, setores e modelos
            </h4>
            <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#6b7280' }}>
              O JSON define quando agir. Aqui você escolhe os registros reais do CRM — nomes e IDs
              não ficam misturados às instruções.
            </p>
          </div>
        </div>

        {bindings.length === 0 ? (
          <div style={{ padding: '10px', borderRadius: '8px', background: '#f9fafb',
            fontSize: '11.5px', color: '#6b7280' }}>
            Este roteiro não declarou nenhuma escolha operacional.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '9px' }}>
            {bindings.map(binding => {
              const action = getWaAiAction(binding.action);
              const options = availableTargets(binding, targets);
              const selected = selectedTarget(binding, options);
              const configured = !!selected;
              return (
                <div key={binding.key} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(220px, 1.15fr) minmax(220px, 1fr)',
                  gap: '12px', alignItems: 'center', padding: '11px', borderRadius: '10px',
                  border: `1px solid ${configured ? '#bbf7d0' : '#fed7aa'}`,
                  background: configured ? '#f7fef9' : '#fffbf5',
                }}>
                  <div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {configured
                        ? <CheckCircle2 size={13} style={{ color: '#15803d' }} />
                        : <AlertTriangle size={13} style={{ color: '#b45309' }} />}
                      <strong style={{ fontSize: '12px', color: '#1f2937' }}>{binding.label}</strong>
                    </div>
                    <p style={{ margin: '4px 0 0 19px', fontSize: '11px', color: '#6b7280' }}>
                      {binding.description || action?.description || 'Escolha como esta situação será encaminhada.'}
                    </p>
                  </div>
                  <div>
                    <label htmlFor={`wa-ai-binding-${binding.key}`} style={{
                      display: 'block', fontSize: '10.5px', fontWeight: 700, color: '#6b7280',
                      textTransform: 'uppercase', marginBottom: '4px',
                    }}>
                      {action?.targetSource === 'document_template' ? 'Modelo ou template' : 'Pessoa ou setor'}
                    </label>
                    <select id={`wa-ai-binding-${binding.key}`} style={selectStyle}
                      value={selected?.id || ''}
                      onChange={event => onBindingChange(
                        binding.key, options.find(option => option.id === event.target.value) || null,
                      )}>
                      <option value="">Selecione…</option>
                      {options.map(option => (
                        <option key={`${option.type}:${option.id}`} value={option.id}>
                          {option.label}{option.hint ? ` — ${option.hint}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="wa-ai-collected-fields-title" style={{
        borderTop: '1px solid #e7e5df', paddingTop: '16px',
      }}>
        <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', marginBottom: '11px' }}>
          <Database size={17} style={{ color: '#2563eb', marginTop: '1px', flexShrink: 0 }} />
          <div>
            <h4 id="wa-ai-collected-fields-title" style={{ margin: 0, fontSize: '13px', color: '#111827' }}>
              Informações que o agente vai coletar
            </h4>
            <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#6b7280' }}>
              São {playbook.fields.length} campos estruturados. Cada resposta é validada pelo tipo e
              salva na memória da conversa.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '10px' }}>
          {playbook.stages.map((stage, stageIndex) => {
            const fields = stage.fields
              .map(key => playbook.fields.find(field => field.key === key))
              .filter((field): field is NonNullable<typeof field> => !!field);
            return (
              <div key={stage.id} style={{ border: '1px solid #e5e7eb', borderRadius: '10px', overflow: 'hidden' }}>
                <header style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 10px',
                  background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <span style={{ display: 'inline-flex', width: '19px', height: '19px', borderRadius: '999px',
                    alignItems: 'center', justifyContent: 'center', background: '#dbeafe', color: '#1d4ed8',
                    fontSize: '10px', fontWeight: 700 }}>{stageIndex + 1}</span>
                  <strong style={{ fontSize: '11.5px', color: '#334155' }}>{stage.label}</strong>
                  <span style={{ marginLeft: 'auto', fontSize: '10.5px', color: '#94a3b8' }}>
                    {fields.length} campo(s)
                  </span>
                </header>
                <div>
                  {fields.map((field, index) => (
                    <div key={field.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, .8fr) minmax(250px, 1.5fr)',
                      gap: '12px', padding: '9px 10px', borderTop: index ? '1px solid #f1f5f9' : 'none' }}>
                      <div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '11.5px', color: '#1f2937' }}>{field.label}</strong>
                          <span style={{ fontSize: '9.5px', color: '#475569', background: '#f1f5f9',
                            padding: '1px 6px', borderRadius: '999px' }}>{TYPE_LABELS[field.type] || field.type}</span>
                          <span style={{ fontSize: '9.5px', color: field.required ? '#9a3412' : '#64748b' }}>
                            {field.required ? 'Obrigatório' : 'Opcional'}
                          </span>
                        </div>
                        <code style={{ display: 'block', marginTop: '3px', fontSize: '10px', color: '#94a3b8' }}>
                          {field.key}
                        </code>
                      </div>
                      <div style={{ fontSize: '11px', color: '#475569' }}>
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'flex-start' }}>
                          <ArrowRight size={11} style={{ flexShrink: 0, marginTop: '2px', color: '#94a3b8' }} />
                          <span>{field.question || field.ask}</span>
                        </div>
                        {field.onlyWhen && (
                          <div style={{ marginTop: '4px', color: '#7c3aed', fontSize: '10px' }}>
                            Só aparece quando <code>{field.onlyWhen.field}</code> = <strong>{field.onlyWhen.value}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="wa-ai-system-rules-title" style={{
        borderTop: '1px solid #e7e5df', paddingTop: '16px',
      }}>
        <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', marginBottom: '11px' }}>
          <ShieldCheck size={17} style={{ color: '#047857', marginTop: '1px', flexShrink: 0 }} />
          <div>
            <h4 id="wa-ai-system-rules-title" style={{ margin: 0, fontSize: '13px', color: '#111827' }}>
              Regras automáticas do sistema
            </h4>
            <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#6b7280' }}>
              São conferidas pelo backend depois de cada resposta. O modelo não calcula nem decide esses cortes.
            </p>
          </div>
        </div>

        {playbook.cuts.length === 0 ? (
          <div style={{ padding: '10px', borderRadius: '8px', background: '#f9fafb',
            fontSize: '11.5px', color: '#6b7280' }}>
            Este roteiro não possui regras automáticas de corte.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '9px' }}>
            {playbook.cuts.map(cut => {
              const realtime = cut.rule.kind === 'older_than';
              return (
                <div key={cut.id} style={{
                  padding: '11px', borderRadius: '10px', border: '1px solid #d1fae5', background: '#f6fef9',
                }}>
                  <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '12px', color: '#065f46' }}>{cutTitle(cut)}</strong>
                    <span style={{
                      padding: '2px 7px', borderRadius: '999px', background: '#d1fae5', color: '#047857',
                      fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase',
                    }}>
                      {cut.effect === 'handoff' ? 'Encaminhar' : 'Não qualificar'}
                    </span>
                    {realtime && (
                      <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', color: '#0369a1',
                        fontSize: '9.5px', fontWeight: 700 }}>
                        <Clock3 size={10} /> Tempo real · America/Cuiaba
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#334155' }}>
                    Quando: {ruleText(cut.rule, playbook)}.
                  </p>
                  <p style={{ margin: '3px 0 0', fontSize: '10.5px', color: '#64748b' }}>
                    Resultado: {cut.reason}.
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default AiPlaybookConfigurationPanel;

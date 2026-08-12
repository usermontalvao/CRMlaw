/**
 * Configurações › WhatsApp › Agentes de IA.
 *
 * Substitui a antiga seção "Playbooks IA". Um agente é: duas áreas de instrução
 * em texto livre, uma lista de ações permitidas, um modelo e uma política de
 * follow-up. Não há editor de fluxo, nó, conexão nem construtor de condição —
 * o roteiro do atendimento é o texto que o administrador escreve.
 *
 * O mesmo agente pode servir vários canais; a memória é sempre por conversa.
 *
 * Este arquivo cuida da LISTA, do vínculo com os canais e das chamadas de
 * serviço. O formulário de um agente vive em `aiAssistantForm.tsx`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { WaAiValidationError } from '../../services/whatsapp/aiAssistants';
import type {
  WhatsAppAiActionRef, WhatsAppAiAssistant, WhatsAppAiAssistantInput,
  WhatsAppAiTargetOption, WhatsAppChannel,
} from '../../types/whatsapp.types';
import { AiAssistantForm } from './aiAssistantForm';

/** Agente novo: inativo, em modo de teste e sem nenhuma ação marcada. */
const EMPTY_DRAFT: WhatsAppAiAssistantInput = {
  name: '',
  description: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  is_active: true,
  mode: 'test',
  instructions_do: '',
  instructions_dont: '',
  allowed_actions: [],
  action_refs: [],
  followup_enabled: false,
  followup_instructions: '',
  followup_max_attempts: 3,
  followup_strategy: 'fixed',
  followup_interval_hours: 24,
  followup_custom_hours: [],
  followup_days: [1, 2, 3, 4, 5],
  followup_start_minute: 480,
  followup_end_minute: 1080,
  timezone: 'America/Cuiaba',
  debounce_seconds: 8,
  history_limit: 12,
};

const fieldStyle: React.CSSProperties = {
  width: '100%', fontSize: '12.5px', padding: '7px 10px', borderRadius: '8px',
  border: '1px solid #d1d5db', background: '#fff', color: '#111827',
};
const blockStyle: React.CSSProperties = {
  border: '1px solid #e7e5df', borderRadius: '10px', padding: '14px', background: '#fff',
};

interface Props {
  channels: WhatsAppChannel[];
  onFeedback: (type: 'error' | 'success', msg: string) => void;
}

export const AiAssistantsPanel: React.FC<Props> = ({ channels, onFeedback }) => {
  const [assistants, setAssistants] = useState<WhatsAppAiAssistant[]>([]);
  const [targets, setTargets] = useState<WhatsAppAiTargetOption[]>([]);
  const [bindings, setBindings] = useState<Record<string, { assistant_id: string | null; ai_enabled: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WhatsAppAiAssistantInput | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, transferOpts, documentOpts] = await Promise.all([
        whatsappService.listAiAssistants().catch(() => [] as WhatsAppAiAssistant[]),
        whatsappService.listAiTransferTargets().catch(() => [] as WhatsAppAiTargetOption[]),
        whatsappService.listAiDocumentTargets().catch(() => [] as WhatsAppAiTargetOption[]),
      ]);
      setAssistants(list);
      setTargets([...transferOpts, ...documentOpts]);

      const entries = await Promise.all(channels.map(async ch => {
        const cfg = await whatsappService.getAiChannelConfig(ch.id).catch(() => null);
        return [ch.id, {
          assistant_id: (cfg as any)?.assistant_id ?? null,
          ai_enabled: cfg?.ai_enabled === true,
        }] as const;
      }));
      setBindings(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [channels]);

  useEffect(() => { void load(); }, [load]);

  const patch = (p: Partial<WhatsAppAiAssistantInput>) =>
    setDraft(prev => prev ? { ...prev, ...p } : prev);

  const startNew = () => { setEditingId('new'); setDraft({ ...EMPTY_DRAFT }); };
  const startEdit = (a: WhatsAppAiAssistant) => { setEditingId(a.id); setDraft({ ...a }); };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };

  // ── Persistência ────────────────────────────────────────────

  /** `refs` vem do formulário já podado: só as referências ainda citadas no texto. */
  const save = async (refs: WhatsAppAiActionRef[]) => {
    if (!draft) return;
    setSaving(true);
    try {
      const payload = { ...draft, action_refs: refs };
      if (editingId && editingId !== 'new') await whatsappService.updateAiAssistant(editingId, payload);
      else await whatsappService.createAiAssistant(payload);
      onFeedback('success', 'Agente salvo.');
      cancelEdit();
      await load();
    } catch (e) {
      onFeedback('error', e instanceof WaAiValidationError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: WhatsAppAiAssistant) => {
    if (!window.confirm(`Excluir o agente "${a.name}"?`)) return;
    try {
      await whatsappService.deleteAiAssistant(a.id);
      onFeedback('success', 'Agente excluído.');
      await load();
    } catch (e) {
      onFeedback('error', (e as Error).message);
    }
  };

  const saveBinding = async (channelId: string, next: { assistant_id?: string | null; ai_enabled?: boolean }) => {
    const current = bindings[channelId] || { assistant_id: null, ai_enabled: false };
    const merged = { ...current, ...next };
    setBindings(prev => ({ ...prev, [channelId]: merged }));
    try {
      await whatsappService.setChannelAiAssistant(channelId, merged);
      onFeedback('success', 'Canal atualizado.');
    } catch (e) {
      onFeedback('error', (e as Error).message);
      setBindings(prev => ({ ...prev, [channelId]: current }));
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* ── Lista ── */}
      {!draft && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {assistants.length === 0 && (
              <p style={{ fontSize: '12.5px', color: '#9ca3af' }}>
                Nenhum agente ainda. Crie um, escreva o que ele deve fazer e vincule a um canal.
              </p>
            )}
            {assistants.map(a => {
              const usados = channels.filter(ch => bindings[ch.id]?.assistant_id === a.id);
              return (
                <div key={a.id} style={{ ...blockStyle, display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <Bot size={16} style={{ color: '#ea6c00', marginTop: '2px', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>{a.name}</span>
                      <Badge tone={a.is_active ? 'green' : 'gray'}>{a.is_active ? 'Ativo' : 'Inativo'}</Badge>
                      <Badge tone={a.mode === 'auto' ? 'amber' : 'blue'}>
                        {a.mode === 'auto' ? 'Automático' : 'Modo de teste'}
                      </Badge>
                      <Badge tone="gray">{a.model}</Badge>
                    </div>
                    {a.description && (
                      <p style={{ fontSize: '11.5px', color: '#6b7280', marginTop: '4px' }}>{a.description}</p>
                    )}
                    <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>
                      {a.allowed_actions.length} ação(ões) · {a.followup_enabled ? 'follow-up ativo' : 'sem follow-up'}
                      {usados.length > 0 && ` · em ${usados.map(c => c.name || c.instance_name).join(', ')}`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button className="settings-btn-ghost" onClick={() => startEdit(a)}><Pencil size={13} /> Editar</button>
                    <button className="settings-btn-ghost" onClick={() => remove(a)} title="Excluir agente"
                      style={{ color: '#b91c1c' }}><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <button className="settings-btn-primary" onClick={startNew}><Plus size={14} /> Novo agente</button>
          </div>

          {/* ── Vínculo com os canais ── */}
          <div style={{ ...blockStyle, background: '#faf9f7' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '10px' }}>
              Agente de cada canal
            </p>
            {channels.length === 0 && (
              <p style={{ fontSize: '12px', color: '#9ca3af' }}>Nenhum canal cadastrado.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {channels.map(ch => {
                const bind = bindings[ch.id] || { assistant_id: null, ai_enabled: false };
                return (
                  <div key={ch.id} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                    paddingBottom: '10px', borderBottom: '1px dashed #ece7df',
                  }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1f2937', minWidth: '130px' }}>
                      {ch.name || ch.instance_name}
                    </span>
                    <select
                      value={bind.assistant_id || ''}
                      onChange={e => saveBinding(ch.id, { assistant_id: e.target.value || null })}
                      style={{ ...fieldStyle, width: 'auto', minWidth: '220px' }}
                    >
                      <option value="">— Sem agente —</option>
                      {assistants.map(a => (
                        <option key={a.id} value={a.id}>{a.name}{a.is_active ? '' : ' (inativo)'}</option>
                      ))}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={bind.ai_enabled}
                        disabled={!bind.assistant_id}
                        onChange={e => saveBinding(ch.id, { ai_enabled: e.target.checked })}
                      />
                      <span style={{ fontSize: '12px', color: bind.assistant_id ? '#1f2937' : '#9ca3af' }}>
                        IA ativa neste canal
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '10px' }}>
              Desligar a IA aqui interrompe respostas e acompanhamentos automáticos do canal na hora.
            </p>
          </div>
        </>
      )}

      {/* ── Formulário ── */}
      {draft && (
        <AiAssistantForm
          draft={draft}
          targets={targets}
          saving={saving}
          onPatch={patch}
          onCancel={cancelEdit}
          onSave={save}
        />
      )}
    </div>
  );
};

// ── Peças pequenas ──────────────────────────────────────────────────────────

const Badge: React.FC<{ tone: 'green' | 'gray' | 'amber' | 'blue'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = {
    green: { bg: '#f0fdf4', fg: '#166534' },
    gray: { bg: '#f3f4f6', fg: '#4b5563' },
    amber: { bg: '#fffbeb', fg: '#92400e' },
    blue: { bg: '#eff6ff', fg: '#1d4ed8' },
  }[tone];
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px',
      background: tones.bg, color: tones.fg, textTransform: 'uppercase', letterSpacing: '.03em',
    }}>{children}</span>
  );
};

export default AiAssistantsPanel;

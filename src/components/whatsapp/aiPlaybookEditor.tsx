/**
 * O editor do ROTEIRO da triagem.
 *
 * O roteiro é o que o backend lê para saber o que ainda falta perguntar, em que
 * etapa a conversa está e quando o caso sai — e é dele que sai o formato de
 * resposta obrigatório do modelo (`buildWaAiTriageSchema`). Escrever isso em
 * prosa dentro do "o que deve fazer" foi o que produziu, numa conversa real, um
 * painel com treze dados e nenhuma data: prosa o modelo interpreta, roteiro o
 * backend confere.
 *
 * Sem serviço nenhum aqui, como no resto do formulário: recebe o rascunho,
 * devolve alteração. A leitura é a MESMA do backend (`normalizeWaAiPlaybook`),
 * então o aviso do que foi descartado aparece enquanto se digita, e não depois
 * de um atendimento estranho.
 */
import React, { useMemo } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Sparkles, X } from 'lucide-react';
import {
  WA_AI_PLAYBOOK_SEM_REGISTRO,
  normalizeWaAiPlaybook,
  type WaAiCutRule,
  type WaAiFieldType,
  type WaAiPlaybook,
  type WaAiPlaybookCut,
  type WaAiPlaybookField,
  type WaAiPlaybookStage,
} from '../../utils/waAiPlaybook';

const fieldStyle: React.CSSProperties = {
  width: '100%', fontSize: '12.5px', padding: '6px 9px', borderRadius: '8px',
  border: '1px solid #d1d5db', background: '#fff', color: '#111827',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '10.5px', fontWeight: 700, color: '#6b7280',
  marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.03em',
};
const cardStyle: React.CSSProperties = {
  border: '1px solid #f1efe9', borderRadius: '10px', padding: '10px', background: '#fff',
};
const miniButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px',
  padding: '5px 9px', borderRadius: '8px', border: '1px solid #d1d5db',
  background: '#fff', color: '#374151', cursor: 'pointer',
};

const TIPOS: { value: WaAiFieldType; label: string; hint: string }[] = [
  { value: 'texto', label: 'Texto', hint: 'Guardado como o cliente disse.' },
  { value: 'data_mes_ano', label: 'Mês e ano', hint: 'Vira MM/AAAA. É o único tipo que as regras de prazo leem.' },
  { value: 'bool', label: 'Sim ou não', hint: 'Só aceita sim ou não.' },
  { value: 'enum', label: 'Lista de opções', hint: 'Só aceita uma das opções escritas abaixo.' },
];

const REGRAS: { value: WaAiCutRule['kind']; label: string }[] = [
  { value: 'field_equals', label: 'Quando o campo for igual a…' },
  { value: 'older_than', label: 'Quando a data for mais antiga que…' },
  { value: 'all_equal', label: 'Quando TODOS os campos forem…' },
];

/** O rascunho que a tela manipula. Tudo opcional: ele nasce pela metade. */
type DraftPlaybook = {
  id?: string;
  label?: string;
  fields?: Partial<WaAiPlaybookField>[];
  stages?: Partial<WaAiPlaybookStage>[];
  cuts?: Partial<WaAiPlaybookCut>[];
};

interface Props {
  value: Record<string, unknown> | null | undefined;
  onChange: (playbook: Record<string, unknown>) => void;
}

/** Chave no formato que o backend aceita — o resto ele descartaria. */
function chaveDe(texto: string): string {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

export const AiPlaybookEditor: React.FC<Props> = ({ value, onChange }) => {
  const draft: DraftPlaybook = useMemo(
    () => (value && typeof value === 'object' && !Array.isArray(value) ? value as DraftPlaybook : {}),
    [value]);

  const fields = draft.fields || [];
  const stages = draft.stages || [];
  const cuts = draft.cuts || [];
  const vazio = fields.length === 0 && stages.length === 0 && cuts.length === 0;

  // A MESMA leitura do backend. É o que permite mostrar, enquanto se digita, o
  // que seria descartado — em vez de descobrir isso no meio de um atendimento.
  const lido = useMemo(() => normalizeWaAiPlaybook(draft), [draft]);
  const chavesValidas = new Set((lido?.fields || []).map(f => f.key));

  const patch = (p: Partial<DraftPlaybook>) => onChange({ ...draft, ...p } as Record<string, unknown>);
  const setFields = (f: Partial<WaAiPlaybookField>[]) => patch({ fields: f });
  const setStages = (e: Partial<WaAiPlaybookStage>[]) => patch({ stages: e });
  const setCuts = (c: Partial<WaAiPlaybookCut>[]) => patch({ cuts: c });

  const patchField = (i: number, p: Partial<WaAiPlaybookField>) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...p } : f)));
  const patchStage = (i: number, p: Partial<WaAiPlaybookStage>) =>
    setStages(stages.map((e, idx) => (idx === i ? { ...e, ...p } : e)));
  const patchCut = (i: number, p: Partial<WaAiPlaybookCut>) =>
    setCuts(cuts.map((c, idx) => (idx === i ? { ...c, ...p } : c)));

  const mover = <T,>(lista: T[], de: number, para: number): T[] => {
    if (para < 0 || para >= lista.length) return lista;
    const copia = lista.slice();
    const [item] = copia.splice(de, 1);
    copia.splice(para, 0, item);
    return copia;
  };

  const avisos: string[] = [];
  if (fields.length > 0 && !lido) {
    avisos.push('Nenhum campo tem chave válida — o roteiro inteiro seria ignorado.');
  }
  if (lido) {
    const perdidos = fields.length - lido.fields.length;
    if (perdidos > 0) avisos.push(`${perdidos} campo(s) sem chave, repetido(s) ou com lista de opções vazia serão ignorados.`);
    const semEtapa = lido.fields.filter(f => !lido.stages.some(e => e.fields.includes(f.key)));
    if (semEtapa.length > 0) {
      avisos.push(`Fora de qualquer etapa, nunca será perguntado: ${semEtapa.map(f => f.key).join(', ')}.`);
    }
    const cortesPerdidos = cuts.length - lido.cuts.length;
    if (cortesPerdidos > 0) avisos.push(`${cortesPerdidos} regra(s) de corte incompleta(s) serão ignoradas.`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <p style={{ fontSize: '11.5px', color: '#6b7280', margin: 0 }}>
        O roteiro é o que o sistema confere sozinho: quais informações a conversa precisa reunir,
        em que ordem perguntar e quando o caso sai. O texto do agente continua dizendo <em>como</em>{' '}
        conversar — aqui fica só o que precisa ser contado, e por isso não pode depender de o
        modelo lembrar.
      </p>

      {vazio && (
        <div style={{
          ...cardStyle, background: '#fffbf5', border: '1px solid #fed7aa',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        }}>
          <span style={{ fontSize: '12px', color: '#92400e' }}>
            Sem roteiro, o agente responde em texto livre, como antes — nada muda para ele.
          </span>
          <button type="button" style={{ ...miniButton, borderColor: '#fdba74', color: '#9a3412' }}
            onClick={() => onChange(JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_SEM_REGISTRO)))}>
            <Sparkles size={12} /> Começar pelo roteiro da campanha
          </button>
        </div>
      )}

      {avisos.length > 0 && (
        <div style={{ ...cardStyle, background: '#fef2f2', border: '1px solid #fecaca' }}>
          {avisos.map(a => (
            <div key={a} style={{
              display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '11.5px', color: '#991b1b',
            }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Campos ── */}
      <section>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 style={{ fontSize: '12.5px', fontWeight: 700, color: '#111827', margin: 0 }}>
            Informações a descobrir
          </h4>
          <button type="button" style={miniButton}
            onClick={() => setFields([...fields, { key: '', label: '', type: 'texto', required: true, ask: '' }])}>
            <Plus size={12} /> Adicionar
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {fields.map((f, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Chave</label>
                  <input style={fieldStyle} value={f.key || ''} placeholder="empregador"
                    onChange={e => patchField(i, { key: chaveDe(e.target.value) })} />
                </div>
                <div>
                  <label style={labelStyle}>Nome no painel</label>
                  <input style={fieldStyle} value={f.label || ''} placeholder="Empregador"
                    onChange={e => patchField(i, { label: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Tipo</label>
                  <select style={fieldStyle} value={f.type || 'texto'}
                    onChange={e => patchField(i, { type: e.target.value as WaAiFieldType })}>
                    {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: '8px' }}>
                <label style={labelStyle}>Como isso aparece na lista de espera</label>
                <input style={fieldStyle} value={f.ask || ''} placeholder="para quem trabalhou (empresa ou pessoa)"
                  onChange={e => patchField(i, { ask: e.target.value })} />
                <p style={{ fontSize: '10.5px', color: '#9ca3af', marginTop: '4px' }}>
                  É este texto que o agente lê como “ainda falta descobrir…” e que vira a mensagem
                  de retomada quando o cliente some.
                </p>
              </div>

              {f.type === 'enum' && (
                <div style={{ marginTop: '8px' }}>
                  <label style={labelStyle}>Opções aceitas, separadas por vírgula</label>
                  <input style={fieldStyle} value={(f.options || []).join(', ')} placeholder="particular, publico"
                    onChange={e => patchField(i, {
                      options: e.target.value.split(',').map(o => o.trim()).filter(Boolean),
                    })} />
                  <p style={{ fontSize: '10.5px', color: '#9ca3af', marginTop: '4px' }}>
                    O modelo só pode responder uma destas. Qualquer outra coisa conta como não
                    respondido, e a pergunta é refeita.
                  </p>
                </div>
              )}

              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginTop: '10px',
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                  <input type="checkbox" checked={f.required !== false}
                    onChange={e => patchField(i, { required: e.target.checked })} />
                  Obrigatório
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#374151' }}>
                  Só perguntar se
                  <select style={{ ...fieldStyle, width: 'auto' }} value={f.onlyWhen?.field || ''}
                    onChange={e => patchField(i, {
                      onlyWhen: e.target.value
                        ? { field: e.target.value, value: f.onlyWhen?.value || 'sim' }
                        : undefined,
                    })}>
                    <option value="">sempre perguntar</option>
                    {fields.filter((o, idx) => idx !== i && o.key).map(o => (
                      <option key={o.key} value={o.key}>{o.key}</option>
                    ))}
                  </select>
                  {f.onlyWhen?.field && (
                    <>
                      for
                      <input style={{ ...fieldStyle, width: '110px' }} value={f.onlyWhen.value || ''}
                        onChange={e => patchField(i, {
                          onlyWhen: { field: f.onlyWhen!.field!, value: e.target.value },
                        })} />
                    </>
                  )}
                </label>

                <span style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                  <button type="button" style={miniButton} aria-label="Subir"
                    onClick={() => setFields(mover(fields, i, i - 1))}><ArrowUp size={12} /></button>
                  <button type="button" style={miniButton} aria-label="Descer"
                    onClick={() => setFields(mover(fields, i, i + 1))}><ArrowDown size={12} /></button>
                  <button type="button" style={{ ...miniButton, color: '#b91c1c' }} aria-label="Remover"
                    onClick={() => setFields(fields.filter((_, idx) => idx !== i))}><X size={12} /></button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Etapas ── */}
      <section>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 style={{ fontSize: '12.5px', fontWeight: 700, color: '#111827', margin: 0 }}>
            Etapas, na ordem em que se pergunta
          </h4>
          <button type="button" style={miniButton}
            onClick={() => setStages([...stages, { id: '', label: '', fields: [] }])}>
            <Plus size={12} /> Adicionar
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {stages.map((e, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Nome da etapa</label>
                  <input style={fieldStyle} value={e.label || ''} placeholder="Período do trabalho"
                    onChange={ev => patchStage(i, { label: ev.target.value, id: e.id || chaveDe(ev.target.value) })} />
                </div>
                <span style={{ display: 'flex', gap: '4px' }}>
                  <button type="button" style={miniButton} aria-label="Subir"
                    onClick={() => setStages(mover(stages, i, i - 1))}><ArrowUp size={12} /></button>
                  <button type="button" style={miniButton} aria-label="Descer"
                    onClick={() => setStages(mover(stages, i, i + 1))}><ArrowDown size={12} /></button>
                  <button type="button" style={{ ...miniButton, color: '#b91c1c' }} aria-label="Remover"
                    onClick={() => setStages(stages.filter((_, idx) => idx !== i))}><X size={12} /></button>
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                {fields.filter(f => f.key).map(f => {
                  const marcado = (e.fields || []).includes(f.key!);
                  return (
                    <label key={f.key} style={{
                      display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer',
                      fontSize: '11.5px', padding: '4px 8px', borderRadius: '999px',
                      border: `1px solid ${marcado ? '#fed7aa' : '#e5e7eb'}`,
                      background: marcado ? '#fffbf5' : '#fff',
                      color: marcado ? '#9a3412' : '#6b7280',
                    }}>
                      <input type="checkbox" checked={marcado}
                        onChange={ev => patchStage(i, {
                          fields: ev.target.checked
                            ? [...(e.fields || []), f.key!]
                            : (e.fields || []).filter(k => k !== f.key),
                        })} />
                      {f.key}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cortes ── */}
      <section>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h4 style={{ fontSize: '12.5px', fontWeight: 700, color: '#111827', margin: 0 }}>
            Quando o caso sai da triagem
          </h4>
          <button type="button" style={miniButton}
            onClick={() => setCuts([...cuts, {
              id: '', effect: 'disqualify', reason: '', guidance: '',
              rule: { kind: 'field_equals', field: '', values: [] },
            }])}>
            <Plus size={12} /> Adicionar
          </button>
        </header>

        <p style={{ fontSize: '11.5px', color: '#6b7280', margin: '0 0 8px' }}>
          Estas regras são conferidas pelo sistema, não pelo modelo. A conta de prazo é feita com a
          data real de hoje, e o mês informado pelo cliente conta inteiro a favor dele.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cuts.map((c, i) => {
            const regra = (c.rule || { kind: 'field_equals' }) as Partial<WaAiCutRule> & { kind: WaAiCutRule['kind'] };
            const opcoes = fields.filter(f => f.key);
            return (
              <div key={i} style={cardStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
                  <div>
                    <label style={labelStyle}>Motivo (aparece no painel)</label>
                    <input style={fieldStyle} value={c.reason || ''} placeholder="saiu há mais de dois anos"
                      onChange={ev => patchCut(i, { reason: ev.target.value, id: c.id || chaveDe(ev.target.value) })} />
                  </div>
                  <div>
                    <label style={labelStyle}>O que acontece</label>
                    <select style={fieldStyle} value={c.effect || 'disqualify'}
                      onChange={ev => patchCut(i, { effect: ev.target.value as WaAiPlaybookCut['effect'] })}>
                      <option value="disqualify">Encerra o atendimento</option>
                      <option value="handoff">Vai para uma pessoa</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Regra</label>
                    <select style={fieldStyle} value={regra.kind}
                      onChange={ev => {
                        const kind = ev.target.value as WaAiCutRule['kind'];
                        patchCut(i, {
                          rule: (kind === 'older_than'
                            ? { kind, field: '', years: 2 }
                            : kind === 'all_equal'
                              ? { kind, fields: [], value: 'não' }
                              : { kind, field: '', values: [] }) as WaAiCutRule,
                        });
                      }}>
                      {REGRAS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end', marginTop: '8px' }}>
                  {regra.kind !== 'all_equal' && (
                    <div style={{ minWidth: '150px' }}>
                      <label style={labelStyle}>Campo</label>
                      <select style={fieldStyle} value={(regra as { field?: string }).field || ''}
                        onChange={ev => patchCut(i, { rule: { ...regra, field: ev.target.value } as WaAiCutRule })}>
                        <option value="">escolha…</option>
                        {opcoes
                          .filter(f => regra.kind !== 'older_than' || f.type === 'data_mes_ano')
                          .map(f => <option key={f.key} value={f.key}>{f.key}</option>)}
                      </select>
                    </div>
                  )}

                  {regra.kind === 'field_equals' && (
                    <div style={{ flex: 1, minWidth: '160px' }}>
                      <label style={labelStyle}>Valores que cortam, separados por vírgula</label>
                      <input style={fieldStyle} value={((regra as { values?: string[] }).values || []).join(', ')}
                        placeholder="publico"
                        onChange={ev => patchCut(i, {
                          rule: {
                            ...regra,
                            values: ev.target.value.split(',').map(v => v.trim()).filter(Boolean),
                          } as WaAiCutRule,
                        })} />
                    </div>
                  )}

                  {regra.kind === 'older_than' && (
                    <div style={{ width: '140px' }}>
                      <label style={labelStyle}>Anos</label>
                      <input type="number" min={1} max={50} style={fieldStyle}
                        value={(regra as { years?: number }).years ?? 2}
                        onChange={ev => patchCut(i, {
                          rule: { ...regra, years: Number(ev.target.value) } as WaAiCutRule,
                        })} />
                    </div>
                  )}

                  {regra.kind === 'all_equal' && (
                    <>
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <label style={labelStyle}>Campos (todos precisam bater)</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {opcoes.map(f => {
                            const atuais = (regra as { fields?: string[] }).fields || [];
                            const marcado = atuais.includes(f.key!);
                            return (
                              <label key={f.key} style={{
                                display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer',
                                fontSize: '11.5px', padding: '4px 8px', borderRadius: '999px',
                                border: `1px solid ${marcado ? '#fecaca' : '#e5e7eb'}`,
                                background: marcado ? '#fef2f2' : '#fff',
                                color: marcado ? '#991b1b' : '#6b7280',
                              }}>
                                <input type="checkbox" checked={marcado}
                                  onChange={ev => patchCut(i, {
                                    rule: {
                                      ...regra,
                                      fields: ev.target.checked
                                        ? [...atuais, f.key!]
                                        : atuais.filter(k => k !== f.key),
                                    } as WaAiCutRule,
                                  })} />
                                {f.key}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ width: '130px' }}>
                        <label style={labelStyle}>Valor</label>
                        <input style={fieldStyle} value={(regra as { value?: string }).value || ''}
                          onChange={ev => patchCut(i, {
                            rule: { ...regra, value: ev.target.value } as WaAiCutRule,
                          })} />
                      </div>
                    </>
                  )}
                </div>

                <div style={{ marginTop: '8px' }}>
                  <label style={labelStyle}>O que o agente faz quando isso acontece</label>
                  <textarea style={{ ...fieldStyle, minHeight: '70px', resize: 'vertical' }}
                    value={c.guidance || ''}
                    placeholder="Pare a triagem, informe de forma curta e educada que o caso ficou fora do período analisado e encerre."
                    onChange={ev => patchCut(i, { guidance: ev.target.value })} />
                  <p style={{ fontSize: '10.5px', color: '#9ca3af', marginTop: '4px' }}>
                    Vai para o modelo como ordem, já com a decisão tomada — ele nunca refaz a conta.
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginTop: '8px' }}>
                  <button type="button" style={miniButton} aria-label="Subir"
                    onClick={() => setCuts(mover(cuts, i, i - 1))}><ArrowUp size={12} /></button>
                  <button type="button" style={miniButton} aria-label="Descer"
                    onClick={() => setCuts(mover(cuts, i, i + 1))}><ArrowDown size={12} /></button>
                  <button type="button" style={{ ...miniButton, color: '#b91c1c' }} aria-label="Remover"
                    onClick={() => setCuts(cuts.filter((_, idx) => idx !== i))}><X size={12} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {lido && (
        <p style={{ fontSize: '11px', color: '#6b7280', margin: 0 }}>
          O agente vai poder gravar {chavesValidas.size} informação(ões), em {lido.stages.length} etapa(s),
          com {lido.cuts.length} regra(s) de corte. Nenhum outro nome de campo é aceito na resposta dele.
        </p>
      )}
    </div>
  );
};

export default AiPlaybookEditor;

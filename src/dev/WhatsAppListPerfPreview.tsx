// DEV-ONLY: bancada de medição da lista de conversas (?walistperf=1).
// Mede quanto custa um re-render da inbox nos dois cenários que acontecem o
// tempo todo enquanto se digita:
//   · "tecla"  — o módulo re-renderiza com todas as props da lista estáveis
//                (o React.memo de cada linha deveria abortar cedo).
//   · "rascunho" — o `draftMap` troca de identidade (a cada ~600ms de digitação),
//                  o que invalida a prop de TODA linha.
import React, { useMemo, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { ConversationListItem } from '../components/whatsapp/conversationListItem';
import { ConversationList } from '../components/whatsapp/conversationList';
import type { WhatsAppChannel, WhatsAppConversation, WhatsAppDepartment } from '../types/whatsapp.types';

const DEPT_BY_ID = new Map<string, WhatsAppDepartment>();
const SEM_MUDOS: ReadonlySet<string> = new Set<string>();
const noop = () => {};

const CANAL: WhatsAppChannel = {
  id: 'canal', instance_name: 'pedro', name: 'Pedro', color: '#ea6c00',
  phone_number: null, status: 'connected', last_qr: null, profile_pic_url: null,
  webhook_token: null, is_active: true, connected_at: null, absence_message: null,
  absence_enabled: false, timezone: 'America/Cuiaba', visibility_mode: 'all',
  funnel_enabled: true, funnel_initial_stage: 'novo',
};

const seed = (n: number): WhatsAppConversation[] => Array.from({ length: n }, (_, i) => ({
  id: `c${i}`, instance_id: 'canal', remote_jid: `${i}@s.whatsapp.net`,
  contact_phone: `55669${String(100000 + i)}`, contact_name: `Contato ${i}`,
  contact_avatar_path: null, contact_avatar_url: null,
  // Uma a cada quatro com cadastro vinculado: a linha deve exibir o nome do
  // cadastro, não o "Contato N" que veio do WhatsApp.
  client_id: i % 4 === 0 ? `cli${i}` : null,
  client_name: i % 4 === 0 ? `Vicente da Costa Pereira ${i}` : null,
  assigned_user_id: null, department_id: null, status: 'open' as const,
  unread_count: i % 7 === 0 ? 2 : 0,
  last_message_at: new Date(Date.now() - i * 60000).toISOString(),
  last_message_preview: 'Bom dia, doutor, tudo bem? Preciso de uma orientação.',
  last_message_direction: 'in' as const,
  presence: null, presence_updated_at: null, last_seen_at: null,
  is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null,
  closed_at: null, closed_by: null, closure_reason: null, reopened_at: null,
  first_response_at: null, last_customer_message_at: null, last_agent_message_at: null,
  awaiting_accept: false, transfer_pending_since: null, contact_reason: null,
  labels: ['Novo'], legal_hold: false, legal_hold_reason: null, absence_suppressed: false,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}));

const FUNNEL = [{ key: 'Novo', stageKey: 'novo', stageLabel: 'Novo', color: '#64748b', bg: '#64748b22' }];

const WhatsAppListPerfPreview: React.FC = () => {
  const [total, setTotal] = useState(300);
  const [memoizada, setMemoizada] = useState(true);
  const [tick, setTick] = useState(0);          // re-render com props estáveis
  const [draftEpoch, setDraftEpoch] = useState(0); // troca a identidade do draftMap
  const [resultado, setResultado] = useState<string[]>([]);
  const t0 = useRef(0);

  const conversas = useMemo(() => seed(total), [total]);
  const selectedId = conversas[0]?.id ?? null;

  // Espelha o módulo: o mapa é recriado quando o rascunho é gravado.
  const draftMap = useMemo<Record<string, string>>(
    () => ({ [selectedId ?? '']: `rascunho ${draftEpoch}` }),
    [selectedId, draftEpoch],
  );

  const onSelect = useMemo(() => (_: string) => {}, []);

  // Props estáveis para o modo memoizado (é assim que o módulo as monta).
  const channelById = useMemo(() => new Map([[CANAL.id, CANAL]]), []);
  const funnelPorCanal = useMemo(() => () => FUNNEL, []);
  const statusDaConversa = useMemo(
    () => () => ({ key: 'waiting_you', label: 'Aguardando você', cls: 'bg-amber-100 text-amber-700' }),
    [],
  );
  const semDoc = useMemo(() => () => null, []);
  const semAssinatura = useMemo(() => () => null, []);
  // Recorte que o módulo faz: o rascunho da conversa ABERTA fica de fora, então
  // digitar nela não muda a identidade desta prop.
  const listDraftsRef = useRef<Record<string, string>>({});
  const listDrafts = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [id, v] of Object.entries(draftMap)) if (id !== selectedId && v.trim()) next[id] = v;
    const prev = listDraftsRef.current;
    const keys = Object.keys(next);
    if (keys.length === Object.keys(prev).length && keys.every(k => prev[k] === next[k])) return prev;
    listDraftsRef.current = next;
    return next;
  }, [draftMap, selectedId]);

  // Mede render + commit via useLayoutEffect (roda logo após o React aplicar o
  // commit). Não depende de requestAnimationFrame, que o navegador estrangula
  // quando a aba está em segundo plano.
  const rotuloRef = useRef<string | null>(null);
  const medir = (rotulo: string, disparar: () => void) => {
    rotuloRef.current = rotulo;
    t0.current = performance.now();
    disparar();
  };
  React.useLayoutEffect(() => {
    const rotulo = rotuloRef.current;
    if (!rotulo) return;
    rotuloRef.current = null;
    const ms = performance.now() - t0.current;
    setResultado(r => [`${rotulo}: ${ms.toFixed(1)} ms (${total} conversas)`, ...r].slice(0, 8));
  }, [tick, draftEpoch, total]);

  return (
    <main className="min-h-screen bg-[#f5f5f3] p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white"><Gauge size={20} /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">WhatsApp · Perf</p>
            <h1 className="text-base font-semibold text-slate-900">Custo de re-render da lista</h1>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[100, 300, 800].map(n => (
            <button key={n} onClick={() => setTotal(n)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${total === n ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600'}`}>
              {n} conversas
            </button>
          ))}
          <button data-test="modo" onClick={() => setMemoizada(m => !m)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${memoizada ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-slate-600'}`}>
            {memoizada ? 'lista memoizada (novo)' : 'lista solta (antigo)'}
          </button>
          <button data-test="tecla" onClick={() => medir(`tecla · ${memoizada ? 'memo' : 'antigo'}`, () => setTick(t => t + 1))}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">Simular tecla</button>
          <button data-test="rascunho" onClick={() => medir(`rascunho · ${memoizada ? 'memo' : 'antigo'}`, () => setDraftEpoch(e => e + 1))}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white">Simular gravação de rascunho</button>
        </div>

        <pre data-test="resultado" className="mb-4 min-h-[92px] overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 text-[12px] leading-relaxed text-slate-700">
{resultado.join('\n') || 'Clique num botão para medir.'}
        </pre>

        <div className="h-[420px] overflow-y-auto rounded-2xl border border-[#e7e5df] bg-white" data-tick={tick}>
          {memoizada ? (
            <ConversationList
              conversations={conversas}
              selectedId={selectedId}
              loading={false}
              privateMode={false}
              emptyMessage="Nenhuma conversa."
              channelById={channelById}
              deptById={DEPT_BY_ID}
              drafts={listDrafts}
              mutedIds={SEM_MUDOS}
              funnelLabelsForChannel={funnelPorCanal}
              conversationStatus={statusDaConversa}
              docStatusFor={semDoc}
              trackedSignatureFor={semAssinatura}
              onSelect={onSelect}
              onStopSignatureTracking={noop}
              onStopTemplateFillTracking={noop}
            />
          ) : (
            conversas.map(c => (
              <ConversationListItem
                key={c.id}
                c={c}
                active={c.id === selectedId}
                channel={CANAL}
                dept={null}
                privateMode={false}
                statusKey="waiting_you"
                statusLabel="Aguardando você"
                statusCls="bg-amber-100 text-amber-700"
                docStatus={null}
                muted={false}
                draftPreview={c.id === selectedId ? '' : (draftMap[c.id] ?? '')}
                funnelLabels={FUNNEL}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      </div>
    </main>
  );
};

export default WhatsAppListPerfPreview;

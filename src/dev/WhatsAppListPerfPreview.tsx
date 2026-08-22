// DEV-ONLY: bancada de medição da lista de conversas (?walistperf=1).
// Mede quanto custa um re-render da inbox nos dois cenários que acontecem o
// tempo todo enquanto se digita:
//   · "tecla"  — o módulo re-renderiza com todas as props da lista estáveis
//                (o React.memo de cada linha deveria abortar cedo).
//   · "rascunho" — o `draftMap` troca de identidade (a cada ~600ms de digitação),
//                  o que invalida a prop de TODA linha.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import { ConversationListItem } from '../components/whatsapp/conversationListItem';
import { ConversationList } from '../components/whatsapp/conversationList';
import { waAiListChip } from '../utils/waAiFollowupDisplay';
import { WA_SWEEP_MS, type WaSweepKind } from '../components/whatsapp/conversationSweep';
import type { WhatsAppChannel, WhatsAppConversation, WhatsAppDepartment } from '../types/whatsapp.types';

const DEPT_BY_ID = new Map<string, WhatsAppDepartment>();
const SEM_MUDOS: ReadonlySet<string> = new Set<string>();
// Uma conversa com outro atendente dentro, para conferir o aviso de colisão.
const OCUPADAS: ReadonlySet<string> = new Set(['c1']);
// Algumas conversas com envio falho: é o estado que a fila otimista deixa na
// lista quando uma mensagem não sai e o atendente já pulou para o próximo
// contato. Fica na bancada para o badge vermelho ser visto no meio das outras
// linhas — que é onde ele precisa se destacar.
const FALHAS: ReadonlyMap<string, number> = new Map([['c3', 1], ['c11', 2]]);
const noop = () => {};

const CANAL: WhatsAppChannel = {
  id: 'canal', instance_name: 'pedro', name: 'Pedro', color: '#ea6c00',
  phone_number: null, status: 'connected', profile_pic_url: null, is_active: true, connected_at: null, absence_message: null,
  absence_enabled: false, timezone: 'America/Cuiaba', visibility_mode: 'all',
  funnel_enabled: true, funnel_initial_stage: 'novo',
  // Encerramento por inatividade LIGADO: com as conversas semeadas de minuto em
  // minuto para trás, a bancada mostra o contador nas três faixas — cinza,
  // âmbar na última hora e vencido depois das 4h.
  auto_close_enabled: true, auto_close_minutes: 240, auto_close_message: null, auto_close_business_hours_only: true,
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
  // Figurinha e foto com legenda entram na amostra porque eram justamente as
  // que a lista não sabia dizer: a figurinha virava "—" e a legenda da foto
  // era jogada fora.
  last_message_preview: i % 11 === 0 ? '🖼️ Figurinha'
    : i % 13 === 0 ? '📷 Olha o comprovante que o banco mandou'
    : 'Bom dia, doutor, tudo bem? Preciso de uma orientação.',
  last_message_direction: 'in' as const,
  // Uma a cada cinco teve LIGAÇÃO depois da última mensagem: é a linha em que a
  // prévia tem de trocar o texto pela chamada (ver `conversationPreview`), e as
  // quatro variantes deixam à vista que a perdida recebida é a única em
  // vermelho.
  ...(i % 5 === 0 ? {
    last_call_at: new Date(Date.now() - i * 60000 + 30000).toISOString(),
    last_call_direction: (i % 10 === 0 ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
    last_call_outcome: (['answered', 'missed', 'declined', 'answered'][(i / 5) % 4]) as 'answered' | 'missed' | 'declined',
    last_call_duration_seconds: i % 10 === 0 ? 372 : 41,
    // Metade das ligações da bancada é de VÍDEO: a frase da linha tem de dizer
    // o meio nos SEIS desfechos, e é aqui que se vê "sem resposta" de voz e de
    // vídeo lado a lado.
    last_call_is_video: i % 15 === 0 || i % 20 === 0,
  } : {
    last_call_at: null, last_call_direction: null, last_call_outcome: null,
    last_call_duration_seconds: null, last_call_is_video: false,
  }),
  presence: null, presence_updated_at: null, last_seen_at: null,
  is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null,
  closed_at: null, closed_by: null, closure_reason: null, reopened_at: null,
  first_response_at: null, last_customer_message_at: null, last_agent_message_at: null,
  awaiting_accept: false, transfer_pending_since: null, contact_reason: null,
  // As com cadastro entram na etapa de documentos: é a linha onde os DOIS
  // chips convivem — etapa do funil (ponto colorido) e estado da solicitação
  // (ícone de arquivo) —, que é o que esta bancada precisa deixar à vista.
  labels: i % 4 === 0 ? ['Aguardando docs'] : ['Novo'], legal_hold: false, legal_hold_reason: null, absence_suppressed: false, auto_close_suppressed: false,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}));

const FUNNEL = [
  { key: 'Novo', stageKey: 'novo', stageLabel: 'Novo', color: '#64748b', bg: '#64748b22' },
  { key: 'Aguardando docs', stageKey: 'aguardando_documentos', stageLabel: 'Aguardando documentos', color: '#f59e0b', bg: '#f59e0b22' },
];

// Duas encerradas para conferir a fronteira entre a fila e o arquivo: divisória
// "Encerradas" e, abaixo dela, as linhas em preto e branco. Na inbox de verdade
// esse grupo fica no FIM da busca; aqui entra depois da terceira linha só para o
// contraste entre os dois grupos caber na tela sem rolar 300 conversas.
const ARQUIVADAS = new Set(['c2', 'c5']);
const comArquivo = (lista: WhatsAppConversation[]): WhatsAppConversation[] => {
  const ativas = lista.filter(c => !ARQUIVADAS.has(c.id));
  const arquivadas = lista
    .filter(c => ARQUIVADAS.has(c.id))
    .map(c => ({ ...c, status: 'closed' as const, closed_at: new Date().toISOString() }));
  return [...ativas.slice(0, 3), ...arquivadas, ...ativas.slice(3)];
};

const WhatsAppListPerfPreview: React.FC = () => {
  const [total, setTotal] = useState(300);
  const [memoizada, setMemoizada] = useState(true);
  const [tick, setTick] = useState(0);          // re-render com props estáveis
  // Canal com agente de IA: a linha troca status/SLA/fila por uma etiqueta só.
  const [comIa, setComIa] = useState(true);
  const chipDeIa = useCallback((id: string) => {
    if (!comIa) return null;
    // Uma retomada a cada conversa, escalonada, para ver o chip em vários pontos
    // da escada: 9 minutos, 2 horas, 2 dias…
    const n = Math.abs(id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 4;
    const emMs = [9 * 60_000, 2 * 3_600_000, 26 * 3_600_000, 0][n];
    return waAiListChip({
      aiActive: true,
      nextFollowupAt: emMs ? new Date(Date.now() + emMs).toISOString() : null,
      attemptsDone: n,
      maxAttempts: 9,
    });
  }, [comIa]);
  const [draftEpoch, setDraftEpoch] = useState(0); // troca a identidade do draftMap
  const [resultado, setResultado] = useState<string[]>([]);
  const t0 = useRef(0);

  const semeadas = useMemo(() => comArquivo(seed(total)), [total]);

  // Varredura de saída: a bancada repete o que o módulo faz de verdade — a
  // faixa passa e SÓ ENTÃO a conversa sai da lista (ver `useWaOperationalModals`).
  const [sweeping, setSweeping] = useState<ReadonlyMap<string, WaSweepKind>>(new Map());
  const [saiu, setSaiu] = useState<ReadonlySet<string>>(new Set());
  const conversas = useMemo(() => semeadas.filter(c => !saiu.has(c.id)), [semeadas, saiu]);
  const selectedId = conversas[0]?.id ?? null;
  const varrer = useCallback((id: string | null, kind: WaSweepKind) => {
    if (!id) return;
    setSweeping(prev => new Map(prev).set(id, kind));
    window.setTimeout(() => {
      setSweeping(prev => { const n = new Map(prev); n.delete(id); return n; });
      // Transferida FICA (o destino depende do filtro em uso); encerrada sai.
      if (kind === 'closed') setSaiu(prev => new Set(prev).add(id));
    }, WA_SWEEP_MS);
  }, []);

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
  // Metade dos cadastros com documento pendente, metade com tudo entregue: a
  // linha da conversa precisa mostrar o FATO (docs) sem se confundir com a
  // ETAPA, que continua parada em "Aguardando documentos" até alguém mover.
  const docPorCliente = useMemo(() => (clientId: string | null | undefined) => {
    if (!clientId) return null;
    return Number(clientId.replace('cli', '')) % 8 === 0 ? 'ready' as const : 'awaiting' as const;
  }, []);
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
          <button data-test="encerrar" onClick={() => varrer(selectedId, 'closed')}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Encerrar a 1ª (varredura)</button>
          <button data-test="transferir" onClick={() => varrer(conversas[1]?.id ?? null, 'transferred')}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white">Transferir a 2ª (varredura)</button>
          <button data-test="repor" onClick={() => setSaiu(new Set())}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">Repor encerradas</button>
        </div>

        <pre data-test="resultado" className="mb-4 min-h-[92px] overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 text-[12px] leading-relaxed text-slate-700">
{resultado.join('\n') || 'Clique num botão para medir.'}
        </pre>

        <label className="mb-3 flex items-center gap-2 text-[12px] text-slate-600">
          <input type="checkbox" checked={comIa} onChange={e => setComIa(e.target.checked)} />
          Simular canal com agente de IA ativo (troca os sinais humanos pela etiqueta da IA)
        </label>

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
              failedSends={FALHAS}
              archivedIds={ARQUIVADAS}
              showChannelName
              busyConversationIds={OCUPADAS}
              sweeping={sweeping}
              funnelLabelsForChannel={funnelPorCanal}
              aiChipFor={chipDeIa}
              conversationStatus={statusDaConversa}
              docStatusFor={docPorCliente}
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
                docStatus={docPorCliente(c.client_id)}
                muted={false}
                draftPreview={c.id === selectedId ? '' : (draftMap[c.id] ?? '')}
                failedSends={FALHAS.get(c.id) ?? 0}
                archived={ARQUIVADAS.has(c.id)}
                showChannelName
                busy={OCUPADAS.has(c.id)}
                sweep={sweeping.get(c.id) ?? null}
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

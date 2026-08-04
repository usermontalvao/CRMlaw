// Painel de Fila / Operação: o que a inbox nunca mostrou.
//
// A inbox responde "quais conversas existem"; ela nunca respondeu "a fila está
// saudável?", "por que não anda?" e "quem devia pegar o quê". Sem isso, a
// coordenação é feita no olho — e o que ninguém vê é justamente o que apodrece:
// a transferência que o destino nunca aceitou, a conversa que envelhece na fila
// de um setor, o atendente ocioso ao lado do colega afogado.
//
// Toda a regra vem de `attendanceRouting`/`transferPolicy` (os mesmos módulos
// testados e usados pelo simulador). Aqui só há apresentação e as ações.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertTriangle, Users, Inbox, ArrowRightLeft, Sparkles,
  CheckCircle2, Undo2, ListTodo, Activity,
} from 'lucide-react';
import { WaDialog, WaDialogBody, waBtnPrimary, waBtnGhost } from './ui';
import { conversationName } from './format';
import {
  queueHealth, rankQueue, agentLoads, distributeQueue, DEFAULT_QUEUE_POLICY,
  type QueueItem, type RoutingAgent, type QueueBucket, type DistributionAssignment,
  type QueuePolicy,
} from './attendanceRouting';
import { whatsappService, type StaffOption } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

/** Converte a conversa do módulo no recorte que a fila avalia. */
export function toQueueItem(c: WhatsAppConversation): QueueItem {
  return {
    id: c.id,
    status: c.status,
    // O canal define qual expediente mede o SLA desta conversa.
    channelId: c.instance_id,
    isBlocked: c.is_blocked,
    assignedUserId: c.assigned_user_id,
    departmentId: c.department_id,
    awaitingAccept: c.awaiting_accept,
    transferPendingSince: c.transfer_pending_since,
    lastMessageDirection: c.last_message_direction,
    lastCustomerMessageAt: c.last_customer_message_at,
    lastMessageAt: c.last_message_at,
    labels: c.labels,
  };
}

const BUCKET_LABEL: Record<QueueBucket, string> = {
  transferencia_travada: 'Transferência sem aceite',
  sla_estourado: 'SLA estourado',
  urgente: 'Urgente',
  sla_atencao: 'Em atenção',
  fila_setor: 'Parada na fila do setor',
  aguardando_voce: 'Aguardando você',
  normal: 'Sem responsável',
};

const BUCKET_STYLE: Record<QueueBucket, string> = {
  transferencia_travada: 'bg-red-100 text-red-700',
  sla_estourado: 'bg-red-50 text-red-600',
  urgente: 'bg-orange-100 text-orange-700',
  sla_atencao: 'bg-amber-100 text-amber-700',
  fila_setor: 'bg-sky-100 text-sky-700',
  aguardando_voce: 'bg-slate-100 text-slate-600',
  normal: 'bg-slate-100 text-slate-500',
};

const DIAGNOSIS: Record<string, { tone: 'ok' | 'warn' | 'danger'; title: string; detail: string }> = {
  vazia: { tone: 'ok', title: 'Nada esperando', detail: 'Nenhuma conversa aguardando ação da equipe agora.' },
  saudavel: { tone: 'ok', title: 'Fila saudável', detail: 'Há gente disponível para o volume que está entrando.' },
  transferencias_travadas: {
    tone: 'danger', title: 'Transferências sem aceite',
    detail: 'Há conversas encaminhadas que o destino nunca assumiu. Devolva à fila para alguém pegar.',
  },
  sla_estourado: {
    tone: 'danger', title: 'Clientes esperando há muito tempo',
    detail: 'Há conversas com o cliente aguardando resposta acima do prazo. Elas estão no topo da ordem abaixo.',
  },
  acumulando: {
    tone: 'warn', title: 'Fila acumulando',
    detail: 'Chegam mais conversas sem responsável do que a equipe consegue absorver nesta rodada.',
  },
  equipe_lotada: {
    tone: 'danger', title: 'Equipe lotada',
    detail: 'Todo mundo bateu o teto de conversas simultâneas. A fila só anda liberando gente ou aumentando o teto.',
  },
  ninguem_disponivel: {
    tone: 'danger', title: 'Ninguém disponível',
    detail: 'Há conversas esperando e nenhum atendente marcado como disponível para recebê-las.',
  },
};

const TONE_BOX = {
  ok: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-100 bg-amber-50 text-amber-800',
  danger: 'border-red-100 bg-red-50 text-red-800',
};

const humanMin = (m: number) => {
  const total = Math.floor(m);
  if (total < 60) return `${total}min`;
  const h = Math.floor(total / 60);
  return h < 24 ? `${h}h${String(total % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d`;
};

export const QueuePanel: React.FC<{
  conversations: WhatsAppConversation[];
  staff: StaffOption[];
  /** Setores de cada atendente (department_id → user_ids). Vazio = sem restrição. */
  departmentMembers?: Record<string, string[]>;
  /** Teto de conversas simultâneas por atendente. 0 = sem teto. */
  capacity?: number;
  currentUserId?: string | null;
  /**
   * Política da fila; traz a contagem em horário útil quando há expediente
   * cadastrado. Ausente = prazos padrão medidos no relógio de parede.
   */
  policy?: QueuePolicy;
  onOpenConversation: (id: string) => void;
  /** Chamado depois de qualquer mutação para o módulo recarregar a lista. */
  onChanged: () => void;
  onClose: () => void;
}> = ({
  conversations, staff, departmentMembers, capacity = 0, currentUserId,
  policy = DEFAULT_QUEUE_POLICY,
  onOpenConversation, onChanged, onClose,
}) => {
  const toast = useToastContext();
  const [applying, setApplying] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [preview, setPreview] = useState<DistributionAssignment[] | null>(null);
  const [unassignable, setUnassignable] = useState<Array<{ conversationId: string; reason: string }>>([]);

  // Urgência é função do relógio: sem este tique o painel congelaria no
  // instante em que foi aberto e mostraria uma fila que já mudou.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const items = useMemo(() => conversations.map(toQueueItem), [conversations]);
  const convById = useMemo(() => new Map(conversations.map(c => [c.id, c])), [conversations]);
  const staffById = useMemo(() => new Map(staff.map(s => [s.user_id, s])), [staff]);
  const nameOf = useCallback(
    (id: string | null | undefined) => (id ? staffById.get(id)?.name ?? 'Atendente' : '—'),
    [staffById],
  );

  const loads = useMemo(() => agentLoads(items), [items]);

  // Setores presentes na fila. Quando a matriz de membros não chegou (ou não há
  // nenhuma), tratamos todo mundo como membro de todos: presumir o contrário
  // faria a conversa roteada para um setor NUNCA ser distribuída — pior do que
  // distribuir para alguém de fora do setor, que ao menos é atendida.
  const departmentsInQueue = useMemo(
    () => Array.from(new Set(items.map(i => i.departmentId).filter((d): d is string => !!d))),
    [items],
  );
  const membershipKnown = !!departmentMembers && Object.keys(departmentMembers).length > 0;

  const routingAgents = useMemo<RoutingAgent[]>(
    () => staff.map(s => ({
      userId: s.user_id,
      name: s.name,
      role: s.role,
      // Advogado deduzido do cadastro — a mesma regra do resto do módulo.
      isLawyer: (s.role || '').toLowerCase().startsWith('advogad') || !!s.oab?.trim(),
      // Sem sinal de presença por atendente, todo mundo é tratado como
      // disponível: inventar "ausente" esconderia conversa de quem está lá.
      availability: 'available',
      capacity,
      openLoad: loads[s.user_id] ?? 0,
      departmentIds: membershipKnown
        ? Object.entries(departmentMembers!)
          .filter(([, users]) => users.includes(s.user_id))
          .map(([deptId]) => deptId)
        : departmentsInQueue,
      channelIds: '*',
    })),
    [staff, capacity, loads, departmentMembers, membershipKnown, departmentsInQueue],
  );

  const health = useMemo(
    () => queueHealth(items, routingAgents, tick, policy),
    [items, routingAgents, tick, policy],
  );
  const ranked = useMemo(() => rankQueue(items, tick, policy), [items, tick, policy]);
  const diagnosis = DIAGNOSIS[health.diagnosis] ?? DIAGNOSIS.saudavel;

  const buildPreview = useCallback(() => {
    const { assignments, unassigned } = distributeQueue(items, routingAgents, Date.now(), { policy });
    setPreview(assignments);
    setUnassignable(unassigned);
  }, [items, routingAgents, policy]);

  const applyPreview = useCallback(async () => {
    if (!preview?.length) return;
    setApplying(true);
    let ok = 0;
    const failures: string[] = [];
    // Sequencial de propósito: em paralelo, uma falha no meio deixaria metade
    // distribuída sem o operador saber quais.
    for (const a of preview) {
      try {
        await whatsappService.assignConversation(a.conversationId, a.userId);
        ok += 1;
      } catch (e) {
        failures.push(convById.get(a.conversationId)?.contact_name ?? a.conversationId);
      }
    }
    setApplying(false);
    setPreview(null);
    setUnassignable([]);
    onChanged();
    if (failures.length === 0) toast.success('Fila distribuída', `${ok} ${ok === 1 ? 'conversa atribuída' : 'conversas atribuídas'}.`);
    else toast.warning('Distribuição parcial', `${ok} atribuídas; falhou em ${failures.length}.`);
  }, [preview, convById, onChanged, toast]);

  const releaseStalled = useCallback(async (conversationId: string) => {
    setReleasing(conversationId);
    try {
      await whatsappService.releaseToQueue(conversationId);
      onChanged();
      toast.success('Devolvida à fila', 'A conversa voltou a ficar disponível para quem puder assumir.');
    } catch (e: any) {
      toast.error('Não foi possível devolver', e?.message);
    } finally {
      setReleasing(null);
    }
  }, [onChanged, toast]);

  return (
    <WaDialog
      title="Fila de atendimento"
      subtitle={`${health.total} aguardando · ${health.unassigned} sem responsável`}
      icon={<Activity size={18} />}
      onClose={onClose}
      size="lg"
      zIndex={60}
      tone={diagnosis.tone === 'danger' ? 'danger' : diagnosis.tone === 'warn' ? 'default' : 'success'}
    >
      <WaDialogBody>
        <div className="space-y-5">

          {/* ── Diagnóstico ── */}
          <div className={`rounded-xl border px-3.5 py-3 ${TONE_BOX[diagnosis.tone]}`}>
            <p className="flex items-center gap-1.5 text-[13px] font-bold">
              {diagnosis.tone === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {diagnosis.title}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed opacity-90">{diagnosis.detail}</p>
            {health.idleAgents.length > 0 && health.unassigned > 0 && (
              <p className="mt-1.5 text-[12px] leading-relaxed opacity-90">
                Sem nenhuma conversa agora: {health.idleAgents.map(nameOf).join(', ')}.
              </p>
            )}
          </div>

          {/* ── Composição da fila ── */}
          {health.buckets.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Composição da fila</p>
              <div className="flex flex-wrap gap-1.5">
                {health.buckets.map(b => (
                  <span key={b.bucket}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${BUCKET_STYLE[b.bucket]}`}>
                    {b.count} {BUCKET_LABEL[b.bucket]}
                    {b.oldestMinutes >= 1 && (
                      <span className="font-normal opacity-70">· até {humanMin(b.oldestMinutes)}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Transferências travadas ── */}
          {health.stalled.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500">
                <ArrowRightLeft size={12} /> Transferências sem aceite
              </p>
              <p className="mb-2 text-[11.5px] leading-relaxed text-slate-500">
                O destino nunca assumiu. O cliente acha que está sendo atendido e ninguém é dono da conversa.
              </p>
              <div className="space-y-1.5">
                {health.stalled.map(s => {
                  const conv = convById.get(s.id);
                  if (!conv) return null;
                  return (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50/50 px-2.5 py-2">
                      <button type="button" onClick={() => { onOpenConversation(s.id); onClose(); }}
                        className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-slate-700 hover:text-amber-700 hover:underline">
                        {conversationName(conv)}
                      </button>
                      <span className="shrink-0 text-[11px] text-slate-500">
                        para {nameOf(conv.assigned_user_id)} · {humanMin(s.pendingMinutes)}
                      </span>
                      <button type="button" onClick={() => releaseStalled(s.id)} disabled={releasing === s.id}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11.5px] font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-50">
                        {releasing === s.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                        Devolver à fila
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Distribuição assistida ── */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <Sparkles size={12} /> Distribuição
              </p>
              {preview === null ? (
                <button type="button" onClick={buildPreview} disabled={health.unassigned === 0}
                  className={`${waBtnGhost} !px-3 !py-1.5 !text-[12px]`}>
                  <ListTodo size={13} /> Sugerir distribuição
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { setPreview(null); setUnassignable([]); }}
                    className={`${waBtnGhost} !px-3 !py-1.5 !text-[12px]`}>Descartar</button>
                  <button type="button" onClick={applyPreview} disabled={applying || preview.length === 0}
                    className={`${waBtnPrimary} !px-3 !py-1.5 !text-[12px]`}>
                    {applying ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Aplicar {preview.length}
                  </button>
                </div>
              )}
            </div>

            {preview === null ? (
              <p className="text-[11.5px] leading-relaxed text-slate-500">
                Distribui só o que está <strong>sem responsável</strong>, em ordem de urgência, equilibrando a carga —
                e sempre mostra a prévia antes de aplicar. Conversa de colega não é puxada.
              </p>
            ) : preview.length === 0 ? (
              <p className="rounded-lg border border-[#eae7df] bg-[#faf9f7] px-3 py-2 text-[12px] text-slate-500">
                Nada a distribuir: nenhuma conversa sem responsável encontrou atendente elegível.
              </p>
            ) : (
              <div className="space-y-1.5">
                {preview.map(a => {
                  const conv = convById.get(a.conversationId);
                  return (
                    <div key={a.conversationId} className="flex items-center gap-2 rounded-lg border border-[#f1f0ec] px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-700">
                        {conv ? conversationName(conv) : a.conversationId}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">→</span>
                      <span className="shrink-0 text-[12px] font-semibold text-amber-700">{nameOf(a.userId)}</span>
                      <span className="w-28 shrink-0 truncate text-right text-[10.5px] text-slate-400" title={a.reason}>
                        {a.reason}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {unassignable.length > 0 && (
              <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11.5px] text-amber-800">
                {unassignable.length} {unassignable.length === 1 ? 'conversa ficou' : 'conversas ficaram'} sem destino:
                {' '}{unassignable[0].reason}.
              </p>
            )}
          </div>

          {/* ── Carga por atendente ── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Users size={12} /> Carga por atendente
            </p>
            {staff.length === 0 ? (
              <p className="text-[12px] text-slate-400">Nenhum atendente cadastrado.</p>
            ) : (
              <div className="space-y-2">
                {[...staff]
                  .sort((a, b) => (loads[b.user_id] ?? 0) - (loads[a.user_id] ?? 0))
                  .map(s => {
                    const load = loads[s.user_id] ?? 0;
                    const max = Math.max(1, ...Object.values(loads));
                    return (
                      <div key={s.user_id} className="flex items-center gap-2.5">
                        <span className="w-36 shrink-0 truncate text-[12.5px] text-slate-700">
                          {s.name}
                          {s.user_id === currentUserId && <span className="ml-1 text-[10px] text-amber-600">você</span>}
                        </span>
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${(load / max) * 100}%` }} />
                        </div>
                        <span className="w-6 shrink-0 text-right text-[11.5px] font-bold text-slate-500">{load}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* ── Fila em ordem ── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Inbox size={12} /> Ordem de atendimento
            </p>
            {ranked.length === 0 ? (
              <p className="text-[12px] text-slate-400">Nada aguardando.</p>
            ) : (
              <div className="space-y-1">
                {ranked.slice(0, 15).map((p, i) => {
                  const conv = convById.get(p.id);
                  if (!conv) return null;
                  return (
                    <button key={p.id} type="button" onClick={() => { onOpenConversation(p.id); onClose(); }}
                      className="flex w-full items-center gap-2 rounded-lg border border-[#f1f0ec] px-2.5 py-1.5 text-left transition hover:bg-[#faf9f7]">
                      <span className="w-4 shrink-0 text-[10px] font-bold text-slate-300">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-700">
                        {conversationName(conv)}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${BUCKET_STYLE[p.bucket]}`}>
                        {p.label}
                      </span>
                      <span className="w-20 shrink-0 truncate text-right text-[10.5px] text-slate-400">
                        {p.assignedUserId ? nameOf(p.assignedUserId) : 'sem dono'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </WaDialogBody>
    </WaDialog>
  );
};

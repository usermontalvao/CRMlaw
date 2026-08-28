// Modais de ação sobre a conversa: transferir, bloquear contato e encerrar
// atendimento. Extraídos de WhatsAppModule.tsx — autocontidos, dependem só das
// primitivas de UI compartilhadas, do serviço e do contexto de toast.
import React, { useMemo, useState } from 'react';
import {
  Ban, Loader2, CheckCircle2, ArrowRightLeft, ShieldCheck, AlertTriangle, Scale,
  Check, Search, Users, MessageSquareText,
} from 'lucide-react';
import {
  WaDialog, WaDialogBody, WaDialogActions, WaField, WaFieldStack,
  waTextarea, waBtnGhost, waBtnPrimary, waBtnDanger,
} from './ui';
import { conversationName, agentLabel, initials } from './format';
import { agentLoads } from './attendanceRouting';
import { validateTransfer, suggestLawyers, type TransferStaff } from './transferPolicy';
import { whatsappService, renderTemplate, type StaffOption } from '../../services/whatsapp.service';
import { sendTextResilient } from '../../services/whatsapp/resilientSend';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppConversation, WhatsAppDepartment } from '../../types/whatsapp.types';
import type { WhatsAppModuleConfig } from '../../services/settings.service';

// ── Modal de transferência ──
export const TransferModal: React.FC<{
  conversation: WhatsAppConversation;
  departments: WhatsAppDepartment[];
  staff: StaffOption[];
  moduleConfig: WhatsAppModuleConfig;
  /** Fila inteira — só para calcular a carga viva de cada atendente. */
  conversations?: WhatsAppConversation[];
  /** Quem está transferindo (bloqueia transferir para si mesmo). */
  currentUserId?: string | null;
  /** Atendentes que já passaram por esta conversa (continuidade na sugestão). */
  previousAgentIds?: string[];
  onClose: () => void;
  onDone: () => void;
}> = ({ conversation, departments, staff, moduleConfig, conversations, currentUserId, previousAgentIds, onClose, onDone }) => {
  const toast = useToastContext();
  const [dept, setDept] = useState<string>(conversation.department_id || '');
  const [person, setPerson] = useState<string>(conversation.assigned_user_id || '');
  const [note, setNote] = useState('');
  const [buscaPessoa, setBuscaPessoa] = useState('');
  const [motivoAberto, setMotivoAberto] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carga viva por atendente. Transferir às cegas é o que faz uma pessoa
  // acumular 12 conversas enquanto o colega ao lado está com duas.
  const loads = useMemo(
    () => agentLoads((conversations ?? []).map(c => ({
      id: c.id,
      status: c.status,
      isBlocked: c.is_blocked,
      assignedUserId: c.assigned_user_id,
      departmentId: c.department_id,
      awaitingAccept: c.awaiting_accept,
      transferPendingSince: c.transfer_pending_since,
      lastMessageDirection: c.last_message_direction,
      lastCustomerMessageAt: c.last_customer_message_at,
      lastMessageAt: c.last_message_at,
      lastCallAt: c.last_call_at,
      labels: c.labels,
    }))),
    [conversations],
  );

  const policyStaff = useMemo<TransferStaff[]>(
    () => staff.map(s => ({
      userId: s.user_id,
      name: s.name,
      role: s.role,
      oab: s.oab,
      isActive: true,
      openLoad: loads[s.user_id] ?? 0,
      capacity: 0,               // sem teto declarado no cadastro: só informa a carga
      channelIds: '*',
    })),
    [staff, loads],
  );

  const validation = useMemo(
    () => validateTransfer(
      {
        conversationId: conversation.id,
        channelId: conversation.instance_id,
        currentAssignee: conversation.assigned_user_id,
        currentDepartment: conversation.department_id,
        awaitingAccept: conversation.awaiting_accept,
        status: conversation.status,
        isBlocked: conversation.is_blocked,
      },
      { toUserId: person || null, toDepartmentId: dept || null, byUserId: currentUserId ?? null },
      policyStaff,
    ),
    [conversation, person, dept, currentUserId, policyStaff],
  );

  // Encaminhar para advogado é o caminho mais usado — a lista já vem ranqueada
  // (quem já atendeu este cliente primeiro, depois quem está mais livre).
  const lawyerPicks = useMemo(
    () => suggestLawyers(
      policyStaff,
      { channelId: conversation.instance_id, currentAssignee: conversation.assigned_user_id },
      { previousAgentIds },
    ).slice(0, 3),
    [policyStaff, conversation.instance_id, conversation.assigned_user_id, previousAgentIds],
  );

  const canSubmit = validation.ok;

  // Monta a mensagem automática ao cliente conforme o destino (Fase 2):
  // por pessoa usa o tratamento (Dr./Dra.); por setor usa o nome do setor.
  const buildTransferMessage = (): string | null => {
    if (person) {
      const target = staff.find(s => s.user_id === person);
      const label = agentLabel(target) || target?.name;
      if (label) return renderTemplate(moduleConfig.transfer_to_agent_template, {
        clientName: conversation.contact_name ?? null,
        clientPhone: conversation.contact_phone ?? null,
        extraVars: { destino: label },
      });
    }
    if (dept) {
      const d = departments.find(x => x.id === dept);
      if (d) return renderTemplate(moduleConfig.transfer_to_department_template, {
        clientName: conversation.contact_name ?? null,
        clientPhone: conversation.contact_phone ?? null,
        extraVars: { setor: d.name },
      });
    }
    return null;
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await whatsappService.transferConversation({
        conversationId: conversation.id,
        toDepartmentId: dept || null,
        toUserId: person || null,
        note: note.trim() || undefined,
      });
      // Transferência nunca muda: avisa o cliente automaticamente (best-effort).
      // Resiliente: se o canal estiver fora, o aviso é retido para reenvio
      // automático em vez de se perder.
      const msg = buildTransferMessage();
      if (msg && !conversation.is_blocked) {
        try { await sendTextResilient({ conversationId: conversation.id, channelId: conversation.instance_id, text: msg }); }
        catch { /* aviso é best-effort; a transferência já foi registrada */ }
      }
      onDone();
    } catch (err: any) {
      toast.error('Falha ao transferir', err.message);
    } finally { setSaving(false); }
  };

  // Uma linha por destino possível, já na ordem em que se decide: quem o
  // sistema sugere primeiro, o resto do time depois. A busca filtra os dois.
  const sugeridos = useMemo(() => new Map(lawyerPicks.map(p => [p.userId, p])), [lawyerPicks]);
  const listaPessoas = useMemo(() => {
    const termo = buscaPessoa.trim().toLowerCase();
    const filtrados = staff.filter(s => !termo || s.name.toLowerCase().includes(termo));
    // Sugeridos sobem, mantendo entre eles a ordem do ranqueamento.
    const ordemSugerida = lawyerPicks.map(p => p.userId);
    return [...filtrados].sort((a, b) => {
      const ia = ordemSugerida.indexOf(a.user_id);
      const ib = ordemSugerida.indexOf(b.user_id);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });
  }, [staff, buscaPessoa, lawyerPicks]);

  const bloqueio = validation.issues.find(i => i.level === 'block') ?? null;
  const ressalva = validation.issues.find(i => i.level !== 'block') ?? null;

  return (
    <WaDialog
      title="Transferir conversa"
      subtitle={conversationName(conversation)}
      icon={<ArrowRightLeft size={16} />}
      onClose={onClose}
      size="xs"
      footer={
        <WaDialogActions>
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} disabled={saving || !canSubmit}
            title={validation.blocks[0]?.message}
            className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />} Transferir
          </button>
        </WaDialogActions>
      }
    >
      {/* Sem `WaDialogBody`: aqui o corpo é uma LISTA que rola sozinha, como
          numa tela de aplicativo — a moldura fica parada e só o miolo anda. */}
      <div className="flex flex-col">
        {/* ── Setor: fila de pastilhas, não um select ──
            São poucos e cabem numa linha; o select escondia as opções atrás de
            um clique e fazia o diálogo parecer um formulário de cadastro. */}
        {departments.length > 0 && (
          <div className="shrink-0 border-b border-[#f4f2ee] px-3 py-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Users size={11} /> Setor
            </p>
            <div className="-mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
              <Pastilha ativa={!dept} onClick={() => setDept('')}>Nenhum</Pastilha>
              {departments.map(d => (
                <Pastilha key={d.id} ativa={dept === d.id} onClick={() => setDept(d.id)}>{d.name}</Pastilha>
              ))}
            </div>
          </div>
        )}

        {/* ── Responsável: a lista que decide a transferência ── */}
        <div className="shrink-0 px-3 pt-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Scale size={11} /> Responsável
          </p>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              value={buscaPessoa} onChange={e => setBuscaPessoa(e.target.value)}
              placeholder="Buscar pelo nome"
              className="w-full rounded-lg border border-[#e2e0d9] bg-white py-1.5 pl-7 pr-2.5 text-[12.5px] text-slate-800 outline-none transition placeholder:text-slate-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
        </div>

        <div className="min-h-0 max-h-[13.5rem] overflow-y-auto px-1.5 py-1.5">
          <LinhaDestino
            ativa={!person}
            titulo="Ninguém"
            detalhe="Devolve a conversa para a fila do setor"
            onClick={() => setPerson('')}
          />
          {listaPessoas.map(s => {
            const pick = sugeridos.get(s.user_id);
            const load = loads[s.user_id] ?? 0;
            return (
              <LinhaDestino
                key={s.user_id}
                ativa={person === s.user_id}
                titulo={agentLabel(s) || s.name}
                detalhe={conversations?.length
                  ? `${load} ${load === 1 ? 'conversa aberta' : 'conversas abertas'}`
                  : (s.role || '')}
                marca={pick ? (pick.caution ?? pick.reasons[0] ?? 'sugerido') : null}
                iniciais={initials(s.name, '')}
                onClick={() => setPerson(s.user_id)}
              />
            );
          })}
          {listaPessoas.length === 0 && (
            <p className="px-2 py-6 text-center text-[12px] text-slate-400">Ninguém com esse nome.</p>
          )}
        </div>

        {/* ── Impedimento e ressalva: uma linha cada, no lugar do bloco de avisos.
            Corrigir um erro por vez com o diálogo fechando a cada tentativa faz
            o atendente desistir — por isso os dois aparecem juntos, mas rasos. */}
        {(bloqueio || ressalva) && (
          <div className="shrink-0 space-y-1 border-t border-[#f4f2ee] px-3 py-2">
            {bloqueio && (
              <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-red-700">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {bloqueio.message}
              </p>
            )}
            {ressalva && (
              <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-700">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {ressalva.message}
              </p>
            )}
          </div>
        )}

        {/* ── Motivo: fechado por padrão ──
            É opcional e interno; ocupando um textarea aberto, ele respondia por
            um terço da altura do diálogo sem ser preenchido quase nunca. */}
        <div className="shrink-0 border-t border-[#f4f2ee] px-3 py-2">
          {motivoAberto || note ? (
            <>
              <label htmlFor="wa-transfer-note" className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <MessageSquareText size={11} /> Motivo <span className="font-normal normal-case tracking-normal text-slate-300">(interno)</span>
              </label>
              <textarea
                id="wa-transfer-note" value={note} onChange={e => setNote(e.target.value)} rows={2} autoFocus={motivoAberto}
                placeholder="Ex: cliente quer falar com o financeiro"
                className={waTextarea}
              />
            </>
          ) : (
            <button type="button" onClick={() => setMotivoAberto(true)}
              className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-400 transition hover:text-amber-700">
              <MessageSquareText size={12} /> Anotar um motivo (opcional)
            </button>
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
            O cliente recebe um aviso automático de encaminhamento.
          </p>
        </div>
      </div>
    </WaDialog>
  );
};

/** Pastilha de escolha única — o select de setor virou isto. */
const Pastilha: React.FC<{ ativa: boolean; onClick: () => void; children: React.ReactNode }> = ({ ativa, onClick, children }) => (
  <button
    type="button" onClick={onClick}
    className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${
      ativa
        ? 'border-amber-300 bg-amber-100 text-amber-800'
        : 'border-[#e7e5df] bg-white text-slate-600 hover:bg-[#f7f6f3]'
    }`}
  >
    {children}
  </button>
);

/** Uma linha da lista de destinos: avatar, nome, carga e o visto de escolhido. */
const LinhaDestino: React.FC<{
  ativa: boolean;
  titulo: string;
  detalhe?: string;
  marca?: string | null;
  iniciais?: string;
  onClick: () => void;
}> = ({ ativa, titulo, detalhe, marca, iniciais, onClick }) => (
  <button
    type="button" onClick={onClick}
    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
      ativa ? 'bg-amber-50' : 'hover:bg-[#f7f6f3]'
    }`}
  >
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold ${
      ativa ? 'bg-amber-200 text-amber-800' : 'bg-[#f0eee9] text-slate-500'
    }`}>
      {iniciais || '—'}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold text-slate-700">{titulo}</span>
        {marca && (
          <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-emerald-700">
            {marca}
          </span>
        )}
      </span>
      {detalhe && <span className="block truncate text-[11px] text-slate-400">{detalhe}</span>}
    </span>
    {ativa && <Check size={15} className="shrink-0 text-amber-600" />}
  </button>
);

// ── Modal: Bloquear contato ──
export const BlockContactModal: React.FC<{
  conversation: WhatsAppConversation;
  onClose: () => void;
  onDone: (reason: string) => void;
}> = ({ conversation, onClose, onDone }) => {
  const toast = useToastContext();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      const { wa_blocked, wa_error } = await whatsappService.blockContact(conversation.id, reason);
      if (!wa_blocked) toast.warning('Bloqueado só internamente', `O WhatsApp não confirmou o bloqueio, mas as novas mensagens já não entram na fila.${wa_error ? ` Detalhe: ${wa_error}` : ''}`);
      onDone(reason.trim());
    } catch (e: any) {
      toast.error('Falha ao bloquear', e.message);
    } finally { setSaving(false); }
  };

  return (
    <WaDialog
      title="Bloquear contato"
      subtitle={conversationName(conversation)}
      icon={<Ban size={18} />}
      onClose={onClose}
      size="sm"
      tone="danger"
      footer={
        <WaDialogActions>
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} disabled={saving || !reason.trim()} className={waBtnDanger}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Bloquear
          </button>
        </WaDialogActions>
      }
    >
      <WaDialogBody>
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-800">
          O contato sai da fila normal de atendimento. A ação fica registrada.
        </p>
        <WaField label="Motivo do bloqueio" optional="(obrigatório)" htmlFor="wa-block-reason">
          <textarea id="wa-block-reason" autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Ex: spam, número trote, contato indevido" className={waTextarea} />
        </WaField>
      </WaDialogBody>
    </WaDialog>
  );
};

// ── Modal: Ativar guarda jurídica ──
// Substitui o antigo prompt() nativo: coleta um motivo OPCIONAL ao ativar a
// guarda. Dialog puro de entrada — a mutação/optimismo/toast vivem no hook
// useWaConversationActions, que recebe o motivo via onConfirm.
export const LegalHoldModal: React.FC<{
  subtitle?: string;
  onClose: () => void;
  onConfirm: (reason: string | undefined) => void;
}> = ({ subtitle, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  return (
    <WaDialog
      title="Ativar guarda jurídica"
      subtitle={subtitle}
      icon={<ShieldCheck size={18} />}
      onClose={onClose}
      size="sm"
      tone="info"
      footer={
        <WaDialogActions>
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={() => onConfirm(reason.trim() || undefined)} className={waBtnPrimary}>
            <ShieldCheck size={14} /> Ativar guarda
          </button>
        </WaDialogActions>
      }
    >
      <WaDialogBody>
        <p className="mb-4 rounded-xl border border-[#eae7df] bg-[#faf9f7] px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
          A conversa fica protegida da política de retenção (não é purgada). Você pode registrar um motivo.
        </p>
        <WaField label="Motivo da guarda jurídica" optional="(opcional, interno)" htmlFor="wa-hold-reason">
          <textarea id="wa-hold-reason" autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Ex: processo em andamento, ordem judicial" className={waTextarea} />
        </WaField>
      </WaDialogBody>
    </WaDialog>
  );
};

// ── Modal: Encerrar atendimento (Fase 3) ──
export const CloseConversationModal: React.FC<{
  conversation: WhatsAppConversation;
  agent?: StaffOption | null;
  moduleConfig: WhatsAppModuleConfig;
  onClose: () => void;
  /** Recebe o encerramento já em curso — a tela fecha antes de ele terminar. */
  onDone: (task: Promise<void>) => void;
}> = ({ conversation, moduleConfig, onClose, onDone }) => {
  const toast = useToastContext();
  const [reason, setReason] = useState('');
  const [farewell, setFarewell] = useState(moduleConfig.close_farewell_default);

  /**
   * Encerrar não faz mais o atendente esperar: o trabalho (gravar o status e
   * mandar a despedida pelo WhatsApp) sai daqui em 2º plano e o modal fecha na
   * hora. Quem clicou já sabe o que pediu; segurar a tela até o WhatsApp
   * responder só transformava o clique num travamento de alguns segundos.
   * Se algo falhar, o toast avisa — o modal já não está mais na frente.
   */
  const submit = () => {
    const task = whatsappService
      .closeConversation(conversation.id, reason, { farewell: farewell.trim() || undefined })
      .catch((e: any) => {
        toast.error('Falha ao encerrar', e?.message);
        throw e;
      });
    onDone(task);
  };

  return (
    <WaDialog
      title="Encerrar atendimento"
      subtitle={conversationName(conversation)}
      icon={<CheckCircle2 size={18} />}
      onClose={onClose}
      size="sm"
      tone="success"
      footer={
        <WaDialogActions>
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} className={waBtnPrimary}>
            <CheckCircle2 size={14} /> Encerrar
          </button>
        </WaDialogActions>
      }
    >
      <WaDialogBody>
        <p className="mb-4 rounded-xl border border-[#eae7df] bg-[#faf9f7] px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
          A conversa sai da fila ativa e reabre sozinha se o cliente voltar a falar.
        </p>
        <WaFieldStack>
          <WaField label="Motivo do encerramento" optional="(interno, opcional)" htmlFor="wa-close-reason">
            <textarea id="wa-close-reason" autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="Ex: dúvida resolvida" className={waTextarea} />
          </WaField>

          <WaField
            label="Mensagem ao cliente" optional="(deixe vazio para não enviar)" htmlFor="wa-close-farewell"
            hint="Enviada no WhatsApp antes de encerrar."
          >
            <textarea id="wa-close-farewell" value={farewell} onChange={e => setFarewell(e.target.value)} rows={2}
              className={waTextarea} />
          </WaField>
        </WaFieldStack>
      </WaDialogBody>
    </WaDialog>
  );
};

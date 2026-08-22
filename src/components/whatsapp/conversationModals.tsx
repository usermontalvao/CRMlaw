// Modais de ação sobre a conversa: transferir, bloquear contato e encerrar
// atendimento. Extraídos de WhatsAppModule.tsx — autocontidos, dependem só das
// primitivas de UI compartilhadas, do serviço e do contexto de toast.
import React, { useMemo, useState } from 'react';
import { Ban, Loader2, CheckCircle2, ArrowRightLeft, ShieldCheck, AlertTriangle, Scale } from 'lucide-react';
import {
  WaDialog, WaDialogBody, WaDialogActions, WaField, WaFieldStack,
  waTextarea, waSelect, waSelectStyle, waBtnGhost, waBtnPrimary, waBtnDanger,
} from './ui';
import { conversationName, agentLabel } from './format';
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

  return (
    <WaDialog
      title="Transferir conversa"
      subtitle={conversationName(conversation)}
      icon={<ArrowRightLeft size={18} />}
      onClose={onClose}
      size="sm"
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
      <WaDialogBody>
        <WaFieldStack>
          {/* Atalho para o caminho mais comum: passar o caso para um advogado,
              já na ordem certa (continuidade primeiro, depois quem está livre). */}
          {lawyerPicks.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <Scale size={11} /> Encaminhar para advogado
              </p>
              <div className="flex flex-wrap gap-1.5">
                {lawyerPicks.map(pick => (
                  <button
                    key={pick.userId}
                    type="button"
                    onClick={() => setPerson(pick.userId)}
                    title={pick.reasons.join(' · ')}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${
                      person === pick.userId
                        ? 'border-amber-300 bg-amber-100 text-amber-800'
                        : 'border-[#e7e5df] bg-white text-slate-600 hover:bg-[#f7f6f3]'
                    }`}
                  >
                    {pick.name}
                    <span className="font-normal text-slate-400">
                      {pick.caution ?? pick.reasons[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <WaField label="Departamento" htmlFor="wa-transfer-dept">
            <select id="wa-transfer-dept" value={dept} onChange={e => setDept(e.target.value)}
              className={waSelect} style={waSelectStyle}>
              <option value="">Nenhum</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </WaField>

          <WaField
            label="Responsável" htmlFor="wa-transfer-person"
            hint={conversations?.length ? 'O número ao lado do nome é a carga de conversas ativas.' : undefined}
          >
            <select id="wa-transfer-person" value={person} onChange={e => setPerson(e.target.value)}
              className={waSelect} style={waSelectStyle}>
              <option value="">Ninguém</option>
              {staff.map(s => {
                const load = loads[s.user_id] ?? 0;
                return (
                  <option key={s.user_id} value={s.user_id}>
                    {s.name}{conversations?.length ? ` — ${load} ${load === 1 ? 'conversa' : 'conversas'}` : ''}
                  </option>
                );
              })}
            </select>
          </WaField>

          {/* Impedimentos e ressalvas de uma vez só: corrigir um erro por vez,
              com o modal fechando a cada tentativa, faz o atendente desistir. */}
          {validation.issues.length > 0 && (
            <ul className="space-y-1.5">
              {validation.issues.map(issue => (
                <li key={issue.code}
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] leading-relaxed ${
                    issue.level === 'block'
                      ? 'border-red-100 bg-red-50/70 text-red-800'
                      : 'border-amber-100 bg-amber-50/70 text-amber-800'
                  }`}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}

          <WaField
            label="Motivo da transferência" optional="(opcional, interno)" htmlFor="wa-transfer-note"
            hint="O motivo fica só no histórico interno. O cliente recebe um aviso automático de encaminhamento."
          >
            <textarea id="wa-transfer-note" value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Ex: cliente quer falar com o financeiro" className={waTextarea} />
          </WaField>
        </WaFieldStack>
      </WaDialogBody>
    </WaDialog>
  );
};

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

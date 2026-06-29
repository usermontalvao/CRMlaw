// Modais de ação sobre a conversa: transferir, bloquear contato e encerrar
// atendimento. Extraídos de WhatsAppModule.tsx — autocontidos, dependem só das
// primitivas de UI compartilhadas, do serviço e do contexto de toast.
import React, { useState } from 'react';
import { Ban, Loader2, CheckCircle2, ArrowRightLeft, ShieldCheck } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput, waLabel, waBtnGhost, waBtnPrimary, waBtnDanger } from './ui';
import { prettyPhone, agentLabel } from './format';
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
  onClose: () => void;
  onDone: () => void;
}> = ({ conversation, departments, staff, moduleConfig, onClose, onDone }) => {
  const toast = useToastContext();
  const [dept, setDept] = useState<string>(conversation.department_id || '');
  const [person, setPerson] = useState<string>(conversation.assigned_user_id || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const hasDestination = !!dept || !!person;
  const canSubmit = hasDestination;

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
      icon={<ArrowRightLeft size={18} />}
      onClose={onClose}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} disabled={saving || !canSubmit}
            title={!hasDestination ? 'Escolha um setor ou responsável' : undefined}
            className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />} Transferir
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <label className={waLabel}>Departamento</label>
        <select value={dept} onChange={e => setDept(e.target.value)} className={`${waInput} mb-3`}>
          <option value="">Nenhum</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        <label className={waLabel}>Responsável</label>
        <select value={person} onChange={e => setPerson(e.target.value)} className={`${waInput} mb-3`}>
          <option value="">Ninguém</option>
          {staff.map(s => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
        </select>

        <label className={waLabel}>Motivo da transferência <span className="font-normal text-slate-400">(opcional, interno)</span></label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Ex: cliente quer falar com o financeiro"
          className={`${waInput} mb-1 resize-none`} />
        <p className="text-[11px] text-slate-400">O motivo fica só no histórico interno. O cliente recebe um aviso automático de encaminhamento.</p>
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
      subtitle={conversation.contact_name || prettyPhone(conversation.contact_phone)}
      icon={<Ban size={18} />}
      onClose={onClose}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} disabled={saving || !reason.trim()} className={waBtnDanger}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Bloquear
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <p className="text-[12.5px] text-slate-500 mb-3">
          O contato sai da fila normal de atendimento. A ação fica registrada.
        </p>
        <label className={waLabel}>Motivo do bloqueio <span className="text-red-500">*</span></label>
        <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Ex: spam, número trote, contato indevido"
          className={`${waInput} resize-none`} />
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
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={() => onConfirm(reason.trim() || undefined)} className={waBtnPrimary}>
            <ShieldCheck size={14} /> Ativar guarda
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <p className="text-[12.5px] text-slate-500 mb-3">
          A conversa fica protegida da política de retenção (não é purgada). Você pode registrar um motivo.
        </p>
        <label className={waLabel}>Motivo da guarda jurídica <span className="font-normal text-slate-400">(opcional, interno)</span></label>
        <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Ex: processo em andamento, ordem judicial"
          className={`${waInput} resize-none`} />
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
  onDone: () => void;
}> = ({ conversation, moduleConfig, onClose, onDone }) => {
  const toast = useToastContext();
  const [reason, setReason] = useState('');
  const [farewell, setFarewell] = useState(moduleConfig.close_farewell_default);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await whatsappService.closeConversation(conversation.id, reason, { farewell: farewell.trim() || undefined });
      onDone();
    } catch (e: any) {
      toast.error('Falha ao encerrar', e.message);
    } finally { setSaving(false); }
  };

  return (
    <WaDialog
      title="Encerrar atendimento"
      subtitle="Sai da fila ativa; reabre se o cliente voltar a falar."
      icon={<CheckCircle2 size={18} />}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} disabled={saving} className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Encerrar
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <label className={waLabel}>Motivo do encerramento <span className="font-normal text-slate-400">(interno, opcional)</span></label>
        <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Ex: dúvida resolvida"
          className={`${waInput} mb-3 resize-none`} />

        <label className={waLabel}>Mensagem ao cliente <span className="font-normal text-slate-400">(deixe vazio para não enviar)</span></label>
        <textarea value={farewell} onChange={e => setFarewell(e.target.value)} rows={2}
          className={`${waInput} resize-none`} />
      </WaDialogBody>
    </WaDialog>
  );
};

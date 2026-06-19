// Modais que criam um prazo ou uma tarefa a partir de uma mensagem do WhatsApp
// (Fase H). Extraídos de WhatsAppModule.tsx — autocontidos.
import React, { useState } from 'react';
import { Calendar, ListTodo, Loader2 } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput, waLabel, waBtnGhost, waBtnPrimary } from './ui';
import { msgTitle, msgDescription, typeLabel } from './format';
import { deadlineService } from '../../services/deadline.service';
import { taskService } from '../../services/task.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppMessage } from '../../types/whatsapp.types';
import type { Process } from '../../types/process.types';
import type { DeadlineType, DeadlinePriority } from '../../types/deadline.types';
import type { TaskPriority } from '../../types/task.types';

export const CreateDeadlineFromMessageModal: React.FC<{
  message: WhatsAppMessage;
  clientId: string;
  processes: Process[];
  onClose: () => void;
}> = ({ message, clientId, processes, onClose }) => {
  const toast = useToastContext();
  const [title, setTitle] = useState(msgTitle(message));
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<DeadlinePriority>('media');
  const [type, setType] = useState<DeadlineType>('geral');
  const [processId, setProcessId] = useState('');
  const [saving, setSaving] = useState(false);

  const minDate = new Date().toISOString().slice(0, 10);

  const handleSave = async () => {
    if (!title.trim() || !dueDate) return;
    setSaving(true);
    try {
      await deadlineService.createDeadline({
        title: title.trim(),
        description: msgDescription(message),
        due_date: dueDate,
        priority,
        type,
        client_id: clientId,
        process_id: processId || null,
      });
      toast.success('Prazo criado.');
      onClose();
    } catch (e: any) { toast.error('Erro ao criar prazo', e.message); }
    finally { setSaving(false); }
  };

  return (
    <WaDialog
      title="Criar prazo"
      icon={<Calendar size={18} />}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !title.trim() || !dueDate} className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />} Criar prazo
          </button>
        </div>
      }
    >
      <WaDialogBody className="space-y-3">
        {/* Origem da mensagem */}
        <div className="px-3 py-2.5 rounded-xl bg-[#f0f2f5] border-l-2 border-[#00a884]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#017561] mb-0.5">Mensagem de origem</p>
          <p className="text-[12px] text-slate-600 line-clamp-2">{message.content || typeLabel(message.type)}</p>
          <p className="text-[10.5px] text-slate-400 mt-0.5">{new Date(message.wa_timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
        </div>

        <div>
          <label className={waLabel}>Título *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus className={waInput} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={waLabel}>Vencimento *</label>
            <input type="date" value={dueDate} min={minDate} onChange={e => setDueDate(e.target.value)} className={waInput} />
          </div>
          <div>
            <label className={waLabel}>Prioridade</label>
            <select value={priority} onChange={e => setPriority(e.target.value as DeadlinePriority)} className={waInput}>
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={waLabel}>Tipo</label>
            <select value={type} onChange={e => setType(e.target.value as DeadlineType)} className={waInput}>
              <option value="geral">Geral</option>
              <option value="processo">Processo</option>
              <option value="requerimento">Requerimento</option>
            </select>
          </div>
          {processes.length > 0 && (
            <div>
              <label className={waLabel}>Processo</label>
              <select value={processId} onChange={e => setProcessId(e.target.value)} className={waInput}>
                <option value="">Nenhum</option>
                {processes.map(p => <option key={p.id} value={p.id}>{p.process_code || p.id.slice(0, 8)}</option>)}
              </select>
            </div>
          )}
        </div>
      </WaDialogBody>
    </WaDialog>
  );
};

// ── Fase H: criar tarefa a partir de mensagem ──
export const CreateTaskFromMessageModal: React.FC<{
  message: WhatsAppMessage;
  clientId: string;
  processes: Process[];
  onClose: () => void;
}> = ({ message, clientId, processes, onClose }) => {
  const toast = useToastContext();
  const [title, setTitle] = useState(msgTitle(message));
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [processId, setProcessId] = useState('');
  const [saving, setSaving] = useState(false);

  const minDate = new Date().toISOString().slice(0, 10);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await taskService.createTask({
        title: title.trim(),
        description: msgDescription(message),
        due_date: dueDate || undefined,
        priority,
        client_id: clientId,
        process_id: processId || undefined,
      });
      toast.success('Tarefa criada.');
      onClose();
    } catch (e: any) { toast.error('Erro ao criar tarefa', e.message); }
    finally { setSaving(false); }
  };

  return (
    <WaDialog
      title="Criar tarefa"
      icon={<ListTodo size={18} />}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ListTodo size={14} />} Criar tarefa
          </button>
        </div>
      }
    >
      <WaDialogBody className="space-y-3">
        <div className="px-3 py-2.5 rounded-xl bg-[#f0f2f5] border-l-2 border-[#00a884]">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#017561] mb-0.5">Mensagem de origem</p>
          <p className="text-[12px] text-slate-600 line-clamp-2">{message.content || typeLabel(message.type)}</p>
          <p className="text-[10.5px] text-slate-400 mt-0.5">{new Date(message.wa_timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
        </div>

        <div>
          <label className={waLabel}>Título *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus className={waInput} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={waLabel}>Prazo</label>
            <input type="date" value={dueDate} min={minDate} onChange={e => setDueDate(e.target.value)} className={waInput} />
          </div>
          <div>
            <label className={waLabel}>Prioridade</label>
            <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className={waInput}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
          </div>
        </div>
        {processes.length > 0 && (
          <div>
            <label className={waLabel}>Processo</label>
            <select value={processId} onChange={e => setProcessId(e.target.value)} className={waInput}>
              <option value="">Nenhum</option>
              {processes.map(p => <option key={p.id} value={p.id}>{p.process_code || p.id.slice(0, 8)}</option>)}
            </select>
          </div>
        )}
      </WaDialogBody>
    </WaDialog>
  );
};

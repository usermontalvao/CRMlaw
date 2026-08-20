import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Link2, ListTodo, Loader2 } from 'lucide-react';
import { ClientSearchSelect } from './ClientSearchSelect';
import { Modal, ModalBody } from './ui';
import { useFormLayout } from '../hooks/useFormLayout';
import { processService } from '../services/process.service';
import { settingsService, TASK_MODULE_DEFAULTS, type TaskPriorityConfig } from '../services/settings.service';
import { taskService } from '../services/task.service';
import type { Process } from '../types/process.types';
import type { Task, TaskPriority } from '../types/task.types';
import { LAYER } from '../styles/layers';

export type TaskFormData = {
  title: string;
  description: string;
  due_date: string;
  priority: TaskPriority;
  client_id: string;
  process_id: string;
};

export interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (task: Task) => void | Promise<void>;
  selectedTask?: Task | null;
  initialData?: Partial<TaskFormData>;
  initialClientName?: string;
  initialProcesses?: Process[];
  variant?: 'full' | 'quick';
}

const emptyForm: TaskFormData = {
  title: '',
  description: '',
  due_date: '',
  priority: 'medium',
  client_id: '',
  process_id: '',
};

const EMPTY_PROCESSES: Process[] = [];

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  open,
  onClose,
  onSaved,
  selectedTask,
  initialData,
  initialClientName,
  initialProcesses = EMPTY_PROCESSES,
  variant = 'full',
}) => {
  const isQuick = variant === 'quick';
  const fl = useFormLayout('tasks');
  const [formData, setFormData] = useState<TaskFormData>(emptyForm);
  const [priorities, setPriorities] = useState<TaskPriorityConfig[]>(TASK_MODULE_DEFAULTS.priorities);
  const [processes, setProcesses] = useState<Process[]>(initialProcesses);
  const [processesLoading, setProcessesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialPriority = selectedTask?.priority || initialData?.priority;

  useEffect(() => {
    let active = true;
    settingsService.getTaskModuleConfig().then(config => {
      if (!active || !config.priorities?.length) return;
      const activePriorities = config.priorities.filter(priority => priority.active !== false);
      if (!activePriorities.length) return;
      setPriorities(activePriorities);
      setFormData(current => {
        const requestedPriority = initialPriority || activePriorities[0].key;
        const resolvedPriority = activePriorities.some(priority => priority.key === requestedPriority)
          ? requestedPriority
          : activePriorities[0].key;
        return { ...current, priority: resolvedPriority as TaskPriority };
      });
    }).catch(() => {
      // Mantém as configurações padrão se a personalização não estiver disponível.
    });

    return () => { active = false; };
  }, [initialPriority]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const taskData: Partial<TaskFormData> = selectedTask ? {
      title: selectedTask.title || '',
      description: selectedTask.description || '',
      due_date: selectedTask.due_date?.split('T')[0] || '',
      priority: selectedTask.priority,
      client_id: selectedTask.client_id || '',
      process_id: selectedTask.process_id || '',
    } : {};
    setFormData({ ...emptyForm, ...taskData, ...initialData });
    setProcesses(initialProcesses);
  }, [open, selectedTask, initialData, initialProcesses]);

  useEffect(() => {
    if (isQuick) {
      setProcesses([]);
      setProcessesLoading(false);
      return;
    }
    if (!open || !formData.client_id) {
      if (!formData.client_id) {
        setProcesses([]);
        setProcessesLoading(false);
      }
      return;
    }

    const providedForClient = initialProcesses.filter(process => process.client_id === formData.client_id);
    if (providedForClient.length > 0) {
      setProcesses(providedForClient);
      setProcessesLoading(false);
      return;
    }

    let active = true;
    setProcessesLoading(true);
    processService.listProcesses({ client_id: formData.client_id }).then(items => {
      if (active) setProcesses(items);
    }).catch(() => {
      if (active) setProcesses([]);
    }).finally(() => {
      if (active) setProcessesLoading(false);
    });

    return () => { active = false; };
  }, [isQuick, open, formData.client_id, initialProcesses]);

  const filteredProcesses = useMemo(
    () => processes.filter(process => !formData.client_id || process.client_id === formData.client_id),
    [processes, formData.client_id],
  );

  const handleChange = (field: keyof TaskFormData, value: string) => {
    setFormData(current => ({ ...current, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      setError('Informe o título da tarefa.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const task = selectedTask
        ? await taskService.updateTask(selectedTask.id, {
            title: formData.title.trim(),
            description: isQuick ? null : formData.description.trim() || null,
            due_date: isQuick ? null : formData.due_date || null,
            priority: formData.priority,
            client_id: formData.client_id || null,
            process_id: isQuick ? null : formData.process_id || null,
          })
        : await taskService.createTask({
            title: formData.title.trim(),
            description: isQuick ? undefined : formData.description.trim() || undefined,
            due_date: isQuick ? undefined : formData.due_date || undefined,
            priority: formData.priority,
            client_id: formData.client_id || undefined,
            process_id: isQuick ? undefined : formData.process_id || undefined,
          });
      await onSaved(task);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar a tarefa.');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = 'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition';
  const textareaStyle = 'w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 min-h-[96px] px-3 py-2 text-[13px] leading-5 placeholder:text-slate-400 transition resize-none';
  const labelStyle = 'block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1';

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={isQuick ? 'Criar tarefa' : selectedTask ? 'Editar Tarefa' : 'Nova Tarefa'}
      subtitle={isQuick ? 'Registre uma ação rápida para esta conversa' : selectedTask ? 'Atualize os dados e vínculos da tarefa' : 'Preencha os dados abaixo para cadastrar uma nova tarefa'}
      icon={<ListTodo className="h-5 w-5" />}
      size={isQuick ? 'md' : '2xl'}
      zIndex={LAYER.MODAL_NESTED}
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400"><span className="text-red-400">*</span> campos obrigatórios</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={onClose} disabled={saving} className="rounded px-3 py-1.5 text-[13px] font-medium text-slate-500 transition hover:bg-slate-200/50 hover:text-slate-900 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-zinc-800">
              Cancelar
            </button>
            <button type="button" onClick={handleSubmit} disabled={saving} className="flex items-center gap-2 rounded bg-orange-500 px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {selectedTask ? 'Salvar Alterações' : 'Criar Tarefa'}
            </button>
          </div>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        <div className="flex flex-col gap-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
          )}

          {isQuick ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
                <div>
                  <label className={labelStyle}>Tarefa <span className="text-red-400">*</span></label>
                  <input
                    value={formData.title}
                    onChange={event => handleChange('title', event.target.value)}
                    className={inputStyle}
                    placeholder="O que precisa ser feito?"
                    autoFocus
                    required
                  />
                </div>
                {!fl.isHidden('priority') && (
                  <div>
                    <label className={labelStyle}>{fl.fieldLabel('priority', 'Prioridade')}</label>
                    <select value={formData.priority} onChange={event => handleChange('priority', event.target.value)} className={inputStyle}>
                      {priorities.map(priority => <option key={priority.key} value={priority.key}>{priority.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
              {initialClientName && (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-zinc-800 dark:text-slate-400">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span>Vinculada a <strong className="font-semibold text-slate-700 dark:text-slate-200">{initialClientName}</strong></span>
                </div>
              )}
            </div>
          ) : (
          <>
          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Identificação</p>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <label className={labelStyle}>{fl.fieldLabel('title', 'Título da Tarefa')} <span className="text-red-400">*</span></label>
                <input
                  value={formData.title}
                  onChange={event => handleChange('title', event.target.value)}
                  className={inputStyle}
                  placeholder="Ex: Solicitar documentos ao cliente"
                  autoFocus
                  required
                />
              </div>
              <div className="lg:col-span-5">
                <ClientSearchSelect
                  value={formData.client_id}
                  initialClientName={initialClientName}
                  onChange={clientId => {
                    setFormData(current => ({ ...current, client_id: clientId, process_id: '' }));
                  }}
                  label="Cliente"
                  placeholder="Buscar cliente..."
                  allowCreate
                />
              </div>
            </div>
          </section>

          {!fl.isHidden('description') && (
            <section>
              <label className={labelStyle}>{fl.fieldLabel('description', 'Descrição')}</label>
              <textarea
                value={formData.description}
                onChange={event => handleChange('description', event.target.value)}
                className={textareaStyle}
                placeholder="Detalhes e orientações para execução da tarefa"
              />
            </section>
          )}

          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Planejamento</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {!fl.isHidden('due_date') && (
                <div>
                  <label className={labelStyle}>{fl.fieldLabel('due_date', 'Data limite')}</label>
                  <div className="relative">
                    <input type="date" value={formData.due_date} onChange={event => handleChange('due_date', event.target.value)} className={inputStyle} />
                    <Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              )}
              {!fl.isHidden('priority') && (
                <div>
                  <label className={labelStyle}>{fl.fieldLabel('priority', 'Prioridade')}</label>
                  <select value={formData.priority} onChange={event => handleChange('priority', event.target.value)} className={inputStyle}>
                    {priorities.map(priority => <option key={priority.key} value={priority.key}>{priority.label}</option>)}
                  </select>
                </div>
              )}
              {!fl.isHidden('process_id') && (
                <div>
                  <label className={labelStyle}>{fl.fieldLabel('process_id', 'Processo')}</label>
                  <select
                    value={formData.process_id}
                    onChange={event => handleChange('process_id', event.target.value)}
                    className={inputStyle}
                    disabled={!formData.client_id || processesLoading}
                  >
                    <option value="">{processesLoading ? 'Carregando...' : 'Nenhum'}</option>
                    {filteredProcesses.map(process => (
                      <option key={process.id} value={process.id}>{process.process_code}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </section>
          </>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
};

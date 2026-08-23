import { useState, useEffect, useMemo } from 'react';
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Circle,
  Trash2,
  AlertCircle,
  Pencil,
  Plus,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { taskService } from '../services/task.service';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { settingsService, type TaskPriorityConfig, TASK_MODULE_DEFAULTS } from '../services/settings.service';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import type { Task } from '../types/task.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import { formatDate, formatTime } from '../utils/formatters';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';
import { ModuleSkeleton } from './ui';
import { TaskFormModal } from './TaskFormModal';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';

interface TasksModuleProps {
  focusNewTask?: boolean;
  onParamConsumed?: () => void;
  onPendingTasksChange?: (count: number) => void;
}

const TasksModule = ({ focusNewTask = false, onParamConsumed, onPendingTasksChange }: TasksModuleProps) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [taskSearch, setTaskSearch] = useState('');
  const { user } = useAuth();
  const { navigateTo } = useNavigation();
  const { confirmDelete } = useDeleteConfirm();

  // Prioridades configuráveis
  const [priorities, setPriorities] = useState<TaskPriorityConfig[]>(TASK_MODULE_DEFAULTS.priorities);

  useEffect(() => {
    settingsService.getTaskModuleConfig().then(cfg => {
      if (cfg.priorities?.length) {
        setPriorities(cfg.priorities);
      }
    }).catch(() => {/* mantém fallbacks */});
  }, []);
  const fallbackCreatorName =
    (user?.user_metadata?.full_name && user.user_metadata.full_name.trim()) || 'usuário';

  useEffect(() => {
    loadTasks();
    loadReferenceData();
  }, []);

  useEffect(() => {
    if (!focusNewTask) return;
    setSelectedTask(null);
    setTaskFormOpen(true);
    onParamConsumed?.();
  }, [focusNewTask, onParamConsumed]);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const data = await taskService.listTasks();
      const safeTasks = Array.isArray(data) ? data : [];
      const pendingCount = safeTasks.filter((task) => task.status === 'pending').length;
      setTasks(safeTasks);
      onPendingTasksChange?.(Number.isFinite(pendingCount) ? pendingCount : 0);
    } catch (error: any) {
      const message = String(error?.message || error || '');
      const isExpectedAuthOrNetworkIssue = message.includes('Usuário não autenticado') || message.includes('Failed to fetch') || message.includes('Load failed');
      setTasks([]);
      onPendingTasksChange?.(0);
      if (!isExpectedAuthOrNetworkIssue) {
        console.error('Erro ao carregar tarefas:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadReferenceData = async () => {
    try {
      const [clientItems, processItems] = await Promise.all([
        clientService.listClients(),
        processService.listProcesses(),
      ]);
      setClients(clientItems);
      setProcesses(processItems);
    } catch (error) {
      console.error('Erro ao carregar vínculos das tarefas:', error);
    }
  };

  const handleToggleStatus = async (task: Task) => {
    try {
      await taskService.toggleTaskStatus(task.id);
      await loadTasks();
    } catch (error: any) {
      alert(error.message || 'Erro ao atualizar tarefa');
    }
  };

  const handleDelete = async (id: string) => {
    const task = tasks.find(item => item.id === id);
    const confirmed = await confirmDelete({
      title: 'Excluir tarefa',
      entityName: task?.title,
      message: 'Deseja realmente excluir esta tarefa?',
      confirmLabel: 'Excluir',
      permission: { module: 'tarefas', action: 'delete' },
    });
    if (!confirmed) return;
    try {
      await taskService.deleteTask(id);
      await loadTasks();
    } catch (error: any) {
      alert(error.message || 'Erro ao excluir tarefa');
    }
  };

  const handleStartEditing = (task: Task) => {
    setSelectedTask(task);
    setTaskFormOpen(true);
  };

  const reorderPendingTasks = (allTasks: Task[], sourceId: string, targetId: string) => {
    const pending = allTasks.filter((task) => task.status === 'pending');
    const sourceIndex = pending.findIndex((task) => task.id === sourceId);
    const targetIndex = pending.findIndex((task) => task.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
      return { updated: allTasks, updates: [] as { id: string; position: number }[] };
    }

    const reorderedPending = [...pending];
    const [movedTask] = reorderedPending.splice(sourceIndex, 1);
    reorderedPending.splice(targetIndex, 0, movedTask);

    const updates = reorderedPending.map((task, idx) => ({ id: task.id, position: idx + 1 }));

    let pendingIdx = 0;
    const updatedAll = allTasks.map((task) => {
      if (task.status === 'pending') {
        const pendingTask = reorderedPending[pendingIdx];
        const position = updates[pendingIdx].position;
        pendingIdx += 1;
        return { ...pendingTask, position };
      }
      return task;
    });

    return { updated: updatedAll, updates };
  };

  const handleDrop = async (targetId: string) => {
    if (!draggingTaskId || draggingTaskId === targetId) return;

    const { updated, updates } = reorderPendingTasks(tasks, draggingTaskId, targetId);
    setDraggingTaskId(null);
    if (updates.length === 0) return;

    setTasks(updated);

    try {
      await taskService.updateTaskPositions(updates);
      await loadTasks();
    } catch (error) {
      console.error('Erro ao atualizar posições das tarefas:', error);
      await loadTasks();
    }
  };

  const clientMap = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
  const processMap = useMemo(() => new Map(processes.map(process => [process.id, process])), [processes]);
  const normalizedSearch = normalizeSearchText(taskSearch);

  const filteredTasks = tasks.filter((task) => {
    const matchesStatus = filter === 'all' || task.status === filter;
    if (!matchesStatus) return false;
    if (!normalizedSearch) return true;
    return matchesNormalizedSearch(normalizedSearch, [
      task.title,
      task.description,
      task.client_id ? clientMap.get(task.client_id)?.full_name : '',
      task.process_id ? processMap.get(task.process_id)?.process_code : '',
    ]);
  });

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-0">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setSelectedTask(null);
            setTaskFormOpen(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 active:scale-95 sm:w-auto sm:px-6"
        >
          <Plus className="h-4 w-4" />
          Nova tarefa
        </button>
      </div>

      <TaskFormModal
        open={taskFormOpen}
        selectedTask={selectedTask}
        initialClientName={selectedTask?.client_id ? clientMap.get(selectedTask.client_id)?.full_name : undefined}
        initialProcesses={processes}
        onClose={() => {
          setTaskFormOpen(false);
          setSelectedTask(null);
        }}
        onSaved={async () => {
          setTaskFormOpen(false);
          setSelectedTask(null);
          await Promise.all([loadTasks(), loadReferenceData()]);
        }}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('pending')}
          className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
            filter === 'pending'
              ? 'bg-blue-600 text-white'
              : 'bg-[#f8f7f5] border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Pendentes ({pendingTasks.length})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
            filter === 'completed'
              ? 'bg-green-600 text-white'
              : 'bg-[#f8f7f5] border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Concluídas ({completedTasks.length})
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
            filter === 'all'
              ? 'bg-slate-600 text-white'
              : 'bg-[#f8f7f5] border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          Todas ({tasks.length})
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 sm:flex-row">
        <input
          type="text"
          value={taskSearch}
          onChange={(e) => setTaskSearch(e.target.value)}
          placeholder="Pesquisar por tarefa, cliente ou processo..."
          className="flex-1 px-3 py-2 sm:px-4 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        {taskSearch && (
          <button
            type="button"
            onClick={() => setTaskSearch('')}
            className="w-full sm:w-auto px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Task List */}
      {loading ? (
        <ModuleSkeleton variant="list" rows={7} />
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-8 sm:py-12 bg-[#f8f7f5] rounded-xl border border-[#e7e5df]">
          <AlertCircle className="w-8 h-8 sm:w-12 sm:h-12 text-slate-400 mx-auto mb-3" />
          <p className="text-xs sm:text-sm text-slate-600">Nenhuma tarefa encontrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTasks.map((task) => {
            const isPending = task.status === 'pending';
            const isDragging = draggingTaskId === task.id;
            const linkedClient = task.client_id ? clientMap.get(task.client_id) : null;
            const linkedProcess = task.process_id ? processMap.get(task.process_id) : null;
            return (
            <div
              key={task.id}
              className={`bg-[#f8f7f5] border rounded-lg p-3 sm:p-4 transition flex items-center gap-2 sm:gap-3 ${
                task.status === 'completed'
                  ? 'border-[#e7e5df] bg-slate-50'
                  : isDragging
                  ? 'border-blue-400 ring-2 ring-blue-200'
                  : 'border-blue-200 hover:shadow-md'
              }`}
              draggable={isPending}
              onDragStart={(e) => {
                if (!isPending) return;
                setDraggingTaskId(task.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!isPending) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                if (!isPending) return;
                e.preventDefault();
                handleDrop(task.id);
              }}
              onDragEnd={() => setDraggingTaskId(null)}
            >
              <button
                onClick={() => handleToggleStatus(task)}
                className="flex-shrink-0"
              >
                {task.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                ) : (
                  <Circle className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 hover:text-blue-600 transition" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <p
                  className={`text-xs sm:text-sm font-medium ${
                    task.status === 'completed'
                      ? 'text-slate-500 line-through'
                      : 'text-slate-900'
                  }`}
                >
                  {task.title}
                </p>
                {task.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 sm:text-xs">{task.description}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {task.status === 'pending' && (() => {
                  const cfg = priorities.find(p => p.key === task.priority);
                  const label = cfg?.label ?? task.priority;
                  const badge = cfg?.badge ?? 'bg-slate-100 text-slate-600';
                  return (
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${badge}`}>
                      {label}
                    </span>
                  );
                  })()}
                  {linkedClient && (
                    <button
                      type="button"
                      onClick={() => navigateTo('clientes', { mode: 'details', entityId: linkedClient.id } as any)}
                      className="inline-flex max-w-full items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-100"
                      title={`Abrir cliente ${linkedClient.full_name}`}
                    >
                      <UserRound className="h-3 w-3 shrink-0" />
                      <span className="truncate">{linkedClient.full_name}</span>
                    </button>
                  )}
                  {linkedProcess && (
                    <button
                      type="button"
                      onClick={() => navigateTo('processos', { mode: 'details', entityId: linkedProcess.id } as any)}
                      className="inline-flex max-w-full items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 transition hover:bg-blue-100"
                      title={`Abrir processo ${linkedProcess.process_code}`}
                    >
                      <Briefcase className="h-3 w-3 shrink-0" />
                      <span className="truncate">{linkedProcess.process_code}</span>
                    </button>
                  )}
                  {task.due_date && (
                    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      <CalendarDays className="h-3 w-3" />
                      Até {formatDate(task.due_date)}
                    </span>
                  )}
                </div>
                <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                  Criado em {formatDate(task.created_at)} às {formatTime(task.created_at)} por {task.created_by_name || fallbackCreatorName}
                </p>
                {task.completed_at && task.completed_by_name && (
                  <p className="text-[10px] sm:text-xs text-emerald-600 mt-1">
                    Concluído em {formatDate(task.completed_at)} às {formatTime(task.completed_at)} por {task.completed_by_name}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  onClick={() => handleStartEditing(task)}
                  className="p-1.5 sm:p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition flex-shrink-0"
                  title="Editar"
                >
                  <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                {task.status === 'completed' && (
                  <button
                    onClick={() => handleToggleStatus(task)}
                    className="p-1.5 sm:p-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition flex-shrink-0"
                    title="Restaurar tarefa"
                  >
                    <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                )}

                <button
                  onClick={() => handleDelete(task.id)}
                  className="p-1.5 sm:p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                  title="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>
              </div>
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
};

export default TasksModule;

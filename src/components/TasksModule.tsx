import { useState, useEffect, useRef } from 'react';
import { useFormLayout } from '../hooks/useFormLayout';
import {
  CheckCircle2,
  Circle,
  Trash2,
  AlertCircle,
  Loader2,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { taskService } from '../services/task.service';
import { settingsService, type TaskPriorityConfig, TASK_MODULE_DEFAULTS } from '../services/settings.service';
import { useAuth } from '../contexts/AuthContext';
import type { Task, TaskPriority } from '../types/task.types';
import { formatDate, formatTime } from '../utils/formatters';
import { matchesNormalizedSearch, normalizeSearchText } from '../utils/search';
import { ModuleSkeleton } from './ui';

interface TasksModuleProps {
  focusNewTask?: boolean;
  onParamConsumed?: () => void;
  onPendingTasksChange?: (count: number) => void;
}

const TasksModule = ({ focusNewTask = false, onParamConsumed, onPendingTasksChange }: TasksModuleProps) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [completedSearch, setCompletedSearch] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const newTaskInputRef = useRef<HTMLInputElement | null>(null);
  const { user } = useAuth();

  const fl = useFormLayout('tasks');

  // Prioridades configuráveis
  const [priorities, setPriorities] = useState<TaskPriorityConfig[]>(TASK_MODULE_DEFAULTS.priorities);
  const [selectedPriority, setSelectedPriority] = useState<string>('medium');

  useEffect(() => {
    settingsService.getTaskModuleConfig().then(cfg => {
      if (cfg.priorities?.length) {
        setPriorities(cfg.priorities);
        // Usa a primeira prioridade como padrão (respeita ordem configurada)
        setSelectedPriority(cfg.priorities[0].key);
      }
    }).catch(() => {/* mantém fallbacks */});
  }, []);
  const fallbackCreatorName =
    (user?.user_metadata?.full_name && user.user_metadata.full_name.trim()) || 'usuário';

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (!focusNewTask) return;

    const handleFocus = () => {
      newTaskInputRef.current?.focus();
      onParamConsumed?.();
    };

    const timeout = window.setTimeout(handleFocus, 0);
    return () => window.clearTimeout(timeout);
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

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || addingTask) return;

    try {
      setAddingTask(true);
      const priority: TaskPriority = (selectedPriority || 'medium') as TaskPriority;
      await taskService.createTask({
        title: newTaskTitle.trim(),
        priority,
      });
      setNewTaskTitle('');
      await loadTasks();
    } catch (error: any) {
      alert(error.message || 'Erro ao criar tarefa');
    } finally {
      setAddingTask(false);
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
    if (!confirm('Deseja realmente excluir esta tarefa?')) return;
    try {
      await taskService.deleteTask(id);
      await loadTasks();
    } catch (error: any) {
      alert(error.message || 'Erro ao excluir tarefa');
    }
  };

  const handleStartEditing = (task: Task) => {
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
  };

  const handleSaveEditing = async () => {
    if (!editingTaskId) return;
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      alert('O nome da tarefa não pode ficar vazio.');
      return;
    }

    try {
      await taskService.updateTask(editingTaskId, { title: trimmed });
      setEditingTaskId(null);
      setEditingTitle('');
      await loadTasks();
    } catch (error: any) {
      alert(error.message || 'Erro ao atualizar tarefa');
    }
  };

  const handleCancelEditing = () => {
    setEditingTaskId(null);
    setEditingTitle('');
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

  const normalizedSearch = normalizeSearchText(completedSearch);

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'all') return true;
    if (filter === 'completed') {
      const matchesStatus = task.status === 'completed';
      if (!matchesStatus) return false;
      if (!normalizedSearch) return true;
      return matchesNormalizedSearch(normalizedSearch, [task.title]);
    }
    return task.status === filter;
  });

  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-0">
      {/* Add Task Form */}
      <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          placeholder={fl.fieldLabel('title', 'Digite uma nova tarefa...')}
          ref={newTaskInputRef}
          className="flex-1 px-3 py-2 sm:px-4 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
        />
        {!fl.isHidden('priority') && priorities.length > 1 && (
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-[#f8f7f5]"
          >
            {priorities.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={!newTaskTitle.trim() || addingTask}
          className={`w-full sm:w-auto px-4 sm:px-6 py-2 text-white rounded-lg font-medium text-sm transition-all transform active:scale-95 ${
            addingTask
              ? 'bg-amber-600 hover:bg-amber-700 cursor-not-allowed'
              : 'bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          {addingTask ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Adicionando...</span>
            </div>
          ) : (
            <span>Adicionar</span>
          )}
        </button>
      </form>

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

      {filter === 'completed' && (
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <input
            type="text"
            value={completedSearch}
            onChange={(e) => setCompletedSearch(e.target.value)}
            placeholder="Pesquisar tarefas concluídas..."
            className="flex-1 px-3 py-2 sm:px-4 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          {completedSearch && (
            <button
              type="button"
              onClick={() => setCompletedSearch('')}
              className="w-full sm:w-auto px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Limpar
            </button>
          )}
        </div>
      )}

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
                {editingTaskId === task.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveEditing();
                        } else if (e.key === 'Escape') {
                          handleCancelEditing();
                        }
                      }}
                      className="flex-1 px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs sm:text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveEditing}
                      className="px-2 sm:px-3 py-1 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditing}
                      className="px-2 sm:px-3 py-1 text-xs font-semibold text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <p
                    className={`text-xs sm:text-sm font-medium ${
                      task.status === 'completed'
                        ? 'text-slate-500 line-through'
                        : 'text-slate-900'
                    }`}
                  >
                    {task.title}
                  </p>
                )}
                {task.status === 'pending' && (() => {
                  const cfg = priorities.find(p => p.key === task.priority);
                  const label = cfg?.label ?? task.priority;
                  const badge = cfg?.badge ?? 'bg-slate-100 text-slate-600';
                  return (
                    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge}`}>
                      {label}
                    </span>
                  );
                })()}
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

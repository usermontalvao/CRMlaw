import React from 'react';
import { CheckSquare, ChevronRight, Circle, CheckCircle2 } from 'lucide-react';
import type { Task } from '../../types/task.types';

interface TasksWidgetProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onViewAll: () => void;
}

const getPriorityColor = (priority: string): string => {
  switch (priority) {
    case 'alta':
      return 'text-red-500';
    case 'media':
      return 'text-amber-500';
    case 'baixa':
      return 'text-emerald-500';
    default:
      return 'text-slate-400';
  }
};

export const TasksWidget: React.FC<TasksWidgetProps> = ({
  tasks,
  onTaskClick,
  onViewAll,
}) => {
  const pendingTasks = tasks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => {
      // Ordenar por prioridade e depois por data
      const priorityOrder = { alta: 0, media: 1, baixa: 2 };
      const priorityA = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3;
      const priorityB = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .slice(0, 5);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <CheckSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Tarefas Recentes</h2>
            <p className="text-xs text-slate-500">
              {pendingTasks.length} pendente{pendingTasks.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-blue-500 hover:text-blue-600 text-xs font-semibold"
        >
          Ver todas
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tasks List */}
      {pendingTasks.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle2 className="w-10 h-10 text-emerald-200 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Todas as tarefas concluídas!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pendingTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => onTaskClick(task)}
              className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer transition-all group"
            >
              {/* Status Icon */}
              <Circle className={`w-5 h-5 ${getPriorityColor(task.priority)}`} />

              {/* Task Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate group-hover:text-blue-600 transition-colors">
                  {task.title}
                </p>
                {task.due_date && (
                  <p className="text-xs text-slate-500">
                    Vence em {new Date(task.due_date).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>

              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksWidget;

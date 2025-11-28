import React from 'react';
import { CalendarDays, ChevronRight, AlertCircle } from 'lucide-react';
import type { Deadline } from '../../types/deadline.types';
import type { Client } from '../../types/client.types';

interface DeadlinesWidgetProps {
  deadlines: Deadline[];
  clientMap: Map<string, Client>;
  onDeadlineClick: (deadline: Deadline) => void;
  onViewAll: () => void;
}

const getUrgencyColor = (dueDate: Date): string => {
  const today = new Date();
  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return 'bg-red-500'; // Vencido
  if (diffDays <= 3) return 'bg-orange-500'; // Urgente
  if (diffDays <= 7) return 'bg-amber-500'; // Atenção
  return 'bg-emerald-500'; // OK
};

export const DeadlinesWidget: React.FC<DeadlinesWidgetProps> = ({
  deadlines,
  clientMap,
  onDeadlineClick,
  onViewAll,
}) => {
  const upcomingDeadlines = deadlines
    .filter((d) => d.status === 'pendente' && d.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
    .slice(0, 5);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Próximos Prazos</h2>
            <p className="text-xs text-slate-500">
              {upcomingDeadlines.length} pendente{upcomingDeadlines.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-red-500 hover:text-red-600 text-xs font-semibold"
        >
          Ver todos
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Deadlines List */}
      {upcomingDeadlines.length === 0 ? (
        <div className="text-center py-8">
          <CalendarDays className="w-10 h-10 text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum prazo pendente</p>
        </div>
      ) : (
        <div className="space-y-2">
          {upcomingDeadlines.map((deadline) => {
            const dueDate = new Date(deadline.due_date!);
            const client = deadline.client_id ? clientMap.get(deadline.client_id) : null;
            const today = new Date();
            const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            return (
              <div
                key={deadline.id}
                onClick={() => onDeadlineClick(deadline)}
                className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer transition-all group"
              >
                {/* Date Badge */}
                <div className={`w-10 h-10 rounded-lg ${getUrgencyColor(dueDate)} flex flex-col items-center justify-center text-white`}>
                  <span className="text-[10px] font-medium leading-none">
                    {dueDate.toLocaleDateString('pt-BR', { month: 'short' }).slice(0, 3)}
                  </span>
                  <span className="text-sm font-bold leading-none">{dueDate.getDate()}</span>
                </div>

                {/* Deadline Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate group-hover:text-red-600 transition-colors">
                    {deadline.title}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {client?.full_name || 'Sem cliente'}
                    {diffDays < 0 && (
                      <span className="ml-2 text-red-500 font-semibold">
                        Vencido há {Math.abs(diffDays)} dia{Math.abs(diffDays) !== 1 ? 's' : ''}
                      </span>
                    )}
                    {diffDays === 0 && (
                      <span className="ml-2 text-orange-500 font-semibold">Vence hoje!</span>
                    )}
                    {diffDays === 1 && (
                      <span className="ml-2 text-amber-500 font-semibold">Vence amanhã</span>
                    )}
                  </p>
                </div>

                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DeadlinesWidget;

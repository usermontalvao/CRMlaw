import React from 'react';
import { UserPlus, FileText, CalendarDays, Calendar, CheckSquare, Target, Wallet } from 'lucide-react';

interface QuickActionsProps {
  onNavigate: (moduleWithParams: string) => void;
  canView?: (module: string) => boolean;
  canCreate?: (module: string) => boolean;
}

interface ActionButton {
  label: string;
  icon: React.ReactNode;
  action: string;
  colorClasses: string;
}

const actions: ActionButton[] = [
  {
    label: 'Cliente',
    icon: <UserPlus className="w-3.5 h-3.5" />,
    action: 'clientes?mode=create',
    colorClasses: 'bg-blue-50 hover:bg-blue-100 text-blue-700',
  },
  {
    label: 'Prazo',
    icon: <CalendarDays className="w-3.5 h-3.5" />,
    action: 'prazos?mode=create',
    colorClasses: 'bg-red-50 hover:bg-red-100 text-red-700',
  },
  {
    label: 'Tarefa',
    icon: <CheckSquare className="w-3.5 h-3.5" />,
    action: 'tarefas?mode=create',
    colorClasses: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700',
  },
  {
    label: 'Compromisso',
    icon: <Calendar className="w-3.5 h-3.5" />,
    action: 'agenda?mode=create',
    colorClasses: 'bg-teal-50 hover:bg-teal-100 text-teal-700',
  },
  {
    label: 'Requerimento',
    icon: <Target className="w-3.5 h-3.5" />,
    action: 'requerimentos?mode=create',
    colorClasses: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700',
  },
  {
    label: 'Processo',
    icon: <FileText className="w-3.5 h-3.5" />,
    action: 'processos?mode=create',
    colorClasses: 'bg-purple-50 hover:bg-purple-100 text-purple-700',
  },
  {
    label: 'Pagamento',
    icon: <Wallet className="w-3.5 h-3.5" />,
    action: 'financeiro?mode=payment',
    colorClasses: 'bg-green-50 hover:bg-green-100 text-green-700',
  },
];

export const QuickActions: React.FC<QuickActionsProps> = ({ onNavigate, canView, canCreate }) => {
  
  
  const allowedActions = actions.filter((a) => {
    const moduleKey = a.action.split('?')[0];
    const isCreateAction = a.action.includes('mode=create');
    const isPaymentAction = a.action.includes('mode=payment');

    // If permission callbacks are not provided, keep current behavior (show all)
    const canViewModule = typeof canView === 'function' ? canView(moduleKey) : true;
    const canCreateModule = typeof canCreate === 'function' ? canCreate(moduleKey) : true;

    if (isCreateAction) return canViewModule && canCreateModule;
    if (isPaymentAction) return canViewModule;
    return canViewModule;
  });

  return (
    <div className="flex flex-wrap gap-2">
      {allowedActions.map((action) => (
        <button
          key={action.action}
          onClick={() => onNavigate(action.action)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:scale-105 hover:shadow-sm ${action.colorClasses}`}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
};

export default QuickActions;

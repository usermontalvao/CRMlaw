import React from 'react';
import { UserPlus, FileText, CalendarDays, Calendar } from 'lucide-react';

interface QuickActionsProps {
  onNavigate: (moduleWithParams: string) => void;
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
    label: 'Processo',
    icon: <FileText className="w-3.5 h-3.5" />,
    action: 'processos?mode=create',
    colorClasses: 'bg-purple-50 hover:bg-purple-100 text-purple-700',
  },
  {
    label: 'Prazo',
    icon: <CalendarDays className="w-3.5 h-3.5" />,
    action: 'prazos?mode=create',
    colorClasses: 'bg-red-50 hover:bg-red-100 text-red-700',
  },
  {
    label: 'Compromisso',
    icon: <Calendar className="w-3.5 h-3.5" />,
    action: 'agenda?mode=create',
    colorClasses: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700',
  },
];

export const QuickActions: React.FC<QuickActionsProps> = ({ onNavigate }) => {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.action}
          onClick={() => onNavigate(action.action)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-xs transition-all ${action.colorClasses}`}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
};

export default QuickActions;

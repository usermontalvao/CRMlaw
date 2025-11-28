import React from 'react';
import { Plus } from 'lucide-react';
import { getGreeting } from '../../utils/formatters';

interface DashboardHeaderProps {
  onNewClient: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({ onNewClient }) => {
  const today = new Date();
  const dateString = today.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          {getGreeting()}! 👋
        </h1>
        <p className="text-slate-500 text-xs sm:text-sm">{dateString}</p>
      </div>
      <button
        onClick={onNewClient}
        className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold text-xs transition-all shadow-md"
      >
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Novo Cliente</span>
      </button>
    </div>
  );
};

export default DashboardHeader;

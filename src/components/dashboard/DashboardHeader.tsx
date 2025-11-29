import React, { useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition-all duration-700 ${
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-blue-50 via-transparent to-emerald-50" />
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-100 blur-3xl opacity-70" />
      <div className="pointer-events-none absolute -left-6 -bottom-10 h-24 w-24 rounded-full bg-blue-100 blur-2xl opacity-60" />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />
            Dashboard
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
            {getGreeting()}! <span className="inline-block animate-hand-wave">👋</span>
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm">
            {dateString}
          </p>
        </div>
        <button
          onClick={onNewClient}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-amber-600"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Cliente</span>
        </button>
      </div>
    </div>
  );
};

export default DashboardHeader;

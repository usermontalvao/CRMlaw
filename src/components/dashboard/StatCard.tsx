import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  color: 'blue' | 'purple' | 'red' | 'amber' | 'emerald' | 'slate';
  onClick?: () => void;
}

const colorClasses = {
  blue: {
    bg: 'bg-blue-500',
    hover: 'hover:border-blue-200',
  },
  purple: {
    bg: 'bg-purple-500',
    hover: 'hover:border-purple-200',
  },
  red: {
    bg: 'bg-red-500',
    hover: 'hover:border-red-200',
  },
  amber: {
    bg: 'bg-amber-500',
    hover: 'hover:border-amber-200',
  },
  emerald: {
    bg: 'bg-emerald-500',
    hover: 'hover:border-emerald-200',
  },
  slate: {
    bg: 'bg-slate-500',
    hover: 'hover:border-slate-200',
  },
};

export const StatCard: React.FC<StatCardProps> = ({
  icon,
  value,
  label,
  color,
  onClick,
}) => {
  const colors = colorClasses[color];

  return (
    <button
      onClick={onClick}
      className={`group bg-white rounded-xl p-4 shadow-sm border border-slate-200 hover:shadow-md ${colors.hover} transition-all text-left w-full`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{label}</p>
        </div>
      </div>
    </button>
  );
};

export default StatCard;

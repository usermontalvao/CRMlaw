import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="text-center py-8">
      <div className="text-slate-300 mx-auto mb-3">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && (
        <p className="text-xs text-slate-400 mt-1">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition-all"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default EmptyState;

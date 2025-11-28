import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  pulse?: boolean;
}

const variantClasses = {
  default: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
};

const sizeClasses = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-1 text-xs',
};

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  pulse = false,
}) => {
  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full ${variantClasses[variant]} ${sizeClasses[size]} ${pulse ? 'animate-pulse' : ''}`}
    >
      {children}
    </span>
  );
};

export default Badge;

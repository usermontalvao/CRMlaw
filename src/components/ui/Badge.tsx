import React from 'react';

type BadgeColor =
  | 'slate'
  | 'amber'
  | 'orange'
  | 'emerald'
  | 'green'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'indigo'
  | 'purple'
  | 'yellow'
  | 'rose'
  | 'red';

type BadgeSize = 'sm' | 'md';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
  size?: BadgeSize;
  dot?: boolean;
  /** Pulsar o dot */
  pulse?: boolean;
}

const colorClasses: Record<BadgeColor, string> = {
  slate:   'bg-slate-100 text-slate-700 border-[#e7e5df]',
  amber:   'bg-amber-100 text-amber-700 border-amber-200',
  orange:  'bg-orange-100 text-orange-700 border-orange-200',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  green:   'bg-green-100 text-green-700 border-green-200',
  blue:    'bg-blue-100 text-blue-700 border-blue-200',
  cyan:    'bg-cyan-100 text-cyan-700 border-cyan-200',
  teal:    'bg-teal-100 text-teal-700 border-teal-200',
  indigo:  'bg-indigo-100 text-indigo-700 border-indigo-200',
  purple:  'bg-purple-100 text-purple-700 border-purple-200',
  yellow:  'bg-yellow-100 text-yellow-700 border-yellow-200',
  rose:    'bg-rose-100 text-rose-700 border-rose-200',
  red:     'bg-red-100 text-red-700 border-red-200',
};

const dotColorClasses: Record<BadgeColor, string> = {
  slate:   'bg-slate-400',
  amber:   'bg-amber-500',
  orange:  'bg-orange-500',
  emerald: 'bg-emerald-500',
  green:   'bg-green-500',
  blue:    'bg-blue-500',
  cyan:    'bg-cyan-500',
  teal:    'bg-teal-500',
  indigo:  'bg-indigo-500',
  purple:  'bg-purple-500',
  yellow:  'bg-yellow-500',
  rose:    'bg-rose-500',
  red:     'bg-red-500',
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[10px] gap-1',
  md: 'px-2.5 py-1 text-[10px] gap-1.5',
};

export const Badge: React.FC<BadgeProps> = ({
  color = 'slate',
  size = 'md',
  dot = false,
  pulse = false,
  className = '',
  children,
  ...props
}) => (
  <span
    className={[
      'inline-flex items-center font-bold uppercase tracking-wider rounded-full border',
      colorClasses[color],
      sizeClasses[size],
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    {...props}
  >
    {dot && (
      <span
        className={[
          'w-1.5 h-1.5 rounded-full shrink-0',
          dotColorClasses[color],
          pulse ? 'animate-pulse' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
    )}
    {children}
  </span>
);

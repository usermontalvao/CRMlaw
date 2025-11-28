import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
}

const paddingClasses = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  onClick,
  padding = 'md',
  hover = false,
}) => {
  const baseClasses = 'bg-white rounded-xl shadow-sm border border-slate-200';
  const hoverClasses = hover ? 'hover:shadow-md transition-shadow cursor-pointer' : '';
  const paddingClass = paddingClasses[padding];

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`${baseClasses} ${hoverClasses} ${paddingClass} ${className}`}
    >
      {children}
    </Component>
  );
};

export default Card;

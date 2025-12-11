import React from 'react';

export interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  showTagline?: boolean;
  stacked?: boolean;
  className?: string;
  wordmarkClassName?: string;
}

const iconSizeMap: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-8 h-8 text-lg',
  md: 'w-12 h-12 text-2xl',
  lg: 'w-16 h-16 text-3xl',
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showWordmark = true,
  showTagline = true,
  stacked = false,
  className = '',
  wordmarkClassName = '',
}) => {
  return (
    <div className={`flex ${stacked ? 'flex-col items-center gap-3 text-center' : 'items-center gap-3'} ${className}`}>
      <div
        className={`relative inline-flex items-center justify-center rounded-2xl font-black tracking-tight text-white shadow-[0_10px_30px_rgba(248,181,0,0.35)] bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 ${iconSizeMap[size]}`}
      >
        <span>J</span>
        <span className="pointer-events-none absolute inset-0 rounded-2xl border border-white/30 opacity-60" aria-hidden="true" />
      </div>
      {showWordmark && (
        <div className={`flex flex-col ${stacked ? 'items-center' : ''} ${wordmarkClassName}`}>
          <span className="text-lg font-semibold text-slate-900">jurius.com.br</span>
          {showTagline && (
            <span className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
              Gestão Jurídica Inteligente
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default BrandLogo;

import React from 'react';

interface SensitiveValueProps {
  value: number;
  isRevealed: boolean;
  className?: string;
  locale?: string;
  currency?: string;
}

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const SensitiveValue: React.FC<SensitiveValueProps> = ({
  value,
  isRevealed,
  className,
  locale = 'pt-BR',
  currency = 'BRL',
}) => {
  if (!isRevealed) {
    return <span className={className}>R$ •••••</span>;
  }

  const formatted = locale === 'pt-BR' && currency === 'BRL'
    ? brlFormatter.format(value)
    : new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);

  return <span className={className}>{formatted}</span>;
};

export default SensitiveValue;

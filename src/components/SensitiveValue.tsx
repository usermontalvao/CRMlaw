import React from 'react';
import { formatCurrency } from '../utils/formatters';

interface SensitiveValueProps {
  value: number;
  isRevealed: boolean;
  className?: string;
  locale?: string;
  currency?: string;
}

const SensitiveValue: React.FC<SensitiveValueProps> = ({
  value,
  isRevealed,
  className,
}) => {
  if (!isRevealed) {
    return <span className={className}>R$ •••••</span>;
  }

  return <span className={className}>{formatCurrency(value)}</span>;
};

export default SensitiveValue;

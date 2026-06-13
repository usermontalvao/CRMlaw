import React from 'react';
import { motion } from 'framer-motion';

/**
 * ShimmerSweep — efeito de carregamento padrão do app (mesmo do módulo Cloud).
 * Envolve um esqueleto (children) com uma faixa de luz que varre da esquerda
 * para a direita continuamente. Use sempre este componente para manter o efeito
 * de loading idêntico em todo o CRM.
 *
 * A faixa é forte o suficiente para ser visível mesmo sobre fundos claros.
 */
export const ShimmerSweep: React.FC<{
  children: React.ReactNode;
  className?: string;
  /** Velocidade da varredura em segundos (menor = mais rápido). */
  duration?: number;
}> = ({ children, className = '', duration = 1.6 }) => {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {children}
      {/* Faixa de luz que varre — visível sobre claro e escuro */}
      <motion.div
        className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[45%] dark:hidden"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.15) 70%, transparent 100%)',
        }}
        animate={{ x: ['-120%', '320%'] }}
        transition={{ repeat: Infinity, duration, ease: 'easeInOut', repeatDelay: 0.25 }}
      />
      <motion.div
        className="pointer-events-none absolute inset-y-0 left-0 z-20 hidden w-[45%] dark:block"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 30%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.04) 70%, transparent 100%)',
        }}
        animate={{ x: ['-120%', '320%'] }}
        transition={{ repeat: Infinity, duration, ease: 'easeInOut', repeatDelay: 0.25 }}
      />
    </div>
  );
};

export default ShimmerSweep;

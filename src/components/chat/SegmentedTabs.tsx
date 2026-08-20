// O CONTROLE SEGMENTADO DO CRM — uma peça só, usada em toda parte.
//
// Existiam dois: o par "WhatsApp | Equipe" no alto do widget e os filtros
// "Todas | Não lidas | Minhas" logo abaixo. Mesma função, dois desenhos, e
// nenhum dos dois se movia: a pastilha branca simplesmente APARECIA na aba
// clicada e sumia da anterior. É o defeito que faz uma troca de aba parecer um
// recarregamento de tela — o olho perde o fio entre o que era e o que é.
//
// Aqui a pastilha é UMA só e ela ANDA (`layoutId`): sai de onde estava e chega
// onde você clicou, no mesmo gesto do dedo. É o que dá a leitura de "a mesma
// coisa mudou de lugar" em vez de "outra coisa apareceu".
//
// O contador fica ao lado do nome, não sobreposto ao canto: sobreposto ele
// esbarra na aba seguinte quando passa de dois dígitos. E quem pediu "reduzir
// movimento" recebe a pastilha sem deslizar — o estado continua no
// `aria-selected`, que nunca dependeu de pixel.
import React, { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface SegmentedTabItem<T extends string> {
  key: T;
  label: string;
  /** Pendência da aba. `0` ou ausente não desenha nada. */
  count?: number;
  title?: string;
  ariaLabel?: string;
}

export interface SegmentedTabsProps<T extends string> {
  items: ReadonlyArray<SegmentedTabItem<T>>;
  value: T | null;
  onChange: (key: T) => void;
  /** `sm` é a barra de filtros da inbox; `md`, o par de abas do topo. */
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

const ALTURA = { sm: 'h-[26px]', md: 'h-[28px]' } as const;

export function SegmentedTabs<T extends string>({
  items, value, onChange, size = 'sm', className = '', ...rest
}: SegmentedTabsProps<T>) {
  const semMovimento = useReducedMotion();
  // Um id por instância: duas barras na mesma tela não podem compartilhar a
  // pastilha, senão ela voa de uma para a outra.
  const grupo = useId();

  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      className={`flex items-center gap-0.5 p-0.5 rounded-[10px] bg-slate-900/[0.045] ${className}`}
    >
      {items.map(item => {
        const ativa = value === item.key;
        const numero = (item.count ?? 0) > 99 ? '99+' : String(item.count ?? 0);
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={ativa}
            aria-label={item.ariaLabel}
            title={item.title}
            onClick={() => onChange(item.key)}
            className={`relative flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 ${ALTURA[size]} rounded-[8px] text-[12px] font-medium whitespace-nowrap transition-colors duration-150 ${
              ativa ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {ativa && (
              <motion.span
                layoutId={`segmentado-${grupo}`}
                className="absolute inset-0 rounded-[8px] bg-white"
                style={{ boxShadow: '0 1px 2px rgba(15,23,42,.14), 0 0 0 0.5px rgba(15,23,42,.04)' }}
                transition={semMovimento
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 520, damping: 38, mass: 0.6 }}
              />
            )}
            <span className="relative truncate">{item.label}</span>
            {(item.count ?? 0) > 0 && (
              <span
                className={`relative text-[10px] font-bold tabular-nums ${ativa ? 'text-slate-500' : 'text-[#f27a23]'}`}
              >
                {numero}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedTabs;

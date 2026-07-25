import React from 'react';

/**
 * Botão "×" padrão de fechar diálogos do módulo Nextcloud.
 * Extraído de NextcloudBrowser (refactor incremental — Fase 5).
 */
export const NcModalCloseButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}> = ({ onClick, disabled = false, label = 'Fechar' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
  >
    <span aria-hidden="true" className="text-2xl font-light leading-none">×</span>
  </button>
);

export default NcModalCloseButton;

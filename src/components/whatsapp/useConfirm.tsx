// Confirmação leve (sem PIN) para ações reversíveis do módulo + seu diálogo.
import React, { useState, useCallback } from 'react';
import { WaDialog, WaDialogBody, waBtnPrimary, waBtnGhost, waBtnDanger } from './ui';
import type { ConfirmOpts, ConfirmFn } from './types';

export function useConfirm(): { confirm: ConfirmFn; pending: (ConfirmOpts & { resolve: (v: boolean) => void }) | null; resolve: (v: boolean) => void } {
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => new Promise<boolean>(res => setPending({ ...opts, resolve: res })), []);
  const resolve = useCallback((v: boolean) => setPending(p => { p?.resolve(v); return null; }), []);
  return { confirm, pending, resolve };
}
export const ConfirmDialog: React.FC<{ opts: ConfirmOpts; onResolve: (v: boolean) => void }> = ({ opts, onResolve }) => {
  const danger = opts.tone === 'danger';
  return (
    <WaDialog
      title={opts.title || 'Confirmar'}
      onClose={() => onResolve(false)}
      size="sm"
      zIndex={60}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => onResolve(false)} className={waBtnGhost}>Cancelar</button>
          <button onClick={() => onResolve(true)} className={danger ? waBtnDanger : waBtnPrimary}>
            {opts.confirmLabel || 'Confirmar'}
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <p className="text-[13.5px] text-slate-600 leading-snug">{opts.message}</p>
      </WaDialogBody>
    </WaDialog>
  );
};

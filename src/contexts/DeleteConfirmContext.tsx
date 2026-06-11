import React, { createContext, useCallback, useContext } from 'react';
import { useSecurityPin } from './SecurityPinContext';
import { useToastContext } from './ToastContext';

// ── Tipos ────────────────────────────────────────────────────────────────────

type ConfirmOptions = {
  title?: string;
  entityName?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;  // aceito por compatibilidade, não usado no fluxo PIN
  sensitivity?: 'high' | 'critical';
  successMessage?: string;
};

type DeleteConfirmContextType = {
  confirmDelete: (options?: ConfirmOptions) => Promise<boolean>;
  /** Exibe toast "apagado com sucesso" — chamar após a deleção concluir. */
  notifyDeleted: (entityName?: string, customMessage?: string) => void;
  /**
   * Confirma com PIN, executa `action`, e exibe toast de sucesso.
   * Retorna true se PIN ok e action concluiu sem erro; false caso contrário.
   */
  confirmDeleteWithAction: (action: () => Promise<void>, options?: ConfirmOptions) => Promise<boolean>;
};

const DeleteConfirmContext = createContext<DeleteConfirmContextType | undefined>(undefined);

// ── Provider ─────────────────────────────────────────────────────────────────

export const DeleteConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { requirePin } = useSecurityPin();
  const { success, error: toastError } = useToastContext();

  const buildPinOptions = (opts?: ConfirmOptions) => {
    const entityPart = opts?.entityName ? `"${opts.entityName}" — ` : '';
    const description = opts?.message
      ? opts.message
      : `${entityPart}Esta ação é irreversível. Informe seu PIN de Segurança para continuar.`;
    return {
      action:       'delete_action',
      sensitivity:  (opts?.sensitivity ?? 'critical') as 'high' | 'critical',
      title:        opts?.title || 'Excluir item',
      description,
      actionLabel:  opts?.confirmLabel || 'Excluir',
    };
  };

  const confirmDelete = useCallback(async (opts?: ConfirmOptions): Promise<boolean> => {
    return requirePin(buildPinOptions(opts));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirePin]);

  const notifyDeleted = useCallback((entityName?: string, customMessage?: string) => {
    const msg = customMessage
      ?? (entityName ? `"${entityName}" apagado com sucesso.` : 'Apagado com sucesso.');
    success(msg);
  }, [success]);

  const confirmDeleteWithAction = useCallback(async (
    action: () => Promise<void>,
    opts?: ConfirmOptions,
  ): Promise<boolean> => {
    const pinOk = await requirePin(buildPinOptions(opts));
    if (!pinOk) return false;
    try {
      await action();
      const msg = opts?.successMessage
        ?? (opts?.entityName ? `"${opts.entityName}" apagado com sucesso.` : 'Apagado com sucesso.');
      success(msg);
      return true;
    } catch (e: any) {
      toastError('Erro ao excluir', e?.message);
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirePin, success, toastError]);

  return (
    <DeleteConfirmContext.Provider value={{ confirmDelete, notifyDeleted, confirmDeleteWithAction }}>
      {children}
    </DeleteConfirmContext.Provider>
  );
};

export const useDeleteConfirm = () => {
  const ctx = useContext(DeleteConfirmContext);
  if (!ctx) throw new Error('useDeleteConfirm must be used within DeleteConfirmProvider');
  return ctx;
};

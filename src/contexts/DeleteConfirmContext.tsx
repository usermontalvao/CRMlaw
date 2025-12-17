import React, { createContext, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type ConfirmOptions = {
  title?: string;
  entityName?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type DeleteConfirmContextType = {
  confirmDelete: (options?: ConfirmOptions) => Promise<boolean>;
};

const DeleteConfirmContext = createContext<DeleteConfirmContextType | undefined>(undefined);

export const DeleteConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({});
  const [numbers, setNumbers] = useState<[number, number] | null>(null);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const expected = useMemo(() => {
    if (!numbers) return null;
    return numbers[0] + numbers[1];
  }, [numbers]);

  const generate = () => {
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    return [a, b] as [number, number];
  };

  const close = (result: boolean) => {
    setIsOpen(false);
    setOptions({});
    setNumbers(null);
    setAnswer('');
    setError(null);

    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(result);
  };

  const confirmDelete = (opts?: ConfirmOptions) => {
    setOptions(opts || {});
    setNumbers(generate());
    setAnswer('');
    setError(null);
    setIsOpen(true);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  const onSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (expected === null) return;

    const parsed = parseInt(answer, 10);
    if (Number.isNaN(parsed) || parsed !== expected) {
      setError('Resposta incorreta.');
      return;
    }

    close(true);
  };

  const modal = isOpen && numbers
    ? createPortal(
        <div className="fixed inset-0 z-[2147483646] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => close(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md max-h-[92vh] bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Confirmar Exclusão</p>
                <h2 className="text-lg font-semibold text-slate-900">{options.title || 'Excluir item'}</h2>
              </div>
              <button
                type="button"
                onClick={() => close(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form id="delete-confirm-form" onSubmit={onSubmit} className="flex-1 overflow-y-auto bg-white p-6">
              <p className="text-sm text-slate-700 mb-3">
                {options.message || 'Tem certeza que deseja excluir este item?'}
              </p>
              {options.entityName && (
                <p className="text-sm text-slate-700 mb-4">
                  <span className="font-semibold">{options.entityName}</span>
                </p>
              )}
              <p className="text-sm text-slate-600 mb-4">Esta ação não pode ser desfeita.</p>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Confirmação</label>
                <p className="text-sm text-slate-700">
                  Resolva para confirmar: <strong>{numbers[0]} + {numbers[1]}</strong>
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                  value={answer}
                  onChange={(ev) => setAnswer(ev.target.value)}
                  placeholder="Digite o resultado"
                />
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
            </form>

            <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-white"
                >
                  {options.cancelLabel || 'Cancelar'}
                </button>
                <button
                  type="submit"
                  form="delete-confirm-form"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  {options.confirmLabel || 'Excluir'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <DeleteConfirmContext.Provider value={{ confirmDelete }}>
      {children}
      {modal}
    </DeleteConfirmContext.Provider>
  );
};

export const useDeleteConfirm = () => {
  const ctx = useContext(DeleteConfirmContext);
  if (!ctx) {
    throw new Error('useDeleteConfirm must be used within DeleteConfirmProvider');
  }
  return ctx;
};

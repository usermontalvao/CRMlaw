import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, X, Loader2, Lock, Trash2 } from 'lucide-react';
import { securityPinService } from '../services/securityPin.service';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface SecurityPinModalProps {
  open: boolean;
  mode: 'verify' | 'create' | 'change' | 'remove';
  title?: string;
  description?: string;
  actionLabel?: string;
  resourceType?: string;
  resourceId?: string;
  sensitivity?: 'medium' | 'high' | 'critical';
  onSuccess: () => void;
  onCancel: () => void;
}

// ── Utilitários ───────────────────────────────────────────────────────────────

const DEFAULT_TITLES: Record<SecurityPinModalProps['mode'], string> = {
  verify: 'Confirme com seu PIN',
  create: 'Crie seu PIN de Segurança',
  change: 'Alterar PIN de Segurança',
  remove: 'Remover PIN de Segurança',
};

const DEFAULT_DESCRIPTIONS: Record<SecurityPinModalProps['mode'], string> = {
  verify: 'Esta ação altera informações sensíveis do escritório.',
  create: 'Ele será usado para confirmar ações críticas e proteger informações sensíveis do escritório.',
  change: 'Informe seu PIN atual e escolha um novo PIN de 6 dígitos.',
  remove: 'Ao remover o PIN, você precisará criar um novo na próxima ação sensível.',
};

// ── Componente de linha de 6 dígitos ─────────────────────────────────────────

interface PinRowProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  onComplete?: (completed: string) => void;
  disabled?: boolean;
  shake?: boolean;
}

const PinRow: React.FC<PinRowProps> = ({ label, value, onChange, onComplete, disabled, shake }) => {
  const refs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));

  const setRef = (i: number) => (el: HTMLInputElement | null) => {
    refs.current[i] = el;
  };

  const focusAt = (i: number) => refs.current[Math.min(5, Math.max(0, i))]?.focus();

  const handleChange = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const next = [...value];
    next[i] = digit;
    onChange(next);
    if (digit) {
      if (i < 5) {
        focusAt(i + 1);
      } else {
        refs.current[5]?.blur();
        if (next.every(Boolean)) onComplete?.(next.join(''));
      }
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (value[i]) {
        const next = [...value];
        next[i] = '';
        onChange(next);
      } else if (i > 0) {
        const next = [...value];
        next[i - 1] = '';
        onChange(next);
        focusAt(i - 1);
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      focusAt(i - 1);
    } else if (e.key === 'ArrowRight') {
      focusAt(i + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    const next = Array(6).fill('');
    text.split('').forEach((d, i) => { next[i] = d; });
    onChange(next);
    const lastFilled = Math.min(text.length, 5);
    focusAt(lastFilled);
    if (text.length === 6) onComplete?.(next.join(''));
  };

  // Foca o primeiro box no mount e sempre que o valor for resetado (todos vazios)
  useEffect(() => {
    if (value.every(v => !v)) focusAt(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.join('')]);

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
      <div
        className={`flex justify-between gap-1.5 sm:justify-start sm:gap-2 ${shake ? 'animate-pin-shake' : ''}`}
        onPaste={handlePaste}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <input
            key={i}
            ref={setRef(i)}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={value[i] || ''}
            disabled={disabled}
            autoComplete="one-time-code"
            name={`pin-digit-${i}`}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onFocus={e => e.target.select()}
            className={[
              'h-11 w-9 rounded-xl border-2 text-center text-base font-bold transition-all duration-150 sm:h-12 sm:w-10 sm:text-lg',
              'focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200',
              value[i]
                ? 'border-orange-400 bg-orange-50 text-orange-900'
                : 'border-[#e7e5df] bg-slate-50 text-slate-900',
              disabled ? 'opacity-50 cursor-not-allowed' : '',
              shake ? 'border-red-400' : '',
            ].join(' ')}
            aria-label={`Dígito ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
};

// ── Componente principal ──────────────────────────────────────────────────────

const EMPTY_PIN = (): string[] => Array(6).fill('');

export const SecurityPinModal: React.FC<SecurityPinModalProps> = ({
  open,
  mode,
  title,
  description,
  actionLabel,
  resourceType,
  resourceId,
  sensitivity = 'high',
  onSuccess,
  onCancel,
}) => {
  const [pin, setPin] = useState<string[]>(EMPTY_PIN());
  const [pinNew, setPinNew] = useState<string[]>(EMPTY_PIN());
  const [pinConfirm, setPinConfirm] = useState<string[]>(EMPTY_PIN());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [step, setStep] = useState<'pin' | 'new' | 'confirm'>('pin');

  const reset = useCallback(() => {
    setPin(EMPTY_PIN());
    setPinNew(EMPTY_PIN());
    setPinConfirm(EMPTY_PIN());
    setError(null);
    setLoading(false);
    setShake(false);
    setLockedUntil(null);
    setStep('pin');
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  // ESC fecha o modal
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const showError = (msg: string) => {
    setError(msg);
    triggerShake();
  };

  const pinString = (arr: string[]) => arr.join('');

  // ── Submit por modo ────────────────────────────────────────────────────────

  const handleVerify = async (overridePin?: string) => {
    const p = overridePin ?? pinString(pin);
    if (p.length < 6) { showError('Informe todos os 6 dígitos'); return; }

    setLoading(true);
    setError(null);
    try {
      const result = await securityPinService.verifySecurityPin(p, `modal_${mode}`, resourceType, resourceId);
      if (result.ok) {
        onSuccess();
      } else {
        if (result.error === 'locked' && result.locked_until) {
          setLockedUntil(new Date(result.locked_until));
        }
        showError(result.message || 'PIN incorreto');
        setPin(EMPTY_PIN());
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const pNew = pinString(pinNew);
    const pConf = pinString(pinConfirm);

    if (pNew.length < 6) { showError('Informe todos os 6 dígitos do novo PIN'); return; }
    if (pConf.length < 6) { showError('Confirme todos os 6 dígitos'); return; }

    const validErr = securityPinService.validatePin(pNew);
    if (validErr) { showError(validErr); return; }

    if (pNew !== pConf) { showError('Os PINs não conferem'); setPinConfirm(EMPTY_PIN()); return; }

    setLoading(true);
    setError(null);
    try {
      await securityPinService.createSecurityPin(pNew);
      onSuccess();
    } catch (e: any) {
      showError(e?.message || 'Erro ao criar PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = async () => {
    const pOld = pinString(pin);
    const pNew = pinString(pinNew);
    const pConf = pinString(pinConfirm);

    if (pOld.length < 6) { showError('Informe seu PIN atual'); return; }
    if (pNew.length < 6) { showError('Informe todos os 6 dígitos do novo PIN'); return; }
    if (pConf.length < 6) { showError('Confirme todos os 6 dígitos do novo PIN'); return; }

    const validErr = securityPinService.validatePin(pNew);
    if (validErr) { showError(validErr); return; }

    if (pNew !== pConf) { showError('Os novos PINs não conferem'); setPinConfirm(EMPTY_PIN()); return; }

    setLoading(true);
    setError(null);
    try {
      const result = await securityPinService.changeSecurityPin(pOld, pNew);
      if (result.ok) {
        onSuccess();
      } else {
        if (result.error === 'locked' && result.locked_until) {
          setLockedUntil(new Date(result.locked_until));
        }
        showError(result.message || 'PIN atual incorreto');
        setPin(EMPTY_PIN());
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (overridePin?: string) => {
    const p = overridePin ?? pinString(pin);
    if (p.length < 6) { showError('Informe todos os 6 dígitos do seu PIN atual'); return; }

    setLoading(true);
    setError(null);
    try {
      const result = await securityPinService.removeSecurityPin(p);
      if (result.ok) {
        onSuccess();
      } else {
        if (result.error === 'locked' && result.locked_until) {
          setLockedUntil(new Date(result.locked_until));
        }
        showError(result.message || 'PIN incorreto');
        setPin(EMPTY_PIN());
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (overridePin?: string) => {
    if (mode === 'verify') handleVerify(overridePin);
    else if (mode === 'create') handleCreate();
    else if (mode === 'remove') handleRemove(overridePin);
    else handleChange();
  };

  const canSubmit = () => {
    if (loading || !!lockedUntil) return false;
    if (mode === 'verify' || mode === 'remove') return pin.every(Boolean);
    if (mode === 'create') return pinNew.every(Boolean) && pinConfirm.every(Boolean);
    return pin.every(Boolean) && pinNew.every(Boolean) && pinConfirm.every(Boolean);
  };

  const resolvedTitle = title || DEFAULT_TITLES[mode];
  const resolvedDesc = description || DEFAULT_DESCRIPTIONS[mode];
  const resolvedLabel = actionLabel || (
    mode === 'verify' ? 'Confirmar' :
    mode === 'create' ? 'Criar PIN' :
    mode === 'remove' ? 'Remover PIN' :
    'Alterar PIN'
  );

  // Ícone por modo
  const SensIcon = mode === 'remove' ? Trash2 : sensitivity === 'critical' ? Shield : Lock;
  const isRemoveMode = mode === 'remove';

  if (!open) return null;

  const modal = (
    <>
      {/* Estilo de shake inline — evita dependência de config Tailwind */}
      <style>{`
        @keyframes pinShake {
          0%,100% { transform: translateX(0); }
          15%      { transform: translateX(-6px); }
          30%      { transform: translateX(6px); }
          45%      { transform: translateX(-4px); }
          60%      { transform: translateX(4px); }
          75%      { transform: translateX(-2px); }
          90%      { transform: translateX(2px); }
        }
        .animate-pin-shake { animation: pinShake 0.45s ease; }
      `}</style>

      <div className="fixed inset-0 z-[2147483647] flex items-end justify-center px-3 py-0 sm:items-center sm:px-4 sm:py-6">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          onClick={onCancel}
          aria-hidden="true"
        />

        {/* Card */}
        <div className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-t-[28px] bg-[#f8f7f5] shadow-2xl ring-1 ring-black/5 sm:rounded-2xl">
          {/* Barra de cor da marca */}
          <div className={`h-1.5 w-full bg-gradient-to-r ${isRemoveMode ? 'from-red-500 to-red-400' : 'from-orange-500 to-amber-400'}`} />

          {/* Header */}
          <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`mt-0.5 flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${isRemoveMode ? 'bg-red-50' : 'bg-orange-50'}`}>
                <SensIcon className={`w-5 h-5 ${isRemoveMode ? 'text-red-500' : 'text-orange-500'}`} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 leading-snug">{resolvedTitle}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500 sm:pr-2">{resolvedDesc}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              aria-label="Cancelar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Corpo */}
          <div className="px-6 pb-2 space-y-4">
            {lockedUntil ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                <p className="text-sm font-semibold text-red-700">Conta temporariamente bloqueada</p>
                <p className="mt-1 text-xs text-red-600">
                  Tente novamente após{' '}
                  {lockedUntil.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ) : (
              <>
                {/* PIN atual (verify, change, remove) */}
                {(mode === 'verify' || mode === 'change' || mode === 'remove') && (
                  <PinRow
                    label={mode === 'change' ? 'PIN atual' : mode === 'remove' ? 'Confirme com seu PIN atual' : 'PIN de Segurança'}
                    value={pin}
                    onChange={setPin}
                    onComplete={mode === 'verify' || mode === 'remove' ? handleSubmit : undefined}
                    disabled={loading}
                    shake={shake && (mode === 'verify' || mode === 'remove')}
                  />
                )}

                {/* Novo PIN (create e change) */}
                {(mode === 'create' || mode === 'change') && (
                  <PinRow
                    label="Novo PIN"
                    value={pinNew}
                    onChange={setPinNew}
                    disabled={loading}
                    shake={shake && (pinNew.every(Boolean) || mode === 'create')}
                  />
                )}

                {/* Confirmar PIN (create e change) */}
                {(mode === 'create' || mode === 'change') && (
                  <PinRow
                    label="Confirmar novo PIN"
                    value={pinConfirm}
                    onChange={setPinConfirm}
                    onComplete={handleSubmit}
                    disabled={loading}
                    shake={shake && pinConfirm.every(Boolean)}
                  />
                )}

                {/* Erro */}
                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    <p className="text-xs font-medium text-red-700">{error}</p>
                  </div>
                )}

                {/* Loading inline para modos auto-submit (verify/remove) */}
                {(mode === 'verify' || mode === 'remove') && loading && (
                  <div className="flex items-center justify-center gap-2 py-1">
                    <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                    <span className="text-xs text-slate-500">Verificando…</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Rodapé — apenas para create/change (auto-submit nos outros modos) */}
          {(mode === 'create' || mode === 'change') && (
            <div className="flex flex-col-reverse gap-3 px-6 py-4 sm:flex-row">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[#e7e5df] text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Cancelar
              </button>
              {!lockedUntil && (
                <button
                  type="button"
                  onClick={() => handleSubmit()}
                  disabled={!canSubmit()}
                  className={[
                    'inline-flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-xl',
                    'text-sm font-bold text-white transition-all shadow-md',
                    'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600',
                    'active:scale-[0.98]',
                    'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none',
                  ].join(' ')}
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {resolvedLabel}
                </button>
              )}
            </div>
          )}

          {/* Rodapé minimal para verify/remove — só espaçamento + dica ESC */}
          {(mode === 'verify' || mode === 'remove') && !lockedUntil && (
            <div className="px-6 pb-5 flex justify-center">
              <span className="text-[11px] text-slate-400">
                Pressione <kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-500 font-mono text-[10px]">ESC</kbd> para cancelar
              </span>
            </div>
          )}

          {/* Botão cancelar visível quando bloqueado */}
          {(mode === 'verify' || mode === 'remove') && lockedUntil && (
            <div className="px-6 pb-5 flex justify-center">
              <button
                type="button"
                onClick={onCancel}
                className="px-6 py-2.5 rounded-xl border border-[#e7e5df] text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
};

export default SecurityPinModal;

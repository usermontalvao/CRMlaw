import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Shield, X, Loader2, Lock, LockOpen, Trash2 } from 'lucide-react';
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
  entityName?: string;
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
  dark?: boolean;
}

const PinRow: React.FC<PinRowProps> = ({ label, value, onChange, onComplete, disabled, shake, dark }) => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: dark ? '#64748b' : '#94a3b8',
      }}>
        {label}
      </label>
      <div
        className={shake ? 'animate-pin-shake' : ''}
        style={{ display: 'flex', gap: 8, justifyContent: 'center' }}
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
            style={{
              width: 48,
              height: 56,
              borderRadius: 12,
              border: shake ? '2px solid #ef4444' : value[i] ? '2px solid #f97316' : dark ? '2px solid #334155' : '2px solid #e2e8f0',
              background: dark
                ? (value[i] ? 'rgba(249,115,22,0.12)' : '#1e293b')
                : (value[i] ? '#fff7ed' : '#f8fafc'),
              color: dark ? (value[i] ? '#fb923c' : '#94a3b8') : (value[i] ? '#c2410c' : '#475569'),
              fontSize: 20,
              fontWeight: 700,
              textAlign: 'center',
              outline: 'none',
              cursor: disabled ? 'not-allowed' : 'text',
              opacity: disabled ? 0.5 : 1,
              transition: 'border-color 0.15s, background 0.15s',
              boxShadow: dark ? 'none' : undefined,
            }}
            onFocusCapture={e => {
              if (dark) {
                (e.target as HTMLInputElement).style.borderColor = '#f97316';
                (e.target as HTMLInputElement).style.boxShadow = '0 0 0 3px rgba(249,115,22,0.25)';
              } else {
                (e.target as HTMLInputElement).style.borderColor = '#f97316';
                (e.target as HTMLInputElement).style.boxShadow = '0 0 0 3px rgba(249,115,22,0.15)';
              }
            }}
            onBlurCapture={e => {
              const el = e.target as HTMLInputElement;
              el.style.boxShadow = 'none';
              el.style.borderColor = shake ? '#ef4444' : el.value ? '#f97316' : dark ? '#334155' : '#e2e8f0';
            }}
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
  entityName,
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
  const [iconAnim, setIconAnim] = useState<'idle' | 'unlocking' | 'unlocked' | 'error'>('idle');

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
        setIconAnim('unlocking');
        setTimeout(() => setIconAnim('unlocked'), 380);
        setTimeout(() => onSuccess(), 820);
      } else {
        if (result.error === 'locked' && result.locked_until) {
          setLockedUntil(new Date(result.locked_until));
        }
        setIconAnim('error');
        setTimeout(() => setIconAnim('idle'), 650);
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
        setIconAnim('unlocking');
        setTimeout(() => setIconAnim('unlocked'), 380);
        setTimeout(() => onSuccess(), 820);
      } else {
        if (result.error === 'locked' && result.locked_until) {
          setLockedUntil(new Date(result.locked_until));
        }
        setIconAnim('error');
        setTimeout(() => setIconAnim('idle'), 650);
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

  const isRed = isRemoveMode;
  const bg = isRed
    ? 'linear-gradient(160deg, #1c0a0a 0%, #2d1515 40%, #1a0d0d 100%)'
    : 'linear-gradient(160deg, #1c1917 0%, #292524 45%, #1a1535 100%)';

  const modal = (
    <>
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
        @keyframes lockFade {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .lock-content { animation: lockFade 0.25s cubic-bezier(0.16,1,0.3,1) both; }

        /* Cadeado girando antes de abrir */
        @keyframes lockUnlocking {
          0%   { transform: scale(1) rotate(0deg); }
          20%  { transform: scale(1.2) rotate(-25deg); }
          50%  { transform: scale(1.3) rotate(10deg); }
          75%  { transform: scale(1.15) rotate(-5deg); }
          100% { transform: scale(1.1) rotate(0deg); opacity: 0.3; }
        }
        .icon-unlocking { animation: lockUnlocking 0.38s cubic-bezier(0.34,1.56,0.64,1) both; }

        /* Cadeado aberto entrando */
        @keyframes lockOpened {
          0%   { transform: scale(0.5) rotate(-15deg); opacity: 0; }
          60%  { transform: scale(1.15) rotate(4deg); opacity: 1; }
          80%  { transform: scale(0.95) rotate(-2deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        .icon-unlocked { animation: lockOpened 0.4s cubic-bezier(0.34,1.56,0.64,1) both; }

        /* Erro — tremida brusca */
        @keyframes lockError {
          0%,100% { transform: scale(1) rotate(0deg); }
          15%     { transform: scale(1.15) rotate(-22deg); }
          30%     { transform: scale(1.15) rotate(22deg); }
          45%     { transform: scale(1.08) rotate(-14deg); }
          60%     { transform: scale(1.08) rotate(14deg); }
          75%     { transform: scale(1.04) rotate(-7deg); }
          90%     { transform: scale(1.04) rotate(7deg); }
        }
        .icon-error { animation: lockError 0.55s cubic-bezier(0.36,0.07,0.19,0.97) both; }
      `}</style>

      {/* Backdrop blur — cobre tudo */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        width: '100%', height: '100%',
        background: 'rgba(8, 8, 18, 0.65)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 2147483647,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}>

        {/* Card compacto */}
        <div className="lock-content" style={{
          width: '100%', maxWidth: 400,
          borderRadius: 20,
          background: 'rgba(12, 16, 32, 0.96)',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>

          {/* Faixa de cor no topo do card */}
          <div style={{
            height: 3,
            background: isRed
              ? 'linear-gradient(to right, #ef4444, #f87171)'
              : 'linear-gradient(to right, #f97316, #f59e0b)',
          }} />

          {/* Header do card: ícone + fechar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 20px 0',
          }}>
            {/* Ícone com animação */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40 }}>
              {iconAnim === 'unlocked' ? (
                <LockOpen
                  className="icon-unlocked"
                  style={{ width: 28, height: 28, color: '#4ade80', strokeWidth: 1.5,
                    filter: 'drop-shadow(0 0 8px rgba(74,222,128,0.7))' }}
                />
              ) : (
                <SensIcon
                  className={iconAnim === 'unlocking' ? 'icon-unlocking' : iconAnim === 'error' ? 'icon-error' : ''}
                  style={{
                    width: 28, height: 28, strokeWidth: 1.5,
                    color: iconAnim === 'error' ? '#f87171' : iconAnim === 'unlocking' ? '#fbbf24'
                      : isRed ? 'rgba(252,165,165,0.85)' : 'rgba(255,255,255,0.75)',
                    filter: iconAnim === 'error' ? 'drop-shadow(0 0 6px rgba(248,113,113,0.8))'
                      : iconAnim === 'unlocking' ? 'drop-shadow(0 0 8px rgba(251,191,36,0.7))' : 'none',
                    transition: 'color 0.2s, filter 0.2s',
                  }}
                />
              )}
            </div>

            {/* Botão fechar */}
            <button
              type="button"
              onClick={onCancel}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.35)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}
            >
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>

          {/* Corpo do card */}
          <div style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}>

            {/* Título */}
            <h2 style={{
              margin: '4px 0 6px', fontSize: 18, fontWeight: 700,
              letterSpacing: '-0.02em', color: '#f1f5f9', lineHeight: 1.25,
            }}>
              {resolvedTitle}
            </h2>

            {/* Descrição */}
            <p style={{
              margin: 0, marginBottom: entityName ? 14 : 20,
              fontSize: 13, lineHeight: 1.55,
              color: 'rgba(255,255,255,0.38)',
            }}>
              {resolvedDesc}
            </p>

            {/* Bloco do item sendo excluído */}
            {entityName && (
              <div style={{
                marginBottom: 20, borderRadius: 10,
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                padding: '10px 14px',
                display: 'flex', alignItems: 'flex-start', gap: 9,
              }}>
                <span style={{
                  flexShrink: 0, marginTop: 1,
                  fontSize: 11, fontWeight: 800, color: '#fca5a5',
                  background: 'rgba(239,68,68,0.2)', borderRadius: 4,
                  padding: '1px 5px',
                }}>!</span>
                <div>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', color: 'rgba(252,165,165,0.5)', textTransform: 'uppercase' }}>
                    Você está excluindo
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 600, color: '#fca5a5' }}>
                    {entityName}
                  </p>
                </div>
              </div>
            )}

            {/* Inputs / bloqueio */}
            {lockedUntil ? (
              <div style={{
                borderRadius: 10, padding: '14px 16px', textAlign: 'center', marginBottom: 16,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#fca5a5', fontSize: 13 }}>
                  Conta temporariamente bloqueada
                </p>
                <p style={{ margin: '4px 0 0', color: 'rgba(252,165,165,0.6)', fontSize: 12 }}>
                  Tente novamente após{' '}
                  {lockedUntil.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
                {(mode === 'verify' || mode === 'change' || mode === 'remove') && (
                  <PinRow dark
                    label={mode === 'change' ? 'PIN atual' : mode === 'remove' ? 'Confirme seu PIN atual' : 'PIN de segurança'}
                    value={pin} onChange={setPin}
                    onComplete={mode === 'verify' || mode === 'remove' ? handleSubmit : undefined}
                    disabled={loading} shake={shake && (mode === 'verify' || mode === 'remove')}
                  />
                )}
                {(mode === 'create' || mode === 'change') && (
                  <PinRow dark label="Novo PIN" value={pinNew} onChange={setPinNew}
                    disabled={loading} shake={shake && (pinNew.every(Boolean) || mode === 'create')} />
                )}
                {(mode === 'create' || mode === 'change') && (
                  <PinRow dark label="Confirmar novo PIN" value={pinConfirm} onChange={setPinConfirm}
                    onComplete={handleSubmit} disabled={loading} shake={shake && pinConfirm.every(Boolean)} />
                )}
                {error && (
                  <p style={{ margin: 0, textAlign: 'center', color: '#fca5a5', fontSize: 12, fontWeight: 500 }}>
                    {error}
                  </p>
                )}
                {(mode === 'verify' || mode === 'remove') && loading && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: 'rgba(255,255,255,0.4)' }} />
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Verificando…</span>
                  </div>
                )}
              </div>
            )}

            {/* Botão confirmar (create/change) */}
            {(mode === 'create' || mode === 'change') && !lockedUntil && (
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!canSubmit()}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 20px', borderRadius: 10, border: 'none',
                  background: canSubmit() ? 'linear-gradient(135deg, #f97316, #f59e0b)' : 'rgba(255,255,255,0.07)',
                  color: canSubmit() ? '#fff' : 'rgba(255,255,255,0.25)',
                  fontSize: 14, fontWeight: 600,
                  cursor: canSubmit() ? 'pointer' : 'not-allowed',
                  boxShadow: canSubmit() ? '0 4px 16px rgba(249,115,22,0.35)' : 'none',
                  transition: 'all 0.15s',
                  marginBottom: 12,
                }}
              >
                {loading && <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />}
                {resolvedLabel}
              </button>
            )}

            {/* Fechar / ESC */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              {lockedUntil ? (
                <button type="button" onClick={onCancel} style={{
                  padding: '8px 20px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}>Fechar</button>
              ) : (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
                  Pressione{' '}
                  <kbd style={{
                    padding: '1px 5px', borderRadius: 3, fontSize: 10,
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace',
                  }}>ESC</kbd>
                  {' '}para cancelar
                </span>
              )}
            </div>

          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
};

export default SecurityPinModal;

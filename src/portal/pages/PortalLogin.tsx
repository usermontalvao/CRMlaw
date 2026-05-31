import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, ArrowLeft, ArrowRight } from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { supabase } from '../../config/supabase';

type Step = 'cpf' | 'pin';

async function fetchPhoneHint(cpf: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('portal_phone_hint', { p_cpf: cpf });
    if (error || !data) return null;
    return data as string;
  } catch {
    return null;
  }
}

export const PortalLogin: React.FC = () => {
  const { loginByCPF } = useClientAuth();

  const [step, setStep]           = useState<Step>('cpf');
  const [cpf, setCpf]             = useState('');
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [digits, setDigits]       = useState(['', '', '', '']);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const cpfRef = useRef<HTMLInputElement>(null);
  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const rawCPF  = cpf.replace(/\D/g, '');
  const cpfOk   = rawCPF.length === 11;
  const password = digits.join('');
  const pinOk   = password.length === 4;

  const formatCPF = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  };

  // Foca o campo ao trocar de step
  useEffect(() => {
    if (step === 'cpf')  setTimeout(() => cpfRef.current?.focus(), 80);
    if (step === 'pin')  setTimeout(() => pinRefs[0].current?.focus(), 80);
  }, [step]);

  // ── Step 1: avançar ──────────────────────────────────────────────────────────
  const handleContinue = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpfOk) return;
    setError(null);
    setLoading(true);
    try {
      const hint = await fetchPhoneHint(rawCPF);
      if (!hint) {
        setError('CPF não encontrado. Verifique com seu advogado.');
        return;
      }
      setPhoneHint(hint);
      setDigits(['', '', '', '']);
      setStep('pin');
    } finally {
      setLoading(false);
    }
  }, [cpfOk, rawCPF]);

  // ── Step 2: PIN input ────────────────────────────────────────────────────────
  const handleDigit = (idx: number, value: string) => {
    const d = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = d;
    setDigits(next);
    if (d && idx < 3) pinRefs[idx + 1].current?.focus();
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      pinRefs[idx - 1].current?.focus();
    }
    if (e.key === 'ArrowLeft'  && idx > 0) pinRefs[idx - 1].current?.focus();
    if (e.key === 'ArrowRight' && idx < 3) pinRefs[idx + 1].current?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!text) return;
    e.preventDefault();
    const next = ['', '', '', ''];
    text.split('').forEach((c, i) => { next[i] = c; });
    setDigits(next);
    pinRefs[Math.min(text.length, 3)].current?.focus();
  };

  // ── Step 2: submeter ─────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinOk) return;
    setError(null);
    setLoading(true);
    try {
      await loginByCPF(cpf, password);
      window.location.hash = '#/portal/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Senha incorreta.');
      setDigits(['', '', '', '']);
      setTimeout(() => pinRefs[0].current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setStep('cpf');
    setError(null);
    setDigits(['', '', '', '']);
  };

  // ────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-900">

      {/* Topo — fixo nos dois steps */}
      <div className="relative flex shrink-0 flex-col items-center pt-14 pb-7 text-center">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-orange-500/10 to-transparent" />

        <div className="relative flex h-16 w-16 items-center justify-center rounded-[18px] bg-gradient-to-br from-orange-400 to-orange-600 shadow-xl shadow-orange-600/30">
          <span className="text-3xl font-black text-white" style={{ fontFamily: 'Arial, sans-serif' }}>J</span>
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-white">JURIUS</h1>
        <p className="mt-0.5 text-sm text-slate-400">Portal do Cliente</p>
      </div>

      {/* Card formulário */}
      <div className="flex flex-1 flex-col rounded-t-[28px] bg-white px-5 pb-8 pt-7 shadow-2xl sm:mx-auto sm:my-8 sm:w-full sm:max-w-sm sm:flex-none sm:rounded-2xl sm:px-8 sm:py-8">

        {/* ── STEP INDICATOR ── */}
        <div className="mb-6 flex items-center gap-2">
          <div className={`h-1.5 flex-1 rounded-full transition-colors ${step === 'cpf' ? 'bg-orange-500' : 'bg-orange-500'}`} />
          <div className={`h-1.5 flex-1 rounded-full transition-colors ${step === 'pin' ? 'bg-orange-500' : 'bg-slate-200'}`} />
        </div>

        {/* ── STEP 1: CPF ── */}
        {step === 'cpf' && (
          <form onSubmit={handleContinue} className="flex flex-col gap-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-orange-500">Passo 1 de 2</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Qual é o seu CPF?</h2>
              <p className="mt-0.5 text-sm text-slate-500">Digite o CPF cadastrado no escritório</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">CPF</label>
              <input
                ref={cpfRef}
                type="text"
                value={formatCPF(cpf)}
                onChange={(e) => { setCpf(e.target.value); setError(null); }}
                placeholder="000.000.000-00"
                autoComplete="username"
                inputMode="numeric"
                className="h-13 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 text-lg font-semibold text-slate-900 placeholder-slate-300 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !cpfOk}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 text-base font-bold text-white shadow-md shadow-orange-500/20 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading
                ? <><Loader2 className="h-5 w-5 animate-spin" /> Verificando...</>
                : <><span>Continuar</span><ArrowRight className="h-5 w-5" /></>
              }
            </button>
          </form>
        )}

        {/* ── STEP 2: PIN ── */}
        {step === 'pin' && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <button
                type="button"
                onClick={goBack}
                className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-400 transition hover:text-slate-700"
              >
                <ArrowLeft className="h-4 w-4" /> Voltar
              </button>
              <p className="text-xs font-semibold uppercase tracking-wider text-orange-500">Passo 2 de 2</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Confirme seu acesso</h2>
            </div>

            {/* Dica do telefone */}
            {phoneHint && (
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3.5 ring-1 ring-slate-200">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                  <span className="text-base">📱</span>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Telefone cadastrado</p>
                  <p className="text-sm font-bold text-slate-800 tracking-wider">{phoneHint}</p>
                </div>
              </div>
            )}

            {/* 4 caixas PIN */}
            <div>
              <label className="mb-3 block text-sm font-semibold text-slate-700">
                4 últimos dígitos
              </label>
              <div className="flex gap-3" onPaste={handlePaste}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={pinRefs[i]}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    disabled={loading}
                    className={`h-16 w-full rounded-2xl border-2 bg-slate-50 text-center text-2xl font-bold text-slate-900 outline-none transition
                      ${d ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200'}
                      focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100
                      disabled:opacity-50`}
                  />
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !pinOk}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3.5 text-base font-bold text-white shadow-md shadow-orange-500/20 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading
                ? <><Loader2 className="h-5 w-5 animate-spin" /> Entrando...</>
                : 'Entrar na minha área'
              }
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          Dúvidas? Entre em contato com seu advogado.
        </p>
      </div>
    </div>
  );
};

export default PortalLogin;

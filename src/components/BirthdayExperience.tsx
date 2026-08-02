import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Check, Loader2, LogOut, Mail, ShieldCheck, X } from 'lucide-react';
import {
  BIRTHDAY_UPDATED_EVENT,
  birthdayService,
  type BirthdayUpdatedDetail,
} from '../services/birthday.service';
import { securityPinService } from '../services/securityPin.service';
import { useSecurityPin } from '../contexts/SecurityPinContext';
import {
  BIRTHDAY_GATE_DELAY_MS,
  BIRTHDAY_INVITE_DELAY_MS,
  BIRTHDAY_REPLAY_DELAY_MS,
  canOfferBirthdayInvite,
  clearBirthdayCelebrationSession,
  getBirthdayOccurrence,
  getBirthdaySessionKey,
  getFirstName,
  getLocalDateKey,
  isBirthdayReplayRequested,
  validateBirthDate,
} from '../utils/birthday';

const BirthdayVideo = lazy(() => import('./birthday/BirthdayVideo'));

type BirthdayExperienceProps = {
  userId: string;
  personName?: string | null;
  avatarUrl?: string | null;
  onSignOut: () => Promise<void>;
};

type BirthdayLoadState = 'loading' | 'missing' | 'ready' | 'error';
type PinSetupState = 'waiting' | 'checking' | 'resolved';

// -------------------------------------------------------------------------
// Cadastro obrigatório da data de nascimento
// -------------------------------------------------------------------------

/**
 * Formulário administrativo — sóbrio de propósito. Ele existe para completar o
 * cadastro funcional e não antecipa nada sobre a celebração.
 */
export function BirthDateRequiredGate({
  personName,
  onSave,
  onSignOut,
}: {
  personName?: string | null;
  onSave: (birthDate: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [birthDate, setBirthDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstName = getFirstName(personName);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateBirthDate(birthDate);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(birthDate);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a data. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <motion.div
      className="birthday-gate-overlay fixed inset-0 z-[2147483000] flex items-center justify-center overflow-y-auto bg-slate-950/70 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="birth-date-required-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <motion.div
        className="birthday-surface relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        initial={{ opacity: 0, y: 28, scale: 0.97, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.9 }}
      >
        <div className="birthday-accent-bar h-1 bg-slate-900 dark:bg-slate-100" />

        <div className="p-6 sm:p-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Cadastro funcional
              </p>
              <h1
                id="birth-date-required-title"
                className="text-lg font-semibold text-slate-900 dark:text-white"
              >
                Complete seus dados
              </h1>
            </div>
          </div>

          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            {firstName}, o registro da sua data de nascimento está pendente. O preenchimento é
            obrigatório para administradores e colaboradores e leva menos de um minuto.
          </p>

          <form onSubmit={handleSubmit} className="mt-6">
            <label
              htmlFor="required-birth-date"
              className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Data de nascimento
            </label>
            <input
              id="required-birth-date"
              type="date"
              value={birthDate}
              min="1900-01-01"
              max={getLocalDateKey()}
              onChange={(event) => {
                setBirthDate(event.target.value);
                setError(null);
              }}
              autoFocus
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'required-birth-date-error' : undefined}
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-300 dark:focus:ring-white/10"
            />

            {error && (
              <p
                id="required-birth-date-error"
                className="mt-2 text-sm text-red-600 dark:text-red-400"
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
                Dado pessoal de acesso restrito: fica visível somente para você, no seu próprio
                perfil, e não é compartilhado com a equipe.
              </p>
            </div>

            <button
              type="submit"
              disabled={saving || !birthDate}
              className="birthday-primary mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {saving ? 'Salvando...' : 'Salvar e continuar'}
            </button>
          </form>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut || saving}
            className="mx-auto mt-4 flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            Sair do sistema
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// -------------------------------------------------------------------------
// Aviso da equipe
// -------------------------------------------------------------------------

/**
 * O vídeo nunca abre sozinho: primeiro chega este aviso, e é o clique da
 * pessoa que confirma que ela realmente viu — e que de quebra libera o áudio,
 * já que os navegadores só permitem som após um gesto do usuário.
 *
 * O visual é deliberadamente sóbrio, igual ao resto do CRM. Borda colorida
 * animada, ícone tremendo e selo pulsando dão exatamente a aparência que a
 * pessoa aprendeu a ignorar (ou a desconfiar) na internet.
 */
export function BirthdayMailToast({
  personName,
  daysSince = 0,
  onOpen,
  onDismiss,
}: {
  personName?: string | null;
  /** 0 = hoje; maior que 0 = recuperação, e o texto muda para não mentir. */
  daysSince?: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const firstName = getFirstName(personName);
  const late = daysSince > 0;

  return (
    <motion.div
      className="fixed bottom-4 right-4 z-[2147482900] w-[calc(100vw-2rem)] max-w-[22rem] sm:bottom-6 sm:right-6"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      role="alert"
    >
      <div className="birthday-surface overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_40px_rgba(15,23,42,0.16)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
        <div className="flex items-start gap-3 p-4">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Mail className="h-4.5 w-4.5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Mensagem da equipe
              </p>
              <button
                type="button"
                onClick={onDismiss}
                className="-mr-1 -mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Dispensar aviso"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {late
                ? `${firstName}, ficou uma mensagem guardada aqui para você.`
                : `${firstName}, o escritório deixou uma mensagem reservada para você hoje.`}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onOpen}
                className="birthday-primary rounded-lg px-3.5 py-1.5 text-xs font-semibold transition"
              >
                Abrir mensagem
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Depois
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------------------
// Orquestrador
// -------------------------------------------------------------------------

export default function BirthdayExperience({
  userId,
  personName,
  avatarUrl,
  onSignOut,
}: BirthdayExperienceProps) {
  const { isPinModalOpen, openCreatePin } = useSecurityPin();
  const [loadState, setLoadState] = useState<BirthdayLoadState>('loading');
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [celebratedYear, setCelebratedYear] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [pinSetupState, setPinSetupState] = useState<PinSetupState>('waiting');
  const [gateDelayElapsed, setGateDelayElapsed] = useState(false);
  const [inviteDelayElapsed, setInviteDelayElapsed] = useState(false);
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const pinSetupRunRef = useRef(0);

  // Precisa rodar ANTES do efeito que lê a trava de sessão, por isso é
  // calculado na renderização e não dentro de um efeito.
  const replayRequested = useRef<boolean | null>(null);
  if (replayRequested.current === null) {
    replayRequested.current = isBirthdayReplayRequested();
    if (replayRequested.current) clearBirthdayCelebrationSession();
  }

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setBirthDate(null);
    setCelebratedYear(null);
    setVideoOpen(false);
    setInviteDismissed(false);

    birthdayService
      .getMyBirthday(userId)
      .then((record) => {
        if (cancelled) return;
        setBirthDate(record.birthDate);
        setCelebratedYear(record.celebratedYear);
        setIsActive(record.isActive);
        setLoadState(record.birthDate ? 'ready' : 'missing');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Não foi possível carregar a data de nascimento:', error);
        // Falha aberta para não bloquear todo o CRM se a migração ainda não
        // chegou ao ambiente. Assim que o banco estiver atualizado, o cadastro
        // obrigatório volta a ser exibido normalmente.
        setLoadState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Os dois atrasos contam a partir da entrada no sistema: nada interrompe o
  // login em si.
  useEffect(() => {
    setGateDelayElapsed(false);
    setInviteDelayElapsed(false);

    const inviteDelay = replayRequested.current ? BIRTHDAY_REPLAY_DELAY_MS : BIRTHDAY_INVITE_DELAY_MS;
    const gateTimer = window.setTimeout(() => setGateDelayElapsed(true), BIRTHDAY_GATE_DELAY_MS);
    const inviteTimer = window.setTimeout(() => setInviteDelayElapsed(true), inviteDelay);

    return () => {
      window.clearTimeout(gateTimer);
      window.clearTimeout(inviteTimer);
    };
  }, [userId]);

  useEffect(() => {
    const handleBirthdayUpdate = (event: Event) => {
      const detail = (event as CustomEvent<BirthdayUpdatedDetail>).detail;
      if (detail?.userId !== userId) return;
      setBirthDate(detail.birthDate);
      setLoadState('ready');
    };

    window.addEventListener(BIRTHDAY_UPDATED_EVENT, handleBirthdayUpdate);
    return () => window.removeEventListener(BIRTHDAY_UPDATED_EVENT, handleBirthdayUpdate);
  }, [userId]);

  useEffect(() => {
    if (loadState === 'loading') return;

    const runId = pinSetupRunRef.current + 1;
    pinSetupRunRef.current = runId;
    setPinSetupState('checking');

    const coordinatePinSetup = async () => {
      try {
        const hasPin = await securityPinService.hasSecurityPinOrNull();
        if (pinSetupRunRef.current !== runId) return;

        // Só oferece o cadastro quando o banco AFIRMA que não há PIN. Em
        // `null` (rede caída, sessão expirando) seguimos em frente sem propor
        // nada: propor criação a quem já tem PIN sobrescreveria o dele.
        if (hasPin === false) {
          await openCreatePin();
        }
      } catch (error) {
        console.error('Não foi possível verificar o cadastro do PIN:', error);
      } finally {
        if (pinSetupRunRef.current === runId) {
          setPinSetupState('resolved');
        }
      }
    };

    void coordinatePinSetup();

    return () => {
      if (pinSetupRunRef.current === runId) {
        pinSetupRunRef.current += 1;
      }
    };
  }, [loadState, openCreatePin]);

  // Recalcula a cada render: uma sessão deixada aberta pode atravessar a
  // meia-noite e virar o dia do aniversário.
  const occurrence = useMemo(() => getBirthdayOccurrence(birthDate), [birthDate]);

  const inviteAllowed =
    loadState === 'ready' &&
    canOfferBirthdayInvite({
      occurrence,
      pinSetupResolved: pinSetupState === 'resolved',
      pinModalOpen: isPinModalOpen,
      celebratedYear,
      isActive,
    });

  // Uma vez por sessão: dispensado, o aviso não volta a incomodar até o
  // próximo login.
  useEffect(() => {
    if (!inviteAllowed || inviteDismissed) return;
    if (window.sessionStorage.getItem(getBirthdaySessionKey(userId)) === '1') {
      setInviteDismissed(true);
    }
  }, [inviteAllowed, inviteDismissed, userId]);

  const dismissInvite = useCallback(() => {
    setInviteDismissed(true);
    window.sessionStorage.setItem(getBirthdaySessionKey(userId), '1');
  }, [userId]);

  const openVideo = useCallback(() => {
    setVideoOpen(true);
    window.sessionStorage.setItem(getBirthdaySessionKey(userId), '1');

    // Abrir é a confirmação de que a pessoa viu: a partir daqui a celebração
    // do ano está encerrada, em qualquer sessão ou dispositivo. Grava o ano DO
    // ANIVERSÁRIO, não o de hoje — ver getBirthdayOccurrence.
    const year = occurrence?.occurrenceYear ?? new Date().getFullYear();
    setCelebratedYear(year);
    birthdayService
      .markCelebrated(userId, year)
      .catch((error) => console.error('Não foi possível registrar a celebração:', error));
  }, [occurrence, userId]);

  const showGate =
    loadState === 'missing' &&
    gateDelayElapsed &&
    pinSetupState === 'resolved' &&
    !isPinModalOpen &&
    !videoOpen;

  const showInvite = inviteAllowed && inviteDelayElapsed && !inviteDismissed && !videoOpen;

  const overlayVisible = showGate || videoOpen;
  useEffect(() => {
    if (!overlayVisible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [overlayVisible]);

  const handleSaveBirthDate = useCallback(
    async (value: string) => {
      const savedBirthDate = await birthdayService.saveMyBirthDate(userId, value);
      setBirthDate(savedBirthDate);
      setLoadState('ready');
    },
    [userId],
  );

  const content = useMemo(
    () => (
      <>
        <AnimatePresence>
          {showGate && (
            <BirthDateRequiredGate
              key="gate"
              personName={personName}
              onSignOut={onSignOut}
              onSave={handleSaveBirthDate}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showInvite && (
            <BirthdayMailToast
              key="invite"
              personName={personName}
              daysSince={occurrence?.daysSince ?? 0}
              onOpen={openVideo}
              onDismiss={dismissInvite}
            />
          )}
        </AnimatePresence>

        {videoOpen && (
          <Suspense fallback={<div className="fixed inset-0 z-[2147483000] bg-[#07040f]" />}>
            <BirthdayVideo
              personName={personName}
              avatarUrl={avatarUrl}
              birthDate={birthDate}
              daysSince={occurrence?.daysSince ?? 0}
              onClose={() => setVideoOpen(false)}
            />
          </Suspense>
        )}
      </>
    ),
    [
      avatarUrl,
      birthDate,
      dismissInvite,
      handleSaveBirthDate,
      occurrence,
      onSignOut,
      openVideo,
      personName,
      showGate,
      showInvite,
      videoOpen,
    ],
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}

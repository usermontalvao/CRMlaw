import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { securityPinService } from '../services/securityPin.service';
import { settingsService } from '../services/settings.service';
import { SecurityPinModal } from '../components/SecurityPinModal';
import { supabase } from '../config/supabase';

// ── Tipos ────────────────────────────────────────────────────────────────────

type Sensitivity = 'medium' | 'high' | 'critical';

export interface RequirePinOptions {
  action: string;
  resourceType?: string;
  resourceId?: string;
  entityName?: string;
  sensitivity?: Sensitivity;
  title?: string;
  description?: string;
  actionLabel?: string;
  onVerified?: () => void | Promise<void>;
}

interface PinSession {
  verifiedAt: number;
  expiresAt: number;
  sensitivity: 'medium' | 'high';
}

interface ModalState {
  mode: 'verify' | 'create' | 'change' | 'remove';
  options: RequirePinOptions;
  resolver: (ok: boolean) => void;
}

interface SecurityPinContextType {
  requirePin: (opts: RequirePinOptions) => Promise<boolean>;
  openCreatePin: () => Promise<boolean>;
  openChangePin: () => Promise<boolean>;
  openRemovePin: () => Promise<boolean>;
  /** Retorna Date de expiração se houver sessão válida para 'medium' ou 'high'; null caso contrário. */
  getFinancialSessionExpiry: () => Date | null;
  /** Exige PIN e concede sessão de 2h para revelar valores do módulo financeiro.
   *  Passa onReveal para receber a Date de expiração sincronamente no onVerified. */
  revealFinancialValues: (onReveal?: (expiry: Date) => void) => Promise<boolean>;
  /** Retorna Date de expiração da sessão financeira (2h); null se não autenticado. */
  getFinancialModuleExpiry: () => Date | null;
}

// ── Sessão efêmera (sessionStorage, nunca PIN) ────────────────────────────────

const SESSION_KEY           = '_pin_session_v1';
const SESSION_FINANCIAL_KEY = '_pin_financial_v1';
const TTL_HIGH_MS        = 5 * 60 * 1000;           // 5 min para ações sensíveis
const TTL_MEDIUM_MS      = 10 * 60 * 1000;          // 10 min para revelar valores
const TTL_FINANCIAL_MS   = 2 * 60 * 60 * 1000;      // 2 h para revelar dados financeiros

function readSession(): PinSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PinSession;
    if (Date.now() > s.expiresAt) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function writeSession(sensitivity: 'medium' | 'high', ttlHighMs = TTL_HIGH_MS, ttlMediumMs = TTL_MEDIUM_MS) {
  const ttl = sensitivity === 'medium' ? ttlMediumMs : ttlHighMs;
  const session: PinSession = {
    verifiedAt: Date.now(),
    expiresAt: Date.now() + ttl,
    sensitivity,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// ── Sessão financeira (2h TTL, separada da sessão PIN geral) ──────────────────

function readFinancialSession(): { expiresAt: number } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_FINANCIAL_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { expiresAt: number };
    if (Date.now() > s.expiresAt) {
      sessionStorage.removeItem(SESSION_FINANCIAL_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function writeFinancialSession(ttlFinancialMs = TTL_FINANCIAL_MS) {
  sessionStorage.setItem(
    SESSION_FINANCIAL_KEY,
    JSON.stringify({ expiresAt: Date.now() + ttlFinancialMs }),
  );
}

function clearFinancialSession() {
  sessionStorage.removeItem(SESSION_FINANCIAL_KEY);
}

export function isFinancialSessionValid(): boolean {
  return readFinancialSession() !== null;
}

function sessionCovers(sensitivity: Sensitivity): boolean {
  if (sensitivity === 'critical') return false; // crítico: sempre exige PIN
  const s = readSession();
  if (!s) return false;
  if (Date.now() > s.expiresAt) { clearSession(); return false; }
  // sessão 'high' cobre 'medium'; sessão 'medium' não cobre 'high'
  if (sensitivity === 'medium') return true;
  if (sensitivity === 'high') return s.sensitivity === 'high';
  return false;
}

// ── Context ───────────────────────────────────────────────────────────────────

const SecurityPinContext = createContext<SecurityPinContextType | undefined>(undefined);

export const SecurityPinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [modal, setModal] = useState<ModalState | null>(null);
  const ttlHighRef      = useRef(TTL_HIGH_MS);
  const ttlMediumRef    = useRef(TTL_MEDIUM_MS);
  const ttlFinancialRef = useRef(TTL_FINANCIAL_MS);

  // Carregar TTLs configurados — só para staff autenticado. Em rotas PÚBLICAS
  // (assinatura/verificação) não há sessão e `system_settings` é fechado p/
  // anon: ler aqui geraria um 401 inútil (o PIN nem é usado no fluxo público).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      settingsService.getSecurityConfig().then(cfg => {
        const pinMs = Math.max(1, cfg.pin_session_minutes ?? 5) * 60 * 1000;
        ttlHighRef.current   = pinMs;
        ttlMediumRef.current = pinMs;
        ttlFinancialRef.current = Math.max(0.5, cfg.financial_view_hours ?? 2) * 60 * 60 * 1000;
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  // Limpar sessão no logout
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        clearSession();
        clearFinancialSession();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const openModal = useCallback(
    (mode: 'verify' | 'create' | 'change' | 'remove', options: RequirePinOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setModal({ mode, options, resolver: resolve });
      }),
    [],
  );

  const closeModal = useCallback((ok: boolean) => {
    setModal(prev => {
      prev?.resolver(ok);
      return null;
    });
  }, []);

  const handleSuccess = useCallback(async () => {
    const opts = modal?.options;
    const mode = modal?.mode;

    // Limpar sessão ao remover PIN
    if (mode === 'remove') {
      clearSession();
    }

    // Salvar sessão para verify/create (não para change/remove — são ações pontuais)
    if (mode === 'verify' || mode === 'create') {
      const sens = opts?.sensitivity;
      if (sens === 'medium' || sens === 'high') {
        writeSession(sens, ttlHighRef.current, ttlMediumRef.current);
      }
      // critical não salva sessão
    }

    closeModal(true);
    if (opts?.onVerified) {
      try {
        await opts.onVerified();
      } catch (e) {
        console.error('[SecurityPin] onVerified error:', e);
      }
    }
  }, [modal, closeModal]);

  const requirePin = useCallback(async (opts: RequirePinOptions): Promise<boolean> => {
    const sensitivity = opts.sensitivity ?? 'high';

    // Verificar sessão ativa (exceto critical)
    if (sessionCovers(sensitivity)) {
      if (opts.onVerified) {
        try { await opts.onVerified(); } catch {}
      }
      return true;
    }

    // Verificar se usuário tem PIN
    const hasPin = await securityPinService.hasSecurityPin();
    if (!hasPin) {
      // Sem PIN: abre criação com contexto próprio (não vaza title/entityName da ação original)
      const created = await openModal('create', {
        action: 'create_pin_first',
        sensitivity,
        title: 'Crie seu PIN de Segurança',
        description: 'Você ainda não tem um PIN cadastrado. Crie agora para proteger suas ações.',
        actionLabel: 'Criar PIN',
        onVerified: opts.onVerified,
      });
      return created;
    }

    // Abre verificação
    return openModal('verify', { ...opts, sensitivity });
  }, [openModal]);

  const openCreatePin = useCallback((): Promise<boolean> =>
    openModal('create', { action: 'create_pin', sensitivity: 'high' }),
    [openModal],
  );

  const openChangePin = useCallback((): Promise<boolean> =>
    openModal('change', { action: 'change_pin', sensitivity: 'high' }),
    [openModal],
  );

  const openRemovePin = useCallback((): Promise<boolean> =>
    openModal('remove', { action: 'remove_pin', sensitivity: 'critical' }),
    [openModal],
  );

  const getFinancialSessionExpiry = useCallback((): Date | null => {
    const s = readSession();
    if (!s) return null;
    return new Date(s.expiresAt);
  }, []);

  const revealFinancialValues = useCallback(async (onReveal?: (expiry: Date) => void): Promise<boolean> => {
    // Sessão financeira já válida — dispara callback imediatamente
    const existing = readFinancialSession();
    if (existing) {
      onReveal?.(new Date(existing.expiresAt));
      return true;
    }

    // Usa requirePin com onVerified para garantir que writeFinancialSession e onReveal
    // sejam chamados DENTRO do handleSuccess (antes do re-render do modal fechar),
    // evitando race condition com microtask de Promise resolution.
    const ttlH = ttlFinancialRef.current;
    const ttlLabel = ttlH >= 3600000
      ? `${Math.round(ttlH / 3600000)} hora${Math.round(ttlH / 3600000) !== 1 ? 's' : ''}`
      : `${Math.round(ttlH / 60000)} minuto${Math.round(ttlH / 60000) !== 1 ? 's' : ''}`;
    return requirePin({
      action: 'reveal_financial',
      sensitivity: 'high',
      title: 'Ver valores financeiros',
      description: `Informe o PIN de segurança para revelar os valores financeiros. A sessão expira em ${ttlLabel}.`,
      actionLabel: 'Revelar valores',
      onVerified: () => {
        writeFinancialSession(ttlFinancialRef.current);
        const s = readFinancialSession();
        if (s) onReveal?.(new Date(s.expiresAt));
      },
    });
  }, [requirePin]);

  const getFinancialModuleExpiry = useCallback((): Date | null => {
    const s = readFinancialSession();
    if (!s) return null;
    return new Date(s.expiresAt);
  }, []);

  return (
    <SecurityPinContext.Provider value={{ requirePin, openCreatePin, openChangePin, openRemovePin, getFinancialSessionExpiry, revealFinancialValues, getFinancialModuleExpiry }}>
      {children}
      {modal && (
        <SecurityPinModal
          open
          mode={modal.mode}
          title={modal.options.title}
          description={modal.options.description}
          actionLabel={modal.options.actionLabel}
          resourceType={modal.options.resourceType}
          resourceId={modal.options.resourceId}
          entityName={modal.options.entityName}
          sensitivity={modal.options.sensitivity}
          onSuccess={handleSuccess}
          onCancel={() => closeModal(false)}
        />
      )}
    </SecurityPinContext.Provider>
  );
};

export const useSecurityPin = (): SecurityPinContextType => {
  const ctx = useContext(SecurityPinContext);
  if (!ctx) throw new Error('useSecurityPin must be used within SecurityPinProvider');
  return ctx;
};

// ── Componente utilitário: ação protegida ─────────────────────────────────────

interface ProtectedActionProps {
  action: string;
  resourceType?: string;
  resourceId?: string;
  sensitivity?: Sensitivity;
  onVerified: () => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  disabled?: boolean;
}

export const ProtectedAction: React.FC<ProtectedActionProps> = ({
  action, resourceType, resourceId, sensitivity = 'high',
  onVerified, children, className, title, description, actionLabel, disabled,
}) => {
  const { requirePin } = useSecurityPin();

  const handleClick = async () => {
    if (disabled) return;
    await requirePin({ action, resourceType, resourceId, sensitivity, onVerified, title, description, actionLabel });
  };

  return (
    <button type="button" onClick={handleClick} className={className} disabled={disabled}>
      {children}
    </button>
  );
};

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import { SESSION_POLICY } from '../config/sessionPolicy';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sessionWarning: boolean;
  extendSession: () => void;
  sessionStart: number | null;
  isAccountBlocked: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_START_STORAGE_KEY = 'auth_session_start_at';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [sessionWarning, setSessionWarning] = useState(false);
  const [isAccountBlocked, setIsAccountBlocked] = useState(false);
  const [sessionStart, setSessionStart] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(SESSION_START_STORAGE_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isNaN(parsed) ? null : parsed;
  });

  const persistSessionStart = (timestamp: number | null) => {
    if (typeof window === 'undefined') return;
    if (timestamp) {
      localStorage.setItem(SESSION_START_STORAGE_KEY, String(timestamp));
    } else {
      localStorage.removeItem(SESSION_START_STORAGE_KEY);
    }
    setSessionStart(timestamp);
  };

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // Verifica is_active antes de qualquer coisa — impede burlar com F5
      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_active')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profile?.is_active === false) {
          await supabase.auth.signOut();
          persistSessionStart(null);
          setLoading(false);
          return;
        }
      }

      setSession(session);
      setUser(session?.user ?? null);
      if (session) {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(SESSION_START_STORAGE_KEY) : null;
        if (stored) {
          const parsed = Number(stored);
          if (!Number.isNaN(parsed)) {
            setSessionStart(parsed);
          } else {
            const now = Date.now();
            persistSessionStart(now);
          }
        } else {
          const now = Date.now();
          persistSessionStart(now);
        }
      } else {
        persistSessionStart(null);
      }
      setLoading(false);
    });

    // Listen for auth changes - com debounce para evitar múltiplas chamadas
    let lastEvent = '';
    let lastEventTime = 0;
    let lastUserId = '';
    
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const now = Date.now();
      const currentUserId = session?.user?.id || '';
      
      // Ignorar eventos duplicados em menos de 2 segundos (mesmo evento + mesmo usuário)
      if (event === lastEvent && currentUserId === lastUserId && now - lastEventTime < 2000) {
        return;
      }
      
      lastEvent = event;
      lastEventTime = now;
      lastUserId = currentUserId;
      
      // Log apenas SIGNED_OUT (SIGNED_IN é muito verboso)
      if (event === 'SIGNED_OUT') {
        console.log('Auth:', event);
      }
      
      // Handle session expiration
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        persistSessionStart(null);
      } else if (event === 'SIGNED_IN') {
        setSession(session);
        setUser(session?.user ?? null);
        if (!sessionStart) {
          persistSessionStart(Date.now());
        }
      } else if (event === 'TOKEN_REFRESHED') {
        // Apenas atualizar sessão silenciosamente
        setSession(session);
      }
      
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Watch profile is_active — Realtime + polling de 30s como fallback
  useEffect(() => {
    if (!user?.id) return;

    const checkBlocked = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('is_active')
          .eq('user_id', user.id)
          .maybeSingle();
        if (data?.is_active === false) setIsAccountBlocked(true);
      } catch { /* silencia erros de rede */ }
    };

    // Realtime: notificação instantânea quando o campo mudar
    const channel = supabase
      .channel(`profile-blocked:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${user.id}` },
        (payload) => {
          if ((payload.new as { is_active?: boolean }).is_active === false) {
            setIsAccountBlocked(true);
          }
        }
      )
      .subscribe();

    // Polling a cada 30s: fallback caso Realtime seja bloqueado por RLS
    const interval = setInterval(checkBlocked, 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user?.id]);

  // Inatividade + time-box absoluto → logout automático REAL.
  //
  // O token em si é mantido fresco pelo `autoRefreshToken` do supabase-js
  // enquanto a aba está aberta; aqui cuidamos da POLÍTICA de encerramento:
  //  · idle      — tempo sem interação (reseta com atividade)
  //  · absoluto  — tempo desde o login (time-box; não reseta)
  // O que estourar primeiro encerra a sessão de fato (signOut + redirect).
  useEffect(() => {
    if (!session) return;

    const { idleMs, absoluteMs } = SESSION_POLICY.staff;
    const { warningMs, tickMs } = SESSION_POLICY;

    // Encerra a sessão de verdade: invalida o refresh token (evita re-login no F5),
    // limpa o início da sessão e volta para a tela de login com um aviso.
    const forceLogout = async (reason: 'idle' | 'timebox' | 'revoked') => {
      console.warn('🔒 Encerrando sessão —', reason);
      try { sessionStorage.setItem('auth_notice', 'session_expired'); } catch {}
      try { await supabase.auth.signOut(); } catch { /* segue para o redirect mesmo assim */ }
      persistSessionStart(null);
      window.location.href = window.location.origin + '/';
    };

    const tick = async () => {
      const now = Date.now();

      // 1) Time-box absoluto — vence mesmo com o usuário ativo.
      if (sessionStart && now - sessionStart > absoluteMs) {
        console.warn('⏰ Logout automático: tempo máximo de sessão atingido (time-box)');
        await forceLogout('timebox');
        return;
      }

      // 2) Inatividade.
      const idleFor = now - lastActivity;
      if (idleFor > idleMs) {
        console.warn('⏰ Logout automático por inatividade');
        await forceLogout('idle');
        return;
      }
      // Aviso de expiração iminente (idempotente — setState com mesmo valor é no-op).
      setSessionWarning(idleFor > idleMs - warningMs);

      // 3) Sessão revogada no servidor (troca de senha, signOut em outro dispositivo).
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          console.warn('Sessão inexistente/revogada — encerrando');
          await forceLogout('revoked');
        }
      } catch { /* erro de rede: não desloga por isso */ }
    };

    void tick(); // checa já na montagem (pega time-box vencido sem esperar o 1º tick)
    const interval = setInterval(tick, tickMs);
    return () => clearInterval(interval);
  }, [session, lastActivity, sessionStart]);

  // Detectar atividade do usuário com throttling
  useEffect(() => {
    if (!session) return;

    let throttleTimeout: NodeJS.Timeout | null = null;

    const handleActivity = () => {
      // Throttle para evitar muitas atualizações
      if (throttleTimeout) return;
      
      setLastActivity(Date.now());
      
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
      }, 30000); // Throttle de 30 segundos
    };

    // Eventos que indicam atividade do usuário
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (throttleTimeout) {
        clearTimeout(throttleTimeout);
      }
    };
  }, [session]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    setSession(data.session);
    setUser(data.user);
    persistSessionStart(Date.now());
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setSession(null);
    setUser(null);
    persistSessionStart(null);
    window.location.href = '/';
  };

  const resetPassword = async (email: string) => {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) throw error;
  };

  const extendSession = () => {
    setLastActivity(Date.now());
    setSessionWarning(false);
    console.log('🔄 Sessão estendida pelo usuário');
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      signIn,
      signOut,
      resetPassword,
      sessionWarning,
      extendSession,
      sessionStart,
      isAccountBlocked,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

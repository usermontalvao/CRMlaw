import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
import type { User, Session } from '@supabase/supabase-js';

// ── Anti-força-bruta do login staff (defesa em profundidade) ─────────────────
// Chama a Edge Function `staff-login-guard`. Fail-open: qualquer erro (inclusive
// função ainda não deployada) NÃO bloqueia o login.
type StaffLoginGuardResult = { blocked: boolean; retry_after_seconds?: number };

async function callStaffLoginGuard(
  action: 'check' | 'fail' | 'reset',
  email: string,
): Promise<StaffLoginGuardResult> {
  try {
    const { data, error } = await supabase.functions.invoke('staff-login-guard', {
      body: { action, email },
    });
    if (error) return { blocked: false };
    return (data as StaffLoginGuardResult) ?? { blocked: false };
  } catch {
    return { blocked: false };
  }
}

function formatRetryWait(seconds?: number): string {
  const s = Math.max(1, Math.ceil(seconds ?? 60));
  if (s >= 60) {
    const m = Math.ceil(s / 60);
    return `${m} minuto${m > 1 ? 's' : ''}`;
  }
  return `${s} segundo${s > 1 ? 's' : ''}`;
}

function makeStaffLoginBlockedError(retryAfterSeconds?: number): Error {
  const err = new Error(
    `Muitas tentativas de login. Tente novamente em ${formatRetryWait(retryAfterSeconds)}.`,
  );
  (err as Error & { code?: string }).code = 'staff_login_blocked';
  return err;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (opts?: { redirect?: boolean }) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sessionWarning: boolean;
  extendSession: () => void;
  sessionStart: number | null;
  isAccountBlocked: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionWarning, setSessionWarning] = useState(false);
  const [isAccountBlocked, setIsAccountBlocked] = useState(false);
  const [sessionStart] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_active')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profile?.is_active === false) {
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }
      }

      setSession(session);
      setUser(session?.user ?? null);
      setSessionWarning(false);
      setLoading(false);
    });

    let lastEvent = '';
    let lastEventTime = 0;
    let lastUserId = '';

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const now = Date.now();
      const currentUserId = session?.user?.id || '';

      if (event === lastEvent && currentUserId === lastUserId && now - lastEventTime < 2000) {
        return;
      }

      lastEvent = event;
      lastEventTime = now;
      lastUserId = currentUserId;

      if (event === 'SIGNED_OUT') {
        console.log('Auth:', event);
        setSession(null);
        setUser(null);
        setSessionWarning(false);
      } else if (event === 'SIGNED_IN') {
        setSession(session);
        setUser(session?.user ?? null);
        setSessionWarning(false);
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(session);
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

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
      } catch {}
    };

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

    const interval = setInterval(checkBlocked, 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const normalizedEmail = email.trim();

    // 1) Já está bloqueado? (não incrementa o contador)
    const pre = await callStaffLoginGuard('check', normalizedEmail);
    if (pre.blocked) {
      throw makeStaffLoginBlockedError(pre.retry_after_seconds);
    }

    // 2) Tenta autenticar no GoTrue
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      // 3) Registra a falha; se cruzou o limite, já informa o bloqueio nesta resposta
      const after = await callStaffLoginGuard('fail', normalizedEmail);
      if (after.blocked) {
        throw makeStaffLoginBlockedError(after.retry_after_seconds);
      }
      throw error;
    }

    setSession(data.session);
    setUser(data.user);
    setSessionWarning(false);

    // 4) Sucesso: zera o contador do e-mail (fire-and-forget, não atrasa o login)
    void callStaffLoginGuard('reset', normalizedEmail);
  };

  const signOut = async (opts?: { redirect?: boolean }) => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setSession(null);
    setUser(null);
    setSessionWarning(false);
    if (opts?.redirect !== false) window.location.href = '/';
  };

  const resetPassword = async (email: string) => {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) throw error;
  };

  const extendSession = () => {
    setSessionWarning(false);
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

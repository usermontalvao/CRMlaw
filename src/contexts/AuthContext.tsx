import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../config/supabase';
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_START_STORAGE_KEY = 'auth_session_start_at';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [sessionWarning, setSessionWarning] = useState(false);
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
    supabase.auth.getSession().then(({ data: { session } }) => {
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

  // Verificação de inatividade e logout automático
  useEffect(() => {
    if (!session) return;

    const checkInactivity = () => {
      const inactiveTime = Date.now() - lastActivity;
      const maxInactiveTime = 6 * 60 * 60 * 1000; // 6 horas de inatividade
      const warningTime = maxInactiveTime - 5 * 60 * 1000; // Aviso 5 minutos antes

      if (inactiveTime > maxInactiveTime) {
        console.warn('⏰ Logout automático por inatividade (6h)');
        // Força reload para limpar estado e evitar perda de dados
        window.location.href = '/login?reason=session_expired';
        return;
      }
      
      // Mostrar aviso quando próximo do logout
      if (inactiveTime > warningTime && !sessionWarning) {
        console.warn('⚠️ Sessão expirará em 5 minutos por inatividade');
        setSessionWarning(true);
      } else if (inactiveTime <= warningTime && sessionWarning) {
        setSessionWarning(false);
      }
    };

    const heartbeatInterval = setInterval(async () => {
      try {
        // Primeiro verificar inatividade
        checkInactivity();
        
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Erro ao verificar sessão:', error);
          return;
        }

        if (!data.session) {
          console.warn('Sessão expirada, forçando reload...');
          // Força reload para limpar estado e evitar perda de dados
          window.location.href = '/login?reason=session_expired';
          return;
        }

        // Renovar apenas se token expira em menos de 15 minutos E houve atividade recente
        const expiresAt = data.session.expires_at;
        if (expiresAt) {
          const expiresInMs = (expiresAt * 1000) - Date.now();
          const fifteenMinutes = 15 * 60 * 1000;
          const recentActivity = (Date.now() - lastActivity) < 10 * 60 * 1000; // Ativo nos últimos 10min

          if (expiresInMs < fifteenMinutes && recentActivity) {
            console.log('🔄 Renovando sessão (expira em', Math.round(expiresInMs / 60000), 'min)');
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError) {
              console.error('Erro ao renovar sessão:', refreshError);
            } else if (refreshData.session) {
              console.log('✅ Sessão renovada');
              setSession(refreshData.session);
              setUser(refreshData.user);
            }
          } else if (!recentActivity) {
            console.log('⚠️ Usuário inativo há mais de 10min, não renovando sessão');
          }
        }
      } catch (error) {
        console.error('Erro no heartbeat:', error);
      }
    }, 5 * 60 * 1000); // A cada 5 minutos

    return () => clearInterval(heartbeatInterval);
  }, [session, lastActivity]);

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
      sessionStart 
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

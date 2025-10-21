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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state change:', event, session);
      
      // Handle session expiration
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setSession(session);
        setUser(session?.user ?? null);
      } else if (event === 'SIGNED_IN') {
        setSession(session);
        setUser(session?.user ?? null);
      } else {
        setSession(session);
        setUser(session?.user ?? null);
      }
      
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Heartbeat otimizado: verificar sessão a cada 10 minutos (reduz requisições)
  useEffect(() => {
    if (!session) return;

    const heartbeatInterval = setInterval(async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Erro ao verificar sessão:', error);
          return;
        }

        if (!data.session) {
          console.warn('Sessão expirada, fazendo logout...');
          setSession(null);
          setUser(null);
          return;
        }

        // Renovar apenas se token expira em menos de 20 minutos E houve atividade recente
        const expiresAt = data.session.expires_at;
        if (expiresAt) {
          const expiresInMs = (expiresAt * 1000) - Date.now();
          const twentyMinutes = 20 * 60 * 1000;
          const recentActivity = (Date.now() - lastActivity) < 5 * 60 * 1000; // Ativo nos últimos 5min

          if (expiresInMs < twentyMinutes && recentActivity) {
            console.log('🔄 Renovando sessão (expira em', Math.round(expiresInMs / 60000), 'min)');
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError) {
              console.error('Erro ao renovar sessão:', refreshError);
            } else if (refreshData.session) {
              console.log('✅ Sessão renovada');
              setSession(refreshData.session);
              setUser(refreshData.user);
            }
          }
        }
      } catch (error) {
        console.error('Erro no heartbeat:', error);
      }
    }, 10 * 60 * 1000); // A cada 10 minutos (reduzido de 5min)

    return () => clearInterval(heartbeatInterval);
  }, [session, lastActivity]);

  // Detectar atividade do usuário (apenas rastrear, sem requisições)
  useEffect(() => {
    if (!session) return;

    const handleActivity = () => {
      setLastActivity(Date.now());
    };

    // Eventos que indicam atividade (throttled para reduzir processamento)
    const events = ['mousedown', 'keydown'];
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
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
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    setSession(null);
    setUser(null);
  };

  const resetPassword = async (email: string) => {
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signOut, resetPassword }}>
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

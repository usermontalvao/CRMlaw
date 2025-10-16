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

  // Heartbeat para manter sessão ativa e renovar token periodicamente
  useEffect(() => {
    if (!session) return;

    // Verificar e renovar sessão a cada 5 minutos
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

        // Verificar se o token está próximo de expirar (menos de 10 minutos)
        const expiresAt = data.session.expires_at;
        if (expiresAt) {
          const expiresInMs = (expiresAt * 1000) - Date.now();
          const tenMinutes = 10 * 60 * 1000;

          if (expiresInMs < tenMinutes) {
            console.log('Token próximo de expirar, renovando...');
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError) {
              console.error('Erro ao renovar sessão:', refreshError);
            } else if (refreshData.session) {
              console.log('✅ Sessão renovada com sucesso');
              setSession(refreshData.session);
              setUser(refreshData.user);
            }
          }
        }
      } catch (error) {
        console.error('Erro no heartbeat de sessão:', error);
      }
    }, 5 * 60 * 1000); // A cada 5 minutos

    return () => clearInterval(heartbeatInterval);
  }, [session]);

  // Detectar atividade do usuário e renovar sessão se necessário
  useEffect(() => {
    if (!session) return;

    const handleActivity = () => {
      setLastActivity(Date.now());
    };

    // Eventos que indicam atividade do usuário
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [session]);

  // Verificar se precisa renovar sessão baseado na atividade
  useEffect(() => {
    if (!session) return;

    const checkSessionOnActivity = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        
        if (!data.session || error) return;

        const expiresAt = data.session.expires_at;
        if (expiresAt) {
          const expiresInMs = (expiresAt * 1000) - Date.now();
          const fifteenMinutes = 15 * 60 * 1000;

          // Se o token expira em menos de 15 minutos e houve atividade recente
          if (expiresInMs < fifteenMinutes && (Date.now() - lastActivity) < 60000) {
            console.log('Renovando sessão devido à atividade do usuário...');
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            
            if (!refreshError && refreshData.session) {
              console.log('✅ Sessão renovada por atividade');
              setSession(refreshData.session);
              setUser(refreshData.user);
            }
          }
        }
      } catch (error) {
        console.error('Erro ao verificar sessão por atividade:', error);
      }
    };

    // Verificar a cada 2 minutos se houve atividade recente
    const activityCheckInterval = setInterval(checkSessionOnActivity, 2 * 60 * 1000);

    return () => clearInterval(activityCheckInterval);
  }, [session, lastActivity]);

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

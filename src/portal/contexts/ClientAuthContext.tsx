/**
 * ClientAuthContext — Autenticação do Portal do Cliente
 *
 * Totalmente isolado do AuthContext do app principal.
 * Persiste sessão em localStorage (chave: jurius_portal_session).
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { clientAuthService } from '../services/clientAuth.service';
import { supabasePortal } from '../lib/supabasePortal';
import type { PortalSession } from '../types/portal.types';

interface ClientAuthContextType {
  session: PortalSession | null;
  loading: boolean;
  loginByCPF: (cpf: string, password: string) => Promise<void>;
  logout: () => void;
  updateSession: (updater: (prev: PortalSession | null) => PortalSession | null) => void;
  isAuthenticated: boolean;
}

const ClientAuthContext = createContext<ClientAuthContextType | undefined>(undefined);

export const ClientAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const stored = clientAuthService.getStoredSession();
      if (!stored) {
        if (active) { setSession(null); setLoading(false); }
        return;
      }

      const { data } = await supabasePortal.auth.getSession();
      if (!active) return;

      if (!data.session) {
        clientAuthService.logout();
        setSession(null);
      } else {
        setSession(stored);
      }

      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const loginByCPF = useCallback(async (cpf: string, password: string) => {
    const newSession = await clientAuthService.loginByCPF(cpf, password);
    setSession(newSession);
  }, []);

  const logout = useCallback(() => {
    clientAuthService.logout();
    setSession(null);
  }, []);

  const updateSession = useCallback(
    (updater: (prev: PortalSession | null) => PortalSession | null) => {
      setSession((prev) => {
        const next = updater(prev);
        if (next) clientAuthService.persistSession(next);
        return next;
      });
    },
    []
  );

  return (
    <ClientAuthContext.Provider
      value={{
        session,
        loading,
        loginByCPF,
        logout,
        updateSession,
        isAuthenticated: !!session,
      }}
    >
      {children}
    </ClientAuthContext.Provider>
  );
};

export const useClientAuth = () => {
  const ctx = useContext(ClientAuthContext);
  if (!ctx) {
    throw new Error('useClientAuth deve ser usado dentro de <ClientAuthProvider>');
  }
  return ctx;
};

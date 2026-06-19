/**
 * ClientAuthContext — Autenticação do Portal do Cliente
 *
 * Totalmente isolado do AuthContext do app principal.
 * Persiste sessão em localStorage (chave: jurius_portal_session).
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { clientAuthService } from '../services/clientAuth.service';
import { supabasePortal } from '../lib/supabasePortal';
import { SESSION_POLICY } from '../../config/sessionPolicy';
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
      // Confirma que a sessão Supabase real (JWT) ainda existe/renova. Sem ela,
      // os RPCs rodariam como anon e falhariam — então tratamos como deslogado.
      const { data } = await supabasePortal.auth.getSession();
      if (!active) return;
      if (!data.session) {
        clientAuthService.logout();
        setSession(null);
      } else {
        // Time-box: descarta a sessão que já excedeu a vida máxima desde o login.
        const loginAt = Date.parse(stored.loginAt || '');
        if (loginAt && Date.now() - loginAt > SESSION_POLICY.portal.absoluteMs) {
          clientAuthService.logout();
          setSession(null);
        } else {
          setSession(stored);
        }
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  // Inatividade + time-box absoluto → encerra a sessão do portal automaticamente.
  // Espelha a política do staff (AuthContext), com tempos mais curtos por ser
  // acesso de cliente em dispositivo pessoal/compartilhado. Ver sessionPolicy.ts.
  useEffect(() => {
    if (!session) return;

    const { idleMs, absoluteMs } = SESSION_POLICY.portal;
    const loginAt = Date.parse(session.loginAt || '') || Date.now();
    let lastActivity = Date.now();

    const onActivity = () => { lastActivity = Date.now(); };
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const expire = () => {
      clientAuthService.logout();
      setSession(null);
      try { sessionStorage.setItem('portal_notice', 'session_expired'); } catch { /* ignore */ }
      window.location.href = window.location.origin + '/';
    };

    const tick = () => {
      const now = Date.now();
      if (now - loginAt > absoluteMs || now - lastActivity > idleMs) expire();
    };

    void tick(); // pega time-box vencido logo na montagem
    const interval = setInterval(tick, SESSION_POLICY.tickMs);
    return () => {
      clearInterval(interval);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [session]);

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

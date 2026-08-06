import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/profile.service';
import {
  AWAY_AFTER_MS,
  REFRESH_MS,
  applyWrite,
  createPresenceState,
  decideOnActivity,
  decideOnInactivity,
  decideOnLeave,
  decideOnMount,
  decideOnRefresh,
} from './presenceSchedule';

/** Evita reprocessar a cada evento de rolagem. */
const ACTIVITY_THROTTLE_MS = 5 * 1000;

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Hook para gerenciar presença do usuário (online/away/offline).
 *
 * A presença é gravada em `profiles` apenas nas transições reais de estado
 * (entrou, ficou ausente, voltou, saiu), mais uma reconfirmação a cada 5
 * minutos que só dispara se houve atividade desde a última escrita. Presença
 * "ao vivo" dentro do CRM vem do Supabase Presence, que roda por canal e não
 * escreve no banco; o valor em `profiles.presence_status` existe para quem lê
 * de fora, como o Portal do Cliente.
 *
 * Quem decide o que gravar é ./presenceSchedule, que é testado à parte.
 */
export function usePresence() {
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const state = createPresenceState(Date.now());
    let lastActivityHandledAt = 0;
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const write = (status: ReturnType<typeof decideOnMount> | null) => {
      if (!status || cancelled) return;
      applyWrite(state, status, Date.now());
      profileService.setPresenceStatus(userId, status).catch(console.error);
    };

    const scheduleAway = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => write(decideOnInactivity(state)), AWAY_AFTER_MS);
    };

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityHandledAt < ACTIVITY_THROTTLE_MS) {
        state.lastActivityAt = now;
        return;
      }
      lastActivityHandledAt = now;
      write(decideOnActivity(state, now));
      scheduleAway();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastActivityHandledAt = 0;
        handleActivity();
      }
    };

    // A aplicação não possui uma rota /api/presence/offline. Usamos o mesmo
    // serviço de presença do restante do sistema ao ocultar/fechar a página.
    const handlePageHide = () => {
      clearTimeout(inactivityTimer);
      const status = decideOnLeave(state);
      if (!status) return;
      applyWrite(state, status, Date.now());
      void profileService.setOffline(userId).catch(() => {
        // A navegação pode encerrar a requisição; a expiração de presença
        // no servidor continua sendo a garantia final.
      });
    };

    write(decideOnMount());
    scheduleAway();

    const refreshTimer = setInterval(() => write(decideOnRefresh(state)), REFRESH_MS);

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      clearTimeout(inactivityTimer);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });

      // Marcar como offline ao desmontar, se já não tiver sido marcado.
      if (decideOnLeave(state)) {
        profileService.setOffline(userId).catch(console.error);
      }
    };
    // Depende só do id: o objeto `user` é recriado a cada renovação de token,
    // e depender dele fazia o efeito remontar e gravar offline/online a cada
    // vez — um par de escritas em tabela publicada no Realtime, à toa.
  }, [userId]);
}

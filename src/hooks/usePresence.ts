import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { profileService } from '../services/profile.service';

/**
 * Hook para gerenciar presença do usuário (online/away/offline)
 */
export function usePresence() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    // Marcar como online ao montar
    profileService.setOnline(user.id).catch(console.error);

    // Atualizar presença a cada 2 minutos
    const intervalId = setInterval(() => {
      profileService.setOnline(user.id).catch(console.error);
    }, 2 * 60 * 1000);

    // Marcar como offline ao desmontar
    const handleBeforeUnload = () => {
      // Usar sendBeacon para garantir que a requisição seja enviada
      navigator.sendBeacon(
        '/api/presence/offline',
        JSON.stringify({ user_id: user.id })
      );
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Detectar inatividade (ausente após 5 minutos)
    let inactivityTimer: NodeJS.Timeout;
    const resetInactivityTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        profileService.setAway(user.id).catch(console.error);
      }, 5 * 60 * 1000);
    };

    // Eventos que indicam atividade
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach((event) => {
      window.addEventListener(event, resetInactivityTimer);
    });

    resetInactivityTimer();

    return () => {
      clearInterval(intervalId);
      clearTimeout(inactivityTimer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, resetInactivityTimer);
      });
      
      // Marcar como offline ao desmontar
      profileService.setOffline(user.id).catch(console.error);
    };
  }, [user]);
}

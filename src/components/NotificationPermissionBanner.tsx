import React, { useState } from 'react';
import { Bell, X, Volume2, VolumeX } from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';

export const NotificationPermissionBanner: React.FC = () => {
  const { settings, isInitializing, requestPermission, toggleSound, testNotification } = useNotifications();
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem('notification_banner_dismissed') === 'true';
  });

  // Não mostra o banner se:
  // 1. Já foi dismissed
  // 2. Permissão já foi concedida
  // 3. Permissão foi negada (não adianta perguntar novamente)
  if (dismissed || settings.permission === 'granted' || settings.permission === 'denied') {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('notification_banner_dismissed', 'true');
  };

  const handleEnable = async () => {
    const granted = await requestPermission();
    if (granted) {
      handleDismiss();
      // Mostra notificação de boas-vindas
      setTimeout(() => {
        testNotification();
      }, 500);
    }
  };

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-blue-600 border border-indigo-700 rounded-xl p-4 shadow-lg">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <Bell className="w-6 h-6 text-white" />
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-white mb-1">
            Ative as Notificações do Sistema
          </h3>
          <p className="text-sm text-indigo-100 mb-3">
            Receba alertas em tempo real sobre prazos, intimações e compromissos atribuídos a você - mesmo quando não estiver com o sistema aberto.
          </p>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleEnable}
              disabled={isInitializing}
              className="inline-flex items-center gap-2 bg-white text-indigo-600 hover:bg-indigo-50 font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
            >
              <Bell className="w-4 h-4" />
              {isInitializing ? 'Habilitando...' : 'Habilitar Notificações'}
            </button>
            
            <button
              onClick={toggleSound}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-medium px-4 py-2 rounded-lg transition"
            >
              {settings.soundEnabled ? (
                <>
                  <Volume2 className="w-4 h-4" />
                  Som Ativado
                </>
              ) : (
                <>
                  <VolumeX className="w-4 h-4" />
                  Som Desativado
                </>
              )}
            </button>
            
            <button
              onClick={handleDismiss}
              className="inline-flex items-center gap-2 text-white/80 hover:text-white font-medium px-4 py-2 rounded-lg transition"
            >
              Agora não
            </button>
          </div>
        </div>
        
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-white/60 hover:text-white transition p-1"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

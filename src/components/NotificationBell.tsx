import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  X,
  Check,
  CheckCheck,
  Clock,
  Calendar,
  Briefcase,
  FileText,
  AlertTriangle,
  ChevronRight,
  Loader2,
  Volume2,
  VolumeX,
  Trash2,
  PenTool,
} from 'lucide-react';
import { userNotificationService } from '../services/userNotification.service';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { pushNotifications } from '../utils/pushNotifications';
import type { UserNotification } from '../types/user-notification.types';

interface NotificationBellProps {
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
}

// Função para tocar som de notificação usando Web Audio API
const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch {}
};

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigateToModule }) => {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const MAX_POPUPS = 5;
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('notification_sound') !== 'false';
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const [popupNotifications, setPopupNotifications] = useState<UserNotification[]>([]);
  const processedNotificationIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    pushNotifications.initialize().catch(() => {});
  }, []);

  const unreadNotifications = notifications.filter(n => !n.read);
  const unreadCount = unreadNotifications.length;

  const isSignatureNotification = (notification: UserNotification) => {
    return notification.type === 'process_updated' && Boolean(notification.metadata?.signature_type);
  };

  const getSignatureBadge = (notification: UserNotification) => {
    const signatureType = notification.metadata?.signature_type;
    if (signatureType === 'completed') return 'CONCLUÍDA';
    if (signatureType === 'partial') return 'PARCIAL';
    return 'ASSINATURA';
  };

  const getSignatureProgress = (notification: UserNotification) => {
    const signedCount = Number(notification.metadata?.signed_count ?? 0);
    const totalSigners = Number(notification.metadata?.total_signers ?? 0);
    if (!Number.isFinite(signedCount) || !Number.isFinite(totalSigners) || totalSigners <= 0) {
      return null;
    }
    const pct = Math.max(0, Math.min(100, Math.round((signedCount / totalSigners) * 100)));
    return { signedCount, totalSigners, pct };
  };

  const getSignatureAccent = (notification: UserNotification) => {
    return notification.metadata?.signature_type === 'completed' ? 'emerald' : 'teal';
  };

  // Carregar notificações
  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const data = await userNotificationService.listNotifications(user.id);
      
      // Tocar som se há novas notificações
      if (data.filter(n => !n.read).length > prevCountRef.current && soundEnabled) {
        playSound();
      }
      prevCountRef.current = data.filter(n => !n.read).length;
      
      setNotifications(data.slice(0, 50)); // Limitar a 50
    } catch (err) {
      console.error('Erro ao carregar notificações:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, soundEnabled]);

  // Tocar som
  const playSound = () => {
    playNotificationSound();
  };

  // Toggle som
  const toggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    localStorage.setItem('notification_sound', String(newValue));
  };

  // Marcar como lida
  const markAsRead = async (id: string) => {
    try {
      await userNotificationService.markAsRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {}
  };

  // Marcar todas como lidas
  const markAllAsRead = async () => {
    if (!user?.id) return;
    try {
      await userNotificationService.markAllAsRead(user.id);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  // Deletar notificação
  const deleteNotification = async (id: string) => {
    try {
      await userNotificationService.deleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch {}
  };

  // Navegar para item
  const handleClick = (notification: UserNotification) => {
    console.log('🖱️ Clique na notificação:', notification.id, notification.type, 'intimation_id:', notification.intimation_id, 'metadata:', notification.metadata);
    console.log('🖱️ isSignature:', isSignatureNotification(notification), 'request_id:', notification.metadata?.request_id);
    markAsRead(notification.id);

    if (!onNavigateToModule) {
      console.log('⚠️ onNavigateToModule não definido');
      setIsOpen(false);
      return;
    }

    // Preferir navegação por tipo (evita que requirement_id em prazo/agenda mude o destino)
    // Assinatura: type=process_updated com signature_type no metadata
    if (isSignatureNotification(notification)) {
      const requestId = notification.metadata?.request_id;
      console.log('➡️ Navegando para assinaturas, requestId:', requestId);
      if (requestId) {
        onNavigateToModule('assinaturas', { mode: 'details', requestId: String(requestId) });
      } else {
        onNavigateToModule('assinaturas');
      }
    } else if (notification.type === 'requirement_alert' && notification.requirement_id) {
      console.log('➡️ Navegando para requerimentos');
      onNavigateToModule('requerimentos', { mode: 'details', entityId: notification.requirement_id });
    } else if (notification.intimation_id || notification.type === 'intimation_new') {
      console.log('➡️ Navegando para intimacoes');
      onNavigateToModule('intimacoes');
    } else if (notification.type === 'deadline_assigned' || notification.type === 'deadline_reminder') {
      console.log('➡️ Navegando para prazos');
      onNavigateToModule('prazos');
    } else if (notification.type === 'appointment_assigned' || notification.type === 'appointment_reminder') {
      console.log('➡️ Navegando para agenda');
      onNavigateToModule('agenda');
    } else if (notification.process_id) {
      console.log('➡️ Navegando para processos');
      onNavigateToModule('processos');
    } else if (notification.requirement_id) {
      console.log('➡️ Navegando para requerimentos');
      onNavigateToModule('requerimentos', { mode: 'details', entityId: notification.requirement_id });
    } else {
      console.log('⚠️ Nenhuma navegação definida para esta notificação');
    }
    
    setIsOpen(false);
  };

  const showBrowserNotification = async (notification: UserNotification) => {
    console.log('🔔 showBrowserNotification chamado para:', notification.id);
    if (typeof window === 'undefined') {
      console.log('⚠️ window undefined');
      return;
    }
    if (!('Notification' in window)) {
      console.log('⚠️ Notification API não suportada');
      return;
    }
    console.log('🔔 Permissão de notificação:', Notification.permission);
    if (Notification.permission !== 'granted') {
      console.log('⚠️ Permissão não concedida, solicitando...');
      const result = await Notification.requestPermission();
      console.log('🔔 Resultado da solicitação:', result);
      if (result !== 'granted') return;
    }

    const isUrgent = notification.metadata?.urgency === 'alta' || notification.metadata?.urgency === 'critica';
    const signature = isSignatureNotification(notification);

    let data: any = { action: 'navigate' };
    if (signature && notification.metadata?.request_id) {
      data = {
        action: 'navigate',
        module: 'assinaturas',
        params: { mode: 'details', requestId: String(notification.metadata.request_id) },
      };
    }

    await pushNotifications.showNotification({
      title: notification.title,
      body: notification.message,
      tag: `user-notification-${notification.id}`,
      data,
      requireInteraction: signature || isUrgent,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
    });
  };

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Carregar ao montar e polling
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000); // 30s
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Realtime: escutar novas notificações
  useEffect(() => {
    if (!user?.id) return;

    // Nome único do canal para evitar conflitos com StrictMode
    const channelName = `user_notifications_${user.id}_${Date.now()}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as UserNotification;
          
          // Evitar processar a mesma notificação duas vezes (StrictMode)
          if (processedNotificationIds.current.has(newNotification.id)) {
            console.log('⏭️ Notificação já processada, ignorando:', newNotification.id);
            return;
          }
          processedNotificationIds.current.add(newNotification.id);
          
          console.log('🔔 Nova notificação recebida via Realtime:', newNotification.id, newNotification.title);
          
          // Adicionar no topo da lista
          setNotifications(prev => {
            // Evitar duplicatas na lista
            if (prev.some(n => n.id === newNotification.id)) return prev;
            return [newNotification, ...prev].slice(0, 50);
          });
          
          // Mostrar popup na tela (estilo Facebook/Instagram)
          console.log('🎯 Adicionando popup para notificação:', newNotification.id);
          setPopupNotifications(prev => {
            // Evitar duplicatas no popup
            if (prev.some(n => n.id === newNotification.id)) return prev;
            const updated = [...prev, newNotification].slice(-MAX_POPUPS);
            console.log('📦 Popups ativos:', updated.length);
            return updated;
          });
          
          // Tocar som
          if (soundEnabled) {
            playNotificationSound();
          }

          showBrowserNotification(newNotification).catch(() => {});
        }
      )
      .subscribe((status) => {
        console.log('📡 Canal Realtime status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, soundEnabled]);

  // Ícone por tipo e urgência
  const getIcon = (notification: UserNotification) => {
    const urgency = notification.metadata?.urgency;
    const isUrgent = urgency === 'alta' || urgency === 'critica';
    
    switch (notification.type) {
      case 'deadline_assigned':
      case 'deadline_reminder':
        return <Clock className="w-4 h-4 text-amber-500" />;
      case 'appointment_assigned':
      case 'appointment_reminder':
        return <Calendar className="w-4 h-4 text-blue-500" />;
      case 'requirement_alert':
        return <Briefcase className="w-4 h-4 text-amber-600" />;
      case 'intimation_new':
        return isUrgent 
          ? <AlertTriangle className="w-4 h-4 text-red-500" />
          : <FileText className="w-4 h-4 text-purple-500" />;
      case 'process_updated':
        // Verificar se é assinatura pelo metadata
        if (notification.metadata?.signature_type) {
          return <PenTool className="w-4 h-4 text-emerald-500" />;
        }
        return <FileText className="w-4 h-4 text-slate-500" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  // Cor de fundo do ícone baseado na urgência
  const getIconBgColor = (notification: UserNotification) => {
    const urgency = notification.metadata?.urgency;
    if (isSignatureNotification(notification)) {
      return notification.metadata?.signature_type === 'completed' ? 'bg-emerald-100' : 'bg-teal-100';
    }
    if (urgency === 'critica') return 'bg-red-100';
    if (urgency === 'alta') return 'bg-orange-100';
    if (!notification.read) return 'bg-blue-100';
    return 'bg-slate-100';
  };

  // Tempo relativo
  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'agora';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="relative" ref={panelRef}>

      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
        aria-label="Notificações"
      >
        <Bell className="w-5 h-5 text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel - estilo Facebook/Instagram */}
      {isOpen && (
        <>
          {/* Backdrop móvel para fechar ao clicar fora */}
          <div className="fixed inset-0 z-[90] sm:hidden bg-black/20 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          
          {/* Container Mobile (Fixed) */}
          <div className="fixed left-4 right-4 top-[70px] z-[100] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden sm:hidden flex flex-col max-h-[calc(100vh-100px)] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">Notificações</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Ler todas
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-full hover:bg-slate-200 transition"
                >
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto overscroll-contain flex-1">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
              ) : unreadNotifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Bell className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma notificação</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {unreadNotifications.slice(0, 20).map((notification) => (
                    <div
                      key={notification.id}
                      className={`group flex items-start gap-3 px-4 py-3 active:bg-slate-50 transition ${
                        !notification.read ? 'bg-blue-50/50' : ''
                      }`}
                      onClick={() => handleClick(notification)}
                    >
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getIconBgColor(notification)}`}>
                        {getIcon(notification)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 justify-between">
                          <p className={`text-sm ${!notification.read ? 'font-semibold text-slate-900' : 'text-slate-700'} line-clamp-2`}>
                            {notification.title}
                          </p>
                          <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2">
                            {getRelativeTime(notification.created_at)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 line-clamp-2 mt-1">{notification.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {notifications.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 flex-shrink-0">
                <button
                  onClick={() => {
                    if (onNavigateToModule) onNavigateToModule('notificacoes');
                    setIsOpen(false);
                  }}
                  className="w-full text-center text-sm text-blue-600 font-medium py-2 bg-white border border-blue-100 rounded-lg shadow-sm active:bg-blue-50"
                >
                  Ver todas as notificações
                </button>
              </div>
            )}
          </div>

          {/* Container Desktop (Absolute) */}
          <div className="hidden sm:block absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden origin-top-right animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
          <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 truncate">Notificações</h3>
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={toggleSound}
                className="p-1.5 rounded-full hover:bg-slate-200 transition hidden sm:block"
                title={soundEnabled ? 'Desativar som' : 'Ativar som'}
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-slate-600" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-400" />
                )}
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Marcar todas como lidas</span>
                  <span className="sm:hidden">Ler todas</span>
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-full hover:bg-slate-200 transition"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
          </div>

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
              {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : unreadNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Bell className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma notificação</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {unreadNotifications.slice(0, 10).map((notification) => (
                  <div
                    key={notification.id}
                    className={`group flex items-start gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer transition ${
                      !notification.read ? 'bg-blue-50/50' : ''
                    }`}
                    onClick={() => handleClick(notification)}
                  >
                    {/* Icon */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getIconBgColor(notification)}`}>
                      {getIcon(notification)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className={`text-sm ${!notification.read ? 'font-semibold text-slate-900' : 'text-slate-700'} line-clamp-2`}>
                          {notification.title}
                        </p>
                        {notification.metadata?.tribunal && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-200 text-slate-600 rounded flex-shrink-0">
                            {notification.metadata.tribunal}
                          </span>
                        )}
                      </div>
                      {notification.metadata?.urgency === 'alta' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 rounded mt-1 w-fit">
                          ALTA
                        </span>
                      )}
                      {notification.metadata?.urgency === 'critica' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded mt-1 w-fit animate-pulse">
                          CRÍTICA
                        </span>
                      )}
                      {isSignatureNotification(notification) && (
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded mt-1 w-fit ${
                            getSignatureAccent(notification) === 'emerald'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-teal-100 text-teal-700'
                          }`}
                        >
                          {getSignatureBadge(notification)}
                        </span>
                      )}
                      <p className="text-xs text-slate-500 line-clamp-2 mt-1">{notification.message}</p>
                      {isSignatureNotification(notification) && (
                        <div className="mt-1">
                          {(() => {
                            const progress = getSignatureProgress(notification);
                            if (!progress) return null;
                            return (
                              <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    getSignatureAccent(notification) === 'emerald' ? 'bg-emerald-500' : 'bg-teal-500'
                                  }`}
                                  style={{ width: `${progress.pct}%` }}
                                />
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      <p className={`text-[11px] mt-1 ${!notification.read ? 'text-blue-600 font-medium' : 'text-slate-400'}`}>
                        {getRelativeTime(notification.created_at)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      {!notification.read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notification.id);
                          }}
                          className="p-1 rounded hover:bg-slate-200"
                          title="Marcar como lida"
                        >
                          <Check className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNotification(notification.id);
                        }}
                        className="p-1 rounded hover:bg-red-100"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                      </button>
                    </div>

                    {/* Unread indicator */}
                    {!notification.read && (
                      <div className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-blue-500 mt-1.5" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-slate-100 px-3 sm:px-4 py-3 bg-slate-50 sticky bottom-0">
                <button
                  onClick={() => {
                    if (onNavigateToModule) onNavigateToModule('notificacoes');
                    setIsOpen(false);
                  }}
                  className="w-full text-center text-sm text-blue-600 hover:text-blue-700 font-medium py-1 bg-white border border-blue-100 rounded-lg shadow-sm"
                >
                  {notifications.length > 10 ? 'Ver todas as notificações' : 'Ver notificações'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {/* Popup de notificações na tela (estilo Facebook/Instagram) */}
      {popupNotifications.length > 0 && createPortal(
        <div className="fixed bottom-4 right-4 z-[2147483647] flex flex-col-reverse items-end gap-2 pointer-events-none">
          <style>
            {`
              @keyframes slideInRight {
                from {
                  transform: translateX(100%);
                  opacity: 0;
                }
                to {
                  transform: translateX(0);
                  opacity: 1;
                }
              }
              
              @keyframes shrink {
                from {
                  width: 100%;
                }
                to {
                  width: 0%;
                }
              }
              @keyframes fadeOut {
                from {
                  opacity: 1;
                }
                to {
                  opacity: 0;
                }
              }
            `}
          </style>
          {popupNotifications.map((notification) => (
            <div
              key={notification.id}
              className="pointer-events-auto bg-white rounded-xl shadow-2xl border border-slate-200 p-3 sm:p-4 max-w-[calc(100vw-2rem)] sm:max-w-sm cursor-pointer hover:bg-slate-50 transition-colors"
              style={{ animation: 'slideInRight 0.3s ease-out' }}
              onClick={() => {
                handleClick(notification);
                setPopupNotifications(prev => prev.filter(n => n.id !== notification.id));
              }}
            >
              <div className="flex items-start gap-3">
                {/* Ícone */}
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getIconBgColor(notification)}`}>
                  {getIcon(notification)}
                </div>
                
                {/* Conteúdo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <p className="text-sm font-semibold text-slate-900 line-clamp-2">{notification.title}</p>
                  </div>
                  {notification.metadata?.urgency === 'critica' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 rounded animate-pulse mt-1 w-fit">
                      CRÍTICA
                    </span>
                  )}
                  {notification.metadata?.urgency === 'alta' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-orange-100 text-orange-700 rounded mt-1 w-fit">
                      ALTA
                    </span>
                  )}
                  {isSignatureNotification(notification) && (
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded mt-1 w-fit ${
                        notification.metadata?.signature_type === 'completed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-teal-100 text-teal-700'
                      }`}
                    >
                      {getSignatureBadge(notification)}
                    </span>
                  )}
                  <p className="text-xs text-slate-600 line-clamp-2 mt-1">{notification.message}</p>
                  {isSignatureNotification(notification) && (
                    <div className="mt-1">
                      {(() => {
                        const progress = getSignatureProgress(notification);
                        if (!progress) return null;
                        return (
                          <>
                            <div className="flex items-center justify-between text-[10px] text-slate-500">
                              <span>{notification.metadata?.document_name ? String(notification.metadata.document_name) : 'Documento'}</span>
                              <span className="font-semibold text-emerald-700">{progress.signedCount}/{progress.totalSigners}</span>
                            </div>
                            <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progress.pct}%` }} />
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <p className="text-[10px] text-blue-600 font-medium mt-1">
                    Clique para ver detalhes
                  </p>
                </div>
                
                {/* Botão fechar */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopupNotifications(prev => prev.filter(n => n.id !== notification.id));
                  }}
                  className="flex-shrink-0 p-1 rounded-full hover:bg-slate-200 transition"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              
              {/* Barra de progresso */}
              <div className="mt-2 h-1 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500/70 rounded-full"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default NotificationBell;

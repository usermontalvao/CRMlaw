import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Briefcase,
  Calendar,
  CheckCheck,
  CheckCircle2,
  DollarSign,
  FileSignature,
  FileText,
  FolderOpen,
  Scale,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { canUsePushNotifications, isIosDevice, isStandaloneDisplay } from '../lib/pwa';
import type { PortalRoute } from '../types/portal.types';
import { formatRelative } from './PortalUI';

interface NotifItem {
  id: string;
  title?: string;
  message?: string;
  body?: string;
  type?: string;
  is_read?: boolean;
  read?: boolean;
  read_at?: string | null;
  created_at?: string;
  process_id?: string | null;
  metadata?: Record<string, any> | null;
  [key: string]: any;
}

function isUnread(notification: NotifItem) {
  return !(notification.read ?? notification.is_read ?? !!notification.read_at);
}

function iconFor(type?: string) {
  const notificationType = type || '';
  if (notificationType === 'profile_update_approved') return UserCheck;
  if (notificationType === 'profile_update_rejected') return UserX;
  if (notificationType === 'document_upload_approved') return CheckCircle2;
  if (notificationType === 'document_upload_rejected') return UserX;
  if (notificationType === 'new_signature_request') return FileSignature;
  if (notificationType === 'new_agreement') return DollarSign;
  if (notificationType === 'new_document_request') return FolderOpen;
  if (notificationType === 'process_transito_julgado') return CheckCircle2;
  if (notificationType === 'process_sentenca') return Scale;
  if (notificationType === 'process_cumprimento') return Briefcase;
  if (notificationType === 'process_recurso') return Scale;
  if (notificationType === 'process_audiencia') return Calendar;
  if (notificationType === 'process_arquivado') return FolderOpen;
  if (notificationType === 'process_citacao') return FileText;
  if (notificationType === 'process_status_changed') return Scale;
  if (notificationType.includes('process')) return Briefcase;
  if (notificationType.includes('intim') || notificationType.includes('public')) return FileText;
  if (notificationType.includes('financ') || notificationType.includes('parcela')) return DollarSign;
  if (notificationType.includes('agend') || notificationType.includes('audien')) return Calendar;
  if (notificationType.includes('assin') || notificationType.includes('sign')) return FileSignature;
  return Bell;
}

function routeFor(notification: NotifItem): { route: PortalRoute; param?: string } | null {
  const notificationType = (notification.type || '').toLowerCase();
  if (notificationType === 'profile_update_approved' || notificationType === 'profile_update_rejected') {
    return { route: 'perfil' };
  }
  if (notificationType === 'document_upload_approved' || notificationType === 'document_upload_rejected') {
    return { route: 'documentos' };
  }
  if (notificationType === 'new_signature_request') return { route: 'assinar' };
  if (notificationType === 'new_agreement') return { route: 'financeiro' };
  if (notificationType === 'new_document_request') return { route: 'documentos' };

  const processId = notification.metadata?.process_id || notification.process_id;
  if (notificationType.startsWith('process_') && processId) return { route: 'casos', param: `proc:${processId}` };
  if (notificationType === 'process_status_changed' && processId) return { route: 'casos', param: `proc:${processId}` };
  if (processId) return { route: 'casos', param: `proc:${processId}` };
  return null;
}

export const PortalNotificationBell: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { items, unreadCount, newIds, markRead, markAllRead, clearNew, pushEnabled, requestPushPermission } = usePortalNotifications();
  const { navigate } = usePortalRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const installRequiredForPush = isIosDevice() && !isStandaloneDisplay();
  const canRequestPush = canUsePushNotifications();

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const handleToggle = () => {
    if (!open) clearNew();
    setOpen((current) => !current);
  };

  const recent = (items as NotifItem[]).filter(isUnread).slice(0, 6);

  const handleClick = (notification: NotifItem) => {
    if (isUnread(notification)) markRead(notification.id);
    const destination = routeFor(notification);
    if (!destination) return;
    navigate(destination.route, destination.param);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        onClick={handleToggle}
        className={`relative flex h-11 w-11 items-center justify-center rounded-2xl border transition ${
          open
            ? 'border-orange-200 bg-orange-50 text-orange-600'
            : 'border-slate-200 bg-[#f8f7f5] text-slate-500 shadow-sm hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600'
        }`}
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-13 z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">Notificações</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => {
                    markAllRead();
                    setOpen(false);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10">
                <Bell className="h-8 w-8 text-slate-200" />
                <p className="text-sm text-slate-400">Nenhuma notificação</p>
              </div>
            ) : (
              recent.map((notification) => {
                const unread = isUnread(notification);
                const isNew = newIds.has(notification.id);
                const Icon = iconFor(notification.type);
                const destination = routeFor(notification);

                return (
                  <button
                    key={notification.id}
                    onClick={() => handleClick(notification)}
                    disabled={!destination}
                    className={`relative flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                      isNew ? 'bg-orange-50' : unread ? 'bg-orange-50/40' : ''
                    } ${!destination ? 'cursor-default' : ''}`}
                  >
                    {isNew && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-orange-500" />}
                    <div
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        unread ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <p className={`text-[12.5px] leading-snug ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                          {notification.title || 'Notificação'}
                          {isNew && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                              novo
                            </span>
                          )}
                        </p>
                        {unread && !isNew && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
                      </div>
                      {(notification.message || notification.body) && (
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] text-slate-500">{notification.message || notification.body}</p>
                      )}
                      <p className="mt-1 text-[10.5px] text-slate-400">{formatRelative(notification.created_at)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="flex flex-col gap-1 border-t border-slate-100 px-4 py-2.5">
            {!pushEnabled && installRequiredForPush && (
              <button
                onClick={() => {
                  navigate('app');
                  setOpen(false);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-center text-[11.5px] font-medium text-slate-500 transition hover:bg-slate-50"
              >
                <Bell className="h-3 w-3" /> Instale o app para ativar notificações
              </button>
            )}
            {!pushEnabled && !installRequiredForPush && canRequestPush && 'Notification' in window && Notification.permission !== 'denied' && (
              <button
                onClick={async () => {
                  await requestPushPermission();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-center text-[11.5px] font-medium text-slate-500 transition hover:bg-slate-50"
              >
                <Bell className="h-3 w-3" /> Ativar notificações no celular
              </button>
            )}
            <button
              onClick={() => {
                navigate('notificacoes');
                setOpen(false);
              }}
              className="w-full rounded-lg py-2 text-center text-[12.5px] font-medium text-orange-600 transition hover:bg-orange-50"
            >
              Ver todas as notificações
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

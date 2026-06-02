import React, { useEffect, useRef, useState } from 'react';
import { Bell, Briefcase, Calendar, CheckCheck, DollarSign, FileSignature, FileText, FolderOpen, Scale, UserCheck, UserX, X } from 'lucide-react';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { formatRelative } from './PortalUI';
import type { PortalRoute } from '../types/portal.types';

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

function isUnread(n: NotifItem) {
  return !(n.read ?? n.is_read ?? !!n.read_at);
}

function iconFor(type?: string) {
  const t = type || '';
  if (t === 'profile_update_approved') return UserCheck;
  if (t === 'profile_update_rejected') return UserX;
  if (t === 'process_status_changed')  return Scale;
  if (t === 'new_signature_request')   return FileSignature;
  if (t === 'new_agreement')           return DollarSign;
  if (t === 'new_document_request')    return FolderOpen;
  if (t.includes('process') || t.includes('andamento')) return Briefcase;
  if (t.includes('intim') || t.includes('public'))      return FileText;
  if (t.includes('financ') || t.includes('parcela'))    return DollarSign;
  if (t.includes('agend') || t.includes('audien'))      return Calendar;
  if (t.includes('assin') || t.includes('sign'))        return FileSignature;
  return Bell;
}

function routeFor(n: NotifItem): { route: PortalRoute; param?: string } | null {
  const t = (n.type || '').toLowerCase();
  if (t === 'profile_update_approved' || t === 'profile_update_rejected') return { route: 'perfil' };
  if (t === 'process_status_changed') {
    const pid = n.metadata?.process_id || n.process_id;
    return pid ? { route: 'casos', param: `proc:${pid}` } : { route: 'casos' };
  }
  if (t === 'new_signature_request') return { route: 'assinar' };
  if (t === 'new_agreement')         return { route: 'financeiro' };
  if (t === 'new_document_request')  return { route: 'documentos' };
  if (n.process_id)                  return { route: 'casos', param: `proc:${n.process_id}` };
  return null;
}

export const PortalNotificationBell: React.FC = () => {
  const { items, unreadCount, newIds, markRead, markAllRead, clearNew } = usePortalNotifications();
  const { navigate } = usePortalRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Ao abrir, registra timestamp e limpa badge de "novas"
  const handleToggle = () => {
    if (!open) clearNew();
    setOpen((v) => !v);
  };

  const recent = (items as NotifItem[]).filter(isUnread).slice(0, 6);

  const handleClick = (n: NotifItem) => {
    if (isUnread(n)) markRead(n.id);
    const dest = routeFor(n);
    if (dest) { navigate(dest.route, dest.param); setOpen(false); }
  };

  return (
    <div ref={ref} className="relative">
      {/* Botão sino */}
      <button
        onClick={handleToggle}
        className={`relative hidden lg:flex h-10 w-10 items-center justify-center rounded-xl border transition ${
          open
            ? 'border-orange-200 bg-orange-50 text-orange-600'
            : 'border-slate-200 bg-white text-slate-500 shadow-sm hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600'
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

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">Notificações</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => { markAllRead(); setOpen(false); }}
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

          {/* Lista */}
          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10">
                <Bell className="h-8 w-8 text-slate-200" />
                <p className="text-sm text-slate-400">Nenhuma notificação</p>
              </div>
            ) : (
              recent.map((n) => {
                const unread = isUnread(n);
                const isNew  = newIds.has(n.id);
                const Icon   = iconFor(n.type);
                const dest   = routeFor(n);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    disabled={!dest}
                    className={`relative flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                      isNew   ? 'bg-orange-50' :
                      unread  ? 'bg-orange-50/40' : ''
                    } ${!dest ? 'cursor-default' : ''}`}
                  >
                    {/* Barra lateral para "nova" */}
                    {isNew && (
                      <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-orange-500" />
                    )}
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      unread ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <p className={`text-[12.5px] leading-snug ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                          {n.title || 'Notificação'}
                          {isNew && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
                              novo
                            </span>
                          )}
                        </p>
                        {unread && !isNew && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
                      </div>
                      {(n.message || n.body) && (
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] text-slate-500">{n.message || n.body}</p>
                      )}
                      <p className="mt-1 text-[10.5px] text-slate-400">{formatRelative(n.created_at)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-4 py-2.5">
            <button
              onClick={() => { navigate('notificacoes'); setOpen(false); }}
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

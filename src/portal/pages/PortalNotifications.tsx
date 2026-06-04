import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell, Briefcase, FileText, DollarSign, Calendar, FileSignature,
  AlertCircle, CheckCheck, UserCheck, UserX, ChevronRight, Scale, FolderOpen,
} from 'lucide-react';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import {
  EmptyState, SkeletonCard, formatDateLong, formatRelative,
} from '../components/PortalUI';

interface NotificationItem {
  id: string;
  title?: string;
  body?: string;
  message?: string;
  read?: boolean;
  is_read?: boolean;
  read_at?: string | null;
  created_at?: string;
  type?: string;
  category?: string;
  link?: string;
  process_id?: string | null;
  process_code?: string | null;
  metadata?: Record<string, any> | null;
}

type Tab = 'unread' | 'read';

function isUnread(n: NotificationItem): boolean {
  return !(n.read ?? n.is_read ?? !!n.read_at);
}

function dayKey(iso?: string): string {
  if (!iso) return 'outros';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'outros';
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  if (key === 'outros') return 'Outros';
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (key === today) return 'Hoje';
  if (key === yesterday) return 'Ontem';
  return formatDateLong(key);
}

function styleFor(type?: string, category?: string) {
  const t = `${type || ''} ${category || ''}`.toLowerCase();
  if (t === 'profile_update_approved') return { Icon: UserCheck };
  if (t === 'profile_update_rejected') return { Icon: UserX };
  if (t === 'document_upload_approved') return { Icon: CheckCheck };
  if (t === 'document_upload_rejected') return { Icon: UserX };
  if (t === 'process_status_changed')  return { Icon: Scale };
  if (t === 'new_signature_request')   return { Icon: FileSignature };
  if (t === 'new_agreement')           return { Icon: DollarSign };
  if (t === 'new_document_request')    return { Icon: FolderOpen };
  if (t.includes('process') || t.includes('movi') || t.includes('andamento')) return { Icon: Briefcase };
  if (t.includes('public') || t.includes('intim'))  return { Icon: FileText };
  if (t.includes('financ') || t.includes('parcela')) return { Icon: DollarSign };
  if (t.includes('agend') || t.includes('audien'))   return { Icon: Calendar };
  if (t.includes('assin') || t.includes('sign'))     return { Icon: FileSignature };
  if (t.includes('prazo') || t.includes('alert'))    return { Icon: AlertCircle };
  return { Icon: Bell };
}

/** Retorna a rota interna do portal para cada tipo de notificação */
function routeFor(n: NotificationItem): { route: string; param?: string } | null {
  const t = (n.type || '').toLowerCase();
  // Cadastral
  if (t === 'profile_update_approved' || t === 'profile_update_rejected')
    return { route: 'perfil' };
  if (t === 'document_upload_approved' || t === 'document_upload_rejected')
    return { route: 'documentos' };
  // Mudança de status do processo
  if (t === 'process_status_changed') {
    const pid = n.metadata?.process_id || n.process_id;
    return pid ? { route: 'processos', param: pid } : { route: 'processos' };
  }
  // Nova assinatura
  if (t === 'new_signature_request')
    return { route: 'assinar' };
  // Novo contrato
  if (t === 'new_agreement')
    return { route: 'financeiro' };
  // Nova solicitação de documentos
  if (t === 'new_document_request')
    return { route: 'documentos' };
  // Processo genérico
  if (n.process_id)
    return { route: 'processos', param: n.process_id };
  if (t.includes('financ') || t.includes('parcela'))
    return { route: 'financeiro' };
  if (t.includes('assin') || t.includes('sign'))
    return { route: 'assinar' };
  if (t.includes('agend') || t.includes('audien'))
    return { route: 'agenda' };
  if (t.includes('document'))
    return { route: 'documentos' };
  if (n.link) return null;
  return null;
}

export const PortalNotifications: React.FC = () => {
  const { navigate } = usePortalRouter();
  const { items: rawItems, unreadCount, newIds, loading, markRead, markAllRead, clearNew } = usePortalNotifications();
  const items = rawItems as NotificationItem[];
  const [tab, setTab] = useState<Tab>('unread');

  // Registra lastOpened ao entrar na página
  useEffect(() => { clearNew(); }, [clearNew]);

  const readCount = useMemo(() => items.filter((n) => !isUnread(n)).length, [items]);

  const filtered = useMemo(() => {
    if (tab === 'unread') return items.filter(isUnread);
    return items.filter((n) => !isUnread(n));
  }, [items, tab]);

  const groups = useMemo(() => {
    const map = new Map<string, NotificationItem[]>();
    [...filtered]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .forEach((n) => {
        const k = dayKey(n.created_at);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(n);
      });
    return Array.from(map.entries());
  }, [filtered]);

  const handleClick = (n: NotificationItem) => {
    if (isUnread(n)) markRead(n.id);
    if (n.link) { window.open(n.link, '_blank', 'noopener'); return; }
    const dest = routeFor(n);
    if (!dest) return;
    navigate(dest.route as any, dest.param);
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Notificações</h1>
          <p className="mt-1 text-sm text-slate-500">
            {items.length
              ? `${unreadCount} não lida${unreadCount !== 1 ? 's' : ''} · ${readCount} lida${readCount !== 1 ? 's' : ''}`
              : 'Histórico de avisos e atualizações.'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllRead()}
            className="mt-1 shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Marcar todas como lidas
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-200">
        {(['unread', 'read'] as Tab[]).map((t) => {
          const on = tab === t;
          const count = t === 'unread' ? unreadCount : readCount;
          const label = t === 'unread' ? 'Não lidas' : 'Lidas';
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`relative -mb-px flex items-center gap-1.5 border-b-2 pb-3 pt-1 text-sm font-medium transition ${on ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {label}
              <span className={`tabular-nums text-[11px] font-semibold ${on ? 'text-orange-700' : 'text-slate-400'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={tab === 'unread' ? CheckCheck : Bell}
          title={tab === 'unread' ? 'Tudo em dia' : 'Nenhuma lida ainda'}
          description={tab === 'unread' ? 'Nenhuma notificação pendente no momento.' : 'As notificações que você abrir aparecerão aqui.'}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([key, list]) => (
            <div key={key}>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{dayLabel(key)}</h2>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="flex flex-col gap-1.5">
                {list.map((n) => {
                  const unread = isUnread(n);
                  const isNew = newIds.has(n.id);
                  const { Icon } = styleFor(n.type, n.category);
                  const body = n.body || n.message;
                  const dest = routeFor(n);
                  const isClickable = !!(dest || n.link);

                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      disabled={!isClickable}
                      className={`group relative flex w-full items-start gap-3 rounded-xl border bg-white p-4 text-left transition ${
                        isClickable ? 'cursor-pointer hover:border-slate-300' : 'cursor-default'
                      } ${isNew
                          ? 'border-l-[3px] border-l-orange-500 border-orange-100 bg-orange-50/40'
                          : unread
                          ? 'border-l-[3px] border-l-orange-400 border-slate-200'
                          : 'border-slate-200'}`}
                    >
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        unread ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-600'
                      }`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-[13px] ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                            {n.title || 'Notificação'}
                            {isNew && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
                                novo
                              </span>
                            )}
                          </p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {unread && !isNew && <span className="h-2 w-2 rounded-full bg-orange-500" />}
                            {isClickable && <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />}
                          </div>
                        </div>
                        {body && <p className="mt-0.5 line-clamp-2 text-[13px] text-slate-500">{body}</p>}
                        {n.process_code && (
                          <span className="mt-1 inline-block font-mono text-[11px] tabular-nums text-slate-400">{n.process_code}</span>
                        )}
                        <p className="mt-1 text-[11px] tabular-nums text-slate-400">{formatRelative(n.created_at)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalNotifications;

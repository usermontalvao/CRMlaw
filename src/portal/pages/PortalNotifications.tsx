import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell, Briefcase, FileText, DollarSign, Calendar, FileSignature,
  AlertCircle, CheckCheck, UserCheck, UserX, ChevronRight, Scale,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import {
  PageHeader, EmptyState, SkeletonCard, formatDateLong, formatRelative,
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

type Tab = 'all' | 'unread';

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
  if (t === 'profile_update_approved')
    return { Icon: UserCheck, color: 'from-emerald-500 to-green-500', ring: 'ring-emerald-100' };
  if (t === 'profile_update_rejected')
    return { Icon: UserX, color: 'from-rose-500 to-red-500', ring: 'ring-rose-100' };
  if (t === 'process_status_changed')
    return { Icon: Scale, color: 'from-orange-500 to-amber-500', ring: 'ring-orange-100' };
  if (t === 'new_signature_request')
    return { Icon: FileSignature, color: 'from-violet-500 to-purple-500', ring: 'ring-violet-100' };
  if (t === 'new_agreement')
    return { Icon: DollarSign, color: 'from-emerald-500 to-teal-500', ring: 'ring-emerald-100' };
  if (t.includes('process') || t.includes('movi') || t.includes('andamento'))
    return { Icon: Briefcase, color: 'from-orange-500 to-amber-500', ring: 'ring-orange-100' };
  if (t.includes('public') || t.includes('intim'))
    return { Icon: FileText, color: 'from-violet-500 to-purple-500', ring: 'ring-violet-100' };
  if (t.includes('financ') || t.includes('parcela') || t.includes('paga'))
    return { Icon: DollarSign, color: 'from-emerald-500 to-green-500', ring: 'ring-emerald-100' };
  if (t.includes('agend') || t.includes('event') || t.includes('audien'))
    return { Icon: Calendar, color: 'from-amber-500 to-orange-500', ring: 'ring-amber-100' };
  if (t.includes('assin') || t.includes('sign'))
    return { Icon: FileSignature, color: 'from-rose-500 to-pink-500', ring: 'ring-rose-100' };
  if (t.includes('prazo') || t.includes('alert') || t.includes('warning'))
    return { Icon: AlertCircle, color: 'from-rose-500 to-red-500', ring: 'ring-rose-100' };
  return { Icon: Bell, color: 'from-slate-500 to-slate-600', ring: 'ring-slate-100' };
}

/** Retorna a rota interna do portal para cada tipo de notificação */
function routeFor(n: NotificationItem): { route: string; param?: string } | null {
  const t = (n.type || '').toLowerCase();
  // Cadastral
  if (t === 'profile_update_approved' || t === 'profile_update_rejected')
    return { route: 'perfil' };
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
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    setLoading(true);
    clientPortalService
      .listNotifications(session.user.id)
      .then((data) => { if (mounted) setItems(data as NotificationItem[]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session]);

  const unreadCount = useMemo(() => items.filter(isUnread).length, [items]);

  const filtered = useMemo(() => {
    if (tab === 'unread') return items.filter(isUnread);
    return items;
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
    if (n.link) { window.open(n.link, '_blank', 'noopener'); return; }
    const dest = routeFor(n);
    if (!dest) return;
    navigate(dest.route as any, dest.param);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notificações"
        subtitle={
          items.length
            ? `${unreadCount} não lida${unreadCount !== 1 ? 's' : ''} de ${items.length}`
            : 'Histórico de avisos e atualizações.'
        }
        icon={Bell}
      />

      {/* Tabs */}
      <div className="flex gap-1.5">
        {(['all', 'unread'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${
              tab === t
                ? 'bg-orange-500 text-white ring-orange-500 shadow-sm'
                : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {t === 'all' ? 'Todas' : 'Não lidas'}
            <span className={`rounded-full px-1.5 text-[10px] ${tab === t ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {t === 'all' ? items.length : unreadCount}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3"><SkeletonCard /><SkeletonCard /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={tab === 'unread' ? CheckCheck : Bell}
          title={tab === 'unread' ? 'Tudo em dia!' : 'Sem notificações'}
          description={
            tab === 'unread'
              ? 'Você já leu todas as suas notificações.'
              : 'Quando houver novidades nos seus processos, você verá aqui.'
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([key, list]) => (
            <div key={key}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">{dayLabel(key)}</h2>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="space-y-2">
                {list.map((n) => {
                  const unread = isUnread(n);
                  const { Icon, color, ring } = styleFor(n.type, n.category);
                  const body = n.body || n.message;
                  const dest = routeFor(n);
                  const isClickable = !!(dest || n.link);

                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      disabled={!isClickable}
                      className={`group w-full flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-sm text-left transition ${
                        isClickable
                          ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]'
                          : 'cursor-default'
                      } ${unread ? 'border-orange-200/80 bg-orange-50/30' : 'border-slate-200/80'}`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-sm ring-4 ${ring}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                            {n.title || 'Notificação'}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {unread && <span className="mt-1.5 h-2 w-2 rounded-full bg-orange-500" />}
                            {isClickable && <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition mt-0.5" />}
                          </div>
                        </div>
                        {body && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{body}</p>}
                        {n.process_code && (
                          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-100">
                            {n.process_code}
                          </span>
                        )}
                        <p className="mt-1.5 text-[11px] text-slate-400">{formatRelative(n.created_at)}</p>
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
